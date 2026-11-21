<?php
declare(strict_types=1);

namespace Lpc\Actions;

use Lpc\Attributions;
use Lpc\Config;
use Lpc\Contexte;
use Lpc\Donnees;
use Lpc\Erreur;
use Lpc\Ids;
use Lpc\Temps;
use Lpc\Utilisateur;
use Lpc\Utilisateurs;
use Lpc\Valide;

/**
 * Invitations par lien expirable : de promo (nombre d'usages limité), de groupe, ou personnelle (liée à une adresse).
 * Seul le SHA-256 du jeton est enregistré : le jeton en clair n'est montré qu'à la création. Le compte créé garde
 * l'invitation d'origine (utilisateurs.invitation_id), ce qui relie l'origine de l'invitation au compte.
 */
final class Invitations
{
    private const ESSAIS_MAX = 5;
    private const ESSAIS_S = 900;

    /** @param array<string,mixed> $req @return array<string,mixed> */
    public static function creer(Contexte $c, array $req): array
    {
        $data = Valide::donnees($req);
        $inv = self::inserer($c, $data);
        return ['ok' => true, 'invitation' => $inv];
    }

    /** @param array<string,mixed> $req @return array<string,mixed> */
    public static function liste(Contexte $c, array $req): array
    {
        if (!$c->droits()->estAdminQuelconque()) {
            throw new Erreur('forbidden', 'Réservé à un administrateur');
        }
        $st = $c->db->principale()->query(
            'SELECT i.id, i.type, i.role, i.etablissement_id, i.promo_id, i.groupe_id, i.email, i.cree_le, i.expire_le, i.max_usages, i.usages, i.revoque_le,
                    u.prenom AS c_prenom, u.nom AS c_nom, u.pseudo AS c_pseudo
             FROM invitations i LEFT JOIN utilisateurs u ON u.id = i.cree_par ORDER BY i.id DESC LIMIT 300'
        );
        $out = [];
        $now = Temps::maintenant();
        foreach ($st->fetchAll() as $r) {
            if (!self::peutGerer($c, $r)) {
                continue;
            }
            $revoquee = $r['revoque_le'] !== null;
            $out[] = [
                'id' => (int) $r['id'], 'type' => (string) $r['type'], 'role' => (string) $r['role'],
                'etablissement_id' => $r['etablissement_id'], 'promo_id' => $r['promo_id'], 'groupe_id' => $r['groupe_id'],
                'email' => $r['email'], 'cree_le' => Temps::iso((string) $r['cree_le']), 'expire_le' => Temps::iso((string) $r['expire_le']),
                'max' => (int) $r['max_usages'], 'usages' => (int) $r['usages'], 'revoquee' => $revoquee,
                'actif' => !$revoquee && (string) $r['expire_le'] > $now && (int) $r['usages'] < (int) $r['max_usages'],
                'par' => $r['c_prenom'] === null ? '' : Utilisateur::nomAffiche((string) $r['c_prenom'], (string) $r['c_nom'], $r['c_pseudo'] === null ? null : (string) $r['c_pseudo']),
            ];
        }
        return ['ok' => true, 'invitations' => $out];
    }

    /** @param array<string,mixed> $req @return array<string,mixed> */
    public static function revoquer(Contexte $c, array $req): array
    {
        $data = Valide::donnees($req);
        $pdo = $c->db->principale();
        $st = $pdo->prepare('SELECT id, type, role, etablissement_id, promo_id, groupe_id FROM invitations WHERE id = ?');
        $st->execute([(int) ($data['id'] ?? 0)]);
        $r = $st->fetch();
        if ($r === false) {
            throw new Erreur('not_found', 'Invitation introuvable');
        }
        if (!self::peutGerer($c, $r)) {
            throw new Erreur('forbidden', 'Cette invitation n’est pas dans votre périmètre');
        }
        $pdo->prepare('UPDATE invitations SET revoque_le = ? WHERE id = ? AND revoque_le IS NULL')->execute([Temps::maintenant(), $r['id']]);
        return self::liste($c, []);
    }

    /**
     * Ancien nom (« promo_code ») : crée une invitation de promo et renvoie le jeton une seule fois, avec les listes d'administration.
     *
     * @param array<string,mixed> $req
     * @return array<string,mixed>
     */
    public static function promoCode(Contexte $c, array $req): array
    {
        $data = Valide::donnees($req);
        $inv = self::inserer($c, ['type' => 'promo', 'promo_id' => $data['id'] ?? null, 'jours' => $data['jours'] ?? null, 'max' => $data['max'] ?? null]);
        return array_merge(['ok' => true, 'code' => $inv['jeton'], 'lien' => $inv['lien'], 'invitation' => $inv], Donnees::toutes($c), Donnees::admin($c));
    }

    /** Ancien nom (« promo_code_revoke ») : révoque les invitations de promo encore actives de la promo $req['id']. @param array<string,mixed> $req @return array<string,mixed> */
    public static function promoCodeRevoke(Contexte $c, array $req): array
    {
        $promo = (string) ($req['id'] ?? '');
        $pdo = $c->db->principale();
        if ($c->droits()->etablissementDePromo($promo) === null) {
            throw new Erreur('not_found', 'Promo introuvable');
        }
        if (!$c->droits()->peutAdministrerPromo($promo)) {
            throw new Erreur('forbidden', 'Réservé à un administrateur de cette promo');
        }
        $pdo->prepare("UPDATE invitations SET revoque_le = ? WHERE type = 'promo' AND promo_id = ? AND revoque_le IS NULL")->execute([Temps::maintenant(), $promo]);
        return array_merge(['ok' => true], Donnees::toutes($c), Donnees::admin($c));
    }

    /**
     * Utilise un jeton d'invitation. Une personne nouvelle (ou en attente) donne en même temps son prénom, son nom et son consentement ;
     * son compte est alors actif tout de suite. Une personne déjà active gagne simplement le rôle de l'invitation (cumul).
     * Les essais ratés sont limités.
     *
     * @param array<string,mixed> $req
     * @return array<string,mixed>
     */
    public static function utiliser(Contexte $c, array $req): array
    {
        $data = Valide::donnees($req);
        $pdo = $c->db->principale();
        $u = $c->user;
        if ($c->droits()->estAdmin()) {
            throw new Erreur('invalid', 'L’administrateur n’a pas besoin d’invitation');
        }
        if ($u->statut === 'refuse') {
            throw new Erreur('forbidden', 'Accès refusé');
        }
        $uid = Utilisateurs::assurerLigne($pdo, $u);

        $st = $pdo->prepare('SELECT COUNT(*) FROM essais_invitation WHERE utilisateur_id = ? AND essaye_le >= ?');
        $st->execute([$uid, Temps::depuis(-self::ESSAIS_S)]);
        if ((int) $st->fetchColumn() >= self::ESSAIS_MAX) {
            throw new Erreur('forbidden', 'Trop d’essais : réessayez dans quelques minutes');
        }
        $echec = static function (string $message = 'Code invalide ou expiré') use ($pdo, $uid): never {
            $pdo->prepare('INSERT INTO essais_invitation (utilisateur_id, essaye_le) VALUES (?, ?)')->execute([$uid, Temps::maintenant()]);
            throw new Erreur('invalid', $message);
        };

        $jeton = Valide::espaces($data['code'] ?? '');
        if (strlen($jeton) < 20) {
            $echec();
        }
        $st = $pdo->prepare('SELECT * FROM invitations WHERE jeton_hash = ?');
        $st->execute([Ids::hacher($jeton)]);
        $inv = $st->fetch();
        if ($inv === false || $inv['revoque_le'] !== null || (string) $inv['expire_le'] <= Temps::maintenant()) {
            $echec();
        }
        if ($inv['type'] === 'personnel' && strtolower((string) $inv['email']) !== $u->email) {
            $echec('Cette invitation est destinée à une autre adresse');
        }

        // Ce que l'invitation donne : le rôle (étudiant d'une promo ou formateur d'un établissement) et, pour un groupe, l'appartenance.
        $promo = $inv['promo_id'] === null ? null : (string) $inv['promo_id'];
        $groupe = $inv['groupe_id'] === null ? null : (string) $inv['groupe_id'];
        if ($groupe !== null) {
            $promo = $c->droits()->promoDeGroupe($groupe);
        }
        $etab = $inv['etablissement_id'] === null ? null : (string) $inv['etablissement_id'];
        if ($etab === null && $promo !== null) {
            $etab = $c->droits()->etablissementDePromo($promo);
        }
        $role = (string) $inv['role'];
        if ($role === 'etudiant' && $promo === null || $role === 'formateur' && $etab === null) {
            $echec();
        }

        $nouveau = $u->id === null || $u->statut === 'en_attente';
        $prenom = $nom = '';
        if ($nouveau) {
            Acces::exigerConsentement($data);
            $prenom = Valide::prenom($data['prenom'] ?? null);
            $nom = Valide::familleNom($data['nom'] ?? null);
        }

        $now = Temps::maintenant();
        $pdo->beginTransaction();
        try {
            $deja = $role === 'etudiant'
                ? self::existe($pdo, "SELECT 1 FROM attributions WHERE utilisateur_id = ? AND role = 'etudiant' AND promo_id = ?", [$uid, $promo])
                : self::existe($pdo, "SELECT 1 FROM attributions WHERE utilisateur_id = ? AND role = 'formateur' AND etablissement_id = ?", [$uid, $etab]);
            $membreDeja = $groupe !== null && self::existe($pdo, 'SELECT 1 FROM membres WHERE groupe_id = ? AND utilisateur_id = ?', [$groupe, $uid]);
            if (!$deja && !$membreDeja && (int) $inv['usages'] >= (int) $inv['max_usages']) {
                throw new Erreur('invalid', 'Cette invitation a atteint son nombre maximal d’utilisations');
            }

            if ($nouveau) {
                $couleur = $role === 'etudiant' ? Utilisateurs::couleurPeuUtilisee($pdo) : Config::COULEUR_DEFAUT;
                $pdo->prepare("UPDATE utilisateurs SET prenom = ?, nom = ?, couleur = ?, statut = 'actif', consentement_le = ?, consentement_version = ?, invitation_id = ? WHERE id = ?")
                    ->execute([$prenom, $nom, $couleur, $now, Config::CONSENT_VERSION, $inv['id'], $uid]);
                $pdo->prepare("UPDATE demandes_acces SET statut = 'accepte', traite_le = ? WHERE utilisateur_id = ? AND statut = 'en_attente'")->execute([$now, $uid]);
            }
            $cree = $role === 'etudiant'
                ? Attributions::ajouter($pdo, $uid, 'etudiant', null, $promo, 'invitation', (int) $inv['id'])
                : Attributions::ajouter($pdo, $uid, 'formateur', $etab, null, 'invitation', (int) $inv['id']);
            $rejoint = false;
            if ($groupe !== null && !$membreDeja) {
                if ($role === 'etudiant' && self::existe(
                    $pdo,
                    "SELECT 1 FROM membres m JOIN groupes g ON g.id = m.groupe_id WHERE m.utilisateur_id = ? AND g.promo_id = ? AND g.id <> ?",
                    [$uid, $promo, $groupe]
                )) {
                    throw new Erreur('invalid', 'Vous êtes déjà dans un groupe de cette promo');
                }
                $pdo->prepare('INSERT INTO membres (groupe_id, utilisateur_id, ajoute_le) VALUES (?, ?, ?)')->execute([$groupe, $uid, $now]);
                $rejoint = true;
            }
            if ($cree || $rejoint) {
                $pdo->prepare('UPDATE invitations SET usages = usages + 1 WHERE id = ?')->execute([$inv['id']]);
            }
            $pdo->prepare('DELETE FROM essais_invitation WHERE utilisateur_id = ?')->execute([$uid]);
            $pdo->commit();
        } catch (Erreur $e) {
            $pdo->rollBack();
            if ($e->getMessage() !== '') {
                $pdo->prepare('INSERT INTO essais_invitation (utilisateur_id, essaye_le) VALUES (?, ?)')->execute([$uid, Temps::maintenant()]);
            }
            throw $e;
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        return ['ok' => true];
    }

    // ---------- Interne ----------

    /**
     * Crée l'invitation après vérification des droits ; le jeton en clair n'existe que dans cette réponse.
     *
     * @param array<string,mixed> $data
     * @return array<string,mixed>
     */
    private static function inserer(Contexte $c, array $data): array
    {
        $type = (string) ($data['type'] ?? '');
        $role = (string) ($data['role'] ?? 'etudiant');
        $pdo = $c->db->principale();
        $d = $c->droits();
        $promo = isset($data['promo_id']) && $data['promo_id'] !== '' ? (string) $data['promo_id'] : null;
        $groupe = isset($data['groupe_id']) && $data['groupe_id'] !== '' ? (string) $data['groupe_id'] : null;
        $etab = isset($data['etablissement_id']) && $data['etablissement_id'] !== '' ? (string) $data['etablissement_id'] : null;
        $email = null;

        if ($type === 'promo') {
            if ($promo === null || $d->etablissementDePromo($promo) === null) {
                throw new Erreur('not_found', 'Promo introuvable');
            }
            if (!$d->peutAdministrerPromo($promo)) {
                throw new Erreur('forbidden', 'Réservé à un administrateur de cette promo');
            }
            $role = 'etudiant';
            $groupe = $etab = null;
            $maxDefaut = 150;
        } elseif ($type === 'groupe') {
            $promoDuGroupe = $groupe === null ? null : $d->promoDeGroupe($groupe);
            if ($promoDuGroupe === null) {
                throw new Erreur('not_found', 'Groupe introuvable');
            }
            if (!$d->peutAdministrerGroupe($groupe)) {
                throw new Erreur('forbidden', 'Réservé à un administrateur de ce groupe');
            }
            $role = 'etudiant';
            $promo = $etab = null;
            $maxDefaut = 30;
        } elseif ($type === 'personnel') {
            $email = strtolower(Valide::espaces($data['email'] ?? ''));
            if (filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
                throw new Erreur('invalid', 'Adresse e-mail invalide');
            }
            if (!in_array($role, ['etudiant', 'formateur'], true)) {
                throw new Erreur('invalid', 'Rôle invalide');
            }
            if ($role === 'etudiant') {
                if ($promo === null || $d->etablissementDePromo($promo) === null) {
                    throw new Erreur('not_found', 'Promo introuvable');
                }
                if (!$d->peutAdministrerPromo($promo)) {
                    throw new Erreur('forbidden', 'Réservé à un administrateur de cette promo');
                }
                $etab = null;
            } else {
                $etab ??= $promo === null ? null : $d->etablissementDePromo($promo);
                if ($etab === null || !self::existe($pdo, 'SELECT 1 FROM etablissements WHERE id = ?', [$etab])) {
                    throw new Erreur('not_found', 'Établissement introuvable');
                }
                if (!$d->peutAdministrerEtablissement($etab)) {
                    throw new Erreur('forbidden', 'Réservé à un administrateur de cet établissement');
                }
                $promo = null;
            }
            $groupe = null;
            $maxDefaut = 1;
        } else {
            throw new Erreur('invalid', 'Type d’invitation inconnu');
        }

        $jours = self::borne($data['jours'] ?? null, 30, 1, 365);
        $max = $type === 'personnel' ? 1 : self::borne($data['max'] ?? null, $maxDefaut, 1, 1000);
        $jeton = Ids::jeton();
        $now = Temps::maintenant();
        $expire = Temps::depuis($jours * 86400);
        $pdo->prepare(
            'INSERT INTO invitations (jeton_hash, type, role, etablissement_id, promo_id, groupe_id, email, cree_par, cree_le, expire_le, max_usages)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )->execute([Ids::hacher($jeton), $type, $role, $etab, $promo, $groupe, $email, $c->user->id, $now, $expire, $max]);
        $id = (int) $pdo->lastInsertId();
        $base = rtrim((string) $c->config->get('url_site', 'https://lespetitschercheurs.qocot.eu/'), '/') . '/';
        return [
            'id' => $id, 'type' => $type, 'role' => $role, 'promo_id' => $promo, 'groupe_id' => $groupe, 'etablissement_id' => $etab,
            'email' => $email, 'expire_le' => Temps::iso($expire), 'max' => $max, 'usages' => 0,
            'jeton' => $jeton, 'lien' => $base . '?invitation=' . $jeton,
        ];
    }

    /** Peut-elle gérer (lister, révoquer) cette invitation ? @param array<string,mixed> $i */
    private static function peutGerer(Contexte $c, array $i): bool
    {
        $d = $c->droits();
        if ($i['groupe_id'] !== null) {
            return $d->peutAdministrerGroupe((string) $i['groupe_id']);
        }
        if ($i['promo_id'] !== null) {
            return $d->peutAdministrerPromo((string) $i['promo_id']);
        }
        return $i['etablissement_id'] !== null && $d->peutAdministrerEtablissement((string) $i['etablissement_id']);
    }

    private static function borne(mixed $v, int $defaut, int $min, int $max): int
    {
        $n = is_numeric($v) ? (int) floor((float) $v) : 0;
        return $n >= $min ? min($n, $max) : $defaut;
    }

    /** @param list<mixed> $params */
    private static function existe(\PDO $pdo, string $sql, array $params): bool
    {
        $st = $pdo->prepare($sql);
        $st->execute($params);
        return $st->fetchColumn() !== false;
    }
}
