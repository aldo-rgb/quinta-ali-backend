require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('./connection');

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🔄 Iniciando migración: agregar columna archivada...');

    // Agregar columna archivada si no existe
    await client.query(`
      ALTER TABLE reservaciones
      ADD COLUMN IF NOT EXISTS archivada BOOLEAN DEFAULT FALSE;
    `);

    console.log('✅ Columna archivada agregada exitosamente');

    // Crear índice para búsquedas rápidas
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_reservaciones_archivada ON reservaciones (archivada)
      WHERE archivada = FALSE;
    `);

    console.log('✅ Índice creado para búsquedas rápidas');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error en migración:', err.message);
    process.exit(1);
  } finally {
    client.release();
  }
}

migrate();
