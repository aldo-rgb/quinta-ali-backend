/**
 * Tickets de servicio a cliente.
 *
 *   reporte_web  algo no funciona (/reporte)
 *   queja        queja del huésped (/opina)
 *   resena       reseña de 1 a 3 estrellas (/opina)
 *
 * Todos quedan en tickets_servicio: el admin los atiende y Grupo Rino los lee
 * (POST /api/rino/servicio-cliente).
 */
const pool = require('../db/connection');
const whatsapp = require('./whatsapp');

const AVISO = {
  reporte_web: { titulo: '🆘 *Reporte de cliente', donde: 'Admin → Rino para mandarlo a mantenimiento' },
  queja: { titulo: '😟 *Queja de cliente', donde: 'Admin → Reseñas' },
  resena: { titulo: '⭐ *Reseña baja', donde: 'Admin → Reseñas' },
};

async function crearTicket({ origen, categoria = null, descripcion, urgencia = null, contacto = null }) {
  const { rows } = await pool.query(
    `INSERT INTO tickets_servicio (origen, categoria, descripcion, urgencia, contacto)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [origen, categoria, descripcion, urgencia, contacto]
  );
  const id = rows[0].id;

  // Aviso al admin sin hacer esperar al cliente.
  if (process.env.ADMIN_WHATSAPP) {
    const aviso = AVISO[origen] || { titulo: '📋 *Ticket', donde: 'el panel admin' };
    whatsapp.enviarMensaje(
      process.env.ADMIN_WHATSAPP,
      `${aviso.titulo} #${id}*\n\n` +
        (categoria ? `📍 ${categoria}\n` : '') +
        `📝 ${descripcion}` +
        (contacto ? `\n👤 ${contacto}` : '') +
        `\n\nRevísalo en ${aviso.donde}.`
    );
  }

  return id;
}

module.exports = { crearTicket };
