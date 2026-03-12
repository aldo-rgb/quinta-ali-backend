const OpenAI = require('openai');
const whatsapp = require('./whatsapp');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Números del staff por categoría
const STAFF = {
  limpieza: process.env.STAFF_LIMPIEZA || '528149060693',
  mantenimiento: process.env.STAFF_MANTENIMIENTO || '528149060693',
  emergencia: process.env.STAFF_EMERGENCIA || '528149060693',
};

const SYSTEM_PROMPT = `Eres el asistente virtual de La Quinta de Alí, un espacio de eventos en Santiago, Nuevo León.

Tu rol es atender reportes de problemas de los huéspedes que están en la quinta.

INSTRUCCIONES:
1. Saluda con empatía y calidez. Usa un tono amable y profesional.
2. Si el mensaje del huésped describe un problema, clasifícalo en una de estas categorías:
   - Limpieza: basura, suciedad, baños sucios, toallas, sábanas, etc.
   - Mantenimiento: luces fundidas, llaves que gotean, aire acondicionado, puertas, equipos rotos, etc.
   - Emergencia: fuga de gas, inundación, accidente, incendio, problemas eléctricos graves, seguridad, etc.
3. Responde al huésped confirmando que entendiste su problema y que ya se notificó al equipo.
4. Si el mensaje NO es un reporte de problema (saludo general, pregunta, etc.), responde amablemente y pregunta en qué puedes ayudar.
5. Siempre responde en español.
6. Mantén las respuestas breves (máximo 3 oraciones).

Cuando identifiques un problema, USA la función notificar_staff para alertar al equipo.`;

const tools = [
  {
    type: 'function',
    function: {
      name: 'notificar_staff',
      description: 'Notifica al personal de La Quinta sobre un problema reportado por un huésped',
      parameters: {
        type: 'object',
        properties: {
          categoria: {
            type: 'string',
            enum: ['limpieza', 'mantenimiento', 'emergencia'],
            description: 'Categoría del problema reportado',
          },
          descripcion: {
            type: 'string',
            description: 'Descripción breve del problema para el staff',
          },
          urgencia: {
            type: 'string',
            enum: ['baja', 'media', 'alta'],
            description: 'Nivel de urgencia del problema',
          },
        },
        required: ['categoria', 'descripcion', 'urgencia'],
      },
    },
  },
];

// Almacenar historial de conversaciones en memoria (por número de teléfono)
const conversaciones = new Map();
const MAX_HISTORIAL = 10;

function getHistorial(telefono) {
  if (!conversaciones.has(telefono)) {
    conversaciones.set(telefono, []);
  }
  return conversaciones.get(telefono);
}

function agregarMensaje(telefono, role, content) {
  const historial = getHistorial(telefono);
  historial.push({ role, content });
  // Limitar historial
  if (historial.length > MAX_HISTORIAL) {
    historial.splice(0, historial.length - MAX_HISTORIAL);
  }
}

/**
 * Notifica al personal correspondiente sobre un problema
 */
async function notificarStaff(categoria, descripcion, urgencia, telefonoHuesped) {
  const emojis = { limpieza: '🧹', mantenimiento: '🔧', emergencia: '🚨' };
  const niveles = { baja: '🟢 Baja', media: '🟡 Media', alta: '🔴 Alta' };

  const staffTelefono = STAFF[categoria];
  const emoji = emojis[categoria] || '📋';
  const nivel = niveles[urgencia] || urgencia;

  const mensaje =
    `${emoji} *REPORTE: ${categoria.toUpperCase()}*\n\n` +
    `📝 ${descripcion}\n` +
    `⚡ Urgencia: ${nivel}\n` +
    `📱 Huésped: ${telefonoHuesped}\n\n` +
    `Favor de atender lo antes posible.`;

  await whatsapp.enviarMensaje(staffTelefono, mensaje);

  // Si es emergencia, también notificar al admin principal
  if (urgencia === 'alta' || categoria === 'emergencia') {
    const adminTelefono = process.env.ADMIN_WHATSAPP || '528149060693';
    if (adminTelefono !== staffTelefono) {
      await whatsapp.enviarMensaje(adminTelefono, `🚨 *EMERGENCIA EN LA QUINTA*\n\n${mensaje}`);
    }
  }

}

/**
 * Procesa un mensaje entrante y genera respuesta con IA
 */
async function procesarMensaje(telefono, textoUsuario) {
  if (!process.env.OPENAI_API_KEY) {
    console.warn('⚠️  OPENAI_API_KEY no configurada. Bot AI deshabilitado.');
    return 'Gracias por tu mensaje. Un miembro de nuestro equipo te atenderá pronto. 🙏';
  }

  agregarMensaje(telefono, 'user', textoUsuario);

  try {
    const mensajes = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...getHistorial(telefono),
    ];

    const respuesta = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: mensajes,
      tools,
      tool_choice: 'auto',
      max_tokens: 300,
    });

    const mensaje = respuesta.choices[0].message;

    // Procesar tool calls si existen
    if (mensaje.tool_calls && mensaje.tool_calls.length > 0) {
      for (const toolCall of mensaje.tool_calls) {
        if (toolCall.function.name === 'notificar_staff') {
          const args = JSON.parse(toolCall.function.arguments);
          await notificarStaff(args.categoria, args.descripcion, args.urgencia, telefono);
        }
      }

      // Obtener respuesta final del modelo después de ejecutar las funciones
      mensajes.push(mensaje);
      for (const toolCall of mensaje.tool_calls) {
        mensajes.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify({ success: true, message: 'Staff notificado exitosamente' }),
        });
      }

      const respuestaFinal = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: mensajes,
        max_tokens: 300,
      });

      const textoRespuesta = respuestaFinal.choices[0].message.content;
      agregarMensaje(telefono, 'assistant', textoRespuesta);
      return textoRespuesta;
    }

    // Respuesta directa sin tool calls
    const textoRespuesta = mensaje.content;
    agregarMensaje(telefono, 'assistant', textoRespuesta);
    return textoRespuesta;
  } catch (err) {
    console.error('Error en AI bot:', err.message);
    return 'Disculpa, tuvimos un problema procesando tu mensaje. Un miembro de nuestro equipo te atenderá pronto. 🙏';
  }
}

module.exports = { procesarMensaje, notificarStaff };
