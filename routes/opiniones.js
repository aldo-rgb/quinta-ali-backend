/**
 * Reseñas y quejas por QR (/opina).
 *
 * Pública:
 *   POST  /api/opiniones/resena     { calificacion 1-5, comentario?, nombre?, contacto? }
 *   POST  /api/opiniones/queja      { area?, descripcion, contacto? }
 *   GET   /api/opiniones/publicas   reseñas aprobadas para la web, con promedio
 * Admin:
 *   GET   /api/opiniones            todas las reseñas locales
 *   PATCH /api/opiniones/:id        { publicada }
 *
 * Las reseñas son locales por ahora; después se conectan a Google. Una reseña de
 * 1 a 3 estrellas abre además una queja. Las quejas son tickets de servicio: el
 * admin las atiende (PATCH /api/rino/tickets/:id) y Grupo Rino las lee.
 */
const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const pool = require('../db/connection');
const adminAuth = require('../middleware/adminAuth');
const { crearTicket } = require('../services/ticketsServicio');

const router = Router();

const limitador = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { message: 'Demasiados envíos seguidos. Intenta de nuevo en unos minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
});

function texto(valor, max) {
  return String(valor ?? '').trim().slice(0, max);
}

// POST /api/opiniones/resena
router.post('/resena', limitador, async (req, res) => {
  try {
    const calificacion = Number(req.body?.calificacion);
    if (!Number.isInteger(calificacion) || calificacion < 1 || calificacion > 5) {
      return res.status(400).json({ message: 'Elige de 1 a 5 estrellas' });
    }
    const comentario = texto(req.body?.comentario, 2000) || null;
    const nombre = texto(req.body?.nombre, 80) || null;
    const contacto = texto(req.body?.contacto, 160) || null;

    // Una reseña baja también es una queja: alguien tiene que atenderla.
    let ticketId = null;
    if (calificacion <= 3) {
      ticketId = await crearTicket({
        origen: 'resena',
        categoria: `Reseña de ${calificacion} ${calificacion === 1 ? 'estrella' : 'estrellas'}`,
        descripcion: comentario || 'Calificó sin dejar comentario.',
        contacto: [nombre, contacto].filter(Boolean).join(' · ') || null,
      });
    }

    const { rows } = await pool.query(
      `INSERT INTO resenas_locales (calificacion, comentario, nombre, contacto, ticket_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [calificacion, comentario, nombre, contacto, ticketId]
    );
    res.status(201).json({ ok: true, id: rows[0].id, queja: Boolean(ticketId) });
  } catch (err) {
    console.error('Error guardando reseña:', err.message);
    res.status(500).json({ message: 'No se pudo guardar tu reseña' });
  }
});

// POST /api/opiniones/queja
router.post('/queja', limitador, async (req, res) => {
  try {
    const descripcion = texto(req.body?.descripcion, 2000);
    if (!descripcion) return res.status(400).json({ message: 'Cuéntanos qué pasó' });

    const id = await crearTicket({
      origen: 'queja',
      categoria: texto(req.body?.area, 60) || null,
      descripcion,
      contacto: texto(req.body?.contacto, 160) || null,
    });
    res.status(201).json({ ok: true, id });
  } catch (err) {
    console.error('Error guardando queja:', err.message);
    res.status(500).json({ message: 'No se pudo guardar tu queja' });
  }
});

// GET /api/opiniones/publicas — sin contacto: solo lo que se puede mostrar en la web
router.get('/publicas', async (req, res) => {
  try {
    const [lista, stats] = await Promise.all([
      pool.query(
        `SELECT id, calificacion, comentario, COALESCE(nombre, 'Huésped') AS nombre, creado_en
           FROM resenas_locales WHERE publicada
          ORDER BY creado_en DESC LIMIT 30`
      ),
      pool.query(
        `SELECT COUNT(*)::int AS total, ROUND(AVG(calificacion)::numeric, 1)::float AS promedio
           FROM resenas_locales WHERE publicada`
      ),
    ]);
    res.json({ resenas: lista.rows, total: stats.rows[0].total, promedio: stats.rows[0].promedio });
  } catch (err) {
    console.error('Error listando reseñas públicas:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// GET /api/opiniones
router.get('/', adminAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.*, t.estado AS queja_estado
         FROM resenas_locales r
         LEFT JOIN tickets_servicio t ON t.id = r.ticket_id
        ORDER BY r.creado_en DESC
        LIMIT 200`
    );
    res.json(rows);
  } catch (err) {
    console.error('Error listando reseñas locales:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// PATCH /api/opiniones/:id  { publicada }
router.patch('/:id', adminAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || typeof req.body?.publicada !== 'boolean') {
    return res.status(400).json({ message: 'Manda publicada como true o false' });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE resenas_locales SET publicada = $2, revisada_en = NOW() WHERE id = $1 RETURNING *`,
      [id, req.body.publicada]
    );
    if (!rows[0]) return res.status(404).json({ message: 'Reseña no encontrada' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error actualizando reseña local:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

module.exports = router;
