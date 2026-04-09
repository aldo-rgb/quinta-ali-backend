const { Router } = require('express');
const router = Router();
const pool = require('../db/connection');
const adminAuth = require('../middleware/adminAuth');

/**
 * GET /api/reviews
 * Obtiene la lista de reviews cacheadas (para editar desde admin)
 */
router.get('/', adminAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, autor_nombre, rating, texto_en, texto_es, texto_es_manual, url_foto, activo
       FROM google_reviews_cache
       ORDER BY creado_en DESC
       LIMIT 20`
    );
    res.json(rows);
  } catch (err) {
    console.error('Error fetching reviews:', err);
    res.status(500).json({ error: 'Error al obtener reviews' });
  }
});

/**
 * PATCH /api/reviews/:id
 * Actualiza la traducción manual de una review
 */
router.patch('/:id', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { texto_es_manual, activo } = req.body;

    const updateFields = [];
    const updateValues = [];
    let paramIndex = 1;

    if (texto_es_manual !== undefined) {
      updateFields.push(`texto_es_manual = $${paramIndex++}`);
      updateValues.push(texto_es_manual);
    }

    if (activo !== undefined) {
      updateFields.push(`activo = $${paramIndex++}`);
      updateValues.push(activo);
    }

    updateFields.push(`actualizado_en = NOW()`);

    if (updateFields.length === 1) {
      // Solo actualizado_en
      updateFields.pop();
      updateFields.push(`actualizado_en = NOW()`);
    }

    updateValues.push(id);

    const { rows } = await pool.query(
      `UPDATE google_reviews_cache
       SET ${updateFields.join(', ')}
       WHERE id = $${paramIndex}
       RETURNING id, autor_nombre, texto_es, texto_es_manual, activo`,
      updateValues
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Review no encontrada' });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error('Error updating review:', err);
    res.status(500).json({ error: 'Error al actualizar review' });
  }
});

/**
 * POST /api/reviews/cache
 * Cachea las reviews de Google en la BD para facilitar ediciones
 * (Llamado internamente por el endpoint de google-reviews)
 */
router.post('/cache', async (req, res) => {
  try {
    const { reviews } = req.body;

    if (!Array.isArray(reviews)) {
      return res.status(400).json({ error: 'reviews debe ser un array' });
    }

    for (const review of reviews) {
      const { nombre, rating, texto_en, texto_es, foto, fecha } = review;

      // Generar ID único basado en nombre + rating + fecha
      const externalId = `google_${nombre}_${rating}_${fecha}`;

      await pool.query(
        `INSERT INTO google_reviews_cache (autor_nombre, rating, texto_en, texto_es, url_foto, externo_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (externo_id) DO UPDATE
         SET texto_es = $4, actualizado_en = NOW()`,
        [nombre, rating, texto_en, texto_es, foto, externalId]
      );
    }

    res.json({ success: true, cached: reviews.length });
  } catch (err) {
    console.error('Error caching reviews:', err);
    res.status(500).json({ error: 'Error al cachear reviews' });
  }
});

module.exports = router;
