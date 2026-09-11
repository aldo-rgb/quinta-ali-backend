/**
 * Reportes de clientes para Grupo Rino (servicio a cliente).
 *
 * Rino administra La Quinta de Alí y lee lo que reportan los clientes sin entrar
 * al admin de Quinta. Pregunta en el momento, como el calendario:
 *   consultar({ desde, hasta, estado }) → reportes, con la tarea de Rino ligada si la hay
 *
 * Hoy los reportes llegan desde /reporte (origen reporte_web); tickets_servicio
 * ya admite bot_whatsapp y resena para cuando se conecten.
 */
const pool = require('../db/connection');

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const ESTADOS = ['abierto', 'enviado_rino', 'resuelto', 'descartado'];
const DIAS_POR_DEFECTO = 90;
const MAX_DIAS = 400;
const TOPE = 200;

// Días de calendario en hora de Monterrey: un reporte de las 11 pm es de ese día, no del siguiente.
const DESDE_SQL = `(($1::date)::timestamp AT TIME ZONE 'America/Monterrey')`;
const HASTA_SQL = `((($2::date) + 1)::timestamp AT TIME ZONE 'America/Monterrey')`;

function fechaEnMonterrey(fecha) {
  // en-CA da AAAA-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Monterrey' }).format(fecha);
}

async function consultar(cuerpo) {
  const hasta = String(cuerpo?.hasta || fechaEnMonterrey(new Date()));
  const desde = String(cuerpo?.desde || fechaEnMonterrey(new Date(Date.now() - DIAS_POR_DEFECTO * 864e5)));
  const estado = cuerpo?.estado ? String(cuerpo.estado) : null;

  if (!FECHA.test(desde) || !FECHA.test(hasta) || hasta < desde) {
    return { ok: false, resultado: 'no_aplicado', detalle: 'desde y hasta van como AAAA-MM-DD, con hasta igual o posterior a desde' };
  }
  if ((Date.parse(hasta) - Date.parse(desde)) / 864e5 > MAX_DIAS) {
    return { ok: false, resultado: 'no_aplicado', detalle: `El rango no puede pasar de ${MAX_DIAS} días` };
  }
  if (estado && !ESTADOS.includes(estado)) {
    return { ok: false, resultado: 'no_aplicado', detalle: `estado va como ${ESTADOS.join(', ')}` };
  }

  const [lista, conteo] = await Promise.all([
    pool.query(
      `SELECT t.id, t.origen, t.categoria, t.descripcion, t.urgencia, t.contacto, t.reservacion_id,
              t.estado, t.creado_en, t.actualizado_en,
              r.id AS tarea_id, r.titulo AS tarea_titulo, r.estado_rino, r.envio_estado,
              COALESCE(r.responsable_rino, r.responsable_nombre) AS responsable,
              COALESCE(r.responsable_rino_email, r.responsable_email) AS responsable_email
         FROM tickets_servicio t
         LEFT JOIN LATERAL (
           SELECT * FROM tareas_rino x WHERE x.ticket_id = t.id ORDER BY x.creado_en DESC LIMIT 1
         ) r ON TRUE
        WHERE t.creado_en >= ${DESDE_SQL}
          AND t.creado_en <  ${HASTA_SQL}
          AND ($3::text IS NULL OR t.estado = $3)
        ORDER BY t.creado_en DESC
        LIMIT ${TOPE}`,
      [desde, hasta, estado]
    ),
    pool.query(
      `SELECT estado, COUNT(*)::int AS n FROM tickets_servicio
        WHERE creado_en >= ${DESDE_SQL} AND creado_en < ${HASTA_SQL}
        GROUP BY estado`,
      [desde, hasta]
    ),
  ]);

  const resumen = Object.fromEntries(ESTADOS.map((e) => [e, 0]));
  for (const { estado: e, n } of conteo.rows) resumen[e] = n;

  return {
    ok: true,
    desde,
    hasta,
    reportes: lista.rows.map((t) => ({
      id: `rep-${t.id}`,
      origen: t.origen,
      area: t.categoria,
      descripcion: t.descripcion,
      urgencia: t.urgencia,
      contacto: t.contacto,
      reserva_id: t.reservacion_id ? `res-${t.reservacion_id}` : null,
      estado: t.estado,
      creado_en: t.creado_en,
      actualizado_en: t.actualizado_en,
      // La tarea que Quinta le mandó a Rino por este reporte; su id es el external_id allá.
      tarea: t.tarea_id
        ? {
            id: t.tarea_id,
            titulo: t.tarea_titulo,
            estado: t.estado_rino,
            llego_a_rino: t.envio_estado === 'enviada',
            responsable: t.responsable,
            responsable_email: t.responsable_email,
          }
        : null,
    })),
    resumen,
    // Si se llenó el tope quedan más: hay que pedir un rango más corto.
    faltan: lista.rows.length === TOPE,
  };
}

module.exports = { consultar };
