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

/**
 * Enviar "Pase de Abordar" digital al cliente tras pago completo.
 * @param {object} datos - Toda la info de la reservación pagada
 */
async function enviarPaseAbordar(datos) {
  const {
    telefono,
    nombre,
    fechaEvento,
    horaInicio,
    horaFin,
    capacidad,
    codigoPin,
    montoTotal,
    paqueteNombre,
    reservacionId,
  } = datos;

  const GOOGLE_MAPS_LINK = process.env.GOOGLE_MAPS_LINK || 'https://maps.app.goo.gl/quintadeali';
  const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

  // Formatear fecha legible (ej: "Sábado 14 de Marzo 2026")
  const diasSemana = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const d = new Date(fechaEvento + 'T12:00:00');
  const fechaFormateada = `${diasSemana[d.getDay()]} ${d.getDate()} de ${meses[d.getMonth()]} ${d.getFullYear()}`;

  // Hora de salida formateada
  const horaSalida = horaFin === '23:59' ? '11:00 AM (día siguiente)' : `${horaFin} hrs`;

  // PIN formateado con espacios para legibilidad
  const pinFormateado = codigoPin ? `[ ${codigoPin.split('').join(' ')} ]` : '[Pendiente]';

  const montoFormateado = `$${Number(montoTotal).toLocaleString('es-MX')} MXN`;

  const linkPase = `${FRONTEND_URL}/pago/exitoso?reservacion_id=${reservacionId}`;

  const texto =
    `¡Hola, ${nombre}! 🎉\n` +
    `Tu evento en *La Quinta de Alí* está *100% confirmado y liquidado*. ¡Gracias por confiar en nosotros para tus momentos premium! 🌴\n\n` +
    `Aquí tienes tu *Pase de Abordar* oficial. Guárdalo muy bien:\n\n` +
    `🗓 *Fecha de tu evento:* ${fechaFormateada}\n` +
    `🕒 *Horario:* Entrada ${horaInicio} hrs — Salida ${horaSalida}\n` +
    `👥 *Capacidad:* Hasta ${capacidad} invitados\n` +
    `📍 *Ubicación exacta (Google Maps):*\n${GOOGLE_MAPS_LINK}\n\n` +
    `🔐 *TU ACCESO VIP:*\n` +
    `Tu código de acceso personal es: *${pinFormateado}*\n` +
    `_(Este PIN desbloqueará la entrada únicamente durante el horario de tu evento. Compártelo solo con tus invitados de confianza)._\n\n` +
    `📄 *Recibo y Reglamento:*\n` +
    `Tu pago por *${montoFormateado}* ha sido procesado con éxito. Puedes ver tu pase de abordar digital y los detalles de tu reservación en:\n` +
    `${linkPase}\n\n` +
    `💡 *¿Olvidaste algo?* Si necesitas agregar bolsas de hielo, carbón o leña para el asador, puedes hacerlo directo en este chat hasta 24 horas antes de tu evento.\n\n` +
    `¡Nos vemos pronto para celebrar en grande! 🥂\n` +
    `— El equipo de *La Quinta de Alí*`;

  return enviarMensaje(telefono, texto);
}

module.exports = {
  enviarMensaje,
  enviarBotones,
  enviarLista,
  notificarNuevaReservacion,
  confirmarReservacionCliente,
  enviarPaseAbordar,
};
