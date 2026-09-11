/**
 * Tablas del puente con Rino Living.
 *
 * tickets_servicio — lo que reportan los clientes. Hoy llega desde /reporte;
 *   después también el bot de WhatsApp y las reseñas bajas. El admin decide
 *   si se manda a mantenimiento de Rino o se descarta.
 *
 * tareas_rino — cada tarea que Quinta manda a Rino. Su `id` es el
 *   external_id allá: reenviarla actualiza la misma tarea en vez de duplicarla.
 *
 * Se corre al arrancar el servidor (index.js) y también a mano:
 *   node db/migrate-rino.js
 */
async function migrarRino(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tickets_servicio (
      id              SERIAL PRIMARY KEY,
      origen          VARCHAR(20) NOT NULL CHECK (origen IN ('reporte_web','bot_whatsapp','resena','queja')),
      categoria       VARCHAR(60),
      descripcion     TEXT NOT NULL,
      urgencia        VARCHAR(10),
      contacto        VARCHAR(160),
      reservacion_id  INT REFERENCES reservaciones(id) ON DELETE SET NULL,
      estado          VARCHAR(15) NOT NULL DEFAULT 'abierto'
                      CHECK (estado IN ('abierto','enviado_rino','resuelto','descartado')),
      creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tickets_servicio_estado ON tickets_servicio(estado, creado_en DESC)`);
  // Quejas del QR (/opina). Solo se rehace la restricción si todavía no admite 'queja'.
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'tickets_servicio_origen_check' AND pg_get_constraintdef(oid) LIKE '%queja%'
      ) THEN
        ALTER TABLE tickets_servicio DROP CONSTRAINT IF EXISTS tickets_servicio_origen_check;
        ALTER TABLE tickets_servicio ADD CONSTRAINT tickets_servicio_origen_check
          CHECK (origen IN ('reporte_web','bot_whatsapp','resena','queja'));
      END IF;
    END $$
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tareas_rino (
      id                     UUID PRIMARY KEY,
      titulo                 VARCHAR(200) NOT NULL,
      descripcion            TEXT,
      area                   VARCHAR(60),
      prioridad              VARCHAR(10) NOT NULL DEFAULT 'estrella' CHECK (prioridad IN ('fuego','estrella')),
      responsable_email      VARCHAR(160),
      responsable_nombre     VARCHAR(120),
      fecha_limite           TIMESTAMPTZ,
      ticket_id              INT REFERENCES tickets_servicio(id) ON DELETE SET NULL,
      creado_por             VARCHAR(160),
      cancelada              BOOLEAN NOT NULL DEFAULT FALSE,
      envio_estado           VARCHAR(10) NOT NULL DEFAULT 'pendiente'
                             CHECK (envio_estado IN ('pendiente','enviada','rechazada','error')),
      envio_detalle          TEXT,
      envio_intentos         INT NOT NULL DEFAULT 0,
      evento_id              UUID NOT NULL,
      evento_en              TIMESTAMPTZ NOT NULL,
      estado_rino            VARCHAR(30),
      responsable_rino       VARCHAR(120),
      responsable_rino_email VARCHAR(160),
      completada_en          TIMESTAMPTZ,
      rino_actualizado_en    TIMESTAMPTZ,
      creado_en              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      actualizado_en         TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_tareas_rino_por_enviar
      ON tareas_rino(creado_en) WHERE envio_estado IN ('pendiente','error')
  `);
  // Involucrados además del responsable: [{ email, nombre }]. Rino acepta un solo
  // responsable por tarea; los involucrados viajan en task.participants.
  await pool.query(`ALTER TABLE tareas_rino ADD COLUMN IF NOT EXISTS involucrados JSONB NOT NULL DEFAULT '[]'::jsonb`);

  // pendientes_rino — buzón de pendientes (manual del socio): peticiones de
  //   desarrollo entre los dos sistemas. `ref` es el id del contrato: el nuestro
  //   si lo mandamos, el de Rino si lo recibimos. Los campos envio_* solo aplican
  //   a los que mandamos.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pendientes_rino (
      id              SERIAL PRIMARY KEY,
      direccion       VARCHAR(10) NOT NULL CHECK (direccion IN ('enviado','recibido')),
      ref             VARCHAR(120) NOT NULL,
      peticion        TEXT NOT NULL,
      detalle         TEXT,
      area            VARCHAR(40),
      quien_pide      VARCHAR(120),
      estado          VARCHAR(10) NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto','cerrado')),
      motivo_cierre   TEXT,
      cerrado_en      TIMESTAMPTZ,
      envio_estado    VARCHAR(10) CHECK (envio_estado IN ('pendiente','enviada','rechazada','error')),
      envio_detalle   TEXT,
      envio_intentos  INT NOT NULL DEFAULT 0,
      evento_id       UUID,
      evento_en       TIMESTAMPTZ,
      creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (direccion, ref)
    )
  `);

  // rino_eventos — bandeja de lo que Rino nos manda. Se guarda ANTES de
  //   aplicarlo; `event_id` es su X-Event-Id y hace que un reintento no se
  //   aplique dos veces.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rino_eventos (
      event_id      VARCHAR(160) PRIMARY KEY,
      evento        VARCHAR(80),
      payload       JSONB,
      resultado     VARCHAR(30),
      detalle       TEXT,
      recibido_en   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      procesado_en  TIMESTAMPTZ
    )
  `);

  // Reservas que aparta Grupo Rino (services/reservasRino.js): su id, para no
  // apartar dos veces la misma solicitud, y el tipo de evento que mandan.
  await pool.query(`ALTER TABLE reservaciones ADD COLUMN IF NOT EXISTS rino_reserva_id VARCHAR(80)`);
  await pool.query(`ALTER TABLE reservaciones ADD COLUMN IF NOT EXISTS tipo_evento VARCHAR(80)`);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_reservaciones_rino_reserva
      ON reservaciones(rino_reserva_id) WHERE rino_reserva_id IS NOT NULL
  `);

  // Paquetes de lo que presta Rino (familia y conocidos, sin costo): día completo,
  // inactivos para que no salgan en la web, y separados de los paquetes de venta
  // para no contar en ingresos ni en "más vendidos". El paquete solo dice si se
  // quedan a dormir. El primer paquete se llamó "Apartado Rino" y nunca se usó:
  // se renombra en vez de dejarlo suelto.
  await pool.query(`
    UPDATE paquetes
       SET nombre = 'Prestada Rino · Con noche', slug = 'prestada-rino-noche', emoji = '🌙',
           descripcion = 'Quinta prestada por Grupo Rino, sin costo. Se quedan a dormir.'
     WHERE slug = 'apartado-rino'
       AND NOT EXISTS (SELECT 1 FROM paquetes WHERE slug = 'prestada-rino-noche')
  `);
  await pool.query(`
    INSERT INTO paquetes (nombre, descripcion, tipo_duracion, duracion_horas, precio, capacidad_max, activo, slug, emoji, caracteristicas)
    VALUES ('Prestada Rino · Con noche', 'Quinta prestada por Grupo Rino, sin costo. Se quedan a dormir.',
            'noche', NULL, 0, NULL, FALSE, 'prestada-rino-noche', '🌙', '[]'::jsonb),
           ('Prestada Rino · Solo día', 'Quinta prestada por Grupo Rino, sin costo. No se quedan a dormir.',
            'horas', NULL, 0, NULL, FALSE, 'prestada-rino-dia', '☀️', '[]'::jsonb)
    ON CONFLICT (slug) DO NOTHING
  `);
}

module.exports = migrarRino;

if (require.main === module) {
  require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
  const pool = require('./connection');
  migrarRino(pool)
    .then(() => { console.log('Tablas del puente con Rino listas'); process.exit(0); })
    .catch((e) => { console.error(e.message); process.exit(1); });
}
