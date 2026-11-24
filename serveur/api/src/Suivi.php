<?php
declare(strict_types=1);

namespace Lpc;

/**
 * Suivi de projet d'un groupe : comptes rendus de réunion, jalons du rétroplanning (dates ou plages, alertes) et glossaire.
 * Visibles du groupe, de ses formateurs rattachés et de ses administrateurs ; modifiables par les étudiantes du groupe.
 */
final class Suivi
{
    public const STATUTS_JALON = ['a_faire', 'en_cours', 'fait'];
    /** Types d'entrée du rétroplanning. */
    public const TYPES_JALON = ['tache', 'reunion', 'rappel', 'evenement', 'echeance'];

    private const TYPES = [
        'reunion' => ['table' => 'reunions', 'champs' => ['date', 'titre', 'participants', 'objectifs', 'vu', 'attendu', 'suite']],
        'jalon' => ['table' => 'jalons', 'champs' => ['titre', 'type', 'echeance', 'heure', 'statut', 'note', 'visio', 'debut', 'alerte_jours']],
        'terme' => ['table' => 'glossaire', 'champs' => ['mot', 'definition', 'reference', 'type', 'auteur', 'annee', 'titre_source', 'editeur', 'page', 'lien']],
        'regle' => ['table' => 'regles', 'champs' => ['titre', 'description']],
    ];
    /** Charte de fonctionnement : nombre maximal de règles par groupe. */
    public const REGLES_MAX = 50;
    private const DATES = ['date', 'echeance', 'debut'];
    private const TITRE_MAX = 200;

    /** Crée (sans id) ou modifie (avec id) un élément du groupe de la personne. */
    public static function enregistrer(Contexte $c, string $type, mixed $groupeId, mixed $id, mixed $data): void
    {
        Lectures::exigerEtudiant($c);
        if (!is_array($data)) {
            throw new Erreur('invalid', 'Données manquantes');
        }
        $def = self::TYPES[$type];
        $table = $def['table'];
        $pdo = $c->db->principale();
        $uid = (int) $c->user->id;
        $gid = is_string($groupeId) ? $groupeId : '';
        $identifiant = is_string($id) ? $id : '';
        if ($identifiant !== '') {
            $st = $pdo->prepare("SELECT groupe_id FROM `$table` WHERE id = ?");
            $st->execute([$identifiant]);
            $g = $st->fetchColumn();
            if ($g === false) {
                throw new Erreur('not_found', 'Élément introuvable');
            }
            $gid = (string) $g;
        }
        if ($gid === '' || !Membres::estMembre($pdo, $gid, $uid)) {
            throw new Erreur('forbidden', 'Vous ne faites pas partie de ce groupe');
        }
        if ($type === 'jalon' && $identifiant !== '' && self::estDeTache($pdo, $identifiant)) {
            throw new Erreur('forbidden', 'Cette échéance vient d’une tâche de compte rendu : modifiez-la dans le compte rendu');
        }

        $d = [];
        foreach ($def['champs'] as $k) {
            $v = array_key_exists($k, $data) && is_scalar($data[$k]) ? trim((string) $data[$k]) : '';
            if (mb_strlen($v) > Lectures::LONGUEUR_MAX) {
                throw new Erreur('invalid', 'Champ trop long (' . Lectures::LONGUEUR_MAX . ' caractères maximum)');
            }
            $d[$k] = $v;
        }
        if ($type === 'jalon') {
            $d['statut'] = $d['statut'] === '' ? 'a_faire' : $d['statut'];
            $d['type'] = $d['type'] === '' ? 'tache' : $d['type'];
        }
        if ($type === 'terme') {
            $d['type'] = $d['type'] === '' ? 'definition' : $d['type'];
        }
        self::valider($type, $d);
        if ($type === 'terme') {
            // Un mot n'apparaît qu'une fois par groupe (sans tenir compte de la casse ni des accents) : on modifie sa définition.
            $st = $pdo->prepare('SELECT id, mot FROM glossaire WHERE groupe_id = ?');
            $st->execute([$gid]);
            foreach ($st->fetchAll() as $x) {
                if ((string) $x['id'] !== $identifiant && Lectures::normaliser((string) $x['mot']) === Lectures::normaliser($d['mot'])) {
                    throw new Erreur('duplicate', 'Ce mot est déjà dans le glossaire : modifiez sa définition.');
                }
            }
        }

        $now = Temps::maintenant();
        $valeurs = array_map(static fn (string $k): mixed => self::valeurSql($k, $d[$k]), $def['champs']);
        $colonnes = implode(', ', array_map(static fn (string $k): string => "`$k`", $def['champs']));
        if ($identifiant === '') {
            $identifiant = Ids::uuid();
            $pdo->prepare("INSERT INTO `$table` (id, groupe_id, cree_par, cree_le, $colonnes) VALUES (?, ?, ?, ?, " . Lectures::marques(count($valeurs)) . ')')
                ->execute([$identifiant, $gid, $uid, $now, ...$valeurs]);
            if ($type === 'regle') {
                // Nouvelle règle : à la fin de la charte, dans la limite du nombre de règles.
                $st = $pdo->prepare('SELECT COUNT(*), COALESCE(MAX(ordre), 0) FROM regles WHERE groupe_id = ? AND id <> ?');
                $st->execute([$gid, $identifiant]);
                [$nb, $max] = $st->fetch(\PDO::FETCH_NUM);
                if ((int) $nb >= self::REGLES_MAX) {
                    $pdo->prepare('DELETE FROM regles WHERE id = ?')->execute([$identifiant]);
                    throw new Erreur('limit', 'La charte compte déjà ' . self::REGLES_MAX . ' règles : regroupez-en avant d’en ajouter');
                }
                $pdo->prepare('UPDATE regles SET ordre = ? WHERE id = ?')->execute([(int) $max + 1, $identifiant]);
            }
        } elseif ($type === 'reunion') {
            self::modifierReunion($pdo, $identifiant, $d, $data, $uid, $now);
        } else {
            $sets = implode(', ', array_map(static fn (string $k): string => "`$k` = ?", $def['champs']));
            $pdo->prepare("UPDATE `$table` SET $sets, modifie_le = ?, modifie_par = ? WHERE id = ?")->execute([...$valeurs, $now, $uid, $identifiant]);
        }
        if ($type === 'jalon' && is_array($data['personnes'] ?? null)) {
            self::personnesDuJalon($pdo, $gid, $identifiant, $data['personnes']);
        }
    }

    /**
     * Remplace les personnes assignées à un jalon. Chaque personne doit être membre du groupe ; on reçoit leurs identifiants publics.
     *
     * @param array<mixed> $pids
     */
    private static function personnesDuJalon(\PDO $pdo, string $gid, string $jalonId, array $pids): void
    {
        $ids = [];
        foreach (array_slice(array_values(array_unique(array_filter($pids, 'is_string'))), 0, 30) as $pid) {
            $u = Utilisateurs::parPid($pdo, $pid);
            if ($u === null || $u->id === null || !Membres::estMembre($pdo, $gid, $u->id)) {
                throw new Erreur('invalid', 'Une personne choisie ne fait pas partie de ce groupe');
            }
            $ids[] = $u->id;
        }
        $pdo->prepare('DELETE FROM jalons_personnes WHERE jalon_id = ?')->execute([$jalonId]);
        foreach ($ids as $id) {
            $pdo->prepare('INSERT INTO jalons_personnes (jalon_id, utilisateur_id) VALUES (?, ?)')->execute([$jalonId, $id]);
        }
    }

    /** Les étudiantes du groupe modifient et suppriment ; un administrateur du groupe peut aussi supprimer (modération). */
    public static function supprimer(Contexte $c, string $type, string $id): void
    {
        $table = self::TYPES[$type]['table'];
        $pdo = $c->db->principale();
        $st = $pdo->prepare("SELECT groupe_id FROM `$table` WHERE id = ?");
        $st->execute([$id]);
        $g = $st->fetchColumn();
        if ($g === false) {
            throw new Erreur('not_found', 'Élément introuvable');
        }
        if (!$c->droits()->peutAdministrerGroupe((string) $g)) {
            Lectures::exigerEtudiant($c);
            if (!Membres::estMembre($pdo, (string) $g, (int) $c->user->id)) {
                throw new Erreur('forbidden', 'Vous ne faites pas partie de ce groupe');
            }
        }
        if ($type === 'jalon' && self::estDeTache($pdo, $id)) {
            throw new Erreur('forbidden', 'Cette échéance vient d’une tâche de compte rendu : supprimez la tâche dans le compte rendu');
        }
        $pdo->prepare("DELETE FROM `$table` WHERE id = ?")->execute([$id]);
    }

    /** Éléments des groupes que la personne voit (les siens et ceux qu'elle administre). @return list<array<string,mixed>> */
    public static function pourClient(Contexte $c, string $type): array
    {
        $gids = Donnees::idsGroupesVisibles($c);
        if ($c->user->id === null || $gids === []) {
            return [];
        }
        $def = self::TYPES[$type];
        $table = $def['table'];
        $pdo = $c->db->principale();
        // Un jalon issu d'une tâche connaît son compte rendu (aperçu et édition depuis le calendrier).
        $selTache = $type === 'jalon' ? 'tk.reunion_id AS reunion_id, ' : '';
        $jointure = $type === 'jalon' ? 'LEFT JOIN taches tk ON tk.id = t.tache_id' : '';
        $st = $pdo->prepare("SELECT t.*, $selTache u.prenom, u.nom AS u_nom, u.pseudo, u.couleur AS u_couleur, m.prenom AS m_prenom, m.nom AS m_nom, m.pseudo AS m_pseudo
                             FROM `$table` t $jointure LEFT JOIN utilisateurs u ON u.id = t.cree_par LEFT JOIN utilisateurs m ON m.id = t.modifie_par
                             WHERE t.groupe_id IN (" . Lectures::marques(count($gids)) . ') ORDER BY ' . ($type === 'regle' ? 't.ordre, ' : '') . 't.cree_le, t.id');
        $st->execute($gids);
        $etudiant = $c->droits()->estEtudiant();
        // Personnes assignées aux jalons (seulement celles qui sont encore membres du groupe).
        $assignes = [];
        if ($type === 'jalon') {
            $sa = $pdo->prepare("SELECT jp.jalon_id, u.pid, u.prenom, u.nom, u.pseudo, u.couleur, m.groupe_id
                                 FROM jalons_personnes jp JOIN jalons j ON j.id = jp.jalon_id
                                 JOIN utilisateurs u ON u.id = jp.utilisateur_id
                                 JOIN membres m ON m.utilisateur_id = jp.utilisateur_id AND m.groupe_id = j.groupe_id
                                 WHERE j.groupe_id IN (" . Lectures::marques(count($gids)) . ') ORDER BY u.prenom');
            $sa->execute($gids);
            foreach ($sa->fetchAll() as $p) {
                $assignes[(string) $p['jalon_id']][] = ['pid' => (string) $p['pid'], 'prenom' => Utilisateur::nomAffiche((string) $p['prenom'], (string) $p['nom'], $p['pseudo'] === null ? null : (string) $p['pseudo']), 'couleur' => (string) $p['couleur']];
            }
        }
        $out = [];
        foreach ($st->fetchAll() as $r) {
            $o = [
                'id' => (string) $r['id'], 'groupe_id' => (string) $r['groupe_id'], 'cree_le' => Temps::iso((string) $r['cree_le']),
                'modifie_le' => Temps::iso($r['modifie_le'] === null ? null : (string) $r['modifie_le']),
                'modifie_par' => $r['m_prenom'] === null ? '' : Utilisateur::nomAffiche((string) $r['m_prenom'], (string) $r['m_nom'], $r['m_pseudo'] === null ? null : (string) $r['m_pseudo']),
                'par' => $r['prenom'] === null ? 'Utilisateur supprimé' : Utilisateur::nomAffiche((string) $r['prenom'], (string) $r['u_nom'], $r['pseudo'] === null ? null : (string) $r['pseudo']),
                'modifiable' => $etudiant && Membres::estMembre($pdo, (string) $r['groupe_id'], (int) $c->user->id),
                'par_couleur' => $r['u_couleur'] === null ? '' : (string) $r['u_couleur'],
            ];
            foreach ($def['champs'] as $k) {
                $o[$k] = $r[$k] === null ? '' : (string) $r[$k];
            }
            if ($type === 'reunion') {
                $o['version'] = (int) $r['version'];
            }
            if ($type === 'jalon') {
                $o['personnes'] = $assignes[(string) $r['id']] ?? [];
                $o['tache_id'] = $r['tache_id'] === null ? '' : (string) $r['tache_id'];
                $o['reunion_id'] = $r['reunion_id'] === null ? '' : (string) $r['reunion_id'];
            }
            if ($type === 'regle') {
                $o['ordre'] = (int) $r['ordre'];
            }
            $out[] = $o;
        }
        if ($type === 'reunion') {
            // Pièces jointes, tâches et liens de chaque compte rendu.
            $pieces = SuiviPieces::pourReunions($pdo, $gids);
            $details = SuiviTaches::pourReunions($pdo, $gids);
            foreach ($out as &$o) {
                $o['fichiers'] = $pieces[$o['id']] ?? [];
                $o['taches'] = $details['taches'][$o['id']] ?? [];
                $o['liens'] = $details['liens'][$o['id']] ?? [];
            }
            unset($o);
        }
        return $out;
    }

    /** Nombre d'états précédents gardés par compte rendu. */
    public const HISTORIQUE_MAX = 25;
    private const CHAMPS_REUNION = ['date', 'titre', 'participants', 'objectifs', 'vu', 'attendu', 'suite'];

    /**
     * Modifie un compte rendu. Si le client indique la version qu'il avait ouverte (`version_base`) et qu'une autre personne a enregistré depuis,
     * rien n'est écrit : l'erreur « conflict » renvoie l'état actuel, sauf si le client force (`forcer`). L'état écrasé est rangé dans l'historique.
     *
     * @param array<string,string> $d valeurs validées
     * @param array<mixed> $data requête brute
     */
    private static function modifierReunion(\PDO $pdo, string $id, array $d, array $data, int $uid, string $now): void
    {
        $pdo->beginTransaction();
        try {
            $st = $pdo->prepare('SELECT r.*, u.prenom, u.nom AS u_nom, u.pseudo FROM reunions r LEFT JOIN utilisateurs u ON u.id = COALESCE(r.modifie_par, r.cree_par) WHERE r.id = ? FOR UPDATE');
            $st->execute([$id]);
            $r = $st->fetch();
            if ($r === false) {
                throw new Erreur('not_found', 'Élément introuvable');
            }
            $base = isset($data['version_base']) && is_numeric($data['version_base']) ? (int) $data['version_base'] : null;
            $forcer = ($data['forcer'] ?? false) === true;
            if ($base !== null && $base !== (int) $r['version'] && !$forcer) {
                $actuel = ['version' => (int) $r['version']];
                foreach (self::CHAMPS_REUNION as $k) {
                    $actuel[$k] = $r[$k] === null ? '' : (string) $r[$k];
                }
                $quand = $r['modifie_le'] ?? $r['cree_le'];
                $actuel['par'] = $r['prenom'] === null ? '' : Utilisateur::nomAffiche((string) $r['prenom'], (string) $r['u_nom'], $r['pseudo'] === null ? null : (string) $r['pseudo']);
                $actuel['le'] = Temps::iso($quand === null ? null : (string) $quand);
                throw new Erreur('conflict', 'Ce compte rendu a été modifié par ' . ($actuel['par'] ?: 'quelqu’un') . ' depuis que vous l’avez ouvert', $actuel);
            }
            // L'état actuel est rangé dans l'historique s'il change vraiment (ne pas remplir l'historique d'enregistrements sans effet).
            $change = false;
            foreach (self::CHAMPS_REUNION as $k) {
                if ((string) ($r[$k] ?? '') !== (string) ($d[$k] ?? '')) {
                    $change = true;
                }
            }
            if ($change) {
                $pdo->prepare('INSERT INTO reunions_historique (reunion_id, version, date, titre, participants, objectifs, vu, attendu, suite, auteur_id, ecrit_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
                    ->execute([$id, (int) $r['version'], $r['date'], (string) $r['titre'], $r['participants'], $r['objectifs'], $r['vu'], $r['attendu'], $r['suite'],
                        $r['modifie_par'] ?? $r['cree_par'], $r['modifie_le'] ?? $r['cree_le']]);
                $pdo->prepare('DELETE FROM reunions_historique WHERE reunion_id = ? AND id NOT IN (SELECT id FROM (SELECT id FROM reunions_historique WHERE reunion_id = ? ORDER BY id DESC LIMIT ' . self::HISTORIQUE_MAX . ') x)')
                    ->execute([$id, $id]);
            }
            $sets = implode(', ', array_map(static fn (string $k): string => "`$k` = ?", self::CHAMPS_REUNION));
            $pdo->prepare("UPDATE reunions SET $sets, version = version + 1, modifie_le = ?, modifie_par = ? WHERE id = ?")
                ->execute([...array_map(static fn (string $k): mixed => self::valeurSql($k, $d[$k]), self::CHAMPS_REUNION), $now, $uid, $id]);
            $pdo->commit();
        } catch (\Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }
    }

    /**
     * Les états précédents d'un compte rendu (25 au plus, du plus récent au plus ancien), pour retrouver un texte écrasé.
     * Visible par les mêmes personnes que le compte rendu.
     *
     * @return list<array<string,mixed>>
     */
    public static function historiqueReunion(Contexte $c, mixed $id): array
    {
        $rid = is_string($id) ? $id : '';
        $pdo = $c->db->principale();
        $st = $pdo->prepare('SELECT groupe_id FROM reunions WHERE id = ?');
        $st->execute([$rid]);
        $g = $st->fetchColumn();
        if ($g === false || !in_array((string) $g, Donnees::idsGroupesVisibles($c), true)) {
            throw new Erreur('not_found', 'Compte rendu introuvable');
        }
        $st = $pdo->prepare('SELECT h.*, u.prenom, u.nom AS u_nom, u.pseudo FROM reunions_historique h LEFT JOIN utilisateurs u ON u.id = h.auteur_id
                             WHERE h.reunion_id = ? ORDER BY h.id DESC LIMIT ' . self::HISTORIQUE_MAX);
        $st->execute([$rid]);
        $out = [];
        foreach ($st->fetchAll() as $h) {
            $o = ['id' => (string) $h['id'], 'version' => (int) $h['version'], 'le' => Temps::iso((string) $h['ecrit_le']),
                'par' => $h['prenom'] === null ? '' : Utilisateur::nomAffiche((string) $h['prenom'], (string) $h['u_nom'], $h['pseudo'] === null ? null : (string) $h['pseudo'])];
            foreach (self::CHAMPS_REUNION as $k) {
                $o[$k] = $h[$k] === null ? '' : (string) $h[$k];
            }
            $out[] = $o;
        }
        return $out;
    }

    // ---------- Interne ----------

    /** @param array<string,string> $d */
    private static function valider(string $type, array &$d): void
    {
        if ($type === 'reunion') {
            if (!self::dateValide($d['date'])) {
                throw new Erreur('invalid', 'Date de réunion invalide');
            }
            if ($d['titre'] === '' && $d['objectifs'] === '' && $d['vu'] === '' && $d['attendu'] === '' && $d['suite'] === '') {
                throw new Erreur('invalid', 'Renseignez au moins un titre ou un compte rendu');
            }
            self::titre($d['titre']);
        } elseif ($type === 'regle') {
            if ($d['titre'] === '') {
                throw new Erreur('invalid', 'Donnez un titre à la règle');
            }
            self::titre($d['titre']);
        } elseif ($type === 'terme') {
            if ($d['mot'] === '') {
                throw new Erreur('invalid', 'Indiquez le mot ou l’expression');
            }
            if (mb_strlen($d['mot']) > 120) {
                throw new Erreur('invalid', 'Mot trop long (120 caractères maximum)');
            }
            if ($d['definition'] === '') {
                throw new Erreur('invalid', 'Indiquez la définition');
            }
            if (!in_array($d['type'], ['definition', 'citation'], true)) {
                throw new Erreur('invalid', 'Type d’entrée inconnu');
            }
            if ($d['type'] === 'citation' && $d['titre_source'] === '') {
                throw new Erreur('invalid', 'Pour une citation, indiquez le titre de l’œuvre citée');
            }
            if ($d['lien'] !== '' && preg_match('#^https?://[^\s<>"\']{3,290}$#i', $d['lien']) !== 1) {
                throw new Erreur('invalid', 'Le lien doit commencer par http:// ou https://');
            }
            if (mb_strlen($d['reference']) > Lectures::LONGUEUR_MAX) {
                throw new Erreur('invalid', 'Référence trop longue (' . Lectures::LONGUEUR_MAX . ' caractères maximum)');
            }
        } else {
            if ($d['titre'] === '') {
                throw new Erreur('invalid', 'Il faut un titre');
            }
            self::titre($d['titre']);
            if (!self::dateValide($d['echeance'])) {
                throw new Erreur('invalid', 'Échéance invalide');
            }
            if (!in_array($d['statut'], self::STATUTS_JALON, true)) {
                throw new Erreur('invalid', 'Statut invalide');
            }
            if (!in_array($d['type'], self::TYPES_JALON, true)) {
                throw new Erreur('invalid', 'Type invalide');
            }
            if ($d['heure'] !== '' && preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $d['heure']) !== 1) {
                throw new Erreur('invalid', 'Heure invalide (format HH:MM)');
            }
            if ($d['debut'] !== '') {
                if (!self::dateValide($d['debut'])) {
                    throw new Erreur('invalid', 'Date de début invalide');
                }
                if ($d['debut'] > $d['echeance']) {
                    throw new Erreur('invalid', 'La date de début doit précéder la date de fin');
                }
                if ($d['debut'] === $d['echeance']) {
                    $d['debut'] = '';   // une plage d'un jour est une date fixe
                }
            }
            if ($d['visio'] !== '' && preg_match('#^https://[^\s<>"\']{3,290}$#i', $d['visio']) !== 1) {
                throw new Erreur('invalid', 'Le lien de visio doit commencer par https://');
            }
            if ($d['alerte_jours'] !== '' && (preg_match('/^\d{1,3}$/', $d['alerte_jours']) !== 1 || (int) $d['alerte_jours'] > 365)) {
                throw new Erreur('invalid', 'Alerte : nombre de jours entre 0 et 365');
            }
        }
    }

    /** Monte (sens -1) ou descend (sens 1) une règle de la charte : elle échange sa place avec sa voisine. */
    public static function deplacerRegle(Contexte $c, mixed $id, mixed $sens): void
    {
        Lectures::exigerEtudiant($c);
        $pdo = $c->db->principale();
        $st = $pdo->prepare('SELECT id, groupe_id, ordre FROM regles WHERE id = ?');
        $st->execute([is_string($id) ? $id : '']);
        $r = $st->fetch();
        if ($r === false) {
            throw new Erreur('not_found', 'Règle introuvable');
        }
        if (!Membres::estMembre($pdo, (string) $r['groupe_id'], (int) $c->user->id)) {
            throw new Erreur('forbidden', 'Vous ne faites pas partie de ce groupe');
        }
        if ($sens !== 1 && $sens !== -1) {
            throw new Erreur('invalid', 'Sens de déplacement invalide');
        }
        // Ordre actuel, renuméroté 1..n (les ordres égaux ou manquants sont ainsi remis d'aplomb), puis échange avec la voisine.
        $st = $pdo->prepare('SELECT id FROM regles WHERE groupe_id = ? ORDER BY ordre, cree_le, id');
        $st->execute([$r['groupe_id']]);
        $ids = array_map('strval', $st->fetchAll(\PDO::FETCH_COLUMN));
        $i = array_search((string) $r['id'], $ids, true);
        $j = $i + $sens;
        if ($i === false || $j < 0 || $j >= count($ids)) {
            return;   // déjà en tête ou en fin de charte
        }
        [$ids[$i], $ids[$j]] = [$ids[$j], $ids[$i]];
        $maj = $pdo->prepare('UPDATE regles SET ordre = ? WHERE id = ?');
        foreach ($ids as $k => $rid) {
            $maj->execute([$k + 1, $rid]);
        }
    }

    /** Un jalon issu d'une tâche de compte rendu ne se modifie ni ne se supprime depuis le calendrier. */
    private static function estDeTache(\PDO $pdo, string $jalonId): bool
    {
        $st = $pdo->prepare('SELECT tache_id FROM jalons WHERE id = ?');
        $st->execute([$jalonId]);
        $t = $st->fetchColumn();
        return $t !== false && $t !== null;
    }

    private static function titre(string $t): void
    {
        if (mb_strlen($t) > self::TITRE_MAX) {
            throw new Erreur('invalid', 'Titre trop long (' . self::TITRE_MAX . ' caractères maximum)');
        }
    }

    private static function dateValide(string $v): bool
    {
        return preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $v, $m) === 1 && checkdate((int) $m[2], (int) $m[3], (int) $m[1]);
    }

    private static function valeurSql(string $champ, string $v): mixed
    {
        if (in_array($champ, self::DATES, true) || $champ === 'heure') {
            return $v === '' ? null : $v;
        }
        if ($champ === 'alerte_jours') {
            return $v === '' ? null : (int) $v;
        }
        return $v;
    }
}
