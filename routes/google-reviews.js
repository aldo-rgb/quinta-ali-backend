const express = require('express');
const router = express.Router();

/**
 * Traduce un texto al español usando múltiples APIs en fallback
 * Intenta: Google Cloud > MyMemory > Bing > Devuelve original
 */
async function traducirAlEspanol(texto) {
  if (!texto || texto.trim().length === 0) return null;

  // Opción 1: Google Cloud Translation (si existe API key)
  if (process.env.GOOGLE_CLOUD_TRANSLATE_API_KEY) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      const response = await fetch('https://translation.googleapis.com/language/translate/v2', {
        method: 'POST',
        signal: controller.signal,
        body: JSON.stringify({
          q: texto,
          target: 'es'
        }),
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': process.env.GOOGLE_CLOUD_TRANSLATE_API_KEY
        }
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        if (data.data?.translations?.[0]?.translatedText?.trim()) {
          console.log('✓ Traducción con Google Cloud Translation');
          return data.data.translations[0].translatedText;
        }
      }
    } catch (err) {
      console.error('Google Cloud Translation error:', err.message);
    }
  }

  // Opción 2: MyMemory API
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(texto)}&langpair=en|es`,
      {
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      }
    );

    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();
      const translated = data.responseData?.translatedText?.trim();
      if (translated && translated !== texto.trim()) {
        console.log('✓ Traducción con MyMemory');
        return translated;
      }
    }
  } catch (err) {
    console.error('MyMemory error:', err.message);
  }

  // Opción 3: Bing Translator (sin API key)
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(texto)}&langpair=en|es&de=user@ddg.com`,
      {
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      }
    );

    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();
      const translated = data.responseData?.translatedText?.trim();
      if (translated && translated !== texto.trim()) {
        console.log('✓ Traducción alternativa');
        return translated;
      }
    }
  } catch (err) {
    console.error('Alternative translation error:', err.message);
  }

  // Si todas las APIs fallan, retornar el texto original en lugar de null
  // Así el frontend mostrará algo en lugar de "Próximamente"
  console.warn('⚠️ Traducción no disponible para:', texto.substring(0, 50));
  return texto; // Devolver el original en inglés en vez de null
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

    // Procesar reviews - filtrar nombres incompletos/cortos
    let reviews = (placeDetails.reviews || [])
      .filter(r => r.rating >= 4) // Solo reviews de 4+ estrellas
      .filter(r => r.author_name && r.author_name.trim().length > 2) // Excluir nombres muy cortos
      .slice(0, 6) // Máximo 6 reviews
      .map(r => ({
        nombre: r.author_name,
        rating: r.rating,
        texto_en: r.text, // Texto original en inglés
        texto_es: r.text, // Se reemplazará con traducción
        foto: r.profile_photo_url,
        fecha: r.time
      }));

    // Traducir reviews al español en paralelo
    reviews = await Promise.all(
      reviews.map(async (review) => {
        try {
          const traducido = await traducirAlEspanol(review.texto_en);
          // Si la traducción no es null y es diferente del original, usarla
          if (traducido && traducido !== review.texto_en) {
            return { ...review, texto_es: traducido };
          }
          // Si falla o es igual al original, dejar texto_es como null para que frontend sepa que no hay traducción
          return { ...review, texto_es: null };
        } catch (err) {
          console.error('Failed to translate review:', err.message);
          return { ...review, texto_es: null };
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
