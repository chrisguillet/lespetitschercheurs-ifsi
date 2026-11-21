<?php
declare(strict_types=1);

namespace Lpc\Actions;

use Lpc\Contexte;
use Lpc\Donnees;
use Lpc\Utilisateurs;

/** Ouverture et fermeture de session, et rafraîchissement des données. */
final class Session
{
    /**
     * init : qui suis-je, et les données utiles à l'écran. « migration » indique l'avancement de la migration : tant que les
     * sections des lots suivants (lectures, votes, suivi…) manquent, la réponse est partielle.
     *
     * @param array<string,mixed> $req
     * @return array<string,mixed>
     */
    public static function init(Contexte $c, array $req): array
    {
        Utilisateurs::toucherConnexion($c->db->principale(), $c->user);
        return array_merge(
            ['ok' => true, 'me' => Profil::me($c)],
            Donnees::toutes($c),
            Donnees::admin($c),
            ['migration' => 'complet']
        );
    }

    /**
     * list : les mêmes données, sans « me ».
     *
     * @param array<string,mixed> $req
     * @return array<string,mixed>
     */
    public static function liste(Contexte $c, array $req): array
    {
        return array_merge(['ok' => true], Donnees::toutes($c), Donnees::admin($c), ['migration' => 'complet']);
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
