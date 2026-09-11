require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const adminAuth = require('./middleware/adminAuth');
const { enviarRecordatorios, enviarRecordatoriosStaff } = require('./services/recordatorios');

const app = express();
const PORT = process.env.PORT || 3001; // 3001 para no chocar con Next.js en 3000

// Middlewares
const corsOptions = {
  origin: '*',  // Permitir todos los orígenes
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  credentials: false
};
app.use(cors(corsOptions));

// Eventos de Rino Living: la firma va sobre el cuerpo CRUDO, por eso se monta antes de express.json()
app.use('/api/rino/eventos', express.raw({ type: '*/*', limit: '1mb' }), require('./routes/rinoEventos'));
// Consultas en el momento de Rino (disponibilidad y apartar fechas): también firmadas sobre el cuerpo crudo
app.use('/api/rino', require('./routes/rinoReservas'));

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
app.use('/api/rino', require('./routes/rino')); // Puente con Rino Living (rutas admin protegidas adentro)

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

  // Migración 4: tablas del puente con Rino Living (aparte, para que no dependa de las anteriores)
  try {
    await require('./db/migrate-rino')(require('./db/connection'));
    console.log('✅ Tablas del puente con Rino verificadas');
  } catch (err) {
    console.error('⚠️ Error creando tablas del puente con Rino:', err.message);
  }

  // Para correr el backend en local sin mandar WhatsApps reales: la base es la de producción.
  if (process.env.CRONS_DESACTIVADOS === '1') {
    console.log('⏸️  Crons desactivados (CRONS_DESACTIVADOS=1)');
    return;
  }

  // Cron: Puente con Rino — reintentar tareas y pendientes que no llegaron (cada 10 min)
  const tareasRino = require('./services/tareasRino');
  const pendientesRino = require('./services/pendientesRino');
  cron.schedule('*/10 * * * *', async () => {
    try {
      const { reintentadas } = await tareasRino.reintentarPendientes();
      const { reintentados } = await pendientesRino.reintentarEnvios();
      if (reintentadas || reintentados) {
        console.log(`🦏 Rino: ${reintentadas} tareas y ${reintentados} pendientes reintentados`);
      }
    } catch (err) {
      console.error('❌ Error reintentando envíos a Rino:', err.message);
    }
  }, { timezone: 'America/Monterrey' });

  // Cron: Puente con Rino — traer de Rino el avance de las tareas (cada hora)
  cron.schedule('15 * * * *', async () => {
    try {
      const { actualizadas } = await tareasRino.sincronizarTareas();
      if (actualizadas) console.log(`🦏 Rino: ${actualizadas} tareas actualizadas`);
    } catch (err) {
      console.error('❌ Error sincronizando tareas de Rino:', err.message);
    }
  }, { timezone: 'America/Monterrey' });
  console.log('🦏 Crons del puente con Rino activos (reintentos c/10 min, avance c/hora)');

  // Cron: Recordatorios WhatsApp a STAFF 3 días antes (9:00 AM)
  cron.schedule('0 9 * * *', () => {
    console.log('⏰ Ejecutando cron de recordatorios a STAFF (3 días antes)...');
    enviarRecordatoriosStaff();
  }, { timezone: 'America/Monterrey' });
  console.log('👔 Cron de recordatorios a STAFF activo (diario 09:00 AM, 3 días antes)');

  // Cron: Recordatorios WhatsApp a CLIENTES todos los días a las 10:00 AM (hora México)
  cron.schedule('0 10 * * *', () => {
    console.log('⏰ Ejecutando cron de recordatorios a CLIENTES...');
    enviarRecordatorios();
  }, { timezone: 'America/Monterrey' });
  console.log('📬 Cron de recordatorios a CLIENTES activo (diario 10:00 AM, 24h antes)');

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

  // Cron: Archivar automáticamente reservaciones vencidas (3:00 AM)
  cron.schedule('0 3 * * *', async () => {
    console.log('🗂️ Ejecutando cron de archivado automático de reservaciones vencidas...');
    try {
      const pool = require('./db/connection');
      const hoy = new Date().toISOString().split('T')[0];
      
      const result = await pool.query(
        `UPDATE reservaciones 
         SET archivada = TRUE, actualizado_en = NOW() 
         WHERE archivada = FALSE 
         AND COALESCE(fecha_fin, fecha_evento) < $1::date 
         RETURNING id, cliente_id, fecha_evento`,
        [hoy]
      );
      
      if (result.rowCount > 0) {
        console.log(`✅ ${result.rowCount} reservaciones archivadas automáticamente`);
      } else {
        console.log('ℹ️ No hay reservaciones vencidas para archivar');
      }
    } catch (err) {
      console.error('❌ Error en cron de archivado automático:', err.message);
    }
  }, { timezone: 'America/Monterrey' });
  console.log('🗂️ Cron de archivado automático activo (diario 03:00 AM)');
});
