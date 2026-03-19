const { Router } = require('express');
const pool = require('../db/connection');
const adminAuth = require('../middleware/adminAuth');

const router = Router();

const MP_ACCESS_TOKEN = process.env.MERCADOPAGO_ACCESS_TOKEN;
const MP_DEVICE_ID = process.env.MERCADOPAGO_DEVICE_ID;

// POST /api/terminal/cobrar — Enviar cobro a la terminal física Mercado Pago Point
router.post('/cobrar', adminAuth, async (req, res) => {
  try {
    if (!MP_ACCESS_TOKEN || !MP_DEVICE_ID) {
      return res.status(503).json({ message: 'Terminal de Mercado Pago no configurada. Agrega MERCADOPAGO_ACCESS_TOKEN y MERCADOPAGO_DEVICE_ID en .env' });
    }

    const { monto, descripcion, reservacion_id } = req.body;

    if (!monto || monto <= 0) {
      return res.status(400).json({ message: 'El monto debe ser mayor a 0' });
    }
    if (!descripcion) {
      return res.status(400).json({ message: 'La descripción es requerida' });
    }

    const externalRef = reservacion_id
      ? `QDA-RES-${reservacion_id}-${Date.now()}`
      : `QDA-EXTRA-${Date.now()}`;

    // Crear payment intent en Mercado Pago Point
    const mpResponse = await fetch(
      `https://api.mercadopago.com/point/integration-api/devices/${MP_DEVICE_ID}/payment-intents`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${MP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: Math.round(monto * 100), // Mercado Pago espera centavos
          description: descripcion,
          payment: {
            type: 'credit_card',
            installments: 1,
            installments_cost: 'seller',
          },
          additional_info: {
            external_reference: externalRef,
            print_on_terminal: true,
          },
        }),
      }
    );

    const mpData = await mpResponse.json();

    if (!mpResponse.ok) {
      console.error('Error de Mercado Pago Point:', mpData);
      return res.status(mpResponse.status).json({
        message: mpData.message || 'Error al enviar cobro a la terminal',
        detalle: mpData,
      });
    }

    // Guardar en BD
    await pool.query(
      `INSERT INTO pagos_terminal (payment_intent_id, external_reference, monto, descripcion, reservacion_id, estado)
       VALUES ($1, $2, $3, $4, $5, 'enviado')`,
      [mpData.id, externalRef, monto, descripcion, reservacion_id || null]
    );

    res.json({
      ok: true,
      payment_intent_id: mpData.id,
      external_reference: externalRef,
      message: 'Cobro enviado a la terminal. Esperando que el cliente pase su tarjeta...',
    });
  } catch (err) {
    console.error('Error enviando cobro a terminal:', err.message);
    res.status(500).json({ message: 'Error del servidor al procesar cobro' });
  }
});

// GET /api/terminal/estado/:intentId — Consultar estado de un payment intent
router.get('/estado/:intentId', adminAuth, async (req, res) => {
  try {
    if (!MP_ACCESS_TOKEN) {
      return res.status(503).json({ message: 'Terminal no configurada' });
    }

    const { intentId } = req.params;

    const mpResponse = await fetch(
      `https://api.mercadopago.com/point/integration-api/payment-intents/${intentId}`,
      {
        headers: { 'Authorization': `Bearer ${MP_ACCESS_TOKEN}` },
      }
    );

    const mpData = await mpResponse.json();

    if (!mpResponse.ok) {
      return res.status(mpResponse.status).json({ message: 'Error consultando estado', detalle: mpData });
    }

    // Actualizar estado en BD
    const nuevoEstado = mpData.state === 'FINISHED' ? 'pagado'
      : mpData.state === 'CANCELED' ? 'cancelado'
      : mpData.state === 'ERROR' ? 'error'
      : 'enviado';

    await pool.query(
      `UPDATE pagos_terminal SET estado = $1 WHERE payment_intent_id = $2`,
      [nuevoEstado, intentId]
    );

    res.json({
      estado: nuevoEstado,
      estado_mp: mpData.state,
      payment_id: mpData.payment?.id || null,
    });
  } catch (err) {
    console.error('Error consultando estado:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// GET /api/terminal/historial — Últimos cobros de terminal
router.get('/historial', adminAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM pagos_terminal ORDER BY creado_en DESC LIMIT 20`
    );
    res.json(rows);
  } catch (err) {
    console.error('Error obteniendo historial:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// DELETE /api/terminal/cancelar/:intentId — Cancelar un payment intent
router.delete('/cancelar/:intentId', adminAuth, async (req, res) => {
  try {
    if (!MP_ACCESS_TOKEN || !MP_DEVICE_ID) {
      return res.status(503).json({ message: 'Terminal no configurada' });
    }

    const { intentId } = req.params;

    const mpResponse = await fetch(
      `https://api.mercadopago.com/point/integration-api/devices/${MP_DEVICE_ID}/payment-intents/${intentId}`,
      {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${MP_ACCESS_TOKEN}` },
      }
    );

    if (!mpResponse.ok) {
      const mpData = await mpResponse.json();
      return res.status(mpResponse.status).json({ message: 'Error cancelando cobro', detalle: mpData });
    }

    await pool.query(
      `UPDATE pagos_terminal SET estado = 'cancelado' WHERE payment_intent_id = $1`,
      [intentId]
    );

    res.json({ ok: true, message: 'Cobro cancelado' });
  } catch (err) {
    console.error('Error cancelando cobro:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

module.exports = router;
