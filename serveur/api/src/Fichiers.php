<?php
declare(strict_types=1);

namespace Lpc;

/**
 * Pièces jointes : le contenu est dans le dossier privé (hors web), le chemin relatif en base.
 * Lot C : seulement le retrait des fichiers d'un article supprimé ; le dépôt et la lecture arrivent avec le lot D.
 */
final class Fichiers
{
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
        $racine = realpath($c->config->dossierPrive() . '/fichiers');
        if ($racine === false) {
            return;
        }
        foreach ($chemins as $chemin) {
            $reel = realpath($racine . '/' . $chemin);
            if ($reel !== false && str_starts_with($reel, $racine . DIRECTORY_SEPARATOR) && is_file($reel)) {
                @unlink($reel);
            }
        }
    }
}
