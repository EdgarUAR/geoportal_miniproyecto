<?php
/**
 * Configuración general del geoportal.
 *
 * IMPORTANTE (Herd en Windows):
 *   Ajusta aquí la contraseña del usuario de PostgreSQL. El resto de valores
 *   puede quedarse como está para ejecutar la demo local.
 *
 * También puedes definir variables de entorno (GEO_DB_HOST, GEO_DB_PORT,
 * GEO_DB_NAME, GEO_DB_USER, GEO_DB_PASS) o crear config/local.php con los
 * mismos arreglos para no tocar este archivo.
 */

declare(strict_types=1);

return [
    'db' => [
        'host' => getenv('GEO_DB_HOST') ?: '127.0.0.1',
        'port' => (int) (getenv('GEO_DB_PORT') ?: 5432),
        'name' => getenv('GEO_DB_NAME') ?: 'geo_chilp',
        'user' => getenv('GEO_DB_USER') ?: 'postgres',
        // ⬇⬇⬇  CAMBIA ESTA CONTRASEÑA POR LA DE TU POSTGRESQL  ⬇⬇⬇
        'pass' => getenv('GEO_DB_PASS') ?: 'postgres',
    ],

    'app' => [
        'nombre' => 'GeoUrvan',
        'subtitulo' => 'Geoportal de movilidad y transporte público',
        'municipio' => 'Chilpancingo de los Bravo, Guerrero',
        // Muestra el detalle técnico de los errores de base de datos.
        // Déjalo en false si publicas el geoportal en un servidor.
        'debug' => true,
    ],

    'mapa' => [
        // [longitud, latitud]
        'centro' => [-99.5015, 17.5515],
        'zoom' => 14,
        'radio_m' => 300,
        'radios' => [150, 300, 500, 800],
    ],

    /*
     * Supuestos EDITABLES para el módulo de presupuesto.
     * Son cifras referenciales de demo, no costos oficiales.
     */
    'inversion' => [
        'costo_km' => 350000,          // MXN por km de ampliación de trazo
        'costo_parada' => 120000,      // MXN por parada nueva (señalética + mobiliario)
        'presupuesto_sugerido' => 300000,
        'presupuesto_max' => 1500000,
    ],
];
