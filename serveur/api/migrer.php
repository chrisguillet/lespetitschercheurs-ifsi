<?php
// Point d'entrée web des migrations SQL, protégé par un jeton (voir Migrations::executerWeb). Appelé par le déploiement.
declare(strict_types=1);

ini_set('display_errors', '0');
ini_set('log_errors', '1');

require __DIR__ . '/src/autoload.php';

\Lpc\Migrations::executerWeb();
