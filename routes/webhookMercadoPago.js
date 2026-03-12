const express = require('express');
const router = express.Router();
const pool = require('../db/connection');

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
          await pool.query(
            `UPDATE reservaciones 
             SET monto_pagado = monto_pagado + $1,
                 estado = CASE WHEN monto_pagado + $1 >= monto_total THEN 'pagada' ELSE estado END,
                 actualizado_en = NOW()
             WHERE id = $2`,
            [pago.transaction_amount, reservacionId]
          );
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

module.exports = router;
