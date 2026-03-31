const { Router } = require('express');
const pool = require('../db/connection');
const adminAuth = require('../middleware/adminAuth');
const rateLimit = require('express-rate-limit');
const { generarPDFCotizacion } = require('../services/pdfGenerator');
const { enviarCotizacion } = require('../services/email');
const { enviarMensaje } = require('../services/whatsapp');
const fs = require('fs');

const router = Router();

// Rate limiting: máximo 5 cotizaciones por IP en 1 hora
const cotizacionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { message: 'Demasiadas solicitudes de cotización. Intenta de nuevo en 1 hora.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// POST /api/corporativo/cotizar — Generar cotización + RESERVACIÓN corporativa con FACTURA
router.post('/cotizar', cotizacionLimiter, async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      empresa,
      contacto,
      email,
      telefono,
      num_empleados,
      rfc,
      razon_social,
      fecha_evento,
      hora_inicio,
      paquete_base,
      num_asistentes,
      notas,
    } = req.body;

    // Validación: empresa, contacto, email Y fecha_evento son REQUERIDOS
    if (!empresa || !contacto || !email || !fecha_evento) {
      return res.status(400).json({ message: 'empresa, contacto, email y fecha_evento son requeridos' });
    }

    const asistentes = Number(num_asistentes) || 50;
    const horaInicio = hora_inicio || '15:00';

    // Buscar precio del paquete base (si se eligió uno)
    let precioPaquete = 15000; // Precio corporativo default
    let nombrePaquete = 'Personalizado';
    let paqueteId = null;
    if (paquete_base) {
      const { rows } = await pool.query('SELECT id, nombre, precio FROM paquetes WHERE id = $1', [paquete_base]);
      if (rows.length > 0) {
        precioPaquete = Number(rows[0].precio);
        nombrePaquete = rows[0].nombre;
        paqueteId = rows[0].id;
      }
    }

    // Cálculo corporativo: precio base + extra por asistente
    const extraPorAsistente = 150;
    const subtotal = precioPaquete + (asistentes * extraPorAsistente);
    const iva = Math.round(subtotal * 0.16 * 100) / 100;
    const montoTotal = Math.round((subtotal + iva) * 100) / 100;

    // Generar folio (será número de factura)
    const folio = `FAC-${Date.now().toString(36).toUpperCase()}`;

    await client.query('BEGIN');

    // 1. Crear o encontrar cliente corporativo
    const clienteRes = await client.query(
      `SELECT id FROM clientes WHERE email = $1`,
      [email]
    );
    
    let clienteId;
    if (clienteRes.rows.length > 0) {
      clienteId = clienteRes.rows[0].id;
      // Actualizar datos corporativos
      await client.query(
        `UPDATE clientes SET nombre = $1, apellido = $2, telefono = $3, actualizado_en = NOW() WHERE id = $4`,
        [contacto, empresa, telefono || null, clienteId]
      );
    } else {
      // Crear nuevo cliente corporativo
      const nuevoClienteRes = await client.query(
        `INSERT INTO clientes (nombre, apellido, email, telefono, es_invitado) 
         VALUES ($1, $2, $3, $4, false) 
         RETURNING id`,
        [contacto, empresa, email, telefono || null]
      );
      clienteId = nuevoClienteRes.rows[0].id;
    }

    // 2. Crear reservación corporativa
    let horaFin = '23:59'; // Default para corporativo (noche completa)
    if (paqueteId) {
      const paqRes = await client.query('SELECT tipo_duracion, duracion_horas FROM paquetes WHERE id = $1', [paqueteId]);
      if (paqRes.rows.length > 0 && paqRes.rows[0].tipo_duracion === 'horas') {
        const duracion = paqRes.rows[0].duracion_horas || 4;
        const [h, m] = horaInicio.split(':').map(Number);
        const finH = h + duracion;
        horaFin = `${String(Math.min(finH, 23)).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      }
    }

    const reservacionRes = await client.query(
      `INSERT INTO reservaciones 
        (cliente_id, paquete_id, fecha_evento, hora_inicio, hora_fin, num_invitados, monto_total, notas)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [clienteId, paqueteId || 1, fecha_evento, horaInicio, horaFin, asistentes, montoTotal, notas || `Reservación B2B: ${empresa}`]
    );

    const reservacionId = reservacionRes.rows[0].id;

    // 3. Guardar en leads_corporativos (para historial)
    await client.query(
      `INSERT INTO leads_corporativos
        (folio, empresa, contacto, email, telefono, num_empleados, rfc, razon_social, fecha_evento, paquete_base, num_asistentes, notas, subtotal, iva, total, estado, reservacion_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'confirmado', $16)
       RETURNING id`,
      [folio, empresa, contacto, email, telefono || null, num_empleados || null, rfc || null, razon_social || null, fecha_evento, nombrePaquete, asistentes, notas || null, subtotal, iva, montoTotal, reservacionId]
    );

    // 4. Generar PDF FACTURA (no cotización)
    const pdfPath = await generarPDFCotizacion({
      folio,
      empresa,
      contacto,
      fechaEvento: fecha_evento,
      paqueteBase: nombrePaquete,
      numAsistentes: asistentes,
      subtotal,
      iva,
      total: montoTotal,
      notas,
      esFactura: true, // Marcar como factura
      rfc,
      razonSocial,
    });

    // 5. Actualizar lead con URL del PDF
    await client.query(
      'UPDATE leads_corporativos SET pdf_url = $1 WHERE folio = $2',
      [pdfPath, folio]
    );

    // 6. Enviar factura a cliente
    const emailResult = await enviarCotizacion({
      to: email,
      contacto,
      empresa,
      folio,
      pdfPath,
      esFactura: true,
      total: montoTotal,
      fecha_evento,
    });

    // 7. Notificar al admin por WhatsApp
    const adminPhone = process.env.ADMIN_WHATSAPP;
    if (adminPhone) {
      try {
        await enviarMensaje(
          adminPhone,
          `✅ *FACTURA CORPORATIVA GENERADA*\n\n` +
          `📄 Folio: ${folio}\n` +
          `🏢 Empresa: ${empresa}\n` +
          `👤 Contacto: ${contacto}\n` +
          `📅 Fecha evento: ${fecha_evento}\n` +
          `👥 Asistentes: ${asistentes}\n` +
          `💰 Total: $${montoTotal.toLocaleString('es-MX')} MXN\n` +
          `📌 Reservación #${reservacionId}`
        );
      } catch (e) {
        console.log('⚠️ WhatsApp notif falló (no crítico)');
      }
    }

    await client.query('COMMIT');

    console.log(`✅ Factura corporativa creada: ${folio} | Reservación: #${reservacionId}`);

    res.status(201).json({
      ok: true,
      folio,
      reservacion_id: reservacionId,
      cliente_id: clienteId,
      total: montoTotal,
      subtotal,
      iva,
      emailEnviado: emailResult.sent,
      pdfGenerado: true,
      mensaje: 'Factura generada y reservación creada exitosamente',
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error cotización corporativa:', err.message);
    res.status(500).json({ message: err.message || 'Error al generar la factura corporativa' });
  } finally {
    client.release();
  }
});

// GET /api/corporativo/leads — Listar leads corporativos (admin)
router.get('/leads', adminAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM leads_corporativos ORDER BY creado_en DESC LIMIT 50'
    );
    res.json(rows);
  } catch (err) {
    console.error('Error listando leads:', err);
    res.status(500).json({ message: 'Error al obtener leads' });
  }
});

// PATCH /api/corporativo/leads/:id — Actualizar estado de lead
router.patch('/leads/:id', adminAuth, async (req, res) => {
  try {
    const { estado } = req.body;
    const { id } = req.params;
    const validEstados = ['pendiente', 'cotizado', 'pagado', 'cancelado'];
    if (!validEstados.includes(estado)) {
      return res.status(400).json({ message: 'Estado inválido' });
    }
    const { rows } = await pool.query(
      'UPDATE leads_corporativos SET estado = $1, actualizado_en = NOW() WHERE id = $2 RETURNING *',
      [estado, id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Lead no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error actualizando lead:', err);
    res.status(500).json({ message: 'Error al actualizar' });
  }
});

// GET /api/corporativo/pdf/:folio — Descargar PDF de cotización
router.get('/pdf/:folio', async (req, res) => {
  try {
    const { folio } = req.params;
    // Validar formato de folio
    if (!/^COT-[A-Z0-9]+$/i.test(folio)) {
      return res.status(400).json({ message: 'Folio inválido' });
    }
    const { rows } = await pool.query(
      'SELECT pdf_url, empresa FROM leads_corporativos WHERE folio = $1',
      [folio]
    );
    if (rows.length === 0 || !rows[0].pdf_url) {
      return res.status(404).json({ message: 'PDF no encontrado' });
    }

    const pdfPath = rows[0].pdf_url;
    if (!fs.existsSync(pdfPath)) {
      return res.status(404).json({ message: 'Archivo PDF no disponible' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${folio}.pdf"`);
    fs.createReadStream(pdfPath).pipe(res);
  } catch (err) {
    console.error('Error descargando PDF:', err);
    res.status(500).json({ message: 'Error al descargar PDF' });
  }
});

module.exports = router;
