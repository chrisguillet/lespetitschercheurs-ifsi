<?php
declare(strict_types=1);

namespace Lpc;

/**
 * Droits d'une personne, calculés à partir de ses attributions (rôle + périmètre). Chargés une seule fois par requête.
 *
 * Hiérarchie : admin (global) > admin de site (un établissement) > admin de promo (une promo).
 * Un admin de site agit sur son établissement et ses promos ; un admin de promo sur sa promo ; seul l'admin voit tout.
 */
final class Droits
{
    /** @var list<array{role:string,etablissement_id:?string,promo_id:?string}>|null */
    private ?array $attributions = null;
    /** @var array<string,?string> */
    private array $etabDePromo = [];
    /** @var array<string,?string> */
    private array $promoDeGroupe = [];

    public function __construct(private \PDO $pdo, private ?int $utilisateurId)
    {
    }

    /** @return list<array{role:string,etablissement_id:?string,promo_id:?string}> */
    public function attributions(): array
    {
        if ($this->attributions === null) {
            $this->attributions = [];
            if ($this->utilisateurId !== null) {
                $st = $this->pdo->prepare('SELECT role, etablissement_id, promo_id FROM attributions WHERE utilisateur_id = ?');
                $st->execute([$this->utilisateurId]);
                foreach ($st->fetchAll() as $r) {
                    $this->attributions[] = [
                        'role' => (string) $r['role'],
                        'etablissement_id' => $r['etablissement_id'] === null ? null : (string) $r['etablissement_id'],
                        'promo_id' => $r['promo_id'] === null ? null : (string) $r['promo_id'],
                    ];
                }
            }
        }
        return $this->attributions;
    }

    public function estAdmin(): bool
    {
        foreach ($this->attributions() as $a) {
            if ($a['role'] === 'admin') {
                return true;
            }
        }
        return false;
    }

    public function etablissementDePromo(string $promoId): ?string
    {
        if (!array_key_exists($promoId, $this->etabDePromo)) {
            $st = $this->pdo->prepare('SELECT etablissement_id FROM promos WHERE id = ?');
            $st->execute([$promoId]);
            $v = $st->fetchColumn();
            $this->etabDePromo[$promoId] = $v === false ? null : (string) $v;
        }
        return $this->etabDePromo[$promoId];
    }

    public function promoDeGroupe(string $groupeId): ?string
    {
        if (!array_key_exists($groupeId, $this->promoDeGroupe)) {
            $st = $this->pdo->prepare('SELECT promo_id FROM groupes WHERE id = ?');
            $st->execute([$groupeId]);
            $v = $st->fetchColumn();
            $this->promoDeGroupe[$groupeId] = $v === false ? null : (string) $v;
        }
        return $this->promoDeGroupe[$groupeId];
    }

    public function peutAdministrerEtablissement(string $etablissementId): bool
    {
        return $this->estAdmin() || $this->a('admin_site', $etablissementId, null);
    }

    public function peutAdministrerPromo(string $promoId): bool
    {
        if ($this->estAdmin() || $this->a('admin_promo', null, $promoId)) {
            return true;
        }
        $etab = $this->etablissementDePromo($promoId);
        return $etab !== null && $this->a('admin_site', $etab, null);
    }

    public function peutAdministrerGroupe(string $groupeId): bool
    {
        $promo = $this->promoDeGroupe($groupeId);
        return $promo !== null && $this->peutAdministrerPromo($promo);
    }

    /**
     * Promos que la personne administre : null = toutes (admin global), sinon la liste de leurs identifiants
     * (promos d'un admin de promo + toutes les promos des établissements d'un admin de site).
     *
     * @return list<string>|null
     */
    public function promosAdministrees(): ?array
    {
        if ($this->estAdmin()) {
            return null;
        }
        $ids = [];
        foreach ($this->attributions() as $a) {
            if ($a['role'] === 'admin_promo' && $a['promo_id'] !== null) {
                $ids[] = $a['promo_id'];
            } elseif ($a['role'] === 'admin_site' && $a['etablissement_id'] !== null) {
                $st = $this->pdo->prepare('SELECT id FROM promos WHERE etablissement_id = ?');
                $st->execute([$a['etablissement_id']]);
                foreach ($st->fetchAll(\PDO::FETCH_COLUMN) as $id) {
                    $ids[] = (string) $id;
                }
            }
        }
        return array_values(array_unique($ids));
    }

    /** Établissements dont la personne administre au moins une partie : null = tous. @return list<string>|null */
    public function etablissementsVisibles(): ?array
    {
        $promos = $this->promosAdministrees();
        if ($promos === null) {
            return null;
        }
        $ids = [];
        foreach ($this->attributions() as $a) {
            if ($a['role'] === 'admin_site' && $a['etablissement_id'] !== null) {
                $ids[] = $a['etablissement_id'];
            }
        }
        foreach ($promos as $p) {
            $e = $this->etablissementDePromo($p);
            if ($e !== null) {
                $ids[] = $e;
            }
        }
        return array_values(array_unique($ids));
    }

    /** Administre-t-elle une des promos ou un des établissements auxquels la personne cible est rattachée ? */
    public function peutAdministrerUtilisateur(int $cibleId): bool
    {
        if ($this->estAdmin()) {
            return true;
        }
        $st = $this->pdo->prepare('SELECT etablissement_id, promo_id FROM attributions WHERE utilisateur_id = ?');
        $st->execute([$cibleId]);
        foreach ($st->fetchAll() as $r) {
            if ($r['promo_id'] !== null && $this->peutAdministrerPromo((string) $r['promo_id'])) {
                return true;
            }
            if ($r['etablissement_id'] !== null && $this->peutAdministrerEtablissement((string) $r['etablissement_id'])) {
                return true;
            }
        }
        return false;
    }

    public function estEtudiantDans(string $promoId): bool
    {
        return $this->a('etudiant', null, $promoId);
    }

    public function estFormateurSur(string $etablissementId): bool
    {
        return $this->a('formateur', $etablissementId, null);
    }

    /** Administre-t-elle quelque chose (même seulement une promo) ? */
    public function estAdminQuelconque(): bool
    {
        foreach ($this->attributions() as $a) {
            if (in_array($a['role'], ['admin', 'admin_site', 'admin_promo'], true)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Rôle simple attendu par l'interface actuelle (admin | etudiant | formateur).
     * Les rôles détaillés sont renvoyés à part (me.roles). Une personne qui n'est ni admin ni étudiante est « formateur ».
     */
    public function roleInterface(): string
    {
        if ($this->estAdmin()) {
            return 'admin';
        }
        foreach ($this->attributions() as $a) {
            if ($a['role'] === 'etudiant') {
                return 'etudiant';
            }
        }
        return 'formateur';
    }

    /** @return list<array{role:string,etablissement_id:?string,promo_id:?string}> */
    public function pourClient(): array
    {
        return $this->attributions();
    }

    private function a(string $role, ?string $etablissementId, ?string $promoId): bool
    {
        foreach ($this->attributions() as $a) {
            if ($a['role'] === $role && $a['etablissement_id'] === $etablissementId && $a['promo_id'] === $promoId) {
                return true;
            }
        }
        return false;
    }
}
