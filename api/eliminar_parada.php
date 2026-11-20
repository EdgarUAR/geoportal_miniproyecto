<?php
/**
 * POST api/eliminar_parada.php
 * Elimina una parada del catálogo. La tabla rutas_paradas tiene
 * ON DELETE CASCADE, así que sus vínculos con rutas se limpian solos.
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
        || (is_string($cuerpo) && preg_match('/^\s*[\{\[]/', $cuerpo) === 1);

    if (is_string($cuerpo) && trim($cuerpo) !== '' && $esJson) {
        $json = json_decode($cuerpo, true);
        if (json_last_error() !== JSON_ERROR_NONE || !is_array($json)) {
            throw new GeoInputException('El cuerpo JSON no es válido.');
        }
        $datos = array_merge($json, $_POST);
    }

    $clave = is_string($datos['clave'] ?? null) ? trim($datos['clave']) : '';
    if (!preg_match('/^[A-Za-z0-9_-]{1,20}$/', $clave)) {
        throw new GeoInputException('Indica una clave de parada válida (por ejemplo PAR-016).');
    }

    $fila = q_one(
        'DELETE FROM paradas_ascenso WHERE clave = :clave RETURNING clave, nombre',
        [':clave' => $clave]
    );

    if (!$fila) {
        throw new GeoInputException("No existe una parada con la clave {$clave}.");
    }

    return [
        'eliminada' => true,
        'clave' => (string) $fila['clave'],
        'nombre' => (string) $fila['nombre'],
    ];
});
