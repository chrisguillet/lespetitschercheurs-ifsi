<?php
// Tâche de nuit lancée par l'hébergeur (ligne de commande uniquement) :
//  1. sauvegarde des pièces jointes (instantané du jour, 7 jours conservés) ;
//  2. purge des comptes inactifs depuis 12 mois (anonymisation du contenu partagé) : à blanc, sauf si purge_auto vaut true dans config.php.
// Chaque étape laisse une ligne dans le journal d'administration.
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require __DIR__ . '/src/autoload.php';

$code = 0;
try {
    $config = \Lpc\Config::charger();
    $db = new \Lpc\Db($config);
    $journal = static function (string $action, string $cible, string $detail) use ($db): void {
        $db->principale()
            ->prepare('INSERT INTO journal_admin (acteur_id, action, cible, detail, cree_le) VALUES (NULL, ?, ?, ?, ?)')
            ->execute([$action, $cible, $detail, \Lpc\Temps::maintenant()]);
    };
} catch (\Throwable $e) {
    fwrite(STDERR, 'Configuration : ' . $e->getMessage() . "\n");
    exit(1);
}

try {
    $rapport = \Lpc\Sauvegarde::fichiers($config->dossierPrive(), time());
    echo json_encode(['sauvegarde' => $rapport], JSON_UNESCAPED_UNICODE) . "\n";
    $journal('sauvegarde_fichiers', $rapport['instantane'], 'ajoutes=' . $rapport['ajoutes'] . ' copies=' . $rapport['copies'] . ' supprimes=' . count($rapport['supprimes']));
} catch (\Throwable $e) {
    fwrite(STDERR, 'Sauvegarde : ' . $e->getMessage() . "\n");
    $code = 1;
}

// La purge ne tourne que si la sauvegarde a réussi : on ne retire rien sans copie du jour.
if ($code === 0) {
    try {
        $rapport = \Lpc\Purge::executer($config, $db, time(), $config->get('purge_auto', false) === true);
        echo json_encode(['purge' => $rapport], JSON_UNESCAPED_UNICODE) . "\n";
        $journal('purge_inactifs', $rapport['mode'], 'candidats=' . $rapport['candidats'] . ' retires=' . $rapport['retires'] . ' fiches_conservees=' . $rapport['fiches_conservees']);
    } catch (\Throwable $e) {
        fwrite(STDERR, 'Purge : ' . $e->getMessage() . "\n");
        $code = 1;
    }
}
exit($code);
