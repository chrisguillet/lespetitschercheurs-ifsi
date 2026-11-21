<?php
declare(strict_types=1);

namespace Lpc;

/**
 * Appartenance aux groupes. Règle : une étudiante n'est que dans un groupe par promo ; les formateurs et les administrateurs
 * peuvent être dans plusieurs groupes. Les électeurs d'un groupe sont ses membres actifs qui sont étudiants de sa promo.
 */
final class Membres
{
    public static function estMembre(\PDO $pdo, string $groupeId, int $utilisateurId): bool
    {
        return self::existe($pdo, 'SELECT 1 FROM membres WHERE groupe_id = ? AND utilisateur_id = ?', [$groupeId, $utilisateurId]);
    }

    public static function estEtudiantDe(\PDO $pdo, int $utilisateurId, string $promoId): bool
    {
        return self::existe($pdo, "SELECT 1 FROM attributions WHERE utilisateur_id = ? AND role = 'etudiant' AND promo_id = ?", [$utilisateurId, $promoId]);
    }

    /** Étudiante de la promo déjà membre d'un autre groupe de cette même promo ? */
    public static function dejaDansPromo(\PDO $pdo, int $utilisateurId, string $promoId, string $sauf = ''): bool
    {
        return self::estEtudiantDe($pdo, $utilisateurId, $promoId) && self::existe(
            $pdo,
            'SELECT 1 FROM membres m JOIN groupes g ON g.id = m.groupe_id WHERE m.utilisateur_id = ? AND g.promo_id = ? AND g.id <> ?',
            [$utilisateurId, $promoId, $sauf]
        );
    }

    /** Étudiante membre du groupe, sinon erreur ; renvoie la promo du groupe. */
    public static function exigerEtudiantMembre(Contexte $c, string $groupeId): string
    {
        $promo = $c->droits()->promoDeGroupe($groupeId);
        if ($promo === null) {
            throw new Erreur('not_found', 'Groupe introuvable');
        }
        $uid = $c->user->id;
        $pdo = $c->db->principale();
        if ($uid === null || !self::estMembre($pdo, $groupeId, $uid) || !self::estEtudiantDe($pdo, $uid, $promo)) {
            throw new Erreur('forbidden', 'Vous ne faites pas partie de ce groupe');
        }
        return $promo;
    }

    public static function ajouter(\PDO $pdo, string $groupeId, string $promoId, int $utilisateurId): void
    {
        $nom = self::nom($pdo, $utilisateurId);
        if (self::estMembre($pdo, $groupeId, $utilisateurId)) {
            throw new Erreur('invalid', $nom . ' fait déjà partie du groupe');
        }
        if (self::dejaDansPromo($pdo, $utilisateurId, $promoId, $groupeId)) {
            throw new Erreur('invalid', $nom . ' est déjà dans un groupe de cette promo');
        }
        $pdo->prepare('INSERT INTO membres (groupe_id, utilisateur_id, ajoute_le) VALUES (?, ?, ?)')->execute([$groupeId, $utilisateurId, Temps::maintenant()]);
    }

    public static function retirer(\PDO $pdo, string $groupeId, int $utilisateurId): void
    {
        $st = $pdo->prepare('DELETE FROM membres WHERE groupe_id = ? AND utilisateur_id = ?');
        $st->execute([$groupeId, $utilisateurId]);
        if ($st->rowCount() === 0) {
            throw new Erreur('not_found', 'Ce membre ne fait pas partie du groupe');
        }
    }

    /** Électeurs du groupe : membres actifs, étudiants de sa promo (hors $sauf, la personne visée par un retrait). @return list<int> */
    public static function electeurs(\PDO $pdo, string $groupeId, ?int $sauf = null): array
    {
        $st = $pdo->prepare(
            "SELECT m.utilisateur_id FROM membres m JOIN groupes g ON g.id = m.groupe_id JOIN utilisateurs u ON u.id = m.utilisateur_id
             WHERE m.groupe_id = ? AND u.statut = 'actif'
               AND EXISTS (SELECT 1 FROM attributions a WHERE a.utilisateur_id = u.id AND a.role = 'etudiant' AND a.promo_id = g.promo_id)"
        );
        $st->execute([$groupeId]);
        $ids = array_map('intval', $st->fetchAll(\PDO::FETCH_COLUMN));
        return $sauf === null ? $ids : array_values(array_filter($ids, static fn (int $i): bool => $i !== $sauf));
    }

    /** Étudiantes actives de la promo qui n'ont encore aucun groupe dans cette promo. @return list<array<string,mixed>> */
    public static function candidats(\PDO $pdo, string $promoId): array
    {
        $st = $pdo->prepare(
            "SELECT u.id, u.pid, u.prenom, u.nom, u.pseudo FROM utilisateurs u
             JOIN attributions a ON a.utilisateur_id = u.id AND a.role = 'etudiant' AND a.promo_id = ?
             WHERE u.statut = 'actif'
               AND NOT EXISTS (SELECT 1 FROM membres m JOIN groupes g ON g.id = m.groupe_id WHERE m.utilisateur_id = u.id AND g.promo_id = ?)"
        );
        $st->execute([$promoId, $promoId]);
        return self::trier($st->fetchAll());
    }

    /** Formateurs actifs de l'établissement de la promo. @return list<array<string,mixed>> */
    public static function formateursDePromo(\PDO $pdo, string $etablissementId): array
    {
        $st = $pdo->prepare(
            "SELECT u.id, u.pid, u.prenom, u.nom, u.pseudo FROM utilisateurs u
             JOIN attributions a ON a.utilisateur_id = u.id AND a.role = 'formateur' AND a.etablissement_id = ?
             WHERE u.statut = 'actif'"
        );
        $st->execute([$etablissementId]);
        return self::trier($st->fetchAll());
    }

    /** Nom affiché d'une personne (« personne supprimée » si elle n'existe plus). */
    public static function nom(\PDO $pdo, ?int $utilisateurId): string
    {
        if ($utilisateurId === null) {
            return 'Utilisateur supprimé';
        }
        $st = $pdo->prepare('SELECT prenom, nom, pseudo FROM utilisateurs WHERE id = ?');
        $st->execute([$utilisateurId]);
        $r = $st->fetch();
        return $r === false ? 'Utilisateur supprimé' : self::affiche($r);
    }

    /** @param array<string,mixed> $r une ligne avec prenom, nom, pseudo */
    public static function affiche(array $r): string
    {
        return Utilisateur::nomAffiche((string) $r['prenom'], (string) $r['nom'], $r['pseudo'] === null ? null : (string) $r['pseudo']);
    }

    /**
     * @param list<array<string,mixed>> $lignes
     * @return list<array<string,mixed>> triées par nom affiché, avec la clé « affiche »
     */
    private static function trier(array $lignes): array
    {
        foreach ($lignes as &$l) {
            $l['affiche'] = self::affiche($l);
        }
        unset($l);
        usort($lignes, static fn (array $a, array $b): int => strcmp(mb_strtolower($a['affiche']), mb_strtolower($b['affiche'])));
        return $lignes;
    }

    /** @param list<mixed> $params */
    private static function existe(\PDO $pdo, string $sql, array $params): bool
    {
        $st = $pdo->prepare($sql);
        $st->execute($params);
        return $st->fetchColumn() !== false;
    }
}
