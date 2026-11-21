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
