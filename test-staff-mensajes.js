/**
 * Script de prueba para enviar mensaje a encargados de staff
 * Uso: node test-staff-mensajes.js
 */

require('dotenv').config();
const pool = require('./db/connection');
const { enviarMensaje } = require('./services/whatsapp');

async function testStaffMensajes() {
  try {
    console.log('🧪 Iniciando prueba de mensajes a staff...\n');

    const staffTelefonos = process.env.STAFF_ENCARGADOS;

    if (!staffTelefonos) {
      console.error('❌ Error: STAFF_ENCARGADOS no está configurado en las variables de entorno');
      process.exit(1);
    }

    const telefonosArray = staffTelefonos.split(',').map(t => t.trim()).filter(t => t.length > 0);
    console.log(`📱 Números configurados: ${telefonosArray.join(', ')}\n`);

    // Buscar eventos en 3 días para generar un mensajes realista
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
      LIMIT 5
    `);

    console.log(`📋 Eventos encontrados en 3 días: ${rows.length}\n`);

    if (rows.length === 0) {
      console.log('ℹ️  No hay eventos en 3 días. Generando mensaje de prueba...\n');
      
      const mensajePrueba = `🧪 *MENSAJE DE PRUEBA* — Sistema de notificaciones
      
✅ El sistema está funcionando correctamente.

Recibirás mensajes como este a las 09:00 AM diariamente con los eventos que vendrán en 3 días.

*Datos de configuración:*
📱 Números configurados: ${telefonosArray.length}
⏰ Hora: 09:00 AM (Zona: América/Monterrey)
📅 Frecuencia: Diaria`;

      for (const telefono of telefonosArray) {
        try {
          await enviarMensaje(telefono, mensajePrueba);
          console.log(`✅ Prueba enviada a: ${telefono}`);
        } catch (err) {
          console.error(`❌ Error enviando a ${telefono}:`, err.message);
        }
      }
    } else {
      // Mensaje con eventos reales
      const diasSemana = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
      const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
      const d = new Date(rows[0].fecha_evento + 'T12:00:00');
      const fechaFormateada = `${diasSemana[d.getDay()]} ${d.getDate()} de ${meses[d.getMonth()]}`;

      let mensaje = `📋 *RECORDATORIO A ENCARGADOS — PRUEBA* — Eventos en 3 días\n`;
      mensaje += `📅 Fecha: *${fechaFormateada}*\n\n`;

      for (const r of rows) {
        const hora = r.hora_inicio?.slice(0, 5) || 'N/A';
        const invitados = r.num_invitados || '?';
        
        mensaje += `🎉 *${r.paquete_nombre}*\n`;
        mensaje += `🕐 ${hora} hrs | 👥 ${invitados} invitados\n`;
        mensaje += `👤 Cliente: ${r.cliente_nombre}\n`;
        
        if (r.cliente_telefono) {
          mensaje += `📱 ${r.cliente_telefono}\n`;
        }
        
        mensaje += `─────────────────\n`;
      }

      mensaje += `\n¡Prepárense para los eventos! 💪\n`;
      mensaje += `Confirmen disponibilidad y equipamiento necesario.`;

      for (const telefono of telefonosArray) {
        try {
          await enviarMensaje(telefono, mensaje);
          console.log(`✅ Mensaje enviado a: ${telefono}`);
        } catch (err) {
          console.error(`❌ Error enviando a ${telefono}:`, err.message);
        }
      }
    }

    console.log('\n✅ Prueba completada');
    process.exit(0);

  } catch (err) {
    console.error('❌ Error en prueba:', err.message);
    process.exit(1);
  }
}

testStaffMensajes();
