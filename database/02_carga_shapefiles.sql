-- ===========================================================================
-- CARGA DE CAPAS DESDE SHAPEFILES · GeoUrvan (Chilpancingo de los Bravo)
--
-- Este script NO sustituye a database/geo_chilp.sql: lo complementa.
--   · Crea el esquema de staging "carga" (columnas de atributos en text).
--   · Normaliza, valida y reproyecta geometrías a EPSG:4326.
--   · Inserta o actualiza colonias, rutas_urvan y paradas_ascenso por "clave".
--   · Reconstruye rutas_paradas con la regla de <= 40 m.
--
-- USO (psql):
--   1) psql -U postgres -d geo_chilp -f database/02_carga_shapefiles.sql
--   2) Importar los SHP al staging con ogr2ogr (ver docs/carga-shapefiles.md)
--   3) Volver a ejecutar este mismo script para mapear los datos
--
-- Es idempotente: puedes ejecutarlo tantas veces como quieras.
-- Si lo abres en pgAdmin, elimina las líneas que empiezan con "\" (meta-comandos
-- de psql) y ejecuta el resto por bloques.
-- ===========================================================================

\set ON_ERROR_STOP on

\echo '>> GeoUrvan · preparando esquema de carga'

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Esquema y tablas de staging
--    Los atributos son TEXT para aceptar "5,200", "SÍ", "$12.50", etc.
--    La geometría queda sin tipar para admitir Polygon/MultiPolygon/LineString.
-- ---------------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS carga;

COMMENT ON SCHEMA carga IS
  'Staging temporal para cargar capas externas (SHP/GPKG/GeoJSON) antes de validarlas.';

CREATE TABLE IF NOT EXISTS carga.colonias_shp (
    gid       serial PRIMARY KEY,
    clave     text,
    nombre    text,
    tipo      text,
    poblacion text,
    geom      geometry
);

CREATE TABLE IF NOT EXISTS carga.rutas_shp (
    gid         serial PRIMARY KEY,
    clave       text,
    nombre      text,
    origen      text,
    destino     text,
    tarifa      text,
    frecuencia  text,
    hora_inicio text,
    hora_fin    text,
    color       text,
    activa      text,
    geom        geometry
);

CREATE TABLE IF NOT EXISTS carga.paradas_shp (
    gid        serial PRIMARY KEY,
    clave      text,
    nombre     text,
    tipo       text,
    referencia text,
    techada    text,
    estatus    text,
    fecha_alta text,
    geom       geometry
);

-- ---------------------------------------------------------------------------
-- 2) Funciones de saneamiento geométrico
-- ---------------------------------------------------------------------------

-- Devuelve la geometría en EPSG:4326. Si viene sin SRID, asume 4326;
-- si viene en otra proyección, la transforma.
CREATE OR REPLACE FUNCTION geo_a_4326(g geometry)
RETURNS geometry
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
DECLARE
    srid integer := ST_SRID(g);
BEGIN
    IF srid = 0 OR srid IS NULL THEN
        RETURN ST_SetSRID(g, 4326);
    END IF;
    IF srid = 4326 THEN
        RETURN g;
    END IF;
    RETURN ST_Transform(g, 4326);
END;
$$;

COMMENT ON FUNCTION geo_a_4326(geometry) IS
  'Normaliza una geometría a EPSG:4326 (asume 4326 cuando no trae SRID).';

-- Convierte texto a TIME sin abortar la carga si el formato es inválido.
CREATE OR REPLACE FUNCTION geo_hora(txt text, respaldo time DEFAULT TIME '06:00')
RETURNS time
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
    IF btrim(COALESCE(txt, '')) = '' THEN
        RETURN respaldo;
    END IF;
    RETURN btrim(txt)::time;
EXCEPTION
    WHEN others THEN
        RETURN respaldo;
END;
$$;

COMMENT ON FUNCTION geo_hora(text, time) IS
  'Convierte texto a TIME; devuelve el respaldo si el valor no es una hora válida.';

-- Convierte texto a DATE sin abortar la carga si el formato es inválido.
CREATE OR REPLACE FUNCTION geo_fecha(txt text)
RETURNS date
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
    IF btrim(COALESCE(txt, '')) = '' THEN
        RETURN NULL;
    END IF;
    RETURN btrim(txt)::date;
EXCEPTION
    WHEN others THEN
        RETURN NULL;
END;
$$;

COMMENT ON FUNCTION geo_fecha(text) IS
  'Convierte texto a DATE; devuelve NULL si el valor no es una fecha válida.';

-- Polígono válido de mayor área. Devuelve NULL si no hay ninguna parte poligonal.
CREATE OR REPLACE FUNCTION geo_poligono_valido(g geometry)
RETURNS geometry
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
    SELECT d.geom
      FROM ST_Dump(ST_MakeValid(ST_Force2D(geo_a_4326(g)))) AS d
     WHERE ST_GeometryType(d.geom) = 'ST_Polygon'
     ORDER BY ST_Area(d.geom) DESC
     LIMIT 1;
$$;

COMMENT ON FUNCTION geo_poligono_valido(geometry) IS
  'Devuelve el polígono válido de mayor área (Polygon, 4326) o NULL.';

-- Línea válida de mayor longitud, fusionando segmentos cuando sea posible.
CREATE OR REPLACE FUNCTION geo_linea_valida(g geometry)
RETURNS geometry
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
    WITH partes AS (
        SELECT d.geom
          FROM ST_Dump(ST_MakeValid(ST_Force2D(geo_a_4326(g)))) AS d
         WHERE ST_GeometryType(d.geom) IN ('ST_LineString', 'ST_MultiLineString')
    ),
    fusion AS (
        SELECT ST_LineMerge(ST_Collect(geom)) AS geom
          FROM partes
    )
    SELECT d.geom
      FROM fusion, LATERAL ST_Dump(fusion.geom) AS d
     ORDER BY ST_Length(d.geom) DESC
     LIMIT 1;
$$;

COMMENT ON FUNCTION geo_linea_valida(geometry) IS
  'Devuelve la línea válida de mayor longitud (LineString, 4326) o NULL.';

-- Punto válido: usa el punto si ya lo es, el centroide en superficie si es
-- polígono, o el punto medio si es línea. Devuelve NULL si no hay nada usable.
CREATE OR REPLACE FUNCTION geo_punto_valido(g geometry)
RETURNS geometry
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
    WITH v AS (
        SELECT ST_MakeValid(ST_Force2D(geo_a_4326(g))) AS geom
    ),
    pt AS (
        SELECT d.geom
          FROM v, LATERAL ST_Dump(v.geom) AS d
         WHERE ST_GeometryType(d.geom) = 'ST_Point'
         LIMIT 1
    ),
    pg AS (
        SELECT d.geom
          FROM v, LATERAL ST_Dump(v.geom) AS d
         WHERE ST_GeometryType(d.geom) = 'ST_Polygon'
         ORDER BY ST_Area(d.geom) DESC
         LIMIT 1
    ),
    ln AS (
        SELECT d.geom
          FROM v, LATERAL ST_Dump(v.geom) AS d
         WHERE ST_GeometryType(d.geom) = 'ST_LineString'
         ORDER BY ST_Length(d.geom) DESC
         LIMIT 1
    )
    SELECT COALESCE(
        (SELECT geom FROM pt),
        ST_PointOnSurface((SELECT geom FROM pg)),
        ST_LineInterpolatePoint((SELECT geom FROM ln), 0.5)
    );
$$;

COMMENT ON FUNCTION geo_punto_valido(geometry) IS
  'Devuelve un punto válido (Point, 4326) a partir de puntos, polígonos o líneas.';

-- ---------------------------------------------------------------------------
-- 3) COLONIAS · staging -> colonias
--    Regla: se conserva el último registro importado por clave.
-- ---------------------------------------------------------------------------

\echo '>> Mapeando colonias...'

WITH base AS (
    SELECT gid,
           COALESCE(
               NULLIF(btrim(clave), ''),
               'COL-' || left(md5(lower(COALESCE(NULLIF(btrim(nombre), ''), 'sin nombre'))), 8)
           ) AS clave,
           COALESCE(NULLIF(btrim(nombre), ''), 'Colonia sin nombre') AS nombre,
           lower(btrim(COALESCE(tipo, ''))) AS tipo,
           LEAST(
               COALESCE(
                   NULLIF(regexp_replace(COALESCE(poblacion, ''), '[^0-9]', '', 'g'), '')::bigint,
                   0
               ),
               2147483647
           )::integer AS poblacion,
           geom
      FROM carga.colonias_shp
),
unicas AS (
    SELECT DISTINCT ON (clave) *
      FROM base
     ORDER BY clave, gid DESC
),
limpias AS (
    SELECT u.*,
           geo_poligono_valido(u.geom) AS geom_ok
      FROM unicas u
)
INSERT INTO colonias (clave, nombre, tipo, poblacion_estimada, geom)
SELECT clave,
       left(nombre, 120),
       CASE
           WHEN tipo IN ('barrio', 'barrios') THEN 'barrio'
           WHEN tipo IN ('zona', 'zonas', 'zona urbana', 'zona_urbana') THEN 'zona'
           ELSE 'colonia'
       END,
       poblacion,
       geom_ok::geometry(Polygon, 4326)
  FROM limpias
 WHERE geom_ok IS NOT NULL
   AND NOT ST_IsEmpty(geom_ok)
ON CONFLICT (clave) DO UPDATE
   SET nombre             = EXCLUDED.nombre,
       tipo               = EXCLUDED.tipo,
       poblacion_estimada = EXCLUDED.poblacion_estimada,
       geom               = EXCLUDED.geom;

-- ---------------------------------------------------------------------------
-- 4) RUTAS · staging -> rutas_urvan
--    Colores inválidos se sustituyen por la paleta institucional.
-- ---------------------------------------------------------------------------

\echo '>> Mapeando rutas de urvan...'

WITH base AS (
    SELECT gid,
           COALESCE(
               NULLIF(btrim(clave), ''),
               'RUT-' || left(md5(lower(COALESCE(NULLIF(btrim(nombre), ''), 'sin nombre'))), 6)
           ) AS clave,
           COALESCE(NULLIF(btrim(nombre), ''), 'Ruta sin nombre') AS nombre,
           COALESCE(NULLIF(btrim(origen), ''), 'Sin dato')      AS origen,
           COALESCE(NULLIF(btrim(destino), ''), 'Sin dato')     AS destino,
           LEAST(
               CASE
                   WHEN regexp_replace(replace(COALESCE(tarifa, ''), ',', '.'), '[^0-9.]', '', 'g')
                        ~ '^\d*\.?\d+$'
                   THEN regexp_replace(replace(tarifa, ',', '.'), '[^0-9.]', '', 'g')::numeric
                   ELSE 0
               END,
               999.99
           ) AS tarifa,
           LEAST(
               GREATEST(
                   COALESCE(
                       NULLIF(regexp_replace(COALESCE(frecuencia, ''), '[^0-9]', '', 'g'), '')::bigint,
                       15
                   ),
                   1
               ),
               180
           )::integer AS frecuencia,
           geo_hora(hora_inicio, TIME '06:00') AS hora_inicio,
           geo_hora(hora_fin, TIME '21:00')    AS hora_fin,
           btrim(COALESCE(color, '')) AS color,
           CASE
               WHEN lower(btrim(COALESCE(activa, ''))) IN ('no', 'n', 'false', 'f', '0', 'inactiva')
               THEN FALSE
               ELSE TRUE
           END AS activa,
           geom
      FROM carga.rutas_shp
),
unicas AS (
    SELECT DISTINCT ON (clave) *
      FROM base
     ORDER BY clave, gid DESC
),
limpias AS (
    SELECT u.*,
           geo_linea_valida(u.geom) AS geom_ok
      FROM unicas u
)
INSERT INTO rutas_urvan
    (clave, nombre, origen, destino, tarifa_mxn, frecuencia_min,
     horario_inicio, horario_fin, color_hex, activa, geom)
SELECT clave,
       left(nombre, 120),
       left(origen, 120),
       left(destino, 120),
       tarifa::numeric(5, 2),
       frecuencia,
       hora_inicio,
       hora_fin,
       CASE
           WHEN color ~* '^#[0-9a-f]{6}$' THEN lower(color)
           ELSE (ARRAY['#e63946', '#2a9d8f', '#f4a261', '#6a4c93',
                       '#1d3557', '#0e7c66', '#7c1230', '#e8a33d'])
                [1 + ((row_number() OVER (ORDER BY clave) - 1) % 8)]
       END,
       activa,
       geom_ok::geometry(LineString, 4326)
  FROM limpias
 WHERE geom_ok IS NOT NULL
   AND NOT ST_IsEmpty(geom_ok)
ON CONFLICT (clave) DO UPDATE
   SET nombre         = EXCLUDED.nombre,
       origen         = EXCLUDED.origen,
       destino        = EXCLUDED.destino,
       tarifa_mxn     = EXCLUDED.tarifa_mxn,
       frecuencia_min = EXCLUDED.frecuencia_min,
       horario_inicio = EXCLUDED.horario_inicio,
       horario_fin    = EXCLUDED.horario_fin,
       color_hex      = EXCLUDED.color_hex,
       activa         = EXCLUDED.activa,
       geom           = EXCLUDED.geom;

-- ---------------------------------------------------------------------------
-- 5) PARADAS · staging -> paradas_ascenso
-- ---------------------------------------------------------------------------

\echo '>> Mapeando paradas y puntos de ascenso...'

WITH base AS (
    SELECT gid,
           COALESCE(
               NULLIF(btrim(clave), ''),
               'PAR-' || left(md5(lower(COALESCE(NULLIF(btrim(nombre), ''), 'sin nombre'))), 6)
           ) AS clave,
           COALESCE(NULLIF(btrim(nombre), ''), 'Parada sin nombre') AS nombre,
           lower(btrim(COALESCE(tipo, ''))) AS tipo,
           NULLIF(left(btrim(referencia), 180), '') AS referencia,
           CASE
               WHEN lower(translate(btrim(COALESCE(techada, '')),
                                   'ÁÉÍÓÚÜáéíóúü', 'AEIOUUaeiouu'))
                    IN ('si', 's', '1', 't', 'true', 'x', 'yes')
               THEN TRUE
               ELSE FALSE
           END AS techada,
           CASE
               WHEN lower(btrim(COALESCE(estatus, ''))) LIKE 'inactiv%' THEN 'inactiva'
               WHEN lower(btrim(COALESCE(estatus, ''))) LIKE 'propuest%' THEN 'propuesta'
               ELSE 'activa'
           END AS estatus,
           geo_fecha(fecha_alta) AS fecha_alta,
           geom
      FROM carga.paradas_shp
),
unicas AS (
    SELECT DISTINCT ON (clave) *
      FROM base
     ORDER BY clave, gid DESC
),
limpias AS (
    SELECT u.*,
           geo_punto_valido(u.geom) AS geom_ok
      FROM unicas u
)
INSERT INTO paradas_ascenso
    (clave, nombre, tipo, referencia, techada, estatus, fecha_alta, geom)
SELECT clave,
       left(nombre, 120),
       CASE
           WHEN tipo LIKE 'terminal%' THEN 'terminal'
           WHEN tipo LIKE 'base%' OR tipo LIKE 'sitio%' THEN 'base'
           WHEN tipo LIKE 'parada%' OR tipo LIKE 'ascenso%' OR tipo LIKE 'parador%' THEN 'parada_autorizada'
           ELSE 'parada_autorizada'
       END,
       referencia,
       techada,
       estatus,
       fecha_alta,
       geom_ok::geometry(Point, 4326)
  FROM limpias
 WHERE geom_ok IS NOT NULL
   AND NOT ST_IsEmpty(geom_ok)
ON CONFLICT (clave) DO UPDATE
   SET nombre     = EXCLUDED.nombre,
       tipo       = EXCLUDED.tipo,
       referencia = EXCLUDED.referencia,
       techada    = EXCLUDED.techada,
       estatus    = EXCLUDED.estatus,
       fecha_alta = EXCLUDED.fecha_alta,
       geom       = EXCLUDED.geom;

-- ---------------------------------------------------------------------------
-- 6) Reconstrucción de rutas_paradas
--    Una parada pertenece a una ruta si está a <= 40 m de su trazo.
--    El orden sale de la posición de la parada a lo largo de la línea.
--    Si necesitas otra tolerancia, cambia el 40 (25-80 m es lo habitual).
-- ---------------------------------------------------------------------------

\echo '>> Reconstruyendo la relación rutas_paradas (<= 40 m)...'

DELETE FROM rutas_paradas;

INSERT INTO rutas_paradas (ruta_id, parada_id, orden)
SELECT r.id,
       p.id,
       ROW_NUMBER() OVER (
           PARTITION BY r.id
           ORDER BY ST_LineLocatePoint(r.geom, p.geom), p.clave
       )::integer
  FROM rutas_urvan r
  JOIN paradas_ascenso p
    ON ST_DWithin(r.geom::geography, p.geom::geography, 40);

COMMIT;

-- ---------------------------------------------------------------------------
-- 7) Reporte de la carga
-- ---------------------------------------------------------------------------

\echo ''
\echo '>> Resumen de capas'
SELECT 'colonias' AS capa, COUNT(*)::text AS registros FROM colonias
UNION ALL SELECT 'rutas_urvan', COUNT(*)::text FROM rutas_urvan
UNION ALL SELECT 'paradas_ascenso', COUNT(*)::text FROM paradas_ascenso
UNION ALL SELECT 'rutas_paradas', COUNT(*)::text FROM rutas_paradas;

\echo ''
\echo '>> Paradas activas que no están a <= 40 m de ninguna ruta'
SELECT p.clave, p.nombre, p.estatus
  FROM paradas_ascenso p
 WHERE p.estatus = 'activa'
   AND NOT EXISTS (SELECT 1 FROM rutas_paradas rp WHERE rp.parada_id = p.id)
 ORDER BY p.clave
 LIMIT 25;

\echo ''
\echo '>> Rutas activas sin paradas relacionadas'
SELECT r.clave, r.nombre
  FROM rutas_urvan r
 WHERE r.activa
   AND NOT EXISTS (SELECT 1 FROM rutas_paradas rp WHERE rp.ruta_id = r.id)
 ORDER BY r.clave;

\echo ''
\echo '>> Geometrías inválidas o vacías en las tablas finales'
SELECT 'colonias' AS capa, COUNT(*) AS invalidas
  FROM colonias
 WHERE NOT ST_IsValid(geom) OR ST_IsEmpty(geom)
UNION ALL
SELECT 'rutas_urvan', COUNT(*)
  FROM rutas_urvan
 WHERE NOT ST_IsValid(geom) OR ST_IsEmpty(geom)
UNION ALL
SELECT 'paradas_ascenso', COUNT(*)
  FROM paradas_ascenso
 WHERE NOT ST_IsValid(geom) OR ST_IsEmpty(geom);

\echo ''
\echo '>> Filas del staging sin geometría utilizable (se descartaron)'
SELECT 'colonias' AS capa,
       COUNT(*) FILTER (WHERE geo_poligono_valido(geom) IS NULL) AS descartadas,
       COUNT(*) AS filas_staging
  FROM carga.colonias_shp
UNION ALL
SELECT 'rutas_urvan',
       COUNT(*) FILTER (WHERE geo_linea_valida(geom) IS NULL),
       COUNT(*)
  FROM carga.rutas_shp
UNION ALL
SELECT 'paradas_ascenso',
       COUNT(*) FILTER (WHERE geo_punto_valido(geom) IS NULL),
       COUNT(*)
  FROM carga.paradas_shp;

-- Actualiza estadísticas para que el planificador aproveche los índices GiST.
ANALYZE colonias;
ANALYZE rutas_urvan;
ANALYZE paradas_ascenso;
ANALYZE rutas_paradas;

\echo ''
\echo '>> Listo. Abre /api/salud.php en el geoportal para confirmar los conteos.'

-- ---------------------------------------------------------------------------
-- 8) Limpieza opcional del staging (descomenta cuando ya validaste la carga)
-- ---------------------------------------------------------------------------
-- TRUNCATE carga.colonias_shp, carga.rutas_shp, carga.paradas_shp RESTART IDENTITY;
-- DROP SCHEMA carga CASCADE;
