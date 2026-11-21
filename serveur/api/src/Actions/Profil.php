<?php
declare(strict_types=1);

namespace Lpc\Actions;

use Lpc\Config;
use Lpc\Contexte;
use Lpc\Donnees;
use Lpc\Erreur;
use Lpc\Temps;
use Lpc\Utilisateur;
use Lpc\Utilisateurs;
use Lpc\Valide;

/**
 * Consentement, pseudo et changement de prénom / nom.
 * Règle : le pseudo se change librement ; le prénom et le nom sont fixes et ne changent que sur demande
 * validée par un admin de promo (ou plus) concerné par la personne.
 */
final class Profil
{
    /**
     * Le consentement est un geste explicite, daté et rattaché à la version du texte acceptée.
     *
     * @param array<string,mixed> $req
     * @return array<string,mixed>
     */
    public static function consentement(Contexte $c, array $req): array
    {
        $data = $req['data'] ?? null;
        if (!is_array($data) || ($data['consentement'] ?? null) !== true) {
            throw new Erreur('invalid', 'Le consentement est nécessaire pour utiliser l’outil');
        }
        self::exigerCompte($c);
        $c->db->principale()
            ->prepare('UPDATE utilisateurs SET consentement_le = ?, consentement_version = ? WHERE id = ?')
            ->execute([Temps::maintenant(), Config::CONSENT_VERSION, $c->user->id]);
        return ['ok' => true];
    }

    /**
     * Modifie le pseudo (vide = le retirer). Toute tentative de modifier prénom ou nom est refusée : il faut une demande.
     *
     * @param array<string,mixed> $req
     * @return array<string,mixed>
     */
    public static function profileUpdate(Contexte $c, array $req): array
    {
        self::exigerCompte($c);
        $data = Valide::donnees($req);
        if (array_key_exists('prenom', $data) || array_key_exists('nom', $data)) {
            throw new Erreur('forbidden', 'Le prénom et le nom ne se modifient que sur demande, validée par un administrateur');
        }
        if (!array_key_exists('pseudo', $data)) {
            throw new Erreur('invalid', 'Pseudo manquant');
        }
        $pseudo = Valide::pseudo($data['pseudo']);
        $c->db->principale()->prepare('UPDATE utilisateurs SET pseudo = ? WHERE id = ?')->execute([$pseudo, $c->user->id]);

        $u = Utilisateurs::parId($c->db->principale(), (int) $c->user->id);
        if ($u === null) {
            throw new Erreur('server', 'Compte introuvable');
        }
        $moi = new Contexte($c->config, $c->db, $u);
        return array_merge(
            ['ok' => true, 'me' => self::me($moi)],
            Donnees::toutes($moi)
        );
    }

    /**
     * Demande de changement de prénom et de nom. Une seule demande en attente à la fois.
     *
     * @param array<string,mixed> $req
     * @return array<string,mixed>
     */
    public static function nomDemande(Contexte $c, array $req): array
    {
        self::exigerCompte($c);
        $data = Valide::donnees($req);
        $prenom = Valide::prenom($data['prenom'] ?? null);
        $nom = Valide::familleNom($data['nom'] ?? null);
        if (mb_strtolower($prenom) === mb_strtolower($c->user->prenom) && mb_strtolower($nom) === mb_strtolower($c->user->nom)) {
            throw new Erreur('invalid', 'Ce sont déjà votre prénom et votre nom');
        }
        $pdo = $c->db->principale();
        $st = $pdo->prepare("SELECT 1 FROM demandes_nom WHERE utilisateur_id = ? AND statut = 'en_attente'");
        $st->execute([$c->user->id]);
        if ($st->fetchColumn() !== false) {
            throw new Erreur('invalid', 'Une demande de changement de nom est déjà en attente');
        }
        $pdo->prepare('INSERT INTO demandes_nom (utilisateur_id, prenom, nom, statut, cree_le) VALUES (?, ?, ?, ?, ?)')
            ->execute([$c->user->id, $prenom, $nom, 'en_attente', Temps::maintenant()]);
        return ['ok' => true];
    }

    /**
     * Demandes de changement de nom que la personne peut traiter (son périmètre), les plus anciennes d'abord.
     *
     * @param array<string,mixed> $req
     * @return array<string,mixed>
     */
    public static function nomDemandes(Contexte $c, array $req): array
    {
        return ['ok' => true, 'demandes' => self::demandesTraitables($c)];
    }

    /**
     * Accepte ou refuse une demande de changement de nom.
     *
     * @param array<string,mixed> $req
     * @return array<string,mixed>
     */
    public static function nomDecision(Contexte $c, array $req): array
    {
        if (!$c->droits()->estAdminQuelconque()) {
            throw new Erreur('forbidden', 'Réservé à un administrateur');
        }
        $data = Valide::donnees($req);
        $pdo = $c->db->principale();
        $st = $pdo->prepare("SELECT id, utilisateur_id, prenom, nom FROM demandes_nom WHERE id = ? AND statut = 'en_attente'");
        $st->execute([(int) ($data['id'] ?? 0)]);
        $d = $st->fetch();
        if ($d === false) {
            throw new Erreur('not_found', 'Demande introuvable ou déjà traitée');
        }
        if (!$c->droits()->peutAdministrerUtilisateur((int) $d['utilisateur_id'])) {
            throw new Erreur('forbidden', 'Cette personne n’est pas dans votre périmètre');
        }
        $accepte = ($data['accepte'] ?? null) === true;
        $pdo->beginTransaction();
        try {
            if ($accepte) {
                $pdo->prepare('UPDATE utilisateurs SET prenom = ?, nom = ? WHERE id = ?')->execute([$d['prenom'], $d['nom'], $d['utilisateur_id']]);
            }
            $pdo->prepare('UPDATE demandes_nom SET statut = ?, traite_par = ?, traite_le = ? WHERE id = ?')
                ->execute([$accepte ? 'accepte' : 'refuse', $c->user->id, Temps::maintenant(), $d['id']]);
            $pdo->prepare('INSERT INTO journal_admin (acteur_id, action, cible, detail, cree_le) VALUES (?, ?, ?, ?, ?)')
                ->execute([$c->user->id, 'nom_decision', 'utilisateur:' . $d['utilisateur_id'], $accepte ? 'accepte' : 'refuse', Temps::maintenant()]);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        return ['ok' => true, 'demandes' => self::demandesTraitables($c)];
    }

    /** @return array<string,mixed> forme « me » attendue par l'interface */
    public static function me(Contexte $c): array
    {
        $u = $c->user;
        $demande = null;
        if ($u->id !== null) {
            $st = $c->db->principale()->prepare("SELECT prenom, nom, cree_le FROM demandes_nom WHERE utilisateur_id = ? AND statut = 'en_attente' ORDER BY id DESC LIMIT 1");
            $st->execute([$u->id]);
            $d = $st->fetch();
            if ($d !== false) {
                $demande = ['prenom' => (string) $d['prenom'], 'nom' => (string) $d['nom'], 'cree_le' => Temps::iso((string) $d['cree_le'])];
            }
        }
        return [
            'prenom' => $u->affichage(),
            'role' => $c->droits()->roleInterface(),
            'couleur' => $u->couleur,
            'consentement' => $u->consentementVersion === Config::CONSENT_VERSION,
            'consent_version' => Config::CONSENT_VERSION,
            'roles' => $c->droits()->pourClient(),
            // Pour l'écran « Mon profil » : identité légale (jamais montrée aux autres), pseudo, demande de changement de nom en attente.
            'identite' => ['prenom' => $u->prenom, 'nom' => $u->nom, 'pseudo' => $u->pseudo ?? ''],
            'demande_nom' => $demande,
        ];
    }

    /** @return list<array<string,mixed>> */
    private static function demandesTraitables(Contexte $c): array
    {
        $d = $c->droits();
        if ($c->user->id === null || !$d->estAdminQuelconque()) {
            return [];
        }
        $st = $c->db->principale()->query(
            "SELECT n.id, n.utilisateur_id, n.prenom, n.nom, n.cree_le, u.pid, u.prenom AS u_prenom, u.nom AS u_nom, u.pseudo AS u_pseudo
             FROM demandes_nom n JOIN utilisateurs u ON u.id = n.utilisateur_id
             WHERE n.statut = 'en_attente' ORDER BY n.cree_le, n.id"
        );
        $out = [];
        foreach ($st->fetchAll() as $r) {
            if (!$d->peutAdministrerUtilisateur((int) $r['utilisateur_id'])) {
                continue;
            }
            $out[] = [
                'id' => (int) $r['id'],
                'pid' => (string) $r['pid'],
                'actuel' => Utilisateur::nomAffiche((string) $r['u_prenom'], (string) $r['u_nom'], $r['u_pseudo'] === null ? null : (string) $r['u_pseudo'])
                    . ($r['u_nom'] === '' ? '' : ' (' . $r['u_prenom'] . ' ' . $r['u_nom'] . ')'),
                'prenom' => (string) $r['prenom'],
                'nom' => (string) $r['nom'],
                'cree_le' => Temps::iso((string) $r['cree_le']),
            ];
        }
        return $out;
    }

    private static function exigerCompte(Contexte $c): void
    {
        if ($c->user->id === null || $c->user->accueil) {
            throw new Erreur('forbidden', 'Votre accès doit d’abord être validé');
        }
    }
}
