<?php
declare(strict_types=1);

namespace Lpc;

/**
 * Qui a le chat. L'administrateur général règle le chat pour tout le monde, pour une promo ou pour un groupe ; un administrateur de site ou
 * de promo, pour ses promos et ses groupes. La règle la plus précise l'emporte (groupe, puis promo, puis général) ; sans règle, le chat est actif.
 * Le salon de promo dépend des règles de la promo et de la règle générale.
 */
final class ChatRegles
{
    /** @return array{general:?bool,promos:array<string,bool>,groupes:array<string,bool>} */
    public static function toutes(\PDO $pdo): array
    {
        $out = ['general' => null, 'promos' => [], 'groupes' => []];
        foreach ($pdo->query('SELECT portee, cible, actif FROM chat_regles')->fetchAll() as $r) {
            if ($r['portee'] === 'general') {
                $out['general'] = (int) $r['actif'] === 1;
            } elseif ($r['portee'] === 'promo') {
                $out['promos'][(string) $r['cible']] = (int) $r['actif'] === 1;
            } elseif ($r['portee'] === 'groupe') {
                $out['groupes'][(string) $r['cible']] = (int) $r['actif'] === 1;
            }
        }
        return $out;
    }

    /** @param array{general:?bool,promos:array<string,bool>,groupes:array<string,bool>} $r */
    public static function groupeActif(array $r, string $groupeId, string $promoId): bool
    {
        return $r['groupes'][$groupeId] ?? $r['promos'][$promoId] ?? $r['general'] ?? true;
    }

    /** @param array{general:?bool,promos:array<string,bool>,groupes:array<string,bool>} $r */
    public static function promoActif(array $r, string $promoId): bool
    {
        return $r['promos'][$promoId] ?? $r['general'] ?? true;
    }

    /**
     * Fixe une règle. $valeur : « actif », « inactif » ou « herite » (supprime la règle).
     */
    public static function definir(Contexte $c, string $portee, string $cible, string $valeur): void
    {
        if (!in_array($valeur, ['actif', 'inactif', 'herite'], true)) {
            throw new Erreur('invalid', 'Valeur inconnue');
        }
        $d = $c->droits();
        $pdo = $c->db->principale();
        if ($portee === 'general') {
            if (!$d->estAdmin()) {
                throw new Erreur('forbidden', 'Réservé à l’administrateur général');
            }
            $cible = '';
        } elseif ($portee === 'promo') {
            if ($d->etablissementDePromo($cible) === null) {
                throw new Erreur('not_found', 'Promo introuvable');
            }
            if (!$d->peutAdministrerPromo($cible)) {
                throw new Erreur('forbidden', 'Cette promo n’est pas dans votre périmètre');
            }
        } elseif ($portee === 'groupe') {
            if ($d->promoDeGroupe($cible) === null) {
                throw new Erreur('not_found', 'Groupe introuvable');
            }
            if (!$d->peutAdministrerGroupe($cible)) {
                throw new Erreur('forbidden', 'Ce groupe n’est pas dans votre périmètre');
            }
        } else {
            throw new Erreur('invalid', 'Portée inconnue');
        }
        if ($valeur === 'herite') {
            $pdo->prepare('DELETE FROM chat_regles WHERE portee = ? AND cible = ?')->execute([$portee, $cible]);
        } else {
            $pdo->prepare('INSERT INTO chat_regles (portee, cible, actif, modifie_le, modifie_par) VALUES (?, ?, ?, ?, ?)
                           ON DUPLICATE KEY UPDATE actif = VALUES(actif), modifie_le = VALUES(modifie_le), modifie_par = VALUES(modifie_par)')
                ->execute([$portee, $cible, $valeur === 'actif' ? 1 : 0, Temps::maintenant(), $c->user->id]);
        }
        Actions\Acces::journal($pdo, $c, 'chat_regle', $portee . ':' . $cible, $valeur);
    }

    /** Règles visibles de la personne : la règle générale (administrateur général) et celles de ses promos et groupes. @return array<string,mixed> */
    public static function pourAdmin(Contexte $c): array
    {
        $d = $c->droits();
        if (!$d->estAdminQuelconque()) {
            throw new Erreur('forbidden', 'Réservé à un administrateur');
        }
        $r = self::toutes($c->db->principale());
        return ['general' => $d->estAdmin() ? $r['general'] : null, 'peut_general' => $d->estAdmin(), 'promos' => $r['promos'], 'groupes' => $r['groupes']];
    }
}
