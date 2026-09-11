/**
 * Puente con Rino Living — rutas.
 *
 * Pública:
 *   POST  /api/rino/reportes                — formulario "Ayuda y Soporte" (/reporte); se manda solo a mantenimiento
 * Admin:
 *   GET   /api/rino/estado                  — ¿configurado? ¿Rino nos reconoce?
 *   GET   /api/rino/usuarios                — personal de Rino para asignar
 *   GET   /api/rino/tickets                 — reportes de clientes
 *   PATCH /api/rino/tickets/:id             — resolver / descartar / reabrir
 *   GET   /api/rino/tareas                  — tareas mandadas a Rino
 *   POST  /api/rino/tareas                  — mandar tarea a mantenimiento
 *   POST  /api/rino/tareas/:id/reenviar
 *   POST  /api/rino/tareas/:id/cancelar
 *   GET   /api/rino/tareas/:id/comprobantes — fotos de evidencia (ligas temporales)
 *   POST  /api/rino/sincronizar             — reintentar envíos y traer avance ahora
 *   GET   /api/rino/pendientes              — buzón de pendientes (los dos sentidos)
 *   POST  /api/rino/pendientes              — pedirle algo a Rino
 *   POST  /api/rino/pendientes/url-eventos  — darle a Rino nuestra URL de eventos
 *   POST  /api/rino/pendientes/:id/reenviar
 *   PATCH /api/rino/pendientes/:id          — marcar atendido uno que pidió Rino
 *
 * El receptor de eventos de Rino (POST /api/rino/eventos) vive en rinoEventos.js.
 */
const { Router } = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const pool = require('../db/connection');
const adminAuth = require('../middleware/adminAuth');
const rino = require('../services/rino');
const tareasRino = require('../services/tareasRino');
const pendientesRino = require('../services/pendientesRino');
const { crearTicket } = require('../services/ticketsServicio');

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A quién le llegan en Rino los reportes de clientes (/reporte), por correo del
// personal de Rino. De fábrica: Ivan Berlanga responsable y Sabino Hernadez involucrado.
const REPORTES_RESPONSABLE =
  String(process.env.RINO_REPORTES_RESPONSABLE ?? 'elgozt96@gmail.com').trim().toLowerCase() || null;
const REPORTES_INVOLUCRADOS = String(process.env.RINO_REPORTES_INVOLUCRADOS ?? 'hernandezsabino613@gmail.com')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

const reporteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { message: 'Demasiados reportes seguidos. Intenta de nuevo en unos minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
});

function texto(valor, max) {
  return String(valor ?? '').trim().slice(0, max);
}

// POST /api/rino/reportes — un cliente reporta un problema en La Quinta
router.post('/reportes', reporteLimiter, async (req, res) => {
  try {
    const area = texto(req.body?.area, 60);
    const problema = texto(req.body?.problema, 2000);
    const contacto = texto(req.body?.contacto, 160) || null;
    if (!area || !problema) {
      return res.status(400).json({ message: 'Indica el área y describe el problema' });
    }

    const id = await crearTicket({ origen: 'reporte_web', categoria: area, descripcion: problema, contacto });
    res.status(201).json({ ok: true, id });

    // Directo a mantenimiento de Rino, sin esperar al admin ni hacer esperar al
    // cliente. Si falla, el reporte queda abierto en el admin para mandarlo a mano.
    tareasRino.crearTarea({
      titulo: `${area}: ${problema}`.slice(0, 120),
      descripcion: contacto ? `${problema}\n\nContacto del cliente: ${contacto}` : problema,
      area,
      prioridad: 'fuego',
      responsableEmail: REPORTES_RESPONSABLE,
      involucradosEmails: REPORTES_INVOLUCRADOS,
      ticketId: id,
      creadoPor: tareasRino.CREADO_AUTOMATICO,
    }).catch((err) => console.error(`Error mandando el reporte #${id} a Rino:`, err.message));
  } catch (err) {
    console.error('Error guardando reporte de cliente:', err.message);
    res.status(500).json({ message: 'No se pudo guardar el reporte' });
  }
});

// GET /api/rino/estado
router.get('/estado', adminAuth, async (req, res) => {
  const estado = {
    configurado: rino.configurado(),
    peer: rino.PEER,
    url: rino.RINO_URL,
    url_eventos: urlEventos(req),
    sonda: null,
  };
  if (estado.configurado) {
    try {
      estado.sonda = await rino.sondear();
    } catch (err) {
      estado.sonda = { ok: false, detalle: err.message };
    }
  }
  res.json(estado);
});

// GET /api/rino/usuarios
router.get('/usuarios', adminAuth, async (req, res) => {
  if (!rino.configurado()) {
    return res.status(503).json({ message: 'El puente con Rino no está configurado' });
  }
  try {
    res.json(await rino.consultarUsuarios({ fresco: req.query.fresco === '1' }));
  } catch (err) {
    console.error('Error consultando personal de Rino:', err.message);
    res.status(502).json({ message: 'No se pudo consultar el personal de Rino' });
  }
});

// GET /api/rino/tickets?estado=abierto
router.get('/tickets', adminAuth, async (req, res) => {
  try {
    const estado = req.query.estado ? String(req.query.estado) : null;
    const { rows } = await pool.query(
      `SELECT t.*,
              (SELECT r.id FROM tareas_rino r WHERE r.ticket_id = t.id
                ORDER BY r.creado_en DESC LIMIT 1) AS tarea_id
         FROM tickets_servicio t
        WHERE $1::text IS NULL OR t.estado = $1
        ORDER BY t.creado_en DESC
        LIMIT 100`,
      [estado]
    );
    res.json(rows);
  } catch (err) {
    console.error('Error listando reportes de clientes:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// PATCH /api/rino/tickets/:id  { estado }
router.patch('/tickets/:id', adminAuth, async (req, res) => {
  const id = Number(req.params.id);
  const estado = req.body?.estado;
  if (!Number.isInteger(id) || !['abierto', 'resuelto', 'descartado'].includes(estado)) {
    return res.status(400).json({ message: 'Estado inválido' });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE tickets_servicio SET estado = $2, actualizado_en = NOW() WHERE id = $1 RETURNING *`,
      [id, estado]
    );
    if (!rows[0]) return res.status(404).json({ message: 'Reporte no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error actualizando reporte de cliente:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// GET /api/rino/tareas
router.get('/tareas', adminAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM tareas_rino ORDER BY creado_en DESC LIMIT 100`);
    res.json(rows);
  } catch (err) {
    console.error('Error listando tareas de Rino:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// POST /api/rino/tareas — mandar una tarea a mantenimiento de Rino
router.post('/tareas', adminAuth, async (req, res) => {
  try {
    const titulo = texto(req.body?.titulo, 200);
    if (!titulo) return res.status(400).json({ message: 'La tarea necesita un título' });

    const descripcion = texto(req.body?.descripcion, 4000) || null;
    const area = texto(req.body?.area, 60) || null;
    const prioridad = req.body?.prioridad === 'fuego' ? 'fuego' : 'estrella';
    const responsableEmail = texto(req.body?.responsable_email, 160).toLowerCase() || null;

    let fechaLimite = null;
    if (req.body?.fecha_limite) {
      const d = new Date(req.body.fecha_limite);
      if (Number.isNaN(d.getTime())) return res.status(400).json({ message: 'Fecha límite inválida' });
      fechaLimite = d.toISOString();
    }

    let ticketId = null;
    if (req.body?.ticket_id != null && req.body.ticket_id !== '') {
      ticketId = Number(req.body.ticket_id);
      const existe = Number.isInteger(ticketId)
        && (await pool.query('SELECT 1 FROM tickets_servicio WHERE id = $1', [ticketId])).rowCount;
      if (!existe) return res.status(404).json({ message: 'El reporte de cliente no existe' });
    }

    // Solo se puede asignar a quien aparece en la lista de Rino que ve el admin.
    if (responsableEmail && rino.configurado()) {
      try {
        const usuarios = await rino.consultarUsuarios();
        if (!usuarios.some((x) => String(x.email).toLowerCase() === responsableEmail)) {
          return res.status(400).json({ message: 'Esa persona ya no aparece en el personal de Rino. Actualiza la lista.' });
        }
      } catch {
        // Sin lista se manda igual: si Rino no reconoce el correo, la deja
        // sin responsable y le avisa a Dirección.
      }
    }

    res.status(201).json(await tareasRino.crearTarea({
      titulo, descripcion, area, prioridad, responsableEmail, fechaLimite, ticketId,
      creadoPor: req.admin?.email || null,
    }));
  } catch (err) {
    console.error('Error creando tarea para Rino:', err.message);
    res.status(500).json({ message: 'No se pudo crear la tarea' });
  }
});

// POST /api/rino/tareas/:id/reenviar
router.post('/tareas/:id/reenviar', adminAuth, async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(404).json({ message: 'Tarea no encontrada' });
  try {
    const { rows } = await pool.query('SELECT envio_estado FROM tareas_rino WHERE id = $1', [id]);
    if (!rows[0]) return res.status(404).json({ message: 'Tarea no encontrada' });
    if (rows[0].envio_estado === 'enviada') {
      return res.status(409).json({ message: 'Esta tarea ya está en Rino' });
    }
    res.json(await tareasRino.enviarTarea(id));
  } catch (err) {
    console.error('Error reenviando tarea a Rino:', err.message);
    res.status(500).json({ message: 'No se pudo reenviar la tarea' });
  }
});

// POST /api/rino/tareas/:id/cancelar
router.post('/tareas/:id/cancelar', adminAuth, async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(404).json({ message: 'Tarea no encontrada' });
  try {
    const { rows } = await pool.query('SELECT cancelada, estado_rino FROM tareas_rino WHERE id = $1', [id]);
    if (!rows[0]) return res.status(404).json({ message: 'Tarea no encontrada' });
    if (rows[0].cancelada) return res.status(409).json({ message: 'La tarea ya estaba cancelada' });
    if (rows[0].estado_rino === 'completed') {
      return res.status(409).json({ message: 'Rino ya terminó esta tarea; no se puede cancelar' });
    }

    // Se manda a Rino aunque la creación nunca haya llegado: si sí llegó y no
    // nos enteramos, así queda cancelada allá también.
    await pool.query(
      `UPDATE tareas_rino SET cancelada = TRUE, envio_estado = 'pendiente', envio_intentos = 0,
              evento_id = $2, evento_en = NOW(), actualizado_en = NOW()
        WHERE id = $1`,
      [id, crypto.randomUUID()]
    );
    res.json(await tareasRino.enviarTarea(id));
  } catch (err) {
    console.error('Error cancelando tarea en Rino:', err.message);
    res.status(500).json({ message: 'No se pudo cancelar la tarea' });
  }
});

// GET /api/rino/tareas/:id/comprobantes
router.get('/tareas/:id/comprobantes', adminAuth, async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(404).json({ message: 'Tarea no encontrada' });
  if (!rino.configurado()) {
    return res.status(503).json({ message: 'El puente con Rino no está configurado' });
  }
  try {
    const comprobantes = await tareasRino.comprobantesDe(id);
    if (comprobantes === null) return res.status(404).json({ message: 'Tarea no encontrada' });
    res.json({ comprobantes });
  } catch (err) {
    console.error('Error consultando comprobantes en Rino:', err.message);
    res.status(502).json({ message: 'No se pudieron consultar las fotos en Rino' });
  }
});

// POST /api/rino/sincronizar
router.post('/sincronizar', adminAuth, async (req, res) => {
  try {
    const { reintentadas } = await tareasRino.reintentarPendientes();
    const { reintentados } = await pendientesRino.reintentarEnvios();
    const sync = await tareasRino.sincronizarTareas();
    res.json({ reintentadas: reintentadas + reintentados, ...sync });
  } catch (err) {
    console.error('Error sincronizando con Rino:', err.message);
    res.status(502).json({ message: 'No se pudo sincronizar con Rino' });
  }
});

// ── Buzón de pendientes ──────────────────────────────────────────────────────
// Peticiones de desarrollo entre los dos sistemas; no son tareas de mantenimiento.

/** La URL pública de nuestro receptor. BACKEND_URL manda; si no, se deduce de la petición. */
function urlEventos(req) {
  const proto = String(req.get('x-forwarded-proto') || req.protocol).split(',')[0].trim();
  const base = process.env.BACKEND_URL || `${proto}://${req.get('x-forwarded-host') || req.get('host')}`;
  return `${base.replace(/\/+$/, '')}/api/rino/eventos`;
}

// GET /api/rino/pendientes
router.get('/pendientes', adminAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM pendientes_rino ORDER BY (estado = 'abierto') DESC, creado_en DESC LIMIT 100`
    );
    res.json(rows);
  } catch (err) {
    console.error('Error listando pendientes con Rino:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// POST /api/rino/pendientes  { peticion, detalle, area, quien_pide }
router.post('/pendientes', adminAuth, async (req, res) => {
  try {
    const peticion = texto(req.body?.peticion, 500);
    if (!peticion) return res.status(400).json({ message: 'Escribe qué hace falta' });

    const pendiente = await pendientesRino.crearPendiente({
      peticion,
      detalle: texto(req.body?.detalle, 4000) || null,
      area: texto(req.body?.area, 40) || null,
      quienPide: texto(req.body?.quien_pide, 120) || req.admin?.email || null,
    });
    res.status(201).json(pendiente);
  } catch (err) {
    console.error('Error creando pendiente para Rino:', err.message);
    res.status(500).json({ message: 'No se pudo crear el pendiente' });
  }
});

// POST /api/rino/pendientes/url-eventos — paso 4 del manual
router.post('/pendientes/url-eventos', adminAuth, async (req, res) => {
  const url = urlEventos(req);
  if (!url.startsWith('https://')) {
    return res.status(400).json({
      message: `La URL de eventos tiene que ser pública y https (desde aquí sería ${url}). Mándala desde producción o configura BACKEND_URL.`,
    });
  }
  try {
    const pendiente = await pendientesRino.crearPendiente({
      peticion: `Nuestra URL de eventos es ${url}`,
      detalle:
        'Acepta POST firmado con el secreto compartido (X-Signature: sha256=HMAC del cuerpo crudo) y X-Event-Id. ' +
        'Contesta 200 { ok, resultado: "aplicado" | "duplicado" }. Hoy procesa pendiente.creado y pendiente.cerrado; ' +
        'otros eventos se guardan y contesta ok. GET a la misma URL sirve de sonda.',
      area: 'conexion',
      quienPide: req.admin?.email || null,
    });
    res.status(201).json(pendiente);
  } catch (err) {
    console.error('Error mandando URL de eventos a Rino:', err.message);
    res.status(500).json({ message: 'No se pudo mandar la URL de eventos' });
  }
});

// POST /api/rino/pendientes/:id/reenviar
router.post('/pendientes/:id/reenviar', adminAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(404).json({ message: 'Pendiente no encontrado' });
  try {
    const { rows } = await pool.query('SELECT direccion, envio_estado FROM pendientes_rino WHERE id = $1', [id]);
    if (!rows[0] || rows[0].direccion !== 'enviado') {
      return res.status(404).json({ message: 'Pendiente no encontrado' });
    }
    if (rows[0].envio_estado === 'enviada') {
      return res.status(409).json({ message: 'Este pendiente ya está en Rino' });
    }
    res.json(await pendientesRino.enviarPendiente(id));
  } catch (err) {
    console.error('Error reenviando pendiente a Rino:', err.message);
    res.status(500).json({ message: 'No se pudo reenviar el pendiente' });
  }
});

// PATCH /api/rino/pendientes/:id  { motivo } — marcar atendido uno que pidió Rino.
// Solo se marca aquí: el manual todavía no define un evento para avisarle a Rino.
router.patch('/pendientes/:id', adminAuth, async (req, res) => {
  const id = Number(req.params.id);
  const motivo = texto(req.body?.motivo, 1000);
  if (!Number.isInteger(id)) return res.status(404).json({ message: 'Pendiente no encontrado' });
  if (!motivo) return res.status(400).json({ message: 'Escribe cómo se resolvió' });
  try {
    const { rows } = await pool.query(
      `UPDATE pendientes_rino
          SET estado = 'cerrado', motivo_cierre = $2, cerrado_en = NOW(), actualizado_en = NOW()
        WHERE id = $1 AND direccion = 'recibido' AND estado = 'abierto'
        RETURNING *`,
      [id, motivo]
    );
    if (!rows[0]) return res.status(404).json({ message: 'No hay un pendiente abierto de Rino con ese id' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error cerrando pendiente de Rino:', err.message);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

module.exports = router;
