<?php
declare(strict_types=1);

namespace Lpc;

/** Accès à la table utilisateurs. */
final class Utilisateurs
{
    private const COLONNES = 'id, pid, email, prenom, nom, pseudo, couleur, statut, derniere_connexion, consentement_version';

    public static function parEmail(\PDO $pdo, string $email): ?Utilisateur
    {
        $st = $pdo->prepare('SELECT ' . self::COLONNES . ' FROM utilisateurs WHERE email = ?');
        $st->execute([$email]);
        $r = $st->fetch();
        return $r === false ? null : Utilisateur::depuisLigne($r);
    }

    /** Couleurs attribuées aux étudiants, de la moins utilisée à la plus utilisée. */
    public const PALETTE_ETUDIANTS = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#42a5a5', '#d4a017', '#f032e6', '#9a6324', '#008080'];

    public static function couleurPeuUtilisee(\PDO $pdo): string
    {
        $n = array_fill_keys(self::PALETTE_ETUDIANTS, 0);
        $st = $pdo->query("SELECT u.couleur, COUNT(DISTINCT u.id) AS n FROM utilisateurs u
                           JOIN attributions a ON a.utilisateur_id = u.id AND a.role = 'etudiant' GROUP BY u.couleur");
        foreach ($st->fetchAll() as $r) {
            if (isset($n[$r['couleur']])) {
                $n[$r['couleur']] = (int) $r['n'];
            }
        }
        asort($n);
        return (string) array_key_first($n);
    }

    /** Identifiant de la ligne de la personne ; une adresse encore inconnue reçoit une ligne « en attente ». */
    public static function assurerLigne(\PDO $pdo, Utilisateur $u): int
    {
        if ($u->id !== null) {
            return $u->id;
        }
        self::enregistrerDemande($pdo, $u->email);
        $cree = self::parEmail($pdo, $u->email);
        if ($cree === null || $cree->id === null) {
            throw new Erreur('server', 'Compte introuvable');
        }
        return $cree->id;
    }

    public static function parPid(\PDO $pdo, string $pid): ?Utilisateur
    {
        $st = $pdo->prepare('SELECT ' . self::COLONNES . ' FROM utilisateurs WHERE pid = ?');
        $st->execute([$pid]);
        $r = $st->fetch();
        return $r === false ? null : Utilisateur::depuisLigne($r);
    }

    public static function parId(\PDO $pdo, int $id): ?Utilisateur
    {
        $st = $pdo->prepare('SELECT ' . self::COLONNES . ' FROM utilisateurs WHERE id = ?');
        $st->execute([$id]);
        $r = $st->fetch();
        return $r === false ? null : Utilisateur::depuisLigne($r);
    }

    /** Première ouverture de l'application par une adresse inconnue : une demande en attente est enregistrée. */
    public static function enregistrerDemande(\PDO $pdo, string $email): void
    {
        if (self::parEmail($pdo, $email) !== null) {
            return;
        }
        $n = (int) $pdo->query("SELECT COUNT(*) FROM utilisateurs WHERE statut = 'en_attente'")->fetchColumn();
        if ($n >= Config::MAX_EN_ATTENTE) {
            throw new Erreur('forbidden', 'Trop de demandes en attente, réessayez plus tard');
        }
        $now = Temps::maintenant();
        try {
            $st = $pdo->prepare(
                "INSERT INTO utilisateurs (pid, email, couleur, statut, demande_le, cree_le) VALUES (?, ?, ?, 'en_attente', ?, ?)"
            );
            $st->execute([Ids::pid($email), $email, Config::COULEUR_DEFAUT, $now, $now]);
        } catch (\PDOException $e) {
            if ($e->getCode() !== '23000') {   // deux requêtes simultanées : l'autre a déjà créé la ligne
                throw $e;
            }
        }
    }

    /** L'adresse d'administration de la configuration existe toujours, est active et porte le rôle admin global. */
    public static function assurerAdmin(\PDO $pdo, Config $config): Utilisateur
    {
        $email = $config->emailAdmin();
        $u = self::parEmail($pdo, $email);
        if ($u === null) {
            $now = Temps::maintenant();
            try {
                $st = $pdo->prepare(
                    "INSERT INTO utilisateurs (pid, email, prenom, couleur, statut, demande_le, cree_le) VALUES (?, ?, ?, ?, 'actif', ?, ?)"
                );
                $st->execute([Ids::pid($email), $email, $config->nomAdmin(), Config::COULEUR_ADMIN, $now, $now]);
            } catch (\PDOException $e) {
                if ($e->getCode() !== '23000') {
                    throw $e;
                }
            }
            $u = self::parEmail($pdo, $email);
        } elseif ($u->statut !== 'actif') {
            $pdo->prepare("UPDATE utilisateurs SET statut = 'actif' WHERE id = ?")->execute([$u->id]);
            $u = self::parEmail($pdo, $email);
        }
        if ($u === null || $u->id === null) {
            throw new Erreur('server', 'Compte administrateur introuvable');
        }
        Attributions::assurerAdminGlobal($pdo, $u->id);
        return $u;
    }

    /** Date de dernière connexion, mise à jour au plus toutes les dix minutes. */
    public static function toucherConnexion(\PDO $pdo, Utilisateur $u): void
    {
        if ($u->id === null) {
            return;
        }
        $depuis = Temps::secondesDepuis($u->derniereConnexion);
        if ($depuis !== null && $depuis < Config::DELAI_CONNEXION_S) {
            return;
        }
        $pdo->prepare('UPDATE utilisateurs SET derniere_connexion = ? WHERE id = ?')->execute([Temps::maintenant(), $u->id]);
    }
}
