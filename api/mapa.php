<?php
/**
 * GET api/mapa.php
 * Devuelve las tres capas del geoportal como FeatureCollections GeoJSON,
 * ya enriquecidas con los indicadores que usan el mapa y los tableros.
 */

declare(strict_types=1);

require __DIR__ . '/../src/app.php';

run_api(function (): array {
    $cfg = geo_config();

    /* ----------------------------- Colonias ------------------------------ */
    $colonias = q_all(
        "WITH cob AS (
             SELECT c.id,
                    COUNT(DISTINCT r.id)::int AS num_rutas,
                    COALESCE(
                        jsonb_agg(DISTINCT jsonb_build_object(
                            'clave', r.clave,
                            'nombre', r.nombre,
                            'color', r.color_hex
                        )) FILTER (WHERE r.id IS NOT NULL),
                        '[]'::jsonb
                    ) AS rutas
               FROM colonias c
               LEFT JOIN rutas_urvan r
                      ON r.activa AND ST_Intersects(c.geom, r.geom)
              GROUP BY c.id
         ),
         par AS (
             SELECT c.id,
                    COUNT(p.id)::int AS paradas,
                    COUNT(p.id) FILTER (WHERE p.estatus = 'activa')::int AS paradas_activas
               FROM colonias c
               LEFT JOIN paradas_ascenso p ON ST_Intersects(c.geom, p.geom)
              GROUP BY c.id
         ),
         dist AS (
             SELECT c.id,
                    (SELECT MIN(ST_Distance(c.geom::geography, r.geom::geography))
                       FROM rutas_urvan r WHERE r.activa)::float8 AS dist_ruta_m,
                    (SELECT MIN(ST_Distance(c.geom::geography, p.geom::geography))
                       FROM paradas_ascenso p WHERE p.estatus = 'activa')::float8 AS dist_parada_m
               FROM colonias c
         )
         SELECT c.id, c.clave, c.nombre, c.tipo,
                c.poblacion_estimada::int AS poblacion,
                ROUND((ST_Area(c.geom::geography) / 10000)::numeric, 2)::float8 AS hectareas,
                ST_AsGeoJSON(c.geom, 6) AS geojson,
                cob.num_rutas, cob.rutas,
                par.paradas, par.paradas_activas,
                ROUND(dist.dist_ruta_m::numeric, 0)::int AS dist_ruta_m,
                ROUND(dist.dist_parada_m::numeric, 0)::int AS dist_parada_m
           FROM colonias c
           JOIN cob ON cob.id = c.id
           JOIN par ON par.id = c.id
           JOIN dist ON dist.id = c.id
          ORDER BY c.clave"
    );

    /* ------------------------------- Rutas ------------------------------- */
    $rutas = q_all(
        "SELECT r.id, r.clave, r.nombre, r.origen, r.destino,
                r.tarifa_mxn::float8 AS tarifa,
                r.frecuencia_min::int AS frecuencia,
                to_char(r.horario_inicio, 'HH24:MI') AS horario_inicio,
                to_char(r.horario_fin, 'HH24:MI') AS horario_fin,
                r.color_hex, r.activa,
                ROUND((ST_Length(r.geom::geography) / 1000)::numeric, 2)::float8 AS km,
                ST_AsGeoJSON(r.geom, 6) AS geojson,
                (SELECT COUNT(*)::int FROM rutas_paradas rp WHERE rp.ruta_id = r.id) AS paradas
           FROM rutas_urvan r
          ORDER BY r.clave"
    );

    /* ------------------------------ Paradas ------------------------------ */
    $paradas = q_all(
        "SELECT p.id, p.clave, p.nombre, p.tipo, p.referencia, p.techada, p.estatus,
                to_char(p.fecha_alta, 'YYYY-MM-DD') AS fecha_alta,
                ST_AsGeoJSON(p.geom, 6) AS geojson,
                COALESCE((
                    SELECT jsonb_agg(jsonb_build_object(
                               'clave', r.clave,
                               'nombre', r.nombre,
                               'color', r.color_hex,
                               'orden', rp.orden
                           ) ORDER BY rp.orden)
                      FROM rutas_paradas rp
                      JOIN rutas_urvan r ON r.id = rp.ruta_id
                     WHERE rp.parada_id = p.id AND r.activa
                ), '[]'::jsonb) AS rutas
           FROM paradas_ascenso p
          ORDER BY p.clave"
    );

    $num = static fn (mixed $v): ?float => $v === null ? null : (float) $v;
    $ent = static fn (mixed $v): ?int => $v === null ? null : (int) $v;

    $fcColonias = geojson_coleccion(array_map(static function (array $c) use ($num, $ent): ?array {
        $numRutas = (int) $c['num_rutas'];
        return geojson_feature($c['geojson'], [
            'id' => $ent($c['id']),
            'clave' => $c['clave'],
            'nombre' => $c['nombre'],
            'tipo' => $c['tipo'],
            'poblacion' => $ent($c['poblacion']),
            'hectareas' => $num($c['hectareas']),
            'num_rutas' => $numRutas,
            'rutas' => json_decodificar($c['rutas']),
            'paradas' => $ent($c['paradas']),
            'paradas_activas' => $ent($c['paradas_activas']),
            'dist_ruta_m' => $ent($c['dist_ruta_m']),
            'dist_parada_m' => $ent($c['dist_parada_m']),
            'cobertura' => $numRutas > 0,
            'nivel' => $numRutas === 0 ? 0 : ($numRutas <= 2 ? 1 : ($numRutas <= 4 ? 2 : 3)),
        ]);
    }, $colonias));

    $fcRutas = geojson_coleccion(array_map(static function (array $r) use ($num, $ent): ?array {
        return geojson_feature($r['geojson'], [
            'id' => $ent($r['id']),
            'clave' => $r['clave'],
            'nombre' => $r['nombre'],
            'origen' => $r['origen'],
            'destino' => $r['destino'],
            'tarifa' => $num($r['tarifa']),
            'frecuencia' => $ent($r['frecuencia']),
            'horario_inicio' => $r['horario_inicio'],
            'horario_fin' => $r['horario_fin'],
            'color' => color_hex($r['color_hex']),
            'activa' => ($r['activa'] === true || $r['activa'] === 't' || $r['activa'] === 1 || $r['activa'] === '1'),
            'km' => $num($r['km']),
            'paradas' => $ent($r['paradas']),
        ]);
    }, $rutas));

    $fcParadas = geojson_coleccion(array_map(static function (array $p) use ($ent): ?array {
        return geojson_feature($p['geojson'], [
            'id' => $ent($p['id']),
            'clave' => $p['clave'],
            'nombre' => $p['nombre'],
            'tipo' => $p['tipo'],
            'referencia' => $p['referencia'],
            'techada' => ($p['techada'] === true || $p['techada'] === 't' || $p['techada'] === 1 || $p['techada'] === '1'),
            'estatus' => $p['estatus'],
            'fecha_alta' => $p['fecha_alta'],
            'rutas' => json_decodificar($p['rutas']),
        ]);
    }, $paradas));

    return [
        'colonias' => $fcColonias,
        'rutas' => $fcRutas,
        'paradas' => $fcParadas,
        'meta' => [
            'municipio' => $cfg['app']['municipio'],
            'centro' => $cfg['mapa']['centro'],
            'zoom' => $cfg['mapa']['zoom'],
            'radio_m' => $cfg['mapa']['radio_m'],
            'radios' => $cfg['mapa']['radios'],
            'conteos' => [
                'colonias' => count($fcColonias['features']),
                'rutas' => count($fcRutas['features']),
                'paradas' => count($fcParadas['features']),
            ],
            'generado' => date('c'),
        ],
    ];
});
