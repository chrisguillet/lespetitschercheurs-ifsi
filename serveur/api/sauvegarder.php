<?php
// Sauvegarde quotidienne des pièces jointes, lancée par la tâche planifiée de l'hébergeur (ligne de commande uniquement).
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require __DIR__ . '/src/autoload.php';

try {
    $config = \Lpc\Config::charger();
    echo json_encode(['ok' => true] + \Lpc\Sauvegarde::fichiers($config->dossierPrive(), time()), JSON_UNESCAPED_UNICODE) . "\n";
} catch (\Throwable $e) {
    fwrite(STDERR, 'Sauvegarde : ' . $e->getMessage() . "\n");
    exit(1);
}
