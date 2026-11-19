-- ===========================================================================
-- CONSULTAS ESPACIALES DE REFERENCIA · GeoUrvan
-- Chilpancingo de los Bravo, Guerrero
--
-- Todas las consultas están pensadas para ejecutarse con psql sobre la base
-- geo_chilp ya cargada. Los resultados que se muestran en los comentarios
-- corresponden a los datos demo de database/geo_chilp.sql.
--
-- Uso:
--   psql -U postgres -d geo_chilp -f database/consultas.sql
--
-- Cambiar el punto de análisis:
--   psql -U postgres -d geo_chilp \
--        -v lon=-99.5050 -v lat=17.5500 -v radio=300 \
--        -f database/consultas.sql
-- ===========================================================================

\set ON_ERROR_STOP on
\pset pager off

\if :{?lon}
\else
  \set lon -99.5050
\endif

\if :{?lat}
\else
  \set lat 17.5500
\endif

\if :{?radio}
\else
  \set radio 300
\endif

\echo ''
\echo '=============================================================='
\echo '  Punto de análisis: lon=' :lon ' lat=' :lat ' radio=' :radio ' m'
\echo '=============================================================='


-- ---------------------------------------------------------------------------
-- 0) Inventario de capas
-- ---------------------------------------------------------------------------
\echo ''
\echo '--- 0. Inventario de capas ---'

SELECT 'colonias'       AS capa, COUNT(*) AS registros FROM colonias
UNION ALL SELECT 'rutas_urvan',     COUNT(*) FROM rutas_urvan
UNION ALL SELECT 'paradas_ascenso', COUNT(*) FROM paradas_ascenso
UNION ALL SELECT 'rutas_paradas',   COUNT(*) FROM rutas_paradas;

-- Esperado (demo): 11 · 5 · 15 · 17


-- ---------------------------------------------------------------------------
-- PREGUNTA 1 · ¿Qué rutas pasan a menos de 300 m del punto?
-- Punto contra línea (ST_DWithin sobre geography = metros reales).
-- ---------------------------------------------------------------------------
\echo ''
\echo '--- 1. Rutas a menos de' :radio 'm del punto ---'

WITH q AS (
    SELECT ST_SetSRID(ST_MakePoint(:lon, :lat), 4326) AS pt
)
SELECT r.clave,
       r.nombre,
       r.origen || ' → ' || r.destino       AS recorrido,
       r.color_hex,
       ROUND(ST_Distance(r.geom::geography, q.pt::geography)::numeric, 0) AS distancia_m,
       ROUND((ST_Length(r.geom::geography) / 1000)::numeric, 2)           AS km_ruta,
       r.tarifa_mxn,
       r.frecuencia_min,
       to_char(r.horario_inicio, 'HH24:MI') || '–' ||
       to_char(r.horario_fin, 'HH24:MI')    AS horario
  FROM rutas_urvan r
  CROSS JOIN q
 WHERE r.activa
   AND ST_DWithin(r.geom::geography, q.pt::geography, :radio)
 ORDER BY distancia_m, r.clave;


-- ---------------------------------------------------------------------------
-- 1b) Parada más cercana de cada ruta (¿cuánto hay que caminar?)
-- ---------------------------------------------------------------------------
\echo ''
\echo '--- 1b. Parada activa más cercana por ruta ---'

WITH q AS (
    SELECT ST_SetSRID(ST_MakePoint(:lon, :lat), 4326) AS pt
)
SELECT r.clave,
       r.nombre AS ruta,
       p.clave AS parada,
       p.nombre AS parada_nombre,
       ROUND(ST_Distance(p.geom::geography, q.pt::geography)::numeric, 0) AS caminata_m,
       p.techada
  FROM rutas_urvan r
  CROSS JOIN q
  JOIN LATERAL (
      SELECT p.*
        FROM paradas_ascenso p
        JOIN rutas_paradas rp ON rp.parada_id = p.id
       WHERE rp.ruta_id = r.id
         AND p.estatus = 'activa'
       ORDER BY p.geom <-> q.pt
       LIMIT 1
  ) p ON TRUE
 WHERE r.activa
   AND ST_DWithin(r.geom::geography, q.pt::geography, :radio)
 ORDER BY caminata_m, r.clave;


-- ---------------------------------------------------------------------------
-- 1c) Todas las paradas activas dentro del radio
-- ---------------------------------------------------------------------------
\echo ''
\echo '--- 1c. Paradas activas dentro del radio ---'

WITH q AS (
    SELECT ST_SetSRID(ST_MakePoint(:lon, :lat), 4326) AS pt
)
SELECT p.clave,
       p.nombre,
       p.tipo,
       ROUND(ST_Distance(p.geom::geography, q.pt::geography)::numeric, 0) AS distancia_m,
       COALESCE(string_agg(DISTINCT r.clave, ', ' ORDER BY r.clave), '—') AS rutas
  FROM paradas_ascenso p
  CROSS JOIN q
  LEFT JOIN rutas_paradas rp ON rp.parada_id = p.id
  LEFT JOIN rutas_urvan r ON r.id = rp.ruta_id AND r.activa
 WHERE p.estatus = 'activa'
   AND ST_DWithin(p.geom::geography, q.pt::geography, :radio)
 GROUP BY p.id, p.clave, p.nombre, p.tipo, p.geom, q.pt
 ORDER BY distancia_m, p.clave;


-- ---------------------------------------------------------------------------
-- 1d) ¿En qué colonia cae el punto? (o la más cercana si cae fuera)
-- ---------------------------------------------------------------------------
\echo ''
\echo '--- 1d. Colonia del punto ---'

WITH q AS (
    SELECT ST_SetSRID(ST_MakePoint(:lon, :lat), 4326) AS pt
),
candidatas AS (
    SELECT c.id,
           c.clave,
           c.nombre,
           c.tipo,
           c.poblacion_estimada,
           c.geom,
           ST_Intersects(c.geom, q.pt) AS dentro,
           ROUND(ST_Distance(c.geom::geography, q.pt::geography)::numeric, 0)::int AS distancia_m
      FROM colonias c
      CROSS JOIN q
)
SELECT c.clave,
       c.nombre,
       c.tipo,
       c.poblacion_estimada,
       c.dentro,
       c.distancia_m,
       (SELECT COUNT(DISTINCT r.id)
          FROM rutas_urvan r
         WHERE r.activa AND ST_Intersects(c.geom, r.geom)) AS num_rutas
  FROM candidatas c
 ORDER BY c.dentro DESC, c.distancia_m, c.clave
 LIMIT 1;


-- ---------------------------------------------------------------------------
-- PREGUNTA 2 · Cobertura por colonia (polígono contra línea)
-- ---------------------------------------------------------------------------
\echo ''
\echo '--- 2. Cobertura de cada colonia ---'

SELECT c.clave,
       c.nombre,
       c.tipo,
       c.poblacion_estimada,
       COUNT(DISTINCT r.id) AS rutas,
       COALESCE(string_agg(DISTINCT r.clave, ', ' ORDER BY r.clave), 'SIN COBERTURA') AS claves_rutas,
       ROUND((
           SELECT COALESCE(SUM(
                      ST_Length(ST_Intersection(c.geom, r2.geom)::geography)
                  ), 0) / 1000
             FROM rutas_urvan r2
            WHERE r2.activa AND ST_Intersects(c.geom, r2.geom)
       )::numeric, 2) AS km_de_ruta_dentro
  FROM colonias c
  LEFT JOIN rutas_urvan r
         ON r.activa AND ST_Intersects(c.geom, r.geom)
 GROUP BY c.id, c.clave, c.nombre, c.tipo, c.poblacion_estimada
 ORDER BY rutas, c.nombre;

-- Nota: km_de_ruta_dentro suma el tramo de cada ruta que cae dentro del
-- polígono. Si dos rutas se superponen, cada una cuenta por separado.


-- ---------------------------------------------------------------------------
-- 2b) Colonias SIN ninguna ruta activa (prioridad de inversión)
-- ---------------------------------------------------------------------------
\echo ''
\echo '--- 2b. Colonias sin cobertura ---'

SELECT c.clave,
       c.nombre,
       c.tipo,
       c.poblacion_estimada,
       ROUND((ST_Area(c.geom::geography) / 10000)::numeric, 2) AS hectareas,
       ROUND((
           SELECT MIN(ST_Distance(c.geom::geography, r.geom::geography))
             FROM rutas_urvan r
            WHERE r.activa
       )::numeric, 0) AS dist_ruta_m,
       ROUND((
           SELECT MIN(ST_Distance(c.geom::geography, p.geom::geography))
             FROM paradas_ascenso p
            WHERE p.estatus = 'activa'
       )::numeric, 0) AS dist_parada_m
  FROM colonias c
 WHERE NOT EXISTS (
       SELECT 1
         FROM rutas_urvan r
        WHERE r.activa AND ST_Intersects(c.geom, r.geom)
 )
 ORDER BY c.poblacion_estimada DESC, c.nombre;

-- Esperado (demo): Loma Bonita (2,100 hab) y Vista Hermosa (1,800 hab).


-- ---------------------------------------------------------------------------
-- 2c) Cobertura en población y superficie
-- ---------------------------------------------------------------------------
\echo ''
\echo '--- 2c. Cobertura agregada ---'

WITH c AS (
    SELECT c.id,
           c.poblacion_estimada,
           ST_Area(c.geom::geography) AS area_m2,
           EXISTS (
               SELECT 1 FROM rutas_urvan r
                WHERE r.activa AND ST_Intersects(c.geom, r.geom)
           ) AS cubierta
      FROM colonias c
)
SELECT COUNT(*)                                                   AS colonias,
       COUNT(*) FILTER (WHERE cubierta)                           AS con_cobertura,
       COUNT(*) FILTER (WHERE NOT cubierta)                       AS sin_cobertura,
       ROUND(100.0 * COUNT(*) FILTER (WHERE cubierta) / COUNT(*), 1) AS pct_colonias,
       SUM(poblacion_estimada)                                    AS poblacion_total,
       SUM(poblacion_estimada) FILTER (WHERE NOT cubierta)        AS poblacion_sin_cobertura,
       ROUND(100.0 * SUM(poblacion_estimada) FILTER (WHERE cubierta)
             / NULLIF(SUM(poblacion_estimada), 0), 1)             AS pct_poblacion_cubierta,
       ROUND((SUM(area_m2) / 1000000)::numeric, 2)                AS superficie_km2,
       ROUND((SUM(area_m2) FILTER (WHERE cubierta) / 1000000)::numeric, 2) AS superficie_cubierta_km2
  FROM c;


-- ---------------------------------------------------------------------------
-- 2d) ¿Qué rutas cruzan una colonia concreta? (ej. COL-01)
-- ---------------------------------------------------------------------------
\echo ''
\echo '--- 2d. Rutas de la colonia COL-01 ---'

SELECT c.nombre AS colonia,
       r.clave,
       r.nombre,
       ROUND((ST_Length(ST_Intersection(c.geom, r.geom)::geography) / 1000)::numeric, 3) AS km_dentro
  FROM colonias c
  JOIN rutas_urvan r
    ON r.activa AND ST_Intersects(c.geom, r.geom)
 WHERE c.clave = 'COL-01'
 ORDER BY km_dentro DESC, r.clave;


-- ---------------------------------------------------------------------------
-- 3) Indicadores de red y paradas
-- ---------------------------------------------------------------------------
\echo ''
\echo '--- 3. Kilómetros y frecuencias por ruta ---'

SELECT r.clave,
       r.nombre,
       ROUND((ST_Length(r.geom::geography) / 1000)::numeric, 2) AS km,
       r.tarifa_mxn,
       r.frecuencia_min,
       COUNT(rp.parada_id) AS paradas,
       (SELECT COUNT(*) FROM colonias c
         WHERE ST_Intersects(c.geom, r.geom)) AS colonias,
       r.activa
  FROM rutas_urvan r
  LEFT JOIN rutas_paradas rp ON rp.ruta_id = r.id
 GROUP BY r.id, r.clave, r.nombre, r.geom, r.tarifa_mxn, r.frecuencia_min, r.activa
 ORDER BY km DESC, r.clave;


\echo ''
\echo '--- 3b. Paradas por estatus y tipo ---'

SELECT estatus,
       tipo,
       COUNT(*)                                  AS total,
       COUNT(*) FILTER (WHERE techada)           AS techadas
  FROM paradas_ascenso
 GROUP BY estatus, tipo
 ORDER BY estatus, tipo;


\echo ''
\echo '--- 3c. Paradas dentro de cada colonia ---'

SELECT c.clave,
       c.nombre AS colonia,
       COUNT(p.id)                                      AS paradas,
       COUNT(p.id) FILTER (WHERE p.estatus = 'activa')  AS activas,
       COUNT(p.id) FILTER (WHERE p.estatus = 'inactiva') AS inactivas,
       COUNT(p.id) FILTER (WHERE p.estatus = 'propuesta') AS propuestas
  FROM colonias c
  LEFT JOIN paradas_ascenso p ON ST_Intersects(c.geom, p.geom)
 GROUP BY c.id, c.clave, c.nombre
 ORDER BY paradas DESC, c.nombre;


\echo ''
\echo '--- 3d. Paradas que no sirven a ninguna ruta activa ---'

SELECT p.clave, p.nombre, p.tipo, p.estatus, p.referencia
  FROM paradas_ascenso p
 WHERE NOT EXISTS (
       SELECT 1
         FROM rutas_paradas rp
         JOIN rutas_urvan r ON r.id = rp.ruta_id AND r.activa
        WHERE rp.parada_id = p.id
 )
 ORDER BY p.estatus, p.clave;

-- Esperado (demo): PAR-014 (inactiva) y PAR-015 (propuesta).


-- ---------------------------------------------------------------------------
-- 4) Accesibilidad
-- ---------------------------------------------------------------------------
\echo ''
\echo '--- 4. Paradas y rutas por cada 10 mil habitantes ---'

WITH tot AS (
    SELECT SUM(poblacion_estimada)::numeric AS poblacion FROM colonias
)
SELECT (SELECT COUNT(*) FROM paradas_ascenso WHERE estatus = 'activa') AS paradas_activas,
       (SELECT COUNT(*) FROM rutas_urvan WHERE activa)                  AS rutas_activas,
       t.poblacion,
       ROUND((SELECT COUNT(*) FROM paradas_ascenso WHERE estatus = 'activa')
             / t.poblacion * 10000, 1) AS paradas_por_10k,
       ROUND((SELECT COUNT(*) FROM rutas_urvan WHERE activa)
             / t.poblacion * 10000, 1) AS rutas_por_10k
  FROM tot t;


-- ---------------------------------------------------------------------------
-- 5) Apoyo a decisiones presupuestales
-- ---------------------------------------------------------------------------
\echo ''
\echo '--- 5a. Ranking de colonias sin cobertura por costo estimado ---'

-- Supuestos EDITABLES (los mismos del geoportal):
--   350,000 MXN por km de ampliación · 120,000 MXN por parada nueva.
WITH costo AS (
    SELECT 350000::numeric AS costo_km,
           120000::numeric AS costo_parada
),
prioridad AS (
    SELECT c.clave,
           c.nombre,
           c.poblacion_estimada,
           ROUND((
               SELECT MIN(ST_Distance(c.geom::geography, r.geom::geography))
                 FROM rutas_urvan r
                WHERE r.activa
           )::numeric, 0) AS dist_ruta_m
      FROM colonias c
     WHERE NOT EXISTS (
           SELECT 1 FROM rutas_urvan r
            WHERE r.activa AND ST_Intersects(c.geom, r.geom)
     )
)
SELECT p.clave,
       p.nombre,
       p.poblacion_estimada,
       p.dist_ruta_m,
       ROUND(GREATEST(p.dist_ruta_m / 1000.0, 0.15)::numeric, 2)          AS km_estimados,
       ROUND((GREATEST(p.dist_ruta_m / 1000.0, 0.15) * c.costo_km
              + c.costo_parada)::numeric, 0)                              AS costo_estimado_mxn,
       ROUND((GREATEST(p.dist_ruta_m / 1000.0, 0.15) * c.costo_km
              + c.costo_parada) / NULLIF(p.poblacion_estimada, 0), 2)     AS costo_por_habitante
  FROM prioridad p
  CROSS JOIN costo c
 ORDER BY costo_por_habitante, p.nombre;


\echo ''
\echo '--- 5b. Posibles nuevas paradas: puntos de ruta a >300 m de una parada activa ---'

-- Muestrea 21 puntos por ruta (cada 5 % del trazo) y conserva los que están
-- lejos de toda parada activa. Sirve para ubicar paradas candidatas.
WITH muestras AS (
    SELECT r.clave AS ruta_clave,
           r.nombre AS ruta_nombre,
           g,
           ST_LineInterpolatePoint(r.geom, g / 20.0) AS pt
      FROM rutas_urvan r
      CROSS JOIN generate_series(0, 20) AS g
     WHERE r.activa
)
SELECT m.ruta_clave,
       m.ruta_nombre,
       ROUND(ST_X(m.pt)::numeric, 6) AS lon,
       ROUND(ST_Y(m.pt)::numeric, 6) AS lat,
       ROUND((
           SELECT MIN(ST_Distance(p.geom::geography, m.pt::geography))
             FROM paradas_ascenso p
            WHERE p.estatus = 'activa'
       )::numeric, 0) AS dist_parada_activa_m
  FROM muestras m
 WHERE NOT EXISTS (
       SELECT 1
         FROM paradas_ascenso p
        WHERE p.estatus = 'activa'
          AND ST_DWithin(p.geom::geography, m.pt::geography, 300)
 )
 ORDER BY m.ruta_clave, m.g;


\echo ''
\echo '--- 5c. Conteo de paradas candidatas por ruta ---'

WITH muestras AS (
    SELECT r.clave AS ruta_clave, g,
           ST_LineInterpolatePoint(r.geom, g / 20.0) AS pt
      FROM rutas_urvan r
      CROSS JOIN generate_series(0, 20) AS g
     WHERE r.activa
)
SELECT m.ruta_clave,
       COUNT(*) AS puntos_sin_parada_cercana
  FROM muestras m
 WHERE NOT EXISTS (
       SELECT 1 FROM paradas_ascenso p
        WHERE p.estatus = 'activa'
          AND ST_DWithin(p.geom::geography, m.pt::geography, 300)
 )
 GROUP BY m.ruta_clave
 ORDER BY puntos_sin_parada_cercana DESC, m.ruta_clave;


-- ---------------------------------------------------------------------------
-- 6) Calidad de datos
-- ---------------------------------------------------------------------------
\echo ''
\echo '--- 6a. Geometrías inválidas o vacías ---'

SELECT 'colonias' AS capa, clave, nombre, ST_IsValidReason(geom) AS motivo
  FROM colonias
 WHERE NOT ST_IsValid(geom) OR ST_IsEmpty(geom)
UNION ALL
SELECT 'rutas_urvan', clave, nombre, ST_IsValidReason(geom)
  FROM rutas_urvan
 WHERE NOT ST_IsValid(geom) OR ST_IsEmpty(geom)
UNION ALL
SELECT 'paradas_ascenso', clave, nombre, ST_IsValidReason(geom)
  FROM paradas_ascenso
 WHERE NOT ST_IsValid(geom) OR ST_IsEmpty(geom);


\echo ''
\echo '--- 6b. Paradas de rutas_paradas que están a más de 40 m del trazo ---'

SELECT r.clave AS ruta,
       p.clave AS parada,
       p.nombre,
       ROUND(ST_Distance(r.geom::geography, p.geom::geography)::numeric, 1) AS distancia_m
  FROM rutas_paradas rp
  JOIN rutas_urvan r     ON r.id = rp.ruta_id
  JOIN paradas_ascenso p ON p.id = rp.parada_id
 WHERE NOT ST_DWithin(r.geom::geography, p.geom::geography, 40)
 ORDER BY distancia_m DESC;

-- Sin filas = la relación está consistente con la tolerancia de 40 m.


\echo ''
\echo '--- 6c. Rutas activas sin paradas y paradas activas sin ruta ---'

SELECT 'ruta sin paradas' AS hallazgo, r.clave, r.nombre
  FROM rutas_urvan r
 WHERE r.activa
   AND NOT EXISTS (SELECT 1 FROM rutas_paradas rp WHERE rp.ruta_id = r.id)
UNION ALL
SELECT 'parada activa sin ruta', p.clave, p.nombre
  FROM paradas_ascenso p
 WHERE p.estatus = 'activa'
   AND NOT EXISTS (SELECT 1 FROM rutas_paradas rp WHERE rp.parada_id = p.id);


-- ---------------------------------------------------------------------------
-- 7) Geometrías derivadas útiles para QGIS o para exportar
-- ---------------------------------------------------------------------------
\echo ''
\echo '--- 7a. Área de influencia de 300 m alrededor del punto (GeoJSON) ---'

WITH q AS (
    SELECT ST_SetSRID(ST_MakePoint(:lon, :lat), 4326) AS pt
)
SELECT ST_AsGeoJSON(
           ST_Buffer(q.pt::geography, :radio)::geometry,
           6
       ) AS buffer_geojson
  FROM q;

-- Pega el resultado en https://geojson.io para verlo.
-- En QGIS: Database Manager → consulta → cargar como capa.


\echo ''
\echo '--- 7b. Recorrido de una ruta en GeoJSON (ej. RUT-01) ---'

SELECT r.clave,
       r.nombre,
       ST_AsGeoJSON(r.geom, 6) AS geojson
  FROM rutas_urvan r
 WHERE r.clave = 'RUT-01';


\echo ''
\echo '>> Fin de las consultas.'
