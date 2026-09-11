/**
 * Receptor de eventos de Rino Living — la "URL de eventos" de Quinta de Ali.
 *
 * Rino nos manda POST firmados (manual del socio, "Recibir nuestros eventos"):
 *   X-Event-Id   grupo-rino-<id>; un reintento trae el mismo
 *   X-Signature  sha256=HMAC del cuerpo crudo con el secreto compartido
 *
 * Contestamos 200 { ok, resultado, detalle }. Rino lee el cuerpo: `ok: false`
 * o un resultado distinto de aplicado / duplicado / ok cuenta como no entregado
 * y lo reintenta hasta 8 veces.
 *
 * El evento se GUARDA antes de aplicarse (rino_eventos): uno guardado se puede
 * revisar o reprocesar; uno rechazado sin rastro no.
 *
 * Se monta en index.js ANTES de express.json(): la firma va sobre los bytes
 * exactos, y volver a serializar el JSON los cambia.
 */
const { Router } = require('express');
const pool = require('../db/connection');
const rino = require('../services/rino');
const rinoFirma = require('../middleware/rinoFirma');
const pendientesRino = require('../services/pendientesRino');
const tareasRino = require('../services/tareasRino');

const router = Router();

const YA_APLICADO = ['aplicado', 'ok'];

async function aplicar(nombre, data) {
  switch (nombre) {
    case 'pendiente.creado':
    case 'pendiente.solicitado':
      return pendientesRino.recibirPendiente(data.pendiente ?? data);
    case 'pendiente.cerrado':
      return pendientesRino.cerrarPendienteEnviado(data.pendiente ?? data);
    default:
      if (/^(tarea|task)\./.test(nombre)) {
        // Algo cambió en una tarea nuestra: se trae el avance sin esperar al cron.
        tareasRino.sincronizarTareas()
          .catch((e) => console.error('Error sincronizando tareas tras evento de Rino:', e.message));
        return { ok: true, resultado: 'ok', detalle: 'Recibido; se consulta el avance de las tareas' };
      }
      // Tolerantes al recibir: queda guardado para cuando exista el código.
      return { ok: true, resultado: 'ok', detalle: `"${nombre}" guardado; todavía no se procesa` };
  }
}

// GET /api/rino/eventos — sonda: la URL existe y tiene secreto para verificar
router.get('/', (req, res) => {
  res.json({ ok: true, receptor: rino.PEER, configurado: Boolean(process.env.RINO_WEBHOOK_SECRET) });
});

// POST /api/rino/eventos
router.post('/', rinoFirma, async (req, res) => {
  const eventId = String(req.get('x-event-id') || '').trim().slice(0, 160);
  if (!eventId) {
    return res.status(400).json({ ok: false, resultado: 'sin_event_id', detalle: 'Falta X-Event-Id' });
  }

  const evento = req.cuerpoRino;
  const nombre = String(evento?.event ?? evento?.evento ?? '').slice(0, 80);

  try {
    const previo = await pool.query('SELECT resultado FROM rino_eventos WHERE event_id = $1', [eventId]);
    if (previo.rows[0] && YA_APLICADO.includes(previo.rows[0].resultado)) {
      return res.json({ ok: true, resultado: 'duplicado', detalle: 'Ya teníamos ese X-Event-Id' });
    }

    // Guardar ANTES de aplicar. Si antes falló, el reintento se vuelve a procesar.
    await pool.query(
      `INSERT INTO rino_eventos (event_id, evento, payload) VALUES ($1, $2, $3)
       ON CONFLICT (event_id) DO UPDATE SET recibido_en = NOW(), payload = EXCLUDED.payload`,
      [eventId, nombre, evento]
    );

    let r;
    try {
      r = await aplicar(nombre, evento?.data ?? evento?.payload ?? {});
    } catch (err) {
      r = { ok: false, resultado: 'error', detalle: err.message };
    }

    await pool.query(
      `UPDATE rino_eventos SET resultado = $2, detalle = $3, procesado_en = NOW() WHERE event_id = $1`,
      [eventId, r.resultado, r.detalle]
    );
    res.json(r);
  } catch (err) {
    console.error('Error recibiendo evento de Rino:', err.message);
    res.status(500).json({ ok: false, resultado: 'error', detalle: 'No se pudo guardar el evento' });
  }
});

module.exports = router;
