/**
 * Migración: Agregar tabla google_reviews_cache
 * Ejecutar: node db/migrate-reviews.js
 */

const pool = require('./connection');

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🔄 Iniciando migración: google_reviews_cache...');

    await client.query(`
      CREATE TABLE IF NOT EXISTS google_reviews_cache (
        id              SERIAL PRIMARY KEY,
        autor_nombre    VARCHAR(150) NOT NULL,
        rating          INT CHECK (rating >= 1 AND rating <= 5),
        texto_en        TEXT NOT NULL,
        texto_es        TEXT,
        texto_es_manual TEXT,
        url_foto        TEXT,
        fuente          VARCHAR(50) DEFAULT 'google',
        externo_id      VARCHAR(255) UNIQUE,
        activo          BOOLEAN DEFAULT TRUE,
        creado_en       TIMESTAMP DEFAULT NOW(),
        actualizado_en  TIMESTAMP DEFAULT NOW()
      );
    `);

    console.log('✅ Tabla google_reviews_cache creada exitosamente');

    // Crear índices
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_reviews_activo ON google_reviews_cache (activo);
      CREATE INDEX IF NOT EXISTS idx_reviews_externo_id ON google_reviews_cache (externo_id);
    `);

    console.log('✅ Índices creados');
  } catch (err) {
    console.error('❌ Error en migración:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

// Ejecutar
migrate()
  .then(() => { console.log('✨ Migración completada'); process.exit(0); })
  .catch(err => { console.error('Migración fallida:', err); process.exit(1); });
