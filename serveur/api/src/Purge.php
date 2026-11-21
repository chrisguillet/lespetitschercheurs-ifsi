<?php
declare(strict_types=1);

namespace Lpc;

/**
 * Purge des comptes inactifs : on retire la personne, pas le tronc commun.
 *
 * Un compte sans connexion depuis 12 mois (date de première demande ou de création à défaut) est retiré :
 *  - sont supprimés : le compte et l'adresse, les rôles, demandes, appartenances, notes personnelles, retours sur l'outil,
 *    messages du chat, bulletins de vote, pièces jointes déposées, invitations à son adresse, fiches non terminées (brouillons) ;
 *  - sont conservés, devenus anonymes (la clé étrangère passe à NULL) : fiches terminées, commentaires, articles, propositions,
 *    historique des versions, termes du glossaire, réunions, jalons.
 * Ne sont jamais touchés : l'adresse de l'administrateur et toute personne qui administre une promo, un site ou l'outil.
 * Par défaut, on se contente de compter (« à blanc ») ; la suppression réelle exige purge_auto = true dans config.php.
 */
final class Purge
{
    public const MOIS = 12;

    /** @return list<array{id:int,email:string}> */
    public static function candidats(\PDO $pdo, string $emailAdmin, int $maintenant, int $mois = self::MOIS): array
    {
        $limite = (new \DateTimeImmutable('@' . $maintenant))->modify('-' . $mois . ' months')->format('Y-m-d H:i:s');
        $st = $pdo->prepare(
            "SELECT u.id, u.email FROM utilisateurs u
             WHERE u.email <> ? AND COALESCE(u.derniere_connexion, u.demande_le, u.cree_le) < ?
               AND NOT EXISTS (SELECT 1 FROM attributions a WHERE a.utilisateur_id = u.id AND a.role IN ('admin', 'admin_site', 'admin_promo'))
             ORDER BY u.id"
        );
        $st->execute([$emailAdmin, $limite]);
        return array_map(static fn (array $r): array => ['id' => (int) $r['id'], 'email' => (string) $r['email']], $st->fetchAll());
    }

    /**
     * @return array{candidats:int,retires:int,fiches_conservees:int,brouillons_supprimes:int,fichiers_supprimes:int,mode:string}
     */
    public static function executer(Config $config, Db $db, int $maintenant, bool $appliquer): array
    {
        $pdo = $db->principale();
        $liste = self::candidats($pdo, $config->emailAdmin(), $maintenant);
        $rapport = ['mode' => $appliquer ? 'reel' : 'a_blanc', 'candidats' => count($liste), 'retires' => 0, 'fiches_conservees' => 0,
            'brouillons_supprimes' => 0, 'fichiers_supprimes' => 0];
        if (!$appliquer) {
            foreach ($liste as $c) {
                $rapport['fiches_conservees'] += (int) self::valeur($pdo, "SELECT COUNT(*) FROM analyses WHERE utilisateur_id = ? AND statut = 'Terminée'", [$c['id']]);
                $rapport['brouillons_supprimes'] += (int) self::valeur($pdo, "SELECT COUNT(*) FROM analyses WHERE utilisateur_id = ? AND statut <> 'Terminée'", [$c['id']]);
            }
            return $rapport;
        }
        foreach ($liste as $c) {
            $n = self::retirer($config, $db, $c['id']);
            $rapport['retires']++;
            $rapport['fiches_conservees'] += $n['conservees'];
            $rapport['brouillons_supprimes'] += $n['brouillons'];
            $rapport['fichiers_supprimes'] += $n['fichiers'];
        }
        return $rapport;
    }

    /** @return array{conservees:int,brouillons:int,fichiers:int} */
    public static function retirer(Config $config, Db $db, int $id): array
    {
        $pdo = $db->principale();
        $email = (string) self::valeur($pdo, 'SELECT email FROM utilisateurs WHERE id = ?', [$id]);
        if ($email === '') {
            return ['conservees' => 0, 'brouillons' => 0, 'fichiers' => 0];
        }
        $chemins = array_map('strval', self::colonne($pdo, 'SELECT chemin FROM fichiers WHERE cree_par = ?', [$id]));
        $pdo->beginTransaction();
        try {
            $conservees = (int) self::valeur($pdo, "SELECT COUNT(*) FROM analyses WHERE utilisateur_id = ? AND statut = 'Terminée'", [$id]);
            $brouillons = self::colonne($pdo, "SELECT id FROM analyses WHERE utilisateur_id = ? AND statut <> 'Terminée'", [$id]);
            foreach ($brouillons as $a) {
                $pdo->prepare("DELETE FROM historique WHERE cible = 'analyse' AND cible_id = ?")->execute([(string) $a]);
            }
            $pdo->prepare("DELETE FROM analyses WHERE utilisateur_id = ? AND statut <> 'Terminée'")->execute([$id]);   // leurs commentaires : CASCADE
            foreach ([
                'DELETE FROM fichiers WHERE cree_par = ?',
                'DELETE FROM feedback WHERE auteur_id = ?',
                "DELETE FROM votes WHERE cible_id = ? AND statut = 'ouvert'",
            ] as $sql) {
                $pdo->prepare($sql)->execute([$id]);
            }
            $pdo->prepare('DELETE FROM invitations WHERE email = ?')->execute([$email]);
            $pdo->prepare("DELETE FROM import_traces WHERE entite IN ('utilisateur', 'demande') AND source_id = ?")->execute([$email]);
            $pdo->prepare('INSERT INTO journal_admin (acteur_id, action, cible, detail, cree_le) VALUES (NULL, ?, ?, ?, ?)')
                ->execute(['purge_inactif', 'utilisateur:' . $id . ' (retiré)', 'fiches_conservees=' . $conservees, Temps::maintenant()]);
            // Tout le reste (rôles, demandes, appartenances, notes, bulletins, lectures de commentaires) : CASCADE ; le contenu partagé : SET NULL.
            $pdo->prepare('DELETE FROM utilisateurs WHERE id = ?')->execute([$id]);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }

        try {
            $chat = $db->chat();
            $chat->prepare('DELETE FROM chat_messages WHERE auteur_id = ?')->execute([$id]);
            $chat->prepare('DELETE FROM presence WHERE utilisateur_id = ?')->execute([$id]);
        } catch (\Throwable $e) {
            error_log('Purge : chat non nettoyé : ' . $e->getMessage());
        }
        $dossier = realpath($config->dossierPrive() . '/fichiers');
        foreach ($chemins as $chemin) {
            $reel = $dossier === false ? false : realpath($dossier . '/' . $chemin);
            if ($reel !== false && str_starts_with($reel, $dossier . DIRECTORY_SEPARATOR) && is_file($reel)) {
                @unlink($reel);
            }
        }
        return ['conservees' => $conservees, 'brouillons' => count($brouillons), 'fichiers' => count($chemins)];
    }

    /** @param list<mixed> $params */
    private static function valeur(\PDO $pdo, string $sql, array $params): mixed
    {
        $st = $pdo->prepare($sql);
        $st->execute($params);
        $v = $st->fetchColumn();
        return $v === false ? null : $v;
    }

    /** @param list<mixed> $params @return list<mixed> */
    private static function colonne(\PDO $pdo, string $sql, array $params): array
    {
        $st = $pdo->prepare($sql);
        $st->execute($params);
        return $st->fetchAll(\PDO::FETCH_COLUMN);
    }
}
