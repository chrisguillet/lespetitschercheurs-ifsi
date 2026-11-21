<?php
declare(strict_types=1);

namespace Lpc;

/**
 * Commentaires des étudiantes et des formateurs sur une fiche. Deux fils indépendants par fiche :
 *  - « groupe » : réservé aux membres du groupe de la fiche ;
 *  - « promo »  : ouvert aux membres de la promo, seulement si la fiche est partagée avec elle.
 * Un commentaire d'une personne supprimée est conservé, sous un nom neutre.
 */
final class Commentaires
{
    public const TEXTE_MAX = 2000;

    /** @return list<array<string,mixed>> */
    public static function lister(Contexte $c): array
    {
        if ($c->user->id === null) {
            return [];
        }
        [$where, $params] = Lectures::filtreVisible($c);
        $gids = Donnees::idsGroupesVisibles($c);
        if ($c->droits()->estAdmin()) {
            $groupeCond = '1 = 1';
        } elseif ($gids !== []) {
            $groupeCond = 'a.groupe_id IN (' . Lectures::marques(count($gids)) . ')';
            array_push($params, ...$gids);
        } else {
            $groupeCond = '1 = 0';
        }
        $st = $c->db->principale()->prepare(
            "SELECT k.id, k.analyse_id, k.texte, k.cree_le, k.modifie_le, k.portee, k.auteur_id, gk.nom AS groupe, u.prenom, u.nom, u.pseudo
             FROM commentaires k JOIN analyses a ON a.id = k.analyse_id JOIN groupes g ON g.id = a.groupe_id
             LEFT JOIN groupes gk ON gk.id = k.groupe_id LEFT JOIN utilisateurs u ON u.id = k.auteur_id
             WHERE $where AND ((k.portee = 'promo' AND a.portee = 'promo') OR (k.portee = 'groupe' AND $groupeCond))
             ORDER BY k.cree_le, k.id"
        );
        $st->execute($params);
        $out = [];
        foreach ($st->fetchAll() as $r) {
            $out[] = [
                'id' => (string) $r['id'], 'lecture_id' => (string) $r['analyse_id'],
                'auteur' => $r['prenom'] === null ? 'Utilisateur supprimé' : Membres::affiche($r),
                'date' => Temps::iso((string) $r['cree_le']), 'modifie_le' => Temps::iso($r['modifie_le'] === null ? null : (string) $r['modifie_le']),
                'texte' => (string) $r['texte'], 'mine' => $r['auteur_id'] !== null && (int) $r['auteur_id'] === $c->user->id,
                'portee' => $r['portee'] === 'promo' ? 'promo' : 'groupe', 'groupe' => (string) ($r['groupe'] ?? ''),
            ];
        }
        return $out;
    }

    public static function ajouter(Contexte $c, string $lectureId, mixed $texte, mixed $portee): string
    {
        self::exigerCommentateur($c);
        $t = self::texte($texte);
        $pdo = $c->db->principale();
        $st = $pdo->prepare('SELECT a.id, a.groupe_id, a.portee, g.promo_id FROM analyses a JOIN groupes g ON g.id = a.groupe_id WHERE a.id = ?');
        $st->execute([$lectureId]);
        $a = $st->fetch();
        if ($a === false) {
            throw new Erreur('not_found', 'Lecture introuvable');
        }
        $uid = (int) $c->user->id;
        $fil = $portee === 'promo' ? 'promo' : 'groupe';
        $gid = (string) $a['groupe_id'];
        if ($fil === 'groupe') {
            if (!Membres::estMembre($pdo, $gid, $uid)) {
                throw new Erreur('forbidden', 'Ce fil est réservé aux membres du groupe');
            }
        } else {
            if ($a['portee'] !== 'promo') {
                throw new Erreur('forbidden', 'Cette fiche de lecture n’est pas partagée avec la promo');
            }
            $s = $pdo->prepare('SELECT g.id FROM membres m JOIN groupes g ON g.id = m.groupe_id WHERE m.utilisateur_id = ? AND g.promo_id = ? LIMIT 1');
            $s->execute([$uid, $a['promo_id']]);
            $mien = $s->fetchColumn();
            if ($mien === false) {
                throw new Erreur('forbidden', 'Réservé aux membres de la promo');
            }
            $gid = (string) $mien;
        }
        $id = Ids::uuid();
        $pdo->prepare('INSERT INTO commentaires (id, analyse_id, auteur_id, texte, cree_le, portee, groupe_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
            ->execute([$id, $lectureId, $uid, $t, Temps::maintenant(), $fil, $gid]);
        return $id;
    }

    public static function modifier(Contexte $c, string $id, mixed $texte): void
    {
        self::exigerCommentateur($c);
        $pdo = $c->db->principale();
        $k = self::commentaire($pdo, $id);
        if ($k['auteur_id'] === null || (int) $k['auteur_id'] !== $c->user->id) {
            throw new Erreur('not_owner', 'Vous ne pouvez modifier que vos commentaires');
        }
        $pdo->prepare('UPDATE commentaires SET texte = ?, modifie_le = ? WHERE id = ?')->execute([self::texte($texte), Temps::maintenant(), $id]);
    }

    /**
     * Suppression par l'autrice ; modération : les étudiantes du groupe sur le fil du groupe, les administrateurs du groupe sur les deux
     * fils (le fil de la promo n'est pas modéré par les étudiantes).
     */
    public static function supprimer(Contexte $c, string $id): void
    {
        $pdo = $c->db->principale();
        $k = self::commentaire($pdo, $id);
        $st = $pdo->prepare('SELECT groupe_id FROM analyses WHERE id = ?');
        $st->execute([$k['analyse_id']]);
        $gid = $st->fetchColumn();
        $auteur = $k['auteur_id'] !== null && (int) $k['auteur_id'] === $c->user->id && Lectures::peutCommenter($c);
        $modere = $k['portee'] !== 'promo' && $gid !== false && $c->droits()->estEtudiant() && Membres::estMembre($pdo, (string) $gid, (int) $c->user->id);
        $admin = $gid !== false && $c->droits()->peutAdministrerGroupe((string) $gid);
        if (!$auteur && !$modere && !$admin) {
            throw new Erreur('forbidden', 'Suppression non autorisée');
        }
        $pdo->prepare('DELETE FROM commentaires WHERE id = ?')->execute([$id]);
    }

    /** Commentaires que la personne a marqués comme lus. @return list<string> */
    public static function lus(Contexte $c): array
    {
        if ($c->user->id === null) {
            return [];
        }
        $st = $c->db->principale()->prepare('SELECT commentaire_id FROM commentaires_lus WHERE utilisateur_id = ? ORDER BY commentaire_id');
        $st->execute([$c->user->id]);
        return array_map('strval', $st->fetchAll(\PDO::FETCH_COLUMN));
    }

    /** ids : commentaires à marquer lus ; tous : marque tout ce qui existe. Les identifiants inconnus sont ignorés. */
    public static function marquerLus(Contexte $c, mixed $ids, bool $tous): void
    {
        $pdo = $c->db->principale();
        if ($tous) {
            $pdo->prepare('INSERT IGNORE INTO commentaires_lus (utilisateur_id, commentaire_id) SELECT ?, id FROM commentaires')->execute([$c->user->id]);
            return;
        }
        foreach (self::liste($ids) as $id) {
            $pdo->prepare('INSERT IGNORE INTO commentaires_lus (utilisateur_id, commentaire_id) SELECT ?, id FROM commentaires WHERE id = ?')->execute([$c->user->id, $id]);
        }
    }

    public static function marquerNonLus(Contexte $c, mixed $ids): void
    {
        $liste = self::liste($ids);
        if ($liste === []) {
            return;
        }
        $c->db->principale()->prepare('DELETE FROM commentaires_lus WHERE utilisateur_id = ? AND commentaire_id IN (' . Lectures::marques(count($liste)) . ')')
            ->execute([$c->user->id, ...$liste]);
    }

    // ---------- Interne ----------

    /** @return list<string> au plus 5000 identifiants, sans doublon */
    private static function liste(mixed $ids): array
    {
        if (!is_array($ids)) {
            return [];
        }
        return array_slice(array_values(array_unique(array_map('strval', array_filter($ids, 'is_scalar')))), 0, 5000);
    }

    private static function exigerCommentateur(Contexte $c): void
    {
        if (!Lectures::peutCommenter($c)) {
            throw new Erreur('forbidden', 'Réservé aux étudiantes et aux formateurs');
        }
    }

    /** @return array<string,mixed> */
    private static function commentaire(\PDO $pdo, string $id): array
    {
        $st = $pdo->prepare('SELECT id, analyse_id, auteur_id, portee FROM commentaires WHERE id = ?');
        $st->execute([$id]);
        $k = $st->fetch();
        if ($k === false) {
            throw new Erreur('not_found', 'Commentaire introuvable');
        }
        return $k;
    }

    private static function texte(mixed $texte): string
    {
        $t = is_scalar($texte) ? trim((string) $texte) : '';
        if ($t === '') {
            throw new Erreur('invalid', 'Commentaire vide');
        }
        if (mb_strlen($t) > self::TEXTE_MAX) {
            throw new Erreur('invalid', 'Commentaire trop long (' . self::TEXTE_MAX . ' caractères maximum)');
        }
        return $t;
    }
}
