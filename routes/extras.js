const { Router } = require('express');
const pool = require('../db/connection');
const adminAuth = require('../middleware/adminAuth');

const router = Router();

// GET /api/extras — Listar extras activos
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM extras WHERE activo = TRUE ORDER BY precio ASC'
    );
    res.json(rows);
  } catch (err) {
    console.error('Error obteniendo extras:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// POST /api/extras — Crear extra (admin)
router.post('/', adminAuth, async (req, res) => {
  try {
    const { nombre, descripcion, precio, emoji } = req.body;
    if (!nombre || !precio) {
      return res.status(400).json({ message: 'Nombre y precio son obligatorios' });
    }
    const { rows } = await pool.query(
      'INSERT INTO extras (nombre, descripcion, precio, emoji) VALUES ($1, $2, $3, $4) RETURNING *',
      [nombre, descripcion || null, precio, emoji || '🎁']
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Error creando extra:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// PATCH /api/extras/:id — Actualizar extra
router.patch('/:id', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, descripcion, precio, emoji, activo } = req.body;
    const { rows } = await pool.query(
      `UPDATE extras SET 
        nombre = COALESCE($1, nombre),
        descripcion = COALESCE($2, descripcion),
        precio = COALESCE($3, precio),
        emoji = COALESCE($4, emoji),
        activo = COALESCE($5, activo)
      WHERE id = $6 RETURNING *`,
      [nombre, descripcion, precio, emoji, activo, id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Extra no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error actualizando extra:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// GET /api/extras/reservacion/:id — Extras de una reservación
router.get('/reservacion/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT re.*, e.nombre, e.emoji, e.descripcion 
       FROM reservacion_extras re 
       JOIN extras e ON re.extra_id = e.id 
       WHERE re.reservacion_id = $1`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('Error obteniendo extras de reservación:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

module.exports = router;
