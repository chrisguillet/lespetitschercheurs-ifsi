<?php
declare(strict_types=1);

namespace Lpc;

/**
 * Retours sur l'outil (bugs, idées, autres) : ouverts à toute personne dont l'accès est validé. Par jour et par personne : 10 bugs, 5 idées, 3 autres,
 * modifiables le jour même. L'administrateur les lit tous.
 */
final class Feedback
{
    /** Retours permis par jour et par personne, selon le type. */
    public const LIMITES = ['bug' => 10, 'idee' => 5, 'autre' => 3];
    public const TEXTE_MAX = 2000;
    public const TYPES = ['bug', 'idee', 'autre'];

    /** Jour courant à Paris (le quota se renouvelle à minuit, heure de Paris). */
    public static function jour(): string
    {
        return (new \DateTimeImmutable('now', new \DateTimeZone('Europe/Paris')))->format('Y-m-d');
    }

    /** @return array<string,mixed> */
    public static function pourClient(Contexte $c): array
    {
        $st = $c->db->principale()->prepare('SELECT id, type, texte, cree_le, modifie_le FROM feedback WHERE auteur_id = ? AND jour = ? ORDER BY cree_le, id');
        $st->execute([$c->user->id, self::jour()]);
        $miens = [];
        foreach ($st->fetchAll() as $r) {
            $miens[] = ['id' => (string) $r['id'], 'type' => (string) $r['type'], 'texte' => (string) $r['texte'],
                'cree_le' => Temps::iso((string) $r['cree_le']), 'modifie_le' => Temps::iso($r['modifie_le'] === null ? null : (string) $r['modifie_le'])];
        }
        $restants = self::LIMITES;
        foreach ($miens as $m) {
            $restants[$m['type']] = max(0, ($restants[$m['type']] ?? 0) - 1);
        }
        return ['feedbacks' => $miens, 'feedbackRestants' => $restants, 'feedbackLimites' => self::LIMITES];
    }

    public static function enregistrer(Contexte $c, mixed $id, mixed $data): void
    {
        if (!is_array($data)) {
            throw new Erreur('invalid', 'Données manquantes');
        }
        $type = is_scalar($data['type'] ?? null) ? (string) $data['type'] : '';
        $texte = is_scalar($data['texte'] ?? null) ? trim((string) $data['texte']) : '';
        if (!in_array($type, self::TYPES, true)) {
            throw new Erreur('invalid', 'Type de retour invalide');
        }
        if ($texte === '') {
            throw new Erreur('invalid', 'Écrivez votre retour');
        }
        if (mb_strlen($texte) > self::TEXTE_MAX) {
            throw new Erreur('invalid', 'Retour trop long (' . self::TEXTE_MAX . ' caractères maximum)');
        }
        $pdo = $c->db->principale();
        $jour = self::jour();
        $now = Temps::maintenant();
        $id = is_string($id) ? $id : '';
        if ($id !== '') {
            $st = $pdo->prepare('SELECT jour FROM feedback WHERE id = ? AND auteur_id = ?');
            $st->execute([$id, $c->user->id]);
            $j = $st->fetchColumn();
            if ($j === false) {
                throw new Erreur('not_found', 'Retour introuvable');
            }
            if ((string) $j !== $jour) {
                throw new Erreur('forbidden', 'Un retour ne peut être modifié que le jour où il a été envoyé');
            }
            // Changer de type revient à en envoyer un de cet autre type : la limite de ce type compte.
            $st = $pdo->prepare('SELECT type FROM feedback WHERE id = ?');
            $st->execute([$id]);
            if ((string) $st->fetchColumn() !== $type) {
                self::exigerPlace($pdo, (int) $c->user->id, $jour, $type);
            }
            $pdo->prepare('UPDATE feedback SET type = ?, texte = ?, modifie_le = ? WHERE id = ?')->execute([$type, $texte, $now, $id]);
            return;
        }
        self::exigerPlace($pdo, (int) $c->user->id, $jour, $type);
        $contexte = mb_substr((string) preg_replace('/[\r\n]+/', ' ', is_scalar($data['contexte'] ?? null) ? (string) $data['contexte'] : ''), 0, 300);
        $pdo->prepare('INSERT INTO feedback (id, auteur_id, type, texte, contexte, jour, cree_le, statut) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            ->execute([Ids::uuid(), $c->user->id, $type, $texte, $contexte, $jour, $now, 'nouveau']);
    }

    private static function exigerPlace(\PDO $pdo, int $uid, string $jour, string $type): void
    {
        $st = $pdo->prepare('SELECT COUNT(*) FROM feedback WHERE auteur_id = ? AND jour = ? AND type = ?');
        $st->execute([$uid, $jour, $type]);
        $max = self::LIMITES[$type];
        if ((int) $st->fetchColumn() >= $max) {
            throw new Erreur('limit', 'Vous avez déjà envoyé ' . $max . ' retour' . ($max > 1 ? 's' : '') . ' de ce type aujourd’hui : modifiez-en un ou revenez demain');
        }
    }

    /** Administrateur seulement : tous les retours, les plus récents d'abord. @return list<array<string,mixed>> */
    public static function pourAdmin(Contexte $c): array
    {
        $st = $c->db->principale()->query(
            'SELECT f.id, f.type, f.texte, f.contexte, f.cree_le, f.modifie_le, f.statut, u.email, u.prenom, u.nom, u.pseudo
             FROM feedback f LEFT JOIN utilisateurs u ON u.id = f.auteur_id ORDER BY f.cree_le DESC, f.id DESC LIMIT 1000'
        );
        $out = [];
        foreach ($st->fetchAll() as $r) {
            $out[] = ['id' => (string) $r['id'], 'par' => $r['prenom'] === null ? 'Utilisateur supprimé' : Membres::affiche($r), 'email' => (string) ($r['email'] ?? ''),
                'type' => (string) $r['type'], 'texte' => (string) $r['texte'], 'contexte' => (string) $r['contexte'], 'cree_le' => Temps::iso((string) $r['cree_le']),
                'modifie_le' => Temps::iso($r['modifie_le'] === null ? null : (string) $r['modifie_le']), 'statut' => (string) ($r['statut'] ?: 'nouveau')];
        }
        return $out;
    }

    /** Statuts de suivi d'un retour, choisis par l'administrateur général (« nouveau » = non traité). */
    public const STATUTS = ['nouveau', 'a_faire', 'ecartee', 'traitee'];

    /** Administrateur général seulement. @return list<array<string,mixed>> la liste mise à jour */
    public static function changerStatut(Contexte $c, mixed $id, mixed $statut): array
    {
        if (!$c->droits()->estAdmin()) {
            throw new Erreur('forbidden', 'Réservé à l’administrateur');
        }
        if (!is_string($statut) || !in_array($statut, self::STATUTS, true)) {
            throw new Erreur('invalid', 'Statut inconnu');
        }
        $st = $c->db->principale()->prepare('UPDATE feedback SET statut = ? WHERE id = ?');
        $st->execute([$statut, is_string($id) ? $id : '']);
        $existe = $c->db->principale()->prepare('SELECT 1 FROM feedback WHERE id = ?');
        $existe->execute([is_string($id) ? $id : '']);
        if ($existe->fetchColumn() === false) {
            throw new Erreur('not_found', 'Retour introuvable');
        }
        return self::pourAdmin($c);
    }
}
