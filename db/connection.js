const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: process.env.NODE_ENV === 'production' },
  max: 20,
  idleTimeoutMillis: 30000,
});

module.exports = pool;
