require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('./connection');

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pagos_terminal (
      id                  SERIAL PRIMARY KEY,
      payment_intent_id   VARCHAR(100),
      payment_id          VARCHAR(100),
      external_reference  VARCHAR(100),
      monto               DECIMAL(10,2) NOT NULL,
      descripcion         VARCHAR(255),
      reservacion_id      INT REFERENCES reservaciones(id) ON DELETE SET NULL,
      estado              VARCHAR(20) DEFAULT 'enviado' CHECK (estado IN ('enviado','pagado','cancelado','rechazado','error')),
      creado_en           TIMESTAMP DEFAULT NOW(),
      actualizado_en      TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pagos_terminal_estado ON pagos_terminal(estado);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pagos_terminal_ref ON pagos_terminal(external_reference);`);
  console.log('Tabla pagos_terminal creada correctamente');
  process.exit(0);
}

migrate().catch(e => { console.error(e.message); process.exit(1); });
