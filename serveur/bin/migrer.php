<?php
// Applique le schéma SQL : php bin/migrer.php principale|chat [chemin/vers/config.php]
// À lancer en SSH sur le serveur (ou en local), jamais depuis le web. Chaque fichier n'est appliqué qu'une fois
// (suivi dans la table schema_migrations). En cas d'échec en cours de fichier, vider la base et relancer :
// MariaDB valide chaque CREATE TABLE sans pouvoir l'annuler.
// Le déploiement automatique passe par api/migrer.php (même code, protégé par jeton).
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require dirname(__DIR__) . '/api/src/autoload.php';

use Lpc\Config;
use Lpc\Db;
use Lpc\Migrations;

$cible = $argv[1] ?? '';
if (!isset(Migrations::FICHIERS[$cible])) {
    fwrite(STDERR, "Usage : php bin/migrer.php principale|chat [chemin/vers/config.php]\n");
    exit(2);
}

try {
    $db = new Db(Config::charger($argv[2] ?? null));
    $pdo = $cible === 'chat' ? $db->chat() : $db->principale();
    foreach (Migrations::appliquer($pdo, Migrations::FICHIERS[$cible], dirname(__DIR__) . '/api/sql') as $ligne) {
        echo $ligne . "\n";
    }
    echo "Terminé.\n";
} catch (Throwable $e) {
    fwrite(STDERR, 'Échec : ' . $e->getMessage() . "\n");
    exit(1);
}
