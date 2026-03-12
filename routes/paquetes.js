const { Router } = require('express');
const pool = require('../db/connection');
const adminAuth = require('../middleware/adminAuth');
const cloudinary = require('cloudinary').v2;
const multer = require('multer');

const router = Router();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Solo se permiten imágenes'));
  },
});

// POST /api/paquetes/subir-imagen — Subir imagen de paquete a Cloudinary
router.post('/subir-imagen', adminAuth, upload.single('imagen'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'Se requiere una imagen' });
    const resultado = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: 'quinta-ali/paquetes', transformation: [{ quality: 'auto', fetch_format: 'auto' }, { width: 1200, height: 600, crop: 'limit' }] },
        (error, result) => { if (error) reject(error); else resolve(result); }
      );
      stream.end(req.file.buffer);
    });
    res.json({ url: resultado.secure_url });
  } catch (err) {
    console.error('Error subiendo imagen de paquete:', err.message);
    res.status(500).json({ message: 'Error al subir la imagen' });
  }
});

// GET /api/paquetes — Obtener todos los paquetes activos
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM paquetes WHERE activo = TRUE ORDER BY precio ASC'
    );
    res.json(rows);
  } catch (err) {
    console.error('Error obteniendo paquetes:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// GET /api/paquetes/all — Obtener TODOS los paquetes (admin)
router.get('/all', adminAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM paquetes ORDER BY precio ASC'
    );
    res.json(rows);
  } catch (err) {
    console.error('Error obteniendo todos los paquetes:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// GET /api/paquetes/:id — Obtener un paquete por ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(
      'SELECT * FROM paquetes WHERE id = $1 AND activo = TRUE',
      [id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Paquete no encontrado' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('Error obteniendo paquete:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// POST /api/paquetes — Crear paquete (admin)
router.post('/', adminAuth, async (req, res) => {
  try {
    const { slug, nombre, emoji, descripcion, tipo_duracion, duracion_horas, precio, capacidad_max, caracteristicas, imagen_url } = req.body;
    if (!nombre || !precio) {
      return res.status(400).json({ message: 'Nombre y precio son obligatorios' });
    }
    const baseSlug = nombre.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const generatedSlug = slug || (baseSlug + '-' + Date.now().toString(36));
    const { rows } = await pool.query(
      `INSERT INTO paquetes (slug, nombre, emoji, descripcion, tipo_duracion, duracion_horas, precio, capacidad_max, caracteristicas, imagen_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [generatedSlug, nombre, emoji || '🎉', descripcion || '', tipo_duracion || 'horas', duracion_horas || null, precio, capacidad_max || 50, JSON.stringify(caracteristicas || []), imagen_url || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Error creando paquete:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// PATCH /api/paquetes/:id — Actualizar paquete (admin)
router.patch('/:id', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, emoji, descripcion, tipo_duracion, duracion_horas, precio, capacidad_max, caracteristicas, activo, imagen_url } = req.body;
    const { rows } = await pool.query(
      `UPDATE paquetes SET
        nombre = COALESCE($1, nombre),
        emoji = COALESCE($2, emoji),
        descripcion = COALESCE($3, descripcion),
        tipo_duracion = COALESCE($4, tipo_duracion),
        duracion_horas = COALESCE($5, duracion_horas),
        precio = COALESCE($6, precio),
        capacidad_max = COALESCE($7, capacidad_max),
        caracteristicas = COALESCE($8, caracteristicas),
        activo = COALESCE($9, activo),
        imagen_url = COALESCE($10, imagen_url),
        actualizado_en = CURRENT_TIMESTAMP
      WHERE id = $11 RETURNING *`,
      [nombre, emoji, descripcion, tipo_duracion, duracion_horas, precio, capacidad_max, caracteristicas ? JSON.stringify(caracteristicas) : null, activo, imagen_url, id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Paquete no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error actualizando paquete:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

module.exports = router;
