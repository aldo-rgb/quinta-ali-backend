const { Pool } = require('pg');

async function updateTrigger() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    console.log('Conectando a la base de datos...');
    const client = await pool.connect();

    console.log('Eliminando trigger anterior...');
    await client.query('DROP TRIGGER IF EXISTS trg_verificar_disponibilidad ON reservaciones');

    console.log('Actualizando función verificar_disponibilidad...');
    await client.query(`
      CREATE OR REPLACE FUNCTION verificar_disponibilidad()
      RETURNS TRIGGER AS $$
      DECLARE
          fecha_fin_nueva DATE;
      BEGIN
          fecha_fin_nueva := COALESCE(NEW.fecha_fin, NEW.fecha_evento);
          
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

    console.log('Recreando trigger...');
    await client.query(`
      CREATE TRIGGER trg_verificar_disponibilidad
          BEFORE INSERT OR UPDATE ON reservaciones
          FOR EACH ROW
          EXECUTE FUNCTION verificar_disponibilidad();
    `);

    console.log('✅ Trigger actualizado exitosamente en la base de datos');
    client.release();
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

updateTrigger();
