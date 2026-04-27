const { Router } = require('express');
const pool = require('../db/connection');
const adminAuth = require('../middleware/adminAuth');
const preciosRouter = require('./precios');
const cloudinary = require('cloudinary').v2;
const multer = require('multer');

const router = Router();

// Configurar Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Multer para subir INE (imágenes y PDF, max 10MB)
const uploadINE = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten imágenes o PDF'));
    }
  },
});

// GET /api/reservaciones — Listar reservaciones (admin, excluye archivadas por defecto)
router.get('/', adminAuth, async (req, res) => {
  try {
    const { incluir_archivadas } = req.query; // ?incluir_archivadas=true para ver todas
    
    const archivadasCondition = incluir_archivadas === 'true' ? '' : 'AND r.archivada = FALSE';
    
    const { rows } = await pool.query(`
      SELECT r.*, 
             c.nombre AS cliente_nombre, c.apellido AS cliente_apellido, c.telefono AS cliente_telefono, c.email AS cliente_email,
             p.nombre AS paquete_nombre, p.tipo_duracion, p.duracion_horas
      FROM reservaciones r
      JOIN clientes c ON r.cliente_id = c.id
      JOIN paquetes p ON r.paquete_id = p.id
      WHERE 1=1 ${archivadasCondition}
      ORDER BY r.fecha_evento ASC, r.hora_inicio ASC
    `);
    res.json(rows);
  } catch (err) {
    console.error('Error obteniendo reservaciones:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// GET /api/reservaciones/stats — Estadísticas para el admin dashboard
router.get('/stats', adminAuth, async (req, res) => {
  try {
    const hoy = new Date().toISOString().split('T')[0];
    const inicioMes = hoy.substring(0, 7) + '-01';

    const [totalRes, resHoy, pendientes, ingresosMes, extrasMes, topExtras, terminalMes] = await Promise.all([
      pool.query("SELECT COUNT(*) FROM reservaciones WHERE estado = 'confirmada'"),
      pool.query("SELECT COUNT(*) FROM reservaciones WHERE fecha_evento::date = $1 AND estado NOT IN ('cancelada')", [hoy]),
      pool.query("SELECT COUNT(*) FROM reservaciones WHERE estado = 'cancelada'"),
      pool.query(
        `SELECT COALESCE(SUM(monto_total), 0) as total
         FROM reservaciones
         WHERE fecha_evento >= $1 AND estado NOT IN ('cancelada')`, [inicioMes]
      ),
      pool.query(
        `SELECT COALESCE(SUM(re.subtotal), 0) as total
         FROM reservacion_extras re
         JOIN reservaciones r ON re.reservacion_id = r.id
         WHERE r.fecha_evento >= $1 AND r.estado NOT IN ('cancelada')`, [inicioMes]
      ),
      pool.query(
        `SELECT e.nombre, e.emoji, COUNT(*) as veces, SUM(re.subtotal) as ingreso
         FROM reservacion_extras re
         JOIN extras e ON re.extra_id = e.id
         GROUP BY e.id, e.nombre, e.emoji
         ORDER BY veces DESC LIMIT 5`
      ),
      pool.query(
        `SELECT COALESCE(SUM(monto), 0) as total
         FROM pagos_terminal
         WHERE estado = 'pagado' AND creado_en >= $1`, [inicioMes]
      ),
    ]);

    res.json({
      total_reservaciones: Number(totalRes.rows[0].count),
      reservaciones_hoy: Number(resHoy.rows[0].count),
      pendientes: Number(pendientes.rows[0].count),
      ingresos_mes: Number(ingresosMes.rows[0].total) + Number(terminalMes.rows[0].total),
      ingresos_extras_mes: Number(extrasMes.rows[0].total),
      ingresos_terminal_mes: Number(terminalMes.rows[0].total),
      top_extras: topExtras.rows,
    });
  } catch (err) {
    console.error('Error obteniendo stats:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// GET /api/reservaciones/disponibilidad?fecha=2026-03-14
// Retorna los horarios ocupados para una fecha dada
router.get('/disponibilidad', async (req, res) => {
  try {
    const { fecha } = req.query;
    if (!fecha) return res.status(400).json({ message: 'Se requiere parámetro fecha' });

    const { rows } = await pool.query(
      `SELECT hora_inicio, hora_fin, paquete_id
       FROM reservaciones
       WHERE fecha_evento = $1 AND estado NOT IN ('cancelada')
       ORDER BY hora_inicio`,
      [fecha]
    );
    res.json(rows);
  } catch (err) {
    console.error('Error verificando disponibilidad:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// GET /api/reservaciones/calendario?mes=2026-03
// Retorna resumen de ocupación por día para un mes completo
router.get('/calendario', async (req, res) => {
  try {
    const { mes } = req.query;
    if (!mes || !/^\d{4}-\d{2}$/.test(mes)) {
      return res.status(400).json({ message: 'Se requiere parámetro mes en formato YYYY-MM' });
    }

    const inicioMes = `${mes}-01`;
    const [year, month] = mes.split('-').map(Number);
    const ultimoDia = new Date(year, month, 0).getDate();
    const finMes = `${mes}-${String(ultimoDia).padStart(2, '0')}`;

    // Obtener todas las reservaciones del mes (no canceladas)
    const { rows } = await pool.query(
      `SELECT fecha_evento, fecha_fin, hora_inicio, hora_fin, paquete_id, p.tipo_duracion
       FROM reservaciones r
       JOIN paquetes p ON r.paquete_id = p.id
       WHERE r.estado NOT IN ('cancelada')
         AND fecha_evento <= $2
         AND COALESCE(fecha_fin, fecha_evento) >= $1
       ORDER BY fecha_evento, hora_inicio`,
      [inicioMes, finMes]
    );

    // Agrupar por fecha: contar reservaciones y detectar si el día está lleno
    const porDia = {};
    for (const r of rows) {
      const fechaInicio = r.fecha_evento instanceof Date
        ? r.fecha_evento.toISOString().split('T')[0]
        : String(r.fecha_evento).split('T')[0];
      
      // Si hay fecha_fin (para paquetes de noche con rango), ocupar todo el rango
      let fechaFin = fechaInicio;
      if (r.fecha_fin) {
        fechaFin = r.fecha_fin instanceof Date
          ? r.fecha_fin.toISOString().split('T')[0]
          : String(r.fecha_fin).split('T')[0];
      }

      // Marcar todos los días del rango como ocupados
      let fechaActual = new Date(fechaInicio);
      const fechaFinDate = new Date(fechaFin);
      
      while (fechaActual <= fechaFinDate) {
        const dateStr = fechaActual.toISOString().split('T')[0];
        if (!porDia[dateStr]) porDia[dateStr] = { reservaciones: 0, tiene_noche: false };
        porDia[dateStr].reservaciones++;
        if (r.tipo_duracion === 'noche') porDia[dateStr].tiene_noche = true;
        fechaActual.setDate(fechaActual.getDate() + 1);
      }
    }

    // Construir respuesta: array de { fecha, reservaciones, disponible }
    const calendario = {};
    for (const [fecha, info] of Object.entries(porDia)) {
      calendario[fecha] = {
        reservaciones: info.reservaciones,
        // Un día está disponible SOLO si NO tiene ninguna reservación
        disponible: info.reservaciones === 0 && !info.tiene_noche,
      };
    }

    res.json(calendario);
  } catch (err) {
    console.error('Error obteniendo calendario:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// POST /api/reservaciones — Crear nueva reservación
router.post('/', async (req, res) => {
  const client = await pool.connect();
  try {
    const { cliente_id, paquete_id, fecha_evento, hora_inicio, num_invitados, notas } = req.body;

    if (!cliente_id || !paquete_id || !fecha_evento || !hora_inicio) {
      return res.status(400).json({ message: 'Faltan campos obligatorios: cliente_id, paquete_id, fecha_evento, hora_inicio' });
    }

    await client.query('BEGIN');

    // Obtener info del paquete para calcular hora_fin y monto
    const paqueteRes = await client.query('SELECT * FROM paquetes WHERE id = $1', [paquete_id]);
    if (paqueteRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Paquete no encontrado' });
    }
    const paquete = paqueteRes.rows[0];

    // Calcular hora_fin basado en tipo de paquete
    let hora_fin;
    if (paquete.tipo_duracion === 'noche') {
      hora_fin = '23:59';
    } else {
      // Sumar las horas de duración
      const [h, m] = hora_inicio.split(':').map(Number);
      const finH = h + (paquete.duracion_horas || 4);
      hora_fin = `${String(Math.min(finH, 23)).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }

    const monto_total = paquete.precio;

    // Aplicar precio dinámico si hay reglas activas
    const reglasRes = await client.query('SELECT * FROM reglas_precio_dinamico WHERE activo = TRUE');
    let montoConDinamico;
    if (reglasRes.rows.length > 0) {
      const calc = preciosRouter.calcularPrecioFinal(Number(paquete.precio), fecha_evento, reglasRes.rows);
      montoConDinamico = calc.precioFinal;
    } else {
      montoConDinamico = Number(paquete.precio);
    }

    // Insertar (el trigger verificará empalmes automáticamente)
    const { rows } = await client.query(
      `INSERT INTO reservaciones (cliente_id, paquete_id, fecha_evento, hora_inicio, hora_fin, num_invitados, monto_total, notas)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [cliente_id, paquete_id, fecha_evento, hora_inicio, hora_fin, num_invitados || null, montoConDinamico, notas || null]
    );

    await client.query('COMMIT');

    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');

    // Si es error de empalme del trigger, retornar 409 Conflict
    if (err.message && err.message.includes('CONFLICTO DE HORARIO')) {
      return res.status(409).json({ message: err.message });
    }

    console.error('Error creando reservación:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  } finally {
    client.release();
  }
});

// PATCH /api/reservaciones/:id/estado — Actualizar estado (admin: confirmar, cancelar, etc.)
router.patch('/:id/estado', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { estado } = req.body;

    const estadosValidos = ['pendiente', 'confirmada', 'pagada', 'cancelada', 'completada'];
    if (!estadosValidos.includes(estado)) {
      return res.status(400).json({ message: `Estado inválido. Opciones: ${estadosValidos.join(', ')}` });
    }

    const { rows } = await pool.query(
      `UPDATE reservaciones SET estado = $1, actualizado_en = NOW() WHERE id = $2 RETURNING *`,
      [estado, id]
    );

    if (rows.length === 0) return res.status(404).json({ message: 'Reservación no encontrada' });

    res.json(rows[0]);
  } catch (err) {
    console.error('Error actualizando estado:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// PATCH /api/reservaciones/:id/checkin — Registrar check-in
router.patch('/:id/checkin', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(
      `UPDATE reservaciones SET checkin_at = NOW(), actualizado_en = NOW() WHERE id = $1 RETURNING *`,
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Reservación no encontrada' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error registrando check-in:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// PATCH /api/reservaciones/:id/checkout — Registrar check-out
router.patch('/:id/checkout', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(
      `UPDATE reservaciones SET checkout_at = NOW(), estado = 'completada', actualizado_en = NOW() WHERE id = $1 RETURNING *`,
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Reservación no encontrada' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error registrando check-out:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// POST /api/reservaciones/completa — Flujo completo: crear cliente + reservación en un solo request
router.post('/completa', async (req, res) => {
  const client = await pool.connect();
  try {
    const { nombre, apellido, telefono, email, google_id, es_invitado, paquete_id, fecha_evento, fecha_fin, hora_inicio, num_invitados, notas, extras, ine_url, promotor } = req.body;

    console.log('📝 POST /completa recibido:', { nombre, paquete_id, fecha_evento, hora_inicio });

    if (!nombre || !email || !paquete_id || !fecha_evento || !hora_inicio) {
      console.log('❌ Faltan campos:', { nombre: !!nombre, email: !!email, paquete_id: !!paquete_id, fecha_evento: !!fecha_evento, hora_inicio: !!hora_inicio });
      return res.status(400).json({ message: 'Faltan campos obligatorios' });
    }

    await client.query('BEGIN');

    // 1. Crear o encontrar cliente
    let clienteId;

    // Si tiene google_id, buscar por google_id (usuario autenticado)
    if (google_id) {
      const existente = await client.query('SELECT id FROM clientes WHERE google_id = $1', [google_id]);
      if (existente.rows.length > 0) {
        clienteId = existente.rows[0].id;
        // Actualizar datos del cliente autenticado
        await client.query(
          `UPDATE clientes SET nombre = $1, apellido = $2, telefono = $3, actualizado_en = NOW() WHERE id = $4`,
          [nombre, apellido || '', telefono || null, clienteId]
        );
      } else {
        // Crear nuevo cliente autenticado
        const nuevoCliente = await client.query(
          `INSERT INTO clientes (nombre, apellido, telefono, email, google_id, es_invitado) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [nombre, apellido || '', telefono || null, email, google_id, false]
        );
        clienteId = nuevoCliente.rows[0].id;
      }
    } else {
      // Usuario invitado - buscar por email, pero NO actualizar nombre (preservar el original)
      const existente = await client.query('SELECT id FROM clientes WHERE email = $1', [email]);
      if (existente.rows.length > 0) {
        // Cliente ya existe - reutilizar sin cambiar su nombre
        clienteId = existente.rows[0].id;
      } else {
        // Crear nuevo cliente invitado
        const nuevoCliente = await client.query(
          `INSERT INTO clientes (nombre, apellido, telefono, email, es_invitado) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [nombre, apellido || '', telefono || null, email, true]
        );
        clienteId = nuevoCliente.rows[0].id;
      }
    }

    // 2. Obtener paquete
    const paqRes = await client.query('SELECT * FROM paquetes WHERE id = $1 AND activo = TRUE', [paquete_id]);
    if (paqRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Paquete no encontrado' });
    }
    const paquete = paqRes.rows[0];

    // 3. Calcular hora_fin y fecha_fin
    let hora_fin;
    let fecha_fin_calculada = fecha_fin; // Si no viene, quedará null para noche o se asignará para horas
    
    if (paquete.tipo_duracion === 'noche') {
      hora_fin = '23:59';
      // Para paquetes de noche, si no viene fecha_fin, usar fecha_evento
      if (!fecha_fin_calculada) {
        fecha_fin_calculada = fecha_evento;
      }
    } else {
      // Para paquetes de horas, fecha_fin siempre es igual a fecha_evento
      const [h, m] = hora_inicio.split(':').map(Number);
      const finH = h + (paquete.duracion_horas || 4);
      hora_fin = `${String(Math.min(finH, 23)).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      fecha_fin_calculada = fecha_evento;
    }

    // 4. Calcular total con extras y precio dinámico
    let montoExtras = 0;
    if (extras && extras.length > 0) {
      for (const ex of extras) {
        montoExtras += Number(ex.precio) * (ex.cantidad || 1);
      }
    }

    // Para paquetes de noche con rango: sumar precios de cada día
    let montoTotalDinamico;
    let reglas = [];
    try {
      const reglasRes = await client.query('SELECT * FROM reglas_precio_dinamico WHERE activo = TRUE');
      reglas = reglasRes.rows;
    } catch (err) {
      // Si la tabla no existe aún, usar precio simple
      console.log('⚠️ Tabla reglas_precio_dinamico no existe, usando precio simple');
      reglas = [];
    }
    
    if (paquete.tipo_duracion === 'noche' && fecha_fin && fecha_fin !== fecha_evento) {
      // Rango de múltiples noches: sumar precio de cada día
      let totalPrecio = 0;
      const inicio = new Date(fecha_evento);
      const fin = new Date(fecha_fin);
      let fechaActual = new Date(inicio);
      
      while (fechaActual <= fin) {
        const dateStr = fechaActual.toISOString().split('T')[0];
        if (reglas.length > 0 && preciosRouter && preciosRouter.calcularPrecioFinal) {
          try {
            const calc = preciosRouter.calcularPrecioFinal(Number(paquete.precio), dateStr, reglas);
            totalPrecio += calc.precioFinal || Number(paquete.precio);
          } catch (calcErr) {
            console.log('⚠️ Error calculando precio dinámico, usando precio base:', calcErr.message);
            totalPrecio += Number(paquete.precio);
          }
        } else {
          totalPrecio += Number(paquete.precio);
        }
        fechaActual.setDate(fechaActual.getDate() + 1);
      }
      montoTotalDinamico = totalPrecio + montoExtras;
    } else {
      // Precio único (paquete de horas o una sola noche)
      const montoTotal = Number(paquete.precio) + montoExtras;
      if (reglas.length > 0 && preciosRouter && preciosRouter.calcularPrecioFinal) {
        try {
          const calc = preciosRouter.calcularPrecioFinal(Number(paquete.precio), fecha_evento, reglas);
          montoTotalDinamico = (calc.precioFinal || Number(paquete.precio)) + montoExtras;
        } catch (calcErr) {
          console.log('⚠️ Error calculando precio dinámico, usando precio base:', calcErr.message);
          montoTotalDinamico = montoTotal;
        }
      } else {
        montoTotalDinamico = montoTotal;
      }
    }

    // 4b. Resolver promotor_id si viene código de promotor
    let promotorId = null;
    if (promotor) {
      const promRes = await client.query(
        'SELECT id FROM promotores WHERE codigo_ref = $1 AND activo = TRUE',
        [promotor]
      );
      if (promRes.rows.length > 0) {
        promotorId = promRes.rows[0].id;
      }
    }

    // 5. Crear reservación (trigger verifica empalmes)
    const { rows } = await client.query(
      `INSERT INTO reservaciones (cliente_id, paquete_id, fecha_evento, fecha_fin, hora_inicio, hora_fin, num_invitados, monto_total, notas, ine_url, promotor, promotor_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [clienteId, paquete_id, fecha_evento, fecha_fin_calculada, hora_inicio, hora_fin, num_invitados || null, montoTotalDinamico, notas || null, ine_url || null, promotor || null, promotorId]
    );

    const reservacionId = rows[0].id;

    // 6. Guardar extras seleccionados
    if (extras && extras.length > 0) {
      for (const ex of extras) {
        const cant = ex.cantidad || 1;
        const subtotal = Number(ex.precio) * cant;
        await client.query(
          `INSERT INTO reservacion_extras (reservacion_id, extra_id, cantidad, precio_unitario, subtotal)
           VALUES ($1, $2, $3, $4, $5)`,
          [reservacionId, ex.id, cant, ex.precio, subtotal]
        );
      }
    }

    await client.query('COMMIT');

    res.status(201).json({
      reservacion: rows[0],
      cliente_id: clienteId,
      paquete: paquete.nombre,
      monto_total: montoTotalDinamico,
      monto_extras: montoExtras,
    });
  } catch (err) {
    await client.query('ROLLBACK');

    if (err.message && err.message.includes('CONFLICTO DE HORARIO')) {
      console.log('⚠️ Conflicto de horario:', err.message);
      return res.status(409).json({ message: 'Ese horario ya está ocupado. Por favor elige otra fecha u hora.' });
    }

    console.error('❌ Error en reservación completa:');
    console.error('   Mensaje:', err.message);
    console.error('   Stack:', err.stack);
    console.error('   Código SQL:', err.code);
    
    res.status(500).json({ 
      message: err.message || 'Error del servidor',
      detail: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  } finally {
    client.release();
  }
});

// DELETE /api/reservaciones/:id — Eliminar una reservación (admin)
router.delete('/:id', adminAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    
    // Verificar que la reservación existe
    const result = await client.query('SELECT id, cliente_id FROM reservaciones WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      client.release();
      return res.status(404).json({ message: 'Reservación no encontrada' });
    }

    const cliente_id = result.rows[0].cliente_id;

    await client.query('BEGIN');

    // 1. Eliminar pagos asociados (mercadopago y terminal)
    await client.query('DELETE FROM pagos_mercadopago WHERE reservacion_id = $1', [id]);
    await client.query('DELETE FROM pagos_terminal WHERE reservacion_id = $1', [id]);

    // 2. Eliminar códigos de acceso
    await client.query('DELETE FROM codigos_acceso WHERE reservacion_id = $1', [id]);

    // 3. Eliminar extras de la reservación
    await client.query('DELETE FROM reservacion_extras WHERE reservacion_id = $1', [id]);

    // 4. Eliminar firmas de la reservación
    await client.query('DELETE FROM firmas_reglamento WHERE reservacion_id = $1', [id]);

    // 5. Eliminar reseñas de la reservación
    await client.query('DELETE FROM resenas WHERE reservacion_id = $1', [id]);

    // 6. Eliminar la reservación
    await client.query('DELETE FROM reservaciones WHERE id = $1', [id]);

    // 5. Opcional: Eliminar cliente si no tiene más reservaciones
    const clienteUsos = await client.query(
      'SELECT COUNT(*) FROM reservaciones WHERE cliente_id = $1',
      [cliente_id]
    );
    if (parseInt(clienteUsos.rows[0].count) === 0) {
      // Solo eliminar cliente si es invitado y no tiene más reservaciones
      const clienteInfo = await client.query(
        'SELECT es_invitado FROM clientes WHERE id = $1',
        [cliente_id]
      );
      if (clienteInfo.rows[0]?.es_invitado) {
        await client.query('DELETE FROM clientes WHERE id = $1', [cliente_id]);
      }
    }

    await client.query('COMMIT');
    res.json({ message: 'Reservación eliminada exitosamente' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error eliminando reservación:', err.message, err.stack);
    res.status(500).json({ message: err.message || 'Error al eliminar la reservación' });
  } finally {
    client.release();
  }
});

// PATCH /api/reservaciones/:id/precio — Actualizar monto total (admin)
router.patch('/:id/precio', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { monto_total } = req.body;

    if (monto_total === undefined || monto_total === null) {
      return res.status(400).json({ message: 'Se requiere monto_total' });
    }

    const nuevoMonto = Number(monto_total);
    if (isNaN(nuevoMonto) || nuevoMonto < 0) {
      return res.status(400).json({ message: 'monto_total debe ser un número válido >= 0' });
    }

    const result = await pool.query(
      `UPDATE reservaciones SET monto_total = $1, actualizado_en = NOW() WHERE id = $2 RETURNING *`,
      [nuevoMonto, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Reservación no encontrada' });
    }

    console.log(`✏️ Precio actualizado para reservación ${id}: $${nuevoMonto}`);
    res.json({ message: 'Precio actualizado exitosamente', reservacion: result.rows[0] });
  } catch (err) {
    console.error('❌ Error actualizando precio:', err.message);
    res.status(500).json({ message: 'Error al actualizar el precio' });
  }
});

// PATCH /api/reservaciones/:id/anticipo — Registrar pago anticipado (admin)
router.patch('/:id/anticipo', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { monto_pagado } = req.body;

    if (monto_pagado === undefined || monto_pagado === null) {
      return res.status(400).json({ message: 'Se requiere monto_pagado' });
    }

    const montoPagado = Number(monto_pagado);
    if (isNaN(montoPagado) || montoPagado < 0) {
      return res.status(400).json({ message: 'monto_pagado debe ser un número válido >= 0' });
    }

    // Verificar que no exceda el monto total
    const resCheck = await pool.query('SELECT monto_total FROM reservaciones WHERE id = $1', [id]);
    if (resCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Reservación no encontrada' });
    }

    const montoTotal = Number(resCheck.rows[0].monto_total);
    if (montoPagado > montoTotal) {
      return res.status(400).json({ message: `El monto pagado no puede exceder $${montoTotal}` });
    }

    const result = await pool.query(
      `UPDATE reservaciones SET monto_pagado = $1, actualizado_en = NOW() WHERE id = $2 RETURNING *`,
      [montoPagado, id]
    );

    console.log(`💰 Anticipo registrado para reservación ${id}: $${montoPagado}`);
    res.json({ message: 'Anticipo registrado exitosamente', reservacion: result.rows[0] });
  } catch (err) {
    console.error('❌ Error registrando anticipo:', err.message);
    res.status(500).json({ message: 'Error al registrar el anticipo' });
  }
});

// PATCH /api/reservaciones/:id/notas — Actualizar comentarios/notas (admin)
router.patch('/:id/notas', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { notas } = req.body;

    if (notas === undefined || notas === null) {
      return res.status(400).json({ message: 'Se requiere campo notas' });
    }

    // Validar longitud máxima (1000 caracteres)
    if (String(notas).length > 1000) {
      return res.status(400).json({ message: 'Las notas no pueden exceder 1000 caracteres' });
    }

    const result = await pool.query(
      `UPDATE reservaciones SET notas = $1, actualizado_en = NOW() WHERE id = $2 RETURNING *`,
      [notas.trim() || null, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Reservación no encontrada' });
    }

    console.log(`📝 Notas actualizadas para reservación ${id}`);
    res.json({ message: 'Notas actualizadas exitosamente', reservacion: result.rows[0] });
  } catch (err) {
    console.error('❌ Error actualizando notas:', err.message);
    res.status(500).json({ message: 'Error al actualizar las notas' });
  }
});

// PATCH /api/reservaciones/:id/archivar — Archivar o desarchivar reservación (admin)
router.patch('/:id/archivar', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { archivada } = req.body;

    if (archivada === undefined || archivada === null) {
      return res.status(400).json({ message: 'Se requiere estado archivada (true/false)' });
    }

    const result = await pool.query(
      `UPDATE reservaciones SET archivada = $1, actualizado_en = NOW() WHERE id = $2 RETURNING *`,
      [archivada, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Reservación no encontrada' });
    }

    const accion = archivada ? 'archivada' : 'desarchivada';
    console.log(`📦 Reservación ${id} ${accion}`);
    res.json({ message: `Reservación ${accion} exitosamente`, reservacion: result.rows[0] });
  } catch (err) {
    console.error('❌ Error archivando reservación:', err.message);
    res.status(500).json({ message: 'Error al archivar la reservación' });
  }
});

// POST /api/reservaciones/subir-ine — Subir foto de INE a Cloudinary
router.post('/subir-ine', uploadINE.single('ine'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'Se requiere un archivo de imagen o PDF' });
    }

    const resultado = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: 'quinta-ali/ine',
          resource_type: 'auto',
          transformation: [
            { quality: 'auto', fetch_format: 'auto' },
            { width: 1600, height: 1200, crop: 'limit' },
          ],
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );
      stream.end(req.file.buffer);
    });

    res.json({ url: resultado.secure_url });
  } catch (err) {
    console.error('Error subiendo INE:', err.message);
    res.status(500).json({ message: 'Error al subir el documento' });
  }
});

// POST /api/reservaciones/archivar-vencidas — Archivar automáticamente todas las vencidas (admin)
router.post('/archivar-vencidas', adminAuth, async (req, res) => {
  try {
    const hoy = new Date().toISOString().split('T')[0];
    
    const result = await pool.query(
      `UPDATE reservaciones 
       SET archivada = TRUE, actualizado_en = NOW() 
       WHERE archivada = FALSE 
       AND COALESCE(fecha_fin, fecha_evento) < $1::date 
       RETURNING id, cliente_nombre, fecha_evento`,
      [hoy]
    );

    if (result.rowCount > 0) {
      console.log(`✅ ${result.rowCount} reservaciones archivadas automáticamente`);
      res.json({ 
        message: `${result.rowCount} reservaciones archivadas exitosamente`, 
        cantidad: result.rowCount,
        reservaciones: result.rows 
      });
    } else {
      res.json({ 
        message: 'No hay reservaciones vencidas para archivar', 
        cantidad: 0,
        reservaciones: [] 
      });
    }
  } catch (err) {
    console.error('❌ Error en archivado automático:', err.message);
    res.status(500).json({ message: 'Error al archivar reservaciones vencidas' });
  }
});

module.exports = router;
