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

    if (!GOOGLE_PLACES_API_KEY) {
      return res.status(400).json({
        error: 'Falta variable de entorno: GOOGLE_PLACES_API_KEY',
        message: 'Configura GOOGLE_PLACES_API_KEY en .env para traer reviews de Google Maps'
      });
    }

    let placeDetails = null;

    // Intentar con Place ID si está disponible
    if (GOOGLE_PLACE_ID) {
      try {
        const response = await fetch(
          `https://maps.googleapis.com/maps/api/place/details/json?` +
          `place_id=${GOOGLE_PLACE_ID}&` +
          `key=${GOOGLE_PLACES_API_KEY}&` +
          `fields=reviews,rating,name`
        );

        if (response.ok) {
          const data = await response.json();
          if (data.status === 'OK') {
            placeDetails = data.result;
          }
        }
      } catch (err) {
        console.log('Place ID no funcionó, usando Nearby Search:', err.message);
      }
    }

    // Si Place ID no funciona, usar Nearby Search con coordenadas
    if (!placeDetails) {
      const lat = 25.4572787;
      const lng = -100.1508463;
      const radius = 50; // 50 metros

      const response = await fetch(
        `https://maps.googleapis.com/maps/api/place/nearbysearch/json?` +
        `location=${lat},${lng}&` +
        `radius=${radius}&` +
        `key=${GOOGLE_PLACES_API_KEY}&` +
        `name=quinta+de+ali`
      );

      if (!response.ok) {
        throw new Error(`Google API error: ${response.status}`);
      }

      const searchData = await response.json();

      if (searchData.status !== 'OK' || !searchData.results || searchData.results.length === 0) {
        return res.status(400).json({
          error: searchData.status,
          message: 'No se encontró el lugar de La Quinta de Alí en Google Maps',
          suggestion: 'Verifica que el lugar esté cargado en Google Maps'
        });
      }

      // Obtener detalles del primer resultado
      const foundPlace = searchData.results[0];
      const detailsResponse = await fetch(
        `https://maps.googleapis.com/maps/api/place/details/json?` +
        `place_id=${foundPlace.place_id}&` +
        `key=${GOOGLE_PLACES_API_KEY}&` +
        `fields=reviews,rating,name`
      );

      if (!detailsResponse.ok) {
        throw new Error(`Google Details API error: ${detailsResponse.status}`);
      }

      const detailsData = await detailsResponse.json();

      if (detailsData.status !== 'OK') {
        return res.status(400).json({
          error: detailsData.status,
          message: 'No se pudieron obtener detalles del lugar'
        });
      }

      placeDetails = detailsData.result;
    }

    if (!placeDetails) {
      return res.status(400).json({
        error: 'ERROR_OBTENER_LUGAR',
        message: 'No se pudo obtener información de La Quinta de Alí'
      });
    }

    // Procesar reviews
    let reviews = (placeDetails.reviews || [])
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
      rating_promedio: placeDetails.rating,
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
