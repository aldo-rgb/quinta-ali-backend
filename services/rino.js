/**
 * Cliente HTTP del puente con Rino Living (Grupo Rino).
 *
 * Quinta de Ali es un "socio" más del puente de Rino, igual que EntregaX y la
 * app familiar:
 *   - Manda eventos firmados a  POST {RINO_URL}/api/webhooks/{peer}
 *       X-Api-Key    quién llama
 *       X-Signature  sha256=HMAC del cuerpo CRUDO con RINO_WEBHOOK_SECRET
 *       X-Event-Id   Rino ignora un evento repetido
 *   - Consulta con X-Api-Key    GET  {RINO_URL}/api/sync/tareas | usuarios
 *
 * RINO_URL lleva `www`: sin él Vercel contesta 308 y un POST redirigido pierde
 * las cabeceras. Por eso también `redirect: 'error'` — mejor un error visible
 * que un envío que se pierde en silencio.
 */
const crypto = require('crypto');

const RINO_URL = (process.env.RINO_URL || 'https://www.gruporino.mx').replace(/\/+$/, '');
// Manual del socio: https://www.gruporino.mx/socios/quinta-de-ali
const PEER = process.env.RINO_PEER || 'quinta_ali';
const TIMEOUT_MS = 20000;
const VIDA_CACHE_USUARIOS = 5 * 60 * 1000;

function configurado() {
  return Boolean(process.env.RINO_API_KEY && process.env.RINO_WEBHOOK_SECRET);
}

async function pedir(ruta, opciones = {}) {
  const res = await fetch(`${RINO_URL}${ruta}`, {
    ...opciones,
    headers: { 'X-Api-Key': process.env.RINO_API_KEY || '', ...opciones.headers },
    redirect: 'error',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const texto = await res.text();
  let datos = null;
  try { datos = JSON.parse(texto); } catch { /* respuesta que no es JSON */ }
  return { status: res.status, datos, texto };
}

/**
 * Manda un evento a Rino.
 *
 * Devuelve { registrado, aplicado, resultado, detalle }:
 *   registrado — Rino lo guardó en su bandeja. Reenviar el MISMO X-Event-Id
 *                ya no lo vuelve a aplicar: solo devuelve el resultado guardado.
 *   aplicado   — la tarea quedó creada o actualizada.
 *
 * Rino contesta 200 aunque no lo aplique; el motivo viene en `detalle`.
 */
async function enviarEvento(evento, data, { eventId, occurredAt }) {
  // Se serializa UNA vez: la firma tiene que ir sobre los bytes que se mandan.
  const cuerpo = JSON.stringify({ event: evento, data, occurred_at: occurredAt, source_app: PEER });
  const firma = 'sha256=' + crypto
    .createHmac('sha256', process.env.RINO_WEBHOOK_SECRET)
    .update(cuerpo)
    .digest('hex');

  let respuesta;
  try {
    respuesta = await pedir(`/api/webhooks/${encodeURIComponent(PEER)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Signature': firma, 'X-Event-Id': eventId },
      body: cuerpo,
    });
  } catch (e) {
    return { registrado: false, aplicado: false, resultado: null, detalle: `No se pudo contactar a Rino: ${e.message}` };
  }
  const { status, datos, texto } = respuesta;

  if (status !== 200 || !datos) {
    return {
      registrado: false,
      aplicado: false,
      resultado: null,
      detalle: `HTTP ${status}: ${datos?.error || texto.slice(0, 200)}`,
    };
  }
  return {
    registrado: true,
    aplicado: datos.resultado === 'aplicado',
    resultado: datos.resultado ?? null,
    detalle: datos.detalle || datos.resultado || 'sin detalle',
  };
}

/** Tareas de Quinta que cambiaron en Rino desde `desde` (ISO). Incluye canceladas. */
async function consultarTareas(desde) {
  const { status, datos, texto } = await pedir(`/api/sync/tareas?updated_since=${encodeURIComponent(desde)}`);
  if (status !== 200 || !datos?.ok) {
    throw new Error(`Rino /api/sync/tareas HTTP ${status}: ${datos?.error || texto.slice(0, 200)}`);
  }
  return { tareas: datos.tareas || [], faltan: Boolean(datos.faltan) };
}

let cacheUsuarios = null;

/** Personal de Rino a quien se le puede asignar una tarea: [{ email, nombre, puesto }]. */
async function consultarUsuarios({ fresco = false } = {}) {
  if (!fresco && cacheUsuarios && Date.now() - cacheUsuarios.en < VIDA_CACHE_USUARIOS) {
    return cacheUsuarios.usuarios;
  }
  const { status, datos, texto } = await pedir('/api/sync/usuarios');
  if (status !== 200 || !datos?.ok) {
    throw new Error(`Rino /api/sync/usuarios HTTP ${status}: ${datos?.error || texto.slice(0, 200)}`);
  }
  cacheUsuarios = { en: Date.now(), usuarios: datos.usuarios || [] };
  return cacheUsuarios.usuarios;
}

/** Sonda de Rino: ¿nos conoce como socio y está activo? No valida la llave. */
async function sondear() {
  const { status, datos } = await pedir(`/api/webhooks/${encodeURIComponent(PEER)}`);
  return { http: status, ...(datos || {}) };
}

/**
 * Qué hacer con la respuesta de enviarEvento.
 *   enviada   — entró.
 *   rechazada — Rino dijo por qué: `no_aplicado` (le falta algo) o `no_permitido`
 *               (evento no habilitado para Quinta). Reintentar no lo arregla.
 *   error     — no llegó o falló allá: se reintenta.
 * Si Rino ya lo registró sin aplicarlo, el mismo X-Event-Id devolvería siempre
 * ese resultado, así que el siguiente intento necesita uno nuevo.
 */
function clasificarEnvio(r) {
  if (r.aplicado) return { estado: 'enviada', rotarEvento: false };
  const rechazo = r.resultado === 'no_aplicado' || r.resultado === 'no_permitido';
  return { estado: rechazo ? 'rechazada' : 'error', rotarEvento: r.registrado };
}

/** ¿La firma de un evento que manda Rino corresponde al cuerpo crudo? */
function firmaValida(crudo, recibida) {
  const secreto = process.env.RINO_WEBHOOK_SECRET;
  if (!secreto || !recibida) return false;
  const esperada = Buffer.from('sha256=' + crypto.createHmac('sha256', secreto).update(crudo).digest('hex'));
  const dada = Buffer.from(String(recibida).trim());
  return esperada.length === dada.length && crypto.timingSafeEqual(esperada, dada);
}

module.exports = {
  RINO_URL,
  PEER,
  configurado,
  enviarEvento,
  clasificarEnvio,
  firmaValida,
  consultarTareas,
  consultarUsuarios,
  sondear,
};
