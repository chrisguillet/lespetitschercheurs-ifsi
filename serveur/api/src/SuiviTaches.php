<?php
declare(strict_types=1);

namespace Lpc;

/**
 * Tâches issues d'un compte rendu (une personne ou plusieurs du groupe) et liens vers d'autres éléments : fiches de lecture
 * (articles) et blocs du mémoire, chaque lien avec la raison pour laquelle il est utile. Un lien se pose sur une tâche
 * ou directement sur le compte rendu.
 * Lecture : mêmes droits que le compte rendu. Écriture : membres du groupe.
 */
final class SuiviTaches
{
    public const TEXTE_MAX = 300;
    public const CIBLES = ['fiche', 'bloc_memoire'];

    /** Tâches et liens des comptes rendus des groupes donnés. @param list<string> $gids @return array{taches:array<string,list<array<string,mixed>>>,liens:array<string,list<array<string,mixed>>>} */
    public static function pourReunions(\PDO $pdo, array $gids): array
    {
        $out = ['taches' => [], 'liens' => []];
        if ($gids === []) {
            return $out;
        }
        $marques = Lectures::marques(count($gids));
        $st = $pdo->prepare("SELECT t.id, t.reunion_id, t.texte, t.fait, j.echeance FROM taches t LEFT JOIN jalons j ON j.tache_id = t.id WHERE t.groupe_id IN ($marques) ORDER BY t.ordre, t.cree_le, t.id");
        $st->execute($gids);
        $taches = [];
        foreach ($st->fetchAll() as $t) {
            $taches[(string) $t['id']] = ['id' => (string) $t['id'], 'reunion_id' => (string) $t['reunion_id'], 'texte' => (string) $t['texte'], 'fait' => (int) $t['fait'] === 1,
                'echeance' => $t['echeance'] === null ? '' : (string) $t['echeance'], 'personnes' => [], 'liens' => []];
        }
        // Personnes assignées (seulement celles qui sont encore membres du groupe).
        $sp = $pdo->prepare("SELECT tp.tache_id, u.pid, u.prenom, u.nom, u.pseudo, u.couleur
                             FROM taches_personnes tp JOIN taches t ON t.id = tp.tache_id JOIN utilisateurs u ON u.id = tp.utilisateur_id
                             JOIN membres m ON m.utilisateur_id = tp.utilisateur_id AND m.groupe_id = t.groupe_id
                             WHERE t.groupe_id IN ($marques) ORDER BY u.prenom");
        $sp->execute($gids);
        foreach ($sp->fetchAll() as $p) {
            if (isset($taches[(string) $p['tache_id']])) {
                $taches[(string) $p['tache_id']]['personnes'][] = ['pid' => (string) $p['pid'], 'prenom' => Utilisateur::nomAffiche((string) $p['prenom'], (string) $p['nom'], $p['pseudo'] === null ? null : (string) $p['pseudo']), 'couleur' => (string) $p['couleur']];
            }
        }
        $sl = $pdo->prepare("SELECT l.id, l.reunion_id, l.tache_id, l.cible_type, l.cible_id, l.description, l.cree_le, u.prenom, u.nom AS u_nom, u.pseudo
                             FROM liens l LEFT JOIN utilisateurs u ON u.id = l.cree_par WHERE l.groupe_id IN ($marques) ORDER BY l.cree_le, l.id");
        $sl->execute($gids);
        $liens = $sl->fetchAll();
        $libelles = self::libelles($pdo, $liens);
        foreach ($liens as $l) {
            $lien = [
                'id' => (string) $l['id'], 'cible_type' => (string) $l['cible_type'], 'cible_id' => (string) $l['cible_id'],
                'description' => (string) $l['description'], 'libelle' => $libelles[(string) $l['cible_type'] . ':' . (string) $l['cible_id']] ?? 'Élément supprimé',
                'par' => $l['prenom'] === null ? 'Utilisateur supprimé' : Utilisateur::nomAffiche((string) $l['prenom'], (string) $l['u_nom'], $l['pseudo'] === null ? null : (string) $l['pseudo']),
                'cree_le' => Temps::iso((string) $l['cree_le']),
            ];
            if ($l['tache_id'] !== null && isset($taches[(string) $l['tache_id']])) {
                $taches[(string) $l['tache_id']]['liens'][] = $lien;
            } else {
                $out['liens'][(string) $l['reunion_id']][] = $lien;
            }
        }
        foreach ($taches as $t) {
            $out['taches'][$t['reunion_id']][] = ['id' => $t['id'], 'texte' => $t['texte'], 'fait' => $t['fait'], 'echeance' => $t['echeance'], 'personnes' => $t['personnes'], 'liens' => $t['liens']];
        }
        return $out;
    }

    /** Crée (sans id) ou modifie (avec id) une tâche du compte rendu. @param mixed $data */
    public static function enregistrerTache(Contexte $c, string $reunionId, mixed $id, mixed $data): void
    {
        $pdo = $c->db->principale();
        $gid = self::exigerMembreDuCr($c, $pdo, $reunionId);
        if (!is_array($data)) {
            throw new Erreur('invalid', 'Données manquantes');
        }
        $texte = is_scalar($data['texte'] ?? null) ? trim((string) $data['texte']) : '';
        if ($texte === '') {
            throw new Erreur('invalid', 'Indiquez la tâche');
        }
        if (mb_strlen($texte) > self::TEXTE_MAX) {
            throw new Erreur('invalid', 'Tâche trop longue (' . self::TEXTE_MAX . ' caractères maximum)');
        }
        $fait = !empty($data['fait']) ? 1 : 0;
        $echeance = is_scalar($data['echeance'] ?? null) ? trim((string) $data['echeance']) : '';
        if ($echeance !== '' && (preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $echeance, $m) !== 1 || !checkdate((int) $m[2], (int) $m[3], (int) $m[1]))) {
            throw new Erreur('invalid', 'Échéance invalide');
        }
        $uid = (int) $c->user->id;
        $now = Temps::maintenant();
        $identifiant = is_string($id) ? $id : '';
        if ($identifiant === '') {
            $identifiant = Ids::uuid();
            $st = $pdo->prepare('SELECT COALESCE(MAX(ordre), 0) + 1 FROM taches WHERE reunion_id = ?');
            $st->execute([$reunionId]);
            $pdo->prepare('INSERT INTO taches (id, groupe_id, reunion_id, texte, fait, ordre, cree_par, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
                ->execute([$identifiant, $gid, $reunionId, $texte, $fait, (int) $st->fetchColumn(), $uid, $now]);
        } else {
            $st = $pdo->prepare('SELECT groupe_id FROM taches WHERE id = ? AND reunion_id = ?');
            $st->execute([$identifiant, $reunionId]);
            if ($st->fetchColumn() === false) {
                throw new Erreur('not_found', 'Tâche introuvable');
            }
            $pdo->prepare('UPDATE taches SET texte = ?, fait = ?, modifie_le = ?, modifie_par = ? WHERE id = ?')->execute([$texte, $fait, $now, $uid, $identifiant]);
        }
        if (is_array($data['personnes'] ?? null)) {
            self::personnes($pdo, $gid, $identifiant, $data['personnes']);
        }
        self::synchroniserJalon($pdo, $gid, $reunionId, $identifiant, $texte, $fait === 1, $echeance, $uid);
    }

    /**
     * Une tâche datée est un jalon « tâche » du calendrier : titre, échéance, statut et personnes suivent la tâche.
     * Sans échéance, le jalon est retiré.
     */
    private static function synchroniserJalon(\PDO $pdo, string $gid, string $reunionId, string $tacheId, string $texte, bool $fait, string $echeance, int $uid): void
    {
        $st = $pdo->prepare('SELECT id FROM jalons WHERE tache_id = ?');
        $st->execute([$tacheId]);
        $jalon = $st->fetchColumn();
        if ($echeance === '') {
            if ($jalon !== false) {
                $pdo->prepare('DELETE FROM jalons WHERE id = ?')->execute([$jalon]);
            }
            return;
        }
        $st = $pdo->prepare('SELECT date, titre FROM reunions WHERE id = ?');
        $st->execute([$reunionId]);
        $cr = $st->fetch() ?: ['date' => null, 'titre' => ''];
        $quand = $cr['date'] !== null ? substr((string) $cr['date'], 8, 2) . '/' . substr((string) $cr['date'], 5, 2) : '';
        $note = mb_substr(trim('Compte rendu du ' . $quand . ($cr['titre'] !== '' ? ' : ' . (string) $cr['titre'] : '')), 0, 500);
        $titre = mb_substr($texte, 0, 200);
        $statut = $fait ? 'fait' : 'a_faire';
        $now = Temps::maintenant();
        if ($jalon === false) {
            $jalon = Ids::uuid();
            $pdo->prepare('INSERT INTO jalons (id, groupe_id, titre, type, echeance, statut, note, tache_id, cree_par, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
                ->execute([$jalon, $gid, $titre, 'tache', $echeance, $statut, $note, $tacheId, $uid, $now]);
        } else {
            $pdo->prepare('UPDATE jalons SET titre = ?, echeance = ?, statut = ?, note = ?, modifie_le = ? WHERE id = ?')
                ->execute([$titre, $echeance, $statut, $note, $now, $jalon]);
        }
        // Personnes du jalon = personnes de la tâche.
        $pdo->prepare('DELETE FROM jalons_personnes WHERE jalon_id = ?')->execute([$jalon]);
        $pdo->prepare('INSERT INTO jalons_personnes (jalon_id, utilisateur_id) SELECT ?, utilisateur_id FROM taches_personnes WHERE tache_id = ?')
            ->execute([$jalon, $tacheId]);
    }

    public static function supprimerTache(Contexte $c, mixed $id): void
    {
        $pdo = $c->db->principale();
        $identifiant = is_string($id) ? $id : '';
        $st = $pdo->prepare('SELECT reunion_id FROM taches WHERE id = ?');
        $st->execute([$identifiant]);
        $reunion = $st->fetchColumn();
        if ($reunion === false) {
            throw new Erreur('not_found', 'Tâche introuvable');
        }
        self::exigerMembreDuCr($c, $pdo, (string) $reunion);
        $pdo->prepare('DELETE FROM taches WHERE id = ?')->execute([$identifiant]);
    }

    /**
     * Crée ou modifie un lien. $tacheId : la tâche concernée, ou vide pour un lien posé sur le compte rendu.
     * @param mixed $data cible_type, cible_id, description
     */
    public static function enregistrerLien(Contexte $c, string $reunionId, mixed $tacheId, mixed $id, mixed $data): void
    {
        $pdo = $c->db->principale();
        $gid = self::exigerMembreDuCr($c, $pdo, $reunionId);
        if (!is_array($data)) {
            throw new Erreur('invalid', 'Données manquantes');
        }
        $tache = is_string($tacheId) && $tacheId !== '' ? $tacheId : null;
        if ($tache !== null) {
            $st = $pdo->prepare('SELECT 1 FROM taches WHERE id = ? AND reunion_id = ?');
            $st->execute([$tache, $reunionId]);
            if ($st->fetchColumn() === false) {
                throw new Erreur('not_found', 'Tâche introuvable');
            }
        }
        $type = is_string($data['cible_type'] ?? null) ? $data['cible_type'] : '';
        if (!in_array($type, self::CIBLES, true)) {
            throw new Erreur('invalid', 'Type de lien inconnu');
        }
        $cible = is_scalar($data['cible_id'] ?? null) ? (string) $data['cible_id'] : '';
        self::verifierCible($pdo, $gid, $type, $cible);
        $description = is_scalar($data['description'] ?? null) ? trim((string) $data['description']) : '';
        if ($description === '') {
            throw new Erreur('invalid', 'Indiquez pourquoi ce lien est utile');
        }
        if (mb_strlen($description) > 300) {
            throw new Erreur('invalid', 'Description trop longue (300 caractères maximum)');
        }
        $identifiant = is_string($id) ? $id : '';
        if ($identifiant === '') {
            $pdo->prepare('INSERT INTO liens (id, groupe_id, reunion_id, tache_id, cible_type, cible_id, description, cree_par, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
                ->execute([Ids::uuid(), $gid, $reunionId, $tache, $type, $cible, $description, $c->user->id, Temps::maintenant()]);
            return;
        }
        $st = $pdo->prepare('SELECT 1 FROM liens WHERE id = ? AND reunion_id = ?');
        $st->execute([$identifiant, $reunionId]);
        if ($st->fetchColumn() === false) {
            throw new Erreur('not_found', 'Lien introuvable');
        }
        $pdo->prepare('UPDATE liens SET cible_type = ?, cible_id = ?, description = ?, tache_id = ? WHERE id = ?')->execute([$type, $cible, $description, $tache, $identifiant]);
    }

    public static function supprimerLien(Contexte $c, mixed $id): void
    {
        $pdo = $c->db->principale();
        $identifiant = is_string($id) ? $id : '';
        $st = $pdo->prepare('SELECT reunion_id FROM liens WHERE id = ?');
        $st->execute([$identifiant]);
        $reunion = $st->fetchColumn();
        if ($reunion === false) {
            throw new Erreur('not_found', 'Lien introuvable');
        }
        self::exigerMembreDuCr($c, $pdo, (string) $reunion);
        $pdo->prepare('DELETE FROM liens WHERE id = ?')->execute([$identifiant]);
    }

    // ---------- Interne ----------

    /** Le compte rendu doit exister, et la personne doit être membre de son groupe. */
    private static function exigerMembreDuCr(Contexte $c, \PDO $pdo, string $reunionId): string
    {
        Lectures::exigerEtudiant($c);
        $st = $pdo->prepare('SELECT groupe_id FROM reunions WHERE id = ?');
        $st->execute([$reunionId]);
        $gid = $st->fetchColumn();
        if ($gid === false) {
            throw new Erreur('not_found', 'Compte rendu introuvable');
        }
        if (!Membres::estMembre($pdo, (string) $gid, (int) $c->user->id)) {
            throw new Erreur('forbidden', 'Seules les membres du groupe modifient ses comptes rendus');
        }
        return (string) $gid;
    }

    /** La cible doit appartenir au même groupe (fiche de lecture ou bloc du mémoire). */
    private static function verifierCible(\PDO $pdo, string $gid, string $type, string $cible): void
    {
        if ($type === 'fiche') {
            $st = $pdo->prepare('SELECT 1 FROM analyses WHERE id = ? AND groupe_id = ?');
        } else {
            $st = $pdo->prepare('SELECT 1 FROM memoire_blocs WHERE id = ? AND groupe_id = ?');
        }
        $st->execute([$cible, $gid]);
        if ($st->fetchColumn() === false) {
            throw new Erreur('invalid', 'L’élément choisi n’est pas dans ce groupe');
        }
    }

    /**
     * Libellé lisible de chaque cible : titre de l'article pour une fiche, début du texte pour un bloc du mémoire.
     * @param list<array<string,mixed>> $liens @return array<string,string>
     */
    private static function libelles(\PDO $pdo, array $liens): array
    {
        $out = [];
        $fiches = array_values(array_unique(array_map(static fn (array $l): string => (string) $l['cible_id'], array_filter($liens, static fn (array $l): bool => $l['cible_type'] === 'fiche'))));
        if ($fiches !== []) {
            $st = $pdo->prepare('SELECT an.id, a.titre FROM analyses an JOIN articles a ON a.id = an.article_id WHERE an.id IN (' . Lectures::marques(count($fiches)) . ')');
            $st->execute($fiches);
            foreach ($st->fetchAll() as $r) {
                $out['fiche:' . (string) $r['id']] = 'Fiche : ' . (string) $r['titre'];
            }
        }
        $blocs = array_values(array_unique(array_map(static fn (array $l): string => (string) $l['cible_id'], array_filter($liens, static fn (array $l): bool => $l['cible_type'] === 'bloc_memoire'))));
        if ($blocs !== []) {
            $st = $pdo->prepare('SELECT id, texte FROM memoire_blocs WHERE id IN (' . Lectures::marques(count($blocs)) . ')');
            $st->execute($blocs);
            foreach ($st->fetchAll() as $r) {
                $texte = trim((string) preg_replace('/\s+/u', ' ', str_replace(['**', '*', '^[', ']'], '', (string) $r['texte'])));
                $out['bloc_memoire:' . (string) $r['id']] = 'Mémoire : ' . ($texte !== '' ? mb_substr($texte, 0, 80) : '(bloc vide)');
            }
        }
        return $out;
    }

    /** @param list<mixed> $pids */
    private static function personnes(\PDO $pdo, string $gid, string $tacheId, array $pids): void
    {
        $ids = [];
        foreach (array_slice(array_values(array_unique(array_filter($pids, 'is_string'))), 0, 30) as $pid) {
            $u = Utilisateurs::parPid($pdo, $pid);
            if ($u === null || $u->id === null || !Membres::estMembre($pdo, $gid, $u->id)) {
                throw new Erreur('invalid', 'Une personne choisie ne fait pas partie de ce groupe');
            }
            $ids[] = $u->id;
        }
        $pdo->prepare('DELETE FROM taches_personnes WHERE tache_id = ?')->execute([$tacheId]);
        foreach ($ids as $id) {
            $pdo->prepare('INSERT INTO taches_personnes (tache_id, utilisateur_id) VALUES (?, ?)')->execute([$tacheId, $id]);
        }
    }
}
