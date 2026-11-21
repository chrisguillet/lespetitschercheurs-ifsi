<?php
declare(strict_types=1);

namespace Lpc;

use Lpc\Actions\Profil;
use Lpc\Actions\Session;
use Lpc\Actions\Structure;

/**
 * Aiguille une requête {action, token, ...} vers son traitement.
 * ACTIONS liste les noms de l'ancien Apps Script (contrat avec le front) ; NOUVELLES celles qui n'existaient pas ;
 * $implementees dit lesquelles existent déjà. Une action connue mais pas encore migrée renvoie « not_implemented »,
 * jamais un comportement approximatif.
 */
final class Routeur
{
    public const ACTIONS = [
        'init', 'list', 'add', 'history_get', 'update', 'article_update', 'file_add', 'file_get', 'file_delete',
        'feedback_list', 'feedback_save', 'reunion_save', 'reunion_delete', 'jalon_save', 'jalon_delete',
        'terme_save', 'terme_delete', 'article_vote', 'article_cancel', 'delete',
        'comment_add', 'comment_update', 'comment_delete', 'comments_read', 'comments_unread', 'bye',
        'notes_list', 'note_save', 'note_delete', 'chat_list', 'chat_send', 'chat_delete',
        'consentement', 'profile_update', 'member_add', 'member_candidates', 'formateur_candidates', 'formateur_request',
        'vote_propose', 'vote_answer', 'vote_cancel', 'onboarding', 'onboarding_demande', 'join_code',
        'group_create_self', 'join_request', 'promo_code', 'promo_code_revoke',
        'etab_create', 'etab_rename', 'etab_delete', 'promo_create', 'promo_rename', 'promo_delete',
        'group_create', 'group_update', 'group_delete', 'member_remove', 'translate',
        'admin_list', 'admin_set', 'admin_erase', 'mes_donnees', 'admin_delete',
    ];

    /** Actions apparues avec le nouveau serveur (changement de nom sur demande). */
    public const NOUVELLES = ['nom_demande', 'nom_demandes', 'nom_decision'];

    /** @var array<string,callable(Contexte,array<string,mixed>):array<string,mixed>> */
    private array $implementees;

    public function __construct(private Config $config, private Db $db, private Auth $auth)
    {
        $this->implementees = [
            'init' => [Session::class, 'init'],
            'list' => [Session::class, 'liste'],
            'bye' => [Session::class, 'bye'],
            'consentement' => [Profil::class, 'consentement'],
            'profile_update' => [Profil::class, 'profileUpdate'],
            'nom_demande' => [Profil::class, 'nomDemande'],
            'nom_demandes' => [Profil::class, 'nomDemandes'],
            'nom_decision' => [Profil::class, 'nomDecision'],
            'etab_create' => [Structure::class, 'etabCreate'],
            'etab_rename' => [Structure::class, 'etabRename'],
            'etab_delete' => [Structure::class, 'etabDelete'],
            'promo_create' => [Structure::class, 'promoCreate'],
            'promo_rename' => [Structure::class, 'promoRename'],
            'promo_delete' => [Structure::class, 'promoDelete'],
            'group_create' => [Structure::class, 'groupCreate'],
            'group_update' => [Structure::class, 'groupUpdate'],
            'group_delete' => [Structure::class, 'groupDelete'],
        ];
    }

    /**
     * @param array<string,mixed> $req
     * @return array<string,mixed>
     */
    public function traiter(array $req): array
    {
        $action = $req['action'] ?? null;
        if (!is_string($action) || $action === '') {
            throw new Erreur('bad_request', 'Action manquante');
        }

        $user = $this->auth->authentifier($req['token'] ?? null, $action);
        $contexte = new Contexte($this->config, $this->db, $user);
        Presence::signaler($contexte, $action);

        if (!in_array($action, self::ACTIONS, true) && !in_array($action, self::NOUVELLES, true)) {
            throw new Erreur('bad_request', 'Action inconnue');
        }
        $traitement = $this->implementees[$action] ?? null;
        if ($traitement === null) {
            throw new Erreur('not_implemented', 'Action pas encore disponible sur le nouveau serveur : ' . $action);
        }
        return $traitement($contexte, $req);
    }
}
