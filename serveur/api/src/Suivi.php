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
        'reunion' => ['table' => 'reunions', 'champs' => ['date', 'titre', 'participants', 'vu', 'attendu', 'suite']],
        'jalon' => ['table' => 'jalons', 'champs' => ['titre', 'type', 'echeance', 'heure', 'statut', 'note', 'visio', 'debut', 'alerte_jours']],
        'terme' => ['table' => 'glossaire', 'champs' => ['mot', 'definition', 'reference']],
    ];
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
        $st = $pdo->prepare("SELECT t.*, u.prenom, u.nom AS u_nom, u.pseudo, u.couleur AS u_couleur, m.prenom AS m_prenom, m.nom AS m_nom, m.pseudo AS m_pseudo
                             FROM `$table` t LEFT JOIN utilisateurs u ON u.id = t.cree_par LEFT JOIN utilisateurs m ON m.id = t.modifie_par
                             WHERE t.groupe_id IN (" . Lectures::marques(count($gids)) . ') ORDER BY t.cree_le, t.id');
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
            if ($type === 'jalon') {
                $o['personnes'] = $assignes[(string) $r['id']] ?? [];
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
            if ($d['titre'] === '' && $d['vu'] === '' && $d['attendu'] === '' && $d['suite'] === '') {
                throw new Erreur('invalid', 'Renseignez au moins un titre ou un compte rendu');
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
            if (mb_strlen($d['reference']) > 500) {
                throw new Erreur('invalid', 'Référence trop longue (500 caractères maximum)');
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
