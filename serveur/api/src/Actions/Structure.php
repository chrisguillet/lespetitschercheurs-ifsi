<?php
declare(strict_types=1);

namespace Lpc\Actions;

use Lpc\Contexte;
use Lpc\Donnees;
use Lpc\Erreur;
use Lpc\Ids;
use Lpc\Temps;
use Lpc\Valide;

/**
 * Structure : établissement (= site) > promo > groupe. Droits par périmètre :
 *  - créer ou supprimer un établissement : admin ;
 *  - renommer un établissement, créer / renommer / supprimer une promo : admin, ou admin de ce site ;
 *  - créer / modifier / supprimer un groupe : admin, admin du site ou admin de la promo.
 */
final class Structure
{
    // ---------- Établissements ----------

    /** @param array<string,mixed> $req @return array<string,mixed> */
    public static function etabCreate(Contexte $c, array $req): array
    {
        if (!$c->droits()->estAdmin()) {
            throw new Erreur('forbidden', 'Réservé à l’administrateur');
        }
        $nom = Valide::nom(Valide::donnees($req)['nom'] ?? null, 'Établissement');
        $pdo = $c->db->principale();
        if (self::existe($pdo, 'SELECT 1 FROM etablissements WHERE nom = ?', [$nom])) {
            throw new Erreur('invalid', 'Cet établissement existe déjà');
        }
        $pdo->prepare('INSERT INTO etablissements (id, nom, cree_le) VALUES (?, ?, ?)')->execute([Ids::uuid(), $nom, Temps::maintenant()]);
        return self::reponse($c);
    }

    /** @param array<string,mixed> $req @return array<string,mixed> */
    public static function etabRename(Contexte $c, array $req): array
    {
        $data = Valide::donnees($req);
        $id = self::etablissement($c, $data['id'] ?? null);
        if (!$c->droits()->peutAdministrerEtablissement($id)) {
            throw new Erreur('forbidden', 'Réservé à un administrateur de cet établissement');
        }
        $nom = Valide::nom($data['nom'] ?? null, 'Établissement');
        $pdo = $c->db->principale();
        if (self::existe($pdo, 'SELECT 1 FROM etablissements WHERE nom = ? AND id <> ?', [$nom, $id])) {
            throw new Erreur('invalid', 'Cet établissement existe déjà');
        }
        $pdo->prepare('UPDATE etablissements SET nom = ? WHERE id = ?')->execute([$nom, $id]);
        return self::reponse($c);
    }

    /** @param array<string,mixed> $req @return array<string,mixed> */
    public static function etabDelete(Contexte $c, array $req): array
    {
        if (!$c->droits()->estAdmin()) {
            throw new Erreur('forbidden', 'Réservé à l’administrateur');
        }
        $id = self::etablissement($c, $req['id'] ?? null);
        $pdo = $c->db->principale();
        if (self::existe($pdo, 'SELECT 1 FROM promos WHERE etablissement_id = ?', [$id])) {
            throw new Erreur('invalid', 'Supprimez d’abord les promos de cet établissement');
        }
        $pdo->prepare('DELETE FROM etablissements WHERE id = ?')->execute([$id]);
        return self::reponse($c);
    }

    // ---------- Promos ----------

    /** @param array<string,mixed> $req @return array<string,mixed> */
    public static function promoCreate(Contexte $c, array $req): array
    {
        $data = Valide::donnees($req);
        $etab = self::etablissement($c, $data['etablissement_id'] ?? null);
        if (!$c->droits()->peutAdministrerEtablissement($etab)) {
            throw new Erreur('forbidden', 'Réservé à un administrateur de cet établissement');
        }
        $nom = Valide::nom($data['nom'] ?? null, 'Promo');
        $pdo = $c->db->principale();
        if (self::existe($pdo, 'SELECT 1 FROM promos WHERE etablissement_id = ? AND nom = ?', [$etab, $nom])) {
            throw new Erreur('invalid', 'Cette promo existe déjà dans cet établissement');
        }
        $pdo->prepare('INSERT INTO promos (id, etablissement_id, nom, cree_le) VALUES (?, ?, ?, ?)')
            ->execute([Ids::uuid(), $etab, $nom, Temps::maintenant()]);
        return self::reponse($c);
    }

    /** @param array<string,mixed> $req @return array<string,mixed> */
    public static function promoRename(Contexte $c, array $req): array
    {
        $data = Valide::donnees($req);
        [$promo, $etab] = self::promo($c, $data['id'] ?? null);
        if (!$c->droits()->peutAdministrerEtablissement($etab)) {
            throw new Erreur('forbidden', 'Réservé à un administrateur de cet établissement');
        }
        $nom = Valide::nom($data['nom'] ?? null, 'Promo');
        $pdo = $c->db->principale();
        if (self::existe($pdo, 'SELECT 1 FROM promos WHERE etablissement_id = ? AND nom = ? AND id <> ?', [$etab, $nom, $promo])) {
            throw new Erreur('invalid', 'Cette promo existe déjà dans cet établissement');
        }
        $pdo->prepare('UPDATE promos SET nom = ? WHERE id = ?')->execute([$nom, $promo]);
        return self::reponse($c);
    }

    /** @param array<string,mixed> $req @return array<string,mixed> */
    public static function promoDelete(Contexte $c, array $req): array
    {
        [$promo, $etab] = self::promo($c, $req['id'] ?? null);
        if (!$c->droits()->peutAdministrerEtablissement($etab)) {
            throw new Erreur('forbidden', 'Réservé à un administrateur de cet établissement');
        }
        $pdo = $c->db->principale();
        if (self::existe($pdo, 'SELECT 1 FROM groupes WHERE promo_id = ?', [$promo])) {
            throw new Erreur('invalid', 'Supprimez d’abord les groupes de cette promo');
        }
        $pdo->prepare('DELETE FROM promos WHERE id = ?')->execute([$promo]);   // les rôles et invitations de la promo suivent (CASCADE)
        return self::reponse($c);
    }

    // ---------- Groupes ----------

    /**
     * Création d'un groupe dans une promo existante (promo_id) ; l'admin peut aussi donner les noms d'établissement et de promo,
     * créés au besoin. Les membres sont désignés par leur adresse.
     *
     * @param array<string,mixed> $req
     * @return array<string,mixed>
     */
    public static function groupCreate(Contexte $c, array $req): array
    {
        $data = Valide::donnees($req);
        $pdo = $c->db->principale();
        $promo = self::promoCible($c, $data);
        if (!$c->droits()->peutAdministrerPromo($promo)) {
            throw new Erreur('forbidden', 'Réservé à un administrateur de cette promo');
        }
        $nom = Valide::nom($data['nom'] ?? null, 'Nom');
        self::verifierNomLibre($pdo, $promo, $nom, '');

        $membres = [];
        $vus = [];
        foreach (is_array($data['membres'] ?? null) ? $data['membres'] : [] as $adresse) {
            $email = strtolower(Valide::espaces($adresse));
            $st = $pdo->prepare("SELECT id, prenom, nom, pseudo FROM utilisateurs WHERE email = ? AND statut = 'actif'");
            $st->execute([$email]);
            $u = $st->fetch();
            if ($u === false) {
                throw new Erreur('not_found', 'Personne introuvable : ' . $email);
            }
            $affiche = \Lpc\Utilisateur::nomAffiche((string) $u['prenom'], (string) $u['nom'], $u['pseudo'] === null ? null : (string) $u['pseudo']);
            if (isset($vus[$email])) {
                throw new Erreur('invalid', $affiche . ' est indiqué deux fois');
            }
            $vus[$email] = true;
            if (self::dejaEtudiantDansGroupe($pdo, (int) $u['id'], $promo, '')) {
                throw new Erreur('invalid', $affiche . ' est déjà dans un groupe de cette promo');
            }
            $membres[] = (int) $u['id'];
        }

        $id = Ids::uuid();
        $pdo->beginTransaction();
        try {
            $pdo->prepare('INSERT INTO groupes (id, promo_id, nom, cree_le, cree_par) VALUES (?, ?, ?, ?, ?)')
                ->execute([$id, $promo, $nom, Temps::maintenant(), $c->user->id]);
            foreach ($membres as $uid) {
                $pdo->prepare('INSERT INTO membres (groupe_id, utilisateur_id, ajoute_le) VALUES (?, ?, ?)')->execute([$id, $uid, Temps::maintenant()]);
            }
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        return self::reponse($c);
    }

    /** @param array<string,mixed> $req @return array<string,mixed> */
    public static function groupUpdate(Contexte $c, array $req): array
    {
        $data = Valide::donnees($req);
        $pdo = $c->db->principale();
        [$groupe, $promoActuelle] = self::groupe($c, $data['id'] ?? null);
        if (!$c->droits()->peutAdministrerPromo($promoActuelle)) {
            throw new Erreur('forbidden', 'Réservé à un administrateur de cette promo');
        }
        $promo = (isset($data['promo_id']) || isset($data['promo']) || isset($data['etablissement']))
            ? self::promoCible($c, $data) : $promoActuelle;
        if ($promo !== $promoActuelle && !$c->droits()->peutAdministrerPromo($promo)) {
            throw new Erreur('forbidden', 'Vous n’administrez pas la promo de destination');
        }
        if (array_key_exists('nom', $data)) {
            $nom = Valide::nom($data['nom'], 'Nom');
        } else {
            $st = $pdo->prepare('SELECT nom FROM groupes WHERE id = ?');
            $st->execute([$groupe]);
            $nom = (string) $st->fetchColumn();
        }
        self::verifierNomLibre($pdo, $promo, $nom, $groupe);
        if ($promo !== $promoActuelle) {
            $st = $pdo->prepare('SELECT m.utilisateur_id FROM membres m WHERE m.groupe_id = ?');
            $st->execute([$groupe]);
            foreach ($st->fetchAll(\PDO::FETCH_COLUMN) as $uid) {
                if (self::dejaEtudiantDansGroupe($pdo, (int) $uid, $promo, $groupe)) {
                    throw new Erreur('invalid', 'Un membre est déjà dans un groupe de cette promo');
                }
            }
        }
        $pdo->prepare('UPDATE groupes SET promo_id = ?, nom = ? WHERE id = ?')->execute([$promo, $nom, $groupe]);
        return self::reponse($c);
    }

    /**
     * Supprime le groupe, ses membres, ses votes et son suivi de projet. Les articles restent (ils perdent seulement leur groupe).
     *
     * @param array<string,mixed> $req
     * @return array<string,mixed>
     */
    public static function groupDelete(Contexte $c, array $req): array
    {
        [$groupe, $promo] = self::groupe($c, $req['id'] ?? null);
        if (!$c->droits()->peutAdministrerPromo($promo)) {
            throw new Erreur('forbidden', 'Réservé à un administrateur de cette promo');
        }
        $c->db->principale()->prepare('DELETE FROM groupes WHERE id = ?')->execute([$groupe]);
        return self::reponse($c);
    }

    // ---------- Interne ----------

    /** @return array<string,mixed> réponse commune : données de la personne + listes d'administration de son périmètre */
    private static function reponse(Contexte $c): array
    {
        return array_merge(['ok' => true], Donnees::toutes($c), Donnees::admin($c));
    }

    /** @param list<mixed> $params */
    private static function existe(\PDO $pdo, string $sql, array $params): bool
    {
        $st = $pdo->prepare($sql);
        $st->execute($params);
        return $st->fetchColumn() !== false;
    }

    private static function etablissement(Contexte $c, mixed $id): string
    {
        $id = is_string($id) ? $id : '';
        if ($id === '' || !self::existe($c->db->principale(), 'SELECT 1 FROM etablissements WHERE id = ?', [$id])) {
            throw new Erreur('not_found', 'Établissement introuvable');
        }
        return $id;
    }

    /** @return array{0:string,1:string} identifiant de la promo et de son établissement */
    private static function promo(Contexte $c, mixed $id): array
    {
        $id = is_string($id) ? $id : '';
        $st = $c->db->principale()->prepare('SELECT id, etablissement_id FROM promos WHERE id = ?');
        $st->execute([$id]);
        $r = $id === '' ? false : $st->fetch();
        if ($r === false) {
            throw new Erreur('not_found', 'Promo introuvable');
        }
        return [(string) $r['id'], (string) $r['etablissement_id']];
    }

    /** @return array{0:string,1:string} identifiant du groupe et de sa promo */
    private static function groupe(Contexte $c, mixed $id): array
    {
        $id = is_string($id) ? $id : '';
        $st = $c->db->principale()->prepare('SELECT id, promo_id FROM groupes WHERE id = ?');
        $st->execute([$id]);
        $r = $id === '' ? false : $st->fetch();
        if ($r === false) {
            throw new Erreur('not_found', 'Groupe introuvable');
        }
        return [(string) $r['id'], (string) $r['promo_id']];
    }

    /**
     * Promo visée par une requête : promo_id, ou (admin seulement) noms d'établissement et de promo, créés s'ils n'existent pas.
     *
     * @param array<string,mixed> $data
     */
    private static function promoCible(Contexte $c, array $data): string
    {
        if (isset($data['promo_id']) && $data['promo_id'] !== '') {
            return self::promo($c, $data['promo_id'])[0];
        }
        if (!$c->droits()->estAdmin()) {
            throw new Erreur('invalid', 'Choisissez une promo');
        }
        $etab = Valide::nom($data['etablissement'] ?? null, 'Établissement');
        $promo = Valide::nom($data['promo'] ?? null, 'Promo');
        $pdo = $c->db->principale();
        $now = Temps::maintenant();
        $st = $pdo->prepare('SELECT id FROM etablissements WHERE nom = ?');
        $st->execute([$etab]);
        $eid = $st->fetchColumn();
        if ($eid === false) {
            $eid = Ids::uuid();
            $pdo->prepare('INSERT INTO etablissements (id, nom, cree_le) VALUES (?, ?, ?)')->execute([$eid, $etab, $now]);
        }
        $st = $pdo->prepare('SELECT id FROM promos WHERE etablissement_id = ? AND nom = ?');
        $st->execute([$eid, $promo]);
        $pid = $st->fetchColumn();
        if ($pid === false) {
            $pid = Ids::uuid();
            $pdo->prepare('INSERT INTO promos (id, etablissement_id, nom, cree_le) VALUES (?, ?, ?, ?)')->execute([$pid, $eid, $promo, $now]);
        }
        return (string) $pid;
    }

    private static function verifierNomLibre(\PDO $pdo, string $promo, string $nom, string $sauf): void
    {
        if (self::existe($pdo, 'SELECT 1 FROM groupes WHERE promo_id = ? AND nom = ? AND id <> ?', [$promo, $nom, $sauf])) {
            throw new Erreur('invalid', 'Ce nom est déjà pris dans cette promo');
        }
    }

    /** Un étudiant de la promo n'est que dans un groupe de cette promo. */
    private static function dejaEtudiantDansGroupe(\PDO $pdo, int $utilisateurId, string $promo, string $sauf): bool
    {
        return self::existe(
            $pdo,
            "SELECT 1 FROM membres m JOIN groupes g ON g.id = m.groupe_id
             WHERE m.utilisateur_id = ? AND g.promo_id = ? AND g.id <> ?
               AND EXISTS (SELECT 1 FROM attributions a WHERE a.utilisateur_id = m.utilisateur_id AND a.role = 'etudiant' AND a.promo_id = g.promo_id)",
            [$utilisateurId, $promo, $sauf]
        );
    }
}
