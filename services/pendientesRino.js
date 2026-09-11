/**
 * Buzón de pendientes con Rino (manual del socio, sección "Buzón de pendientes").
 *
 * Un pendiente no es una tarea: es algo que hay que CONSTRUIR en uno de los dos
 * sistemas ("necesitamos consultar las reservas de la semana"). No le suena el
 * teléfono a nadie en Rino; entra a la lista que revisan al desarrollar.
 *
 *   Quinta → Rino   pendiente.creado    crearPendiente / enviarPendiente
 *   Rino → Quinta   pendiente.creado    recibirPendiente
 *   Rino → Quinta   pendiente.cerrado   cerrarPendienteEnviado (con el id que le dimos)
 */
const crypto = require('crypto');
const pool = require('../db/connection');
const rino = require('./rino');
const whatsapp = require('./whatsapp');

const MAX_INTENTOS = 10;

function textoOpcional(valor, max) {
  if (valor == null) return null;
  const t = String(valor).trim();
  return t ? t.slice(0, max) : null;
}

function avisarAdmin(texto) {
  if (process.env.ADMIN_WHATSAPP) whatsapp.enviarMensaje(process.env.ADMIN_WHATSAPP, texto);
}

async function guardarEnvio(id, { estado, detalle, contar, rotarEvento }) {
  const { rows } = await pool.query(
    `UPDATE pendientes_rino SET
       envio_estado   = $2,
       envio_detalle  = $3,
       envio_intentos = envio_intentos + $4,
       evento_id      = COALESCE($5::uuid, evento_id),
       evento_en      = CASE WHEN $5::uuid IS NULL THEN evento_en ELSE NOW() END,
       actualizado_en = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, estado, detalle, contar ? 1 : 0, rotarEvento ? crypto.randomUUID() : null]
  );
  return rows[0];
}

async function enviarPendiente(id) {
  const { rows } = await pool.query(
    `SELECT * FROM pendientes_rino WHERE id = $1 AND direccion = 'enviado'`,
    [id]
  );
  const p = rows[0];
  if (!p) throw new Error('Pendiente no encontrado');

  if (!rino.configurado()) {
    return guardarEnvio(p.id, {
      estado: 'pendiente',
      detalle: 'El puente con Rino no está configurado (RINO_API_KEY / RINO_WEBHOOK_SECRET). Se enviará en cuanto lo esté.',
      contar: false,
      rotarEvento: false,
    });
  }

  // Estrictos al mandar: los opcionales vacíos no viajan.
  const pendiente = { id: p.ref, peticion: p.peticion };
  if (p.detalle) pendiente.detalle = p.detalle;
  if (p.area) pendiente.area = p.area;
  if (p.quien_pide) pendiente.quien_pide = p.quien_pide;

  const r = await rino.enviarEvento('pendiente.creado', { pendiente }, {
    eventId: p.evento_id,
    occurredAt: new Date(p.evento_en).toISOString(),
  });
  const { estado, rotarEvento } = rino.clasificarEnvio(r);
  return guardarEnvio(p.id, { estado, detalle: r.detalle, contar: true, rotarEvento });
}

async function crearPendiente({ peticion, detalle, area, quienPide }) {
  const { rows } = await pool.query(
    `INSERT INTO pendientes_rino
       (direccion, ref, peticion, detalle, area, quien_pide, envio_estado, evento_id, evento_en)
     VALUES ('enviado', $1, $2, $3, $4, $5, 'pendiente', $6, NOW())
     RETURNING id`,
    [`quinta-${crypto.randomUUID()}`, peticion, detalle, area, quienPide, crypto.randomUUID()]
  );
  return enviarPendiente(rows[0].id);
}

async function reintentarEnvios() {
  if (!rino.configurado()) return { reintentados: 0 };
  const { rows } = await pool.query(
    `SELECT id FROM pendientes_rino
      WHERE direccion = 'enviado' AND envio_estado IN ('pendiente','error') AND envio_intentos < $1
      ORDER BY creado_en LIMIT 20`,
    [MAX_INTENTOS]
  );
  for (const { id } of rows) {
    await enviarPendiente(id);
  }
  return { reintentados: rows.length };
}

/** Rino nos pide algo. Mismo id otra vez = se actualiza, no se duplica. */
async function recibirPendiente(p) {
  const ref = textoOpcional(p?.id, 120);
  const peticion = textoOpcional(p?.peticion, 4000);
  if (!ref) return { ok: false, resultado: 'sin_id', detalle: 'Falta pendiente.id' };
  if (!peticion) return { ok: false, resultado: 'sin_peticion', detalle: 'Falta pendiente.peticion' };

  const { rows } = await pool.query(
    `INSERT INTO pendientes_rino (direccion, ref, peticion, detalle, area, quien_pide)
     VALUES ('recibido', $1, $2, $3, $4, $5)
     ON CONFLICT (direccion, ref) DO UPDATE SET
       peticion = EXCLUDED.peticion, detalle = EXCLUDED.detalle, area = EXCLUDED.area,
       quien_pide = EXCLUDED.quien_pide, actualizado_en = NOW()
     RETURNING (xmax = 0) AS nuevo`,
    [ref, peticion, textoOpcional(p.detalle, 4000), textoOpcional(p.area, 40), textoOpcional(p.quien_pide, 120)]
  );

  const nuevo = rows[0].nuevo;
  if (nuevo) {
    avisarAdmin(`📬 *Rino le pide algo a Quinta de Ali*\n\n${peticion}\n\nEntra al panel admin → Rino → Buzón de pendientes.`);
  }
  return { ok: true, resultado: 'aplicado', detalle: nuevo ? 'creado' : 'actualizado' };
}

/** Rino resolvió uno de los nuestros. */
async function cerrarPendienteEnviado(p) {
  const ref = textoOpcional(p?.id, 120);
  if (!ref) return { ok: false, resultado: 'sin_id', detalle: 'Falta pendiente.id' };

  const motivo = textoOpcional(p.motivo, 4000);
  const cerradoEn = p.cerrado_en && !Number.isNaN(Date.parse(p.cerrado_en))
    ? new Date(p.cerrado_en).toISOString()
    : new Date().toISOString();

  const { rows } = await pool.query(
    `UPDATE pendientes_rino
        SET estado = 'cerrado', motivo_cierre = $2, cerrado_en = $3, actualizado_en = NOW()
      WHERE direccion = 'enviado' AND ref = $1
      RETURNING peticion`,
    [ref, motivo, cerradoEn]
  );
  if (!rows[0]) {
    return { ok: false, resultado: 'no_existe', detalle: `No mandamos ningún pendiente con id ${ref}` };
  }

  avisarAdmin(`✅ *Rino cerró un pendiente de Quinta de Ali*\n\n${rows[0].peticion}` + (motivo ? `\n\n💬 ${motivo}` : ''));
  return { ok: true, resultado: 'aplicado', detalle: 'cerrado' };
}

module.exports = {
  crearPendiente,
  enviarPendiente,
  reintentarEnvios,
  recibirPendiente,
  cerrarPendienteEnviado,
};
