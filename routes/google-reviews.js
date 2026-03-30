const express = require('express');
const router = express.Router();

/**
 * Traduce un texto usando MyMemory API (gratuita)
 */
async function traducirAlEspanol(texto) {
  try {
    const response = await fetch(
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(texto)}&langpair=en|es`
    );
    const data = await response.json();
    if (data.responseStatus === 200 && data.responseData.translatedText) {
      return data.responseData.translatedText;
    }
  } catch (err) {
    console.error('Error traducing text:', err.message);
  }
  return texto; // Retornar original si falla la traducción
}

/**
 * GET /api/google-reviews
 * Obtiene las reviews de Google Places API (traducidas al español)
 * Retorna array de reviews con: nombre, rating, texto, foto
 */
router.get('/', async (req, res) => {
  try {
    const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
    const GOOGLE_PLACE_ID = process.env.GOOGLE_PLACE_ID;

    if (!GOOGLE_PLACES_API_KEY || !GOOGLE_PLACE_ID) {
      return res.status(400).json({
        error: 'Faltan variables de entorno: GOOGLE_PLACES_API_KEY o GOOGLE_PLACE_ID',
        message: 'Configura estas variables en .env para traer reviews de Google Maps'
      });
    }

    // Llamar a Google Places API
    const response = await fetch(
      `https://maps.googleapis.com/maps/api/place/details/json?` +
      `place_id=${GOOGLE_PLACE_ID}&` +
      `key=${GOOGLE_PLACES_API_KEY}&` +
      `fields=reviews,rating,name`
    );

    if (!response.ok) {
      throw new Error(`Google API error: ${response.status}`);
    }

    const data = await response.json();

    if (data.status !== 'OK') {
      return res.status(400).json({
        error: data.status,
        message: data.error_message || 'No se pudo obtener information de Google Places'
      });
    }

    // Procesar reviews
    let reviews = (data.result.reviews || [])
      .filter(r => r.rating >= 4) // Solo reviews de 4+ estrellas
      .slice(0, 6) // Máximo 6 reviews
      .map(r => ({
        nombre: r.author_name,
        rating: r.rating,
        texto: r.text,
        foto: r.profile_photo_url,
        fecha: r.time
      }));

    // Traducir textos en paralelo (con timeout)
    reviews = await Promise.all(
      reviews.map(async (review) => {
        try {
          const traducido = await Promise.race([
            traducirAlEspanol(review.texto),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000))
          ]);
          return { ...review, texto: traducido };
        } catch (err) {
          // Si falla o timeout, devolver el original
          return review;
        }
      })
    );

    res.json({
      total: reviews.length,
      rating_promedio: data.result.rating,
      reviews: reviews
    });
  } catch (err) {
    console.error('Error en /api/google-reviews:', err);
    res.status(500).json({
      error: 'Error interno del servidor',
      message: err.message
    });
  }
});

module.exports = router;
        fecha: r.time,
      }));

    res.json({
      total: reviews.length,
      rating_promedio: data.result.rating,
      reviews
    });

  } catch (error) {
    console.error('Error en /api/google-reviews:', error.message);
    res.status(500).json({
      error: 'Error del servidor',
      message: error.message
    });
  }
});

module.exports = router;
