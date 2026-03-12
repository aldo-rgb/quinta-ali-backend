const { Router } = require('express');
const pool = require('../db/connection');
const adminAuth = require('../middleware/adminAuth');
const cloudinary = require('cloudinary').v2;

const router = Router();

// GET /api/firmas — Listar todas las firmas (admin)
router.get('/', adminAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT f.*, c.nombre AS cliente_nombre, c.apellido AS cliente_apellido,
              r.fecha_evento, p.nombre AS paquete_nombre
       FROM firmas_reglamento f
       JOIN reservaciones r ON f.reservacion_id = r.id
       JOIN clientes c ON f.cliente_id = c.id
       JOIN paquetes p ON r.paquete_id = p.id
       ORDER BY f.firmado_en DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error('Error listando firmas:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// POST /api/firmas — Guardar firma digital
router.post('/', async (req, res) => {
  try {
    const { reservacion_id, cliente_id, firma_base64 } = req.body;

    if (!reservacion_id || !cliente_id || !firma_base64) {
      return res.status(400).json({ message: 'Faltan campos: reservacion_id, cliente_id, firma_base64' });
    }

    // Subir firma a Cloudinary
    const uploadResult = await cloudinary.uploader.upload(firma_base64, {
      folder: 'quinta-ali/firmas',
      public_id: `firma_reservacion_${reservacion_id}`,
      overwrite: true,
    });

    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'desconocida';
    const userAgent = req.headers['user-agent'] || 'desconocido';

    const { rows } = await pool.query(
      `INSERT INTO firmas_reglamento (reservacion_id, cliente_id, firma_url, ip_cliente, user_agent)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (reservacion_id) DO UPDATE SET
         firma_url = EXCLUDED.firma_url,
         ip_cliente = EXCLUDED.ip_cliente,
         user_agent = EXCLUDED.user_agent,
         firmado_en = NOW()
       RETURNING *`,
      [reservacion_id, cliente_id, uploadResult.secure_url, ip, userAgent]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Error guardando firma:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// GET /api/firmas/:reservacion_id — Verificar si existe firma
router.get('/:reservacion_id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM firmas_reglamento WHERE reservacion_id = $1',
      [req.params.reservacion_id]
    );
    if (rows.length === 0) return res.json({ firmado: false });
    res.json({ firmado: true, firma: rows[0] });
  } catch (err) {
    console.error('Error verificando firma:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

module.exports = router;
