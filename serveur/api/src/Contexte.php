<?php
declare(strict_types=1);

namespace Lpc;

/** Tout ce dont une action a besoin : configuration, bases, personne connectée et ses droits. */
final class Contexte
{
    private ?Droits $droits = null;

    public function __construct(
        public readonly Config $config,
        public readonly Db $db,
        public readonly Utilisateur $user
    ) {
    }

    public function droits(): Droits
    {
        return $this->droits ??= new Droits($this->db->principale(), $this->user->id);
    }
}
