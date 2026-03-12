const { Router } = require('express');
const pool = require('../db/connection');
const adminAuth = require('../middleware/adminAuth');

const router = Router();

// ── Motor de cálculo de precio dinámico ──
function calcularPrecioFinal(precioBase, fechaElegida, reglasActivas) {
  let precioFinal = precioBase;
  const fecha = new Date(fechaElegida + 'T12:00:00');
  const ahora = new Date();
  let tieneDescuento = false;
  let porcentajeDescuento = 0;

  for (const regla of reglasActivas) {
    const mod = Number(regla.modificador_porcentaje);

    if (regla.tipo_regla === 'dia_semana') {
      const diasRegla = regla.condicion.split(',').map(d => parseInt(d.trim()));
      if (diasRegla.includes(fecha.getDay())) {
        precioFinal += precioBase * (mod / 100);
      }
    }

    if (regla.tipo_regla === 'rango_fechas') {
      const [inicio, fin] = regla.condicion.split(',');
      const fechaInicio = new Date(inicio + 'T00:00:00');
      const fechaFin = new Date(fin + 'T23:59:59');
      if (fecha >= fechaInicio && fecha <= fechaFin) {
        precioFinal += precioBase * (mod / 100);
      }
    }

    if (regla.tipo_regla === 'dias_anticipacion') {
      const diasFaltantes = (fecha - ahora) / (1000 * 60 * 60 * 24);
      if (diasFaltantes >= 0 && diasFaltantes <= parseInt(regla.condicion)) {
        precioFinal += precioBase * (mod / 100);
        if (mod < 0) {
          tieneDescuento = true;
          porcentajeDescuento = Math.abs(mod);
        }
      }
    }
  }

  return {
    precioBase,
    precioFinal: Math.round(precioFinal),
    tieneDescuento,
    porcentajeDescuento,
  };
}

// GET /api/precios/reglas — Todas las reglas (admin)
router.get('/reglas', adminAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM reglas_precio_dinamico ORDER BY tipo_regla, id'
    );
    res.json(rows);
  } catch (err) {
    console.error('Error obteniendo reglas:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// POST /api/precios/reglas — Crear regla
router.post('/reglas', adminAuth, async (req, res) => {
  try {
    const { nombre_regla, tipo_regla, condicion, modificador_porcentaje } = req.body;

    if (!nombre_regla || !tipo_regla || !condicion || modificador_porcentaje === undefined) {
      return res.status(400).json({ message: 'Faltan campos obligatorios' });
    }

    const tiposValidos = ['dia_semana', 'rango_fechas', 'dias_anticipacion'];
    if (!tiposValidos.includes(tipo_regla)) {
      return res.status(400).json({ message: `tipo_regla inválido. Opciones: ${tiposValidos.join(', ')}` });
    }

    const { rows } = await pool.query(
      `INSERT INTO reglas_precio_dinamico (nombre_regla, tipo_regla, condicion, modificador_porcentaje)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [nombre_regla, tipo_regla, condicion, modificador_porcentaje]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Error creando regla:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// PATCH /api/precios/reglas/:id — Actualizar regla
router.patch('/reglas/:id', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre_regla, tipo_regla, condicion, modificador_porcentaje, activo } = req.body;

    const { rows } = await pool.query(
      `UPDATE reglas_precio_dinamico SET
        nombre_regla = COALESCE($1, nombre_regla),
        tipo_regla = COALESCE($2, tipo_regla),
        condicion = COALESCE($3, condicion),
        modificador_porcentaje = COALESCE($4, modificador_porcentaje),
        activo = COALESCE($5, activo),
        actualizado_en = NOW()
       WHERE id = $6 RETURNING *`,
      [nombre_regla, tipo_regla, condicion, modificador_porcentaje, activo, id]
    );

    if (rows.length === 0) return res.status(404).json({ message: 'Regla no encontrada' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error actualizando regla:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// DELETE /api/precios/reglas/:id — Eliminar regla
router.delete('/reglas/:id', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { rowCount } = await pool.query('DELETE FROM reglas_precio_dinamico WHERE id = $1', [id]);
    if (rowCount === 0) return res.status(404).json({ message: 'Regla no encontrada' });
    res.json({ message: 'Regla eliminada' });
  } catch (err) {
    console.error('Error eliminando regla:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// GET /api/precios/calcular?paquete_id=X&fecha=YYYY-MM-DD — Calcular precio para una fecha
router.get('/calcular', async (req, res) => {
  try {
    const { paquete_id, fecha } = req.query;

    if (!paquete_id || !fecha) {
      return res.status(400).json({ message: 'Se requiere paquete_id y fecha' });
    }

    const paqRes = await pool.query('SELECT precio FROM paquetes WHERE id = $1 AND activo = TRUE', [paquete_id]);
    if (paqRes.rows.length === 0) return res.status(404).json({ message: 'Paquete no encontrado' });

    const precioBase = Number(paqRes.rows[0].precio);

    const { rows: reglas } = await pool.query(
      'SELECT * FROM reglas_precio_dinamico WHERE activo = TRUE'
    );

    const resultado = calcularPrecioFinal(precioBase, fecha, reglas);
    res.json(resultado);
  } catch (err) {
    console.error('Error calculando precio:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// GET /api/precios/calendario?paquete_id=X&mes=YYYY-MM — Precios de todo un mes
router.get('/calendario', async (req, res) => {
  try {
    const { paquete_id, mes } = req.query;

    if (!paquete_id || !mes) {
      return res.status(400).json({ message: 'Se requiere paquete_id y mes (YYYY-MM)' });
    }

    const paqRes = await pool.query('SELECT precio FROM paquetes WHERE id = $1 AND activo = TRUE', [paquete_id]);
    if (paqRes.rows.length === 0) return res.status(404).json({ message: 'Paquete no encontrado' });

    const precioBase = Number(paqRes.rows[0].precio);

    const { rows: reglas } = await pool.query(
      'SELECT * FROM reglas_precio_dinamico WHERE activo = TRUE'
    );

    const [year, month] = mes.split('-').map(Number);
    const diasEnMes = new Date(year, month, 0).getDate();
    const precios = {};

    for (let d = 1; d <= diasEnMes; d++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      precios[dateStr] = calcularPrecioFinal(precioBase, dateStr, reglas);
    }

    res.json(precios);
  } catch (err) {
    console.error('Error calculando calendario:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// Exportar el motor de cálculo para uso interno (reservaciones)
router.calcularPrecioFinal = calcularPrecioFinal;

module.exports = router;
