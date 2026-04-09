require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const adminAuth = require('./middleware/adminAuth');
const { enviarRecordatorios } = require('./services/recordatorios');

const app = express();
const PORT = process.env.PORT || 3001; // 3001 para no chocar con Next.js en 3000

// Middlewares
const corsOptions = {
  origin: '*',  // Permitir todos los orígenes
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  credentials: false
};
app.use(cors(corsOptions));
app.use(express.json());

// Webhooks externos (sin restricción de CORS — reciben de Meta/MercadoPago)
app.use('/api/webhook', require('./routes/webhook'));
app.use('/api/webhooks/mercadopago', require('./routes/webhookMercadoPago'));

// Ruta de login admin (pública)
app.use('/api/admin', require('./routes/admin'));

// Rutas públicas (usadas por el frontend de clientes)
app.use('/api/paquetes', require('./routes/paquetes'));
app.use('/api/clientes', require('./routes/clientes'));
app.use('/api/reservaciones', require('./routes/reservaciones'));
app.use('/api/galeria', require('./routes/galeria'));
app.use('/api/config', require('./routes/config'));
app.use('/api/extras', require('./routes/extras'));
app.use('/api/firmas', require('./routes/firmas'));
app.use('/api/cerraduras', require('./routes/cerraduras'));
app.use('/api/resenas', require('./routes/resenas'));
app.use('/api/notificaciones', require('./routes/notificaciones'));
app.use('/api/pagos', require('./routes/pagos'));
app.use('/api/mercadopago', require('./routes/mercadopago'));
app.use('/api/precios', require('./routes/precios'));
app.use('/api/reportes', require('./routes/reportes'));
app.use('/api/terminal', require('./routes/terminal'));
app.use('/api/corporativo', require('./routes/corporativo'));
app.use('/api/promotores', require('./routes/promotores'));
app.use('/api/google-reviews', require('./routes/google-reviews'));
app.use('/api/reviews', require('./routes/reviews'));

// Ruta de prueba
app.get('/', (req, res) => {
  res.send('¡API de La Quinta de Alí funcionando al 100%!');
});

// Test de conexión a BD
app.get('/api/health', async (req, res) => {
  try {
    const pool = require('./db/connection');
    const result = await pool.query('SELECT NOW()');
    res.json({ status: 'ok', time: result.rows[0].now, node_env: process.env.NODE_ENV });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message, code: err.code });
  }
});

// Levantar el servidor
app.listen(PORT, async () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);

  // Ejecutar migraciones al iniciar
  try {
    const pool = require('./db/connection');
    
    // Migración 1: fecha_fin en reservaciones
    await pool.query(`
      ALTER TABLE reservaciones 
      ADD COLUMN IF NOT EXISTS fecha_fin DATE
    `);
    console.log('✅ Columna fecha_fin verificada en reservaciones');

    // Migración 2: reservacion_id en leads_corporativos
    await pool.query(`
      ALTER TABLE leads_corporativos 
      ADD COLUMN IF NOT EXISTS reservacion_id INT REFERENCES reservaciones(id) ON DELETE SET NULL
    `);
    console.log('✅ Columna reservacion_id verificada en leads_corporativos');

    // Migración 3: Actualizar CHECK constraint para leads_corporativos (si aún no incluye 'confirmado')
    // Intentar agregar 'confirmado' al constraint (puede fallar si ya existe, eso es ok)
    await pool.query(`
      ALTER TABLE leads_corporativos 
      DROP CONSTRAINT IF EXISTS leads_corporativos_estado_check;
    `).catch(() => {/*ignorar si no existe*/});
    
    await pool.query(`
      ALTER TABLE leads_corporativos 
      ADD CONSTRAINT leads_corporativos_estado_check 
      CHECK (estado IN ('pendiente', 'cotizado', 'confirmado', 'pagado', 'cancelado'))
    `).catch(() => {/*ignorar si ya existe*/});
    
    console.log('✅ CHECK constraint actualizado para leads_corporativos');

  } catch (err) {
    console.error('⚠️ Error en migraciones de startup:', err.message);
  }

  // Cron: Recordatorios WhatsApp todos los días a las 10:00 AM (hora México)
  cron.schedule('0 10 * * *', () => {
    console.log('⏰ Ejecutando cron de recordatorios...');
    enviarRecordatorios();
  }, { timezone: 'America/Monterrey' });
  console.log('📬 Cron de recordatorios WhatsApp activo (diario 10:00 AM)');

  // Cron: Solicitudes de reseña todos los días a las 12:00 PM (hora México)
  cron.schedule('0 12 * * *', async () => {
    console.log('⭐ Ejecutando cron de reseñas...');
    try {
      await fetch(`http://localhost:${PORT}/api/resenas/cron`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (e) {
      console.error('Error en cron de reseñas:', e.message);
    }
  }, { timezone: 'America/Monterrey' });
  console.log('⭐ Cron de reseñas WhatsApp activo (diario 12:00 PM)');
});
