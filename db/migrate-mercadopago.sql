-- =====================================================
-- Migración: Tabla pagos_mercadopago para Checkout Pro
-- Ejecutar en Neon PostgreSQL
-- =====================================================

CREATE TABLE IF NOT EXISTS pagos_mercadopago (
  id SERIAL PRIMARY KEY,
  reservacion_id INTEGER REFERENCES reservaciones(id),
  preference_id VARCHAR(100) UNIQUE,
  payment_id VARCHAR(100),
  external_reference VARCHAR(100),
  monto NUMERIC(12,2) NOT NULL,
  estado VARCHAR(20) DEFAULT 'pendiente', -- pendiente, aprobado, rechazado
  payment_status VARCHAR(50), -- approved, pending, rejected, etc.
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Índices para búsquedas rápidas
CREATE INDEX IF NOT EXISTS idx_pagos_mp_reservacion ON pagos_mercadopago(reservacion_id);
CREATE INDEX IF NOT EXISTS idx_pagos_mp_preference ON pagos_mercadopago(preference_id);
CREATE INDEX IF NOT EXISTS idx_pagos_mp_external_ref ON pagos_mercadopago(external_reference);

-- Verificar
SELECT 'Tabla pagos_mercadopago creada correctamente' AS resultado;
