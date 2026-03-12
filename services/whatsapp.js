const axios = require('axios');

const WHATSAPP_API_URL = 'https://graph.facebook.com/v22.0';
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const API_TOKEN = process.env.WHATSAPP_API_TOKEN;

/**
 * Enviar mensaje de texto simple por WhatsApp
 */
async function enviarMensaje(telefono, texto) {
  if (!PHONE_NUMBER_ID || !API_TOKEN) {
    console.warn('⚠️  WhatsApp no configurado. Mensaje no enviado:', texto);
    return null;
  }

  try {
    const res = await axios.post(
      `${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to: telefono,
        type: 'text',
        text: { body: texto },
      },
      {
        headers: {
          Authorization: `Bearer ${API_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );
    return res.data;
  } catch (err) {
    console.error('Error enviando WhatsApp:', err.response?.data || err.message);
    return null;
  }
}

/**
 * Enviar mensaje interactivo con botones
 */
async function enviarBotones(telefono, textoHeader, textoBody, botones) {
  if (!PHONE_NUMBER_ID || !API_TOKEN) {
    console.warn('⚠️  WhatsApp no configurado.');
    return null;
  }

  try {
    const res = await axios.post(
      `${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to: telefono,
        type: 'interactive',
        interactive: {
          type: 'button',
          header: { type: 'text', text: textoHeader },
          body: { text: textoBody },
          action: {
            buttons: botones.map((b, i) => ({
              type: 'reply',
              reply: { id: b.id || `btn_${i}`, title: b.titulo },
            })),
          },
        },
      },
      {
        headers: {
          Authorization: `Bearer ${API_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );
    return res.data;
  } catch (err) {
    console.error('Error enviando botones WhatsApp:', err.response?.data || err.message);
    return null;
  }
}

/**
 * Enviar mensaje con lista de opciones
 */
async function enviarLista(telefono, textoHeader, textoBody, botonTexto, secciones) {
  if (!PHONE_NUMBER_ID || !API_TOKEN) {
    console.warn('⚠️  WhatsApp no configurado.');
    return null;
  }

  try {
    const res = await axios.post(
      `${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to: telefono,
        type: 'interactive',
        interactive: {
          type: 'list',
          header: { type: 'text', text: textoHeader },
          body: { text: textoBody },
          action: {
            button: botonTexto,
            sections: secciones,
          },
        },
      },
      {
        headers: {
          Authorization: `Bearer ${API_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );
    return res.data;
  } catch (err) {
    console.error('Error enviando lista WhatsApp:', err.response?.data || err.message);
    return null;
  }
}

/**
 * Notificar al admin cuando llega una nueva reservación
 */
async function notificarNuevaReservacion(reservacion, clienteNombre, paqueteNombre) {
  const adminTelefono = process.env.ADMIN_WHATSAPP || '528149060693';
  const texto = `🔔 *Nueva Reservación #${reservacion.id}*\n\n` +
    `👤 Cliente: ${clienteNombre}\n` +
    `📦 Paquete: ${paqueteNombre}\n` +
    `📅 Fecha: ${reservacion.fecha_evento}\n` +
    `🕐 Hora: ${reservacion.hora_inicio}\n` +
    `💰 Monto: $${Number(reservacion.monto_total).toLocaleString('es-MX')} MXN\n\n` +
    `Entra al panel admin para confirmar o cancelar.`;

  return enviarMensaje(adminTelefono, texto);
}

/**
 * Enviar confirmación al cliente después de reservar
 */
async function confirmarReservacionCliente(telefono, nombre, paquete, fecha, hora) {
  const texto = `✅ *¡Hola ${nombre}!*\n\n` +
    `Tu reservación en *La Quinta de Alí* ha sido registrada:\n\n` +
    `📦 ${paquete}\n` +
    `📅 ${fecha}\n` +
    `🕐 ${hora} hrs\n\n` +
    `Te contactaremos pronto para confirmar tu pago. ¡Gracias! 🎉`;

  return enviarMensaje(telefono, texto);
}

module.exports = {
  enviarMensaje,
  enviarBotones,
  enviarLista,
  notificarNuevaReservacion,
  confirmarReservacionCliente,
};
