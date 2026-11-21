<?php
// Petits outils partagés par les tests (aucune dépendance).
declare(strict_types=1);

use Lpc\Erreur;

$GLOBALS['lpc_total'] = 0;
$GLOBALS['lpc_echecs'] = 0;

function verifie(string $nom, bool $condition): void
{
    $GLOBALS['lpc_total']++;
    if ($condition) {
        echo "ok     $nom\n";
        return;
    }
    $GLOBALS['lpc_echecs']++;
    echo "ÉCHEC  $nom\n";
}

/** Vrai si $f lève une Erreur du code donné (et dont le message contient $message, s'il est fourni). */
function leve(callable $f, string $code, ?string $message = null): bool
{
    try {
        $f();
    } catch (Erreur $e) {
        return $e->codeErreur === $code && ($message === null || str_contains($e->getMessage(), $message));
    }
    return false;
}

/** Vrai si $f lève une exception SQL dont le SQLSTATE est $etat (23000 = contrainte d'intégrité, 22001 = valeur trop longue). */
function leveSql(callable $f, string $etat): bool
{
    try {
        $f();
    } catch (PDOException $e) {
        return (string) $e->getCode() === $etat;
    }
    return false;
}

/** Vrai si $f lève une exception SQL, quel que soit son code. */
function refuseSql(callable $f): bool
{
    try {
        $f();
    } catch (PDOException $e) {
        return true;
    }
    return false;
}

function b64u(string $s): string
{
    return rtrim(strtr(base64_encode($s), '+/', '-_'), '=');
}

/** Jeton Google de test, signé avec la clé privée $cle (kid « cle-de-test »). */
function fabrique($cle, array $charge, array $entete = []): string
{
    $entete = array_merge(['alg' => 'RS256', 'typ' => 'JWT', 'kid' => 'cle-de-test'], $entete);
    $h = b64u(json_encode($entete));
    $p = b64u(json_encode($charge));
    openssl_sign($h . '.' . $p, $signature, $cle, OPENSSL_ALGO_SHA256);
    return $h . '.' . $p . '.' . b64u($signature);
}

/** Paire de clés RSA de test et sa représentation JWK (celle que Google publierait). */
function pairedeCles(): array
{
    $cle = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
    $d = openssl_pkey_get_details($cle);
    $jwk = ['kty' => 'RSA', 'kid' => 'cle-de-test', 'alg' => 'RS256', 'use' => 'sig', 'n' => b64u($d['rsa']['n']), 'e' => b64u($d['rsa']['e'])];
    return [$cle, $jwk, $d['key']];
}

function bilan(): never
{
    echo "\n{$GLOBALS['lpc_total']} vérifications, {$GLOBALS['lpc_echecs']} échec(s)\n";
    exit($GLOBALS['lpc_echecs'] === 0 ? 0 : 1);
}
