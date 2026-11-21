<?php
declare(strict_types=1);

namespace Lpc;

/**
 * Application du schéma SQL (fichiers de api/sql, appliqués une seule fois chacun et suivis dans schema_migrations).
 * Utilisée en ligne de commande (bin/migrer.php) et par le point d'entrée web protégé par jeton (api/migrer.php),
 * que le déploiement automatique appelle après l'envoi des fichiers.
 */
final class Migrations
{
    /** Fichiers par base, dans l'ordre. */
    public const FICHIERS = [
        'principale' => ['001_principal.sql', '003_acces.sql', '004_import.sql', '005_jalons_types.sql', '006_doublons.sql', '007_traductions.sql'],
        'chat' => ['002_chat.sql'],
    ];

    /**
     * @param list<string> $fichiers
     * @return list<string> compte rendu, une ligne par fichier
     */
    public static function appliquer(\PDO $pdo, array $fichiers, string $dossierSql): array
    {
        $pdo->exec('CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(40) NOT NULL, applique_le DATETIME NOT NULL, PRIMARY KEY (version))
                    ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
        $rapport = [];
        foreach ($fichiers as $nom) {
            $deja = $pdo->prepare('SELECT 1 FROM schema_migrations WHERE version = ?');
            $deja->execute([$nom]);
            if ($deja->fetchColumn() !== false) {
                $rapport[] = "= $nom : déjà appliqué";
                continue;
            }
            $sql = file_get_contents($dossierSql . '/' . $nom);
            if ($sql === false) {
                throw new \RuntimeException("Fichier SQL introuvable : $nom");
            }
            $n = 0;
            foreach (self::instructions($sql) as $instruction) {
                $pdo->exec($instruction);
                $n++;
            }
            $pdo->prepare('INSERT INTO schema_migrations (version, applique_le) VALUES (?, ?)')->execute([$nom, gmdate('Y-m-d H:i:s')]);
            $rapport[] = "+ $nom : $n instructions appliquées";
        }
        return $rapport;
    }

    /** Retire les commentaires (/* ... *\/ et lignes « -- ») puis découpe sur les points-virgules en fin de ligne. @return list<string> */
    public static function instructions(string $sql): array
    {
        $sql = preg_replace('#/\*.*?\*/#s', '', $sql) ?? '';
        $sql = preg_replace('/^\s*--.*$/m', '', $sql) ?? '';
        $out = [];
        foreach (preg_split('/;\s*\n/', $sql) ?: [] as $i) {
            $i = trim($i);
            if ($i !== '' && $i !== ';') {
                $out[] = rtrim($i, ';');
            }
        }
        return $out;
    }

    /**
     * Point d'entrée web : POST avec l'en-tête X-Migration-Token. Désactivé tant que migration_jeton_sha256 est absent de la configuration.
     * N'applique que les fichiers livrés avec le déploiement ; aucun SQL ne vient de la requête.
     */
    public static function executerWeb(): void
    {
        Http::entetes();
        try {
            $config = Config::charger();
            $attendu = strtolower((string) $config->get('migration_jeton_sha256', ''));
            if (preg_match('/^[0-9a-f]{64}$/', $attendu) !== 1) {
                http_response_code(404);
                Http::json(['ok' => false, 'error' => 'not_found']);
                return;
            }
            if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
                http_response_code(405);
                Http::json(['ok' => false, 'error' => 'bad_request']);
                return;
            }
            $jeton = (string) ($_SERVER['HTTP_X_MIGRATION_TOKEN'] ?? '');
            if ($jeton === '' || !hash_equals($attendu, hash('sha256', $jeton))) {
                usleep(500000);   // freine les essais répétés
                http_response_code(403);
                Http::json(['ok' => false, 'error' => 'forbidden']);
                return;
            }

            $db = new Db($config);
            $dossier = __DIR__ . '/../sql';
            $principale = $db->principale();
            $verrou = $principale->query("SELECT GET_LOCK('lpc_migrations', 0)")->fetchColumn();
            if ((int) $verrou !== 1) {
                http_response_code(409);
                Http::json(['ok' => false, 'error' => 'busy', 'message' => 'Une migration est déjà en cours']);
                return;
            }
            try {
                $rapport = [
                    'principale' => self::appliquer($principale, self::FICHIERS['principale'], $dossier),
                    'chat' => self::appliquer($db->chat(), self::FICHIERS['chat'], $dossier),
                ];
            } finally {
                $principale->query("SELECT RELEASE_LOCK('lpc_migrations')");
            }
            Http::json(['ok' => true] + $rapport);
        } catch (\Throwable $e) {
            error_log(sprintf('Migration : %s dans %s:%d', $e->getMessage(), $e->getFile(), $e->getLine()));
            http_response_code(500);
            Http::json(['ok' => false, 'error' => 'server', 'message' => $e->getMessage()]);
        }
    }
}
