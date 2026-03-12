-- =====================================================
-- Base de datos: La Quinta de Alí
-- Sistema híbrido de reservaciones (horas vs noches)
-- =====================================================

-- 1. TABLA DE CLIENTES (Autenticados con Google o Invitados)
CREATE TABLE IF NOT EXISTS clientes (
    id              SERIAL PRIMARY KEY,
    nombre          VARCHAR(100) NOT NULL,
    apellido        VARCHAR(100) NOT NULL DEFAULT '',
    email           VARCHAR(150) UNIQUE NOT NULL,
    telefono        VARCHAR(20),                  -- Opcional al inicio, se pide después
    whatsapp        VARCHAR(20),                  -- Para integración con WhatsApp
    google_id       VARCHAR(255) UNIQUE,           -- Nulo si es invitado
    es_invitado     BOOLEAN DEFAULT FALSE,
    notas           TEXT,
    creado_en       TIMESTAMP DEFAULT NOW(),
    actualizado_en  TIMESTAMP DEFAULT NOW()
);

-- 2. TABLA DE PAQUETES
-- Aquí defines "Alí Party", "Pijama Party", etc.
-- tipo_duracion: 'horas' o 'noche' para el sistema híbrido
CREATE TABLE IF NOT EXISTS paquetes (
    id              SERIAL PRIMARY KEY,
    nombre          VARCHAR(100) NOT NULL,        -- Ej: "Alí Party", "Pijama Party"
    descripcion     TEXT,
    tipo_duracion   VARCHAR(10) NOT NULL CHECK (tipo_duracion IN ('horas', 'noche')),
    duracion_horas  INT,                          -- Ej: 5 horas (NULL si es tipo 'noche')
    precio          DECIMAL(10, 2) NOT NULL,
    capacidad_max   INT,                          -- Máximo de invitados
    activo          BOOLEAN DEFAULT TRUE,
    creado_en       TIMESTAMP DEFAULT NOW()
);

-- 3. TABLA DE RESERVACIONES
-- Corazón del sistema: controla horarios y evita empalmes
CREATE TABLE IF NOT EXISTS reservaciones (
    id              SERIAL PRIMARY KEY,
    cliente_id      INT NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT,
    paquete_id      INT NOT NULL REFERENCES paquetes(id) ON DELETE RESTRICT,
    fecha_evento    DATE NOT NULL,
    hora_inicio     TIME NOT NULL,
    hora_fin        TIME NOT NULL,
    num_invitados   INT,
    estado          VARCHAR(20) DEFAULT 'pendiente'
                        CHECK (estado IN ('pendiente', 'confirmada', 'pagada', 'cancelada', 'completada')),
    monto_total     DECIMAL(10, 2) NOT NULL,
    monto_pagado    DECIMAL(10, 2) DEFAULT 0,
    notas           TEXT,
    ine_url         TEXT,
    creado_en       TIMESTAMP DEFAULT NOW(),
    actualizado_en  TIMESTAMP DEFAULT NOW(),

    -- RESTRICCIÓN: No permitir reservaciones con hora_fin <= hora_inicio
    CONSTRAINT chk_horario_valido CHECK (hora_fin > hora_inicio)
);

-- ÍNDICE para búsquedas rápidas de disponibilidad por fecha
CREATE INDEX idx_reservaciones_fecha ON reservaciones (fecha_evento);

-- ÍNDICE para evitar empalmes: búsqueda por fecha + horarios
CREATE INDEX idx_reservaciones_disponibilidad ON reservaciones (fecha_evento, hora_inicio, hora_fin)
    WHERE estado NOT IN ('cancelada');

-- =====================================================
-- FUNCIÓN: Verificar que no haya empalme de horarios
-- Se ejecuta ANTES de cada INSERT o UPDATE en reservaciones
-- =====================================================
CREATE OR REPLACE FUNCTION verificar_disponibilidad()
RETURNS TRIGGER AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM reservaciones
        WHERE fecha_evento = NEW.fecha_evento
          AND id != COALESCE(NEW.id, 0)
          AND estado NOT IN ('cancelada')
          AND (NEW.hora_inicio, NEW.hora_fin) OVERLAPS (hora_inicio, hora_fin)
    ) THEN
        RAISE EXCEPTION 'CONFLICTO DE HORARIO: Ya existe una reservación en ese horario para la fecha %', NEW.fecha_evento;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- TRIGGER: Se activa automáticamente antes de insertar o actualizar
CREATE TRIGGER trg_verificar_disponibilidad
    BEFORE INSERT OR UPDATE ON reservaciones
    FOR EACH ROW
    EXECUTE FUNCTION verificar_disponibilidad();

-- 4. TABLA DE GALERÍA DE FOTOS (URLs de Cloudinary)
CREATE TABLE IF NOT EXISTS galeria_fotos (
    id          SERIAL PRIMARY KEY,
    area        VARCHAR(50) NOT NULL,            -- 'alberca', 'asador', 'hospedaje', 'cancha', 'jacuzzi', 'palapa'
    url_foto    TEXT NOT NULL,                    -- URL de Cloudinary
    descripcion VARCHAR(200),
    orden       INT DEFAULT 0,
    activo      BOOLEAN DEFAULT TRUE,
    creado_en   TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_galeria_area ON galeria_fotos (area) WHERE activo = TRUE;

-- =====================================================
-- DATOS INICIALES: Paquetes de ejemplo
-- =====================================================
INSERT INTO paquetes (nombre, descripcion, tipo_duracion, duracion_horas, precio, capacidad_max) VALUES
    ('Alí Party',       'Fiesta clásica con todo incluido',                    'horas', 5,  8500.00,  50),
    ('Pijama Party',    'Noche completa de pijamada con actividades',          'noche', NULL, 12000.00, 30),
    ('Mini Alí',        'Paquete económico para eventos pequeños',             'horas', 3,  5000.00,  20),
    ('Alí Premium',     'Paquete premium con decoración y catering incluido',  'horas', 6,  15000.00, 80),
    ('Noche Especial',  'Evento nocturno con servicio completo',               'noche', NULL, 18000.00, 60);
