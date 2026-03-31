require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('./connection');

async function fixFechaFin() {
  try {
    console.log('🔨 Agregando columna fecha_fin a reservaciones...');
    
    await pool.query(`
      ALTER TABLE reservaciones 
      ADD COLUMN IF NOT EXISTS fecha_fin DATE
    `);
    
    console.log('✅ Columna fecha_fin agregada exitosamente');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

fixFechaFin();
