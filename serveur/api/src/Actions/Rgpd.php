<?php
declare(strict_types=1);

namespace Lpc\Actions;

use Lpc\Contexte;
use Lpc\Erreur;
use Lpc\Temps;
use Lpc\Valide;

/**
 * Droits RGPD : accès (export de tout ce que l'application garde sur la personne) et effacement complet.
 *
 * Effacement : le compte, les fiches de lecture de la personne et leurs commentaires, ses notes, messages, retours, appartenances,
 * propositions, votes, pièces jointes et rôles disparaissent. Ce qui appartient au groupe sans être d'elle (articles partagés,
 * réunions, jalons, glossaire) est conservé, détaché de la personne (clés étrangères « SET NULL »).
 */
final class Rgpd
{
    /** @param array<string,mixed> $req @return array<string,mixed> */
    public static function adminErase(Contexte $c, array $req): array
    {
        if (!$c->droits()->estAdmin()) {
            throw new Erreur('forbidden', 'Réservé à l’administrateur');
        }
        $email = strtolower(Valide::espaces($req['email'] ?? ''));
        $pdo = $c->db->principale();
        $st = $pdo->prepare('SELECT id, email FROM utilisateurs WHERE email = ?');
        $st->execute([$email]);
        $cible = $st->fetch();
        if ($cible === false) {
            throw new Erreur('not_found', 'Adresse introuvable');
        }
        if ($email === $c->config->emailAdmin()) {
            throw new Erreur('forbidden', 'Le compte administrateur ne peut pas être effacé');
        }
        $id = (int) $cible['id'];

        $st = $pdo->prepare('SELECT chemin FROM fichiers WHERE cree_par = ?');
        $st->execute([$id]);
        $chemins = $st->fetchAll(\PDO::FETCH_COLUMN);

        $pdo->beginTransaction();
        try {
            $mes = $pdo->prepare('SELECT id FROM analyses WHERE utilisateur_id = ?');
            $mes->execute([$id]);
            $analyses = array_map('strval', $mes->fetchAll(\PDO::FETCH_COLUMN));
            foreach ($analyses as $a) {
                $pdo->prepare("DELETE FROM historique WHERE cible = 'analyse' AND cible_id = ?")->execute([$a]);
            }
            $requetes = [
                'DELETE FROM commentaires WHERE auteur_id = ?',
                'DELETE FROM analyses WHERE utilisateur_id = ?',               // leurs commentaires disparaissent avec elles (CASCADE)
                'DELETE FROM historique WHERE proprietaire = ?',
                'DELETE FROM fichiers WHERE cree_par = ?',
                'DELETE FROM propositions WHERE propose_par = ?',
                'DELETE FROM votes WHERE propose_par = ? OR cible_id = ?',
                'DELETE FROM feedback WHERE auteur_id = ?',
            ];
            foreach ($requetes as $sql) {
                $pdo->prepare($sql)->execute(substr_count($sql, '?') === 2 ? [$id, $id] : [$id]);
            }
            $pdo->prepare('DELETE FROM utilisateurs WHERE id = ?')->execute([$id]);   // notes, appartenances, rôles, demandes : CASCADE
            Acces::journal($pdo, $c, 'admin_erase', 'utilisateur:' . $id . ' (effacé)', '');
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }

        try {
            $chat = $c->db->chat();
            $chat->prepare('DELETE FROM chat_messages WHERE auteur_id = ?')->execute([$id]);
            $chat->prepare('DELETE FROM presence WHERE utilisateur_id = ?')->execute([$id]);
        } catch (\Throwable $e) {
            error_log('Effacement : messages du chat non retirés : ' . $e->getMessage());
        }
        $dossier = $c->config->dossierPrive() . '/fichiers/';
        foreach ($chemins as $chemin) {
            $reel = realpath($dossier . $chemin);
            if ($reel !== false && str_starts_with($reel, (string) realpath($dossier))) {
                @unlink($reel);
            }
        }
        return Acces::reponse($c);
    }

    /**
     * Tout ce que l'application garde sur la personne connectée, en un seul document.
     *
     * @param array<string,mixed> $req
     * @return array<string,mixed>
     */
    public static function mesDonnees(Contexte $c, array $req): array
    {
        $u = $c->user;
        if ($u->id === null) {
            throw new Erreur('forbidden', 'Aucune donnée : votre compte n’existe pas encore');
        }
        $pdo = $c->db->principale();
        $id = $u->id;

        $lignes = static function (string $sql, array $params = []) use ($pdo): array {
            $st = $pdo->prepare($sql);
            $st->execute($params);
            return self::dates($st->fetchAll());
        };

        $compte = $lignes('SELECT email, prenom, nom, pseudo, statut, couleur, demande_le, derniere_connexion, consentement_le, consentement_version, cree_le
                           FROM utilisateurs WHERE id = ?', [$id])[0] ?? [];
        $export = [
            'genere_le' => Temps::iso(Temps::maintenant()),
            'compte' => $compte,
            'roles' => $lignes(
                'SELECT a.role, e.nom AS etablissement, p.nom AS promo, pe.nom AS promo_etablissement, a.origine, a.cree_le
                 FROM attributions a LEFT JOIN etablissements e ON e.id = a.etablissement_id
                 LEFT JOIN promos p ON p.id = a.promo_id LEFT JOIN etablissements pe ON pe.id = p.etablissement_id WHERE a.utilisateur_id = ?',
                [$id]
            ),
            'demandes_acces' => $lignes('SELECT role, prenom, nom, statut, cree_le, traite_le FROM demandes_acces WHERE utilisateur_id = ?', [$id]),
            'demandes_changement_de_nom' => $lignes('SELECT prenom, nom, statut, cree_le, traite_le FROM demandes_nom WHERE utilisateur_id = ?', [$id]),
            'appartenances_groupes' => $lignes(
                'SELECT g.nom AS groupe, p.nom AS promo, e.nom AS etablissement, m.ajoute_le FROM membres m
                 JOIN groupes g ON g.id = m.groupe_id JOIN promos p ON p.id = g.promo_id JOIN etablissements e ON e.id = p.etablissement_id
                 WHERE m.utilisateur_id = ?',
                [$id]
            ),
            'fiches_de_lecture' => $lignes(
                'SELECT a.id, a.statut, a.priorite, a.mots, a.kw, a.concepts, a.objet, a.opinion, a.controverse, a.libre, a.portee, a.ajoute, a.modifie_le,
                        r.titre, r.auteur, r.parution, r.type, r.source, r.doi, r.lien
                 FROM analyses a JOIN articles r ON r.id = a.article_id WHERE a.utilisateur_id = ?',
                [$id]
            ),
            'articles_crees' => $lignes('SELECT id, titre, auteur, parution, type, source, doi, lien, ajoute FROM articles WHERE cree_par = ?', [$id]),
            'commentaires' => $lignes('SELECT id, analyse_id, texte, portee, cree_le, modifie_le FROM commentaires WHERE auteur_id = ?', [$id]),
            'notes_personnelles' => $lignes('SELECT id, titre, date, texte, liens, etiquettes, epingle, cree_le, modifie_le FROM notes WHERE utilisateur_id = ?', [$id]),
            'fichiers_joints' => $lignes('SELECT nom, type, taille, cree_le AS depose_le FROM fichiers WHERE cree_par = ?', [$id]),
            'retours_sur_l_outil' => $lignes('SELECT type, texte, contexte, jour, cree_le, statut FROM feedback WHERE auteur_id = ?', [$id]),
            'propositions_de_correction' => $lignes('SELECT article_id, valeurs, statut, cree_le, clos_le FROM propositions WHERE propose_par = ?', [$id]),
            'termes_du_glossaire_crees' => $lignes('SELECT mot, definition, reference, cree_le FROM glossaire WHERE cree_par = ?', [$id]),
            'reunions_creees' => $lignes('SELECT date, titre, participants, vu, attendu, suite, cree_le FROM reunions WHERE cree_par = ?', [$id]),
            'jalons_crees' => $lignes('SELECT titre, debut, echeance, statut, note, cree_le FROM jalons WHERE cree_par = ?', [$id]),
            'historique_de_mes_fiches' => $lignes('SELECT cible, cible_id, avant, modifie_le FROM historique WHERE proprietaire = ?', [$id]),
            'messages_chat' => [],
        ];
        try {
            $st = $c->db->chat()->prepare('SELECT canal, cree_le, texte FROM chat_messages WHERE auteur_id = ? ORDER BY id');
            $st->execute([$id]);
            $export['messages_chat'] = self::dates($st->fetchAll());
        } catch (\Throwable $e) {
            error_log('Export : chat illisible : ' . $e->getMessage());
        }
        return ['ok' => true, 'export' => $export];
    }

    /**
     * Dates de la base (« 2026-11-21 08:30:00 ») converties en ISO 8601.
     *
     * @param list<array<string,mixed>> $lignes
     * @return list<array<string,mixed>>
     */
    private static function dates(array $lignes): array
    {
        foreach ($lignes as &$l) {
            foreach ($l as $cle => $v) {
                if (is_string($v) && preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/', $v) === 1) {
                    $l[$cle] = Temps::iso($v);
                }
            }
        }
        return $lignes;
    }
}
