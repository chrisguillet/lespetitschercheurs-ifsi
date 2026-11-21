<?php
// Import différentiel de l'ancien Google Sheet, protégé par le jeton des migrations (voir Importation::executerWeb).
declare(strict_types=1);

ini_set('display_errors', '0');
ini_set('log_errors', '1');
set_time_limit(0);

require __DIR__ . '/src/autoload.php';

\Lpc\Importation::executerWeb();
