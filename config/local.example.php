<?php
/**
 * Copia este archivo como config/local.php para sobrescribir sólo lo que
 * necesites (por ejemplo, la contraseña real) sin modificar config.php.
 *
 *   Copy-Item config\local.example.php config\local.php
 */

declare(strict_types=1);

return [
    'db' => [
        'user' => 'postgres',
        'pass' => 'TU_CONTRASEÑA',
    ],
    'app' => [
        'debug' => true,
    ],
];
