<?php
declare(strict_types=1);

namespace Lpc;

/**
 * Votes à la majorité simple des étudiantes d'un groupe : retrait d'un membre, changement de nom du groupe, arrivée d'une
 * étudiante qui demande à rejoindre, arrivée d'un formateur (demande ou invitation). Une proposition non tranchée expire
 * au bout de 7 jours ; une proposition refusée ne peut pas être refaite avant 14 jours.
 *
 * Adopté dès que « oui » dépasse la moitié des électrices ; refusé dès que la majorité n'est plus atteignable.
 */
final class Votes
{
    public const DUREE_S = 7 * 86400;
    public const BLOCAGE_S = 14 * 86400;
    public const TYPES_FORMATEUR = ['formateur_demande', 'formateur_invite'];

    public static function cloreExpires(\PDO $pdo): void
    {
        $pdo->prepare("UPDATE votes SET statut = 'expire', clos_le = ? WHERE statut = 'ouvert' AND cree_le <= ?")
            ->execute([Temps::maintenant(), Temps::depuis(-self::DUREE_S)]);
    }

    /**
     * @param list<int> $electeurs
     * @return array{oui:int,non:int,n:int,besoin:int,adopte:bool,refuse:bool,reponses:array<int,int>}
     */
    public static function etat(\PDO $pdo, string $voteId, array $electeurs): array
    {
        $st = $pdo->prepare('SELECT utilisateur_id, oui FROM vote_reponses WHERE vote_id = ?');
        $st->execute([$voteId]);
        $reponses = [];
        foreach ($st->fetchAll() as $r) {
            $reponses[(int) $r['utilisateur_id']] = (int) $r['oui'];
        }
        $oui = 0;
        $non = 0;
        foreach ($electeurs as $e) {
            if (($reponses[$e] ?? null) === 1) {
                $oui++;
            } elseif (($reponses[$e] ?? null) === 0) {
                $non++;
            }
        }
        $n = count($electeurs);
        $besoin = intdiv($n, 2) + 1;
        return ['oui' => $oui, 'non' => $non, 'n' => $n, 'besoin' => $besoin, 'adopte' => $n > 0 && $oui >= $besoin,
            'refuse' => $n > 0 && $non > $n - $besoin, 'reponses' => $reponses];
    }

    // ---------- Propositions ----------

    /** Proposition d'une étudiante du groupe : retrait d'un membre (pid), invitation d'un formateur (pid) ou nouveau nom. */
    public static function proposer(Contexte $c, string $groupeId, string $type, mixed $pid, mixed $nom): void
    {
        $pdo = $c->db->principale();
        $promo = Membres::exigerEtudiantMembre($c, $groupeId);
        self::cloreExpires($pdo);
        $moi = (int) $c->user->id;
        $cible = null;
        $valeur = null;

        if ($type === 'retrait') {
            $tous = Membres::electeurs($pdo, $groupeId);
            $cible = self::parPid($pdo, $tous, (string) $pid);
            if ($cible === null) {
                throw new Erreur('not_found', 'Membre introuvable');
            }
            if ($cible === $moi) {
                throw new Erreur('invalid', 'Vous ne pouvez pas proposer votre propre retrait');
            }
            if (count($tous) < 3) {
                throw new Erreur('invalid', 'À deux, le retrait ne peut pas être voté : contactez l’administrateur');
            }
            if (self::ouvertPour($pdo, $groupeId, 'retrait', $cible)) {
                throw new Erreur('invalid', 'Une proposition est déjà en cours pour ce membre');
            }
            if (self::refuseRecemment($pdo, $groupeId, 'retrait', $cible)) {
                throw new Erreur('invalid', 'Une proposition contre cette personne a été refusée récemment : réessayez dans quelques jours');
            }
        } elseif ($type === 'formateur_invite') {
            $etab = $c->droits()->etablissementDePromo($promo);
            $formateurs = $etab === null ? [] : array_map(static fn (array $f): int => (int) $f['id'], Membres::formateursDePromo($pdo, $etab));
            $cible = self::parPid($pdo, $formateurs, (string) $pid);
            if ($cible === null) {
                throw new Erreur('not_found', 'Formateur introuvable dans cette promo');
            }
            self::verifierRattachementPossible($pdo, $groupeId, $cible, 'Ce formateur fait déjà partie du groupe', 'Une proposition est déjà en cours pour ce formateur');
            if (self::refuseRecemment($pdo, $groupeId, 'formateur_invite', $cible)) {
                throw new Erreur('invalid', 'Une invitation de ce formateur a été refusée récemment : réessayez dans quelques jours');
            }
        } elseif ($type === 'nom') {
            $valeur = Valide::nom($nom, 'Nom');
            $st = $pdo->prepare('SELECT nom FROM groupes WHERE id = ?');
            $st->execute([$groupeId]);
            if (mb_strtolower((string) $st->fetchColumn()) === mb_strtolower($valeur)) {
                throw new Erreur('invalid', 'C’est déjà le nom du groupe');
            }
            self::verifierNomLibre($pdo, $promo, $valeur, $groupeId);
            if (self::ouvertPour($pdo, $groupeId, 'nom', null)) {
                throw new Erreur('invalid', 'Un changement de nom est déjà en cours de vote');
            }
            $st = $pdo->prepare("SELECT 1 FROM votes WHERE groupe_id = ? AND type = 'nom' AND statut = 'refuse' AND valeur = ? AND clos_le > ?");
            $st->execute([$groupeId, $valeur, Temps::depuis(-self::BLOCAGE_S)]);
            if ($st->fetchColumn() !== false) {
                throw new Erreur('invalid', 'Ce nom a été refusé récemment');
            }
        } else {
            throw new Erreur('invalid', 'Type de vote inconnu');
        }

        $id = Ids::uuid();
        $now = Temps::maintenant();
        $pdo->beginTransaction();
        try {
            $pdo->prepare('INSERT INTO votes (id, groupe_id, type, cible_id, valeur, propose_par, cree_le, statut) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
                ->execute([$id, $groupeId, $type, $cible, $valeur, $moi, $now, 'ouvert']);
            $pdo->prepare('INSERT INTO vote_reponses (vote_id, utilisateur_id, oui, repondu_le) VALUES (?, ?, 1, ?)')->execute([$id, $moi, $now]);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        self::evaluer($pdo, $id);
    }

    public static function repondre(Contexte $c, string $id, bool $oui): void
    {
        $pdo = $c->db->principale();
        self::cloreExpires($pdo);
        $v = self::vote($pdo, $id);
        if ($v === null) {
            throw new Erreur('not_found', 'Proposition introuvable');
        }
        if ($v['statut'] !== 'ouvert') {
            throw new Erreur('invalid', 'Cette proposition est close');
        }
        Membres::exigerEtudiantMembre($c, (string) $v['groupe_id']);
        $moi = (int) $c->user->id;
        $electeurs = Membres::electeurs($pdo, (string) $v['groupe_id'], $v['type'] === 'retrait' ? (int) $v['cible_id'] : null);
        if (!in_array($moi, $electeurs, true)) {
            throw new Erreur('forbidden', 'Vous ne participez pas à ce vote');
        }
        $pdo->beginTransaction();
        try {
            $pdo->prepare('DELETE FROM vote_reponses WHERE vote_id = ? AND utilisateur_id = ?')->execute([$id, $moi]);
            $pdo->prepare('INSERT INTO vote_reponses (vote_id, utilisateur_id, oui, repondu_le) VALUES (?, ?, ?, ?)')
                ->execute([$id, $moi, $oui ? 1 : 0, Temps::maintenant()]);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        self::evaluer($pdo, $id);
    }

    /** L'auteur d'une proposition l'annule ; un administrateur du groupe aussi. */
    public static function annuler(Contexte $c, string $id): void
    {
        $pdo = $c->db->principale();
        self::cloreExpires($pdo);
        $v = self::vote($pdo, $id);
        if ($v === null) {
            throw new Erreur('not_found', 'Proposition introuvable');
        }
        if ($v['statut'] !== 'ouvert') {
            throw new Erreur('invalid', 'Cette proposition est close');
        }
        if ((int) $v['propose_par'] !== $c->user->id && !$c->droits()->peutAdministrerGroupe((string) $v['groupe_id'])) {
            throw new Erreur('forbidden', 'Seul l’auteur de la proposition peut l’annuler');
        }
        $pdo->prepare("UPDATE votes SET statut = 'annule', clos_le = ? WHERE id = ?")->execute([Temps::maintenant(), $id]);
    }

    /** Une étudiante de la promo demande à rejoindre un groupe : les étudiantes du groupe votent. */
    public static function demanderAdhesion(Contexte $c, string $groupeId): void
    {
        $pdo = $c->db->principale();
        self::cloreExpires($pdo);
        $promo = $c->droits()->promoDeGroupe($groupeId);
        if ($promo === null) {
            throw new Erreur('not_found', 'Groupe introuvable');
        }
        $moi = (int) $c->user->id;
        if (!Membres::estEtudiantDe($pdo, $moi, $promo)) {
            throw new Erreur('forbidden', 'Vous n’êtes pas inscrite à cette promo');
        }
        if (Membres::dejaDansPromo($pdo, $moi, $promo)) {
            throw new Erreur('invalid', 'Vous êtes déjà dans un groupe de cette promo');
        }
        if (Membres::electeurs($pdo, $groupeId) === []) {
            throw new Erreur('invalid', 'Ce groupe n’a aucun membre étudiant');
        }
        $st = $pdo->prepare(
            "SELECT 1 FROM votes v JOIN groupes g ON g.id = v.groupe_id
             WHERE v.type = 'adhesion' AND v.cible_id = ? AND v.statut = 'ouvert' AND g.promo_id = ?"
        );
        $st->execute([$moi, $promo]);
        if ($st->fetchColumn() !== false) {
            throw new Erreur('invalid', 'Vous avez déjà une demande en cours dans cette promo : annulez-la d’abord');
        }
        if (self::refuseRecemment($pdo, $groupeId, 'adhesion', $moi)) {
            throw new Erreur('invalid', 'Ce groupe a refusé votre demande récemment : réessayez dans quelques jours');
        }
        self::inserer($pdo, $groupeId, 'adhesion', $moi, $moi);
    }

    /** Un formateur de l'établissement demande à rejoindre un groupe : les étudiantes du groupe votent. */
    public static function demanderRattachement(Contexte $c, string $groupeId): void
    {
        $pdo = $c->db->principale();
        self::cloreExpires($pdo);
        $promo = $c->droits()->promoDeGroupe($groupeId);
        if ($promo === null) {
            throw new Erreur('not_found', 'Groupe introuvable');
        }
        $etab = $c->droits()->etablissementDePromo($promo);
        if ($etab === null || !$c->droits()->estFormateurSur($etab)) {
            throw new Erreur('forbidden', 'Réservé aux formateurs de cet établissement');
        }
        $moi = (int) $c->user->id;
        if (Membres::electeurs($pdo, $groupeId) === []) {
            throw new Erreur('invalid', 'Ce groupe n’a aucun membre étudiant');
        }
        self::verifierRattachementPossible($pdo, $groupeId, $moi, 'Vous faites déjà partie de ce groupe', 'Une demande ou une invitation est déjà en cours pour ce groupe');
        if (self::refuseRecemment($pdo, $groupeId, 'formateur_demande', $moi)) {
            throw new Erreur('invalid', 'Ce groupe a refusé votre demande récemment : réessayez dans quelques jours');
        }
        self::inserer($pdo, $groupeId, 'formateur_demande', $moi, $moi);
    }

    /** Une étudiante inscrite à la promo et sans groupe crée le sien (un seul membre suffit). */
    public static function creerGroupeSoi(Contexte $c, mixed $promoId, mixed $nom): void
    {
        $pdo = $c->db->principale();
        self::cloreExpires($pdo);
        $promo = is_string($promoId) ? $promoId : '';
        if ($promo === '' || $c->droits()->etablissementDePromo($promo) === null) {
            throw new Erreur('not_found', 'Promo introuvable');
        }
        $moi = (int) $c->user->id;
        if (!Membres::estEtudiantDe($pdo, $moi, $promo)) {
            throw new Erreur('forbidden', 'Vous n’êtes pas inscrite à cette promo');
        }
        if (Membres::dejaDansPromo($pdo, $moi, $promo)) {
            throw new Erreur('invalid', 'Vous êtes déjà dans un groupe de cette promo');
        }
        $nom = Valide::nom($nom, 'Nom');
        self::verifierNomLibre($pdo, $promo, $nom, '');
        $id = Ids::uuid();
        $now = Temps::maintenant();
        $pdo->beginTransaction();
        try {
            $pdo->prepare('INSERT INTO groupes (id, promo_id, nom, cree_le, cree_par) VALUES (?, ?, ?, ?, ?)')->execute([$id, $promo, $nom, $now, $moi]);
            $pdo->prepare('INSERT INTO membres (groupe_id, utilisateur_id, ajoute_le) VALUES (?, ?, ?)')->execute([$id, $moi, $now]);
            $pdo->prepare(
                "UPDATE votes SET statut = 'annule', clos_le = ? WHERE type = 'adhesion' AND statut = 'ouvert' AND cible_id = ?
                 AND groupe_id IN (SELECT id FROM groupes WHERE promo_id = ?)"
            )->execute([$now, $moi, $promo]);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
    }

    // ---------- Sections renvoyées au client ----------

    /** Propositions ouvertes des groupes que la personne voit. @return list<array<string,mixed>> */
    public static function pourClient(Contexte $c): array
    {
        $u = $c->user;
        $ids = Donnees::idsGroupesVisibles($c);
        if ($u->id === null || $ids === []) {
            return [];
        }
        $pdo = $c->db->principale();
        $m = implode(',', array_fill(0, count($ids), '?'));
        $st = $pdo->prepare("SELECT id, groupe_id, type, cible_id, valeur, propose_par, cree_le FROM votes
                             WHERE statut = 'ouvert' AND cree_le > ? AND groupe_id IN ($m) ORDER BY cree_le");
        $st->execute([Temps::depuis(-self::DUREE_S), ...$ids]);
        $out = [];
        foreach ($st->fetchAll() as $v) {
            $retrait = $v['type'] === 'retrait';
            $cible = $v['cible_id'] === null ? null : (int) $v['cible_id'];
            $tous = Membres::electeurs($pdo, (string) $v['groupe_id']);
            if ($retrait && ($cible === null || !in_array($cible, $tous, true))) {
                continue;
            }
            $electeurs = $retrait ? Membres::electeurs($pdo, (string) $v['groupe_id'], $cible) : $tous;
            $etat = self::etat($pdo, (string) $v['id'], $electeurs);
            $avecCible = $retrait || $v['type'] === 'adhesion' || in_array($v['type'], self::TYPES_FORMATEUR, true);
            $pid = '';
            if ($retrait && $cible !== null) {
                $s = $pdo->prepare('SELECT pid FROM utilisateurs WHERE id = ?');
                $s->execute([$cible]);
                $pid = (string) $s->fetchColumn();
            }
            $out[] = [
                'id' => (string) $v['id'], 'groupe_id' => (string) $v['groupe_id'], 'type' => (string) $v['type'],
                'cible_pid' => $pid, 'cible' => $avecCible ? Membres::nom($pdo, $cible) : '', 'valeur' => (string) ($v['valeur'] ?? ''),
                'propose_par' => Membres::nom($pdo, $v['propose_par'] === null ? null : (int) $v['propose_par']),
                'expire_le' => Temps::iso(Temps::plus((string) $v['cree_le'], self::DUREE_S)),
                'oui' => $etat['oui'], 'non' => $etat['non'], 'n' => $etat['n'], 'besoin' => $etat['besoin'],
                'mon_vote' => $etat['reponses'][$u->id] ?? null,
                'peut_voter' => in_array($u->id, $electeurs, true),
                'proposant' => $v['propose_par'] !== null && (int) $v['propose_par'] === $u->id,
            ];
        }
        return $out;
    }

    /**
     * Pour une étudiante : chaque promo où elle est inscrite, avec son groupe, ou les groupes qu'elle peut demander à rejoindre.
     *
     * @return list<array<string,mixed>>
     */
    public static function promosMoi(Contexte $c): array
    {
        $u = $c->user;
        if ($u->id === null) {
            return [];
        }
        $pdo = $c->db->principale();
        $st = $pdo->prepare("SELECT DISTINCT a.promo_id FROM attributions a WHERE a.utilisateur_id = ? AND a.role = 'etudiant'");
        $st->execute([$u->id]);
        $promos = array_map('strval', $st->fetchAll(\PDO::FETCH_COLUMN));
        if ($promos === []) {
            return [];
        }
        $st = $pdo->prepare('SELECT DISTINCT g.promo_id FROM membres m JOIN groupes g ON g.id = m.groupe_id WHERE m.utilisateur_id = ?');
        $st->execute([$u->id]);
        $promos = array_values(array_unique(array_merge($promos, array_map('strval', $st->fetchAll(\PDO::FETCH_COLUMN)))));

        $out = [];
        foreach ($promos as $promoId) {
            $st = $pdo->prepare('SELECT p.nom AS promo, e.nom AS etab FROM promos p JOIN etablissements e ON e.id = p.etablissement_id WHERE p.id = ?');
            $st->execute([$promoId]);
            $p = $st->fetch();
            if ($p === false) {
                continue;
            }
            $st = $pdo->prepare('SELECT g.id FROM membres m JOIN groupes g ON g.id = m.groupe_id WHERE m.utilisateur_id = ? AND g.promo_id = ? LIMIT 1');
            $st->execute([$u->id, $promoId]);
            $mien = $st->fetchColumn();
            $liste = [];
            if ($mien === false) {
                $st = $pdo->prepare('SELECT id, nom FROM groupes WHERE promo_id = ?');
                $st->execute([$promoId]);
                foreach ($st->fetchAll() as $g) {
                    $electeurs = Membres::electeurs($pdo, (string) $g['id']);
                    $demande = null;
                    $s = $pdo->prepare("SELECT id, cree_le FROM votes WHERE groupe_id = ? AND type = 'adhesion' AND cible_id = ? AND statut = 'ouvert' AND cree_le > ? LIMIT 1");
                    $s->execute([$g['id'], $u->id, Temps::depuis(-self::DUREE_S)]);
                    $ouvert = $s->fetch();
                    if ($ouvert !== false) {
                        $demande = self::resume($pdo, $ouvert, $electeurs);
                    }
                    $liste[] = ['id' => (string) $g['id'], 'nom' => (string) $g['nom'], 'demande' => $demande,
                        'bloque' => self::refuseRecemment($pdo, (string) $g['id'], 'adhesion', $u->id),
                        'membres' => self::membresPourClient($pdo, $electeurs)];
                }
                usort($liste, static fn (array $a, array $b): int => strcmp(mb_strtolower($a['nom']), mb_strtolower($b['nom'])));
            }
            $out[] = ['id' => (string) $promoId, 'nom' => (string) $p['promo'], 'etablissement' => (string) $p['etab'],
                'mon_groupe_id' => $mien === false ? '' : (string) $mien, 'groupes' => $liste];
        }
        usort($out, static fn (array $a, array $b): int => strcmp(mb_strtolower($a['etablissement'] . $a['nom']), mb_strtolower($b['etablissement'] . $b['nom'])));
        return $out;
    }

    /**
     * Pour un formateur : les groupes des promos de son établissement, avec son appartenance, sa demande ouverte et l'invitation reçue.
     *
     * @return list<array<string,mixed>>
     */
    public static function rattachements(Contexte $c): array
    {
        $u = $c->user;
        if ($u->id === null) {
            return [];
        }
        $pdo = $c->db->principale();
        $st = $pdo->prepare("SELECT DISTINCT etablissement_id FROM attributions WHERE utilisateur_id = ? AND role = 'formateur'");
        $st->execute([$u->id]);
        $etabs = array_map('strval', $st->fetchAll(\PDO::FETCH_COLUMN));
        if ($etabs === []) {
            return [];
        }
        $m = implode(',', array_fill(0, count($etabs), '?'));
        $st = $pdo->prepare(
            "SELECT g.id, g.nom, p.id AS promo_id, p.nom AS promo, e.nom AS etab FROM groupes g
             JOIN promos p ON p.id = g.promo_id JOIN etablissements e ON e.id = p.etablissement_id WHERE p.etablissement_id IN ($m)"
        );
        $st->execute($etabs);
        $parPromo = [];
        foreach ($st->fetchAll() as $g) {
            $electeurs = Membres::electeurs($pdo, (string) $g['id']);
            $ouvert = static function (string $type) use ($pdo, $g, $u, $electeurs): ?array {
                $s = $pdo->prepare('SELECT id, cree_le FROM votes WHERE groupe_id = ? AND type = ? AND cible_id = ? AND statut = \'ouvert\' AND cree_le > ? LIMIT 1');
                $s->execute([$g['id'], $type, $u->id, Temps::depuis(-self::DUREE_S)]);
                $v = $s->fetch();
                return $v === false ? null : self::resume($pdo, $v, $electeurs);
            };
            $cle = (string) $g['promo_id'];
            $parPromo[$cle]['titre'] = $g['etab'] . ' · ' . $g['promo'];
            $parPromo[$cle]['groupes'][] = [
                'id' => (string) $g['id'], 'nom' => (string) $g['nom'], 'membre' => Membres::estMembre($pdo, (string) $g['id'], $u->id),
                'demande' => $ouvert('formateur_demande'), 'invitation' => $ouvert('formateur_invite'),
                'bloque' => self::refuseRecemment($pdo, (string) $g['id'], 'formateur_demande', $u->id),
                'membres' => self::membresPourClient($pdo, $electeurs),
            ];
        }
        $out = [];
        foreach ($parPromo as $p) {
            usort($p['groupes'], static fn (array $a, array $b): int => strcmp(mb_strtolower($a['nom']), mb_strtolower($b['nom'])));
            $out[] = $p;
        }
        usort($out, static fn (array $a, array $b): int => strcmp(mb_strtolower($a['titre']), mb_strtolower($b['titre'])));
        return $out;
    }

    // ---------- Interne ----------

    /** Tranche si la majorité est acquise (ou ne peut plus l'être) et applique le résultat. */
    public static function evaluer(\PDO $pdo, string $id): void
    {
        $v = self::vote($pdo, $id);
        if ($v === null || $v['statut'] !== 'ouvert') {
            return;
        }
        $groupe = (string) $v['groupe_id'];
        $cible = $v['cible_id'] === null ? null : (int) $v['cible_id'];
        $retrait = $v['type'] === 'retrait';
        $etat = self::etat($pdo, $id, Membres::electeurs($pdo, $groupe, $retrait ? $cible : null));
        if (!$etat['adopte'] && !$etat['refuse']) {
            return;
        }
        $statut = $etat['adopte'] ? 'adopte' : 'refuse';
        if ($etat['adopte']) {
            try {
                $st = $pdo->prepare('SELECT promo_id FROM groupes WHERE id = ?');
                $st->execute([$groupe]);
                $promo = (string) $st->fetchColumn();
                if ($v['type'] === 'adhesion' || in_array($v['type'], self::TYPES_FORMATEUR, true)) {
                    if ($cible === null) {
                        throw new Erreur('invalid', 'candidat introuvable');
                    }
                    $s = $pdo->prepare("SELECT 1 FROM utilisateurs WHERE id = ? AND statut = 'actif'");
                    $s->execute([$cible]);
                    if ($s->fetchColumn() === false) {
                        throw new Erreur('invalid', 'candidat introuvable');
                    }
                    Membres::ajouter($pdo, $groupe, $promo, $cible);
                } elseif ($retrait) {
                    if ($cible === null || count(Membres::electeurs($pdo, $groupe)) < 2) {
                        throw new Erreur('invalid', 'dernier étudiant');   // on ne vide jamais un groupe de ses étudiantes
                    }
                    Membres::retirer($pdo, $groupe, $cible);
                } else {
                    self::verifierNomLibre($pdo, $promo, (string) $v['valeur'], $groupe);
                    $pdo->prepare('UPDATE groupes SET nom = ? WHERE id = ?')->execute([$v['valeur'], $groupe]);
                }
            } catch (Erreur $e) {
                $statut = 'annule';
            }
        }
        $pdo->prepare('UPDATE votes SET statut = ?, clos_le = ? WHERE id = ?')->execute([$statut, Temps::maintenant(), $id]);
    }

    /** @return array<string,mixed>|null */
    private static function vote(\PDO $pdo, string $id): ?array
    {
        $st = $pdo->prepare('SELECT id, groupe_id, type, cible_id, valeur, propose_par, cree_le, statut, clos_le FROM votes WHERE id = ?');
        $st->execute([$id]);
        $v = $st->fetch();
        return $v === false ? null : $v;
    }

    private static function inserer(\PDO $pdo, string $groupeId, string $type, int $cible, int $proposePar): void
    {
        $pdo->prepare('INSERT INTO votes (id, groupe_id, type, cible_id, propose_par, cree_le, statut) VALUES (?, ?, ?, ?, ?, ?, ?)')
            ->execute([Ids::uuid(), $groupeId, $type, $cible, $proposePar, Temps::maintenant(), 'ouvert']);
    }

    /** @param list<int> $ids */
    private static function parPid(\PDO $pdo, array $ids, string $pid): ?int
    {
        if ($ids === []) {
            return null;
        }
        $m = implode(',', array_fill(0, count($ids), '?'));
        $st = $pdo->prepare("SELECT id FROM utilisateurs WHERE pid = ? AND id IN ($m)");
        $st->execute([$pid, ...$ids]);
        $id = $st->fetchColumn();
        return $id === false ? null : (int) $id;
    }

    private static function ouvertPour(\PDO $pdo, string $groupeId, string $type, ?int $cible): bool
    {
        $sql = "SELECT 1 FROM votes WHERE groupe_id = ? AND type = ? AND statut = 'ouvert' AND cree_le > ?" . ($cible === null ? ' AND cible_id IS NULL' : ' AND cible_id = ?');
        $params = [$groupeId, $type, Temps::depuis(-self::DUREE_S)];
        if ($cible !== null) {
            $params[] = $cible;
        }
        $st = $pdo->prepare($sql);
        $st->execute($params);
        return $st->fetchColumn() !== false;
    }

    private static function refuseRecemment(\PDO $pdo, string $groupeId, string $type, int $cible): bool
    {
        $st = $pdo->prepare("SELECT 1 FROM votes WHERE groupe_id = ? AND type = ? AND cible_id = ? AND statut = 'refuse' AND clos_le > ?");
        $st->execute([$groupeId, $type, $cible, Temps::depuis(-self::BLOCAGE_S)]);
        return $st->fetchColumn() !== false;
    }

    /** Refuse si le formateur est déjà dans le groupe, ou si une demande ou invitation est déjà ouverte pour lui. */
    private static function verifierRattachementPossible(\PDO $pdo, string $groupeId, int $formateur, string $msgMembre, string $msgOuvert): void
    {
        if (Membres::estMembre($pdo, $groupeId, $formateur)) {
            throw new Erreur('invalid', $msgMembre);
        }
        $st = $pdo->prepare("SELECT 1 FROM votes WHERE groupe_id = ? AND cible_id = ? AND type IN ('formateur_demande','formateur_invite') AND statut = 'ouvert' AND cree_le > ?");
        $st->execute([$groupeId, $formateur, Temps::depuis(-self::DUREE_S)]);
        if ($st->fetchColumn() !== false) {
            throw new Erreur('invalid', $msgOuvert);
        }
    }

    private static function verifierNomLibre(\PDO $pdo, string $promo, string $nom, string $sauf): void
    {
        $st = $pdo->prepare('SELECT 1 FROM groupes WHERE promo_id = ? AND nom = ? AND id <> ?');
        $st->execute([$promo, $nom, $sauf]);
        if ($st->fetchColumn() !== false) {
            throw new Erreur('invalid', 'Ce nom est déjà pris dans cette promo');
        }
    }

    /**
     * @param array<string,mixed> $vote
     * @param list<int> $electeurs
     * @return array<string,mixed>
     */
    private static function resume(\PDO $pdo, array $vote, array $electeurs): array
    {
        $etat = self::etat($pdo, (string) $vote['id'], $electeurs);
        return ['id' => (string) $vote['id'], 'oui' => $etat['oui'], 'non' => $etat['non'], 'n' => $etat['n'], 'besoin' => $etat['besoin'],
            'expire_le' => Temps::iso(Temps::plus((string) $vote['cree_le'], self::DUREE_S))];
    }

    /** @param list<int> $ids @return list<array{prenom:string,couleur:string}> */
    private static function membresPourClient(\PDO $pdo, array $ids): array
    {
        if ($ids === []) {
            return [];
        }
        $m = implode(',', array_fill(0, count($ids), '?'));
        $st = $pdo->prepare("SELECT prenom, nom, pseudo, couleur FROM utilisateurs WHERE id IN ($m)");
        $st->execute($ids);
        $out = [];
        foreach ($st->fetchAll() as $r) {
            $out[] = ['prenom' => Membres::affiche($r), 'couleur' => (string) $r['couleur']];
        }
        return $out;
    }
}
