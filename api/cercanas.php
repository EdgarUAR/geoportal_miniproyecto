<?php
/**
 * GET api/cercanas.php?lon=-99.5050&lat=17.5500&radio=300
 *
 * Pregunta 1 del geoportal: ¿qué rutas pasan a menos de X metros del punto?
 * Devuelve además las paradas cercanas (caminata), la colonia donde cae el
 * punto y las rutas que cruzan esa colonia.
 */

declare(strict_types=1);

require __DIR__ . '/../src/app.php';

run_api(function (): array {
    $lon = param_float('lon', NAN);
    $lat = param_float('lat', NAN);

    if (!is_finite($lon) || !is_finite($lat) || $lon < -180 || $lon > 180 || $lat < -90 || $lat > 90) {
        throw new GeoInputException(
            'Indica un punto válido con los parámetros lon y lat (por ejemplo: api/cercanas.php?lon=-99.5050&lat=17.5500).'
        );
    }

    $radio = (int) round(limitar(param_float('radio', (float) geo_config()['mapa']['radio_m']), 50, 2000));

    $params = ['lon' => $lon, 'lat' => $lat];

    /* --------------------------- Rutas cercanas --------------------------- */
    $rutas = q_all(
        "WITH q AS (SELECT ST_SetSRID(ST_MakePoint(:lon, :lat), 4326) AS pt)
         SELECT r.clave, r.nombre, r.origen, r.destino,
                r.color_hex,
                r.tarifa_mxn::float8 AS tarifa,
                r.frecuencia_min::int AS frecuencia,
                to_char(r.horario_inicio, 'HH24:MI') AS horario_inicio,
                to_char(r.horario_fin, 'HH24:MI') AS horario_fin,
                ROUND((ST_Length(r.geom::geography) / 1000)::numeric, 2)::float8 AS km,
                ROUND(ST_Distance(r.geom::geography, q.pt::geography)::numeric, 0)::int AS distancia_m,
                pc.nombre AS parada_cercana,
                pc.metros AS parada_cercana_m
           FROM rutas_urvan r
           CROSS JOIN q
           LEFT JOIN LATERAL (
                SELECT p.nombre,
                       ROUND(ST_Distance(p.geom::geography, q.pt::geography)::numeric, 0)::int AS metros
                  FROM paradas_ascenso p
                  JOIN rutas_paradas rp ON rp.parada_id = p.id
                 WHERE rp.ruta_id = r.id AND p.estatus = 'activa'
                 ORDER BY p.geom <-> q.pt
                 LIMIT 1
           ) pc ON TRUE
          WHERE r.activa
            AND ST_DWithin(r.geom::geography, q.pt::geography, :radio)
          ORDER BY distancia_m, r.clave",
        $params + ['radio' => $radio]
    );

    /* ------------------------- Paradas más cercanas ----------------------- */
    $paradasCercanas = q_all(
        "WITH q AS (SELECT ST_SetSRID(ST_MakePoint(:lon, :lat), 4326) AS pt)
         SELECT p.clave, p.nombre, p.tipo, p.estatus, p.techada, p.referencia,
                ROUND(ST_Distance(p.geom::geography, q.pt::geography)::numeric, 0)::int AS distancia_m,
                ROUND(ST_X(p.geom)::numeric, 6)::float8 AS lon,
                ROUND(ST_Y(p.geom)::numeric, 6)::float8 AS lat,
                COALESCE((
                    SELECT jsonb_agg(jsonb_build_object(
                               'clave', r.clave, 'nombre', r.nombre, 'color', r.color_hex
                           ) ORDER BY r.clave)
                      FROM rutas_paradas rp
                      JOIN rutas_urvan r ON r.id = rp.ruta_id AND r.activa
                     WHERE rp.parada_id = p.id
                ), '[]'::jsonb) AS rutas
           FROM paradas_ascenso p
           CROSS JOIN q
          WHERE p.estatus <> 'inactiva'
          ORDER BY p.geom <-> q.pt
          LIMIT 5",
        $params
    );

    /* ------------------------ Paradas dentro del radio -------------------- */
    $paradasRadio = q_all(
        "WITH q AS (SELECT ST_SetSRID(ST_MakePoint(:lon, :lat), 4326) AS pt)
         SELECT p.clave, p.nombre, p.tipo, p.estatus,
                ROUND(ST_Distance(p.geom::geography, q.pt::geography)::numeric, 0)::int AS distancia_m
           FROM paradas_ascenso p
           CROSS JOIN q
          WHERE p.estatus = 'activa'
            AND ST_DWithin(p.geom::geography, q.pt::geography, :radio)
          ORDER BY distancia_m, p.clave
          LIMIT 100",
        $params + ['radio' => $radio]
    );

    /* ----------------------------- Colonia -------------------------------- */
    $colonia = q_one(
        "WITH q AS (SELECT ST_SetSRID(ST_MakePoint(:lon, :lat), 4326) AS pt)
         SELECT c.id, c.clave, c.nombre, c.tipo,
                c.poblacion_estimada::int AS poblacion,
                ROUND((ST_Area(c.geom::geography) / 10000)::numeric, 1)::float8 AS hectareas,
                ST_AsGeoJSON(c.geom, 6) AS geojson,
                (SELECT COUNT(DISTINCT r.id)::int
                   FROM rutas_urvan r
                  WHERE r.activa AND ST_Intersects(c.geom, r.geom)) AS num_rutas
           FROM colonias c
           CROSS JOIN q
          WHERE ST_Intersects(c.geom, q.pt)
          LIMIT 1",
        $params
    );

    $dentroColonia = $colonia !== null;

    if ($colonia === null) {
        $colonia = q_one(
            "WITH q AS (SELECT ST_SetSRID(ST_MakePoint(:lon, :lat), 4326) AS pt)
             SELECT c.id, c.clave, c.nombre, c.tipo,
                    c.poblacion_estimada::int AS poblacion,
                    ROUND((ST_Area(c.geom::geography) / 10000)::numeric, 1)::float8 AS hectareas,
                    ST_AsGeoJSON(c.geom, 6) AS geojson,
                    ROUND(ST_Distance(c.geom::geography, q.pt::geography)::numeric, 0)::int AS distancia_m,
                    (SELECT COUNT(DISTINCT r.id)::int
                       FROM rutas_urvan r
                      WHERE r.activa AND ST_Intersects(c.geom, r.geom)) AS num_rutas
               FROM colonias c
               CROSS JOIN q
              ORDER BY c.geom <-> q.pt
              LIMIT 1",
            $params
        );
    }

    /* ------------------- Rutas que cruzan esa colonia --------------------- */
    $rutasColonia = [];
    if ($colonia !== null) {
        $rutasColonia = q_all(
            "WITH q AS (SELECT ST_SetSRID(ST_MakePoint(:lon, :lat), 4326) AS pt)
             SELECT r.clave, r.nombre, r.color_hex,
                    CASE
                        WHEN GeometryType(ST_Intersection(c.geom, r.geom)) IN ('LINESTRING', 'MULTILINESTRING')
                        THEN ROUND((ST_Length(ST_Intersection(c.geom, r.geom)::geography) / 1000)::numeric, 2)::float8
                        ELSE 0
                    END AS km_dentro,
                    ROUND(ST_Distance(r.geom::geography, q.pt::geography)::numeric, 0)::int AS distancia_m
               FROM colonias c
               JOIN rutas_urvan r ON r.activa AND ST_Intersects(c.geom, r.geom)
               CROSS JOIN q
              WHERE c.id = :id
              ORDER BY r.clave",
            ['id' => (int) $colonia['id'], 'lon' => $lon, 'lat' => $lat]
        );
    }

    $numRutas = count($rutas);
    $numParadasRadio = count($paradasRadio);

    return [
        'punto' => ['lon' => $lon, 'lat' => $lat],
        'radio_m' => $radio,
        'rutas' => array_map(static function (array $r): array {
            return [
                'clave' => $r['clave'],
                'nombre' => $r['nombre'],
                'origen' => $r['origen'],
                'destino' => $r['destino'],
                'color' => color_hex($r['color_hex']),
                'tarifa' => (float) $r['tarifa'],
                'frecuencia' => (int) $r['frecuencia'],
                'horario_inicio' => $r['horario_inicio'],
                'horario_fin' => $r['horario_fin'],
                'km' => (float) $r['km'],
                'distancia_m' => (int) $r['distancia_m'],
                'parada_cercana' => $r['parada_cercana'],
                'parada_cercana_m' => $r['parada_cercana_m'] !== null ? (int) $r['parada_cercana_m'] : null,
            ];
        }, $rutas),
        'paradas_cercanas' => array_map(static function (array $p): array {
            return [
                'clave' => $p['clave'],
                'nombre' => $p['nombre'],
                'tipo' => $p['tipo'],
                'estatus' => $p['estatus'],
                'techada' => ($p['techada'] === true || $p['techada'] === 't'),
                'referencia' => $p['referencia'],
                'distancia_m' => (int) $p['distancia_m'],
                'lon' => (float) $p['lon'],
                'lat' => (float) $p['lat'],
                'rutas' => json_decodificar($p['rutas']),
            ];
        }, $paradasCercanas),
        'paradas_radio' => array_map(static function (array $p): array {
            return [
                'clave' => $p['clave'],
                'nombre' => $p['nombre'],
                'tipo' => $p['tipo'],
                'estatus' => $p['estatus'],
                'distancia_m' => (int) $p['distancia_m'],
            ];
        }, $paradasRadio),
        'colonia' => $colonia === null ? null : [
            'id' => (int) $colonia['id'],
            'clave' => $colonia['clave'],
            'nombre' => $colonia['nombre'],
            'tipo' => $colonia['tipo'],
            'poblacion' => (int) $colonia['poblacion'],
            'hectareas' => (float) $colonia['hectareas'],
            'num_rutas' => (int) $colonia['num_rutas'],
            'dentro' => $dentroColonia,
            'distancia_m' => isset($colonia['distancia_m']) ? (int) $colonia['distancia_m'] : 0,
            'geojson' => json_decode((string) $colonia['geojson'], true),
        ],
        'rutas_colonia' => array_map(static function (array $r): array {
            return [
                'clave' => $r['clave'],
                'nombre' => $r['nombre'],
                'color' => color_hex($r['color_hex']),
                'km_dentro' => (float) $r['km_dentro'],
                'distancia_m' => (int) $r['distancia_m'],
            ];
        }, $rutasColonia),
        'resumen' => [
            'rutas' => $numRutas,
            'paradas' => $numParadasRadio,
            'cobertura' => $numRutas > 0,
        ],
        'generado' => date('c'),
    ];
});
