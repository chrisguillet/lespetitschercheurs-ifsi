<?php
declare(strict_types=1);

namespace Lpc;

/**
 * Vérifie localement un jeton d'identité Google (ID token, JWT signé RS256) :
 * signature par les clés publiques de Google (mises en cache sur disque), émetteur, audience (notre identifiant client),
 * expiration et adresse vérifiée. Aucun appel réseau par requête : seules les clés sont téléchargées, au plus une fois par heure.
 */
final class GoogleJeton
{
    private const URL_CLES = 'https://www.googleapis.com/oauth2/v3/certs';
    private const EMETTEURS = ['https://accounts.google.com', 'accounts.google.com'];
    private const DUREE_CACHE_DEFAUT_S = 3600;
    private const RAFRAICHIR_MIN_S = 300;     // un kid inconnu ne déclenche pas plus d'un téléchargement par 5 minutes
    private const AVANCE_MAX_S = 120;         // tolérance sur la date d'émission (horloges)

    /** @var callable(string): array{corps:string,max_age:?int} */
    private $recuperer;

    /** @param null|callable(string): array{corps:string,max_age:?int} $recuperer remplaçable dans les tests */
    public function __construct(private string $clientId, private string $dossierCache, ?callable $recuperer = null)
    {
        $this->recuperer = $recuperer ?? [self::class, 'telecharger'];
    }

    /** @return array{email:string,exp:int} */
    public function verifier(string $jeton, ?int $maintenant = null): array
    {
        $maintenant ??= time();
        $parties = explode('.', $jeton);
        if (count($parties) !== 3 || strlen($jeton) > 4096) {
            throw new Erreur('unauthorized', 'Jeton invalide');
        }
        [$h, $p, $s] = $parties;
        $entete = json_decode(self::base64url($h), true);
        $charge = json_decode(self::base64url($p), true);
        $signature = self::base64url($s);
        if (
            !is_array($entete) || !is_array($charge) || $signature === ''
            || ($entete['alg'] ?? null) !== 'RS256' || !is_string($entete['kid'] ?? null)
        ) {
            throw new Erreur('unauthorized', 'Jeton invalide');
        }

        $pem = $this->clePublique($entete['kid']);
        if (openssl_verify($h . '.' . $p, $signature, $pem, OPENSSL_ALGO_SHA256) !== 1) {
            throw new Erreur('unauthorized', 'Jeton invalide');
        }

        if (!in_array($charge['iss'] ?? null, self::EMETTEURS, true) || ($charge['aud'] ?? null) !== $this->clientId) {
            throw new Erreur('unauthorized', 'Jeton invalide');
        }
        $exp = (int) ($charge['exp'] ?? 0);
        if ($exp <= $maintenant) {
            throw new Erreur('unauthorized', 'Session expirée, reconnectez-vous');
        }
        if ((int) ($charge['iat'] ?? 0) > $maintenant + self::AVANCE_MAX_S) {
            throw new Erreur('unauthorized', 'Jeton invalide');
        }
        $verifie = $charge['email_verified'] ?? false;
        if ($verifie !== true && $verifie !== 'true') {
            throw new Erreur('unauthorized', 'Adresse non vérifiée');
        }
        $email = strtolower(trim((string) ($charge['email'] ?? '')));
        if ($email === '') {
            throw new Erreur('unauthorized', 'Jeton invalide');
        }
        return ['email' => $email, 'exp' => $exp];
    }

    /** Clé RSA publique (format PEM) d'un identifiant de clé (kid) de Google. */
    private function clePublique(string $kid): string
    {
        $jwk = $this->trouver($this->chargerCles(false), $kid);
        if ($jwk === null) {
            $jwk = $this->trouver($this->chargerCles(true), $kid);
        }
        if ($jwk === null) {
            throw new Erreur('unauthorized', 'Jeton invalide');
        }
        return self::pem((string) $jwk['n'], (string) $jwk['e']);
    }

    /**
     * @param list<array<string,mixed>> $cles
     * @return array<string,mixed>|null
     */
    private function trouver(array $cles, string $kid): ?array
    {
        foreach ($cles as $jwk) {
            if (($jwk['kid'] ?? null) === $kid && ($jwk['kty'] ?? null) === 'RSA' && isset($jwk['n'], $jwk['e'])) {
                return $jwk;
            }
        }
        return null;
    }

    /** @return list<array<string,mixed>> */
    private function chargerCles(bool $forcer): array
    {
        $fichier = $this->dossierCache . '/google-jwks.json';
        $cache = null;
        $brut = is_file($fichier) ? file_get_contents($fichier) : false;
        if ($brut !== false) {
            $d = json_decode($brut, true);
            if (is_array($d) && isset($d['recu'], $d['expire'], $d['cles']) && is_array($d['cles'])) {
                $cache = $d;
            }
        }
        $maintenant = time();
        if ($cache !== null) {
            if (!$forcer && $cache['expire'] > $maintenant) {
                return $cache['cles'];
            }
            if ($forcer && $maintenant - $cache['recu'] < self::RAFRAICHIR_MIN_S) {
                return $cache['cles'];
            }
        }

        try {
            $rep = ($this->recuperer)(self::URL_CLES);
            $jwks = json_decode($rep['corps'], true);
            if (!is_array($jwks) || !isset($jwks['keys']) || !is_array($jwks['keys']) || $jwks['keys'] === []) {
                throw new \RuntimeException('Réponse inattendue');
            }
        } catch (\Throwable $e) {
            error_log('Clés Google indisponibles : ' . $e->getMessage());
            if ($cache !== null) {
                return $cache['cles'];   // mieux vaut des clés périmées que pas de connexion du tout
            }
            throw new Erreur('server', 'Vérification de la connexion indisponible, réessayez');
        }

        $cles = array_values($jwks['keys']);
        $this->ecrireCache($fichier, [
            'recu' => $maintenant,
            'expire' => $maintenant + ($rep['max_age'] ?? self::DUREE_CACHE_DEFAUT_S),
            'cles' => $cles,
        ]);
        return $cles;
    }

    /** @param array<string,mixed> $donnees */
    private function ecrireCache(string $fichier, array $donnees): void
    {
        $dossier = dirname($fichier);
        if (!is_dir($dossier) && !mkdir($dossier, 0700, true) && !is_dir($dossier)) {
            error_log('Dossier de cache non créé : ' . $dossier);
            return;
        }
        $tmp = $fichier . '.' . bin2hex(random_bytes(4)) . '.tmp';
        if (file_put_contents($tmp, json_encode($donnees, JSON_THROW_ON_ERROR)) === false || !rename($tmp, $fichier)) {
            @unlink($tmp);
            error_log('Cache des clés Google non écrit : ' . $fichier);
        }
    }

    /** @return array{corps:string,max_age:?int} */
    public static function telecharger(string $url): array
    {
        $maxAge = null;
        if (function_exists('curl_init')) {
            $ch = curl_init($url);
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT => 5,
                CURLOPT_CONNECTTIMEOUT => 3,
                CURLOPT_SSL_VERIFYPEER => true,
                CURLOPT_SSL_VERIFYHOST => 2,
                CURLOPT_HEADERFUNCTION => static function ($c, string $ligne) use (&$maxAge): int {
                    if (preg_match('/^cache-control:.*max-age=(\d+)/i', $ligne, $m) === 1) {
                        $maxAge = (int) $m[1];
                    }
                    return strlen($ligne);
                },
            ]);
            $corps = curl_exec($ch);
            $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
            if (!is_string($corps) || $code !== 200) {
                throw new \RuntimeException('Téléchargement impossible (' . ($code ?: curl_error($ch)) . ')');
            }
            return ['corps' => $corps, 'max_age' => $maxAge];
        }

        $contexte = stream_context_create(['http' => ['timeout' => 5], 'ssl' => ['verify_peer' => true, 'verify_peer_name' => true]]);
        $corps = file_get_contents($url, false, $contexte);
        if ($corps === false) {
            throw new \RuntimeException('Téléchargement impossible');
        }
        foreach ($http_response_header ?? [] as $ligne) {
            if (preg_match('/^cache-control:.*max-age=(\d+)/i', $ligne, $m) === 1) {
                $maxAge = (int) $m[1];
            }
        }
        return ['corps' => $corps, 'max_age' => $maxAge];
    }

    public static function base64url(string $texte): string
    {
        $b64 = strtr($texte, '-_', '+/');
        $decode = base64_decode($b64 . str_repeat('=', (4 - strlen($b64) % 4) % 4), true);
        return $decode === false ? '' : $decode;
    }

    /** Construit la clé publique RSA (SubjectPublicKeyInfo, PEM) à partir du module et de l'exposant d'une clé JWK. */
    public static function pem(string $nBase64Url, string $eBase64Url): string
    {
        $rsa = self::der(0x30, self::entier(self::base64url($nBase64Url)) . self::entier(self::base64url($eBase64Url)));
        $algorithme = self::der(0x30, "\x06\x09\x2A\x86\x48\x86\xF7\x0D\x01\x01\x01" . "\x05\x00");   // rsaEncryption, NULL
        $spki = self::der(0x30, $algorithme . self::der(0x03, "\x00" . $rsa));
        return "-----BEGIN PUBLIC KEY-----\n" . chunk_split(base64_encode($spki), 64, "\n") . "-----END PUBLIC KEY-----\n";
    }

    private static function der(int $etiquette, string $contenu): string
    {
        $n = strlen($contenu);
        $longueur = $n < 128 ? chr($n) : chr(0x80 | strlen(ltrim(pack('N', $n), "\0"))) . ltrim(pack('N', $n), "\0");
        return chr($etiquette) . $longueur . $contenu;
    }

    private static function entier(string $octets): string
    {
        $octets = ltrim($octets, "\0");
        if ($octets === '' || ord($octets[0]) > 0x7f) {
            $octets = "\0" . $octets;   // entier positif : un octet de tête à zéro si le bit de poids fort est à 1
        }
        return self::der(0x02, $octets);
    }
}
