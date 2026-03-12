const express = require('express');
const router = express.Router();
const pool = require('../db/connection');
const crypto = require('crypto');
const whatsapp = require('../services/whatsapp');

const MP_ACCESS_TOKEN = process.env.MERCADOPAGO_ACCESS_TOKEN;

/**
 * POST /api/webhooks/mercadopago
 * Webhook que recibe notificaciones de Mercado Pago cuando un pago se procesa en la terminal
 */
router.post('/', async (req, res) => {
  // Siempre responder 200 rápido para evitar reintentos
  res.status(200).send('OK');

  try {
    const evento = req.body;

    // Solo nos interesa si es un evento de pago
    if (evento.type !== 'payment' && evento.action !== 'payment.created') {
      return;
    }

    const paymentId = evento.data?.id;
    if (!paymentId || !MP_ACCESS_TOKEN) return;

    // Consultar detalles del pago a Mercado Pago
    const mpResponse = await fetch(
      `https://api.mercadopago.com/v1/payments/${paymentId}`,
      {
        headers: { 'Authorization': `Bearer ${MP_ACCESS_TOKEN}` },
      }
    );

    if (!mpResponse.ok) {
      console.error('Error consultando pago a MP:', mpResponse.status);
      return;
    }

    const pago = await mpResponse.json();

    if (pago.status === 'approved') {
      const externalRef = pago.external_reference;

      // Actualizar en tabla de pagos_terminal
      await pool.query(
        `UPDATE pagos_terminal 
         SET estado = 'pagado', payment_id = $1, actualizado_en = NOW()
         WHERE external_reference = $2`,
        [String(paymentId), externalRef]
      );

      // Si el cobro está vinculado a una reservación, actualizar monto_pagado
      if (externalRef && externalRef.startsWith('QDA-RES-')) {
        const reservacionId = externalRef.split('-')[2];
        if (reservacionId) {
          const updRes = await pool.query(
            `UPDATE reservaciones 
             SET monto_pagado = monto_pagado + $1,
                 estado = CASE WHEN monto_pagado + $1 >= monto_total THEN 'pagada' ELSE estado END,
                 actualizado_en = NOW()
             WHERE id = $2
             RETURNING estado`,
            [pago.transaction_amount, reservacionId]
          );

          // Si quedó liquidada, enviar Pase de Abordar
          if (updRes.rows.length > 0 && updRes.rows[0].estado === 'pagada') {
            enviarPaseDeAbordarMP(reservacionId);
          }
        }
      }

    } else if (pago.status === 'rejected') {
      await pool.query(
        `UPDATE pagos_terminal SET estado = 'rechazado', actualizado_en = NOW()
         WHERE external_reference = $1`,
        [pago.external_reference]
      );
    }
  } catch (err) {
    console.error('Error procesando webhook de Mercado Pago:', err.message);
  }
});

/**
 * Helper: Auto-generar PIN y enviar Pase de Abordar (MercadoPago)
 */
async function enviarPaseDeAbordarMP(reservacionId) {
  try {
    const { rows } = await pool.query(`
      SELECT r.id, r.fecha_evento, r.hora_inicio, r.hora_fin, r.monto_total, r.num_invitados,
             c.nombre AS cliente_nombre, c.telefono, c.whatsapp,
             p.nombre AS paquete_nombre, p.capacidad_max
      FROM reservaciones r
      JOIN clientes c ON r.cliente_id = c.id
      JOIN paquetes p ON r.paquete_id = p.id
      WHERE r.id = $1
    `, [reservacionId]);

    if (rows.length === 0) return;
    const r = rows[0];

    const telefono = r.whatsapp || r.telefono;
    if (!telefono) return;
    const telFormateado = telefono.startsWith('52') ? telefono : `52${telefono.replace(/\D/g, '')}`;

    const pin = String(crypto.randomInt(1000, 9999));
    const fechaEvento = new Date(r.fecha_evento + 'T12:00:00');
    const [hInicio] = r.hora_inicio.split(':').map(Number);
    const [hFin] = r.hora_fin.split(':').map(Number);

    const validoDesde = new Date(fechaEvento);
    validoDesde.setHours(hInicio - 1, 0, 0, 0);
    const validoHasta = new Date(fechaEvento);
    if (hFin === 23 && r.hora_fin === '23:59') {
      validoHasta.setDate(validoHasta.getDate() + 1);
      validoHasta.setHours(11, 0, 0, 0);
    } else {
      validoHasta.setHours(hFin + 1, 0, 0, 0);
    }

    await pool.query(
      `INSERT INTO codigos_acceso (reservacion_id, codigo_pin, valido_desde, valido_hasta, enviado)
       VALUES ($1, $2, $3, $4, TRUE)
       ON CONFLICT (reservacion_id) DO UPDATE SET
         codigo_pin = EXCLUDED.codigo_pin, valido_desde = EXCLUDED.valido_desde,
         valido_hasta = EXCLUDED.valido_hasta, activo = TRUE, enviado = TRUE, creado_en = NOW()
       RETURNING *`,
      [reservacionId, pin, validoDesde.toISOString(), validoHasta.toISOString()]
    );

    await whatsapp.enviarPaseAbordar({
      telefono: telFormateado,
      nombre: r.cliente_nombre,
      fechaEvento: r.fecha_evento,
      horaInicio: r.hora_inicio,
      horaFin: r.hora_fin,
      capacidad: r.capacidad_max || r.num_invitados || 30,
      codigoPin: pin,
      montoTotal: r.monto_total,
      paqueteNombre: r.paquete_nombre,
      reservacionId: r.id,
    });
  } catch (err) {
    console.error('Error enviando Pase de Abordar (MP):', err.message);
  }
}

module.exports = router;
