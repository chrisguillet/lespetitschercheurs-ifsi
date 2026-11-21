<?php
declare(strict_types=1);

namespace Lpc;

/** Authentification : jeton Google vérifié, puis état du compte (mêmes règles et messages que l'ancien authentifier_). */
final class Auth
{
    /** Actions permises à une adresse inconnue ou en attente : choisir sa promo, entrer une invitation. */
    public const ACTIONS_ACCUEIL = ['onboarding', 'onboarding_demande', 'join_code'];

    public function __construct(private Config $config, private Db $db, private GoogleJeton $google)
    {
    }

    public function authentifier(mixed $jeton, string $action): Utilisateur
    {
        if (!is_string($jeton) || $jeton === '') {
            throw new Erreur('unauthorized', 'Connexion requise');
        }
        $email = $this->google->verifier($jeton)['email'];
        $pdo = $this->db->principale();

        if ($email === $this->config->emailAdmin()) {
            return Utilisateurs::assurerAdmin($pdo, $this->config);
        }

        $user = Utilisateurs::parEmail($pdo, $email);

        // Première connexion : une personne inconnue ou en attente peut choisir sa promo ou entrer une invitation.
        if (in_array($action, self::ACTIONS_ACCUEIL, true) && ($user === null || $user->statut === 'en_attente')) {
            return $user === null
                ? Utilisateur::inconnu($email)
                : new Utilisateur(
                    $user->id, $user->pid, $user->email, $user->prenom, $user->nom, $user->pseudo, $user->couleur,
                    $user->statut, $user->derniereConnexion, $user->consentementVersion, true
                );
        }
        if ($user === null) {
            // Adresse inconnue : une demande est enregistrée à l'ouverture de l'application seulement.
            if ($action === 'init') {
                Utilisateurs::enregistrerDemande($pdo, $email);
            }
            throw new Erreur('pending', 'Votre demande d’accès a été envoyée : elle doit être validée.');
        }
        if ($user->statut === 'en_attente') {
            throw new Erreur('pending', 'Votre demande d’accès est en attente de validation.');
        }
        if ($user->statut === 'refuse') {
            throw new Erreur('forbidden', 'Accès refusé');
        }
        return $user;
    }
}
