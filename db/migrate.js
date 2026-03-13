require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('./connection');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS extras (
        id          SERIAL PRIMARY KEY,
        nombre      VARCHAR(100) NOT NULL,
        descripcion TEXT,
        precio      DECIMAL(10,2) NOT NULL,
        emoji       VARCHAR(10) DEFAULT '🎁',
        activo      BOOLEAN DEFAULT TRUE,
        creado_en   TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Tabla extras creada');

    await client.query(`
      CREATE TABLE IF NOT EXISTS reservacion_extras (
        id              SERIAL PRIMARY KEY,
        reservacion_id  INT NOT NULL REFERENCES reservaciones(id) ON DELETE CASCADE,
        extra_id        INT NOT NULL REFERENCES extras(id) ON DELETE RESTRICT,
        cantidad        INT DEFAULT 1,
        precio_unitario DECIMAL(10,2) NOT NULL,
        subtotal        DECIMAL(10,2) NOT NULL,
        creado_en       TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Tabla reservacion_extras creada');

    await client.query(`
      CREATE TABLE IF NOT EXISTS firmas_reglamento (
        id              SERIAL PRIMARY KEY,
        reservacion_id  INT NOT NULL REFERENCES reservaciones(id) ON DELETE CASCADE,
        cliente_id      INT NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
        firma_url       TEXT NOT NULL,
        ip_cliente      VARCHAR(45),
        user_agent      TEXT,
        firmado_en      TIMESTAMP DEFAULT NOW(),
        UNIQUE(reservacion_id)
      )
    `);
    console.log('✅ Tabla firmas_reglamento creada');

    await client.query(`
      CREATE TABLE IF NOT EXISTS resenas (
        id              SERIAL PRIMARY KEY,
        reservacion_id  INT NOT NULL REFERENCES reservaciones(id) ON DELETE CASCADE,
        cliente_id      INT NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
        calificacion    INT CHECK (calificacion BETWEEN 1 AND 5),
        mensaje_enviado BOOLEAN DEFAULT FALSE,
        link_enviado    BOOLEAN DEFAULT FALSE,
        alerta_enviada  BOOLEAN DEFAULT FALSE,
        respondido_en   TIMESTAMP,
        creado_en       TIMESTAMP DEFAULT NOW(),
        UNIQUE(reservacion_id)
      )
    `);
    console.log('✅ Tabla resenas creada');

    await client.query(`
      CREATE TABLE IF NOT EXISTS codigos_acceso (
        id              SERIAL PRIMARY KEY,
        reservacion_id  INT NOT NULL REFERENCES reservaciones(id) ON DELETE CASCADE,
        codigo_pin      VARCHAR(6) NOT NULL,
        valido_desde    TIMESTAMP NOT NULL,
        valido_hasta    TIMESTAMP NOT NULL,
        enviado         BOOLEAN DEFAULT FALSE,
        activo          BOOLEAN DEFAULT TRUE,
        creado_en       TIMESTAMP DEFAULT NOW(),
        UNIQUE(reservacion_id)
      )
    `);
    console.log('✅ Tabla codigos_acceso creada');

    // Agregar columna ine_url a reservaciones si no existe
    await client.query(`
      ALTER TABLE reservaciones ADD COLUMN IF NOT EXISTS ine_url TEXT
    `);
    console.log('✅ Columna ine_url verificada');

    // Agregar columna promotor a reservaciones si no existe
    await client.query(`
      ALTER TABLE reservaciones ADD COLUMN IF NOT EXISTS promotor VARCHAR(50)
    `);
    console.log('✅ Columna promotor verificada');

    // Agregar columna promotor_id a reservaciones
    await client.query(`
      ALTER TABLE reservaciones ADD COLUMN IF NOT EXISTS promotor_id INT
    `);
    console.log('✅ Columna promotor_id verificada');

    // Tabla de promotores
    await client.query(`
      CREATE TABLE IF NOT EXISTS promotores (
        id                  SERIAL PRIMARY KEY,
        nombre              VARCHAR(100) NOT NULL,
        email               VARCHAR(255) UNIQUE NOT NULL,
        password_hash       VARCHAR(255) NOT NULL,
        codigo_ref          VARCHAR(50) UNIQUE NOT NULL,
        comision_porcentaje DECIMAL(5,2) DEFAULT 10.00,
        activo              BOOLEAN DEFAULT TRUE,
        creado_en           TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Tabla promotores creada');

    // Tabla de clicks de promotores
    await client.query(`
      CREATE TABLE IF NOT EXISTS clicks_promotor (
        id            SERIAL PRIMARY KEY,
        promotor_id   INT NOT NULL REFERENCES promotores(id) ON DELETE CASCADE,
        creado_en     TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Tabla clicks_promotor creada');

    // Insertar extras iniciales
    const { rows } = await client.query('SELECT COUNT(*) FROM extras');
    if (parseInt(rows[0].count) === 0) {
      await client.query(`
        INSERT INTO extras (nombre, descripcion, precio, emoji) VALUES
          ('Paquete Parrillero', '2 bolsas de carbón, encendedor y pinzas', 350.00, '🥩'),
          ('Kit de Hielo', '5 bolsas grandes directo en la hielera', 250.00, '🧊'),
          ('Hora Extra', 'Extiende tu evento hasta la 1:00 AM', 1000.00, '⏰'),
          ('Bocina Bluetooth Premium', 'Sonido potente para tu fiesta', 500.00, '🔊'),
          ('Pack de Decoración Básica', 'Globos, manteles y centro de mesa', 800.00, '🎈'),
          ('Mesero (4 horas)', 'Personal de servicio profesional', 1200.00, '🍽️')
      `);
      console.log('✅ Extras iniciales insertados');
    }

    console.log('🎉 Migración completada');
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    client.release();
    pool.end();
  }
}

migrate();
