/**
 * Consultas en el momento de Grupo Rino, firmadas como los eventos (X-Signature
 * sobre el cuerpo crudo). A diferencia del buzón, se contesta con la respuesta y
 * en menos de 15 segundos. Lo que no se puede hacer va con 200 y `ok: false`:
 * Rino le muestra el `detalle` a la persona.
 *
 *   POST /api/rino/disponibilidad     { desde, hasta }             manual, "Reservas e ingresos"
 *   POST /api/rino/reservas           { reserva: { ... } }         manual, "Reservas e ingresos"
 *   POST /api/rino/reservas/cancelar  { reserva: { id, numero, fecha_inicio, fecha_fin, motivo?, solicita? } }
 *   POST /api/rino/servicio-cliente   { desde?, hasta?, estado? }  reportes de clientes
 *
 * Se monta en index.js ANTES de express.json(): cada ruta lee el cuerpo crudo.
 * Lo que no sea una de estas rutas sigue de largo al resto de /api/rino. Ojo:
 * POST /api/rino/reportes es el formulario público de clientes, no una consulta.
 */
const express = require('express');
const rinoFirma = require('../middleware/rinoFirma');
const reservasRino = require('../services/reservasRino');
const reportesRino = require('../services/reportesRino');

const router = express.Router();
const cuerpoCrudo = express.raw({ type: '*/*', limit: '256kb' });

/** Cuerpo crudo → firma → servicio. Si el servicio truena, 500 con un detalle para la persona. */
function consulta(nombre, servicio, detalleError) {
  return [
    cuerpoCrudo,
    rinoFirma,
    async (req, res) => {
      try {
        res.json(await servicio(req.cuerpoRino));
      } catch (err) {
        console.error(`Error en consulta de Rino (${nombre}):`, err.message);
        res.status(500).json({ ok: false, resultado: 'error', detalle: detalleError });
      }
    },
  ];
}

router.post('/disponibilidad', consulta('disponibilidad', reservasRino.disponibilidad,
  'No se pudo consultar el calendario de La Quinta de Alí'));

router.post('/reservas', consulta('reservas', reservasRino.apartar,
  'No se pudo apartar la fecha; inténtalo de nuevo'));

router.post('/reservas/cancelar', consulta('reservas/cancelar', reservasRino.cancelar,
  'No se pudo cancelar la fecha; inténtalo de nuevo'));

router.post('/servicio-cliente', consulta('servicio-cliente', reportesRino.consultar,
  'No se pudieron consultar los reportes de La Quinta de Alí'));

module.exports = router;
