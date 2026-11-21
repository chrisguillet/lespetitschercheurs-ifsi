<?php
declare(strict_types=1);

namespace Lpc;

/** Identifiants : UUID v4 (comme Utilities.getUuid), identifiant public d'une personne, jetons d'invitation. */
final class Ids
{
    public static function uuid(): string
    {
        $o = random_bytes(16);
        $o[6] = chr((ord($o[6]) & 0x0f) | 0x40);
        $o[8] = chr((ord($o[8]) & 0x3f) | 0x80);
        $h = bin2hex($o);
        return sprintf('%s-%s-%s-%s-%s', substr($h, 0, 8), substr($h, 8, 4), substr($h, 12, 4), substr($h, 16, 4), substr($h, 20, 12));
    }

    /** Même calcul que pid_ dans l'ancien Code.gs : 12 premiers caractères du SHA-256 de « pid:<adresse> » en base64 « web-safe ». */
    public static function pid(string $email): string
    {
        $b64 = rtrim(strtr(base64_encode(hash('sha256', 'pid:' . $email, true)), '+/', '-_'), '=');
        return substr($b64, 0, 12);
    }

    /** Jeton d'invitation : 32 octets aléatoires, affichés en base64 « web-safe ». Seul son SHA-256 est enregistré. */
    public static function jeton(): string
    {
        return rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
    }

    public static function hacher(string $jeton): string
    {
        return hash('sha256', $jeton);
    }
}
