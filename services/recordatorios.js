const pool = require('../db/connection');
const { enviarRecordatorio, enviarMensaje } = require('./whatsapp');

/**
 * Enviar recordatorios WhatsApp a CLIENTES 24 horas antes
 * Se ejecuta una vez al día (configurado en index.js)
 */
async function enviarRecordatorios() {
  try {
    // Buscar reservaciones para mañana que estén confirmadas o pagadas
    const { rows } = await pool.query(`
      SELECT r.id, r.fecha_evento, r.hora_inicio, r.hora_fin,
             c.nombre AS cliente_nombre, c.telefono AS cliente_telefono,
             p.nombre AS paquete_nombre
      FROM reservaciones r
      JOIN clientes c ON r.cliente_id = c.id
      JOIN paquetes p ON r.paquete_id = p.id
      WHERE r.fecha_evento = CURRENT_DATE + INTERVAL '1 day'
        AND r.estado IN ('confirmada', 'pagada')
        AND c.telefono IS NOT NULL
    `);

    console.log(`📬 Recordatorios CLIENTES: ${rows.length} reservación(es) para mañana`);

    for (const r of rows) {
      try {
        const fecha = r.fecha_evento instanceof Date
          ? r.fecha_evento.toISOString().split('T')[0]
          : String(r.fecha_evento).split('T')[0];

        await enviarRecordatorio(
          r.cliente_telefono,
          r.cliente_nombre,
          fecha,
          r.hora_inicio?.slice(0, 5),
          r.hora_fin?.slice(0, 5),
          r.paquete_nombre
        );
        console.log(`  ✅ Recordatorio enviado a cliente ${r.cliente_nombre} (Reservación #${r.id})`);
      } catch (err) {
        console.error(`  ❌ Error enviando a ${r.cliente_nombre}:`, err.message);
      }
    }
  } catch (err) {
    console.error('❌ Error en cron de recordatorios clientes:', err.message);
  }
}

/**
 * Enviar recordatorios WhatsApp a STAFF/ENCARGADOS 3 DÍAS ANTES
 * Se ejecuta una vez al día (configurado en index.js)
 * Notifica al equipo sobre eventos próximos
 */
async function enviarRecordatoriosStaff() {
  try {
    const staffTelefono = process.env.STAFF_ENCARGADOS;
    
    if (!staffTelefono) {
      console.warn('⚠️  STAFF_ENCARGADOS no configurado. Recordatorios de staff desactivados.');
      return;
    }

    // Buscar reservaciones para dentro de 3 días que estén confirmadas o pagadas
    const { rows } = await pool.query(`
      SELECT r.id, r.fecha_evento, r.hora_inicio, r.hora_fin, r.num_invitados,
             c.nombre AS cliente_nombre, c.telefono AS cliente_telefono,
             p.nombre AS paquete_nombre
      FROM reservaciones r
      JOIN clientes c ON r.cliente_id = c.id
      JOIN paquetes p ON r.paquete_id = p.id
      WHERE r.fecha_evento = CURRENT_DATE + INTERVAL '3 days'
        AND r.estado IN ('confirmada', 'pagada')
      ORDER BY r.hora_inicio ASC
    `);

    console.log(`👔 Recordatorios STAFF: ${rows.length} evento(s) en 3 días`);

    if (rows.length === 0) {
      console.log('  ℹ️  Sin eventos próximos en 3 días');
      return;
    }

    // Construir mensaje resumido para los encargados
    const diasSemana = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
    const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    const d = new Date(rows[0].fecha_evento + 'T12:00:00');
    const fechaFormateada = `${diasSemana[d.getDay()]} ${d.getDate()} de ${meses[d.getMonth()]}`;

    let mensajeResumen = `📋 *RECORDATORIO A ENCARGADOS* — Eventos en 3 días\n`;
    mensajeResumen += `📅 Fecha: *${fechaFormateada}*\n\n`;

    for (const r of rows) {
      const hora = r.hora_inicio?.slice(0, 5) || 'N/A';
      const invitados = r.num_invitados || '?';
      
      mensajeResumen += `🎉 *${r.paquete_nombre}*\n`;
      mensajeResumen += `🕐 ${hora} hrs | 👥 ${invitados} invitados\n`;
      mensajeResumen += `👤 Cliente: ${r.cliente_nombre}\n`;
      
      if (r.cliente_telefono) {
        mensajeResumen += `📱 ${r.cliente_telefono}\n`;
      }
      
      mensajeResumen += `─────────────────\n`;
    }

    mensajeResumen += `\n¡Prepárense para los eventos! 💪\n`;
    mensajeResumen += `Confirmen disponibilidad y equipamiento necesario.`;

    await enviarMensaje(staffTelefono, mensajeResumen);
    console.log(`  ✅ Recordatorio enviado a encargados sobre ${rows.length} evento(s)`);

  } catch (err) {
    console.error('❌ Error en cron de recordatorios staff:', err.message);
  }
}

module.exports = { enviarRecordatorios, enviarRecordatoriosStaff };
