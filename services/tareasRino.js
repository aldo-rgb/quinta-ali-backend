/**
 * Tareas que Quinta de Ali manda a mantenimiento de Rino.
 *
 * Flujo:
 *   1. El admin crea la tarea → se guarda en `tareas_rino` y se intenta enviar.
 *   2. Si Rino no responde, un cron la reintenta (reintentarPendientes).
 *   3. Cada hora se consulta en Rino cómo va (sincronizarTareas): quién la
 *      tiene, si ya se terminó.
 *
 * Rino identifica la tarea por su `id` (external_id), así que mandar la misma
 * tarea dos veces la actualiza en lugar de duplicarla.
 */
const crypto = require('crypto');
const pool = require('../db/connection');
const rino = require('./rino');

const MAX_INTENTOS = 10;
const PAGINAS_SYNC = 10;

function descripcionParaRino(t) {
  return [
    t.descripcion,
    t.area ? `Área: ${t.area}` : null,
    t.ticket_id ? `Viene del reporte de cliente #${t.ticket_id}` : null,
    `(Enviada desde el admin de Quinta de Ali${t.creado_por ? ` por ${t.creado_por}` : ''})`,
  ].filter(Boolean).join('\n\n');
}

function payloadTarea(t) {
  return {
    task: {
      id: t.id,
      title: t.titulo,
      description: descripcionParaRino(t),
      status: t.cancelada ? 'cancelled' : 'open',
      eisenhower: t.prioridad,
      // Si Rino ya la reasignó, se respeta a quien la tiene: al actualizar,
      // Rino reemplaza el responsable por el que llegue aquí.
      assignee_email: t.responsable_rino_email || t.responsable_email || null,
      due_at: t.fecha_limite ? new Date(t.fecha_limite).toISOString() : null,
    },
  };
}

async function guardarEnvio(id, { estado, detalle, contar, rotarEvento }) {
  const { rows } = await pool.query(
    `UPDATE tareas_rino SET
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

async function enviarTarea(id) {
  const { rows } = await pool.query('SELECT * FROM tareas_rino WHERE id = $1', [id]);
  const t = rows[0];
  if (!t) throw new Error('Tarea no encontrada');

  if (!rino.configurado()) {
    return guardarEnvio(t.id, {
      estado: 'pendiente',
      detalle: 'El puente con Rino no está configurado (RINO_API_KEY / RINO_WEBHOOK_SECRET). Se enviará en cuanto lo esté.',
      contar: false,
      rotarEvento: false,
    });
  }

  const r = await rino.enviarEvento(t.cancelada ? 'task.updated' : 'task.created', payloadTarea(t), {
    eventId: t.evento_id,
    occurredAt: new Date(t.evento_en).toISOString(),
  });
  const { estado, rotarEvento } = rino.clasificarEnvio(r);
  return guardarEnvio(t.id, { estado, detalle: r.detalle, contar: true, rotarEvento });
}

/** Reintenta las que no llegaron. Las `rechazada` no: Rino dijo por qué y hay que corregirlas. */
async function reintentarPendientes() {
  if (!rino.configurado()) return { reintentadas: 0 };
  const { rows } = await pool.query(
    `SELECT id FROM tareas_rino
      WHERE envio_estado IN ('pendiente','error') AND envio_intentos < $1
      ORDER BY creado_en LIMIT 20`,
    [MAX_INTENTOS]
  );
  for (const { id } of rows) {
    await enviarTarea(id);
  }
  return { reintentadas: rows.length };
}

/** Trae de Rino el avance de las tareas enviadas. */
async function sincronizarTareas() {
  if (!rino.configurado()) return { actualizadas: 0, omitido: 'puente sin configurar' };

  // Desde el último cambio visto (con 5 min de traslape por diferencias de
  // reloj) o, si nunca se ha sincronizado, desde la primera tarea enviada.
  const { rows } = await pool.query(
    `SELECT COALESCE(MAX(rino_actualizado_en) - INTERVAL '5 minutes',
                     MIN(creado_en) - INTERVAL '1 minute') AS desde
       FROM tareas_rino WHERE envio_estado = 'enviada'`
  );
  if (!rows[0].desde) return { actualizadas: 0 };

  let desde = new Date(rows[0].desde).toISOString();
  let actualizadas = 0;

  for (let pagina = 0; pagina < PAGINAS_SYNC; pagina++) {
    const { tareas, faltan } = await rino.consultarTareas(desde);

    for (const t of tareas) {
      const r = await pool.query(
        `UPDATE tareas_rino SET
           estado_rino = $2, responsable_rino = $3, responsable_rino_email = $4,
           completada_en = $5, rino_actualizado_en = $6, actualizado_en = NOW()
         WHERE id::text = $1
         RETURNING ticket_id`,
        [String(t.id), t.status, t.responsable, t.responsable_email, t.completed_at, t.updated_at]
      );
      if (!r.rowCount) continue;
      actualizadas++;

      const ticketId = r.rows[0].ticket_id;
      if (ticketId && t.terminada) {
        await pool.query(
          `UPDATE tickets_servicio SET estado = 'resuelto', actualizado_en = NOW()
            WHERE id = $1 AND estado = 'enviado_rino'`,
          [ticketId]
        );
      }
    }

    // Rino entrega de 500 en 500; si se llenó, hay más desde la última.
    if (!faltan || tareas.length === 0) break;
    desde = tareas[tareas.length - 1].updated_at;
  }

  return { actualizadas };
}

/**
 * Ligas a las fotos de evidencia de una tarea terminada.
 * Rino las firma por 30 minutos, por eso se piden al momento y no se guardan.
 */
async function comprobantesDe(id) {
  const { rows } = await pool.query(
    'SELECT creado_en, rino_actualizado_en FROM tareas_rino WHERE id = $1',
    [id]
  );
  if (!rows[0]) return null;
  const base = new Date(rows[0].rino_actualizado_en || rows[0].creado_en).getTime() - 60 * 1000;
  const { tareas } = await rino.consultarTareas(new Date(base).toISOString());
  const t = tareas.find((x) => String(x.id) === id);
  return t?.comprobantes_url || [];
}

module.exports = {
  enviarTarea,
  reintentarPendientes,
  sincronizarTareas,
  comprobantesDe,
};
