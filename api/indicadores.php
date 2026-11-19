<?php
/**
 * GET api/indicadores.php
 * Indicadores agregados para los tableros de control del área de movilidad.
 * Todos los cálculos se hacen en PostGIS/SQL y alimentan el mismo mapa.
 */

declare(strict_types=1);

require __DIR__ . '/../src/app.php';

run_api(function (): array {
    $cfg = geo_config();

    /* --------------------------- Red de rutas ----------------------------- */
    $rutas = q_one(
        "SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE activa)::int AS activas,
                COUNT(*) FILTER (WHERE NOT activa)::int AS inactivas,
                COALESCE(ROUND((SUM(ST_Length(geom::geography)) / 1000)::numeric, 2), 0)::float8 AS km_total,
                COALESCE(ROUND((AVG(ST_Length(geom::geography)) / 1000)::numeric, 2), 0)::float8 AS km_promedio,
                COALESCE(ROUND((MAX(ST_Length(geom::geography)) / 1000)::numeric, 2), 0)::float8 AS km_max,
                COALESCE(ROUND(AVG(tarifa_mxn)::numeric, 2), 0)::float8 AS tarifa_promedio,
                COALESCE(MIN(tarifa_mxn), 0)::float8 AS tarifa_min,
                COALESCE(MAX(tarifa_mxn), 0)::float8 AS tarifa_max,
                COALESCE(ROUND(AVG(frecuencia_min)::numeric, 0), 0)::int AS frecuencia_promedio,
                COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (horario_fin - horario_inicio)) / 3600)::numeric, 1), 0)::float8 AS horas_promedio,
                MIN(to_char(horario_inicio, 'HH24:MI')) AS primer_servicio,
                MAX(to_char(horario_fin, 'HH24:MI')) AS ultimo_servicio
           FROM rutas_urvan"
    );

    /* ------------------------------ Paradas ------------------------------- */
    $paradas = q_one(
        "SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE estatus = 'activa')::int AS activas,
                COUNT(*) FILTER (WHERE estatus = 'inactiva')::int AS inactivas,
                COUNT(*) FILTER (WHERE estatus = 'propuesta')::int AS propuestas,
                COUNT(*) FILTER (WHERE techada)::int AS techadas,
                COUNT(*) FILTER (WHERE tipo = 'terminal')::int AS terminales,
                COUNT(*) FILTER (WHERE tipo = 'base')::int AS bases,
                COUNT(*) FILTER (WHERE tipo = 'parada_autorizada')::int AS autorizadas,
                COUNT(*) FILTER (WHERE NOT EXISTS (
                    SELECT 1
                      FROM rutas_paradas rp
                      JOIN rutas_urvan r ON r.id = rp.ruta_id AND r.activa
                     WHERE rp.parada_id = paradas_ascenso.id
                ))::int AS sin_ruta
           FROM paradas_ascenso"
    );

    /* ----------------------- Cobertura de colonias ------------------------- */
    $colonias = q_one(
        "WITH c AS (
             SELECT c.id,
                    c.poblacion_estimada,
                    ST_Area(c.geom::geography) AS area_m2,
                    EXISTS (
                        SELECT 1 FROM rutas_urvan r
                         WHERE r.activa AND ST_Intersects(c.geom, r.geom)
                    ) AS cubierta
               FROM colonias c
         )
         SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE cubierta)::int AS con_cobertura,
                COUNT(*) FILTER (WHERE NOT cubierta)::int AS sin_cobertura,
                COALESCE(SUM(poblacion_estimada), 0)::int AS poblacion_total,
                COALESCE(SUM(poblacion_estimada) FILTER (WHERE cubierta), 0)::int AS poblacion_cubierta,
                COALESCE(SUM(poblacion_estimada) FILTER (WHERE NOT cubierta), 0)::int AS poblacion_sin_cobertura,
                COALESCE(ROUND((SUM(area_m2) / 1000000)::numeric, 2), 0)::float8 AS superficie_km2,
                COALESCE(ROUND((SUM(area_m2) FILTER (WHERE cubierta) / 1000000)::numeric, 2), 0)::float8 AS superficie_cubierta_km2
           FROM c"
    );

    /* -------------------------- Ranking de rutas -------------------------- */
    $ranking = q_all(
        "SELECT r.clave, r.nombre, r.color_hex,
                ROUND((ST_Length(r.geom::geography) / 1000)::numeric, 2)::float8 AS km,
                r.tarifa_mxn::float8 AS tarifa,
                r.frecuencia_min::int AS frecuencia,
                (SELECT COUNT(*)::int FROM rutas_paradas rp WHERE rp.ruta_id = r.id) AS paradas,
                (SELECT COUNT(*)::int FROM colonias c WHERE ST_Intersects(c.geom, r.geom)) AS colonias
           FROM rutas_urvan r
          WHERE r.activa
          ORDER BY km DESC, r.clave"
    );

    /* ----------------- Colonias sin cobertura (inversión) ----------------- */
    $sinCobertura = q_all(
        "WITH c AS (
             SELECT c.id, c.clave, c.nombre, c.tipo, c.poblacion_estimada, c.geom,
                    ST_Area(c.geom::geography) AS area_m2,
                    EXISTS (
                        SELECT 1 FROM rutas_urvan r
                         WHERE r.activa AND ST_Intersects(c.geom, r.geom)
                    ) AS cubierta
               FROM colonias c
         )
         SELECT c.clave, c.nombre, c.tipo,
                c.poblacion_estimada::int AS poblacion,
                ROUND((c.area_m2 / 10000)::numeric, 2)::float8 AS hectareas,
                ROUND((
                    SELECT MIN(ST_Distance(c.geom::geography, r.geom::geography))
                      FROM rutas_urvan r WHERE r.activa
                )::numeric, 0)::int AS dist_ruta_m,
                ROUND((
                    SELECT MIN(ST_Distance(c.geom::geography, p.geom::geography))
                      FROM paradas_ascenso p WHERE p.estatus = 'activa'
                )::numeric, 0)::int AS dist_parada_m,
                (SELECT COUNT(*)::int FROM paradas_ascenso p
                  WHERE ST_Intersects(c.geom, p.geom) AND p.estatus = 'inactiva') AS paradas_inactivas,
                (SELECT COUNT(*)::int FROM paradas_ascenso p
                  WHERE ST_Intersects(c.geom, p.geom) AND p.estatus = 'propuesta') AS paradas_propuestas
           FROM c
          WHERE NOT c.cubierta
          ORDER BY c.poblacion_estimada DESC, c.nombre"
    );

    /* ----------------- Distribución de rutas por colonia ------------------ */
    $distribucion = q_all(
        "WITH c AS (
             SELECT c.id,
                    (SELECT COUNT(DISTINCT r.id)
                       FROM rutas_urvan r
                      WHERE r.activa AND ST_Intersects(c.geom, r.geom))::int AS n
               FROM colonias c
         )
         SELECT n AS num_rutas, COUNT(*)::int AS colonias
           FROM c
          GROUP BY n
          ORDER BY n"
    );

    /* ------------------------------ Armado -------------------------------- */
    $num = static fn (mixed $v): float => (float) ($v ?? 0);
    $ent = static fn (mixed $v): int => (int) ($v ?? 0);

    $totalColonias = $ent($colonias['total']);
    $conCobertura = $ent($colonias['con_cobertura']);
    $poblacionTotal = $ent($colonias['poblacion_total']);
    $paradasActivas = $ent($paradas['activas']);

    $cobertura = [
        'total' => $totalColonias,
        'con_cobertura' => $conCobertura,
        'sin_cobertura' => $ent($colonias['sin_cobertura']),
        'porcentaje_colonias' => $totalColonias > 0 ? round($conCobertura / $totalColonias * 100, 1) : 0.0,
        'poblacion_total' => $poblacionTotal,
        'poblacion_cubierta' => $ent($colonias['poblacion_cubierta']),
        'poblacion_sin_cobertura' => $ent($colonias['poblacion_sin_cobertura']),
        'porcentaje_poblacion' => $poblacionTotal > 0
            ? round($ent($colonias['poblacion_cubierta']) / $poblacionTotal * 100, 1) : 0.0,
        'superficie_km2' => $num($colonias['superficie_km2']),
        'superficie_cubierta_km2' => $num($colonias['superficie_cubierta_km2']),
    ];

    return [
        'rutas' => [
            'total' => $ent($rutas['total']),
            'activas' => $ent($rutas['activas']),
            'inactivas' => $ent($rutas['inactivas']),
            'km_total' => $num($rutas['km_total']),
            'km_promedio' => $num($rutas['km_promedio']),
            'km_max' => $num($rutas['km_max']),
            'tarifa_promedio' => $num($rutas['tarifa_promedio']),
            'tarifa_min' => $num($rutas['tarifa_min']),
            'tarifa_max' => $num($rutas['tarifa_max']),
            'frecuencia_promedio' => $ent($rutas['frecuencia_promedio']),
            'horas_promedio' => $num($rutas['horas_promedio']),
            'primer_servicio' => $rutas['primer_servicio'],
            'ultimo_servicio' => $rutas['ultimo_servicio'],
        ],
        'paradas' => [
            'total' => $ent($paradas['total']),
            'activas' => $paradasActivas,
            'inactivas' => $ent($paradas['inactivas']),
            'propuestas' => $ent($paradas['propuestas']),
            'techadas' => $ent($paradas['techadas']),
            'sin_ruta' => $ent($paradas['sin_ruta']),
            'por_tipo' => [
                'terminal' => $ent($paradas['terminales']),
                'base' => $ent($paradas['bases']),
                'parada_autorizada' => $ent($paradas['autorizadas']),
            ],
        ],
        'cobertura' => $cobertura,
        'ranking_rutas' => array_map(static function (array $r) use ($num, $ent): array {
            return [
                'clave' => $r['clave'],
                'nombre' => $r['nombre'],
                'color' => color_hex($r['color_hex']),
                'km' => $num($r['km']),
                'tarifa' => $num($r['tarifa']),
                'frecuencia' => $ent($r['frecuencia']),
                'paradas' => $ent($r['paradas']),
                'colonias' => $ent($r['colonias']),
            ];
        }, $ranking),
        'sin_cobertura' => array_map(static function (array $c) use ($num, $ent): array {
            $poblacion = $ent($c['poblacion']);
            $prioridad = $poblacion >= 3000 ? 'alta' : ($poblacion >= 1500 ? 'media' : 'baja');
            return [
                'clave' => $c['clave'],
                'nombre' => $c['nombre'],
                'tipo' => $c['tipo'],
                'poblacion' => $poblacion,
                'hectareas' => $num($c['hectareas']),
                'dist_ruta_m' => $ent($c['dist_ruta_m']),
                'dist_parada_m' => $ent($c['dist_parada_m']),
                'paradas_inactivas' => $ent($c['paradas_inactivas']),
                'paradas_propuestas' => $ent($c['paradas_propuestas']),
                'prioridad' => $prioridad,
            ];
        }, $sinCobertura),
        'distribucion_cobertura' => array_map(static function (array $d) use ($ent): array {
            return ['num_rutas' => $ent($d['num_rutas']), 'colonias' => $ent($d['colonias'])];
        }, $distribucion),
        'accesibilidad' => [
            'paradas_por_10k' => $poblacionTotal > 0 ? round($paradasActivas / $poblacionTotal * 10000, 1) : 0.0,
            'rutas_por_10k' => $poblacionTotal > 0 ? round($ent($rutas['activas']) / $poblacionTotal * 10000, 1) : 0.0,
        ],
        'meta' => [
            'municipio' => $cfg['app']['municipio'],
            'centro' => $cfg['mapa']['centro'],
            'zoom' => $cfg['mapa']['zoom'],
            'radio_m' => $cfg['mapa']['radio_m'],
            'radios' => $cfg['mapa']['radios'],
            'inversion' => $cfg['inversion'],
            'moneda' => 'MXN',
            'generado' => date('c'),
            'nota_datos' => 'Datos demo/ficticios. Los costos de inversión son supuestos editables, no cifras oficiales.',
        ],
    ];
});
