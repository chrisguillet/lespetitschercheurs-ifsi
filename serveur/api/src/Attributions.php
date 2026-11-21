<?php
declare(strict_types=1);

namespace Lpc;

/** Écriture des rôles avec périmètre (table attributions). La cohérence rôle / périmètre est vérifiée ici. */
final class Attributions
{
    public const ROLES_ETABLISSEMENT = ['admin_site', 'formateur'];
    public const ROLES_PROMO = ['admin_promo', 'etudiant'];
    public const ORIGINES = ['admin', 'invitation', 'demande', 'migration'];

    /** @return bool true si la ligne a été créée, false si la personne avait déjà ce rôle sur ce périmètre */
    public static function ajouter(
        \PDO $pdo,
        int $utilisateurId,
        string $role,
        ?string $etablissementId = null,
        ?string $promoId = null,
        string $origine = 'admin',
        ?int $invitationId = null,
        ?int $parId = null
    ): bool {
        self::verifier($role, $etablissementId, $promoId, $origine);

        if ($role === 'admin') {
            $st = $pdo->prepare("SELECT id FROM attributions WHERE utilisateur_id = ? AND role = 'admin' LIMIT 1");
            $st->execute([$utilisateurId]);
        } elseif ($etablissementId !== null) {
            $st = $pdo->prepare('SELECT id FROM attributions WHERE utilisateur_id = ? AND role = ? AND etablissement_id = ? LIMIT 1');
            $st->execute([$utilisateurId, $role, $etablissementId]);
        } else {
            $st = $pdo->prepare('SELECT id FROM attributions WHERE utilisateur_id = ? AND role = ? AND promo_id = ? LIMIT 1');
            $st->execute([$utilisateurId, $role, $promoId]);
        }
        if ($st->fetchColumn() !== false) {
            return false;
        }

        try {
            $pdo->prepare(
                'INSERT INTO attributions (utilisateur_id, role, etablissement_id, promo_id, origine, invitation_id, cree_le, cree_par)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
            )->execute([$utilisateurId, $role, $etablissementId, $promoId, $origine, $invitationId, Temps::maintenant(), $parId]);
        } catch (\PDOException $e) {
            if ($e->getCode() === '23000' && str_contains($e->getMessage(), 'Duplicate')) {
                return false;   // créée entre-temps par une autre requête
            }
            throw $e;
        }
        return true;
    }

    public static function assurerAdminGlobal(\PDO $pdo, int $utilisateurId): void
    {
        self::ajouter($pdo, $utilisateurId, 'admin', null, null, 'admin');
    }

    private static function verifier(string $role, ?string $etablissementId, ?string $promoId, string $origine): void
    {
        if (!in_array($origine, self::ORIGINES, true)) {
            throw new Erreur('invalid', 'Origine de rôle inconnue');
        }
        $ok = match (true) {
            $role === 'admin' => $etablissementId === null && $promoId === null,
            in_array($role, self::ROLES_ETABLISSEMENT, true) => $etablissementId !== null && $promoId === null,
            in_array($role, self::ROLES_PROMO, true) => $promoId !== null && $etablissementId === null,
            default => false,
        };
        if (!$ok) {
            throw new Erreur('invalid', 'Rôle et périmètre incohérents');
        }
    }
}
