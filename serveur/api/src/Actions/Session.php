<?php
declare(strict_types=1);

namespace Lpc\Actions;

use Lpc\Config;
use Lpc\Contexte;
use Lpc\Utilisateurs;

/** Ouverture et fermeture de session. */
final class Session
{
    /**
     * init : qui suis-je. Les sections de données (lectures, groupes, votes…) arrivent avec l'étape « cœur » ;
     * « migration » signale au front que la réponse est encore partielle.
     *
     * @param array<string,mixed> $req
     * @return array<string,mixed>
     */
    public static function init(Contexte $c, array $req): array
    {
        Utilisateurs::toucherConnexion($c->db->principale(), $c->user);
        $u = $c->user;
        return [
            'ok' => true,
            'me' => [
                'prenom' => $u->affichage(),
                'role' => $c->droits()->roleInterface(),
                'couleur' => $u->couleur,
                'consentement' => $u->consentementVersion === Config::CONSENT_VERSION,
                'consent_version' => Config::CONSENT_VERSION,
                'roles' => $c->droits()->pourClient(),
            ],
            'migration' => 'socle',
        ];
    }

    /**
     * La présence est déjà retirée par le routeur (action « bye ») : rien d'autre à faire.
     *
     * @param array<string,mixed> $req
     * @return array<string,mixed>
     */
    public static function bye(Contexte $c, array $req): array
    {
        return ['ok' => true];
    }
}
