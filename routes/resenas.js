const { Router } = require('express');
const pool = require('../db/connection');
const adminAuth = require('../middleware/adminAuth');
const whatsapp = require('../services/whatsapp');

const router = Router();

const GOOGLE_MAPS_REVIEW_LINK = process.env.GOOGLE_MAPS_REVIEW_LINK || 'https://g.page/r/quinta-de-ali/review';

// GET /api/resenas — Listar todas las reseñas (admin)
router.get('/', adminAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT re.*, c.nombre AS cliente_nombre, c.apellido AS cliente_apellido,
              c.telefono, r.fecha_evento, p.nombre AS paquete_nombre
       FROM resenas re
       JOIN reservaciones r ON re.reservacion_id = r.id
       JOIN clientes c ON re.cliente_id = c.id
       JOIN paquetes p ON r.paquete_id = p.id
       ORDER BY re.creado_en DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error('Error listando reseñas:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

/**
 * POST /api/resenas/enviar-solicitud — Envía solicitud de reseña por WhatsApp
 * Se llama automáticamente 1 día después de que el evento termina
 */
router.post('/enviar-solicitud', async (req, res) => {
  try {
    const { reservacion_id } = req.body;

    const result = await pool.query(
      `SELECT r.id, r.fecha_evento, c.nombre, c.telefono, c.whatsapp, c.id as cliente_id
       FROM reservaciones r
       JOIN clientes c ON r.cliente_id = c.id
       WHERE r.id = $1 AND r.estado IN ('completada', 'pagada')`,
      [reservacion_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Reservación no encontrada o no completada' });
    }

    const { nombre, telefono, whatsapp: whatsappNum, cliente_id } = result.rows[0];
    const tel = whatsappNum || telefono;

    if (!tel) {
      return res.status(400).json({ message: 'Cliente no tiene número de teléfono' });
    }

    // Crear registro de reseña
    await pool.query(
      `INSERT INTO resenas (reservacion_id, cliente_id, mensaje_enviado)
       VALUES ($1, $2, TRUE)
       ON CONFLICT (reservacion_id) DO UPDATE SET mensaje_enviado = TRUE, creado_en = NOW()`,
      [reservacion_id, cliente_id]
    );

    // Enviar lista interactiva de calificación por WhatsApp
    const telFormateado = tel.startsWith('52') ? tel : `52${tel.replace(/\D/g, '')}`;
    await whatsapp.enviarLista(
      telFormateado,
      '⭐ ¿Cómo estuvo tu evento?',
      `¡Hola ${nombre}! 👋 Esperamos que te hayas recuperado de la fiesta y que tu evento haya sido espectacular.\n\nPara nosotros es súper importante mejorar. ¿Qué calificación le darías a tu experiencia en La Quinta de Alí?`,
      'Calificar ⭐',
      [{
        title: 'Tu calificación',
        rows: [
          { id: 'cal_5', title: '⭐⭐⭐⭐⭐ 5 Estrellas', description: '¡Increíble, vuelvo pronto!' },
          { id: 'cal_4', title: '⭐⭐⭐⭐ 4 Estrellas', description: 'Muy bien, detalles mínimos.' },
          { id: 'cal_3', title: '⭐⭐⭐ 3 Estrellas', description: 'Regular, hay cosas por mejorar.' },
          { id: 'cal_2', title: '⭐⭐ 2 Estrellas', description: 'Mala experiencia.' },
          { id: 'cal_1', title: '⭐ 1 Estrella', description: 'Pésimo.' },
        ],
      }]
    );

    res.json({ message: 'Solicitud de reseña enviada', telefono: telFormateado });
  } catch (err) {
    console.error('Error enviando solicitud de reseña:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

/**
 * POST /api/resenas/procesar-respuesta — Procesa la calificación del cliente
 * Se llama desde el webhook de WhatsApp
 */
router.post('/procesar-respuesta', async (req, res) => {
  try {
    const { telefono, calificacion } = req.body;

    if (!telefono || !calificacion) {
      return res.status(400).json({ message: 'Faltan campos: telefono, calificacion' });
    }

    const cal = parseInt(calificacion);
    if (isNaN(cal) || cal < 1 || cal > 5) {
      return res.status(400).json({ message: 'Calificación debe ser entre 1 y 5' });
    }

    // Buscar la reseña pendiente más reciente de este número
    const telLimpio = telefono.replace(/\D/g, '');
    const result = await pool.query(
      `UPDATE resenas SET calificacion = $1, respondido_en = NOW()
       WHERE id = (
         SELECT re.id FROM resenas re
         JOIN clientes c ON re.cliente_id = c.id
         WHERE (c.telefono LIKE $2 OR c.whatsapp LIKE $2)
           AND re.calificacion IS NULL
         ORDER BY re.creado_en DESC LIMIT 1
       ) RETURNING *`,
      [cal, `%${telLimpio.slice(-10)}`]
    );

    if (result.rows.length === 0) {
      return res.json({ procesado: false, message: 'No se encontró reseña pendiente' });
    }

    const resena = result.rows[0];

    // Obtener nombre del cliente
    const clienteRes = await pool.query(
      'SELECT c.nombre FROM resenas re JOIN clientes c ON re.cliente_id = c.id WHERE re.id = $1',
      [resena.id]
    );
    const nombreCliente = clienteRes.rows[0]?.nombre || 'amigo';

    if (cal >= 4) {
      // ESCENARIO A: Clientes Felices (Promotores)
      await pool.query(
        'UPDATE resenas SET link_enviado = TRUE WHERE id = $1',
        [resena.id]
      );
      await whatsapp.enviarMensaje(
        telefono,
        `¡Qué alegría leer esto, ${nombreCliente}! 😍 Nos motiva muchísimo.\n\n` +
        `¿Nos harías un favor enorme? Ayúdanos dejando tu reseña en Google Maps para que más familias nos conozcan. Te toma 10 segundos:\n\n` +
        `👉 ${GOOGLE_MAPS_REVIEW_LINK}\n\n` +
        `¡Te esperamos en tu próxima carne asada con un descuento especial! 🥩🔥`
      );
    } else {
      // ESCENARIO B: Clientes Inconformes (Detractores)
      await pool.query(
        'UPDATE resenas SET alerta_enviada = TRUE WHERE id = $1',
        [resena.id]
      );

      // Mensaje empático al cliente — NO se le da link de Google
      await whatsapp.enviarMensaje(
        telefono,
        `Hola ${nombreCliente}, lamentamos muchísimo que no hayamos cumplido tus expectativas al 100%. 😔\n\n` +
        `El dueño revisa personalmente estos casos. Por favor, cuéntanos brevemente qué falló para solucionarlo y que no vuelva a pasar.\n\n` +
        `Puedes escribirlo aquí mismo en este chat. Tu mensaje será leído personalmente. 🙏`
      );

      // Alerta silenciosa al jefe
      const adminTelefono = process.env.ADMIN_WHATSAPP || '528149060693';
      await whatsapp.enviarMensaje(
        adminTelefono,
        `🚨 *ALERTA ROJA: Reseña negativa*\n\n` +
        `El cliente *${nombreCliente}* calificó con *${cal}/5* ⭐\n` +
        `📱 Teléfono: ${telefono}\n` +
        `📋 Reservación #${resena.reservacion_id}\n\n` +
        `⚡ *¡Háblale antes de que vaya a Google/Facebook!*`
      );
    }

    res.json({ procesado: true, calificacion: cal, positiva: cal >= 4 });
  } catch (err) {
    console.error('Error procesando respuesta de reseña:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

/**
 * POST /api/resenas/cron — Busca reservaciones completadas ayer y envía solicitudes
 * Llamar desde un cron job diario a las 12:00 PM
 */
router.post('/cron', async (req, res) => {
  try {
    const ayer = new Date();
    ayer.setDate(ayer.getDate() - 1);
    const fechaAyer = ayer.toISOString().split('T')[0];

    const { rows } = await pool.query(
      `SELECT r.id FROM reservaciones r
       LEFT JOIN resenas re ON r.id = re.reservacion_id
       WHERE r.fecha_evento = $1
         AND r.estado IN ('completada', 'pagada')
         AND re.id IS NULL`,
      [fechaAyer]
    );

    let enviados = 0;
    for (const row of rows) {
      try {
        const response = await fetch(`http://localhost:${process.env.PORT || 3001}/api/resenas/enviar-solicitud`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reservacion_id: row.id }),
        });
        if (response.ok) enviados++;
      } catch (e) {
        console.error(`Error enviando reseña para reservación ${row.id}:`, e.message);
      }
    }

    res.json({ message: `Cron ejecutado. ${enviados} solicitudes enviadas de ${rows.length} encontradas.` });
  } catch (err) {
    console.error('Error en cron de reseñas:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

module.exports = router;
