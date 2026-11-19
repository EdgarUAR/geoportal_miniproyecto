<?php
/**
 * Núcleo del backend: configuración, conexión PDO/PostgreSQL y utilidades JSON.
 * No requiere frameworks: sólo PHP 8.1+ con la extensión pdo_pgsql.
 */

declare(strict_types=1);

final class GeoDbException extends RuntimeException
{
}

final class GeoInputException extends RuntimeException
{
}

/* -------------------------------------------------------------------------- */
/* Configuración                                                               */
/* -------------------------------------------------------------------------- */

function geo_root(string $ruta = ''): string
{
    $base = dirname(__DIR__);
    return $ruta === '' ? $base : $base . DIRECTORY_SEPARATOR . ltrim($ruta, '/\\');
}

/**
 * Mezcla recursiva de arreglos (para config/local.php).
 */
function geo_mezclar(array $base, array $extra): array
{
    foreach ($extra as $clave => $valor) {
        if (
            is_array($valor) && isset($base[$clave]) && is_array($base[$clave])
            && !array_is_list($valor) && !array_is_list($base[$clave])
        ) {
            $base[$clave] = geo_mezclar($base[$clave], $valor);
        } else {
            $base[$clave] = $valor;
        }
    }
    return $base;
}

function geo_config(): array
{
    static $config = null;

    if (is_array($config)) {
        return $config;
    }

    $config = require geo_root('config/config.php');

    $local = geo_root('config/local.php');
    if (is_file($local)) {
        $extra = require $local;
        if (is_array($extra)) {
            $config = geo_mezclar($config, $extra);
        }
    }

    return $config;
}

/* -------------------------------------------------------------------------- */
/* Base de datos                                                               */
/* -------------------------------------------------------------------------- */

function db(): PDO
{
    static $pdo = null;

    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $db = geo_config()['db'];
    $dsn = sprintf(
        'pgsql:host=%s;port=%d;dbname=%s;connect_timeout=5',
        $db['host'],
        $db['port'],
        $db['name']
    );

    try {
        $pdo = new PDO($dsn, (string) $db['user'], (string) $db['pass'], [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => true,
            PDO::ATTR_STRINGIFY_FETCHES => false,
        ]);
    } catch (PDOException $e) {
        throw new GeoDbException(
            'No se pudo conectar a la base de datos "geo_chilp". ' .
            'Revisa que PostgreSQL esté encendido y que usuario/contraseña en config/config.php sean correctos.',
            0,
            $e
        );
    }

    return $pdo;
}

function q(string $sql, array $params = []): PDOStatement
{
    try {
        $stmt = db()->prepare($sql);
        $stmt->execute($params);
        return $stmt;
    } catch (PDOException $e) {
        throw new GeoDbException('Error al ejecutar la consulta en PostgreSQL: ' . $e->getMessage(), 0, $e);
    }
}

function q_all(string $sql, array $params = []): array
{
    return q($sql, $params)->fetchAll();
}

function q_one(string $sql, array $params = []): ?array
{
    $fila = q($sql, $params)->fetch();
    return $fila === false ? null : $fila;
}

function q_val(string $sql, array $params = []): mixed
{
    $valor = q($sql, $params)->fetchColumn();
    return $valor === false ? null : $valor;
}

/* -------------------------------------------------------------------------- */
/* Respuestas JSON                                                             */
/* -------------------------------------------------------------------------- */

function geo_banderas_json(): int
{
    return JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES;
}

function json_enviar(mixed $datos, int $estado = 200): never
{
    http_response_code($estado);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store, max-age=0');
    header('X-Content-Type-Options: nosniff');

    echo json_encode($datos, geo_banderas_json() | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

/**
 * Ejecuta un endpoint y convierte cualquier excepción en un JSON entendible.
 */
function run_api(callable $handler): never
{
    try {
        $datos = $handler();
        json_enviar(['ok' => true, 'data' => $datos]);
    } catch (GeoDbException $e) {
        json_enviar([
            'ok' => false,
            'tipo' => 'base_de_datos',
            'error' => $e->getMessage(),
            'detalle' => geo_config()['app']['debug'] ? $e->getPrevious()?->getMessage() : null,
            'ayuda' => geo_pasos_conexion(),
        ], 503);
    } catch (GeoInputException $e) {
        json_enviar([
            'ok' => false,
            'tipo' => 'parametros',
            'error' => $e->getMessage(),
        ], 400);
    } catch (Throwable $e) {
        json_enviar([
            'ok' => false,
            'tipo' => 'servidor',
            'error' => 'Ocurrió un error inesperado en el servidor.',
            'detalle' => geo_config()['app']['debug'] ? $e->getMessage() : null,
        ], 500);
    }
}

function geo_pasos_conexion(): array
{
    $db = geo_config()['db'];

    return [
        '1. Verifica que el servicio de PostgreSQL esté corriendo (Servicios de Windows → postgresql-x64-18).',
        '2. Crea la base y carga los datos:  psql -U ' . $db['user'] . ' -c "CREATE DATABASE ' . $db['name'] . '"  y luego  psql -U ' . $db['user'] . ' -d ' . $db['name'] . ' -f database/geo_chilp.sql',
        '3. Edita config/config.php (o crea config/local.php) con tu usuario y contraseña de PostgreSQL.',
        '4. Comprueba que PHP tenga activa la extensión pdo_pgsql (php -m | findstr pgsql).',
    ];
}

/* -------------------------------------------------------------------------- */
/* Parámetros y helpers                                                        */
/* -------------------------------------------------------------------------- */

function param_str(string $nombre, ?string $default = null): ?string
{
    $valor = $_GET[$nombre] ?? $_POST[$nombre] ?? null;
    if (!is_string($valor)) {
        return $default;
    }
    $valor = trim($valor);
    return $valor === '' ? $default : $valor;
}

function param_float(string $nombre, float $default = 0.0): float
{
    $valor = $_GET[$nombre] ?? $_POST[$nombre] ?? null;
    return is_numeric($valor) ? (float) $valor : $default;
}

function param_int(string $nombre, int $default = 0): int
{
    $valor = $_GET[$nombre] ?? $_POST[$nombre] ?? null;
    return is_numeric($valor) ? (int) $valor : $default;
}

function limitar(float $valor, float $min, float $max): float
{
    return max($min, min($max, $valor));
}

/**
 * PostGIS devuelve json_agg como texto: lo decodificamos para no enviarlo
 * doblemente escapado al navegador.
 */
function json_decodificar(mixed $valor): mixed
{
    if (!is_string($valor)) {
        return $valor;
    }
    $texto = trim($valor);
    if ($texto === '' || ($texto[0] !== '[' && $texto[0] !== '{')) {
        return $valor;
    }
    $decodificado = json_decode($texto, true);
    return $decodificado === null ? $valor : $decodificado;
}

/**
 * Convierte una fila con columna "geojson" en una Feature de GeoJSON.
 */
function geojson_feature(?string $geojson, array $propiedades): ?array
{
    if (!is_string($geojson) || $geojson === '') {
        return null;
    }
    $geometria = json_decode($geojson, true);
    if (!is_array($geometria)) {
        return null;
    }
    return [
        'type' => 'Feature',
        'geometry' => $geometria,
        'properties' => $propiedades,
    ];
}

function geojson_coleccion(array $features): array
{
    return [
        'type' => 'FeatureCollection',
        'features' => array_values(array_filter($features)),
    ];
}

/**
 * Normaliza un color hexadecimal; si el dato viene mal, usa un gris.
 */
function color_hex(?string $color, string $fallback = '#5B6B7C'): string
{
    return is_string($color) && preg_match('/^#[0-9a-fA-F]{6}$/', $color) === 1
        ? strtolower($color)
        : $fallback;
}
