<?php
declare(strict_types=1);

namespace Lpc;

use Lpc\Actions\Acces;
use Lpc\Actions\Fiches;
use Lpc\Actions\Groupes;
use Lpc\Actions\Invitations;
use Lpc\Actions\Outils;
use Lpc\Actions\Profil;
use Lpc\Actions\Rgpd;
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

    /** Actions apparues avec le nouveau serveur (changement de nom sur demande, invitations, rôles avec périmètre). */
    public const NOUVELLES = [
        'nom_demande', 'nom_demandes', 'nom_decision',
        'invitation_create', 'invitation_list', 'invitation_revoke',
        'attribution_add', 'attribution_remove', 'feedback_status', 'doi_lookup', 'doublons_list', 'article_merge', 'doublons_ignore', 'chat_regles', 'chat_regle_set',
        'jeux_scores', 'jeu_score', 'suggestion_save', 'suggestion_delete', 'suggestion_vues',
    ];

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
            'feedback_status' => [Outils::class, 'feedbackStatut'],
            'doi_lookup' => [Outils::class, 'doiLookup'],
            'doublons_list' => [Outils::class, 'doublonsList'],
            'chat_regles' => [Outils::class, 'chatRegles'],
            'chat_regle_set' => [Outils::class, 'chatRegleSet'],
            'jeux_scores' => [Outils::class, 'jeuxScores'],
            'jeu_score' => [Outils::class, 'jeuScore'],
            'suggestion_save' => [Outils::class, 'suggestionSave'],
            'suggestion_delete' => [Outils::class, 'suggestionDelete'],
            'suggestion_vues' => [Outils::class, 'suggestionVues'],
            'article_merge' => [Outils::class, 'articleMerge'],
            'doublons_ignore' => [Outils::class, 'doublonsIgnore'],
            'etab_create' => [Structure::class, 'etabCreate'],
            'etab_rename' => [Structure::class, 'etabRename'],
            'etab_delete' => [Structure::class, 'etabDelete'],
            'promo_create' => [Structure::class, 'promoCreate'],
            'promo_rename' => [Structure::class, 'promoRename'],
            'promo_delete' => [Structure::class, 'promoDelete'],
            'group_create' => [Structure::class, 'groupCreate'],
            'group_update' => [Structure::class, 'groupUpdate'],
            'group_delete' => [Structure::class, 'groupDelete'],
            'onboarding' => [Acces::class, 'onboarding'],
            'onboarding_demande' => [Acces::class, 'onboardingDemande'],
            'admin_list' => [Acces::class, 'adminList'],
            'admin_set' => [Acces::class, 'adminSet'],
            'admin_delete' => [Acces::class, 'adminDelete'],
            'attribution_add' => [Acces::class, 'attributionAdd'],
            'attribution_remove' => [Acces::class, 'attributionRemove'],
            'join_code' => [Invitations::class, 'utiliser'],
            'promo_code' => [Invitations::class, 'promoCode'],
            'promo_code_revoke' => [Invitations::class, 'promoCodeRevoke'],
            'invitation_create' => [Invitations::class, 'creer'],
            'invitation_list' => [Invitations::class, 'liste'],
            'invitation_revoke' => [Invitations::class, 'revoquer'],
            'reunion_save' => [Outils::class, 'reunionSave'],
            'reunion_delete' => [Outils::class, 'reunionDelete'],
            'jalon_save' => [Outils::class, 'jalonSave'],
            'jalon_delete' => [Outils::class, 'jalonDelete'],
            'terme_save' => [Outils::class, 'termeSave'],
            'terme_delete' => [Outils::class, 'termeDelete'],
            'file_add' => [Outils::class, 'fileAdd'],
            'file_get' => [Outils::class, 'fileGet'],
            'file_delete' => [Outils::class, 'fileDelete'],
            'notes_list' => [Outils::class, 'notesList'],
            'note_save' => [Outils::class, 'noteSave'],
            'note_delete' => [Outils::class, 'noteDelete'],
            'feedback_list' => [Outils::class, 'feedbackList'],
            'feedback_save' => [Outils::class, 'feedbackSave'],
            'chat_list' => [Outils::class, 'chatList'],
            'chat_send' => [Outils::class, 'chatSend'],
            'chat_delete' => [Outils::class, 'chatDelete'],
            'translate' => [Outils::class, 'translate'],
            'add' => [Fiches::class, 'add'],
            'update' => [Fiches::class, 'update'],
            'article_update' => [Fiches::class, 'articleUpdate'],
            'delete' => [Fiches::class, 'delete'],
            'history_get' => [Fiches::class, 'historyGet'],
            'article_vote' => [Fiches::class, 'articleVote'],
            'article_cancel' => [Fiches::class, 'articleCancel'],
            'comment_add' => [Fiches::class, 'commentAdd'],
            'comment_update' => [Fiches::class, 'commentUpdate'],
            'comment_delete' => [Fiches::class, 'commentDelete'],
            'comments_read' => [Fiches::class, 'commentsRead'],
            'comments_unread' => [Fiches::class, 'commentsUnread'],
            'member_add' => [Groupes::class, 'memberAdd'],
            'member_remove' => [Groupes::class, 'memberRemove'],
            'member_candidates' => [Groupes::class, 'memberCandidates'],
            'formateur_candidates' => [Groupes::class, 'formateurCandidates'],
            'formateur_request' => [Groupes::class, 'formateurRequest'],
            'vote_propose' => [Groupes::class, 'votePropose'],
            'vote_answer' => [Groupes::class, 'voteAnswer'],
            'vote_cancel' => [Groupes::class, 'voteCancel'],
            'join_request' => [Groupes::class, 'joinRequest'],
            'group_create_self' => [Groupes::class, 'groupCreateSelf'],
            'admin_erase' => [Rgpd::class, 'adminErase'],
            'mes_donnees' => [Rgpd::class, 'mesDonnees'],
        ];
    }

    /** Noms des actions qui ont un traitement (sert aux tests : toutes celles de l'ancien serveur doivent y être). @return list<string> */
    public function actionsImplementees(): array
    {
        return array_keys($this->implementees);
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
        // « Voir en tant que » : l'administrateur général consulte l'application comme le ferait une autre personne (champ « as » = son identifiant public).
        // Lecture seule : seules init et list sont permises ; ni présence, ni notes, ni chat. Chaque ouverture est inscrite au journal.
        $vueComme = null;
        $as = $req['as'] ?? null;
        if (is_string($as) && $as !== '') {
            $reel = new Contexte($this->config, $this->db, $user);
            if (!$reel->droits()->estAdmin()) {
                throw new Erreur('forbidden', 'Réservé à l’administrateur général');
            }
            if (!in_array($action, ['init', 'list'], true)) {
                throw new Erreur('forbidden', 'Vue « en tant que » : lecture seule');
            }
            $cible = Utilisateurs::parPid($this->db->principale(), $as);
            if ($cible === null || $cible->statut !== 'actif' || $cible->id === $user->id) {
                throw new Erreur('not_found', 'Personne introuvable ou inactive');
            }
            if ($action === 'init') {
                $this->db->principale()->prepare('INSERT INTO journal_admin (acteur_id, action, cible, detail, cree_le) VALUES (?, ?, ?, ?, ?)')
                    ->execute([$user->id, 'voir_en_tant_que', 'utilisateur:' . $cible->id, '', Temps::maintenant()]);
            }
            $user = $cible;
            $vueComme = ['pid' => $cible->pid, 'nom' => $cible->affichage()];
        }
        $contexte = new Contexte($this->config, $this->db, $user);
        if ($vueComme === null) {
            Presence::signaler($contexte, $action);
        }

        if (!in_array($action, self::ACTIONS, true) && !in_array($action, self::NOUVELLES, true)) {
            throw new Erreur('bad_request', 'Action inconnue');
        }
        $traitement = $this->implementees[$action] ?? null;
        if ($traitement === null) {
            throw new Erreur('not_implemented', 'Action pas encore disponible sur le nouveau serveur : ' . $action);
        }
        $r = $traitement($contexte, $req);
        if ($vueComme !== null) {
            $r['vue_en_tant_que'] = $vueComme;
        }
        return $r;
    }
}
