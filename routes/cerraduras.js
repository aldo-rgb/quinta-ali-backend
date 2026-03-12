const { Router } = require('express');
const pool = require('../db/connection');
const adminAuth = require('../middleware/adminAuth');
const crypto = require('crypto');

const router = Router();

// GET /api/cerraduras — Listar todos los códigos (admin)
router.get('/', adminAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ca.*, r.fecha_evento, r.hora_inicio, r.hora_fin,
              c.nombre AS cliente_nombre, c.apellido AS cliente_apellido, c.telefono,
              p.nombre AS paquete_nombre
       FROM codigos_acceso ca
       JOIN reservaciones r ON ca.reservacion_id = r.id
       JOIN clientes c ON r.cliente_id = c.id
       JOIN paquetes p ON r.paquete_id = p.id
       ORDER BY r.fecha_evento DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error('Error listando códigos:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

/**
 * POST /api/cerraduras/generar — Genera un PIN único para una reservación
 */
router.post('/generar', adminAuth, async (req, res) => {
  try {
    const { reservacion_id } = req.body;
    if (!reservacion_id) {
      return res.status(400).json({ message: 'reservacion_id es obligatorio' });
    }

    // Verificar que la reservación existe y obtener horarios
    const reservacion = await pool.query(
      `SELECT r.*, c.telefono, c.whatsapp, c.nombre 
       FROM reservaciones r 
       JOIN clientes c ON r.cliente_id = c.id 
       WHERE r.id = $1`,
      [reservacion_id]
    );

    if (reservacion.rows.length === 0) {
      return res.status(404).json({ message: 'Reservación no encontrada' });
    }

    const reserva = reservacion.rows[0];

    // Generar PIN de 4 dígitos (criptográficamente seguro)
    const pin = String(crypto.randomInt(1000, 9999));

    // Calcular ventana de validez: desde hora_inicio hasta hora_fin del día del evento
    const fechaEvento = new Date(reserva.fecha_evento);
    const [hInicio] = reserva.hora_inicio.split(':').map(Number);
    const [hFin] = reserva.hora_fin.split(':').map(Number);

    const validoDesde = new Date(fechaEvento);
    validoDesde.setHours(hInicio - 1, 0, 0, 0); // 1 hora antes para que lleguen

    const validoHasta = new Date(fechaEvento);
    if (hFin === 23 && reserva.hora_fin === '23:59') {
      // Pijama Party: extender hasta las 11am del día siguiente
      validoHasta.setDate(validoHasta.getDate() + 1);
      validoHasta.setHours(11, 0, 0, 0);
    } else {
      validoHasta.setHours(hFin + 1, 0, 0, 0); // 1 hora después para recoger
    }

    const { rows } = await pool.query(
      `INSERT INTO codigos_acceso (reservacion_id, codigo_pin, valido_desde, valido_hasta)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (reservacion_id) DO UPDATE SET
         codigo_pin = EXCLUDED.codigo_pin,
         valido_desde = EXCLUDED.valido_desde,
         valido_hasta = EXCLUDED.valido_hasta,
         activo = TRUE,
         creado_en = NOW()
       RETURNING *`,
      [reservacion_id, pin, validoDesde.toISOString(), validoHasta.toISOString()]
    );

    res.status(201).json({
      ...rows[0],
      cliente_nombre: reserva.nombre,
      cliente_telefono: reserva.telefono || reserva.whatsapp,
    });
  } catch (err) {
    console.error('Error generando código:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

/**
 * POST /api/cerraduras/verificar — Verifica si un PIN es válido ahora
 */
router.post('/verificar', async (req, res) => {
  try {
    const { codigo_pin } = req.body;
    if (!codigo_pin) {
      return res.status(400).json({ message: 'codigo_pin es obligatorio' });
    }

    const { rows } = await pool.query(
      `SELECT ca.*, r.fecha_evento, r.hora_inicio, r.hora_fin
       FROM codigos_acceso ca
       JOIN reservaciones r ON ca.reservacion_id = r.id
       WHERE ca.codigo_pin = $1 AND ca.activo = TRUE
         AND NOW() BETWEEN ca.valido_desde AND ca.valido_hasta`,
      [codigo_pin]
    );

    if (rows.length === 0) {
      return res.json({ valido: false, message: 'Código inválido o expirado' });
    }

    res.json({ valido: true, acceso: rows[0] });
  } catch (err) {
    console.error('Error verificando código:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

/**
 * POST /api/cerraduras/desactivar — Desactivar PIN manualmente
 */
router.post('/desactivar', adminAuth, async (req, res) => {
  try {
    const { reservacion_id } = req.body;
    const { rows } = await pool.query(
      'UPDATE codigos_acceso SET activo = FALSE WHERE reservacion_id = $1 RETURNING *',
      [reservacion_id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Código no encontrado' });
    res.json({ message: 'Código desactivado', codigo: rows[0] });
  } catch (err) {
    console.error('Error desactivando código:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

module.exports = router;
