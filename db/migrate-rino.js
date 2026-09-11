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
      origen          VARCHAR(20) NOT NULL CHECK (origen IN ('reporte_web','bot_whatsapp','resena')),
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
}

module.exports = migrarRino;

if (require.main === module) {
  require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
  const pool = require('./connection');
  migrarRino(pool)
    .then(() => { console.log('Tablas del puente con Rino listas'); process.exit(0); })
    .catch((e) => { console.error(e.message); process.exit(1); });
}
