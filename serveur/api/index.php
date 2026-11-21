<?php
// Point d'entrée unique de l'API : POST JSON {action, token, ...} -> JSON {ok, ...}, comme l'ancien Apps Script.
declare(strict_types=1);

ini_set('display_errors', '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);

require __DIR__ . '/src/autoload.php';

\Lpc\Application::executer();
