const { Router } = require('express');
const pool = require('../db/connection');
const adminAuth = require('../middleware/adminAuth');

const router = Router();

// GET /api/config — Obtener toda la configuración
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT clave, valor FROM configuracion ORDER BY clave');
    const config = {};
    rows.forEach((r) => { config[r.clave] = r.valor; });
    res.json(config);
  } catch (err) {
    console.error('Error obteniendo config:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// PUT /api/config — Actualizar configuración (recibe objeto { clave: valor })
router.put('/', adminAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    const updates = req.body;
    if (!updates || typeof updates !== 'object') {
      return res.status(400).json({ message: 'Se requiere un objeto con claves y valores' });
    }

    await client.query('BEGIN');
    for (const [clave, valor] of Object.entries(updates)) {
      await client.query(
        `INSERT INTO configuracion (clave, valor, actualizado_en)
         VALUES ($1, $2, NOW())
         ON CONFLICT (clave) DO UPDATE SET valor = $2, actualizado_en = NOW()`,
        [clave, valor]
      );
    }
    await client.query('COMMIT');

    // Devolver config actualizada
    const { rows } = await pool.query('SELECT clave, valor FROM configuracion ORDER BY clave');
    const config = {};
    rows.forEach((r) => { config[r.clave] = r.valor; });
    res.json(config);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error actualizando config:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  } finally {
    client.release();
  }
});

module.exports = router;
