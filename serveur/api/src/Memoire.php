<?php
declare(strict_types=1);

namespace Lpc;

/**
 * Mémoire partagé par le groupe : en-tête (titre, UE, référent, date de rendu) et blocs ordonnés.
 * Lecture : les personnes qui voient le groupe (membres, formateurs rattachés, administrateurs du périmètre).
 * Écriture : les étudiantes membres du groupe. Chaque bloc enregistre son auteur et sa date : la sauvegarde se fait bloc par bloc.
 */
final class Memoire
{
    public const TYPES = ['titre1', 'titre2', 'paragraphe', 'citation', 'reference'];
    public const TEXTE_MAX = 20000;
    public const MAX_BLOCS = 600;

    private static function groupeVisible(Contexte $c, string $gid): void
    {
        if ($gid === '' || !in_array($gid, Donnees::idsGroupesVisibles($c), true)) {
            throw new Erreur('forbidden', 'Ce groupe ne vous est pas accessible');
        }
    }

    private static function exigerMembre(Contexte $c, string $gid): \PDO
    {
        Lectures::exigerEtudiant($c);
        $pdo = $c->db->principale();
        if ($gid === '' || !Membres::estMembre($pdo, $gid, (int) $c->user->id)) {
            throw new Erreur('forbidden', 'Seules les membres du groupe peuvent modifier son mémoire');
        }
        return $pdo;
    }

    /** Le mémoire du groupe, blocs dans l'ordre. @return array<string,mixed> */
    public static function pourClient(Contexte $c, string $gid): array
    {
        self::groupeVisible($c, $gid);
        $pdo = $c->db->principale();
        $st = $pdo->prepare('SELECT titre, ue, referent, date_rendu, modifie_le FROM memoires WHERE groupe_id = ?');
        $st->execute([$gid]);
        $en = $st->fetch() ?: ['titre' => '', 'ue' => '', 'referent' => '', 'auteurs' => '', 'date_rendu' => '', 'modifie_le' => null];
        $st = $pdo->prepare(
            'SELECT b.id, b.ordre, b.type, b.texte, b.modifie_le, u.prenom, u.nom, u.pseudo
             FROM memoire_blocs b LEFT JOIN utilisateurs u ON u.id = b.auteur_id WHERE b.groupe_id = ? ORDER BY b.ordre, b.id'
        );
        $st->execute([$gid]);
        $blocs = [];
        foreach ($st->fetchAll() as $r) {
            $blocs[] = ['id' => (string) $r['id'], 'type' => (string) $r['type'], 'texte' => (string) ($r['texte'] ?? ''),
                'par' => $r['prenom'] === null ? '' : Utilisateur::nomAffiche((string) $r['prenom'], (string) $r['nom'], $r['pseudo'] === null ? null : (string) $r['pseudo']),
                'modifie_le' => Temps::iso((string) $r['modifie_le'])];
        }
        return [
            'groupe_id' => $gid,
            'titre' => (string) $en['titre'], 'ue' => (string) $en['ue'], 'referent' => (string) $en['referent'], 'auteurs' => (string) $en['auteurs'], 'date_rendu' => (string) $en['date_rendu'],
            'modifie_le' => Temps::iso($en['modifie_le'] === null ? null : (string) $en['modifie_le']),
            'blocs' => $blocs,
            'modifiable' => $c->droits()->estEtudiant() && Membres::estMembre($pdo, $gid, (int) $c->user->id),
        ];
    }

    /** En-tête du mémoire (titre, UE, référent, date de rendu). @param array<string,mixed> $data */
    public static function enregistrerEntete(Contexte $c, string $gid, mixed $data): void
    {
        $pdo = self::exigerMembre($c, $gid);
        if (!is_array($data)) {
            throw new Erreur('invalid', 'Données manquantes');
        }
        $t = [];
        foreach (['titre' => 200, 'ue' => 200, 'referent' => 120, 'auteurs' => 300] as $k => $max) {
            $v = is_scalar($data[$k] ?? null) ? trim((string) $data[$k]) : '';
            if (mb_strlen($v) > $max) {
                throw new Erreur('invalid', "Champ « $k » trop long ($max caractères maximum)");
            }
            $t[$k] = $v;
        }
        $date = is_scalar($data['date_rendu'] ?? null) ? (string) $data['date_rendu'] : '';
        if ($date !== '' && (preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $date, $m) !== 1 || !checkdate((int) $m[2], (int) $m[3], (int) $m[1]))) {
            throw new Erreur('invalid', 'Date de rendu invalide');
        }
        $now = Temps::maintenant();
        $pdo->prepare('INSERT INTO memoires (groupe_id, titre, ue, referent, auteurs, date_rendu, modifie_le, modifie_par) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                       ON DUPLICATE KEY UPDATE titre = VALUES(titre), ue = VALUES(ue), referent = VALUES(referent), auteurs = VALUES(auteurs), date_rendu = VALUES(date_rendu), modifie_le = VALUES(modifie_le), modifie_par = VALUES(modifie_par)')
            ->execute([$gid, $t['titre'], $t['ue'], $t['referent'], $t['auteurs'], $date, $now, $c->user->id]);
    }

    /** Ajoute (sans id) ou modifie (avec id) un bloc. @param array<string,mixed> $data */
    public static function enregistrerBloc(Contexte $c, string $gid, mixed $id, mixed $data): void
    {
        $pdo = self::exigerMembre($c, $gid);
        if (!is_array($data)) {
            throw new Erreur('invalid', 'Données manquantes');
        }
        $type = is_string($data['type'] ?? null) ? $data['type'] : '';
        if (!in_array($type, self::TYPES, true)) {
            throw new Erreur('invalid', 'Type de bloc inconnu');
        }
        $texte = is_scalar($data['texte'] ?? null) ? (string) $data['texte'] : '';
        if (mb_strlen($texte) > self::TEXTE_MAX) {
            throw new Erreur('invalid', 'Bloc trop long (' . self::TEXTE_MAX . ' caractères maximum)');
        }
        $now = Temps::maintenant();
        $identifiant = is_string($id) ? $id : '';
        if ($identifiant === '') {
            $st = $pdo->prepare('SELECT COUNT(*) FROM memoire_blocs WHERE groupe_id = ?');
            $st->execute([$gid]);
            if ((int) $st->fetchColumn() >= self::MAX_BLOCS) {
                throw new Erreur('limit', 'Le mémoire a atteint sa taille maximale');
            }
            $st = $pdo->prepare('SELECT COALESCE(MAX(ordre), 0) + 1 FROM memoire_blocs WHERE groupe_id = ?');
            $st->execute([$gid]);
            $pdo->prepare('INSERT INTO memoire_blocs (id, groupe_id, ordre, type, texte, auteur_id, modifie_le) VALUES (?, ?, ?, ?, ?, ?, ?)')
                ->execute([Ids::uuid(), $gid, (int) $st->fetchColumn(), $type, $texte, $c->user->id, $now]);
            return;
        }
        $st = $pdo->prepare('SELECT groupe_id FROM memoire_blocs WHERE id = ?');
        $st->execute([$identifiant]);
        if ((string) $st->fetchColumn() !== $gid) {
            throw new Erreur('not_found', 'Bloc introuvable');
        }
        $pdo->prepare('UPDATE memoire_blocs SET type = ?, texte = ?, auteur_id = ?, modifie_le = ? WHERE id = ?')
            ->execute([$type, $texte, $c->user->id, $now, $identifiant]);
    }

    public static function supprimerBloc(Contexte $c, string $gid, mixed $id): void
    {
        $pdo = self::exigerMembre($c, $gid);
        $pdo->prepare('DELETE FROM memoire_blocs WHERE id = ? AND groupe_id = ?')->execute([is_string($id) ? $id : '', $gid]);
    }

    /** Nouvel ordre des blocs : la liste d'identifiants doit contenir tous les blocs du mémoire, une seule fois. @param mixed $ids */
    public static function reordonner(Contexte $c, string $gid, mixed $ids): void
    {
        $pdo = self::exigerMembre($c, $gid);
        if (!is_array($ids) || !array_is_list($ids)) {
            throw new Erreur('invalid', 'Ordre invalide');
        }
        $st = $pdo->prepare('SELECT id FROM memoire_blocs WHERE groupe_id = ?');
        $st->execute([$gid]);
        $actuels = array_map('strval', $st->fetchAll(\PDO::FETCH_COLUMN));
        $ids = array_map('strval', $ids);
        sort($actuels);
        $tries = $ids;
        sort($tries);
        if ($actuels !== $tries) {
            throw new Erreur('invalid', 'L’ordre ne correspond pas aux blocs du mémoire');
        }
        $pdo->beginTransaction();
        try {
            foreach ($ids as $i => $id) {
                $pdo->prepare('UPDATE memoire_blocs SET ordre = ? WHERE id = ? AND groupe_id = ?')->execute([$i + 1, $id, $gid]);
            }
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
    }
}
