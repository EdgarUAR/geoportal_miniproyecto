-- ===========================================================================
-- GEOPORTAL DE TRANSPORTE PÚBLICO (URVAN) · Chilpancingo de los Bravo, Gro.
-- Esquema PostGIS + datos demo (colonias, rutas y paradas ficticias)
--
-- AVISO DE HONESTIDAD DE DATOS
--   Las coordenadas, los trazos de ruta, los polígonos de colonias, las
--   tarifas, horarios y poblaciones son APROXIMACIONES / DATOS FICTICIOS
--   con fines de demostración. No constituyen información oficial.
--
-- CAPAS DEL PROYECTO
--   Capa 1: paradas_ascenso  (Point)
--   Capa 2: rutas_urvan      (LineString)
--   Capa 3: colonias         (Polygon)
--   Tabla de relación: rutas_paradas (qué paradas sirve cada ruta, en orden)
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1) Crear la base (ejecutar conectado a la base 'postgres')
--    En Herd normalmente: usuario 'postgres', host 127.0.0.1, puerto 5432
-- ---------------------------------------------------------------------------
-- CREATE DATABASE geo_chilp
--   WITH ENCODING 'UTF8' TEMPLATE template0;

-- Luego CONÉCTATE a 'geo_chilp' y ejecuta el resto:
--   \c geo_chilp


-- ---------------------------------------------------------------------------
-- 2) Extensión espacial
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS postgis;


-- ---------------------------------------------------------------------------
-- 3) Limpieza previa (para poder re-ejecutar el script)
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS rutas_paradas;
DROP TABLE IF EXISTS paradas_ascenso;
DROP TABLE IF EXISTS rutas_urvan;
DROP TABLE IF EXISTS colonias;


-- ---------------------------------------------------------------------------
-- 4) CAPA 3 · Colonias y barrios (POLÍGONO)
-- ---------------------------------------------------------------------------
CREATE TABLE colonias (
    id                  SERIAL PRIMARY KEY,
    clave               VARCHAR(20)  NOT NULL UNIQUE,          -- p.ej. COL-01
    nombre              VARCHAR(120) NOT NULL,
    tipo                VARCHAR(20)  NOT NULL
                        CHECK (tipo IN ('barrio','colonia','zona')),
    poblacion_estimada  INTEGER      NOT NULL DEFAULT 0,       -- dato ficticio
    geom                geometry(Polygon, 4326) NOT NULL
);

CREATE INDEX idx_colonias_geom ON colonias USING GIST (geom);
CREATE INDEX idx_colonias_nombre ON colonias (nombre);

COMMENT ON TABLE colonias IS
  'Delimitación aproximada de colonias y barrios de Chilpancingo. Datos ficticios.';


-- ---------------------------------------------------------------------------
-- 5) CAPA 2 · Rutas de urvan (LÍNEA)
-- ---------------------------------------------------------------------------
CREATE TABLE rutas_urvan (
    id              SERIAL PRIMARY KEY,
    clave           VARCHAR(20)  NOT NULL UNIQUE,              -- p.ej. RUT-01
    nombre          VARCHAR(120) NOT NULL,
    origen          VARCHAR(120) NOT NULL,
    destino         VARCHAR(120) NOT NULL,
    tarifa_mxn      NUMERIC(5,2) NOT NULL DEFAULT 0,           -- MXN estimado
    frecuencia_min  INTEGER      NOT NULL DEFAULT 15,          -- cada cuántos min pasa
    horario_inicio  TIME         NOT NULL,
    horario_fin     TIME         NOT NULL,
    color_hex       CHAR(7)      NOT NULL DEFAULT '#3388ff',   -- color para el mapa
    activa          BOOLEAN      NOT NULL DEFAULT TRUE,
    geom            geometry(LineString, 4326) NOT NULL
);

CREATE INDEX idx_rutas_geom ON rutas_urvan USING GIST (geom);
CREATE INDEX idx_rutas_activa ON rutas_urvan (activa);

COMMENT ON TABLE rutas_urvan IS
  'Recorrido aproximado de cada ruta de urvan en Chilpancingo. Datos ficticios.';


-- ---------------------------------------------------------------------------
-- 6) CAPA 1 · Paradas / puntos de ascenso (PUNTO)
-- ---------------------------------------------------------------------------
CREATE TABLE paradas_ascenso (
    id           SERIAL PRIMARY KEY,
    clave        VARCHAR(20)  NOT NULL UNIQUE,                 -- p.ej. PAR-001
    nombre       VARCHAR(120) NOT NULL,
    tipo         VARCHAR(30)  NOT NULL
                 CHECK (tipo IN ('terminal','base','parada_autorizada')),
    referencia   VARCHAR(180),                                 -- calle / cruce
    techada      BOOLEAN      NOT NULL DEFAULT FALSE,
    estatus      VARCHAR(20)  NOT NULL DEFAULT 'activa'
                 CHECK (estatus IN ('activa','inactiva','propuesta')),
    fecha_alta   DATE,
    geom         geometry(Point, 4326) NOT NULL
);

-- Índice espacial GiST (indispensable para consultas por distancia / mapa)
CREATE INDEX idx_paradas_geom ON paradas_ascenso USING GIST (geom);
-- Índices de apoyo
CREATE INDEX idx_paradas_estatus ON paradas_ascenso (estatus);
CREATE INDEX idx_paradas_tipo ON paradas_ascenso (tipo);

COMMENT ON TABLE paradas_ascenso IS
  'Sitios donde las urvans hacen base o parada. Datos ficticios.';


-- ---------------------------------------------------------------------------
-- 7) Relación rutas <-> paradas (una parada puede servir a varias rutas)
-- ---------------------------------------------------------------------------
CREATE TABLE rutas_paradas (
    ruta_id    INTEGER NOT NULL REFERENCES rutas_urvan(id)      ON DELETE CASCADE,
    parada_id  INTEGER NOT NULL REFERENCES paradas_ascenso(id)  ON DELETE CASCADE,
    orden      INTEGER NOT NULL,                               -- posición en el recorrido
    PRIMARY KEY (ruta_id, parada_id)
);

CREATE INDEX idx_rutas_paradas_parada ON rutas_paradas (parada_id);

COMMENT ON TABLE rutas_paradas IS
  'Paradas que atiende cada ruta, ordenadas a lo largo del recorrido.';


-- ---------------------------------------------------------------------------
-- 8) DATOS DEMO · 11 colonias (coordenadas aproximadas, formato lon lat)
--    Los polígonos vecinos comparten borde, como en un plano real.
--    Dos colonias quedan SIN ruta a propósito: Loma Bonita y Vista Hermosa.
-- ---------------------------------------------------------------------------
INSERT INTO colonias (clave, nombre, tipo, poblacion_estimada, geom) VALUES
('COL-01','Centro','zona',          5200, ST_GeomFromText('POLYGON((-99.5040 17.5490,-99.4975 17.5490,-99.4970 17.5535,-99.5035 17.5538,-99.5040 17.5490))',4326)),
('COL-02','Barrio de San Mateo','barrio', 4100, ST_GeomFromText('POLYGON((-99.4975 17.5490,-99.4920 17.5492,-99.4915 17.5540,-99.4970 17.5535,-99.4975 17.5490))',4326)),
('COL-03','Santa Cruz','barrio',    3800, ST_GeomFromText('POLYGON((-99.5040 17.5440,-99.4975 17.5438,-99.4975 17.5490,-99.5040 17.5490,-99.5040 17.5440))',4326)),
('COL-04','San Francisco','barrio', 3500, ST_GeomFromText('POLYGON((-99.5100 17.5485,-99.5040 17.5490,-99.5035 17.5538,-99.5095 17.5542,-99.5100 17.5485))',4326)),
('COL-05','Colonia Galeana','colonia', 4600, ST_GeomFromText('POLYGON((-99.5035 17.5538,-99.4970 17.5535,-99.4968 17.5590,-99.5033 17.5592,-99.5035 17.5538))',4326)),
('COL-06','Ruffo Figueroa','colonia',  5300, ST_GeomFromText('POLYGON((-99.4970 17.5535,-99.4915 17.5540,-99.4912 17.5600,-99.4968 17.5590,-99.4970 17.5535))',4326)),
('COL-07','Ciudad Universitaria','zona', 2900, ST_GeomFromText('POLYGON((-99.5170 17.5490,-99.5100 17.5485,-99.5095 17.5542,-99.5100 17.5565,-99.5165 17.5568,-99.5170 17.5490))',4326)),
('COL-08','PRD','colonia',          3200, ST_GeomFromText('POLYGON((-99.4920 17.5492,-99.4860 17.5495,-99.4858 17.5545,-99.4915 17.5540,-99.4920 17.5492))',4326)),
('COL-09','Indeco','colonia',       4400, ST_GeomFromText('POLYGON((-99.5040 17.5385,-99.4975 17.5382,-99.4975 17.5438,-99.5040 17.5440,-99.5040 17.5385))',4326)),
('COL-10','Loma Bonita','colonia',  2100, ST_GeomFromText('POLYGON((-99.4975 17.5382,-99.4915 17.5385,-99.4920 17.5440,-99.4975 17.5438,-99.4975 17.5382))',4326)),
('COL-11','Vista Hermosa','colonia',1800, ST_GeomFromText('POLYGON((-99.5033 17.5592,-99.4968 17.5590,-99.4965 17.5645,-99.5030 17.5648,-99.5033 17.5592))',4326));


-- ---------------------------------------------------------------------------
-- 9) DATOS DEMO · 5 rutas de urvan (trazo aproximado, formato lon lat)
-- ---------------------------------------------------------------------------
INSERT INTO rutas_urvan
  (clave, nombre, origen, destino, tarifa_mxn, frecuencia_min,
   horario_inicio, horario_fin, color_hex, activa, geom)
VALUES
('RUT-01','Ruta Mercado–CU','Mercado Baltazar R. Leyva Mancilla','Ciudad Universitaria UAGro',
  12.00, 10, '06:00','21:00','#e63946', TRUE,
  ST_GeomFromText('LINESTRING(-99.5002 17.5478,-99.5005 17.5505,-99.5008 17.5513,-99.5070 17.5518,-99.5130 17.5522,-99.5140 17.5545)',4326)),

('RUT-02','Ruta PRD–Centro','Base PRD','Zócalo',
  10.00, 12, '06:00','20:30','#2a9d8f', TRUE,
  ST_GeomFromText('LINESTRING(-99.4880 17.5515,-99.4940 17.5513,-99.4985 17.5511,-99.5008 17.5513)',4326)),

('RUT-03','Ruta Petaquillas–Centro','Terminal Petaquillas','Zócalo',
  18.00, 20, '05:30','21:30','#f4a261', TRUE,
  ST_GeomFromText('LINESTRING(-99.5120 17.5250,-99.5090 17.5350,-99.5060 17.5420,-99.5030 17.5470,-99.5008 17.5513)',4326)),

('RUT-04','Ruta Indeco–Mercado','Base Indeco','Mercado Baltazar R. Leyva Mancilla',
  10.00, 15, '06:00','20:00','#6a4c93', TRUE,
  ST_GeomFromText('LINESTRING(-99.5010 17.5400,-99.5005 17.5440,-99.5002 17.5478)',4326)),

('RUT-05','Ruta Zócalo–Galerías','Zócalo','Galerías Chilpancingo',
  12.00, 10, '06:30','21:00','#1d3557', TRUE,
  ST_GeomFromText('LINESTRING(-99.5008 17.5513,-99.5003 17.5540,-99.5000 17.5565,-99.4975 17.5578,-99.4940 17.5575)',4326));


-- ---------------------------------------------------------------------------
-- 10) DATOS DEMO · 15 paradas (coordenadas aproximadas, formato lon lat)
--     Distribución: 13 activas · 1 inactiva · 1 propuesta
--     Las dos últimas NO están sobre ninguna ruta (sirven para probar consultas)
-- ---------------------------------------------------------------------------
INSERT INTO paradas_ascenso
  (clave, nombre, tipo, referencia, techada, estatus, fecha_alta, geom)
VALUES
('PAR-001','Mercado Baltazar R. Leyva Mancilla','base','Acceso principal del mercado', TRUE,'activa','2019-03-10', ST_SetSRID(ST_MakePoint(-99.5002,17.5478),4326)),
('PAR-002','Zócalo (Plaza Cívica)','base','Av. Juárez frente a Plaza Cívica', TRUE,'activa','2018-01-15', ST_SetSRID(ST_MakePoint(-99.5008,17.5513),4326)),
('PAR-003','Ciudad Universitaria UAGro','terminal','Entrada principal CU', TRUE,'activa','2020-08-24', ST_SetSRID(ST_MakePoint(-99.5140,17.5545),4326)),
('PAR-004','Galerías Chilpancingo','terminal','Estacionamiento de la plaza', TRUE,'activa','2021-05-03', ST_SetSRID(ST_MakePoint(-99.4940,17.5575),4326)),
('PAR-005','Hospital General','parada_autorizada','Frente a urgencias', FALSE,'activa','2019-11-18', ST_SetSRID(ST_MakePoint(-99.5000,17.5565),4326)),
('PAR-006','Terminal Petaquillas','terminal','Entronque carretera federal', FALSE,'activa','2017-06-01', ST_SetSRID(ST_MakePoint(-99.5120,17.5250),4326)),
('PAR-007','Base PRD','base','Calle principal de la colonia', FALSE,'activa','2020-02-12', ST_SetSRID(ST_MakePoint(-99.4880,17.5515),4326)),
('PAR-008','Base Indeco','base','Entrada a la colonia Indeco', FALSE,'activa','2019-09-09', ST_SetSRID(ST_MakePoint(-99.5010,17.5400),4326)),
('PAR-009','Parada San Mateo','parada_autorizada','Plazuela del barrio', FALSE,'activa','2018-04-20', ST_SetSRID(ST_MakePoint(-99.4940,17.5513),4326)),
('PAR-010','Parada San Francisco','parada_autorizada','Av. Juárez esq. calle lateral', FALSE,'activa','2018-04-20', ST_SetSRID(ST_MakePoint(-99.5070,17.5518),4326)),
('PAR-011','Entronque Sur','parada_autorizada','Salida sur de la ciudad', FALSE,'activa','2022-01-17', ST_SetSRID(ST_MakePoint(-99.5090,17.5350),4326)),
('PAR-012','Parada Santa Cruz','parada_autorizada','Calle Santa Cruz y andador', FALSE,'activa','2019-03-10', ST_SetSRID(ST_MakePoint(-99.5030,17.5470),4326)),
('PAR-013','Parada Ruffo Figueroa','parada_autorizada','Av. Ruffo Figueroa', TRUE,'activa','2021-05-03', ST_SetSRID(ST_MakePoint(-99.4975,17.5578),4326)),
('PAR-014','Parada Loma Bonita','parada_autorizada','Calle Loma Bonita', FALSE,'inactiva','2016-07-22', ST_SetSRID(ST_MakePoint(-99.4945,17.5410),4326)),
('PAR-015','Parada Vista Hermosa (propuesta)','parada_autorizada','Mirador Vista Hermosa', FALSE,'propuesta', NULL, ST_SetSRID(ST_MakePoint(-99.5000,17.5620),4326));


-- ---------------------------------------------------------------------------
-- 11) Relación rutas <-> paradas, calculada ESPACIALMENTE
--     Una parada pertenece a una ruta si está a 40 m o menos de su trazo.
--     El orden sale de la posición de la parada a lo largo de la línea.
-- ---------------------------------------------------------------------------
INSERT INTO rutas_paradas (ruta_id, parada_id, orden)
SELECT r.id,
       p.id,
       ROW_NUMBER() OVER (PARTITION BY r.id
                          ORDER BY ST_LineLocatePoint(r.geom, p.geom))
FROM rutas_urvan r
JOIN paradas_ascenso p
  ON ST_DWithin(r.geom::geography, p.geom::geography, 40);


-- ---------------------------------------------------------------------------
-- 12) Verificación rápida (ejecutar una por una)
-- ---------------------------------------------------------------------------
-- SELECT 'colonias' AS capa, COUNT(*) FROM colonias
-- UNION ALL SELECT 'rutas_urvan', COUNT(*) FROM rutas_urvan
-- UNION ALL SELECT 'paradas_ascenso', COUNT(*) FROM paradas_ascenso
-- UNION ALL SELECT 'rutas_paradas', COUNT(*) FROM rutas_paradas;
--
-- SELECT estatus, COUNT(*) FROM paradas_ascenso GROUP BY estatus ORDER BY estatus;


-- ---------------------------------------------------------------------------
-- 13) PREGUNTAS ESPACIALES DEL GEOPORTAL
-- ---------------------------------------------------------------------------

-- Pregunta 1 (punto contra línea):
-- ¿Qué rutas pasan a menos de 300 m de una ubicación? (ej. -99.5050, 17.5500)
-- SELECT r.clave, r.nombre,
--        ROUND(ST_Distance(r.geom::geography, q.pt::geography)::numeric, 1) AS distancia_m
-- FROM rutas_urvan r
-- CROSS JOIN (SELECT ST_SetSRID(ST_MakePoint(-99.5050, 17.5500), 4326) AS pt) q
-- WHERE r.activa
--   AND ST_DWithin(r.geom::geography, q.pt::geography, 300)
-- ORDER BY distancia_m;

-- Parada más cercana a esa misma ubicación (cuánto hay que caminar):
-- SELECT p.nombre,
--        ROUND(ST_Distance(p.geom::geography, q.pt::geography)::numeric, 1) AS caminata_m
-- FROM paradas_ascenso p
-- CROSS JOIN (SELECT ST_SetSRID(ST_MakePoint(-99.5050, 17.5500), 4326) AS pt) q
-- WHERE p.estatus = 'activa'
-- ORDER BY p.geom <-> q.pt
-- LIMIT 3;

-- Pregunta 2 (polígono contra línea):
-- ¿Qué rutas atraviesan cada colonia y cuáles no tienen cobertura?
-- SELECT c.nombre AS colonia,
--        COUNT(DISTINCT r.id) AS num_rutas,
--        COALESCE(string_agg(DISTINCT r.nombre, ', '), 'SIN COBERTURA') AS rutas
-- FROM colonias c
-- LEFT JOIN rutas_urvan r
--        ON ST_Intersects(c.geom, r.geom) AND r.activa
-- GROUP BY c.id, c.nombre
-- ORDER BY num_rutas DESC, c.nombre;

-- Solo las colonias sin ninguna ruta:
-- SELECT c.nombre
-- FROM colonias c
-- WHERE NOT EXISTS (
--     SELECT 1 FROM rutas_urvan r
--     WHERE r.activa AND ST_Intersects(c.geom, r.geom)
-- );

-- Extras útiles:
-- Longitud real de cada ruta en km
-- SELECT clave, nombre, ROUND((ST_Length(geom::geography)/1000)::numeric, 2) AS km
-- FROM rutas_urvan ORDER BY km DESC;

-- Paradas dentro de cada colonia
-- SELECT c.nombre AS colonia, COUNT(p.id) AS paradas
-- FROM colonias c
-- LEFT JOIN paradas_ascenso p ON ST_Contains(c.geom, p.geom)
-- GROUP BY c.id, c.nombre
-- ORDER BY paradas DESC, c.nombre;

-- Paradas de una ruta, en orden de recorrido
-- SELECT rp.orden, p.nombre
-- FROM rutas_paradas rp
-- JOIN rutas_urvan r ON r.id = rp.ruta_id
-- JOIN paradas_ascenso p ON p.id = rp.parada_id
-- WHERE r.clave = 'RUT-01'
-- ORDER BY rp.orden;
