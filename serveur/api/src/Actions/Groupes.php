<?php
declare(strict_types=1);

namespace Lpc\Actions;

use Lpc\Contexte;
use Lpc\Donnees;
use Lpc\Erreur;
use Lpc\Membres;
use Lpc\Valide;
use Lpc\Votes;

/**
 * Vie des groupes : ajout et retrait de membres, votes à la majorité, demandes d'adhésion, rattachement des formateurs.
 * Un administrateur de la promo (ou de l'établissement, ou global) décide directement ; une étudiante du groupe passe par le vote
 * quand la décision touche une autre personne. Les paramètres de ces actions sont à la racine de la requête, comme avant.
 */
final class Groupes
{
    /**
     * Ajoute un membre : un administrateur du groupe par adresse ou identifiant public ; une étudiante du groupe, une étudiante
     * de la promo sans groupe, par identifiant public.
     *
     * @param array<string,mixed> $req
     * @return array<string,mixed>
     */
    public static function memberAdd(Contexte $c, array $req): array
    {
        $gid = self::groupe($req);
        $d = $c->droits();
        $promo = $d->promoDeGroupe($gid);
        if ($promo === null) {
            throw new Erreur('not_found', 'Groupe introuvable');
        }
        $admin = $d->peutAdministrerGroupe($gid);
        if (!$admin) {
            Membres::exigerEtudiantMembre($c, $gid);
        }
        $pdo = $c->db->principale();
        $email = strtolower(Valide::espaces($req['email'] ?? ''));
        if ($admin && $email !== '') {
            $st = $pdo->prepare("SELECT id FROM utilisateurs WHERE email = ? AND statut = 'actif'");
            $st->execute([$email]);
        } else {
            $st = $pdo->prepare("SELECT id FROM utilisateurs WHERE pid = ? AND statut = 'actif'");
            $st->execute([(string) ($req['pid'] ?? '')]);
        }
        $cible = $st->fetchColumn();
        if ($cible === false) {
            throw new Erreur('not_found', 'Personne introuvable');
        }
        $cible = (int) $cible;
        if (!$admin && !Membres::estEtudiantDe($pdo, $cible, $promo)) {
            throw new Erreur('forbidden', 'Seul l’administrateur rattache un formateur');
        }
        Membres::ajouter($pdo, $gid, $promo, $cible);
        return self::reponse($c, true);
    }

    /** Retire un membre (administrateur du groupe). @param array<string,mixed> $req @return array<string,mixed> */
    public static function memberRemove(Contexte $c, array $req): array
    {
        $gid = self::groupe($req);
        if ($c->droits()->promoDeGroupe($gid) === null) {
            throw new Erreur('not_found', 'Groupe introuvable');
        }
        if (!$c->droits()->peutAdministrerGroupe($gid)) {
            throw new Erreur('forbidden', 'Réservé à un administrateur de ce groupe');
        }
        $pdo = $c->db->principale();
        $st = $pdo->prepare('SELECT id FROM utilisateurs WHERE email = ?');
        $st->execute([strtolower(Valide::espaces($req['email'] ?? ''))]);
        $uid = $st->fetchColumn();
        if ($uid === false) {
            throw new Erreur('not_found', 'Ce membre ne fait pas partie du groupe');
        }
        Membres::retirer($pdo, $gid, (int) $uid);
        return self::reponse($c, true);
    }

    /**
     * Étudiantes de la promo sans groupe, que les membres peuvent rattacher.
     *
     * @param array<string,mixed> $req
     * @return array<string,mixed>
     */
    public static function memberCandidates(Contexte $c, array $req): array
    {
        $gid = self::groupe($req);
        $promo = self::promoAutorisee($c, $gid);
        $out = [];
        foreach (Membres::candidats($c->db->principale(), $promo) as $r) {
            $out[] = ['pid' => (string) $r['pid'], 'prenom' => (string) $r['affiche']];
        }
        return ['ok' => true, 'candidats' => $out];
    }

    /**
     * Formateurs de l'établissement que les étudiantes du groupe peuvent inviter (ni déjà membres, ni proposition ouverte).
     *
     * @param array<string,mixed> $req
     * @return array<string,mixed>
     */
    public static function formateurCandidates(Contexte $c, array $req): array
    {
        $gid = self::groupe($req);
        $promo = self::promoAutorisee($c, $gid);
        $pdo = $c->db->principale();
        Votes::cloreExpires($pdo);
        $etab = $c->droits()->etablissementDePromo($promo);
        $out = [];
        foreach ($etab === null ? [] : Membres::formateursDePromo($pdo, $etab) as $f) {
            $uid = (int) $f['id'];
            $st = $pdo->prepare("SELECT 1 FROM votes WHERE groupe_id = ? AND cible_id = ? AND type IN ('formateur_demande','formateur_invite') AND statut = 'ouvert'");
            $st->execute([$gid, $uid]);
            if (Membres::estMembre($pdo, $gid, $uid) || $st->fetchColumn() !== false) {
                continue;
            }
            $out[] = ['pid' => (string) $f['pid'], 'prenom' => (string) $f['affiche']];
        }
        return ['ok' => true, 'candidats' => $out];
    }

    /** @param array<string,mixed> $req @return array<string,mixed> */
    public static function formateurRequest(Contexte $c, array $req): array
    {
        Votes::demanderRattachement($c, self::groupe($req));
        return self::reponse($c, false);
    }

    /** @param array<string,mixed> $req @return array<string,mixed> */
    public static function votePropose(Contexte $c, array $req): array
    {
        Votes::proposer($c, self::groupe($req), (string) ($req['type'] ?? ''), $req['pid'] ?? '', $req['nom'] ?? null);
        return self::reponse($c, false);
    }

    /** @param array<string,mixed> $req @return array<string,mixed> */
    public static function voteAnswer(Contexte $c, array $req): array
    {
        Votes::repondre($c, (string) ($req['id'] ?? ''), ($req['oui'] ?? null) === true);
        return self::reponse($c, false);
    }

    /** @param array<string,mixed> $req @return array<string,mixed> */
    public static function voteCancel(Contexte $c, array $req): array
    {
        Votes::annuler($c, (string) ($req['id'] ?? ''));
        return self::reponse($c, false);
    }

    /** @param array<string,mixed> $req @return array<string,mixed> */
    public static function joinRequest(Contexte $c, array $req): array
    {
        Votes::demanderAdhesion($c, self::groupe($req));
        return self::reponse($c, false);
    }

    /** @param array<string,mixed> $req @return array<string,mixed> */
    public static function groupCreateSelf(Contexte $c, array $req): array
    {
        Votes::creerGroupeSoi($c, $req['promo_id'] ?? null, $req['nom'] ?? null);
        return self::reponse($c, false);
    }

    // ---------- Interne ----------

    /** @param array<string,mixed> $req */
    private static function groupe(array $req): string
    {
        return is_string($req['groupe_id'] ?? null) ? $req['groupe_id'] : '';
    }

    /** Promo du groupe, si la personne en est membre étudiante ou administre le groupe. */
    private static function promoAutorisee(Contexte $c, string $gid): string
    {
        $promo = $c->droits()->promoDeGroupe($gid);
        if ($promo === null) {
            throw new Erreur('not_found', 'Groupe introuvable');
        }
        if ($c->droits()->peutAdministrerGroupe($gid)) {
            return $promo;
        }
        return Membres::exigerEtudiantMembre($c, $gid);
    }

    /** @return array<string,mixed> */
    private static function reponse(Contexte $c, bool $avecAdmin): array
    {
        return array_merge(['ok' => true], Donnees::toutes($c), $avecAdmin ? Donnees::admin($c) : []);
    }
}
