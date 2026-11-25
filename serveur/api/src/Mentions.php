<?php
declare(strict_types=1);

namespace Lpc;

/**
 * Mentions (« tags ») entre camarades : un étudiant signale à un autre étudiant d'un de ses groupes un document, une fiche de lecture
 * (ou rien de précis), avec un mot facultatif. Visibles du seul expéditeur et du seul destinataire ; effacées avec l'un ou l'autre compte.
 */
final class Mentions
{
    public const DESCRIPTION_MAX = 500;
    public const NON_LUES_MAX = 100;
    public const PAR_JOUR_MAX = 50;
    public const RECUES_MAX = 60;

    /** @return array<string,mixed> section « mentions » des données : reçues (récentes d'abord), envoyées, nombre de non lues */
    public static function pourClient(Contexte $c): array
    {
        $vide = ['recues' => [], 'envoyees' => [], 'non_lues' => 0];
        if ($c->user->id === null || $c->user->accueil) {
            return $vide;
        }
        $pdo = $c->db->principale();
        $uid = (int) $c->user->id;
        $st = $pdo->prepare('SELECT COUNT(*) FROM mentions WHERE a_id = ? AND lue_le IS NULL');
        $st->execute([$uid]);
        $nonLues = (int) $st->fetchColumn();
        $st = $pdo->prepare(
            'SELECT m.*, u.prenom, u.nom AS u_nom, u.pseudo, u.couleur FROM mentions m JOIN utilisateurs u ON u.id = m.de_id
             WHERE m.a_id = ? ORDER BY m.cree_le DESC, m.id DESC LIMIT ' . self::RECUES_MAX
        );
        $st->execute([$uid]);
        $recues = [];
        foreach ($st->fetchAll() as $r) {
            $recues[] = self::ligne($r) + ['de' => Membres::affiche(['prenom' => $r['prenom'], 'nom' => $r['u_nom'], 'pseudo' => $r['pseudo']]), 'couleur' => (string) $r['couleur'], 'lue' => $r['lue_le'] !== null];
        }
        $st = $pdo->prepare(
            'SELECT m.*, u.prenom, u.nom AS u_nom, u.pseudo FROM mentions m JOIN utilisateurs u ON u.id = m.a_id
             WHERE m.de_id = ? ORDER BY m.cree_le DESC, m.id DESC LIMIT 20'
        );
        $st->execute([$uid]);
        $envoyees = [];
        foreach ($st->fetchAll() as $r) {
            $envoyees[] = self::ligne($r) + ['a' => Membres::affiche(['prenom' => $r['prenom'], 'nom' => $r['u_nom'], 'pseudo' => $r['pseudo']]), 'lue' => $r['lue_le'] !== null];
        }
        return ['recues' => $recues, 'envoyees' => $envoyees, 'non_lues' => $nonLues];
    }

    /**
     * Envoie une mention à un camarade (identifiant public « pid »), à propos d'une fiche (analyse_id) ou d'un document (article_id), au choix.
     *
     * @param array<string,mixed> $req
     */
    public static function envoyer(Contexte $c, array $req): void
    {
        $pdo = $c->db->principale();
        $uid = (int) $c->user->id;
        $pid = is_string($req['pid'] ?? null) ? $req['pid'] : '';
        $desc = is_scalar($req['description'] ?? null) ? trim((string) $req['description']) : '';
        if (mb_strlen($desc) > self::DESCRIPTION_MAX) {
            throw new Erreur('invalid', 'Message trop long (' . self::DESCRIPTION_MAX . ' caractères maximum)');
        }
        // Destinataire : un étudiant actif, dans un groupe dont l'expéditeur est aussi étudiant.
        $st = $pdo->prepare(
            "SELECT DISTINCT u.id, g.promo_id FROM utilisateurs u
             JOIN membres m1 ON m1.utilisateur_id = u.id
             JOIN membres m2 ON m2.groupe_id = m1.groupe_id AND m2.utilisateur_id = ?
             JOIN groupes g ON g.id = m1.groupe_id
             WHERE u.pid = ? AND u.statut = 'actif' AND u.id <> ?
               AND EXISTS (SELECT 1 FROM attributions a WHERE a.utilisateur_id = u.id AND a.role = 'etudiant' AND a.promo_id = g.promo_id)"
        );
        $st->execute([$uid, $pid, $uid]);
        $dest = null;
        foreach ($st->fetchAll() as $r) {
            if ($c->droits()->estEtudiantDans((string) $r['promo_id'])) {
                $dest = (int) $r['id'];
                break;
            }
        }
        if ($dest === null) {
            throw new Erreur('forbidden', 'Vous ne pouvez taguer qu’un étudiant de l’un de vos groupes');
        }
        // Cible facultative.
        $articleId = null;
        $analyseId = null;
        $titre = '';
        if (is_string($req['analyse_id'] ?? null) && $req['analyse_id'] !== '') {
            $st = $pdo->prepare('SELECT a.id, a.article_id, r.titre FROM analyses a JOIN articles r ON r.id = a.article_id WHERE a.id = ?');
            $st->execute([$req['analyse_id']]);
            $r = $st->fetch();
            if ($r === false) {
                throw new Erreur('not_found', 'Fiche de lecture introuvable');
            }
            $analyseId = (string) $r['id'];
            $articleId = (string) $r['article_id'];
            $titre = (string) $r['titre'];
        } elseif (is_string($req['article_id'] ?? null) && $req['article_id'] !== '') {
            $st = $pdo->prepare('SELECT id, titre FROM articles WHERE id = ?');
            $st->execute([$req['article_id']]);
            $r = $st->fetch();
            if ($r === false) {
                throw new Erreur('not_found', 'Document introuvable');
            }
            $articleId = (string) $r['id'];
            $titre = (string) $r['titre'];
        }
        if ($articleId === null && $desc === '') {
            throw new Erreur('invalid', 'Écrivez un message ou choisissez un document à signaler');
        }
        // Garde-fous contre l'envoi en rafale.
        $st = $pdo->prepare('SELECT COUNT(*) FROM mentions WHERE de_id = ? AND cree_le > ?');
        $st->execute([$uid, date('Y-m-d H:i:s', time() - 86400)]);
        if ((int) $st->fetchColumn() >= self::PAR_JOUR_MAX) {
            throw new Erreur('limit', 'Trop de tags envoyés aujourd’hui : réessayez demain');
        }
        $st = $pdo->prepare('SELECT COUNT(*) FROM mentions WHERE a_id = ? AND lue_le IS NULL');
        $st->execute([$dest]);
        if ((int) $st->fetchColumn() >= self::NON_LUES_MAX) {
            throw new Erreur('limit', 'Cette personne a déjà beaucoup de tags à lire');
        }
        $pdo->prepare('INSERT INTO mentions (id, de_id, a_id, article_id, analyse_id, titre, description, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            ->execute([Ids::uuid(), $uid, $dest, $articleId, $analyseId, mb_substr($titre, 0, 500), $desc, Temps::maintenant()]);
    }

    /** Marque comme lues des mentions reçues (liste d'identifiants), ou toutes avec « tout ». @param mixed $ids */
    public static function marquerLues(Contexte $c, mixed $ids, bool $tout): void
    {
        if ($c->user->id === null) {
            return;
        }
        $pdo = $c->db->principale();
        $now = Temps::maintenant();
        if ($tout) {
            $pdo->prepare('UPDATE mentions SET lue_le = ? WHERE a_id = ? AND lue_le IS NULL')->execute([$now, $c->user->id]);
            return;
        }
        $ids = is_array($ids) ? array_slice(array_values(array_unique(array_filter($ids, 'is_string'))), 0, 200) : [];
        if ($ids === []) {
            return;
        }
        $pdo->prepare('UPDATE mentions SET lue_le = ? WHERE lue_le IS NULL AND a_id = ? AND id IN (' . Lectures::marques(count($ids)) . ')')
            ->execute([$now, $c->user->id, ...$ids]);
    }

    /** Supprime une mention : par son destinataire (elle disparaît de sa liste) ou par son expéditeur (elle est retirée). */
    public static function supprimer(Contexte $c, mixed $id): void
    {
        $st = $c->db->principale()->prepare('DELETE FROM mentions WHERE id = ? AND (a_id = ? OR de_id = ?)');
        $st->execute([is_string($id) ? $id : '', $c->user->id, $c->user->id]);
        if ($st->rowCount() === 0) {
            throw new Erreur('not_found', 'Tag introuvable');
        }
    }

    /** @param array<string,mixed> $r @return array<string,mixed> */
    private static function ligne(array $r): array
    {
        return ['id' => (string) $r['id'], 'article_id' => $r['article_id'] === null ? '' : (string) $r['article_id'],
            'analyse_id' => $r['analyse_id'] === null ? '' : (string) $r['analyse_id'], 'titre' => (string) $r['titre'],
            'description' => (string) ($r['description'] ?? ''), 'cree_le' => Temps::iso((string) $r['cree_le'])];
    }
}
