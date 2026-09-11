/**
 * Reseñas locales del QR (/opina).
 *
 * resenas_locales — lo que califican los huéspedes. Se publica en la web solo
 *   cuando el admin la aprueba. Una de 1 a 3 estrellas abre además una queja
 *   (ticket_id). La tabla `resenas` es otra cosa: las solicitudes por WhatsApp
 *   después del evento, hoy en pausa.
 *
 * Se corre al arrancar el servidor (index.js), después de migrate-rino.js
 * (depende de tickets_servicio), y también a mano:
 *   node db/migrate-opiniones.js
 */
async function migrarOpiniones(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS resenas_locales (
      id            SERIAL PRIMARY KEY,
      calificacion  SMALLINT NOT NULL CHECK (calificacion BETWEEN 1 AND 5),
      comentario    TEXT,
      nombre        VARCHAR(80),
      contacto      VARCHAR(160),
      publicada     BOOLEAN NOT NULL DEFAULT FALSE,
      ticket_id     INT REFERENCES tickets_servicio(id) ON DELETE SET NULL,
      creado_en     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      revisada_en   TIMESTAMPTZ
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_resenas_locales_publicadas
      ON resenas_locales(creado_en DESC) WHERE publicada
  `);
}

module.exports = migrarOpiniones;

if (require.main === module) {
  require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
  const pool = require('./connection');
  migrarOpiniones(pool)
    .then(() => { console.log('Tabla resenas_locales lista'); process.exit(0); })
    .catch((e) => { console.error(e.message); process.exit(1); });
}
