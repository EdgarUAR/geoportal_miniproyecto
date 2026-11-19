<?php
/**
 * GET api/salud.php
 * Diagnóstico de la conexión: PostgreSQL, PostGIS y tablas del proyecto.
 */

declare(strict_types=1);

require __DIR__ . '/../src/app.php';

run_api(function (): array {
    $cfg = geo_config();
    db();

    $tienePostgis = q_val(
        "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis')"
    );
    $tienePostgis = $tienePostgis === true || $tienePostgis === 't' || $tienePostgis === 1 || $tienePostgis === '1';

    if (!$tienePostgis) {
        throw new GeoDbException(
            'La base "' . $cfg['db']['name'] . '" existe pero no tiene PostGIS. ' .
            'Ejecuta:  psql -U ' . $cfg['db']['user'] . ' -d ' . $cfg['db']['name'] . ' -c "CREATE EXTENSION postgis;"'
        );
    }

    $info = q_one(
        "SELECT current_database()                AS base,
                current_user                      AS usuario,
                current_setting('server_version') AS version_pg,
                postgis_version()                 AS version_postgis"
    );

    $tablas = ['colonias', 'rutas_urvan', 'paradas_ascenso', 'rutas_paradas'];
    $conteos = [];
    $faltantes = [];

    foreach ($tablas as $tabla) {
        $valor = q_val(
            "SELECT to_regclass('public.' || :tabla) IS NOT NULL",
            ['tabla' => $tabla]
        );
        $existe = $valor === true || $valor === 't' || $valor === 1 || $valor === '1';

        if (!$existe) {
            $faltantes[] = $tabla;
            continue;
        }

        $conteos[$tabla] = (int) q_val("SELECT count(*) FROM {$tabla}");
    }

    $srids = [];
    if (!$faltantes) {
        foreach (['colonias', 'rutas_urvan', 'paradas_ascenso'] as $tabla) {
            $srids[$tabla] = (int) q_val("SELECT DISTINCT ST_SRID(geom) FROM {$tabla} LIMIT 1");
        }
    }

    return [
        'listo' => $faltantes === [] && !in_array(0, $conteos, true),
        'base' => $info['base'] ?? null,
        'usuario' => $info['usuario'] ?? null,
        'postgres' => $info['version_pg'] ?? null,
        'postgis' => $info['version_postgis'] ?? null,
        'srid' => $srids,
        'tablas' => $conteos,
        'faltantes' => $faltantes,
        'config' => [
            'host' => $cfg['db']['host'],
            'puerto' => $cfg['db']['port'],
            'base' => $cfg['db']['name'],
            'usuario' => $cfg['db']['user'],
        ],
        'generado' => date('c'),
    ];
});
