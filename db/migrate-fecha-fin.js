require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('./connection');

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🔄 Iniciando migración: agregar columna fecha_fin...');

    // Agregar columna fecha_fin si no existe
    await client.query(`
      ALTER TABLE reservaciones
      ADD COLUMN IF NOT EXISTS fecha_fin DATE;
    `);

    console.log('✅ Columna fecha_fin agregada exitosamente');

    // Actualizar filas existentes: si no tienen fecha_fin, usar fecha_evento
    await client.query(`
      UPDATE reservaciones 
      SET fecha_fin = fecha_evento 
      WHERE fecha_fin IS NULL;
    `);

    console.log('✅ Valores por defecto asignados');

    // Hacer fecha_fin NOT NULL
    await client.query(`
      ALTER TABLE reservaciones
      ALTER COLUMN fecha_fin SET NOT NULL;
    `);

    console.log('✅ Columna fecha_fin configurada como NOT NULL');

    // Crear índice para búsquedas de disponibilidad
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_reservaciones_fecha_fin ON reservaciones (fecha_fin)
      WHERE estado NOT IN ('cancelada');
    `);

    console.log('✅ Índice creado para búsquedas de disponibilidad');
    
    // Recrear trigger para asegurar que use la columna
    await client.query(`
      DROP TRIGGER IF EXISTS trg_verificar_disponibilidad ON reservaciones;
    `);

    await client.query(`
      CREATE OR REPLACE FUNCTION verificar_disponibilidad()
      RETURNS TRIGGER AS $$
      DECLARE
          fecha_fin_nueva DATE;
      BEGIN
          -- Definir rango de fecha de la nueva reservación
          fecha_fin_nueva := COALESCE(NEW.fecha_fin, NEW.fecha_evento);
          
          -- Verificar solapamiento de rangos de fechas
          IF EXISTS (
              SELECT 1 FROM reservaciones
              WHERE id != COALESCE(NEW.id, 0)
                AND estado NOT IN ('cancelada')
                AND fecha_evento <= fecha_fin_nueva
                AND COALESCE(fecha_fin, fecha_evento) >= NEW.fecha_evento
                AND (
                    fecha_evento != NEW.fecha_evento
                    OR (NEW.hora_inicio, NEW.hora_fin) OVERLAPS (hora_inicio, hora_fin)
                )
          ) THEN
              RAISE EXCEPTION 'CONFLICTO: El rango %-% conflictúa con una reservación existente',
                  NEW.fecha_evento, fecha_fin_nueva;
          END IF;
          RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await client.query(`
      CREATE TRIGGER trg_verificar_disponibilidad
          BEFORE INSERT OR UPDATE ON reservaciones
          FOR EACH ROW
          EXECUTE FUNCTION verificar_disponibilidad();
    `);

    console.log('✅ Trigger recreado exitosamente');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error en migración:', err.message);
    process.exit(1);
  } finally {
    client.release();
  }
}

migrate();
