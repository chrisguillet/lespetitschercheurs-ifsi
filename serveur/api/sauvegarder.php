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
    $rapport = \Lpc\Sauvegarde::fichiers($config->dossierPrive(), time());
    echo json_encode(['ok' => true] + $rapport, JSON_UNESCAPED_UNICODE) . "\n";
    // Trace dans le journal d'administration : preuve que la tâche planifiée tourne (consultable dans la base).
    (new \Lpc\Db($config))->principale()
        ->prepare('INSERT INTO journal_admin (acteur_id, action, cible, detail, cree_le) VALUES (NULL, ?, ?, ?, ?)')
        ->execute(['sauvegarde_fichiers', $rapport['instantane'], 'ajoutes=' . $rapport['ajoutes'] . ' copies=' . $rapport['copies'] . ' supprimes=' . count($rapport['supprimes']), \Lpc\Temps::maintenant()]);
} catch (\Throwable $e) {
    fwrite(STDERR, 'Sauvegarde : ' . $e->getMessage() . "\n");
    exit(1);
}
