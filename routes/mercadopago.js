const { Router } = require('express');
const pool = require('../db/connection');

const router = Router();

const MP_ACCESS_TOKEN = process.env.MERCADOPAGO_ACCESS_TOKEN;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

/**
 * POST /api/mercadopago/crear-preferencia
 * Crear una preferencia de pago para MercadoPago Checkout Pro
 */
router.post('/crear-preferencia', async (req, res) => {
  try {
    if (!MP_ACCESS_TOKEN) {
      return res.status(503).json({ 
        message: 'MercadoPago no está configurado. Agrega MERCADOPAGO_ACCESS_TOKEN en .env' 
      });
    }

    const { reservacion_id } = req.body;

    if (!reservacion_id) {
      return res.status(400).json({ message: 'reservacion_id es requerido' });
    }

    // Obtener datos de la reservación
    const { rows } = await pool.query(`
      SELECT r.id, r.monto_total, r.monto_pagado, r.estado, r.fecha_evento,
             c.nombre AS cliente_nombre, c.apellido AS cliente_apellido,
             c.email AS cliente_email, c.telefono AS cliente_telefono,
             p.nombre AS paquete_nombre
      FROM reservaciones r
      JOIN clientes c ON r.cliente_id = c.id
      JOIN paquetes p ON r.paquete_id = p.id
      WHERE r.id = $1
    `, [reservacion_id]);

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Reservación no encontrada' });
    }

    const reservacion = rows[0];
    const montoAPagar = Number(reservacion.monto_total) - Number(reservacion.monto_pagado || 0);

    if (montoAPagar <= 0) {
      return res.status(400).json({ message: 'Esta reservación ya está pagada' });
    }

    // Crear preferencia en MercadoPago
    const preference = {
      items: [
        {
          id: `reservacion-${reservacion_id}`,
          title: `Reservación ${reservacion.paquete_nombre} - La Quinta de Alí`,
          description: `Evento: ${reservacion.fecha_evento}`,
          quantity: 1,
          currency_id: 'MXN',
          unit_price: montoAPagar,
        },
      ],
      payer: {
        name: reservacion.cliente_nombre || '',
        surname: reservacion.cliente_apellido || '',
        email: reservacion.cliente_email || 'cliente@quintadeali.com',
        phone: {
          area_code: '52',
          number: (reservacion.cliente_telefono || '').replace(/\D/g, '').slice(-10),
        },
      },
      back_urls: {
        success: `${FRONTEND_URL}/pago/exitoso?reservacion_id=${reservacion_id}&metodo=mercadopago`,
        failure: `${FRONTEND_URL}/pago/cancelado?reservacion_id=${reservacion_id}`,
        pending: `${FRONTEND_URL}/pago/exitoso?reservacion_id=${reservacion_id}&metodo=mercadopago&pendiente=1`,
      },
      auto_return: 'approved',
      external_reference: `QDA-${reservacion_id}-${Date.now()}`,
      notification_url: `${process.env.BACKEND_URL || 'https://web-production-bdf66.up.railway.app'}/api/mercadopago/webhook`,
      statement_descriptor: 'QUINTA DE ALI',
      payment_methods: {
        // Excluir métodos que no queremos
        excluded_payment_types: [],
        excluded_payment_methods: [],
        installments: 12, // Hasta 12 MSI
        default_installments: 1,
      },
    };

    const mpResponse = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${MP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(preference),
    });

    const mpData = await mpResponse.json();

    if (!mpResponse.ok) {
      console.error('Error MercadoPago:', mpData);
      return res.status(mpResponse.status).json({
        message: mpData.message || 'Error al crear preferencia de pago',
        detalle: mpData,
      });
    }

    // Guardar referencia en BD para tracking
    await pool.query(`
      INSERT INTO pagos_mercadopago (reservacion_id, preference_id, external_reference, monto, estado)
      VALUES ($1, $2, $3, $4, 'pendiente')
      ON CONFLICT (preference_id) DO UPDATE SET
        monto = EXCLUDED.monto,
        updated_at = NOW()
    `, [reservacion_id, mpData.id, preference.external_reference, montoAPagar]);

    res.json({
      ok: true,
      preference_id: mpData.id,
      init_point: mpData.init_point, // URL de pago (producción)
      sandbox_init_point: mpData.sandbox_init_point, // URL de pago (sandbox)
    });

  } catch (err) {
    console.error('Error creando preferencia MercadoPago:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

/**
 * POST /api/mercadopago/webhook
 * Webhook para recibir notificaciones de pago de MercadoPago
 */
router.post('/webhook', async (req, res) => {
  try {
    // MercadoPago envía: { action, api_version, data: { id }, date_created, id, live_mode, type, user_id }
    const { type, data } = req.body;

    // Responder inmediatamente para evitar reintentos
    res.status(200).send('OK');

    if (type !== 'payment' || !data?.id) {
      return;
    }

    // Consultar el pago en MercadoPago
    const paymentResponse = await fetch(`https://api.mercadopago.com/v1/payments/${data.id}`, {
      headers: { 'Authorization': `Bearer ${MP_ACCESS_TOKEN}` },
    });

    if (!paymentResponse.ok) {
      console.error('Error consultando pago:', await paymentResponse.text());
      return;
    }

    const payment = await paymentResponse.json();

    // Extraer reservacion_id del external_reference (format: QDA-{id}-{timestamp})
    const externalRef = payment.external_reference || '';
    const match = externalRef.match(/QDA-(\d+)-/);
    if (!match) {
      console.log('Webhook MP: external_reference no coincide con patrón:', externalRef);
      return;
    }

    const reservacionId = parseInt(match[1], 10);

    // Actualizar estado del pago en nuestra BD
    await pool.query(`
      UPDATE pagos_mercadopago 
      SET estado = $1, payment_id = $2, payment_status = $3, updated_at = NOW()
      WHERE external_reference = $4
    `, [
      payment.status === 'approved' ? 'aprobado' : payment.status === 'pending' ? 'pendiente' : 'rechazado',
      payment.id,
      payment.status,
      externalRef,
    ]);

    // Si el pago fue aprobado, actualizar la reservación
    if (payment.status === 'approved') {
      const montoNeto = payment.transaction_details?.net_received_amount || payment.transaction_amount;

      // Actualizar monto_pagado en reservaciones
      await pool.query(`
        UPDATE reservaciones 
        SET monto_pagado = COALESCE(monto_pagado, 0) + $1,
            estado = CASE 
              WHEN COALESCE(monto_pagado, 0) + $1 >= monto_total THEN 'confirmada'
              ELSE estado
            END,
            updated_at = NOW()
        WHERE id = $2
      `, [montoNeto, reservacionId]);

      console.log(`✅ Pago MercadoPago aprobado: Reservación ${reservacionId}, Monto: $${montoNeto}`);

      // TODO: Enviar Pase de Abordar si está liquidado (igual que otros métodos)
    }

  } catch (err) {
    console.error('Error procesando webhook MercadoPago:', err.message);
    // No enviar error, ya respondimos 200
  }
});

/**
 * GET /api/mercadopago/estado/:reservacionId
 * Consultar estado del pago de una reservación
 */
router.get('/estado/:reservacionId', async (req, res) => {
  try {
    const { reservacionId } = req.params;

    const { rows } = await pool.query(`
      SELECT * FROM pagos_mercadopago 
      WHERE reservacion_id = $1 
      ORDER BY created_at DESC 
      LIMIT 1
    `, [reservacionId]);

    if (rows.length === 0) {
      return res.json({ estado: null, message: 'Sin pagos registrados' });
    }

    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Error consultando estado' });
  }
});

module.exports = router;
