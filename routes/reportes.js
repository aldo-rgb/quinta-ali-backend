const { Router } = require('express');
const pool = require('../db/connection');
const adminAuth = require('../middleware/adminAuth');

const router = Router();

// GET /api/reportes/ingresos-mensuales?meses=6
// Ingresos por mes (reservaciones + extras)
router.get('/ingresos-mensuales', adminAuth, async (req, res) => {
  try {
    const meses = Math.min(parseInt(req.query.meses) || 6, 24);
    const { rows } = await pool.query(
      `SELECT
         TO_CHAR(r.fecha_evento, 'YYYY-MM') AS mes,
         COALESCE(SUM(r.monto_total), 0) AS ingresos_reservaciones,
         COALESCE(SUM(sub.extras_total), 0) AS ingresos_extras
       FROM reservaciones r
       LEFT JOIN (
         SELECT reservacion_id, SUM(subtotal) AS extras_total
         FROM reservacion_extras
         GROUP BY reservacion_id
       ) sub ON sub.reservacion_id = r.id
       WHERE r.estado NOT IN ('cancelada')
         AND r.fecha_evento >= (CURRENT_DATE - ($1 || ' months')::INTERVAL)
       GROUP BY TO_CHAR(r.fecha_evento, 'YYYY-MM')
       ORDER BY mes ASC`,
      [meses]
    );
    res.json(rows);
  } catch (err) {
    console.error('Error ingresos mensuales:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// GET /api/reportes/paquetes-populares
// Paquetes más vendidos (con ingresos)
router.get('/paquetes-populares', adminAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.nombre, p.emoji, COUNT(r.id) AS total_reservaciones,
              COALESCE(SUM(r.monto_total), 0) AS ingresos
       FROM reservaciones r
       JOIN paquetes p ON r.paquete_id = p.id
       WHERE r.estado NOT IN ('cancelada')
       GROUP BY p.id, p.nombre, p.emoji
       ORDER BY total_reservaciones DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error('Error paquetes populares:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// GET /api/reportes/estados
// Distribución por estado
router.get('/estados', adminAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT estado, COUNT(*) AS cantidad
       FROM reservaciones
       GROUP BY estado
       ORDER BY cantidad DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error('Error estados:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// GET /api/reportes/ocupacion-semanal
// Ocupación por día de la semana
router.get('/ocupacion-semanal', adminAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT EXTRACT(DOW FROM fecha_evento) AS dia_num,
              TO_CHAR(fecha_evento, 'Dy') AS dia,
              COUNT(*) AS total
       FROM reservaciones
       WHERE estado NOT IN ('cancelada')
       GROUP BY dia_num, dia
       ORDER BY dia_num`
    );
    const diasES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    res.json(rows.map(r => ({
      dia: diasES[Number(r.dia_num)] || r.dia,
      total: Number(r.total),
    })));
  } catch (err) {
    console.error('Error ocupación semanal:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// GET /api/reportes/extras-populares
// Extras más solicitados
router.get('/extras-populares', adminAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT e.nombre, e.emoji, COUNT(*) AS veces, COALESCE(SUM(re.subtotal), 0) AS ingresos
       FROM reservacion_extras re
       JOIN extras e ON re.extra_id = e.id
       GROUP BY e.id, e.nombre, e.emoji
       ORDER BY veces DESC
       LIMIT 10`
    );
    res.json(rows);
  } catch (err) {
    console.error('Error extras populares:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// GET /api/reportes/resumen
// KPIs generales
router.get('/resumen', adminAuth, async (req, res) => {
  try {
    const hoy = new Date().toISOString().split('T')[0];
    const mesActual = hoy.substring(0, 7) + '-01';
    const mesAnterior = new Date(new Date().setMonth(new Date().getMonth() - 1)).toISOString().substring(0, 7) + '-01';
    const finMesAnterior = mesActual;

    const [totalRes, totalIngresos, ticketPromedio, mesCurrent, mesPrev, totalClientes, tasaCancelacion] = await Promise.all([
      pool.query("SELECT COUNT(*) FROM reservaciones WHERE estado NOT IN ('cancelada')"),
      pool.query("SELECT COALESCE(SUM(monto_total), 0) AS total FROM reservaciones WHERE estado NOT IN ('cancelada')"),
      pool.query("SELECT COALESCE(AVG(monto_total), 0) AS promedio FROM reservaciones WHERE estado NOT IN ('cancelada')"),
      pool.query(
        `SELECT COALESCE(SUM(monto_total), 0) AS total FROM reservaciones
         WHERE fecha_evento >= $1 AND estado NOT IN ('cancelada')`, [mesActual]
      ),
      pool.query(
        `SELECT COALESCE(SUM(monto_total), 0) AS total FROM reservaciones
         WHERE fecha_evento >= $1 AND fecha_evento < $2 AND estado NOT IN ('cancelada')`,
        [mesAnterior, finMesAnterior]
      ),
      pool.query('SELECT COUNT(DISTINCT cliente_id) FROM reservaciones'),
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE estado = 'cancelada') AS canceladas,
           COUNT(*) AS total
         FROM reservaciones`
      ),
    ]);

    const ingresosMesActual = Number(mesCurrent.rows[0].total);
    const ingresosMesPasado = Number(mesPrev.rows[0].total);
    const variacion = ingresosMesPasado > 0
      ? ((ingresosMesActual - ingresosMesPasado) / ingresosMesPasado * 100).toFixed(1)
      : null;

    const cancelData = tasaCancelacion.rows[0];
    const tasaCancel = cancelData.total > 0
      ? (Number(cancelData.canceladas) / Number(cancelData.total) * 100).toFixed(1)
      : '0';

    res.json({
      total_reservaciones: Number(totalRes.rows[0].count),
      ingresos_totales: Number(totalIngresos.rows[0].total),
      ticket_promedio: Number(Number(ticketPromedio.rows[0].promedio).toFixed(2)),
      ingresos_mes_actual: ingresosMesActual,
      ingresos_mes_anterior: ingresosMesPasado,
      variacion_mensual: variacion ? Number(variacion) : null,
      total_clientes: Number(totalClientes.rows[0].count),
      tasa_cancelacion: Number(tasaCancel),
    });
  } catch (err) {
    console.error('Error resumen:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

module.exports = router;
