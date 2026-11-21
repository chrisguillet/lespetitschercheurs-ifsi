<?php
declare(strict_types=1);

namespace Lpc;

/**
 * Sauvegarde quotidienne des pièces jointes (l'hébergeur ne sauvegarde que les bases de données).
 *
 * Chaque jour, un instantané « fichiers-AAAA-MM-JJ » du dossier des pièces jointes est créé dans le dossier privé, en liens physiques
 * (aucun espace disque en plus : les fichiers ne sont jamais modifiés, seulement ajoutés ou supprimés). Les instantanés de plus de
 * 7 jours sont supprimés : un fichier effacé de l'application disparaît donc de la sauvegarde sous 7 jours au plus, comme pour les bases.
 * Si les liens physiques ne sont pas possibles (autre disque), le fichier est copié.
 */
final class Sauvegarde
{
    public const JOURS = 7;
    private const MOTIF = '/^fichiers-(\d{4})-(\d{2})-(\d{2})$/';

    /**
     * @return array{instantane:string,ajoutes:int,copies:int,supprimes:list<string>}
     */
    public static function fichiers(string $prive, int $maintenant, int $jours = self::JOURS): array
    {
        $source = $prive . '/fichiers';
        $racine = $prive . '/sauvegardes';
        $nom = 'fichiers-' . gmdate('Y-m-d', $maintenant);
        $dest = $racine . '/' . $nom;
        if (!is_dir($racine) && !mkdir($racine, 0700, true) && !is_dir($racine)) {
            throw new \RuntimeException('Dossier des sauvegardes inaccessible');
        }
        if (!is_dir($dest) && !mkdir($dest, 0700) && !is_dir($dest)) {
            throw new \RuntimeException('Instantané impossible à créer');
        }
        $ajoutes = 0;
        $copies = 0;
        if (is_dir($source)) {
            foreach (scandir($source) ?: [] as $f) {
                $depuis = $source . '/' . $f;
                if ($f === '.' || $f === '..' || !is_file($depuis) || is_link($depuis) || file_exists($dest . '/' . $f)) {
                    continue;
                }
                if (@link($depuis, $dest . '/' . $f)) {
                    $ajoutes++;
                } elseif (copy($depuis, $dest . '/' . $f)) {
                    $ajoutes++;
                    $copies++;
                } else {
                    throw new \RuntimeException('Fichier non sauvegardé : ' . $f);
                }
            }
        }
        return ['instantane' => $nom, 'ajoutes' => $ajoutes, 'copies' => $copies, 'supprimes' => self::purger($racine, $maintenant, $jours)];
    }

    /** Supprime les instantanés datés d'il y a $jours jours ou plus. @return list<string> noms supprimés */
    public static function purger(string $racine, int $maintenant, int $jours): array
    {
        $limite = gmdate('Y-m-d', $maintenant - $jours * 86400);
        $supprimes = [];
        foreach (scandir($racine) ?: [] as $d) {
            if (preg_match(self::MOTIF, $d, $m) !== 1 || is_link($racine . '/' . $d) || !is_dir($racine . '/' . $d)) {
                continue;   // seuls nos propres dossiers datés sont touchés
            }
            if ($m[1] . '-' . $m[2] . '-' . $m[3] > $limite) {
                continue;
            }
            foreach (scandir($racine . '/' . $d) ?: [] as $f) {
                if ($f !== '.' && $f !== '..' && is_file($racine . '/' . $d . '/' . $f)) {
                    @unlink($racine . '/' . $d . '/' . $f);
                }
            }
            if (@rmdir($racine . '/' . $d)) {
                $supprimes[] = $d;
            }
        }
        sort($supprimes);
        return $supprimes;
    }
}
