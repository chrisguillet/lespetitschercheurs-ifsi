<?php
declare(strict_types=1);

namespace Lpc;

/**
 * Configuration serveur, lue dans un fichier PHP placé HORS de la racine web et hors du dépôt
 * (par défaut /qocot/_prive/lespetitschercheurs/config.php). Modèle : serveur/config.exemple.php.
 */
final class Config
{
    // Version du texte de consentement (politique de confidentialité) : la changer redemande l'accord à tout le monde.
    public const CONSENT_VERSION = '2026-11-20';
    public const COULEUR_DEFAUT = '#888888';
    public const COULEUR_ADMIN = '#475569';
    public const MAX_EN_ATTENTE = 50;
    public const DELAI_CONNEXION_S = 600;

    private const OBLIGATOIRES = ['google_client_id', 'admin_email', 'db_principale', 'db_chat'];
    private const CLES_BASE = ['hote', 'nom', 'utilisateur', 'mot_de_passe'];

    /** @param array<string,mixed> $valeurs */
    private function __construct(private array $valeurs)
    {
    }

    public static function chemin(): string
    {
        $env = getenv('LPC_CONFIG');
        if (is_string($env) && $env !== '') {
            return $env;
        }
        // api/src -> api -> lespetitschercheurs -> qocot : le dossier privé est un voisin de la racine web du site.
        return dirname(__DIR__, 3) . '/_prive/lespetitschercheurs/config.php';
    }

    public static function charger(?string $chemin = null): self
    {
        $chemin ??= self::chemin();
        if (!is_file($chemin)) {
            throw new \RuntimeException('Fichier de configuration introuvable : ' . $chemin);
        }
        $v = require $chemin;
        if (!is_array($v)) {
            throw new \RuntimeException('Le fichier de configuration doit renvoyer un tableau');
        }
        foreach (self::OBLIGATOIRES as $cle) {
            if (!array_key_exists($cle, $v)) {
                throw new \RuntimeException('Configuration incomplète : ' . $cle);
            }
        }
        foreach (['db_principale', 'db_chat'] as $base) {
            foreach (self::CLES_BASE as $cle) {
                if (!isset($v[$base][$cle]) || !is_string($v[$base][$cle]) || $v[$base][$cle] === '') {
                    throw new \RuntimeException('Configuration incomplète : ' . $base . '.' . $cle);
                }
            }
        }
        $v['dossier_prive'] ??= dirname($chemin);
        return new self($v);
    }

    public function get(string $cle, mixed $defaut = null): mixed
    {
        return $this->valeurs[$cle] ?? $defaut;
    }

    public function clientIdGoogle(): string
    {
        return (string) $this->valeurs['google_client_id'];
    }

    public function emailAdmin(): string
    {
        return strtolower(trim((string) $this->valeurs['admin_email']));
    }

    public function nomAdmin(): string
    {
        return (string) ($this->valeurs['nom_admin'] ?? 'Administrateur');
    }

    /** @return list<string> */
    public function origines(): array
    {
        $o = $this->valeurs['origines'] ?? [];
        return is_array($o) ? array_values(array_filter($o, 'is_string')) : [];
    }

    public function dossierPrive(): string
    {
        return rtrim((string) $this->valeurs['dossier_prive'], '/\\');
    }

    /** @return array{hote:string,port:int,nom:string,utilisateur:string,mot_de_passe:string} */
    public function base(string $cle): array
    {
        $b = $this->valeurs[$cle];
        return [
            'hote' => (string) $b['hote'],
            'port' => (int) ($b['port'] ?? 3306),
            'nom' => (string) $b['nom'],
            'utilisateur' => (string) $b['utilisateur'],
            'mot_de_passe' => (string) $b['mot_de_passe'],
        ];
    }
}
