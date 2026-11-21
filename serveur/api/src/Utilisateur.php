<?php
declare(strict_types=1);

namespace Lpc;

/**
 * La personne qui fait la requête. id vaut null pour une adresse encore inconnue qui peut seulement
 * utiliser les actions d'accueil (choisir sa promo, entrer une invitation) : aucune ligne n'existe pour elle.
 */
final class Utilisateur
{
    public function __construct(
        public readonly ?int $id,
        public readonly string $pid,
        public readonly string $email,
        public readonly string $prenom,
        public readonly string $nom,
        public readonly ?string $pseudo,
        public readonly string $couleur,
        public readonly string $statut,
        public readonly ?string $derniereConnexion,
        public readonly ?string $consentementVersion,
        public readonly bool $accueil = false
    ) {
    }

    /** @param array<string,mixed> $r */
    public static function depuisLigne(array $r, bool $accueil = false): self
    {
        return new self(
            (int) $r['id'],
            (string) $r['pid'],
            (string) $r['email'],
            (string) $r['prenom'],
            (string) $r['nom'],
            $r['pseudo'] === null ? null : (string) $r['pseudo'],
            (string) $r['couleur'],
            (string) $r['statut'],
            $r['derniere_connexion'] === null ? null : (string) $r['derniere_connexion'],
            $r['consentement_version'] === null ? null : (string) $r['consentement_version'],
            $accueil
        );
    }

    public static function inconnu(string $email): self
    {
        return new self(null, Ids::pid($email), $email, '', '', null, Config::COULEUR_DEFAUT, 'en_attente', null, null, true);
    }

    /** Nom montré aux autres : le pseudo s'il existe, sinon « prénom + initiale du nom ». */
    public function affichage(): string
    {
        return self::nomAffiche($this->prenom, $this->nom, $this->pseudo);
    }

    public static function nomAffiche(string $prenom, string $nom, ?string $pseudo): string
    {
        if ($pseudo !== null && $pseudo !== '') {
            return $pseudo;
        }
        $initiale = $nom === '' ? '' : ' ' . mb_strtoupper(mb_substr($nom, 0, 1)) . '.';
        return $prenom . $initiale;
    }
}
