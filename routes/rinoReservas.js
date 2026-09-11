/**
 * Consultas en el momento de Grupo Rino (manual del socio, "Reservas e ingresos"):
 *   POST /api/rino/disponibilidad   { desde, hasta }
 *   POST /api/rino/reservas         { reserva: { id, fecha_inicio, fecha_fin, cliente, ... } }
 *
 * Firmadas como los eventos (X-Signature sobre el cuerpo crudo). A diferencia
 * del buzón, se contesta con la respuesta y en menos de 15 segundos. Lo que no
 * se puede hacer va con 200 y `ok: false`: Rino le muestra el `detalle` a quien
 * aparta.
 *
 * Se monta en index.js ANTES de express.json(): cada ruta lee el cuerpo crudo.
 * Lo que no sea una de estas dos rutas sigue de largo al resto de /api/rino.
 */
const express = require('express');
const rinoFirma = require('../middleware/rinoFirma');
const reservasRino = require('../services/reservasRino');

const router = express.Router();
const cuerpoCrudo = express.raw({ type: '*/*', limit: '256kb' });

router.post('/disponibilidad', cuerpoCrudo, rinoFirma, async (req, res) => {
  try {
    res.json(await reservasRino.disponibilidad(req.cuerpoRino));
  } catch (err) {
    console.error('Error consultando disponibilidad para Rino:', err.message);
    res.status(500).json({ ok: false, resultado: 'error', detalle: 'No se pudo consultar el calendario de La Quinta de Alí' });
  }
});

router.post('/reservas', cuerpoCrudo, rinoFirma, async (req, res) => {
  try {
    res.json(await reservasRino.apartar(req.cuerpoRino));
  } catch (err) {
    console.error('Error apartando fecha para Rino:', err.message);
    res.status(500).json({ ok: false, resultado: 'error', detalle: 'No se pudo apartar la fecha; inténtalo de nuevo' });
  }
});

module.exports = router;
