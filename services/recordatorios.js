const pool = require('../db/connection');
const { enviarRecordatorio } = require('./whatsapp');

/**
 * Enviar recordatorios WhatsApp a reservaciones de mañana
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

    console.log(`📬 Recordatorios: ${rows.length} reservación(es) para mañana`);

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
        console.log(`  ✅ Recordatorio enviado a ${r.cliente_nombre} (Reservación #${r.id})`);
      } catch (err) {
        console.error(`  ❌ Error enviando a ${r.cliente_nombre}:`, err.message);
      }
    }
  } catch (err) {
    console.error('❌ Error en cron de recordatorios:', err.message);
  }
}

module.exports = { enviarRecordatorios };
