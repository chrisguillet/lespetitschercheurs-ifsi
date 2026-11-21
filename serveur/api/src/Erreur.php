<?php
declare(strict_types=1);

namespace Lpc;

/**
 * Erreur métier renvoyée au client sous la forme {ok:false, error:<code>, message:<texte>, extra:<...>}.
 * Les codes reprennent ceux de l'ancien Apps Script : unauthorized, pending, forbidden, invalid, bad_request, server…
 */
final class Erreur extends \RuntimeException
{
    public function __construct(
        public readonly string $codeErreur,
        string $message,
        public readonly mixed $extra = null
    ) {
        parent::__construct($message);
    }
}
