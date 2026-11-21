<?php
declare(strict_types=1);

namespace Lpc;

/**
 * Lecture de l'ancien Google Sheet et de son dossier Drive par un compte de service, en lecture seule.
 * Le compte de service est une identité de robot (clé JSON dans config.php) avec laquelle on partage le Sheet et le dossier
 * en « lecteur » : aucun rôle dans le projet Google n'est nécessaire.
 */
final class GoogleApi
{
    public const PORTEES = ['https://www.googleapis.com/auth/spreadsheets.readonly', 'https://www.googleapis.com/auth/drive.readonly'];

    /** @var callable(string,string,array<int,string>,?string):array{code:int,corps:string} */
    private $http;
    private ?string $jeton = null;
    private int $jetonExpire = 0;

    /**
     * @param array<string,mixed> $cle contenu de la clé JSON du compte de service
     * @param null|callable(string,string,array<int,string>,?string):array{code:int,corps:string} $http remplaçable dans les tests : (méthode, url, en-têtes, corps)
     */
    public function __construct(private array $cle, ?callable $http = null)
    {
        foreach (['client_email', 'private_key'] as $k) {
            if (!isset($cle[$k]) || !is_string($cle[$k]) || $cle[$k] === '') {
                throw new \RuntimeException('Clé de compte de service incomplète : ' . $k);
            }
        }
        $this->http = $http ?? [self::class, 'requete'];
    }

    /** Assertion JWT signée (RS256) à échanger contre un jeton d'accès. */
    public static function assertion(array $cle, int $maintenant, array $portees = self::PORTEES): string
    {
        $uri = (string) ($cle['token_uri'] ?? 'https://oauth2.googleapis.com/token');
        $b64 = static fn (string $s): string => rtrim(strtr(base64_encode($s), '+/', '-_'), '=');
        $entete = $b64((string) json_encode(['alg' => 'RS256', 'typ' => 'JWT']));
        $charge = $b64((string) json_encode(['iss' => $cle['client_email'], 'scope' => implode(' ', $portees), 'aud' => $uri,
            'iat' => $maintenant, 'exp' => $maintenant + 3600]));
        if (!openssl_sign($entete . '.' . $charge, $signature, (string) $cle['private_key'], OPENSSL_ALGO_SHA256)) {
            throw new \RuntimeException('Signature impossible avec la clé du compte de service');
        }
        return $entete . '.' . $charge . '.' . $b64($signature);
    }

    /**
     * Onglets du Sheet : pour chacun, les lignes sans l'en-tête (valeurs affichées, comme getDisplayValues).
     *
     * @param list<string> $onglets
     * @return array<string,list<list<string>>>
     */
    public function onglets(string $sheetId, array $onglets): array
    {
        $url = 'https://sheets.googleapis.com/v4/spreadsheets/' . rawurlencode($sheetId) . '/values:batchGet?valueRenderOption=FORMATTED_VALUE&majorDimension=ROWS';
        foreach ($onglets as $o) {
            $url .= '&ranges=' . rawurlencode($o);
        }
        $json = $this->json('GET', $url);
        $out = [];
        foreach ($json['valueRanges'] ?? [] as $i => $plage) {
            $lignes = [];
            foreach (array_slice($plage['values'] ?? [], 1) as $ligne) {
                $lignes[] = array_map(static fn (mixed $v): string => (string) $v, $ligne);
            }
            $out[$onglets[$i]] = $lignes;
        }
        return $out;
    }

    /** Contenu d'un fichier du Drive. */
    public function fichier(string $driveId): string
    {
        $rep = $this->appeler('GET', 'https://www.googleapis.com/drive/v3/files/' . rawurlencode($driveId) . '?alt=media&supportsAllDrives=true', null);
        if ($rep['code'] !== 200) {
            throw new \RuntimeException('Drive : fichier illisible (' . $rep['code'] . ')');
        }
        return $rep['corps'];
    }

    // ---------- Interne ----------

    /** @return array<string,mixed> */
    private function json(string $methode, string $url): array
    {
        $rep = $this->appeler($methode, $url, null);
        if ($rep['code'] !== 200) {
            throw new \RuntimeException('Sheets : réponse ' . $rep['code'] . ' (le Sheet est-il partagé avec le compte de service ?)');
        }
        $d = json_decode($rep['corps'], true);
        return is_array($d) ? $d : [];
    }

    /** @return array{code:int,corps:string} */
    private function appeler(string $methode, string $url, ?string $corps): array
    {
        return ($this->http)($methode, $url, ['Authorization: Bearer ' . $this->jeton()], $corps);
    }

    private function jeton(): string
    {
        if ($this->jeton !== null && time() < $this->jetonExpire - 60) {
            return $this->jeton;
        }
        $rep = ($this->http)('POST', (string) ($this->cle['token_uri'] ?? 'https://oauth2.googleapis.com/token'), ['Content-Type: application/x-www-form-urlencoded'],
            http_build_query(['grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer', 'assertion' => self::assertion($this->cle, time())]));
        $d = json_decode($rep['corps'], true);
        if ($rep['code'] !== 200 || !is_array($d) || !isset($d['access_token'])) {
            throw new \RuntimeException('Connexion Google refusée (' . $rep['code'] . ') : clé du compte de service valide, API Sheets et Drive activées ?');
        }
        $this->jeton = (string) $d['access_token'];
        $this->jetonExpire = time() + (int) ($d['expires_in'] ?? 3600);
        return $this->jeton;
    }

    /** @param array<int,string> $entetes @return array{code:int,corps:string} */
    public static function requete(string $methode, string $url, array $entetes, ?string $corps): array
    {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_CUSTOMREQUEST => $methode, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 120, CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_HTTPHEADER => $entetes, CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2,
        ]);
        if ($corps !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, $corps);
        }
        $rep = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        return ['code' => $code, 'corps' => is_string($rep) ? $rep : ''];
    }
}
