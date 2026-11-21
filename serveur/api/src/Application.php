<?php
declare(strict_types=1);

namespace Lpc;

/** Cycle d'une requête : configuration, CORS, lecture du corps, routage, réponse JSON (toujours en HTTP 200, comme Apps Script). */
final class Application
{
    public static function executer(): void
    {
        Http::entetes();
        try {
            $config = Config::charger();
            Http::cors($config);
            $methode = $_SERVER['REQUEST_METHOD'] ?? 'GET';

            if ($methode === 'OPTIONS') {
                http_response_code(204);
                return;
            }
            if ($methode === 'GET') {
                Http::json(['ok' => true, 'service' => 'lespetitschercheurs']);
                return;
            }
            if ($methode !== 'POST') {
                throw new Erreur('bad_request', 'Méthode non autorisée');
            }

            $db = new Db($config);
            $google = new GoogleJeton($config->clientIdGoogle(), $config->dossierPrive() . '/cache');
            $routeur = new Routeur($config, $db, new Auth($config, $db, $google));
            Http::json($routeur->traiter(Http::corps()));
        } catch (Erreur $e) {
            $reponse = ['ok' => false, 'error' => $e->codeErreur, 'message' => $e->getMessage()];
            if ($e->extra !== null) {
                $reponse['extra'] = $e->extra;
            }
            Http::json($reponse);
        } catch (\Throwable $e) {
            error_log(sprintf('%s: %s dans %s:%d', $e::class, $e->getMessage(), $e->getFile(), $e->getLine()));
            Http::json(['ok' => false, 'error' => 'server', 'message' => 'Erreur serveur']);
        }
    }
}
