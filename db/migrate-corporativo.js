require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('./connection');

async function migrate() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS leads_corporativos (
        id              SERIAL PRIMARY KEY,
        folio           VARCHAR(30) UNIQUE NOT NULL,
        empresa         VARCHAR(200) NOT NULL,
        contacto        VARCHAR(150) NOT NULL,
        email           VARCHAR(150) NOT NULL,
        telefono        VARCHAR(20),
        num_empleados   VARCHAR(50),
        rfc             VARCHAR(20),
        razon_social    VARCHAR(250),
        fecha_evento    DATE,
        paquete_base    VARCHAR(100),
        num_asistentes  INT,
        notas           TEXT,
        subtotal        DECIMAL(10,2),
        iva             DECIMAL(10,2),
        total           DECIMAL(10,2),
        pdf_url         TEXT,
        reservacion_id  INT REFERENCES reservaciones(id) ON DELETE SET NULL,
        estado          VARCHAR(20) DEFAULT 'pendiente'
                          CHECK (estado IN ('pendiente', 'cotizado', 'confirmado', 'pagado', 'cancelado')),
        creado_en       TIMESTAMP DEFAULT NOW(),
        actualizado_en  TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('✅ Tabla leads_corporativos creada');

    // Agregar columna reservacion_id si no existe
    await pool.query(`
      ALTER TABLE leads_corporativos
      ADD COLUMN IF NOT EXISTS reservacion_id INT REFERENCES reservaciones(id) ON DELETE SET NULL;
    `);
    
    // Actualizar CHECK constraint si es necesario para incluir 'confirmado'
    // (esto varía según si PostgreSQL permite UPDATE de constraints, generalmente hay que recrear)
    
    console.log('✅ Columnas verificadas');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error en migración corporativo:', err.message);
    process.exit(1);
  }
}

migrate();
