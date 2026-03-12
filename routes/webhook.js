const express = require('express');
const router = express.Router();
const whatsapp = require('../services/whatsapp');
const aiBot = require('../services/aiBot');

/**
 * GET /api/webhook
 * Verificación del webhook de WhatsApp (Meta Cloud API)
 */
router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || 'quinta-ali-verify-2024';

  if (mode === 'subscribe' && token === verifyToken) {
    return res.status(200).send(challenge);
  }

  console.warn('⚠️  Verificación de webhook fallida');
  return res.sendStatus(403);
});

/**
 * POST /api/webhook
 * Recibe mensajes entrantes de WhatsApp
 */
router.post('/', async (req, res) => {
  // Siempre responder 200 rápido para evitar reintentos de Meta
  res.sendStatus(200);

  try {
    const body = req.body;

    // Validar estructura del webhook
    if (
      !body?.object ||
      !body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]
    ) {
      return; // No es un mensaje, puede ser status update
    }

    const change = body.entry[0].changes[0].value;
    const mensaje = change.messages[0];
    const telefono = mensaje.from; // Número del remitente

    // Solo procesar mensajes de texto
    if (mensaje.type !== 'text') {
      await whatsapp.enviarMensaje(
        telefono,
        'Por el momento solo puedo procesar mensajes de texto. ¿Podrías describir tu situación con palabras? 📝'
      );
      return;
    }

    const textoUsuario = mensaje.text.body;

    // Detectar si es una respuesta de calificación (1-5) para el sistema de reseñas
    const textoLimpio = textoUsuario.trim();
    if (/^[1-5]$/.test(textoLimpio)) {
      try {
        const resenaRes = await fetch(`http://localhost:${process.env.PORT || 3001}/api/resenas/procesar-respuesta`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ telefono, calificacion: textoLimpio }),
        });
        const data = await resenaRes.json();
        if (data.procesado) {
          return; // Ya se envió respuesta desde la ruta de reseñas
        }
      } catch (e) {
        // No era una reseña, continuar con el bot normal
      }
    }

    // Procesar con IA y responder
    const respuesta = await aiBot.procesarMensaje(telefono, textoUsuario);

    await whatsapp.enviarMensaje(telefono, respuesta);
  } catch (err) {
    console.error('Error procesando webhook:', err.message);
  }
});

module.exports = router;
