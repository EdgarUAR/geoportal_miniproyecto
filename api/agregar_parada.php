<?php
/**
 * POST api/agregar_parada.php
 * Crea una parada nueva en PostGIS y la vincula automáticamente a las rutas
 * que pasan a 40 m o menos, recalculando el orden dentro de cada recorrido.
 */

declare(strict_types=1);

require __DIR__ . '/../src/app.php';

run_api(function (): array {
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
        throw new GeoInputException('Este endpoint solo acepta peticiones POST.');
    }

    $datos = $_POST;
    $cuerpo = file_get_contents('php://input');
    $tipoContenido = strtolower((string) ($_SERVER['CONTENT_TYPE'] ?? ''));
    $esJson = str_contains($tipoContenido, 'json')
        || (is_string($cuerpo) && preg_match('/^\s*[\[{]/', $cuerpo) === 1);
    if (is_string($cuerpo) && trim($cuerpo) !== '' && $esJson) {
        $json = json_decode($cuerpo, true);
        if (json_last_error() !== JSON_ERROR_NONE || !is_array($json)) {
            throw new GeoInputException('El cuerpo JSON no es válido.');
        }
        $datos = array_merge($json, $_POST);
    }

    $valor = static function (string $clave, mixed $default = null) use ($datos): mixed {
        return array_key_exists($clave, $datos) ? $datos[$clave] : $default;
    };

    $texto = static function (mixed $valor): string {
        return is_array($valor) || is_object($valor) ? '' : trim((string) $valor);
    };

    $longitud = static function (string $texto): int {
        return function_exists('mb_strlen') ? mb_strlen($texto, 'UTF-8') : strlen($texto);
    };

    /* ------------------------------ Validación ------------------------------ */

    $nombre = $texto($valor('nombre', ''));
    $largoNombre = $longitud($nombre);
    if ($largoNombre < 2 || $largoNombre > 120) {
        throw new GeoInputException('El nombre es obligatorio y debe tener entre 2 y 120 caracteres.');
    }

    $tipo = $texto($valor('tipo', 'parada_autorizada'));
    if (!in_array($tipo, ['terminal', 'base', 'parada_autorizada'], true)) {
        throw new GeoInputException('El tipo debe ser terminal, base o parada_autorizada.');
    }

    $estatus = $texto($valor('estatus', 'activa'));
    if ($estatus === '') {
        $estatus = 'activa';
    }
    if (!in_array($estatus, ['activa', 'propuesta', 'inactiva'], true)) {
        throw new GeoInputException('El estatus debe ser activa, propuesta o inactiva.');
    }

    $referencia = $texto($valor('referencia', ''));
    if ($longitud($referencia) > 180) {
        throw new GeoInputException('La referencia no puede exceder 180 caracteres.');
    }

    $techadaValor = $valor('techada', false);
    $techada = is_bool($techadaValor)
        ? $techadaValor
        : in_array(strtolower($texto($techadaValor)), ['1', 'true', 'on', 'yes', 'si', 'sí'], true);

    $lonValor = $valor('lon');
    $latValor = $valor('lat');
    if (!is_numeric($lonValor) || !is_numeric($latValor)) {
        throw new GeoInputException('Las coordenadas lon y lat son obligatorias y deben ser numéricas.');
    }

    $lon = (float) $lonValor;
    $lat = (float) $latValor;
    if (!is_finite($lon) || !is_finite($lat)
        || $lon < -101 || $lon > -98
        || $lat < 16 || $lat > 19) {
        throw new GeoInputException(
            'Las coordenadas deben estar dentro de Chilpancingo/WGS84 (lon entre -101 y -98, lat entre 16 y 19).'
        );
    }

    /* --------------------------- Inserción atómica --------------------------- */

    $pdo = db();
    $pdo->beginTransaction();

    try {
        // Evita que dos peticiones simultáneas generen la misma clave PAR-XXX.
        $pdo->exec('LOCK TABLE paradas_ascenso IN SHARE ROW EXCLUSIVE MODE');

        $siguiente = (int) q_val(
            "SELECT COALESCE(MAX((substring(clave FROM '^PAR-([0-9]+)$'))::int), 0) + 1
               FROM paradas_ascenso"
        );
        $clave = sprintf('PAR-%03d', $siguiente);

        $fila = q_one(
            "INSERT INTO paradas_ascenso
                 (clave, nombre, tipo, referencia, techada, estatus, fecha_alta, geom)
             VALUES (:clave, :nombre, :tipo, :referencia, :techada, :estatus, CURRENT_DATE,
                     ST_SetSRID(ST_MakePoint(:lon, :lat), 4326))
             RETURNING id, clave, nombre, tipo, referencia, techada, estatus,
                       to_char(fecha_alta, 'YYYY-MM-DD') AS fecha_alta,
                       ST_X(geom)::float8 AS lon,
                       ST_Y(geom)::float8 AS lat",
            [
                ':clave' => $clave,
                ':nombre' => $nombre,
                ':tipo' => $tipo,
                ':referencia' => $referencia === '' ? null : $referencia,
                ':techada' => $techada ? 'true' : 'false',
                ':estatus' => $estatus,
                ':lon' => $lon,
                ':lat' => $lat,
            ]
        );

        if (!$fila) {
            throw new GeoDbException('No se pudo recuperar la parada recién creada.');
        }

        // Recalcular rutas_paradas para todas las rutas a <= 40 m de la parada,
        // ordenando por la posición de cada parada a lo largo del trazo.
        q(
            "WITH afectadas AS (
                 SELECT r.id, r.geom
                   FROM rutas_urvan r
                  WHERE ST_DWithin(
                            r.geom::geography,
                            ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography,
                            40
                        )
             ),
             recalculo AS (
                 SELECT a.id AS ruta_id,
                        p.id AS parada_id,
                        ROW_NUMBER() OVER (
                            PARTITION BY a.id
                            ORDER BY ST_LineLocatePoint(a.geom, p.geom)
                        ) AS orden
                   FROM afectadas a
                   JOIN paradas_ascenso p
                     ON ST_DWithin(a.geom::geography, p.geom::geography, 40)
             )
             INSERT INTO rutas_paradas (ruta_id, parada_id, orden)
             SELECT ruta_id, parada_id, orden
               FROM recalculo
             ON CONFLICT (ruta_id, parada_id) DO UPDATE SET orden = EXCLUDED.orden",
            [':lon' => $lon, ':lat' => $lat]
        );

        $rutas = q_all(
            "SELECT r.clave, r.nombre, rp.orden
               FROM rutas_paradas rp
               JOIN rutas_urvan r ON r.id = rp.ruta_id
              WHERE rp.parada_id = :id
              ORDER BY r.clave",
            [':id' => $fila['id']]
        );

        $pdo->commit();

        return [
            'parada' => [
                'id' => (int) $fila['id'],
                'clave' => (string) $fila['clave'],
                'nombre' => (string) $fila['nombre'],
                'tipo' => (string) $fila['tipo'],
                'referencia' => $fila['referencia'],
                'techada' => $techada,
                'estatus' => (string) $fila['estatus'],
                'fecha_alta' => $fila['fecha_alta'],
                'lon' => (float) $fila['lon'],
                'lat' => (float) $fila['lat'],
            ],
            'rutas_asociadas' => count($rutas),
            'rutas' => array_map(static fn (array $r): array => [
                'clave' => (string) $r['clave'],
                'nombre' => (string) $r['nombre'],
                'orden' => (int) $r['orden'],
            ], $rutas),
        ];
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $e;
    }
});
