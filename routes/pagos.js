const { Router } = require('express');
const pool = require('../db/connection');
const rateLimit = require('express-rate-limit');

const router = Router();

// Rate limiting: máximo 10 intentos de pago por IP en 15 min
const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { message: 'Demasiados intentos de pago. Intenta de nuevo en 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
});
router.use(paymentLimiter);

// Inicializar Openpay solo si las credenciales están configuradas
const merchantId = process.env.OPENPAY_MERCHANT_ID;
const privateKey = process.env.OPENPAY_PRIVATE_KEY;
const isSandbox = process.env.OPENPAY_IS_SANDBOX !== 'false';
let openpay = null;

if (merchantId && privateKey) {
  const Openpay = require('openpay');
  openpay = new Openpay(merchantId, privateKey, isSandbox);
}

// Helper: promisificar openpay.charges.create
function crearCargo(chargeData) {
  return new Promise((resolve, reject) => {
    openpay.charges.create(chargeData, (error, charge) => {
      if (error) reject(error);
      else resolve(charge);
    });
  });
}

// Helper: promisificar openpay.charges.get
function obtenerCargo(chargeId) {
  return new Promise((resolve, reject) => {
    openpay.charges.get(chargeId, (error, charge) => {
      if (error) reject(error);
      else resolve(charge);
    });
  });
}

// POST /api/pagos/generar-referencia — Generar referencia Paynet (pago en tienda)
router.post('/generar-referencia', async (req, res) => {
  try {
    if (!openpay) {
      return res.status(503).json({ message: 'Pasarela de pago no configurada. Contacta al administrador.' });
    }

    const { reservacion_id } = req.body;
    if (!reservacion_id) {
      return res.status(400).json({ message: 'reservacion_id es requerido' });
    }

    // Obtener datos de la reservación
    const { rows } = await pool.query(`
      SELECT r.id, r.monto_total, r.estado, r.fecha_evento,
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

    if (reservacion.estado === 'pagada' || reservacion.estado === 'completada') {
      return res.status(400).json({ message: 'Esta reservación ya fue pagada' });
    }

    // Verificar si ya existe un pago pendiente válido
    const existente = await pool.query(
      `SELECT * FROM pagos WHERE reservacion_id = $1 AND estado = 'pendiente' AND fecha_vencimiento > NOW()`,
      [reservacion_id]
    );
    if (existente.rows.length > 0) {
      const pago = existente.rows[0];
      return res.json({
        referencia: pago.referencia_paynet,
        barcode_url: pago.barcode_url,
        monto: Number(pago.monto),
        fecha_vencimiento: pago.fecha_vencimiento,
        openpay_charge_id: pago.openpay_charge_id,
      });
    }

    // Pago único = monto total
    const montoPago = Math.round(reservacion.monto_total * 100) / 100;

    // Fecha de vencimiento: 48 horas desde ahora
    const vencimiento = new Date();
    vencimiento.setHours(vencimiento.getHours() + 48);
    const dueDate = vencimiento.toISOString().replace('Z', '');

    const orderId = `QDA-${reservacion.id}-${Date.now()}`;

    const cargoData = {
      method: 'store',
      amount: montoPago,
      description: `Pago — ${reservacion.paquete_nombre} — Reservación #${reservacion.id}`,
      order_id: orderId,
      due_date: dueDate,
      customer: {
        name: reservacion.cliente_nombre || 'Cliente',
        last_name: reservacion.cliente_apellido || '',
        phone_number: (reservacion.cliente_telefono || '').replace(/\s/g, '') || '0000000000',
        email: reservacion.cliente_email || 'sin-email@quintadeali.com',
      },
      send_email: !!reservacion.cliente_email,
    };

    const charge = await crearCargo(cargoData);

    // Guardar en BD
    await pool.query(`
      INSERT INTO pagos (reservacion_id, openpay_charge_id, openpay_order_id, referencia_paynet, barcode_url, monto, fecha_vencimiento)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [
      reservacion.id,
      charge.id,
      orderId,
      charge.payment_method?.reference || null,
      charge.payment_method?.barcode_url || null,
      montoPago,
      vencimiento,
    ]);

    res.json({
      referencia: charge.payment_method?.reference,
      barcode_url: charge.payment_method?.barcode_url,
      monto: montoPago,
      fecha_vencimiento: vencimiento.toISOString(),
      openpay_charge_id: charge.id,
    });
  } catch (err) {
    console.error('Error generando referencia Paynet:', err.description || err.message || err);
    res.status(500).json({ message: err.description || 'Error al generar referencia de pago' });
  }
});

// POST /api/pagos/generar-cargo-tarjeta — Generar cargo con tarjeta (redireccion Openpay)
router.post('/generar-cargo-tarjeta', async (req, res) => {
  try {
    if (!openpay) {
      return res.status(503).json({ message: 'Pasarela de pago no configurada. Contacta al administrador.' });
    }

    const { reservacion_id, tipo_tarjeta, meses } = req.body;
    if (!reservacion_id) {
      return res.status(400).json({ message: 'reservacion_id es requerido' });
    }

    const { rows } = await pool.query(`
      SELECT r.id, r.monto_total, r.estado, r.fecha_evento,
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

    if (reservacion.estado === 'pagada' || reservacion.estado === 'completada') {
      return res.status(400).json({ message: 'Esta reservación ya fue pagada' });
    }

    const montoPago = Math.round(reservacion.monto_total * 100) / 100;
    const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
    const orderId = `QDA-CARD-${reservacion.id}-${Date.now()}`;

    const cargoData = {
      method: 'card',
      amount: montoPago,
      description: `Pago — ${reservacion.paquete_nombre} — Reservación #${reservacion.id}`,
      order_id: orderId,
      customer: {
        name: reservacion.cliente_nombre || 'Cliente',
        last_name: reservacion.cliente_apellido || '',
        phone_number: (reservacion.cliente_telefono || '').replace(/\s/g, '') || '0000000000',
        email: reservacion.cliente_email || 'sin-email@quintadeali.com',
      },
      send_email: !!reservacion.cliente_email,
      confirm: false,
      redirect_url: `${FRONTEND_URL}/pago/exitoso?reservacion_id=${reservacion.id}`,
    };

    // MSI (Meses sin intereses) — solo tarjetas de crédito
    const mesesValidos = [3, 6, 12];
    if (tipo_tarjeta === 'credito' && meses && mesesValidos.includes(Number(meses)) && Number(meses) > 1) {
      cargoData.payment_plan = { payments: Number(meses) };
    }

    const charge = await crearCargo(cargoData);

    // Guardar en BD
    await pool.query(`
      INSERT INTO pagos (reservacion_id, openpay_charge_id, openpay_order_id, monto, metodo, fecha_vencimiento)
      VALUES ($1, $2, $3, $4, 'card', NOW() + INTERVAL '1 hour')
    `, [reservacion.id, charge.id, orderId, montoPago]);

    res.json({
      payment_url: charge.payment_method?.url,
      openpay_charge_id: charge.id,
      monto: montoPago,
    });
  } catch (err) {
    console.error('Error generando cargo con tarjeta:', err.description || err.message || err);
    // Detectar error de MSI con tarjeta de débito
    const desc = err.description || err.message || '';
    if (desc.includes('payment_plan') || desc.includes('installments') || (err.error_code && err.error_code === 3005)) {
      return res.status(400).json({ 
        message: 'Esta tarjeta no admite meses sin intereses. Intenta con una tarjeta de crédito o selecciona pago único.',
        code: 'MSI_NOT_SUPPORTED'
      });
    }
    res.status(500).json({ message: err.description || 'Error al generar cargo con tarjeta' });
  }
});

// POST /api/pagos/generar-spei — Generar CLABE para transferencia SPEI
router.post('/generar-spei', async (req, res) => {
  try {
    if (!openpay) {
      return res.status(503).json({ message: 'Pasarela de pago no configurada. Contacta al administrador.' });
    }

    const { reservacion_id } = req.body;
    if (!reservacion_id) {
      return res.status(400).json({ message: 'reservacion_id es requerido' });
    }

    // Obtener datos de la reservación
    const { rows } = await pool.query(`
      SELECT r.id, r.monto_total, r.estado, r.fecha_evento,
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

    if (reservacion.estado === 'pagada' || reservacion.estado === 'completada') {
      return res.status(400).json({ message: 'Esta reservación ya fue pagada' });
    }

    // Verificar si ya existe un pago SPEI pendiente válido
    const existente = await pool.query(
      `SELECT * FROM pagos WHERE reservacion_id = $1 AND metodo = 'spei' AND estado = 'pendiente' AND fecha_vencimiento > NOW()`,
      [reservacion_id]
    );
    if (existente.rows.length > 0) {
      const pago = existente.rows[0];
      return res.json({
        clabe: pago.referencia_paynet,
        monto: Number(pago.monto),
        fecha_vencimiento: pago.fecha_vencimiento,
        openpay_charge_id: pago.openpay_charge_id,
        nombre_banco: 'STP',
        nombre_beneficiario: 'La Quinta de Alí',
      });
    }

    const montoPago = Math.round(reservacion.monto_total * 100) / 100;

    // Vencimiento: 24 horas
    const vencimiento = new Date();
    vencimiento.setHours(vencimiento.getHours() + 24);
    const dueDate = vencimiento.toISOString().replace('Z', '');

    const orderId = `QDA-SPEI-${reservacion.id}-${Date.now()}`;

    const cargoData = {
      method: 'bank_account',
      amount: montoPago,
      description: `Pago — ${reservacion.paquete_nombre} — Reservación #${reservacion.id}`,
      order_id: orderId,
      due_date: dueDate,
      customer: {
        name: reservacion.cliente_nombre || 'Cliente',
        last_name: reservacion.cliente_apellido || '',
        phone_number: (reservacion.cliente_telefono || '').replace(/\s/g, '') || '0000000000',
        email: reservacion.cliente_email || 'sin-email@quintadeali.com',
      },
      send_email: !!reservacion.cliente_email,
    };

    const charge = await crearCargo(cargoData);

    const clabe = charge.payment_method?.clabe || charge.payment_method?.reference || null;

    // Guardar en BD (reutilizamos referencia_paynet para la CLABE)
    await pool.query(`
      INSERT INTO pagos (reservacion_id, openpay_charge_id, openpay_order_id, referencia_paynet, monto, metodo, fecha_vencimiento)
      VALUES ($1, $2, $3, $4, $5, 'spei', $6)
    `, [reservacion.id, charge.id, orderId, clabe, montoPago, vencimiento]);

    res.json({
      clabe,
      monto: montoPago,
      fecha_vencimiento: vencimiento.toISOString(),
      openpay_charge_id: charge.id,
      nombre_banco: 'STP',
      nombre_beneficiario: 'La Quinta de Alí',
    });
  } catch (err) {
    console.error('Error generando SPEI:', err.description || err.message || err);
    res.status(500).json({ message: err.description || 'Error al generar transferencia SPEI' });
  }
});

// POST /api/pagos/webhook — Webhook de Openpay para confirmar pagos
router.post('/webhook', async (req, res) => {
  try {
    const event = req.body;
    const tipo = event.type;
    const transaccion = event.transaction;

    if (!transaccion) {
      return res.json({ received: true });
    }

    if (tipo === 'charge.succeeded') {
      // Pago exitoso — actualizar BD
      const { rows } = await pool.query(
        'SELECT * FROM pagos WHERE openpay_charge_id = $1',
        [transaccion.id]
      );

      if (rows.length > 0) {
        const pago = rows[0];

        await pool.query(`
          UPDATE pagos SET estado = 'completado', actualizado_en = NOW()
          WHERE openpay_charge_id = $1
        `, [transaccion.id]);

        await pool.query(`
          UPDATE reservaciones SET monto_pagado = monto_pagado + $1,
            estado = CASE WHEN monto_pagado + $1 >= monto_total THEN 'pagada' ELSE 'confirmada' END
          WHERE id = $2 AND estado IN ('pendiente', 'confirmada')
        `, [pago.monto, pago.reservacion_id]);
      }
    } else if (tipo === 'charge.failed' || tipo === 'charge.cancelled') {
      await pool.query(`
        UPDATE pagos SET estado = $1, actualizado_en = NOW()
        WHERE openpay_charge_id = $2
      `, [tipo === 'charge.failed' ? 'fallido' : 'cancelado', transaccion.id]);
    }

    res.json({ received: true });
  } catch (err) {
    console.error('Error en webhook Openpay:', err.message);
    res.status(500).json({ message: 'Error procesando webhook' });
  }
});

// GET /api/pagos/verificar/:chargeId — Verificar estado de un pago con Openpay
router.get('/verificar/:chargeId', async (req, res) => {
  try {
    const { chargeId } = req.params;

    const { rows } = await pool.query(`
      SELECT p.*, r.estado AS reservacion_estado, r.monto_total, r.monto_pagado,
             r.fecha_evento, r.id AS reservacion_id,
             c.nombre AS cliente_nombre,
             pk.nombre AS paquete_nombre
      FROM pagos p
      JOIN reservaciones r ON p.reservacion_id = r.id
      JOIN clientes c ON r.cliente_id = c.id
      JOIN paquetes pk ON r.paquete_id = pk.id
      WHERE p.openpay_charge_id = $1
    `, [chargeId]);

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Pago no encontrado' });
    }

    // Si sigue pendiente y Openpay está disponible, verificar directo
    if (rows[0].estado === 'pendiente' && openpay) {
      try {
        const charge = await obtenerCargo(chargeId);
        if (charge.status === 'completed') {
          await pool.query(
            `UPDATE pagos SET estado = 'completado', actualizado_en = NOW() WHERE openpay_charge_id = $1`,
            [chargeId]
          );
          await pool.query(
            `UPDATE reservaciones SET monto_pagado = monto_pagado + $1, estado = CASE WHEN monto_pagado + $1 >= monto_total THEN 'pagada' ELSE 'confirmada' END WHERE id = $2 AND estado IN ('pendiente', 'confirmada')`,
            [rows[0].monto, rows[0].reservacion_id]
          );
          rows[0].estado = 'completado';
          rows[0].reservacion_estado = 'confirmada';
        }
      } catch {
        // Si falla la verificación, devolvemos lo que tenemos
      }
    }

    res.json(rows[0]);
  } catch (err) {
    console.error('Error verificando pago:', err.message);
    res.status(500).json({ message: 'Error al verificar pago' });
  }
});

// GET /api/pagos/reservacion/:id — Pagos de una reservación
router.get('/reservacion/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM pagos WHERE reservacion_id = $1 ORDER BY creado_en DESC',
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('Error obteniendo pagos:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// POST /api/pagos/apple-pay — Procesar pago con token de Apple Pay
router.post('/apple-pay', async (req, res) => {
  try {
    if (!openpay) {
      return res.status(503).json({ message: 'Pasarela de pago no configurada. Contacta al administrador.' });
    }

    const { reservacion_id, token_id } = req.body;
    if (!reservacion_id || !token_id) {
      return res.status(400).json({ message: 'reservacion_id y token_id son requeridos' });
    }

    const { rows } = await pool.query(`
      SELECT r.id, r.monto_total, r.estado, r.fecha_evento,
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

    if (reservacion.estado === 'pagada' || reservacion.estado === 'completada') {
      return res.status(400).json({ message: 'Esta reservación ya fue pagada' });
    }

    const montoPago = Math.round(reservacion.monto_total * 100) / 100;
    const orderId = `QDA-APPLE-${reservacion.id}-${Date.now()}`;

    const cargoData = {
      method: 'card',
      source_id: token_id,
      amount: montoPago,
      description: `Pago Apple Pay — ${reservacion.paquete_nombre} — Reservación #${reservacion.id}`,
      order_id: orderId,
      device_session_id: req.body.device_session_id || 'applepay',
      customer: {
        name: reservacion.cliente_nombre || 'Cliente',
        last_name: reservacion.cliente_apellido || '',
        phone_number: (reservacion.cliente_telefono || '').replace(/\s/g, '') || '0000000000',
        email: reservacion.cliente_email || 'sin-email@quintadeali.com',
      },
      confirm: true,
    };

    const charge = await crearCargo(cargoData);

    // Guardar en BD
    await pool.query(`
      INSERT INTO pagos (reservacion_id, openpay_charge_id, openpay_order_id, monto, metodo, estado, fecha_vencimiento)
      VALUES ($1, $2, $3, $4, 'apple_pay', $5, NOW() + INTERVAL '1 hour')
    `, [reservacion.id, charge.id, orderId, montoPago, charge.status === 'completed' ? 'completado' : 'pendiente']);

    if (charge.status === 'completed') {
      await pool.query(
        `UPDATE reservaciones SET monto_pagado = monto_pagado + $1,
          estado = CASE WHEN monto_pagado + $1 >= monto_total THEN 'pagada' ELSE 'confirmada' END
        WHERE id = $2 AND estado IN ('pendiente', 'confirmada')`,
        [montoPago, reservacion.id]
      );
    }

    res.json({
      ok: true,
      status: charge.status,
      openpay_charge_id: charge.id,
      monto: montoPago,
    });
  } catch (err) {
    console.error('Error procesando Apple Pay:', err.description || err.message || err);
    res.status(500).json({ message: err.description || 'Error al procesar pago con Apple Pay' });
  }
});

module.exports = router;
