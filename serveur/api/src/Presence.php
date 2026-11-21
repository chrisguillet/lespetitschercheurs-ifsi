<?php
declare(strict_types=1);

namespace Lpc;

/**
 * « Qui est en ligne » : une ligne par personne dans la base du chat (écritures fréquentes, loin du tronc commun).
 * L'administrateur reste discret. Une panne de cette base ne doit jamais empêcher de répondre.
 */
final class Presence
{
    public static function signaler(Contexte $c, string $action): void
    {
        $u = $c->user;
        if ($u->id === null || $c->droits()->estAdmin()) {
            return;
        }
        try {
            $pdo = $c->db->chat();
            if ($action === 'bye') {
                $pdo->prepare('DELETE FROM presence WHERE utilisateur_id = ?')->execute([$u->id]);
                return;
            }
            $now = Temps::maintenant();
            $st = $pdo->prepare('UPDATE presence SET vu_le = ? WHERE utilisateur_id = ?');
            $st->execute([$now, $u->id]);
            if ($st->rowCount() === 0) {
                $pdo->prepare('INSERT IGNORE INTO presence (utilisateur_id, vu_le) VALUES (?, ?)')->execute([$u->id, $now]);
            }
        } catch (\Throwable $e) {
            error_log('Présence non enregistrée : ' . $e->getMessage());
        }
    }
}
