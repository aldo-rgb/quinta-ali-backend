const { Router } = require('express');
const pool = require('../db/connection');
const adminAuth = require('../middleware/adminAuth');
const whatsapp = require('../services/whatsapp');

const router = Router();

/**
 * POST /api/notificaciones/cron — Ejecutar recordatorios automáticos
 * Llamar diariamente (ej: desde un cron job externo o desde el admin)
 * Envía:
 *   - Recordatorio 3 días antes del evento
 *   - Recordatorio 1 día antes del evento
 *   - PIN de acceso el día del evento
 */
router.post('/cron', async (req, res) => {
  try {
    const hoy = new Date();
    const formato = (d) => d.toISOString().split('T')[0];

    const en3dias = new Date(hoy);
    en3dias.setDate(en3dias.getDate() + 3);

    const manana = new Date(hoy);
    manana.setDate(manana.getDate() + 1);

    const fechaHoy = formato(hoy);
    const fecha3 = formato(en3dias);
    const fecha1 = formato(manana);

    let enviados = { recordatorio3: 0, recordatorio1: 0, pinDia: 0 };

    // ── 1) Recordatorios 3 días antes ──
    const { rows: en3 } = await pool.query(
      `SELECT r.id, r.fecha_evento, r.hora_inicio, r.monto_total,
              c.nombre, c.telefono, p.nombre AS paquete_nombre
       FROM reservaciones r
       JOIN clientes c ON r.cliente_id = c.id
       JOIN paquetes p ON r.paquete_id = p.id
       WHERE r.fecha_evento = $1
         AND r.estado NOT IN ('cancelada')
         AND c.telefono IS NOT NULL`,
      [fecha3]
    );

    for (const ev of en3) {
      const tel = ev.telefono.startsWith('52') ? ev.telefono : `52${ev.telefono.replace(/\D/g, '')}`;
      await whatsapp.enviarMensaje(tel,
        `📅 *Recordatorio — 3 días*\n\n` +
        `¡Hola ${ev.nombre}! Tu evento en *La Quinta de Alí* es en 3 días:\n\n` +
        `📦 ${ev.paquete_nombre}\n` +
        `📅 ${ev.fecha_evento}\n` +
        `🕐 ${ev.hora_inicio} hrs\n\n` +
        `¿Tienes todo listo? Si necesitas algo, escríbenos aquí mismo 🙌`
      );
      enviados.recordatorio3++;
    }

    // ── 2) Recordatorios 1 día antes ──
    const { rows: en1 } = await pool.query(
      `SELECT r.id, r.fecha_evento, r.hora_inicio, r.monto_total,
              c.nombre, c.telefono, p.nombre AS paquete_nombre
       FROM reservaciones r
       JOIN clientes c ON r.cliente_id = c.id
       JOIN paquetes p ON r.paquete_id = p.id
       WHERE r.fecha_evento = $1
         AND r.estado NOT IN ('cancelada')
         AND c.telefono IS NOT NULL`,
      [fecha1]
    );

    for (const ev of en1) {
      const tel = ev.telefono.startsWith('52') ? ev.telefono : `52${ev.telefono.replace(/\D/g, '')}`;
      await whatsapp.enviarMensaje(tel,
        `⏰ *Recordatorio — ¡Mañana es tu evento!*\n\n` +
        `¡Hola ${ev.nombre}! Mañana te esperamos en *La Quinta de Alí*:\n\n` +
        `📦 ${ev.paquete_nombre}\n` +
        `📅 ${ev.fecha_evento}\n` +
        `🕐 ${ev.hora_inicio} hrs\n\n` +
        `Recuerda:\n` +
        `• Llega 15 min antes para instalarte\n` +
        `• El código de la cerradura te lo enviamos mañana temprano\n` +
        `• Si tienes dudas escríbenos aquí\n\n` +
        `¡Nos vemos! 🎉`
      );
      enviados.recordatorio1++;
    }

    // ── 3) PIN del día del evento ──
    const { rows: hoyEventos } = await pool.query(
      `SELECT r.id, r.fecha_evento, r.hora_inicio, r.hora_fin,
              c.nombre, c.telefono, p.nombre AS paquete_nombre,
              ca.codigo_pin, ca.valido_desde, ca.valido_hasta
       FROM reservaciones r
       JOIN clientes c ON r.cliente_id = c.id
       JOIN paquetes p ON r.paquete_id = p.id
       LEFT JOIN codigos_acceso ca ON r.id = ca.reservacion_id AND ca.activo = TRUE
       WHERE r.fecha_evento = $1
         AND r.estado NOT IN ('cancelada')
         AND c.telefono IS NOT NULL`,
      [fechaHoy]
    );

    for (const ev of hoyEventos) {
      const tel = ev.telefono.startsWith('52') ? ev.telefono : `52${ev.telefono.replace(/\D/g, '')}`;

      let mensajePin = '';
      if (ev.codigo_pin) {
        mensajePin =
          `\n🔐 *Tu código de acceso:*\n` +
          `\`${ev.codigo_pin}\`\n\n` +
          `Este código funciona desde las ${ev.hora_inicio} hasta las ${ev.hora_fin}.\n` +
          `Solo introdúcelo en la cerradura para entrar.`;
      }

      await whatsapp.enviarMensaje(tel,
        `🎉 *¡Hoy es tu evento!*\n\n` +
        `¡Hola ${ev.nombre}! Hoy te esperamos en *La Quinta de Alí*:\n\n` +
        `📦 ${ev.paquete_nombre}\n` +
        `🕐 ${ev.hora_inicio} hrs` +
        `${mensajePin}\n\n` +
        `📍 Dirección: La Quinta de Alí\n\n` +
        `¡Que la pasen increíble! 🎊`
      );
      enviados.pinDia++;
    }

    res.json({
      message: 'Notificaciones enviadas',
      fecha: fechaHoy,
      enviados,
    });
  } catch (err) {
    console.error('Error en cron de notificaciones:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

/**
 * POST /api/notificaciones/enviar-pin — Enviar PIN manualmente a un cliente
 */
router.post('/enviar-pin', async (req, res) => {
  try {
    const { reservacion_id } = req.body;
    if (!reservacion_id) return res.status(400).json({ message: 'reservacion_id es obligatorio' });

    const { rows } = await pool.query(
      `SELECT r.hora_inicio, r.hora_fin, r.fecha_evento,
              c.nombre, c.telefono, p.nombre AS paquete_nombre,
              ca.codigo_pin
       FROM reservaciones r
       JOIN clientes c ON r.cliente_id = c.id
       JOIN paquetes p ON r.paquete_id = p.id
       LEFT JOIN codigos_acceso ca ON r.id = ca.reservacion_id AND ca.activo = TRUE
       WHERE r.id = $1`,
      [reservacion_id]
    );

    if (rows.length === 0) return res.status(404).json({ message: 'Reservación no encontrada' });

    const ev = rows[0];
    if (!ev.telefono) return res.status(400).json({ message: 'Cliente sin número de teléfono' });
    if (!ev.codigo_pin) return res.status(400).json({ message: 'No hay PIN generado para esta reservación' });

    const tel = ev.telefono.startsWith('52') ? ev.telefono : `52${ev.telefono.replace(/\D/g, '')}`;

    await whatsapp.enviarMensaje(tel,
      `🔐 *Tu código de acceso — La Quinta de Alí*\n\n` +
      `Hola ${ev.nombre}, aquí tienes tu PIN:\n\n` +
      `🔑 *${ev.codigo_pin}*\n\n` +
      `📅 ${ev.fecha_evento}\n` +
      `🕐 Válido de ${ev.hora_inicio} a ${ev.hora_fin}\n\n` +
      `Introdúcelo en la cerradura para entrar. ¡Nos vemos! 🎉`
    );

    res.json({ message: 'PIN enviado por WhatsApp', telefono: tel });
  } catch (err) {
    console.error('Error enviando PIN:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

/**
 * GET /api/notificaciones/preview — Ver qué se enviaría hoy (sin enviar)
 */
router.get('/preview', adminAuth, async (req, res) => {
  try {
    const hoy = new Date();
    const formato = (d) => d.toISOString().split('T')[0];

    const en3dias = new Date(hoy); en3dias.setDate(en3dias.getDate() + 3);
    const manana = new Date(hoy); manana.setDate(manana.getDate() + 1);

    const [r3, r1, rHoy] = await Promise.all([
      pool.query(
        `SELECT r.id, r.fecha_evento, c.nombre, c.telefono, p.nombre AS paquete
         FROM reservaciones r JOIN clientes c ON r.cliente_id = c.id JOIN paquetes p ON r.paquete_id = p.id
         WHERE r.fecha_evento = $1 AND r.estado NOT IN ('cancelada') AND c.telefono IS NOT NULL`,
        [formato(en3dias)]
      ),
      pool.query(
        `SELECT r.id, r.fecha_evento, c.nombre, c.telefono, p.nombre AS paquete
         FROM reservaciones r JOIN clientes c ON r.cliente_id = c.id JOIN paquetes p ON r.paquete_id = p.id
         WHERE r.fecha_evento = $1 AND r.estado NOT IN ('cancelada') AND c.telefono IS NOT NULL`,
        [formato(manana)]
      ),
      pool.query(
        `SELECT r.id, r.fecha_evento, c.nombre, c.telefono, p.nombre AS paquete, ca.codigo_pin
         FROM reservaciones r JOIN clientes c ON r.cliente_id = c.id JOIN paquetes p ON r.paquete_id = p.id
         LEFT JOIN codigos_acceso ca ON r.id = ca.reservacion_id AND ca.activo = TRUE
         WHERE r.fecha_evento = $1 AND r.estado NOT IN ('cancelada') AND c.telefono IS NOT NULL`,
        [formato(hoy)]
      ),
    ]);

    res.json({
      fecha: formato(hoy),
      recordatorio_3dias: r3.rows,
      recordatorio_1dia: r1.rows,
      pin_dia_evento: rHoy.rows,
    });
  } catch (err) {
    console.error('Error en preview:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

module.exports = router;
