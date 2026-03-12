require('dotenv').config();
const express = require('express');
const cors = require('cors');
const adminAuth = require('./middleware/adminAuth');

const app = express();
const PORT = process.env.PORT || 3001; // 3001 para no chocar con Next.js en 3000

// Middlewares
const corsOptions = {
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  credentials: true
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
app.use('/api/precios', require('./routes/precios'));
app.use('/api/reportes', require('./routes/reportes'));
app.use('/api/terminal', require('./routes/terminal'));
app.use('/api/corporativo', require('./routes/corporativo'));

// Ruta de prueba
app.get('/', (req, res) => {
  res.send('¡API de La Quinta de Alí funcionando al 100%!');
});

// Levantar el servidor
app.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});
