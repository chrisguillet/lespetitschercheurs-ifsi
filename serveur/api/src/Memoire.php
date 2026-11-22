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
        // Notes de bas de page : ^[texte], fermées et non vides (une note ne contient ni crochet ni autre note).
        if (preg_match_all('/\^\[[^\[\]]*\]/u', $texte) !== substr_count($texte, '^[')) {
            throw new Erreur('invalid', 'Note de bas de page mal fermée : écrivez ^[texte de la note]');
        }
        if (preg_match('/\^\[\s*\]/u', $texte) === 1) {
            throw new Erreur('invalid', 'Note de bas de page vide');
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

    /** Nom de fichier normalisé de la maquette : NOM.Prénom_UE_Titre_AAAAMMJJ, sans espaces. */
    public static function nomFichier(string $nom, string $prenom, string $ue, string $titre, string $date, string $ext): string
    {
        $u = preg_match('/UE\s*(\d+(?:\.\d+)?)/i', $ue, $m) === 1 ? 'UE' . $m[1] : (trim($ue) === '' ? 'UE' : trim($ue));
        $nettoie = static fn (string $s): string => trim((string) preg_replace('/[^\p{L}\p{N}]+/u', '-', $s), '-');
        $t = $nettoie($titre);
        $jour = preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) === 1 ? str_replace('-', '', $date) : gmdate('Ymd');
        return $nettoie(mb_strtoupper($nom)) . '.' . $nettoie($prenom) . '_' . $nettoie($u) . '_' . substr($t, 0, 60) . '_' . $jour . '.' . $ext;
    }

    /** Exporte le mémoire en DOCX ou ODT, aux normes de la maquette. @return array{nom:string,type:string,contenu:string} */
    public static function exporter(Contexte $c, string $gid, string $format): array
    {
        self::groupeVisible($c, $gid);
        if (!in_array($format, ['docx', 'odt'], true)) {
            throw new Erreur('invalid', 'Format d’export inconnu');
        }
        $pdo = $c->db->principale();
        $st = $pdo->prepare('SELECT m.titre, m.ue, m.referent, m.auteurs, m.date_rendu, p.nom AS promo FROM groupes g JOIN promos p ON p.id = g.promo_id LEFT JOIN memoires m ON m.groupe_id = g.id WHERE g.id = ?');
        $st->execute([$gid]);
        $en = $st->fetch();
        if ($en === false) {
            throw new Erreur('not_found', 'Groupe introuvable');
        }
        $st = $pdo->prepare('SELECT type, texte FROM memoire_blocs WHERE groupe_id = ? ORDER BY ordre, id');
        $st->execute([$gid]);
        $blocs = [];
        foreach ($st->fetchAll() as $r) {
            $blocs[] = ['type' => (string) $r['type'], 'texte' => (string) ($r['texte'] ?? '')];
        }
        $date = (string) ($en['date_rendu'] ?? '');
        $dateAff = $date !== '' ? substr($date, 8, 2) . '/' . substr($date, 5, 2) . '/' . substr($date, 0, 4) : '';
        $annees = preg_match('/(\d{2})\s*-\s*(\d{2})/', (string) $en['promo'], $pm) === 1
            ? 'PROMOTION 20' . $pm[1] . '-20' . $pm[2] : strtoupper((string) $en['promo']);
        $auteurs = (string) ($en['auteurs'] ?? '');
        $ue = (string) ($en['ue'] ?? '');
        $titre = (string) ($en['titre'] ?? '');
        $entete = [
            'titre' => $titre, 'ue' => $ue, 'referent' => (string) ($en['referent'] ?? ''),
            'auteurs' => $auteurs, 'date' => $dateAff, 'promo' => $annees,
            'nom_pied' => 'IFSI GAVY – SAINT-NAZAIRE – ' . ($ue !== '' ? $ue : 'UE') . ' – ' . $titre . ' – ' . $annees . ' – '
                . ($auteurs !== '' ? $auteurs : 'NOM Prénom') . ' – ' . ($dateAff !== '' ? $dateAff : 'Date'),
        ];
        $u = $c->user;
        $nom = self::nomFichier((string) $u->nom, (string) $u->prenom, $ue, $titre, $date, $format);
        $contenu = $format === 'docx' ? MemoireExport::docx($entete, $blocs) : MemoireExport::odt($entete, $blocs);
        $type = $format === 'docx'
            ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            : 'application/vnd.oasis.opendocument.text';
        return ['nom' => $nom, 'type' => $type, 'contenu' => base64_encode($contenu)];
    }
}
