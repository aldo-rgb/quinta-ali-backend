const { Router } = require('express');
const pool = require('../db/connection');
const adminAuth = require('../middleware/adminAuth');

const router = Router();

// GET /api/clientes — Listar clientes (admin)
router.get('/', adminAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM clientes ORDER BY creado_en DESC'
    );
    res.json(rows);
  } catch (err) {
    console.error('Error obteniendo clientes:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// GET /api/clientes/:id
router.get('/:id', adminAuth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM clientes WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Cliente no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error obteniendo cliente:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// POST /api/clientes — Crear o encontrar cliente (soporta Google y invitado)
router.post('/', async (req, res) => {
  try {
    const { nombre, apellido, telefono, email, google_id, es_invitado } = req.body;

    if (!nombre || !email) {
      return res.status(400).json({ message: 'Nombre y email son obligatorios' });
    }

    // Si viene con google_id, buscar por google_id primero
    if (google_id) {
      const porGoogle = await pool.query('SELECT * FROM clientes WHERE google_id = $1', [google_id]);
      if (porGoogle.rows.length > 0) {
        const { rows } = await pool.query(
          `UPDATE clientes SET nombre = $1, apellido = $2, email = $3, telefono = COALESCE($4, telefono), actualizado_en = NOW()
           WHERE google_id = $5 RETURNING *`,
          [nombre, apellido || '', email, telefono || null, google_id]
        );
        return res.json(rows[0]);
      }
    }

    // Buscar por email
    const porEmail = await pool.query('SELECT * FROM clientes WHERE email = $1', [email]);
    if (porEmail.rows.length > 0) {
      const { rows } = await pool.query(
        `UPDATE clientes SET nombre = $1, apellido = $2, google_id = COALESCE($3, google_id),
         telefono = COALESCE($4, telefono), es_invitado = $5, actualizado_en = NOW()
         WHERE email = $6 RETURNING *`,
        [nombre, apellido || '', google_id || null, telefono || null, es_invitado || false, email]
      );
      return res.json(rows[0]);
    }

    // Crear nuevo cliente
    const { rows } = await pool.query(
      `INSERT INTO clientes (nombre, apellido, email, telefono, google_id, es_invitado)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [nombre, apellido || '', email, telefono || null, google_id || null, es_invitado || false]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Error creando cliente:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

module.exports = router;
