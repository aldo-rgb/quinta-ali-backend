const { Router } = require('express');
const pool = require('../db/connection');
const adminAuth = require('../middleware/adminAuth');
const cloudinary = require('cloudinary').v2;
const multer = require('multer');

const router = Router();

// Configurar Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Multer: almacenar en memoria para enviar directo a Cloudinary
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Solo se permiten imágenes'));
  },
});

const AREAS_VALIDAS = ['alberca', 'asador', 'hospedaje', 'cancha', 'jacuzzi', 'palapa', 'juegos'];

// GET /api/galeria — Todas las fotos activas agrupadas por área
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, area, url_foto, descripcion, orden
       FROM galeria_fotos
       WHERE activo = TRUE
       ORDER BY area, orden, creado_en DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error('Error obteniendo galería:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// GET /api/galeria/:area — Fotos de un area específica
router.get('/:area', async (req, res) => {
  try {
    const { area } = req.params;
    if (!AREAS_VALIDAS.includes(area)) {
      return res.status(400).json({ message: `Área inválida. Opciones: ${AREAS_VALIDAS.join(', ')}` });
    }

    const { rows } = await pool.query(
      `SELECT id, area, url_foto, descripcion, orden
       FROM galeria_fotos
       WHERE area = $1 AND activo = TRUE
       ORDER BY orden, creado_en DESC`,
      [area]
    );
    res.json(rows);
  } catch (err) {
    console.error('Error obteniendo fotos del área:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// POST /api/galeria/subir — Subir foto a Cloudinary + guardar en DB
router.post('/subir', adminAuth, upload.single('foto'), async (req, res) => {
  try {
    const { area, descripcion } = req.body;

    if (!area || !AREAS_VALIDAS.includes(area)) {
      return res.status(400).json({ message: `Área requerida. Opciones: ${AREAS_VALIDAS.join(', ')}` });
    }
    if (!req.file) {
      return res.status(400).json({ message: 'Se requiere un archivo de imagen' });
    }

    // Subir a Cloudinary desde buffer
    const resultado = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: `quinta-ali/${area}`,
          transformation: [
            { quality: 'auto', fetch_format: 'auto' },
            { width: 1200, height: 900, crop: 'limit' },
          ],
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );
      stream.end(req.file.buffer);
    });

    // Guardar URL en base de datos
    const { rows } = await pool.query(
      `INSERT INTO galeria_fotos (area, url_foto, descripcion)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [area, resultado.secure_url, descripcion || null]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Error subiendo foto:', err.message);
    res.status(500).json({ message: 'Error al subir la foto' });
  }
});

// DELETE /api/galeria/:id — Desactivar foto (soft delete)
router.delete('/:id', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(
      `UPDATE galeria_fotos SET activo = FALSE WHERE id = $1 RETURNING *`,
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Foto no encontrada' });
    res.json({ message: 'Foto eliminada', foto: rows[0] });
  } catch (err) {
    console.error('Error eliminando foto:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

module.exports = router;
