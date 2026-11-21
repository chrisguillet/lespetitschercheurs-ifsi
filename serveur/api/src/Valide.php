<?php
declare(strict_types=1);

namespace Lpc;

/** Validation des saisies : mêmes limites et mêmes messages que l'ancien Code.gs, sauf règles d'identité décrites dans le README. */
final class Valide
{
    public const NOM_MAX = 60;
    public const PSEUDO_MAX = 40;
    public const PRENOM_MAX = 40;

    /** Espaces de tête et de queue retirés, espaces multiples réduits à un seul ; chaîne vide si la valeur n'est pas un texte. */
    public static function espaces(mixed $v): string
    {
        if (!is_scalar($v)) {
            return '';
        }
        $t = preg_replace('/\s+/u', ' ', trim((string) $v));
        return is_string($t) ? $t : '';
    }

    /** Nom d'un établissement, d'une promo ou d'un groupe. */
    public static function nom(mixed $v, string $libelle): string
    {
        $t = self::espaces($v);
        if ($t === '') {
            throw new Erreur('invalid', $libelle . ' vide');
        }
        if (mb_strlen($t) > self::NOM_MAX) {
            throw new Erreur('invalid', $libelle . ' trop long (' . self::NOM_MAX . ' caractères maximum)');
        }
        return $t;
    }

    /** Pseudo : libre et modifiable. Vide = pas de pseudo (le nom affiché redevient « prénom + initiale »). */
    public static function pseudo(mixed $v): ?string
    {
        $t = self::espaces($v);
        if ($t === '') {
            return null;
        }
        if (mb_strlen($t) > self::PSEUDO_MAX) {
            throw new Erreur('invalid', 'Pseudo trop long (' . self::PSEUDO_MAX . ' caractères maximum)');
        }
        if (preg_match('/^[\p{L}\p{N}][\p{L}\p{N}\'’ ._-]*$/u', $t) !== 1) {
            throw new Erreur('invalid', 'Pseudo invalide (lettres, chiffres, espace, apostrophe, point et tiret)');
        }
        if (mb_strtolower($t) === 'administrateur') {
            throw new Erreur('invalid', 'Ce pseudo est réservé');
        }
        return $t;
    }

    /** Prénom légal : lettres, espaces, apostrophes et tirets. */
    public static function prenom(mixed $v): string
    {
        $t = self::espaces($v);
        if ($t === '') {
            throw new Erreur('invalid', 'Prénom requis');
        }
        if (mb_strlen($t) > self::PRENOM_MAX || preg_match('/^\p{L}[\p{L}\'’ -]*$/u', $t) !== 1) {
            throw new Erreur('invalid', 'Prénom invalide (lettres uniquement)');
        }
        return $t;
    }

    /** Nom de famille légal : mêmes caractères que le prénom. */
    public static function familleNom(mixed $v): string
    {
        $t = self::espaces($v);
        if ($t === '') {
            throw new Erreur('invalid', 'Nom requis');
        }
        if (mb_strlen($t) > self::NOM_MAX || preg_match('/^\p{L}[\p{L}\'’ -]*$/u', $t) !== 1) {
            throw new Erreur('invalid', 'Nom invalide (lettres uniquement)');
        }
        return $t;
    }

    /** Charge utile « data » d'une requête : un objet JSON obligatoire. @return array<string,mixed> */
    public static function donnees(array $req): array
    {
        $d = $req['data'] ?? null;
        if (!is_array($d) || array_is_list($d) && $d !== []) {
            throw new Erreur('invalid', 'Données manquantes');
        }
        return $d;
    }
}
