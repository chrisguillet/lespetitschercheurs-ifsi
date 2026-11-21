<?php
// Applique le schéma SQL : php bin/migrer.php principale|chat
// À lancer en SSH sur le serveur (ou en local), jamais depuis le web. Chaque fichier n'est appliqué qu'une fois
// (suivi dans la table schema_migrations). En cas d'échec en cours de fichier, vider la base et relancer :
// MariaDB valide chaque CREATE TABLE sans pouvoir l'annuler.
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require dirname(__DIR__) . '/api/src/autoload.php';

use Lpc\Config;
use Lpc\Db;

const FICHIERS = ['principale' => ['db_principale', ['001_principal.sql']], 'chat' => ['db_chat', ['002_chat.sql']]];

$cible = $argv[1] ?? '';
if (!isset(FICHIERS[$cible])) {
    fwrite(STDERR, "Usage : php bin/migrer.php principale|chat [chemin/vers/config.php]\n");
    exit(2);
}

try {
    $config = Config::charger($argv[2] ?? null);
    $db = new Db($config);
    [$cleBase, $fichiers] = FICHIERS[$cible];
    $pdo = $cleBase === 'db_chat' ? $db->chat() : $db->principale();

    $pdo->exec('CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(40) NOT NULL, applique_le DATETIME NOT NULL, PRIMARY KEY (version))
                ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');

    foreach ($fichiers as $nom) {
        $deja = $pdo->prepare('SELECT 1 FROM schema_migrations WHERE version = ?');
        $deja->execute([$nom]);
        if ($deja->fetchColumn() !== false) {
            echo "= $nom : déjà appliqué\n";
            continue;
        }
        $sql = file_get_contents(dirname(__DIR__) . '/sql/' . $nom);
        if ($sql === false) {
            throw new RuntimeException("Fichier SQL introuvable : $nom");
        }
        // Retire les commentaires (/* ... */ et lignes « -- ») puis découpe sur les points-virgules en fin de ligne.
        $sql = preg_replace('#/\*.*?\*/#s', '', $sql);
        $sql = preg_replace('/^\s*--.*$/m', '', (string) $sql);
        $instructions = preg_split('/;\s*\n/', (string) $sql);
        $n = 0;
        foreach ($instructions as $instruction) {
            $instruction = trim($instruction);
            if ($instruction === '' || $instruction === ';') {
                continue;
            }
            $pdo->exec($instruction);
            $n++;
        }
        $pdo->prepare('INSERT INTO schema_migrations (version, applique_le) VALUES (?, ?)')->execute([$nom, gmdate('Y-m-d H:i:s')]);
        echo "+ $nom : $n instructions appliquées\n";
    }
    echo "Terminé.\n";
} catch (Throwable $e) {
    fwrite(STDERR, 'Échec : ' . $e->getMessage() . "\n");
    exit(1);
}
