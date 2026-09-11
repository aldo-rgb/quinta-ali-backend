/**
 * Reservas de La Quinta de Alí para Grupo Rino (manual del socio, "Reservas e ingresos").
 *
 * Dirección de Rino ve el calendario y aparta fechas desde su app. Las reservas
 * viven aquí: Rino pregunta en el momento y no guarda copia.
 *
 *   disponibilidad({ desde, hasta }) → lo que ocupa al menos un día del rango
 *   apartar({ reserva })             → préstamo de día completo, confirmado
 *
 * Lo que aparta Rino es la quinta PRESTADA a familia o conocidos: no paga ni
 * genera contrato. Entra confirmada, con monto $0 (los montos que manden se
 * ignoran) y con el paquete "Prestada Rino · Con noche" o "· Solo día", que es
 * lo único que importa del paquete: si se quedan a dormir. El PIN de acceso se
 * da a mano desde el admin.
 */
const pool = require('../db/connection');
const whatsapp = require('./whatsapp');

const PAQUETE_NOCHE = 'prestada-rino-noche';
const PAQUETE_DIA = 'prestada-rino-dia';
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DIAS_CONSULTA = 400;
const MAX_DIAS_APARTADO = 60;

// Rino entiende: apartada · confirmada · bloqueada
const ESTADO_PARA_RINO = {
  pendiente: 'apartada',
  confirmada: 'confirmada',
  pagada: 'confirmada',
  completada: 'confirmada',
};

function hoyEnMonterrey() {
  // en-CA da AAAA-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Monterrey' }).format(new Date());
}

function fechaLegible(iso) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', timeZone: 'UTC' });
}

function diasEntre(desde, hasta) {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 864e5);
}

/** true / false, o null si Rino no lo dijo. Acepta `se_quedan_a_dormir` o `paquete`. */
function seQuedanADormir(r) {
  const valor = r.se_quedan_a_dormir ?? r.paquete;
  if (valor === true || valor === false) return valor;
  const t = String(valor ?? '').trim().toLowerCase();
  if (['true', 'si', 'sí', 'noche', 'hospedaje', 'premium'].includes(t)) return true;
  if (['false', 'no', 'dia', 'día', 'basico', 'básico'].includes(t)) return false;
  return null;
}

function reservaParaRino(id, estado) {
  return { id: `res-${id}`, estado: ESTADO_PARA_RINO[estado] || estado };
}

async function disponibilidad(cuerpo) {
  const desde = String(cuerpo?.desde ?? '');
  const hasta = String(cuerpo?.hasta ?? '');
  if (!FECHA.test(desde) || !FECHA.test(hasta) || hasta < desde) {
    return { ok: false, resultado: 'no_aplicado', detalle: 'Manden desde y hasta como AAAA-MM-DD, con hasta igual o posterior a desde' };
  }
  if (diasEntre(desde, hasta) > MAX_DIAS_CONSULTA) {
    return { ok: false, resultado: 'no_aplicado', detalle: `El rango no puede pasar de ${MAX_DIAS_CONSULTA} días` };
  }

  // Las fechas salen como texto desde SQL: convertirlas a Date en Node las
  // correría un día por la zona horaria.
  const { rows } = await pool.query(
    `SELECT r.id, r.fecha_evento::text AS fecha_inicio,
            COALESCE(r.fecha_fin, r.fecha_evento)::text AS fecha_fin,
            r.estado, r.num_invitados, r.monto_total, r.monto_pagado, r.tipo_evento,
            p.nombre AS paquete, TRIM(c.nombre || ' ' || COALESCE(c.apellido, '')) AS cliente
       FROM reservaciones r
       JOIN paquetes p ON p.id = r.paquete_id
       JOIN clientes c ON c.id = r.cliente_id
      WHERE r.estado <> 'cancelada'
        AND r.fecha_evento <= $2
        AND COALESCE(r.fecha_fin, r.fecha_evento) >= $1
      ORDER BY r.fecha_evento, r.hora_inicio`,
    [desde, hasta]
  );

  return {
    ok: true,
    ocupado: rows.map((r) => {
      const total = Number(r.monto_total);
      const pagado = Number(r.monto_pagado || 0);
      return {
        ...reservaParaRino(r.id, r.estado),
        fecha_inicio: r.fecha_inicio,
        fecha_fin: r.fecha_fin,
        tipo_evento: r.tipo_evento || r.paquete,
        cliente: r.cliente || null,
        personas: r.num_invitados,
        monto_total: total,
        // Lo cobrado de verdad: es lo que alimenta el control de ingresos de Rino.
        anticipo: pagado,
        saldo: Math.max(total - pagado, 0),
      };
    }),
  };
}

/**
 * El cliente de la reserva. Si el teléfono ya es de un cliente, se reutiliza;
 * si no, se crea. Rino no manda correo y en Quinta es obligatorio y único, así
 * que lleva uno interno que no recibe nada (.invalid es un dominio reservado).
 */
async function clienteParaRino(client, { nombre, telefono, rinoId }) {
  const digitos = (telefono || '').replace(/\D/g, '');
  if (digitos.length >= 10) {
    const { rows } = await client.query(
      `SELECT id FROM clientes
        WHERE telefono IS NOT NULL AND right(regexp_replace(telefono, '\\D', '', 'g'), 10) = $1
        ORDER BY id LIMIT 1`,
      [digitos.slice(-10)]
    );
    if (rows[0]) return rows[0].id;
  }
  const { rows } = await client.query(
    `INSERT INTO clientes (nombre, apellido, email, telefono, es_invitado, notas)
     VALUES ($1, '', $2, $3, TRUE, 'Registrado desde Grupo Rino') RETURNING id`,
    [nombre, `rino-${rinoId.slice(0, 40)}@reservas.quintadeali.invalid`, telefono]
  );
  return rows[0].id;
}

async function apartar(cuerpo) {
  const r = cuerpo?.reserva ?? {};
  const rinoId = String(r.id ?? '').trim().slice(0, 80);
  const inicio = String(r.fecha_inicio ?? '');
  const fin = String(r.fecha_fin || inicio);
  const cliente = String(r.cliente ?? '').trim().slice(0, 100);
  const telefono = String(r.telefono ?? '').trim().slice(0, 20) || null;
  const tipoEvento = String(r.tipo_evento ?? '').trim().slice(0, 80) || null;
  const personas = r.personas === null || r.personas === undefined || r.personas === '' ? null : Number(r.personas);
  const dormir = seQuedanADormir(r);

  // El detalle se le muestra tal cual a quien aparta: va escrito para una persona.
  const error =
    !rinoId ? 'Falta el id de la reserva' :
    !FECHA.test(inicio) || !FECHA.test(fin) ? 'Las fechas van como AAAA-MM-DD' :
    fin < inicio ? 'La fecha final no puede ser antes que la inicial' :
    inicio < hoyEnMonterrey() ? 'No se puede apartar una fecha que ya pasó' :
    diasEntre(inicio, fin) > MAX_DIAS_APARTADO ? `No se pueden apartar más de ${MAX_DIAS_APARTADO} días seguidos` :
    !cliente ? 'Falta el nombre de quien usa la quinta' :
    personas !== null && !(Number.isInteger(personas) && personas >= 0) ? 'Las personas van como número entero' :
    null;
  if (error) return { ok: false, resultado: 'no_aplicado', detalle: error };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Un apartado a la vez: dos solicitudes simultáneas no pasan juntas la revisión de fechas.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('apartar-rino'))`);

    const previa = await client.query('SELECT id, estado FROM reservaciones WHERE rino_reserva_id = $1', [rinoId]);
    if (previa.rows[0]) {
      await client.query('ROLLBACK');
      const { id, estado } = previa.rows[0];
      return { ok: true, resultado: 'duplicado', detalle: `Ya estaba apartada: reservación #${id}`, reserva: reservaParaRino(id, estado) };
    }

    // Día completo: cualquier reservación que toque el rango lo ocupa.
    const choque = await client.query(
      `SELECT fecha_evento::text AS inicio FROM reservaciones
        WHERE estado <> 'cancelada' AND fecha_evento <= $2 AND COALESCE(fecha_fin, fecha_evento) >= $1
        ORDER BY fecha_evento LIMIT 1`,
      [inicio, fin]
    );
    if (choque.rows[0]) {
      await client.query('ROLLBACK');
      const dia = choque.rows[0].inicio > inicio ? choque.rows[0].inicio : inicio;
      return { ok: false, resultado: 'fecha_ocupada', detalle: `El ${fechaLegible(dia)} ya está ocupado en La Quinta de Alí` };
    }

    // Sin dato, con noche: es lo más prevenido para quien prepara la quinta.
    const slug = dormir === false ? PAQUETE_DIA : PAQUETE_NOCHE;
    const paquete = await client.query('SELECT id FROM paquetes WHERE slug = $1', [slug]);
    if (!paquete.rows[0]) throw new Error(`Falta el paquete ${slug}`);

    const clienteId = await clienteParaRino(client, { nombre: cliente, telefono, rinoId });

    const solicita = String(r.solicita ?? '').trim().slice(0, 80);
    const notas = [
      `Prestada por Grupo Rino${solicita ? ` (la pidió ${solicita})` : ''}, sin costo.`,
      `Se quedan a dormir: ${dormir === true ? 'sí' : dormir === false ? 'no' : 'sin especificar'}`,
      tipoEvento ? `Motivo: ${tipoEvento}` : null,
      String(r.notas ?? '').trim() || null,
    ].filter(Boolean).join('\n');

    const { rows } = await client.query(
      `INSERT INTO reservaciones
         (cliente_id, paquete_id, fecha_evento, fecha_fin, hora_inicio, hora_fin, num_invitados,
          estado, monto_total, monto_pagado, notas, tipo_evento, rino_reserva_id)
       VALUES ($1, $2, $3, $4, '00:00', '23:59', $5, 'confirmada', 0, 0, $6, $7, $8)
       RETURNING id`,
      [clienteId, paquete.rows[0].id, inicio, fin, personas, notas, tipoEvento, rinoId]
    );
    await client.query('COMMIT');
    const id = rows[0].id;

    if (process.env.ADMIN_WHATSAPP) {
      whatsapp.enviarMensaje(
        process.env.ADMIN_WHATSAPP,
        `📅 *Grupo Rino prestó la quinta*\n\n` +
          `👤 ${cliente}${telefono ? ` · ${telefono}` : ''}\n` +
          `🗓 ${fechaLegible(inicio)}${fin !== inicio ? ` al ${fechaLegible(fin)}` : ''}\n` +
          `${dormir === false ? '☀️ Solo de día' : dormir === true ? '🌙 Se quedan a dormir' : '🌙 No dijeron si se quedan a dormir'}\n` +
          (personas !== null ? `👥 ${personas} personas\n` : '') +
          `\nReservación #${id}, confirmada y sin costo. Genera su PIN en Admin → Accesos.`
      );
    }

    return {
      ok: true,
      resultado: 'aplicado',
      detalle: `Listo, la quinta queda prestada: reservación #${id}`,
      reserva: reservaParaRino(id, 'confirmada'),
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    // El disparador de empalmes también protege contra una reserva web que entró al mismo tiempo.
    if (String(err.message).startsWith('CONFLICTO')) {
      return { ok: false, resultado: 'fecha_ocupada', detalle: 'Esas fechas ya están ocupadas en La Quinta de Alí' };
    }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { disponibilidad, apartar };
