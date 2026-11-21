<?php
declare(strict_types=1);

namespace Lpc;

/**
 * Pièces jointes d'un article (PDF, PNG, JPEG) : le contenu est dans le dossier privé du serveur (hors web), jamais public ;
 * seul le chemin relatif est en base. Une pièce jointe par article, 5 Mo au plus, type déduit du contenu (jamais de ce que déclare
 * le navigateur). Les images dépassant 1600 px sont réduites à l'envoi. Un groupe peut avoir un quota d'espace.
 */
final class Fichiers
{
    public const MAX_OCTETS = 5 * 1024 * 1024;
    public const PAR_ARTICLE = 1;
    public const COTE_MAX = 1600;

    /** Fichiers des articles que la personne voit (mêmes règles que les fiches de lecture). @return list<array<string,mixed>> */
    public static function pourClient(Contexte $c): array
    {
        if ($c->user->id === null) {
            return [];
        }
        $pdo = $c->db->principale();
        [$where, $params] = Lectures::filtreVisible($c);
        $st = $pdo->prepare(
            "SELECT f.id, f.article_id, f.nom, f.type, f.taille, f.cree_par, f.cree_le, u.prenom, u.nom AS u_nom, u.pseudo, g0.promo_id
             FROM fichiers f JOIN articles r ON r.id = f.article_id JOIN groupes g0 ON g0.id = r.groupe_id LEFT JOIN utilisateurs u ON u.id = f.cree_par
             WHERE f.article_id IN (SELECT a.article_id FROM analyses a JOIN groupes g ON g.id = a.groupe_id WHERE $where)
             ORDER BY f.cree_le, f.id"
        );
        $st->execute($params);
        $s = $pdo->prepare('SELECT article_id FROM analyses WHERE utilisateur_id = ?');
        $s->execute([$c->user->id]);
        $miens = array_flip(array_map('strval', $s->fetchAll(\PDO::FETCH_COLUMN)));
        $out = [];
        foreach ($st->fetchAll() as $f) {
            $out[] = [
                'id' => (string) $f['id'], 'article_id' => (string) $f['article_id'], 'nom' => (string) $f['nom'], 'type' => (string) $f['type'],
                'taille' => (int) $f['taille'],
                'par' => $f['prenom'] === null ? 'Utilisateur supprimé' : Utilisateur::nomAffiche((string) $f['prenom'], (string) $f['u_nom'], $f['pseudo'] === null ? null : (string) $f['pseudo']),
                'cree_le' => Temps::iso((string) $f['cree_le']),
                'supprimable' => ($f['cree_par'] !== null && (int) $f['cree_par'] === $c->user->id) || isset($miens[(string) $f['article_id']])
                    || $c->droits()->peutAdministrerPromo((string) $f['promo_id']),
            ];
        }
        return $out;
    }

    /** Dépose le fichier (contenu en base64) sur un article, depuis sa propre fiche de lecture ou en tant qu'admin de la promo. */
    public static function ajouter(Contexte $c, string $articleId, mixed $nom, mixed $base64): void
    {
        $art = Lectures::articleVisible($c, $articleId);
        $d = $c->droits();
        $pdo = $c->db->principale();
        if (!$d->peutAdministrerPromo((string) $art['promo_id'])) {
            if (!$d->estEtudiant()) {
                throw new Erreur('forbidden', 'Accès en lecture seule');
            }
            if (!Lectures::articleModifiable($c, $art)) {
                throw new Erreur('forbidden', 'Réservé aux étudiantes de la promo');
            }
            if (!self::aFiche($pdo, (string) $art['id'], (int) $c->user->id)) {
                throw new Erreur('forbidden', 'Joignez le fichier depuis votre fiche de lecture de cet article');
            }
        }
        $b64 = is_string($base64) ? $base64 : '';
        if ($b64 === '') {
            throw new Erreur('invalid', 'Fichier vide');
        }
        if (strlen($b64) > intdiv(self::MAX_OCTETS * 4, 3) + 16) {
            throw new Erreur('invalid', 'Fichier trop volumineux (5 Mo maximum)');
        }
        $octets = base64_decode($b64, true);
        if ($octets === false) {
            throw new Erreur('invalid', 'Fichier illisible');
        }
        if ($octets === '') {
            throw new Erreur('invalid', 'Fichier vide');
        }
        if (strlen($octets) > self::MAX_OCTETS) {
            throw new Erreur('invalid', 'Fichier trop volumineux (5 Mo maximum)');
        }
        $t = self::type($octets);
        if ($t === null) {
            throw new Erreur('invalid', 'Format non accepté : PDF, PNG ou JPEG uniquement');
        }
        $st = $pdo->prepare('SELECT COUNT(*) FROM fichiers WHERE article_id = ?');
        $st->execute([$art['id']]);
        if ((int) $st->fetchColumn() >= self::PAR_ARTICLE) {
            throw new Erreur('invalid', 'Un seul fichier par article : supprimez le fichier actuel avant d’en ajouter un autre');
        }
        if ($t['type'] !== 'application/pdf') {
            $octets = self::reduire($octets, $t['type']);
        }
        self::verifierQuota($pdo, $art, strlen($octets));

        $id = Ids::uuid();
        $chemin = $id . $t['ext'];
        $dossier = $c->config->dossierPrive() . '/fichiers';
        if (!is_dir($dossier) && !mkdir($dossier, 0700, true) && !is_dir($dossier)) {
            throw new Erreur('server', 'Stockage des pièces jointes indisponible');
        }
        if (file_put_contents($dossier . '/' . $chemin, $octets, LOCK_EX) === false) {
            throw new Erreur('server', 'Fichier non enregistré');
        }
        try {
            $pdo->prepare('INSERT INTO fichiers (id, article_id, nom, type, taille, chemin, cree_par, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
                ->execute([$id, $art['id'], self::nomDeFichier($nom, $t['ext']), $t['type'], strlen($octets), $chemin, $c->user->id, Temps::maintenant()]);
        } catch (\Throwable $e) {
            @unlink($dossier . '/' . $chemin);
            throw $e;
        }
    }

    /** Le contenu passe par le serveur : un fichier n'a jamais de lien public. @return array<string,string> */
    public static function lire(Contexte $c, string $id): array
    {
        $f = self::fichierVisible($c, $id);
        $reel = self::cheminReel($c, (string) $f['chemin']);
        $octets = $reel === null ? false : file_get_contents($reel);
        if ($octets === false) {
            throw new Erreur('not_found', 'Fichier introuvable sur le serveur');
        }
        return ['nom' => (string) $f['nom'], 'type' => (string) $f['type'], 'data' => base64_encode($octets)];
    }

    /** Tout propriétaire d'une fiche sur l'article peut gérer le fichier (donc le remplacer), quel que soit celui qui l'a déposé ; un admin de la promo aussi. */
    public static function supprimer(Contexte $c, string $id): void
    {
        $f = self::fichierVisible($c, $id);
        $pdo = $c->db->principale();
        $auteur = $f['cree_par'] !== null && (int) $f['cree_par'] === $c->user->id;
        if (!$auteur && !self::aFiche($pdo, (string) $f['article_id'], (int) $c->user->id) && !$c->droits()->peutAdministrerPromo((string) $f['promo_id'])) {
            throw new Erreur('forbidden', 'Réservé aux autrices d’une fiche de lecture sur ce document (ou à l’administrateur)');
        }
        $pdo->prepare('DELETE FROM fichiers WHERE id = ?')->execute([$id]);
        self::supprimerDuDisque($c, [(string) $f['chemin']]);
    }

    /** Supprime du disque les fichiers d'un article (les lignes de la base disparaissent avec l'article, par cascade). */
    public static function retirerFichiersArticle(Contexte $c, \PDO $pdo, string $articleId): void
    {
        $st = $pdo->prepare('SELECT chemin FROM fichiers WHERE article_id = ?');
        $st->execute([$articleId]);
        self::supprimerDuDisque($c, array_map('strval', $st->fetchAll(\PDO::FETCH_COLUMN)));
    }

    /** @param list<string> $chemins chemins relatifs au dossier des fichiers ; ce qui sortirait de ce dossier est ignoré */
    public static function supprimerDuDisque(Contexte $c, array $chemins): void
    {
        foreach ($chemins as $chemin) {
            $reel = self::cheminReel($c, $chemin);
            if ($reel !== null) {
                @unlink($reel);
            }
        }
    }

    /** Le type est déduit du début du contenu. @return array{type:string,ext:string}|null */
    public static function type(string $octets): ?array
    {
        if (str_starts_with($octets, '%PDF')) {
            return ['type' => 'application/pdf', 'ext' => '.pdf'];
        }
        if (str_starts_with($octets, "\x89PNG")) {
            return ['type' => 'image/png', 'ext' => '.png'];
        }
        if (str_starts_with($octets, "\xff\xd8\xff")) {
            return ['type' => 'image/jpeg', 'ext' => '.jpg'];
        }
        return null;
    }

    public static function nomDeFichier(mixed $nom, string $ext): string
    {
        $parts = preg_split('#[\\\\/]#', is_scalar($nom) ? (string) $nom : '') ?: [''];
        $n = (string) end($parts);
        $n = (string) preg_replace('/[\x00-\x1f<>:"|?*]/u', ' ', $n);
        $n = trim((string) preg_replace('/^[.\s]+/u', '', (string) preg_replace('/\s+/u', ' ', $n)));
        $n = trim(mb_substr((string) preg_replace('/\.(pdf|png|jpe?g)$/i', '', $n), 0, 100));
        return ($n !== '' ? $n : 'document') . $ext;
    }

    /** Réduit une image dont un côté dépasse COTE_MAX (GD) ; renvoie l'original si GD manque, si l'image est déjà petite ou si le résultat n'est pas plus léger. */
    public static function reduire(string $octets, string $type): string
    {
        if (!function_exists('imagecreatefromstring') || !function_exists('imagescale')) {
            return $octets;
        }
        $im = @imagecreatefromstring($octets);
        if ($im === false) {
            return $octets;
        }
        $l = imagesx($im);
        $h = imagesy($im);
        if (max($l, $h) <= self::COTE_MAX) {
            return $octets;
        }
        $facteur = self::COTE_MAX / max($l, $h);
        $petit = imagescale($im, max(1, (int) round($l * $facteur)), max(1, (int) round($h * $facteur)));
        if ($petit === false) {
            return $octets;
        }
        ob_start();
        if ($type === 'image/png') {
            imagesavealpha($petit, true);
            imagepng($petit, null, 6);
        } else {
            imagejpeg($petit, null, 85);
        }
        $sortie = (string) ob_get_clean();
        return $sortie !== '' && strlen($sortie) < strlen($octets) ? $sortie : $octets;
    }

    // ---------- Interne ----------

    /** @return array<string,mixed> */
    private static function fichierVisible(Contexte $c, string $id): array
    {
        $st = $c->db->principale()->prepare('SELECT f.id, f.article_id, f.nom, f.type, f.chemin, f.cree_par, g.promo_id FROM fichiers f
                                             JOIN articles r ON r.id = f.article_id JOIN groupes g ON g.id = r.groupe_id WHERE f.id = ?');
        $st->execute([$id]);
        $f = $st->fetch();
        if ($f === false) {
            throw new Erreur('not_found', 'Fichier introuvable');
        }
        Lectures::articleVisible($c, (string) $f['article_id']);   // mêmes droits que l'article
        return $f;
    }

    private static function aFiche(\PDO $pdo, string $articleId, int $uid): bool
    {
        $st = $pdo->prepare('SELECT 1 FROM analyses WHERE article_id = ? AND utilisateur_id = ?');
        $st->execute([$articleId, $uid]);
        return $st->fetchColumn() !== false;
    }

    /** Quota d'espace du groupe de l'article (NULL = pas de quota), fichiers déjà déposés compris. @param array<string,mixed> $art */
    private static function verifierQuota(\PDO $pdo, array $art, int $taille): void
    {
        if ($art['groupe_id'] === null) {
            return;
        }
        $st = $pdo->prepare('SELECT quota_octets FROM groupes WHERE id = ?');
        $st->execute([$art['groupe_id']]);
        $quota = $st->fetchColumn();
        if ($quota === false || $quota === null) {
            return;
        }
        $st = $pdo->prepare('SELECT COALESCE(SUM(f.taille), 0) FROM fichiers f JOIN articles r ON r.id = f.article_id WHERE r.groupe_id = ?');
        $st->execute([$art['groupe_id']]);
        if ((int) $st->fetchColumn() + $taille > (int) $quota) {
            throw new Erreur('invalid', 'Le quota d’espace du groupe est atteint : supprimez un fichier avant d’en ajouter un autre');
        }
    }

    /** Chemin réel d'un fichier, seulement s'il est bien dans le dossier des fichiers. */
    private static function cheminReel(Contexte $c, string $chemin): ?string
    {
        $racine = realpath($c->config->dossierPrive() . '/fichiers');
        if ($racine === false) {
            return null;
        }
        $reel = realpath($racine . '/' . $chemin);
        return $reel !== false && str_starts_with($reel, $racine . DIRECTORY_SEPARATOR) && is_file($reel) ? $reel : null;
    }
}
