const { Router } = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const pool = require('../db/connection');
const promotorAuth = require('../middleware/promotorAuth');
const adminAuth = require('../middleware/adminAuth');

const router = Router();

// Rate limiting para login
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { message: 'Demasiados intentos. Intenta en 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── PÚBLICAS ───

// POST /api/promotores/login
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'Email y contraseña requeridos' });
    }

    // Aceptar email o código de referencia
    const { rows } = await pool.query(
      'SELECT * FROM promotores WHERE (email = $1 OR codigo_ref = $1) AND activo = TRUE',
      [email.toLowerCase().trim()]
    );
    if (rows.length === 0) {
      return res.status(401).json({ message: 'Credenciales incorrectas' });
    }

    const promotor = rows[0];
    const valid = await bcrypt.compare(password, promotor.password_hash);
    if (!valid) {
      return res.status(401).json({ message: 'Credenciales incorrectas' });
    }

    const token = jwt.sign(
      { id: promotor.id, email: promotor.email, nombre: promotor.nombre, codigo_ref: promotor.codigo_ref, role: 'promotor' },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({ ok: true, token, nombre: promotor.nombre, codigo_ref: promotor.codigo_ref });
  } catch (err) {
    console.error('Error login promotor:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// POST /api/promotores/click — Registrar click de referido (público)
router.post('/click', async (req, res) => {
  try {
    const { codigo_ref } = req.body;
    if (!codigo_ref) return res.status(400).json({ message: 'Código requerido' });

    const { rows } = await pool.query(
      'SELECT id FROM promotores WHERE codigo_ref = $1 AND activo = TRUE',
      [codigo_ref]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Promotor no encontrado' });

    await pool.query(
      'INSERT INTO clicks_promotor (promotor_id) VALUES ($1)',
      [rows[0].id]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('Error registro click:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// ─── RUTAS DEL PROMOTOR (autenticadas) ───

// GET /api/promotores/me — Perfil del promotor
router.get('/me', promotorAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, nombre, email, codigo_ref, comision_porcentaje, creado_en FROM promotores WHERE id = $1',
      [req.promotor.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'No encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error perfil promotor:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// GET /api/promotores/stats — Estadísticas del promotor
router.get('/stats', promotorAuth, async (req, res) => {
  try {
    const promotorId = req.promotor.id;
    const codigoRef = req.promotor.codigo_ref;

    // Inicio de semana (lunes)
    const hoy = new Date();
    const diaSem = hoy.getDay();
    const diffLunes = diaSem === 0 ? 6 : diaSem - 1;
    const inicioSemana = new Date(hoy);
    inicioSemana.setDate(hoy.getDate() - diffLunes);
    inicioSemana.setHours(0, 0, 0, 0);

    // Inicio de mes
    const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().split('T')[0];

    const [clicksSemana, clicksMes, reservasPagadas, reservasMes, comision] = await Promise.all([
      // Clicks esta semana
      pool.query(
        'SELECT COUNT(*) FROM clicks_promotor WHERE promotor_id = $1 AND creado_en >= $2',
        [promotorId, inicioSemana.toISOString()]
      ),
      // Clicks este mes
      pool.query(
        'SELECT COUNT(*) FROM clicks_promotor WHERE promotor_id = $1 AND creado_en >= $2',
        [promotorId, inicioMes]
      ),
      // Reservas pagadas totales
      pool.query(
        "SELECT COUNT(*) FROM reservaciones WHERE (promotor = $1 OR promotor_id = $2) AND estado = 'pagada'",
        [codigoRef, promotorId]
      ),
      // Reservas pagadas este mes
      pool.query(
        "SELECT COUNT(*) FROM reservaciones WHERE (promotor = $1 OR promotor_id = $2) AND estado = 'pagada' AND creado_en >= $3",
        [codigoRef, promotorId, inicioMes]
      ),
      // Comisión acumulada del mes
      pool.query(
        `SELECT COALESCE(SUM(r.monto_total * p.comision_porcentaje / 100), 0) AS total
         FROM reservaciones r
         JOIN promotores p ON p.id = $2
         WHERE (r.promotor = $1 OR r.promotor_id = $2) AND r.estado = 'pagada' AND r.creado_en >= $3`,
        [codigoRef, promotorId, inicioMes]
      ),
    ]);

    res.json({
      clicks_semana: parseInt(clicksSemana.rows[0].count),
      clicks_mes: parseInt(clicksMes.rows[0].count),
      reservas_pagadas: parseInt(reservasPagadas.rows[0].count),
      reservas_mes: parseInt(reservasMes.rows[0].count),
      comision_mes: Number(comision.rows[0].total),
    });
  } catch (err) {
    console.error('Error stats promotor:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// GET /api/promotores/mis-eventos — Eventos del promotor
router.get('/mis-eventos', promotorAuth, async (req, res) => {
  try {
    const codigoRef = req.promotor.codigo_ref;
    const promotorId = req.promotor.id;

    const { rows } = await pool.query(
      `SELECT r.id, r.fecha_evento, r.hora_inicio, r.estado, r.monto_total,
              c.nombre AS cliente_nombre, c.apellido AS cliente_apellido,
              p.nombre AS paquete_nombre
       FROM reservaciones r
       JOIN clientes c ON r.cliente_id = c.id
       JOIN paquetes p ON r.paquete_id = p.id
       WHERE (r.promotor = $1 OR r.promotor_id = $2)
       ORDER BY r.fecha_evento DESC
       LIMIT 50`,
      [codigoRef, promotorId]
    );

    res.json(rows);
  } catch (err) {
    console.error('Error eventos promotor:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// ─── RUTAS ADMIN ───

// GET /api/promotores — Listar todos los promotores (admin)
router.get('/', adminAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, nombre, email, codigo_ref, comision_porcentaje, activo, creado_en FROM promotores ORDER BY creado_en DESC'
    );
    res.json(rows);
  } catch (err) {
    console.error('Error listar promotores:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// POST /api/promotores — Crear promotor (admin)
router.post('/', adminAuth, async (req, res) => {
  try {
    const { nombre, codigo_ref, comision_porcentaje } = req.body;
    if (!nombre || !codigo_ref) {
      return res.status(400).json({ message: 'Nombre y código de referido requeridos' });
    }

    // Validar código_ref: solo letras, números, guiones
    if (!/^[a-zA-Z0-9_-]+$/.test(codigo_ref)) {
      return res.status(400).json({ message: 'El código de referido solo puede tener letras, números, guiones y guiones bajos' });
    }

    const ref = codigo_ref.toLowerCase();
    const email = req.body.email || `${ref}@promotor.quintadeali.com`;
    const password = req.body.password || ref + '2026';

    const existente = await pool.query(
      'SELECT id FROM promotores WHERE email = $1 OR codigo_ref = $2',
      [email, ref]
    );
    if (existente.rows.length > 0) {
      return res.status(409).json({ message: 'Ya existe un promotor con ese código' });
    }

    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO promotores (nombre, email, password_hash, codigo_ref, comision_porcentaje)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, nombre, email, codigo_ref, comision_porcentaje`,
      [nombre, email, hash, ref, comision_porcentaje || 10]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Error crear promotor:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// PATCH /api/promotores/:id — Editar promotor (admin)
router.patch('/:id', adminAuth, async (req, res) => {
  try {
    const { nombre, comision_porcentaje, activo } = req.body;
    const { rows } = await pool.query(
      `UPDATE promotores SET 
        nombre = COALESCE($1, nombre),
        comision_porcentaje = COALESCE($2, comision_porcentaje),
        activo = COALESCE($3, activo)
       WHERE id = $4 RETURNING id, nombre, email, codigo_ref, comision_porcentaje, activo`,
      [nombre || null, comision_porcentaje != null ? comision_porcentaje : null, activo != null ? activo : null, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Promotor no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error editar promotor:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// DELETE /api/promotores/:id — Eliminar promotor (admin)
router.delete('/:id', adminAuth, async (req, res) => {
  try {
    const { rows } = await pool.query('DELETE FROM promotores WHERE id = $1 RETURNING id, nombre', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Promotor no encontrado' });
    res.json({ message: `Promotor ${rows[0].nombre} eliminado` });
  } catch (err) {
    console.error('Error eliminando promotor:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// GET /api/promotores/admin/stats — Estadísticas generales (jefe)
router.get('/admin/stats', adminAuth, async (req, res) => {
  try {
    const inicioMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];

    const [ingresosBrutos, comisionesTotal, leaderboard] = await Promise.all([
      // Ingresos brutos del mes (reservaciones pagadas)
      pool.query(
        "SELECT COALESCE(SUM(monto_total), 0) AS total FROM reservaciones WHERE estado = 'pagada' AND creado_en >= $1",
        [inicioMes]
      ),
      // Total a pagar en comisiones del mes
      pool.query(
        `SELECT COALESCE(SUM(r.monto_total * p.comision_porcentaje / 100), 0) AS total
         FROM reservaciones r
         JOIN promotores p ON (r.promotor = p.codigo_ref OR r.promotor_id = p.id)
         WHERE r.estado = 'pagada' AND r.creado_en >= $1`,
        [inicioMes]
      ),
      // Leaderboard
      pool.query(
        `SELECT p.id, p.nombre, p.codigo_ref, p.comision_porcentaje,
                COUNT(r.id) AS reservas,
                COALESCE(SUM(r.monto_total), 0) AS ventas,
                COALESCE(SUM(r.monto_total * p.comision_porcentaje / 100), 0) AS comision
         FROM promotores p
         LEFT JOIN reservaciones r ON (r.promotor = p.codigo_ref OR r.promotor_id = p.id) AND r.estado = 'pagada' AND r.creado_en >= $1
         WHERE p.activo = TRUE
         GROUP BY p.id
         ORDER BY ventas DESC`,
        [inicioMes]
      ),
    ]);

    const bruto = Number(ingresosBrutos.rows[0].total);
    const comisiones = Number(comisionesTotal.rows[0].total);

    res.json({
      ingresos_brutos: bruto,
      total_comisiones: comisiones,
      ingresos_netos: bruto - comisiones,
      leaderboard: leaderboard.rows.map(r => ({
        ...r,
        reservas: parseInt(r.reservas),
        ventas: Number(r.ventas),
        comision: Number(r.comision),
      })),
    });
  } catch (err) {
    console.error('Error stats admin promotores:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

module.exports = router;
