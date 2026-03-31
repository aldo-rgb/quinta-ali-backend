# 📖 Manual del Programador — La Quinta de Alí

> Sistema de reservaciones para quinta de eventos en Monterrey, México.
> Última actualización: 31 de marzo de 2026

---

## 📋 Índice

1. [Arquitectura General](#1-arquitectura-general)
2. [Stack Tecnológico](#2-stack-tecnológico)
3. [Estructura del Proyecto](#3-estructura-del-proyecto)
4. [Variables de Entorno](#4-variables-de-entorno)
5. [Base de Datos](#5-base-de-datos)
6. [Backend — API REST](#6-backend--api-rest)
7. [Frontend — Next.js](#7-frontend--nextjs)
8. [Servicios Externos](#8-servicios-externos)
9. [Flujos Principales](#9-flujos-principales)
10. [Cron Jobs](#10-cron-jobs)
11. [Autenticación y Seguridad](#11-autenticación-y-seguridad)
12. [Deploy y CI/CD](#12-deploy-y-cicd)
13. [Comandos Útiles](#13-comandos-útiles)
14. [Troubleshooting](#14-troubleshooting)

---

## 1. Arquitectura General

```
┌─────────────────────┐     ┌──────────────────────┐
│   Frontend (Vercel)  │────▶│  Backend (Railway)    │
│   Next.js 16.1.6     │◀────│  Express 5.2.1        │
│   React 19           │     │  Node.js              │
└─────────────────────┘     └──────────┬───────────┘
                                       │
                    ┌──────────────────┼──────────────────┐
                    │                  │                  │
              ┌─────▼─────┐    ┌──────▼──────┐   ┌──────▼──────┐
              │ PostgreSQL │    │  WhatsApp   │   │ Cloudinary  │
              │   (Neon)   │    │  Meta API   │   │  (Imágenes) │
              └───────────┘    └─────────────┘   └─────────────┘
                    │
         ┌─────────┼─────────┬──────────────┐
         │         │         │              │
    ┌────▼───┐ ┌───▼────┐ ┌──▼───┐   ┌─────▼─────┐
    │ OpenAI │ │Openpay │ │SMTP  │   │MercadoPago│
    │GPT-4o  │ │(Pagos) │ │(Mail)│   │  (Terminal)│
    └────────┘ └────────┘ └──────┘   └───────────┘
```

**URLs de Producción:**
- **Frontend:** https://laquintadeali.com
- **Backend:** https://web-production-bdf66.up.railway.app
- **Base de Datos:** Neon PostgreSQL (ep-holy-wildflower)

---

## 2. Stack Tecnológico

### Backend
| Tecnología | Versión | Uso |
|---|---|---|
| Node.js | 18+ | Runtime |
| Express | 5.2.1 | Framework HTTP |
| PostgreSQL (pg) | 8.20.0 | Base de datos |
| jsonwebtoken | 9.0.3 | Autenticación JWT |
| bcryptjs | 3.0.2 | Hash de contraseñas |
| axios | 1.13.6 | Cliente HTTP (WhatsApp API) |
| openai | 6.27.0 | Bot IA (GPT-4o Mini) |
| cloudinary | 2.9.0 | CDN de imágenes |
| multer | 1.4.5 | Upload de archivos |
| pdfkit | 0.17.2 | Generación de PDFs |
| nodemailer | 8.0.2 | Envío de correos |
| openpay | 1.0.5 | Pasarela de pagos |
| node-cron | 3.0.3 | Tareas programadas |
| express-rate-limit | 7.x | Rate limiting |

### Frontend
| Tecnología | Versión | Uso |
|---|---|---|
| Next.js | 16.1.6 | Framework React (Turbopack) |
| React | 19.2.3 | UI Library |
| TypeScript | 5.x | Tipado estático |
| Tailwind CSS | 4.x | Estilos |
| next-auth | 4.24.13 | Auth con Google |
| recharts | 3.8.0 | Gráficas admin |
| qrcode.react | 4.2.0 | Generador de QR |
| react-signature-canvas | 1.1.0-alpha.2 | Firma digital |
| lucide-react | 0.577.0 | Iconos |

---

## 3. Estructura del Proyecto

```
quinta-ali-backend/
├── index.js                    # Punto de entrada, Express + Cron Jobs
├── package.json
├── Procfile                    # Railway: web: node index.js
├── .env                        # Variables de entorno (NO en git)
│
├── db/
│   ├── connection.js           # Pool PostgreSQL (20 conexiones, SSL)
│   ├── schema.sql              # Esquema inicial (tablas + triggers)
│   ├── migrate.js              # Migración: extras, firmas, reseñas, promotores
│   ├── migrate-terminal.js     # Migración: pagos terminal MercadoPago
│   └── migrate-corporativo.js  # Migración: leads corporativos
│
├── middleware/
│   ├── adminAuth.js            # JWT middleware para admin
│   └── promotorAuth.js         # JWT middleware para promotores
│
├── routes/
│   ├── admin.js                # POST /login (rate-limited)
│   ├── webhook.js              # WhatsApp webhook (GET verify + POST messages)
│   ├── webhookMercadoPago.js   # MercadoPago webhook (pagos terminal)
│   ├── reservaciones.js        # CRUD reservaciones + check-in/out + INE upload
│   ├── paquetes.js             # CRUD paquetes + imagen Cloudinary
│   ├── clientes.js             # CRUD clientes (Google + invitados)
│   ├── galeria.js              # CRUD galería fotos por área
│   ├── config.js               # Config clave-valor (hero texts, etc.)
│   ├── extras.js               # CRUD extras (servicios adicionales)
│   ├── firmas.js               # Firma digital → Cloudinary
│   ├── cerraduras.js           # Generación/verificación PINs
│   ├── resenas.js              # Sistema reseñas (solicitud + procesamiento + cron)
│   ├── notificaciones.js       # Recordatorios WhatsApp (3d, 1d, día evento)
│   ├── pagos.js                # Openpay: tarjeta, SPEI, Paynet
│   ├── precios.js              # Precios dinámicos (reglas por día/fecha/anticipación)
│   ├── reportes.js             # Analytics: ingresos, paquetes populares, ocupación
│   ├── terminal.js             # MercadoPago Point (cobro presencial)
│   ├── corporativo.js          # Cotizaciones corporativas (PDF + email)
│   └── promotores.js           # Sistema promotores/referidos + comisiones
│
└── services/
    ├── whatsapp.js             # WhatsApp Cloud API wrapper
    ├── aiBot.js                # GPT-4o Mini (soporte automático + routing a staff)
    ├── email.js                # Nodemailer (cotizaciones corporativas)
    ├── pdfGenerator.js         # PDFKit (cotizaciones corporativas)
    └── recordatorios.js        # Cron: recordatorios 24h antes del evento

quinta-ali-frontend/
├── src/app/
│   ├── layout.tsx              # Root layout (fonts, auth, i18n, PWA)
│   ├── page.tsx                # Home: hero, galería, paquetes, testimonios, FAQs
│   ├── paquetes/page.tsx       # Catálogo de paquetes con filtros
│   ├── reservar/page.tsx       # Flujo 6 pasos (paquete→datos→extras→firma→pago→éxito)
│   ├── disponibilidad/page.tsx # Calendario público (verde/amarillo/rojo)
│   ├── contacto/page.tsx       # WhatsApp, teléfono, ubicación, horarios
│   ├── ingreso/page.tsx        # Login Google + invitado
│   ├── checkout-invitado/page.tsx # Formulario pre-reserva para invitados
│   ├── privacidad/page.tsx     # Política de privacidad
│   ├── terminos/page.tsx       # Términos de servicio
│   ├── pago/
│   │   ├── exitoso/page.tsx    # Landing post-pago (pase de abordar + PIN)
│   │   └── cancelado/page.tsx  # Landing pago pendiente
│   ├── admin/
│   │   ├── dashboard/page.tsx  # Panel admin (13 pestañas, ~1500 líneas)
│   │   └── qr-codes/page.tsx   # QR Botón de Pánico (imprimible)
│   ├── promotor/
│   │   ├── page.tsx            # Login promotor (email/código + contraseña)
│   │   └── dashboard/page.tsx  # Dashboard promotor (link, stats, eventos)
│   └── api/auth/[...nextauth]/route.ts  # NextAuth Google provider
```

---

## 4. Variables de Entorno

### Backend (.env)

```env
# === SERVIDOR ===
PORT=3001

# === BASE DE DATOS ===
DATABASE_URL=postgresql://user:pass@host/db?sslmode=require

# === WHATSAPP (Meta Cloud API) ===
WHATSAPP_API_TOKEN=EAAR...          # Token de la app de Meta
WHATSAPP_PHONE_NUMBER_ID=9501...    # ID del número de teléfono
WHATSAPP_VERIFY_TOKEN=quinta-ali-verify-2024
ADMIN_WHATSAPP=528149060693         # WhatsApp del admin (con código país)

# === OPENAI ===
OPENAI_API_KEY=sk-proj-...          # Para bot IA de soporte

# === STAFF WHATSAPP ===
STAFF_LIMPIEZA=528149060693
STAFF_MANTENIMIENTO=528149060693
STAFF_EMERGENCIA=528149060693

# === PAGOS — OPENPAY ===
OPENPAY_MERCHANT_ID=                # ⚠️ Pendiente configurar
OPENPAY_PRIVATE_KEY=                # ⚠️ Pendiente configurar
OPENPAY_IS_SANDBOX=true             # Cambiar a false en producción
FRONTEND_URL=https://laquintadeali.com

# === CLOUDINARY ===
CLOUDINARY_CLOUD_NAME=dxtglyhet
CLOUDINARY_API_KEY=371828435443133
CLOUDINARY_API_SECRET=...

# === MERCADO PAGO (Terminal Física) ===
MERCADOPAGO_ACCESS_TOKEN=APP_USR-...  # ✅ Configurado (cuenta Rino Living)
MERCADOPAGO_DEVICE_ID=NEWLAND_N950__N950NCC403261569  # ✅ Terminal Newland N950

# === SMTP (Correo) ===
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=                          # ⚠️ Pendiente configurar
SMTP_PASS=                          # ⚠️ App Password de Google

# === CLABE ===
CLABE_BANCARIA=012345678901234567   # ⚠️ Poner CLABE real

# === AUTENTICACIÓN ADMIN ===
ADMIN_EMAIL=admin@quintadeali.com
ADMIN_PASSWORD_HASH=$2b$10$...      # Hash bcrypt de QuintaAli2026!
JWT_SECRET=55ca5475c6a...           # Secreto para firmar JWTs
```

### Frontend (.env.local)

```env
NEXT_PUBLIC_API_URL=https://web-production-bdf66.up.railway.app
NEXT_PUBLIC_WHATSAPP=528149060693
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
NEXTAUTH_URL=https://laquintadeali.com
NEXTAUTH_SECRET=...
```

---

## 5. Base de Datos

### Diagrama de Tablas (16 tablas)

```
clientes ──────────┐
  id (PK)          │
  google_id        │
  nombre           │
  email            │
  telefono         │
  whatsapp         │
  es_invitado      │
                   │
paquetes ─────┐    │
  id (PK)     │    │
  nombre      │    │
  precio      │    │
  capacidad   │    │
  tipo_duracion│   │    extras ────────┐
  duracion_horas│  │      id (PK)     │
               │   │      nombre      │
               │   │      precio      │
               ▼   ▼      emoji       │
         reservaciones                │
           id (PK)                    │
           cliente_id (FK)            │
           paquete_id (FK)            │
           fecha_evento               │
           hora_inicio / hora_fin     │
           estado                     ▼
           monto_total       reservacion_extras
           monto_pagado        reservacion_id (FK)
           promotor_id (FK)    extra_id (FK)
           checkin_at          cantidad
           checkout_at         subtotal
           ine_url
               │
    ┌──────────┼──────────┬──────────────┐
    │          │          │              │
    ▼          ▼          ▼              ▼
 firmas    codigos     resenas       pagos
 _reglamento _acceso                 _terminal
```

### Tablas Principales

| Tabla | Descripción | Filas aprox. |
|---|---|---|
| `clientes` | Usuarios (Google + invitados) | — |
| `paquetes` | Ofertas de eventos (5 tipos base) | 5+ |
| `reservaciones` | Core: eventos con validación de empalmes | 13+ |
| `extras` | Servicios adicionales (parrillero, hielo, etc.) | 6+ |
| `reservacion_extras` | Relación N:M reservaciones ↔ extras | — |
| `galeria_fotos` | Fotos por área (Cloudinary URLs) | — |
| `firmas_reglamento` | Firmas digitales base64 → Cloudinary | — |
| `resenas` | Calificaciones post-evento (1-5 estrellas) | — |
| `codigos_acceso` | PINs criptográficos para cerraduras | — |
| `promotores` | Programa de referidos con comisiones | 2+ |
| `clicks_promotor` | Tracking de clics en links de referido | — |
| `pagos` | Transacciones Openpay (tarjeta, SPEI, Paynet) | — |
| `pagos_terminal` | Transacciones MercadoPago Point | — |
| `leads_corporativos` | Cotizaciones empresariales con PDF | — |
| `reglas_precio_dinamico` | Reglas de descuento/aumento | — |
| `configuracion` | Clave-valor global (textos hero, etc.) | — |

### Estados de Reservación

```
pendiente → confirmada → pagada → completada
     │           │          │
     └───────────┴──────────┴──→ cancelada
```

### Trigger de Disponibilidad

```sql
-- verificar_disponibilidad() se ejecuta BEFORE INSERT/UPDATE
-- Previene empalmes de horarios en la misma fecha
-- Excluye reservaciones canceladas
CREATE TRIGGER trg_verificar_disponibilidad
  BEFORE INSERT OR UPDATE ON reservaciones
  FOR EACH ROW EXECUTE FUNCTION verificar_disponibilidad();
```

### Migraciones

```bash
# Ejecutar migraciones (desde carpeta backend):
node db/migrate.js              # Tablas: extras, firmas, reseñas, promotores, etc.
node db/migrate-terminal.js     # Tabla: pagos_terminal
node db/migrate-corporativo.js  # Tabla: leads_corporativos
```

---

## 6. Backend — API REST

### Referencia de Endpoints (~90+)

#### 🔐 Admin (routes/admin.js)

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/api/admin/login` | — | Login admin (rate: 5/15min). Body: `{email, password}` → `{token}` |

#### 📦 Paquetes (routes/paquetes.js)

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/api/paquetes` | — | Lista paquetes activos (ordenados por precio) |
| GET | `/api/paquetes/all` | Admin | Lista TODOS (incluye inactivos) |
| GET | `/api/paquetes/:id` | — | Detalle de un paquete |
| POST | `/api/paquetes` | Admin | Crear paquete |
| PATCH | `/api/paquetes/:id` | Admin | Actualizar paquete |
| POST | `/api/paquetes/subir-imagen` | Admin | Upload imagen a Cloudinary |

#### 📅 Reservaciones (routes/reservaciones.js)

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/api/reservaciones` | Admin | Lista todas con cliente + paquete |
| GET | `/api/reservaciones/stats` | Admin | KPIs: total, hoy, pendientes, ingresos (incluye terminal) |
| GET | `/api/reservaciones/disponibilidad?fecha=` | — | Horarios ocupados de una fecha |
| GET | `/api/reservaciones/calendario?mes=` | — | Ocupación mensual |
| POST | `/api/reservaciones` | — | Crear reservación simple |
| POST | `/api/reservaciones/completa` | — | Flujo completo (cliente + extras + reservación) |
| PATCH | `/api/reservaciones/:id/estado` | Admin | Cambiar estado |
| PATCH | `/api/reservaciones/:id/checkin` | Admin | Registrar check-in (timestamp) |
| PATCH | `/api/reservaciones/:id/checkout` | Admin | Registrar check-out → estado=completada |
| POST | `/api/reservaciones/subir-ine` | — | Upload INE a Cloudinary (max 10MB) |

#### 👥 Clientes (routes/clientes.js)

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/api/clientes` | Admin | Lista todos los clientes |
| GET | `/api/clientes/:id` | Admin | Detalle de un cliente |
| POST | `/api/clientes` | — | Crear/actualizar (busca por google_id o email) |

#### 🖼️ Galería (routes/galeria.js)

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/api/galeria` | — | Fotos activas agrupadas por área |
| GET | `/api/galeria/:area` | — | Fotos de un área (alberca, asador, hospedaje, cancha, jacuzzi, palapa, juegos) |
| POST | `/api/galeria/subir` | Admin | Upload foto a Cloudinary |
| DELETE | `/api/galeria/:id` | Admin | Soft delete |

#### ⚙️ Configuración (routes/config.js)

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/api/config` | — | Obtener todas las configuraciones |
| PUT | `/api/config` | Admin | Actualizar configuraciones (UPSERT) |

#### 🎁 Extras (routes/extras.js)

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/api/extras` | — | Lista extras activos |
| GET | `/api/extras/reservacion/:id` | — | Extras de una reservación |
| POST | `/api/extras` | Admin | Crear extra |
| PATCH | `/api/extras/:id` | Admin | Actualizar extra |

#### ✍️ Firmas (routes/firmas.js)

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/api/firmas` | Admin | Lista todas las firmas |
| GET | `/api/firmas/:reservacion_id` | — | Verificar si está firmado |
| POST | `/api/firmas` | — | Guardar firma (base64 → Cloudinary) + IP + user-agent |

#### 🔒 Cerraduras/PINs (routes/cerraduras.js)

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/api/cerraduras` | Admin | Lista todos los códigos |
| POST | `/api/cerraduras/generar` | Admin | Genera PIN criptográfico 4 dígitos |
| POST | `/api/cerraduras/verificar` | — | Valida si PIN es válido ahora |
| POST | `/api/cerraduras/desactivar` | Admin | Desactiva un PIN |

**Lógica de validez del PIN:**
- Eventos por horas: 1h antes → 1h después del horario
- Eventos noche: desde hora_inicio → 11:00 AM día siguiente

#### ⭐ Reseñas (routes/resenas.js)

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/api/resenas` | Admin | Lista todas las reseñas |
| POST | `/api/resenas/enviar-solicitud` | — | Envía lista interactiva WhatsApp (1-5 estrellas) |
| POST | `/api/resenas/procesar-respuesta` | — | Procesa calificación del webhook |
| POST | `/api/resenas/cron` | — | Busca eventos de ayer y envía solicitudes |

**Flujo de reseñas:**
1. Cron 12PM busca reservaciones completadas ayer
2. Envía lista interactiva WhatsApp con 5 opciones
3. Cliente selecciona calificación
4. **4-5 estrellas:** Mensaje personalizado + link Google Maps → https://maps.app.goo.gl/jkPUUQLCwfqbqzSP6
5. **1-3 estrellas:** Mensaje empático al cliente + 🚨 ALERTA ROJA al admin por WhatsApp

#### 🔔 Notificaciones (routes/notificaciones.js)

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/api/notificaciones/cron` | — | Rutina diaria de recordatorios |
| POST | `/api/notificaciones/enviar-pin` | — | Envía PIN manualmente |
| GET | `/api/notificaciones/preview` | Admin | Preview sin enviar |

**Lógica de recordatorios:**
- **3 días antes:** Recordatorio general
- **1 día antes:** Preparación (llega 15 min antes)
- **Día del evento:** PIN + detalles finales

#### 💳 Pagos (routes/pagos.js)

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/api/pagos/generar-referencia` | — | Paynet (pago en tienda, 48h vencimiento) |
| POST | `/api/pagos/generar-cargo-tarjeta` | — | Tarjeta crédito/débito (MSI: 3/6/12) |
| POST | `/api/pagos/generar-spei` | — | Transferencia SPEI |

#### 💰 Precios Dinámicos (routes/precios.js)

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/api/precios/reglas` | Admin | Listar reglas de precio |
| POST | `/api/precios/reglas` | Admin | Crear regla |
| PATCH | `/api/precios/reglas/:id` | Admin | Actualizar regla |
| DELETE | `/api/precios/reglas/:id` | Admin | Eliminar regla |
| GET | `/api/precios/calcular?paquete_id=&fecha=` | — | Calcular precio final |
| GET | `/api/precios/calendario?paquete_id=&mes=` | — | Precios de todo un mes |

**Tipos de reglas:**
- `dia_semana` (0-6): Descuento/aumento por día
- `rango_fechas`: Período específico (ej: Navidad +20%)
- `dias_anticipacion`: Última hora (ej: <3 días -10%)

#### 📊 Reportes (routes/reportes.js)

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/api/reportes/ingresos-mensuales?meses=` | Admin | Ingresos mes a mes |
| GET | `/api/reportes/paquetes-populares` | Admin | Top paquetes |
| GET | `/api/reportes/estados` | Admin | Distribución por estado |
| GET | `/api/reportes/ocupacion-semanal` | Admin | Reservaciones por día de semana |
| GET | `/api/reportes/extras-populares` | Admin | Top 10 extras vendidos |
| GET | `/api/reportes/resumen` | Admin | KPIs generales |

#### 📱 Terminal MercadoPago (routes/terminal.js)

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/api/terminal/cobrar` | Admin | Envía cobro a terminal física |
| GET | `/api/terminal/estado/:intentId` | Admin | Consulta estado del pago |
| GET | `/api/terminal/historial` | Admin | Últimos 20 cobros |
| DELETE | `/api/terminal/cancelar/:intentId` | Admin | Cancela payment intent |

#### 🏢 Corporativo (routes/corporativo.js)

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/api/corporativo/cotizar` | — | Genera cotización PDF (rate: 5/hora) |
| GET | `/api/corporativo/leads` | Admin | Lista leads corporativos |
| PATCH | `/api/corporativo/leads/:id` | Admin | Actualizar estado de lead |
| GET | `/api/corporativo/pdf/:folio` | — | Descarga PDF de cotización |

**Cálculo corporativo:** Precio base + $150/asistente + IVA 16%

#### 👥 Promotores (routes/promotores.js)

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/api/promotores/login` | — | Login por email O codigo_ref (rate: 10/15min) |
| POST | `/api/promotores/click` | — | Registra clic de referido |
| GET | `/api/promotores/me` | Promotor | Perfil del promotor |
| GET | `/api/promotores/stats` | Promotor | Stats: clicks, reservas, comisión |
| GET | `/api/promotores/mis-eventos` | Promotor | Eventos generados |
| GET | `/api/promotores` | Admin | Lista todos los promotores |
| POST | `/api/promotores` | Admin | Crear (auto-genera email y contraseña) |
| PATCH | `/api/promotores/:id` | Admin | Actualizar |
| DELETE | `/api/promotores/:id` | Admin | Eliminar |
| GET | `/api/promotores/admin/stats` | Admin | Leaderboard global + comisiones |

**Sistema de promotores:**
- Login acepta `codigo_ref` o `email`
- Al crear: auto-genera email `{ref}@promotor.quintadeali.com` y password `{ref}2026`
- Password actual para todos: `QuintaAli2026!`
- Comisión default: 10% sobre reservaciones pagadas
- Promotores actuales: `ivan` (Ivan Berlanga), `alan` (Alan Valdez)

#### 📲 Webhook WhatsApp (routes/webhook.js)

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/api/webhook` | — | Verificación Meta (hub.challenge) |
| POST | `/api/webhook` | — | Procesa mensajes entrantes |

**Flujo del webhook:**
1. Recibe mensaje → responde 200 inmediatamente
2. Si `type === 'interactive'` + `list_reply` con `cal_*` → procesa reseña
3. Si `type === 'text'` y match `/^[1-5]$/` → intenta procesar como reseña
4. Si no es reseña → envía a `aiBot.procesarMensaje()` → responde con IA

#### 📲 Webhook MercadoPago (routes/webhookMercadoPago.js)

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/api/webhooks/mercadopago` | — | Procesa notificaciones de pago |

---

## 7. Frontend — Next.js

### Páginas Públicas

| Ruta | Archivo | Descripción |
|---|---|---|
| `/` | page.tsx | Home: hero carousel, galería, paquetes, testimonios, FAQs |
| `/paquetes` | paquetes/page.tsx | Catálogo completo con filtros (horas/noche) |
| `/reservar` | reservar/page.tsx | **Flujo de 6 pasos** (paquete→datos→extras→firma→pago→éxito) |
| `/disponibilidad` | disponibilidad/page.tsx | Calendario público (verde/amarillo/rojo) |
| `/contacto` | contacto/page.tsx | WhatsApp, teléfono, mapa, horarios |
| `/ingreso` | ingreso/page.tsx | Login Google + opción invitado |
| `/checkout-invitado` | checkout-invitado/page.tsx | Formulario pre-reserva invitados |
| `/pago/exitoso` | pago/exitoso/page.tsx | Landing post-pago con pase de abordar |
| `/pago/cancelado` | pago/cancelado/page.tsx | Landing pago pendiente |
| `/privacidad` | privacidad/page.tsx | Política de privacidad |
| `/terminos` | terminos/page.tsx | Términos de servicio |

### Páginas Admin

| Ruta | Archivo | Descripción |
|---|---|---|
| `/admin/dashboard` | admin/dashboard/page.tsx | Panel admin con 13 pestañas (~1500 LOC) |
| `/admin/qr-codes` | admin/qr-codes/page.tsx | QR imprimible "Botón de Pánico" |

### Dashboard Admin — 13 Pestañas

1. **Reservaciones** — Tabla completa con estados, filtros, cambiar estado (cancelar desde cualquier estado incl. completada)
2. **Hoy** — Reservaciones del día con check-in/check-out
3. **Galería** — Upload de fotos por área (7 áreas)
4. **Extras** — CRUD servicios adicionales
5. **Paquetes** — CRUD paquetes con imágenes
6. **Accesos** — Tabla de PINs generados con validez
7. **Reseñas** — Gestión de reviews de clientes
8. **Precios Dinámicos** — CRUD reglas de precios
9. **Reportes** — Gráficas Recharts + tablas de métricas
10. **Config** — Textos hero + link QR Botón de Pánico
11. **Terminal MP** — Cobrador manual MercadoPago
12. **Corporativo** — Leads B2B con cotizaciones
13. **Promotores** — CRUD promotores, leaderboard, comisiones

### Páginas Promotor

| Ruta | Archivo | Descripción |
|---|---|---|
| `/promotor` | promotor/page.tsx | Login (email/código + contraseña) |
| `/promotor/dashboard` | promotor/dashboard/page.tsx | Stats, link de ventas, eventos |

### Flujo de Reservación (6 pasos)

```
Paso 1: Seleccionar paquete + fecha + hora
         └─ Calendario con disponibilidad en vivo
         └─ Precios dinámicos por fecha

Paso 2: Datos del cliente
         └─ Google Sign-In o invitado
         └─ Nombre, email, teléfono, invitados
         └─ Upload de INE (drag & drop)
         └─ Código promotor (opcional)

Paso 3: Extras / Upselling
         └─ Grid de servicios adicionales
         └─ Toggle selección + cantidades
         └─ Resumen con descuentos

Paso 4: Firma digital del reglamento
         └─ Scroll reglamento (10 puntos)
         └─ Canvas de firma táctil

Paso 5: Método de pago
         └─ Tarjeta crédito/débito (MSI)
         └─ SPEI (transferencia)
         └─ Paynet (pago en tienda)
         └─ Apple Pay (si disponible)

Paso 6: Confirmación
         └─ Folio de reservación
         └─ PIN de acceso (si ya pagó)
         └─ Detalles del evento
```

---

## 8. Servicios Externos

### WhatsApp Cloud API (Meta)
- **API:** `https://graph.facebook.com/v22.0/{PHONE_NUMBER_ID}/messages`
- **Funciones disponibles:**
  - `enviarMensaje(tel, texto)` — Texto simple
  - `enviarBotones(tel, header, body, botones)` — Botones interactivos
  - `enviarLista(tel, header, body, boton, secciones)` — Listas (reseñas)
  - `notificarNuevaReservacion(res, nombre, paquete)` — Notifica admin
  - `confirmarReservacionCliente(tel, nombre, paquete, fecha, hora)` — Confirmación
  - `enviarPaseAbordar(datos)` — Pase de abordar completo
  - `enviarRecordatorio(tel, nombre, fecha, inicio, fin, paquete)` — Recordatorio 24h

### OpenAI (GPT-4o Mini)
- **Modelo:** `gpt-4o-mini`
- **System prompt:** Asistente de La Quinta de Alí que clasifica problemas en Limpieza/Mantenimiento/Emergencia
- **Tool calling:** `notificar_staff(categoria, descripcion, urgencia)` → envía WhatsApp al staff correspondiente
- **Historial:** En memoria, máx 10 mensajes por teléfono

### Cloudinary
- **Cloud:** `dxtglyhet`
- **Usos:** Fotos galería, imágenes paquetes, INE uploads, firmas digitales
- **Transformaciones:** quality auto, fetch_format auto, resize 1200x900

### Openpay
- **Dashboard:** https://sandbox-dashboard.openpay.mx
- **Métodos:** Tarjeta (MSI 3/6/12), SPEI, Paynet (tienda)
- **Estado:** ⚠️ Pendiente configurar credenciales

### MercadoPago Point
- **Uso:** Terminal física para cobro presencial (modo PDV)
- **Cuenta:** Rino Living (livingrino@gmail.com) — Producción
- **Terminal:** NEWLAND N950 (device: `NEWLAND_N950__N950NCC403261569`)
- **External reference:** `QDA-RES-{reservacion_id}-{timestamp}` o `QDA-EXTRA-{timestamp}`
- **API Format:** Solo `amount` (centavos) + `additional_info` (NO enviar `description` ni `payment`)
- **Monto mínimo:** $5 MXN (500 centavos)
- **Estado:** ✅ Configurado y funcionando
- **Nota:** Los cobros de terminal se suman a los ingresos del mes en stats y reportes

### Google Maps (Reseñas)
- **Link:** https://maps.app.goo.gl/jkPUUQLCwfqbqzSP6

---

## 9. Flujos Principales

### Flujo 1: Reservación Completa

```
Cliente abre /reservar
    │
    ├─ Paso 1: Elige paquete + fecha + hora
    │     └─ GET /api/reservaciones/calendario → disponibilidad
    │     └─ GET /api/precios/calcular → precio dinámico
    │
    ├─ Paso 2: Datos personales + INE
    │     └─ POST /api/reservaciones/subir-ine → Cloudinary
    │
    ├─ Paso 3: Selecciona extras
    │
    ├─ Paso 4: Firma reglamento
    │     └─ POST /api/firmas → Cloudinary
    │
    ├─ Paso 5: Paga
    │     └─ POST /api/reservaciones/completa
    │     │     → Crea cliente + reservación + extras (transacción)
    │     │     → Trigger valida no-empalme
    │     └─ POST /api/pagos/generar-cargo-tarjeta
    │           → Redirect a Openpay
    │
    └─ Paso 6: Confirmación
          └─ POST /api/cerraduras/generar → PIN 4 dígitos
          └─ WhatsApp: confirmarReservacionCliente()
          └─ WhatsApp: notificarNuevaReservacion() → admin
```

### Flujo 2: Pago → Pase de Abordar

```
Cliente paga (Openpay/MercadoPago)
    │
    ├─ Webhook recibe confirmación
    │     └─ Actualiza monto_pagado en reservaciones
    │
    ├─ Si monto_pagado >= monto_total
    │     └─ Estado → 'pagada'
    │     └─ enviarPaseDeAbordar():
    │           ├─ Genera PIN criptográfico 4 dígitos
    │           ├─ Calcula ventana de validez
    │           └─ Envía WhatsApp con todos los detalles
    │
    └─ Cliente recibe en WhatsApp:
          ├─ Código PIN
          ├─ Fecha y horario
          ├─ Paquete contratado
          └─ Ubicación (Google Maps)
```

### Flujo 3: Día del Evento

```
10:00 AM (día anterior):
    └─ Cron enviarRecordatorios()
          └─ Busca reservaciones de MAÑANA (confirmada/pagada)
          └─ WhatsApp: fecha, hora, paquete, reglas, tips

Día del evento:
    └─ Admin hace Check-in desde dashboard
          └─ PATCH /api/reservaciones/:id/checkin
    └─ Al terminar, Check-out
          └─ PATCH /api/reservaciones/:id/checkout
          └─ Estado → 'completada'
```

### Flujo 4: Reseñas Post-Evento

```
12:00 PM (día siguiente):
    └─ Cron POST /api/resenas/cron
          └─ Busca completadas de AYER sin reseña
          └─ POST /api/resenas/enviar-solicitud
                └─ WhatsApp: enviarLista() con 5 opciones ⭐

Cliente responde (interactivo o texto):
    └─ Webhook detecta list_reply o regex /^[1-5]$/
          └─ POST /api/resenas/procesar-respuesta
                │
                ├─ Si 4-5 ⭐ (Promotor):
                │     └─ "¡Qué alegría! ¿Nos dejas reseña en Google?"
                │     └─ Link: maps.app.goo.gl/jkPUUQLCwfqbqzSP6
                │     └─ "¡Te esperamos con descuento! 🥩🔥"
                │
                └─ Si 1-3 ⭐ (Detractor):
                      └─ "Lamentamos mucho... cuéntanos qué falló"
                      └─ NO se da link de Google
                      └─ 🚨 ALERTA ROJA al admin:
                            "¡Háblale antes de que vaya a Facebook!"
```

### Flujo 5: Bot IA (Soporte WhatsApp)

```
Cliente envía mensaje al WhatsApp
    │
    └─ Webhook recibe (no es reseña)
          └─ aiBot.procesarMensaje(telefono, texto)
                │
                ├─ GPT-4o Mini clasifica:
                │     ├─ 🧹 Limpieza → STAFF_LIMPIEZA
                │     ├─ 🔧 Mantenimiento → STAFF_MANTENIMIENTO
                │     └─ 🚨 Emergencia → STAFF_EMERGENCIA
                │
                ├─ Responde empáticamente al cliente
                └─ Notifica al staff por WhatsApp
```

---

## 10. Cron Jobs

| Cron | Horario | Timezone | Qué hace |
|---|---|---|---|
| Recordatorios | `0 10 * * *` (10:00 AM) | America/Monterrey | Envía WhatsApp a clientes con evento MAÑANA |
| Reseñas | `0 12 * * *` (12:00 PM) | America/Monterrey | Envía solicitud de calificación a eventos de AYER |

Configurados en `index.js` dentro de `app.listen()`.

---

## 11. Autenticación y Seguridad

### Admin
- **Login:** `POST /api/admin/login` con email + password
- **Rate limit:** 5 intentos cada 15 minutos
- **Token:** JWT con `{ email, role: 'admin' }`, expira en **8 horas**
- **Middleware:** `adminAuth.js` valida `Authorization: Bearer <token>`
- **Almacenamiento:** `sessionStorage['admin_token']` en frontend

### Promotor
- **Login:** `POST /api/promotores/login` con (email o codigo_ref) + password
- **Rate limit:** 10 intentos cada 15 minutos
- **Token:** JWT con `{ id, email, nombre, codigo_ref, role: 'promotor' }`, expira en **8 horas**
- **Middleware:** `promotorAuth.js`
- **Almacenamiento:** `sessionStorage['promotor_token']`

### Cliente
- **Google Sign-In:** NextAuth con GoogleProvider
- **Invitados:** Sin autenticación, datos pasados por URL params
- **Token:** NextAuth session JWT

### Credenciales Actuales
- **Admin:** `admin@quintadeali.com` / `QuintaAli2026!`
- **Promotor Ivan:** `ivan` / `QuintaAli2026!`
- **Promotor Alan:** `alan` / `QuintaAli2026!`

### Seguridad
- Contraseñas hasheadas con bcrypt (salt rounds: 10)
- JWT firmados con secreto de 96 caracteres hex
- CORS configurado para frontend URL
- Rate limiting en endpoints críticos
- SSL obligatorio en BD PostgreSQL
- Upload limitado a 10MB
- Firmas registran IP + User-Agent
- PINs generados con `crypto.randomInt()` (criptográficamente seguro)

---

## 12. Deploy y CI/CD

### Backend (Railway)
- **Repo:** `github.com/aldo-rgb/quinta-ali-backend`
- **Branch:** `main` (auto-deploy on push)
- **Runtime:** Node.js
- **Start command:** `node index.js` (via Procfile)
- **Variables de entorno:** Configuradas en Railway Dashboard

### Frontend (Vercel)
- **Repo:** `github.com/aldo-rgb/quinta-ali-frontend`
- **Branch:** `main` (auto-deploy on push)
- **Framework:** Next.js (auto-detectado)
- **Variables de entorno:** Configuradas en Vercel Dashboard

### Flujo de Deploy

```bash
# Backend
cd quinta-ali-backend
git add -A
git commit -m "feat: descripción del cambio"
git push origin main
# → Railway auto-deploya en ~30 segundos

# Frontend
cd quinta-ali-frontend
git add -A
git commit -m "feat: descripción del cambio"
git push origin main
# → Vercel auto-deploya en ~60 segundos
```

### Git Config
```
user.name: aldo-rgb
user.email: aldo-rgb@users.noreply.github.com
```

### Forzar Redeploy (cache Vercel)
```bash
cd quinta-ali-frontend
git commit --allow-empty -m "force: redeploy"
git push origin main
```

---

## 13. Comandos Útiles

### Desarrollo Local

```bash
# Backend
cd quinta-ali-backend
npm install
npm run dev          # Inicia con nodemon en puerto 3001

# Frontend
cd quinta-ali-frontend
npm install
npm run dev          # Inicia Next.js en puerto 3000
```

### Base de Datos

```bash
# Ejecutar migraciones
cd quinta-ali-backend
node db/migrate.js
node db/migrate-terminal.js
node db/migrate-corporativo.js

# Conectar a PostgreSQL
psql "postgresql://user:pass@host/db?sslmode=require"
```

### Verificación Rápida

```bash
# Backend vivo?
curl -s https://web-production-bdf66.up.railway.app/api/health

# Frontend vivo?
curl -s -o /dev/null -w "%{http_code}" https://laquintadeali.com/

# Verificar sintaxis archivos
node -c routes/resenas.js && echo "OK"

# Probar login admin
curl -s -X POST https://web-production-bdf66.up.railway.app/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@quintadeali.com","password":"QuintaAli2026!"}'

# Verificar webhook WhatsApp
curl -s "https://web-production-bdf66.up.railway.app/api/webhook?hub.mode=subscribe&hub.verify_token=quinta-ali-verify-2024&hub.challenge=test"

# Ejecutar cron de reseñas manualmente
curl -s -X POST "https://web-production-bdf66.up.railway.app/api/resenas/cron"
```

---

## 14. Troubleshooting

### "ECONNREFUSED" al correr scripts locales
```bash
# Asegúrate de tener dotenv cargado
# El script debe iniciar con:
require('dotenv').config();
```

### Vercel muestra versión vieja
```bash
# Forzar redeploy con commit vacío
git commit --allow-empty -m "force: redeploy" && git push origin main
```

### WhatsApp no envía mensajes
1. Verificar `WHATSAPP_API_TOKEN` no esté expirado (dura 23.5 horas o permanente si es System User)
2. Verificar `WHATSAPP_PHONE_NUMBER_ID` correcto
3. Verificar número destino tiene WhatsApp
4. Ver logs en Railway: `console.error('Error enviando...')`

### Reservación da 409 Conflict
- El trigger `verificar_disponibilidad()` detectó empalme de horarios
- Verificar `/api/reservaciones/disponibilidad?fecha=YYYY-MM-DD`

### Admin token expirado
- Token dura 8 horas. Re-login desde `/admin/dashboard`
- El frontend limpia `sessionStorage['admin_token']` al detectar 401

### Promotor no puede hacer login
- Verificar en BD: `SELECT email, codigo_ref FROM promotores WHERE activo = true`
- Login acepta `codigo_ref` O `email` como campo "email"
- Password: `QuintaAli2026!`

### Base de datos — nueva tabla no existe
```bash
# Ejecutar la migración correspondiente
node db/migrate.js
```

### Caracteres especiales en WhatsApp
- WhatsApp acepta emoji Unicode (✅ ⭐ 🎉)
- Los títulos de listas interactivas tienen límite de 24 caracteres
- El body de listas tiene límite de 1024 caracteres
- El botón tiene límite de 20 caracteres

---

## 15. Cambios Recientes (31 de marzo de 2026)

### Reservaciones Corporativas (B2B) ✅
- **Endpoint:** POST `/api/corporativo/cotizar`
- **Cambio:** Ahora crea **reservaciones REALES** (no solo cotizaciones)
- **Flujo:** Empresa → Cliente + Reservación + Factura + Email + WhatsApp Admin
- **Validación:** Requiere: empresa, contacto, email, fecha_evento, paquete_base
- **Respuesta:** Incluye `reservacion_id` para rastreo
- **Factura:** Se genera automáticamente (FAC-XXXXX) y se envía por email
- **Base de Datos:** Tabla `leads_corporativos` ahora tiene FK `reservacion_id` (auto-migración en startup)

### Admin Dashboard — Búsqueda 🔍
- **Nueva:** Barra de búsqueda sticky en sección de reservaciones
- **Busca por:** nombre, apellido, email, teléfono, paquete
- **Comportamiento:** Filtro en tiempo real, muestra "No se encontraron resultados" cuando es necesario

### Google Reviews — Traducción 🌐
- **Sistema:** LibreTranslate API (gratuito, sin API key)
- **Proceso:** Backend traduce reviews del inglés al español latino
- **Respuesta API:** Devuelve `texto_en` (original) + `texto_es` (traducido)
- **Frontend:** Muestra `texto_es` cuando locale='es', `texto_en` cuando locale='en'
- **Soporte i18n:** Cambiar idioma actualiza automáticamente las reviews

### Commits Principales
| Fecha | Backend | Frontend | Descripción |
|-------|---------|----------|-------------|
| 31/3 | `d0f0d92` | `2f5ee14` | Google Reviews: traducción con LibreTranslate |
| 31/3 | — | `80664c3` | Admin dashboard: barra de búsqueda |
| 31/3 | `10aae3d` | `4f93576` | B2B: validación de paquete_base requerido |
| 31/3 | `0ee37ee` | `e0bd3f9` | B2B: cambio de "Cotización" a "Reservación" |

---

> **Autor:** Actualizado el 31 de marzo de 2026
> **Repos:** [Backend](https://github.com/aldo-rgb/quinta-ali-backend) · [Frontend](https://github.com/aldo-rgb/quinta-ali-frontend)
