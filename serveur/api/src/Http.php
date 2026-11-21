<?php
declare(strict_types=1);

namespace Lpc;

/** Lecture de la requête et écriture de la réponse JSON. */
final class Http
{
    public const TAILLE_MAX = 12 * 1024 * 1024;   // une pièce jointe de 5 Mo en base64 tient largement dedans

    public static function entetes(): void
    {
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        header('X-Content-Type-Options: nosniff');
    }

    /** Autorise les origines de la configuration (nécessaire tant que le front est sur GitHub Pages). */
    public static function cors(Config $config): void
    {
        $origine = $_SERVER['HTTP_ORIGIN'] ?? '';
        if ($origine === '' || !in_array($origine, $config->origines(), true)) {
            return;
        }
        header('Access-Control-Allow-Origin: ' . $origine);
        header('Vary: Origin');
        header('Access-Control-Allow-Methods: POST, OPTIONS');
        header('Access-Control-Allow-Headers: Content-Type');
        header('Access-Control-Max-Age: 600');
    }

    /** @return array<string,mixed> */
    public static function corps(): array
    {
        // Le front envoie du text/plain pour éviter la pré-vérification CORS : on lit le corps brut sans tenir compte du type.
        $brut = file_get_contents('php://input', false, null, 0, self::TAILLE_MAX + 1);
        if ($brut === false || $brut === '') {
            throw new Erreur('bad_request', 'Requête vide');
        }
        if (strlen($brut) > self::TAILLE_MAX) {
            throw new Erreur('bad_request', 'Requête trop volumineuse');
        }
        $donnees = json_decode($brut, true);
        if (!is_array($donnees) || array_is_list($donnees)) {
            throw new Erreur('bad_request', 'Requête invalide');
        }
        return $donnees;
    }

    /** @param array<string,mixed> $donnees */
    public static function json(array $donnees): void
    {
        echo json_encode($donnees, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    }
}
