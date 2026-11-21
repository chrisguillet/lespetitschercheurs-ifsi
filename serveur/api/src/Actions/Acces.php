<?php
declare(strict_types=1);

namespace Lpc\Actions;

use Lpc\Attributions;
use Lpc\Config;
use Lpc\Contexte;
use Lpc\Donnees;
use Lpc\Erreur;
use Lpc\Temps;
use Lpc\Utilisateur;
use Lpc\Utilisateurs;
use Lpc\Valide;

/**
 * Accès et comptes : première connexion (demande d'accès), liste et validation des personnes dans le périmètre d'un admin,
 * attribution et retrait de rôles. Un admin de promo valide les étudiants de sa promo ; un admin de site, les formateurs de
 * son établissement ; l'admin global fait tout, y compris corriger un nom, une adresse ou une couleur.
 */
final class Acces
{
    // ---------- Première connexion ----------

    /** @param array<string,mixed> $req @return array<string,mixed> */
    public static function onboarding(Contexte $c, array $req): array
    {
        return ['ok' => true] + self::accueil($c, $c->user);
    }

    /**
     * Demande d'accès : rôle souhaité, promo, prénom et nom (obligatoires) et consentement. Validée ensuite par un admin de promo
     * (étudiant) ou de site (formateur) ; l'admin global peut tout valider.
     *
     * @param array<string,mixed> $req
     * @return array<string,mixed>
     */
    public static function onboardingDemande(Contexte $c, array $req): array
    {
        $u = $c->user;
        if ($c->droits()->estAdmin()) {
            throw new Erreur('invalid', 'L’administrateur n’a pas besoin de demande');
        }
        if ($u->statut === 'actif' && !$u->accueil) {
            throw new Erreur('invalid', 'Votre accès est déjà actif');
        }
        $data = Valide::donnees($req);
        $role = (string) ($data['role'] ?? '');
        if (!in_array($role, ['etudiant', 'formateur'], true)) {
            throw new Erreur('invalid', 'Rôle invalide');
        }
        self::exigerConsentement($data);
        $prenom = Valide::prenom($data['prenom'] ?? null);
        $nom = Valide::familleNom($data['nom'] ?? null);

        $pdo = $c->db->principale();
        $promoId = (string) ($data['promo_id'] ?? '');
        if ($promoId === '') {
            $toutes = $pdo->query('SELECT id FROM promos')->fetchAll(\PDO::FETCH_COLUMN);
            $promoId = count($toutes) === 1 ? (string) $toutes[0] : '';   // une seule promo ouverte : choisie d'office
        }
        if ($promoId === '') {
            throw new Erreur('invalid', 'Choisissez votre promo');
        }
        $etab = $c->droits()->etablissementDePromo($promoId);
        if ($etab === null) {
            throw new Erreur('invalid', 'Promo introuvable');
        }

        $id = Utilisateurs::assurerLigne($pdo, $u);
        $now = Temps::maintenant();
        $pdo->beginTransaction();
        try {
            $pdo->prepare('UPDATE utilisateurs SET prenom = ?, nom = ?, consentement_le = ?, consentement_version = ? WHERE id = ?')
                ->execute([$prenom, $nom, $now, Config::CONSENT_VERSION, $id]);
            $pdo->prepare("DELETE FROM demandes_acces WHERE utilisateur_id = ? AND statut = 'en_attente'")->execute([$id]);
            $pdo->prepare('INSERT INTO demandes_acces (utilisateur_id, etablissement_id, promo_id, role, prenom, nom, statut, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
                ->execute([$id, $etab, $promoId, $role, $prenom, $nom, 'en_attente', $now]);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        $maj = Utilisateurs::parId($pdo, $id) ?? $u;
        return ['ok' => true] + self::accueil($c, new Utilisateur($maj->id, $maj->pid, $maj->email, $maj->prenom, $maj->nom, $maj->pseudo,
            $maj->couleur, $maj->statut, $maj->derniereConnexion, $maj->consentementVersion, true));
    }

    /** Le consentement est un geste explicite. @param array<string,mixed> $data */
    public static function exigerConsentement(array $data): void
    {
        if (($data['consentement'] ?? null) !== true) {
            throw new Erreur('invalid', 'Le consentement est nécessaire pour utiliser l’outil');
        }
    }

    /** Ce que voit une personne à sa première connexion : la structure (noms seulement) et sa demande en cours. @return array<string,mixed> */
    private static function accueil(Contexte $c, Utilisateur $u): array
    {
        $pdo = $c->db->principale();
        $promos = [];
        foreach ($pdo->query('SELECT id, etablissement_id, nom FROM promos ORDER BY nom')->fetchAll() as $p) {
            $promos[(string) $p['etablissement_id']][] = ['id' => (string) $p['id'], 'nom' => (string) $p['nom']];
        }
        $structure = [];
        foreach ($pdo->query('SELECT id, nom FROM etablissements ORDER BY nom')->fetchAll() as $e) {
            $structure[] = ['id' => (string) $e['id'], 'nom' => (string) $e['nom'], 'promos' => $promos[(string) $e['id']] ?? []];
        }
        $demande = ['prenom' => $u->prenom, 'nom' => $u->nom, 'promo_id' => '', 'promo' => '', 'role' => ''];
        if ($u->id !== null) {
            $st = $pdo->prepare(
                "SELECT d.prenom, d.nom, d.role, d.promo_id, e.nom AS etab, p.nom AS promo
                 FROM demandes_acces d JOIN promos p ON p.id = d.promo_id JOIN etablissements e ON e.id = p.etablissement_id
                 WHERE d.utilisateur_id = ? AND d.statut = 'en_attente' ORDER BY d.id DESC LIMIT 1"
            );
            $st->execute([$u->id]);
            $d = $st->fetch();
            if ($d !== false) {
                $demande = ['prenom' => (string) $d['prenom'], 'nom' => (string) $d['nom'], 'promo_id' => (string) $d['promo_id'],
                    'promo' => $d['etab'] . ' · ' . $d['promo'], 'role' => (string) $d['role']];
            }
        }
        return ['structure' => $structure, 'demande' => $demande, 'statut' => $u->statut];
    }

    // ---------- Administration des personnes ----------

    /** @param array<string,mixed> $req @return array<string,mixed> */
    public static function adminList(Contexte $c, array $req): array
    {
        self::exigerAdmin($c);
        return self::reponse($c);
    }

    /**
     * Valide ou refuse un accès ; l'admin global peut en plus corriger prénom, nom, couleur et adresse.
     * Valider une demande crée le rôle demandé (étudiant de la promo, ou formateur de l'établissement).
     *
     * @param array<string,mixed> $req
     * @return array<string,mixed>
     */
    public static function adminSet(Contexte $c, array $req): array
    {
        self::exigerAdmin($c);
        $data = Valide::donnees($req);
        $pdo = $c->db->principale();
        $d = $c->droits();
        $global = $d->estAdmin();

        $cible = self::cible($c, $data['email'] ?? null);
        self::refuserCompteAdmin($c, $cible['email']);
        $demande = self::demandeEnAttente($pdo, $cible['id']);
        if (!$global && !$d->peutAdministrerUtilisateur($cible['id'])
            && !($demande !== null && $d->peutAdministrerPromo($demande['promo_id']))) {
            throw new Erreur('forbidden', 'Cette personne n’est pas dans votre périmètre');
        }
        $statut = (string) ($data['statut'] ?? '');
        if (!in_array($statut, ['actif', 'refuse'], true)) {
            throw new Erreur('invalid', 'Statut invalide');
        }

        $prenom = $cible['prenom'];
        $nom = $cible['nom'];
        $couleur = $cible['couleur'];
        $email = $cible['email'];
        if ($global) {
            if (array_key_exists('prenom', $data) && Valide::espaces($data['prenom']) !== '') {
                $prenom = Valide::prenom($data['prenom']);
            }
            if (array_key_exists('nom', $data) && Valide::espaces($data['nom']) !== '') {
                $nom = Valide::familleNom($data['nom']);
            }
            if (!empty($data['couleur'])) {
                if (preg_match('/^#[0-9a-fA-F]{6}$/', (string) $data['couleur']) !== 1) {
                    throw new Erreur('invalid', 'Couleur invalide');
                }
                $couleur = (string) $data['couleur'];
            }
            $nouvel = strtolower(Valide::espaces($data['nouvel_email'] ?? ''));
            if ($nouvel !== '' && $nouvel !== $email) {
                if (filter_var($nouvel, FILTER_VALIDATE_EMAIL) === false) {
                    throw new Erreur('invalid', 'Adresse e-mail invalide');
                }
                $st = $pdo->prepare('SELECT 1 FROM utilisateurs WHERE email = ? AND id <> ?');
                $st->execute([$nouvel, $cible['id']]);
                if ($nouvel === $c->config->emailAdmin() || $st->fetchColumn() !== false) {
                    throw new Erreur('invalid', 'Cette adresse est déjà utilisée');
                }
                $email = $nouvel;
            }
        }

        $now = Temps::maintenant();
        $pdo->beginTransaction();
        try {
            if ($statut === 'actif' && $cible['statut'] === 'en_attente') {
                if ($prenom === '' || $nom === '') {
                    throw new Erreur('invalid', 'Prénom et nom requis pour valider un accès');
                }
                $role = (string) ($global && !empty($data['role']) ? $data['role'] : ($demande['role'] ?? 'etudiant'));
                $promoId = (string) ($global && !empty($data['promo_id']) ? $data['promo_id'] : ($demande['promo_id'] ?? ''));
                if (!in_array($role, ['etudiant', 'formateur'], true)) {
                    throw new Erreur('invalid', 'Rôle invalide');
                }
                $etab = $promoId === '' ? null : $d->etablissementDePromo($promoId);
                if ($etab === null) {
                    throw new Erreur('invalid', 'Promo introuvable : indiquez la promo de cette personne');
                }
                if ($role === 'etudiant') {
                    if (!$d->peutAdministrerPromo($promoId)) {
                        throw new Erreur('forbidden', 'Réservé à un administrateur de cette promo');
                    }
                    Attributions::ajouter($pdo, $cible['id'], 'etudiant', null, $promoId, 'demande', null, $c->user->id);
                    $couleur = $cible['couleur'] === \Lpc\Config::COULEUR_DEFAUT ? Utilisateurs::couleurPeuUtilisee($pdo) : $couleur;
                } else {
                    if (!$d->peutAdministrerEtablissement($etab)) {
                        throw new Erreur('forbidden', 'Réservé à un administrateur de cet établissement');
                    }
                    Attributions::ajouter($pdo, $cible['id'], 'formateur', $etab, null, 'demande', null, $c->user->id);
                }
            }
            if ($demande !== null) {
                $pdo->prepare('UPDATE demandes_acces SET statut = ?, traite_par = ?, traite_le = ? WHERE id = ?')
                    ->execute([$statut === 'actif' ? 'accepte' : 'refuse', $c->user->id, $now, $demande['id']]);
            }
            $pdo->prepare('UPDATE utilisateurs SET email = ?, pid = ?, prenom = ?, nom = ?, couleur = ?, statut = ? WHERE id = ?')
                ->execute([$email, \Lpc\Ids::pid($email), $prenom, $nom, $couleur, $statut, $cible['id']]);
            self::journal($pdo, $c, 'admin_set', 'utilisateur:' . $cible['id'], $statut);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        return self::reponse($c);
    }

    /**
     * Retire l'accès (admin global). Les contributions restent, détachées de la personne ; pour tout effacer, « admin_erase ».
     *
     * @param array<string,mixed> $req
     * @return array<string,mixed>
     */
    public static function adminDelete(Contexte $c, array $req): array
    {
        if (!$c->droits()->estAdmin()) {
            throw new Erreur('forbidden', 'Réservé à l’administrateur');
        }
        $cible = self::cible($c, $req['email'] ?? null);
        self::refuserCompteAdmin($c, $cible['email']);
        $pdo = $c->db->principale();
        $pdo->prepare('DELETE FROM utilisateurs WHERE id = ?')->execute([$cible['id']]);
        self::journal($pdo, $c, 'admin_delete', 'utilisateur:' . $cible['id'], '');
        return self::reponse($c);
    }

    /**
     * Ajoute un rôle avec son périmètre à une personne active.
     * admin et admin de site : admin global seulement ; admin de promo et étudiant : admin de la promo ; formateur : admin du site.
     *
     * @param array<string,mixed> $req
     * @return array<string,mixed>
     */
    public static function attributionAdd(Contexte $c, array $req): array
    {
        self::exigerAdmin($c);
        $data = Valide::donnees($req);
        $role = (string) ($data['role'] ?? '');
        $etab = isset($data['etablissement_id']) && $data['etablissement_id'] !== '' ? (string) $data['etablissement_id'] : null;
        $promo = isset($data['promo_id']) && $data['promo_id'] !== '' ? (string) $data['promo_id'] : null;
        $cible = self::cible($c, $data['email'] ?? null);
        if ($cible['statut'] !== 'actif') {
            throw new Erreur('invalid', 'Validez d’abord l’accès de cette personne');
        }
        self::exigerDroitSurRole($c, $role, $etab, $promo);
        $pdo = $c->db->principale();
        $existe = $promo !== null ? self::existe($pdo, 'SELECT 1 FROM promos WHERE id = ?', [$promo])
            : ($etab === null || self::existe($pdo, 'SELECT 1 FROM etablissements WHERE id = ?', [$etab]));
        if (!$existe) {
            throw new Erreur('not_found', 'Périmètre introuvable');
        }
        Attributions::ajouter($pdo, $cible['id'], $role, $etab, $promo, 'admin', null, $c->user->id);
        self::journal($pdo, $c, 'attribution_add', 'utilisateur:' . $cible['id'], $role);
        return self::reponse($c);
    }

    /** @param array<string,mixed> $req @return array<string,mixed> */
    public static function attributionRemove(Contexte $c, array $req): array
    {
        self::exigerAdmin($c);
        $data = Valide::donnees($req);
        $pdo = $c->db->principale();
        $st = $pdo->prepare('SELECT a.id, a.utilisateur_id, a.role, a.etablissement_id, a.promo_id, u.email FROM attributions a
                             JOIN utilisateurs u ON u.id = a.utilisateur_id WHERE a.id = ?');
        $st->execute([(int) ($data['id'] ?? 0)]);
        $a = $st->fetch();
        if ($a === false) {
            throw new Erreur('not_found', 'Rôle introuvable');
        }
        if ($a['role'] === 'admin' && (string) $a['email'] === $c->config->emailAdmin()) {
            throw new Erreur('forbidden', 'Le rôle de l’administrateur de la configuration ne peut pas être retiré');
        }
        self::exigerDroitSurRole($c, (string) $a['role'], $a['etablissement_id'] === null ? null : (string) $a['etablissement_id'],
            $a['promo_id'] === null ? null : (string) $a['promo_id']);
        $pdo->prepare('DELETE FROM attributions WHERE id = ?')->execute([$a['id']]);
        self::journal($pdo, $c, 'attribution_remove', 'utilisateur:' . $a['utilisateur_id'], (string) $a['role']);
        return self::reponse($c);
    }

    // ---------- Interne ----------

    /** @return array<string,mixed> réponse commune des écrans d'administration */
    public static function reponse(Contexte $c): array
    {
        $pdo = $c->db->principale();
        $r = ['ok' => true, 'acces' => self::liste($c)] + Donnees::admin($c) + Donnees::toutes($c);
        if ($c->droits()->estAdmin()) {
            $s = $pdo->query('SELECT COUNT(*) AS nb, COALESCE(SUM(taille), 0) AS octets FROM fichiers')->fetch();
            $r['stockage'] = ['nb' => (int) $s['nb'], 'octets' => (int) $s['octets']];
            $r['feedbacks'] = \Lpc\Feedback::pourAdmin($c);
        }
        return $r;
    }

    private static function exigerAdmin(Contexte $c): void
    {
        if (!$c->droits()->estAdminQuelconque()) {
            throw new Erreur('forbidden', 'Réservé à un administrateur');
        }
    }

    private static function exigerDroitSurRole(Contexte $c, string $role, ?string $etab, ?string $promo): void
    {
        $d = $c->droits();
        $ok = match ($role) {
            'admin' => $d->estAdmin() && $etab === null && $promo === null,
            'admin_site' => $d->estAdmin() && $etab !== null && $promo === null,
            'formateur' => $etab !== null && $promo === null && $d->peutAdministrerEtablissement($etab),
            'admin_promo', 'etudiant' => $promo !== null && $etab === null && $d->peutAdministrerPromo($promo),
            default => throw new Erreur('invalid', 'Rôle invalide'),
        };
        if (!$ok) {
            throw new Erreur('forbidden', 'Vous ne pouvez pas gérer ce rôle sur ce périmètre');
        }
    }

    /** @return array{id:int,email:string,prenom:string,nom:string,couleur:string,statut:string} */
    private static function cible(Contexte $c, mixed $adresse): array
    {
        $email = strtolower(Valide::espaces($adresse));
        $st = $c->db->principale()->prepare('SELECT id, email, prenom, nom, couleur, statut FROM utilisateurs WHERE email = ?');
        $st->execute([$email]);
        $r = $st->fetch();
        if ($r === false) {
            throw new Erreur('not_found', 'Adresse introuvable');
        }
        return ['id' => (int) $r['id'], 'email' => (string) $r['email'], 'prenom' => (string) $r['prenom'], 'nom' => (string) $r['nom'],
            'couleur' => (string) $r['couleur'], 'statut' => (string) $r['statut']];
    }

    public static function refuserCompteAdmin(Contexte $c, string $email): void
    {
        if ($email === $c->config->emailAdmin()) {
            throw new Erreur('forbidden', 'Le compte administrateur ne peut pas être modifié ni supprimé ici');
        }
    }

    /** @return array{id:int,promo_id:string,role:string}|null */
    private static function demandeEnAttente(\PDO $pdo, int $utilisateurId): ?array
    {
        $st = $pdo->prepare("SELECT id, promo_id, role FROM demandes_acces WHERE utilisateur_id = ? AND statut = 'en_attente' ORDER BY id DESC LIMIT 1");
        $st->execute([$utilisateurId]);
        $r = $st->fetch();
        return $r === false ? null : ['id' => (int) $r['id'], 'promo_id' => (string) $r['promo_id'], 'role' => (string) $r['role']];
    }

    /** @param list<mixed> $params */
    private static function existe(\PDO $pdo, string $sql, array $params): bool
    {
        $st = $pdo->prepare($sql);
        $st->execute($params);
        return $st->fetchColumn() !== false;
    }

    public static function journal(\PDO $pdo, Contexte $c, string $action, string $cible, string $detail): void
    {
        $pdo->prepare('INSERT INTO journal_admin (acteur_id, action, cible, detail, cree_le) VALUES (?, ?, ?, ?, ?)')
            ->execute([$c->user->id, $action, $cible, $detail, Temps::maintenant()]);
    }

    /**
     * Personnes que la personne connectée administre : rattachées à ses promos ou établissements, ou ayant demandé l'accès
     * à l'une de ses promos. L'admin global voit tout le monde.
     *
     * @return list<array<string,mixed>>
     */
    private static function liste(Contexte $c): array
    {
        $d = $c->droits();
        $pdo = $c->db->principale();
        $promos = $d->promosAdministrees();
        $etabs = $d->etablissementsAdministres();

        if ($promos === null) {
            $where = '1 = 1';
            $params = [];
        } else {
            $parties = [];
            $params = [];
            if ($promos !== []) {
                $m = implode(',', array_fill(0, count($promos), '?'));
                $parties[] = "SELECT utilisateur_id FROM attributions WHERE promo_id IN ($m)";
                $parties[] = "SELECT utilisateur_id FROM demandes_acces WHERE statut = 'en_attente' AND promo_id IN ($m)";
                array_push($params, ...$promos, ...$promos);
            }
            if ($etabs !== null && $etabs !== []) {
                $parties[] = 'SELECT utilisateur_id FROM attributions WHERE etablissement_id IN (' . implode(',', array_fill(0, count($etabs), '?')) . ')';
                array_push($params, ...$etabs);
            }
            if ($parties === []) {
                return [];
            }
            $where = 'u.id IN (' . implode(' UNION ', $parties) . ')';
        }

        $st = $pdo->prepare(
            "SELECT u.id, u.pid, u.email, u.prenom, u.nom, u.pseudo, u.couleur, u.statut, u.demande_le, u.derniere_connexion,
                    (SELECT COUNT(*) FROM analyses a WHERE a.utilisateur_id = u.id) AS nb_l,
                    (SELECT COUNT(*) FROM commentaires k WHERE k.auteur_id = u.id) AS nb_c
             FROM utilisateurs u WHERE $where"
        );
        $st->execute($params);
        $personnes = $st->fetchAll();
        if ($personnes === []) {
            return [];
        }
        $ids = array_map(static fn (array $p): int => (int) $p['id'], $personnes);
        $m = implode(',', array_fill(0, count($ids), '?'));

        $demandes = [];
        $st = $pdo->prepare(
            "SELECT d.utilisateur_id, d.role, d.promo_id, e.nom AS etab, p.nom AS promo FROM demandes_acces d
             JOIN promos p ON p.id = d.promo_id JOIN etablissements e ON e.id = p.etablissement_id
             WHERE d.statut = 'en_attente' AND d.utilisateur_id IN ($m) ORDER BY d.id"
        );
        $st->execute($ids);
        foreach ($st->fetchAll() as $r) {
            $demandes[(int) $r['utilisateur_id']] = ['promo_id' => (string) $r['promo_id'], 'promo' => $r['etab'] . ' · ' . $r['promo'], 'role' => (string) $r['role']];
        }

        $roles = [];
        $st = $pdo->prepare(
            "SELECT a.id, a.utilisateur_id, a.role, a.etablissement_id, a.promo_id, e.nom AS etab, p.nom AS promo, pe.nom AS promo_etab
             FROM attributions a LEFT JOIN etablissements e ON e.id = a.etablissement_id
             LEFT JOIN promos p ON p.id = a.promo_id LEFT JOIN etablissements pe ON pe.id = p.etablissement_id
             WHERE a.utilisateur_id IN ($m) ORDER BY a.id"
        );
        $st->execute($ids);
        foreach ($st->fetchAll() as $r) {
            $etab = $r['etablissement_id'] === null ? null : (string) $r['etablissement_id'];
            $promo = $r['promo_id'] === null ? null : (string) $r['promo_id'];
            $visible = $d->estAdmin() || ($promo !== null && $d->peutAdministrerPromo($promo)) || ($etab !== null && $d->peutAdministrerEtablissement($etab));
            if ($visible) {
                $roles[(int) $r['utilisateur_id']][] = ['id' => (int) $r['id'], 'role' => (string) $r['role'], 'etablissement_id' => $etab, 'promo_id' => $promo,
                    'perimetre' => $promo !== null ? $r['promo_etab'] . ' · ' . $r['promo'] : ($etab !== null ? (string) $r['etab'] : '')];
            }
        }

        $out = [];
        foreach ($personnes as $p) {
            $id = (int) $p['id'];
            $mesRoles = $roles[$id] ?? [];
            $etudiant = false;
            foreach ($mesRoles as $a) {
                $etudiant = $etudiant || $a['role'] === 'etudiant';
            }
            $role = $etudiant ? 'etudiant' : (isset($demandes[$id]) ? $demandes[$id]['role'] : 'formateur');
            $out[] = [
                'email' => (string) $p['email'],
                'pid' => (string) $p['pid'],
                'prenom' => Utilisateur::nomAffiche((string) $p['prenom'], (string) $p['nom'], $p['pseudo'] === null ? null : (string) $p['pseudo']),
                'prenom_legal' => (string) $p['prenom'],
                'nom' => (string) $p['nom'],
                'pseudo' => (string) ($p['pseudo'] ?? ''),
                'role' => $role,
                'statut' => (string) $p['statut'],
                'couleur' => (string) $p['couleur'],
                'demande_le' => Temps::iso($p['demande_le'] === null ? null : (string) $p['demande_le']),
                'derniere_connexion' => Temps::iso($p['derniere_connexion'] === null ? null : (string) $p['derniere_connexion']),
                'demande' => $demandes[$id] ?? ['promo_id' => '', 'promo' => '', 'role' => ''],
                'protege' => $etudiant,
                'nb_lectures' => (int) $p['nb_l'],
                'nb_commentaires' => (int) $p['nb_c'],
                'attributions' => $mesRoles,
            ];
        }
        usort($out, static fn (array $a, array $b): int =>
            (($a['statut'] === 'en_attente' ? 0 : 1) <=> ($b['statut'] === 'en_attente' ? 0 : 1))
            ?: strcmp(mb_strtolower($a['prenom']), mb_strtolower($b['prenom'])));
        return $out;
    }
}
