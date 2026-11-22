<?php
declare(strict_types=1);

namespace Lpc;

/**
 * Sections de données renvoyées avec « init », « list » et la plupart des actions (mêmes noms et mêmes formes que l'ancien donnees_).
 * Toutes les sections de l'ancien donnees_ : utilisateurs, enLigne, groupes, votes, propositions, promosMoi, rattachements, fichiers,
 * reunions, jalons, termes, lectures, commentaires, lus, enAttente (+ groupesAdmin et structure pour les administrateurs).
 */
final class Donnees
{
    public const PRESENCE_S = 150;   // « en ligne » = a fait une requête depuis moins de 2 min 30

    /** @return array<string,mixed> */
    public static function toutes(Contexte $c): array
    {
        $out = [];
        foreach (self::sections($c) as $nom => $calcul) {
            $out[$nom] = $calcul();
        }
        return $out;
    }

    /**
     * Seulement les sections demandées (celles qu'une action vient de modifier), marquées « partiel » comme l'ancien serveur.
     * Un nom inconnu (section d'un lot pas encore migré) est ignoré.
     *
     * @param list<string> $noms
     * @return array<string,mixed>
     */
    public static function choisies(Contexte $c, array $noms): array
    {
        $out = [];
        foreach (self::sections($c) as $nom => $calcul) {
            if (in_array($nom, $noms, true)) {
                $out[$nom] = $calcul();
            }
        }
        $out['partiel'] = true;
        return $out;
    }

    /** @return array<string,callable():mixed> les sections, dans l'ordre de l'ancien serveur */
    private static function sections(Contexte $c): array
    {
        return [
            'utilisateurs' => static fn (): array => self::utilisateurs($c),
            'enLigne' => static fn (): array => self::enLigne($c),
            'groupes' => static fn (): array => self::groupes($c),
            'votes' => static fn (): array => Votes::pourClient($c),
            'propositions' => static fn (): array => Lectures::propositionsPourClient($c),
            'promosMoi' => static fn (): array => Votes::promosMoi($c),
            'rattachements' => static fn (): array => Votes::rattachements($c),
            'fichiers' => static fn (): array => Fichiers::pourClient($c),
            'reunions' => static fn (): array => Suivi::pourClient($c, 'reunion'),
            'jalons' => static fn (): array => Suivi::pourClient($c, 'jalon'),
            'termes' => static fn (): array => Suivi::pourClient($c, 'terme'),
            'lectures' => static fn (): array => Lectures::lister($c),
            'commentaires' => static fn (): array => Commentaires::lister($c),
            'lus' => static fn (): array => Commentaires::lus($c),
            'suggestions' => static fn (): array => Suggestions::pourClient($c),
            'enAttente' => static fn (): int => self::enAttente($c),
        ];
    }

    /** Listes d'administration, pour qui administre quelque chose (dans son périmètre). @return array<string,mixed> */
    public static function admin(Contexte $c): array
    {
        if (!$c->droits()->estAdminQuelconque()) {
            return [];
        }
        return ['groupesAdmin' => self::groupesAdmin($c), 'structure' => self::structure($c)];
    }

    /** Étudiants actifs des groupes de la personne (l'admin voit tous les étudiants). @return list<array<string,mixed>> */
    public static function utilisateurs(Contexte $c): array
    {
        $u = $c->user;
        if ($u->id === null) {
            return [];
        }
        $pdo = $c->db->principale();
        $sql = "SELECT DISTINCT u.prenom, u.nom, u.pseudo, u.couleur FROM utilisateurs u
                JOIN attributions a ON a.utilisateur_id = u.id AND a.role = 'etudiant'
                WHERE u.statut = 'actif'";
        $params = [];
        if (!$c->droits()->estAdmin()) {
            $sql .= ' AND u.id IN (' . self::SQL_COEQUIPIERS . ')';
            $params[] = $u->id;
        }
        $st = $pdo->prepare($sql);
        $st->execute($params);
        $out = [];
        foreach ($st->fetchAll() as $r) {
            $out[] = ['prenom' => self::affichage($r), 'role' => 'etudiant', 'couleur' => (string) $r['couleur']];
        }
        usort($out, static fn (array $a, array $b): int => strcmp(mb_strtolower($a['prenom']), mb_strtolower($b['prenom'])));
        return $out;
    }

    /** Personnes en ligne parmi celles que la personne peut voir. @return list<array<string,mixed>> */
    public static function enLigne(Contexte $c): array
    {
        $u = $c->user;
        if ($u->id === null) {
            return [];
        }
        try {
            $st = $c->db->chat()->prepare('SELECT utilisateur_id FROM presence WHERE vu_le >= ?');
            $st->execute([Temps::depuis(-self::PRESENCE_S)]);
            $ids = array_map('intval', $st->fetchAll(\PDO::FETCH_COLUMN));
        } catch (\Throwable $e) {
            error_log('Présence illisible : ' . $e->getMessage());
            return [];
        }
        if ($ids === []) {
            return [];
        }
        $marques = implode(',', array_fill(0, count($ids), '?'));
        $sql = "SELECT u.id, u.prenom, u.nom, u.pseudo, u.couleur,
                       EXISTS (SELECT 1 FROM attributions a WHERE a.utilisateur_id = u.id AND a.role = 'etudiant') AS etu
                FROM utilisateurs u WHERE u.statut = 'actif' AND u.id IN ($marques)";
        $params = $ids;
        if (!$c->droits()->estAdmin()) {
            $sql .= ' AND u.id IN (' . self::SQL_COEQUIPIERS . ')';
            $params[] = $u->id;
        }
        $st = $c->db->principale()->prepare($sql);
        $st->execute($params);
        $out = [];
        foreach ($st->fetchAll() as $r) {
            $out[] = ['prenom' => self::affichage($r), 'couleur' => (string) $r['couleur'],
                'role' => (int) $r['etu'] === 1 ? 'etudiant' : 'formateur', 'moi' => (int) $r['id'] === $u->id];
        }
        return $out;
    }

    /**
     * Groupes visibles : ceux dont la personne est membre, et ceux des promos qu'elle administre (l'admin les voit tous).
     *
     * @return list<array<string,mixed>>
     */
    public static function groupes(Contexte $c): array
    {
        $u = $c->user;
        if ($u->id === null) {
            return [];
        }
        $lignes = self::lignesGroupes($c, true);
        if ($lignes === []) {
            return [];
        }
        $membres = self::membres($c, array_keys($lignes));
        $regles = ChatRegles::toutes($c->db->principale());
        $out = [];
        foreach ($lignes as $id => $g) {
            $liste = [];
            foreach ($membres[$id] ?? [] as $m) {
                $liste[] = ['pid' => (string) $m['pid'], 'prenom' => self::affichage($m), 'couleur' => (string) $m['couleur'],
                    'role' => (int) $m['etu'] === 1 ? 'etudiant' : 'formateur', 'moi' => (int) $m['uid'] === $u->id];
            }
            usort($liste, static fn (array $a, array $b): int =>
                (($a['role'] === 'etudiant' ? 0 : 1) <=> ($b['role'] === 'etudiant' ? 0 : 1))
                ?: strcmp(mb_strtolower($a['prenom']), mb_strtolower($b['prenom'])));
            $out[] = ['id' => $id, 'nom' => (string) $g['nom'], 'etablissement' => (string) $g['etablissement'],
                'promo' => (string) $g['promo'], 'promo_id' => (string) $g['promo_id'], 'membres' => $liste,
                'chat' => ChatRegles::groupeActif($regles, (string) $id, (string) $g['promo_id']), 'chat_promo' => ChatRegles::promoActif($regles, (string) $g['promo_id'])];
        }
        usort($out, static fn (array $a, array $b): int =>
            strcmp(mb_strtolower($a['etablissement'] . $a['promo'] . $a['nom']), mb_strtolower($b['etablissement'] . $b['promo'] . $b['nom'])));
        return $out;
    }

    /** Demandes d'accès à traiter, dans le périmètre de la personne (0 si elle n'administre rien). */
    public static function enAttente(Contexte $c): int
    {
        $d = $c->droits();
        if ($c->user->id === null || !$d->estAdminQuelconque()) {
            return 0;
        }
        $pdo = $c->db->principale();
        if ($d->estAdmin()) {
            return (int) $pdo->query("SELECT COUNT(*) FROM utilisateurs WHERE statut = 'en_attente'")->fetchColumn();
        }
        $promos = $d->promosAdministrees() ?? [];
        if ($promos === []) {
            return 0;
        }
        $marques = implode(',', array_fill(0, count($promos), '?'));
        $st = $pdo->prepare("SELECT COUNT(DISTINCT utilisateur_id) FROM demandes_acces WHERE statut = 'en_attente' AND promo_id IN ($marques)");
        $st->execute($promos);
        return (int) $st->fetchColumn();
    }

    /** Groupes que la personne administre, avec les adresses de leurs membres. @return list<array<string,mixed>> */
    public static function groupesAdmin(Contexte $c): array
    {
        $lignes = self::lignesGroupes($c, false);
        if ($lignes === []) {
            return [];
        }
        $membres = self::membres($c, array_keys($lignes));
        $out = [];
        foreach ($lignes as $id => $g) {
            $liste = [];
            foreach ($membres[$id] ?? [] as $m) {
                $liste[] = ['email' => (string) $m['email'], 'prenom' => self::affichage($m),
                    'role' => (int) $m['etu'] === 1 ? 'etudiant' : 'formateur'];
            }
            $out[] = ['id' => $id, 'etablissement' => (string) $g['etablissement'], 'promo' => (string) $g['promo'],
                'nom' => (string) $g['nom'], 'cree_le' => Temps::iso((string) $g['cree_le']), 'membres' => $liste];
        }
        return $out;
    }

    /**
     * Établissements et promos que la personne administre. Les champs « code_* » gardent la forme de l'ancien code d'invitation
     * de promo, et décrivent la dernière invitation de promo valable (« code » reste vide : seul le hachage est conservé).
     *
     * @return list<array<string,mixed>>
     */
    public static function structure(Contexte $c): array
    {
        $d = $c->droits();
        $pdo = $c->db->principale();
        $promosOk = $d->promosAdministrees();
        $etabsOk = $d->etablissementsVisibles();
        // Invitation de promo la plus récente encore valable, par promo (le jeton lui-même n'est jamais relisible).
        $codes = [];
        $st = $pdo->prepare("SELECT promo_id, expire_le, max_usages, usages FROM invitations
                             WHERE type = 'promo' AND revoque_le IS NULL AND expire_le > ? ORDER BY id DESC");
        $st->execute([Temps::maintenant()]);
        foreach ($st->fetchAll() as $r) {
            $codes[(string) $r['promo_id']] ??= $r;
        }
        $out = [];
        foreach ($pdo->query('SELECT id, nom FROM etablissements ORDER BY nom')->fetchAll() as $e) {
            if ($etabsOk !== null && !in_array((string) $e['id'], $etabsOk, true)) {
                continue;
            }
            $st = $pdo->prepare('SELECT id, nom FROM promos WHERE etablissement_id = ? ORDER BY nom');
            $st->execute([$e['id']]);
            $promos = [];
            foreach ($st->fetchAll() as $p) {
                if ($promosOk !== null && !in_array((string) $p['id'], $promosOk, true)) {
                    continue;
                }
                $code = $codes[(string) $p['id']] ?? null;
                $promos[] = ['id' => (string) $p['id'], 'nom' => (string) $p['nom'], 'code' => '',
                    'code_expire' => $code === null ? '' : Temps::iso((string) $code['expire_le']),
                    'code_max' => $code === null ? 0 : (int) $code['max_usages'],
                    'code_usages' => $code === null ? 0 : (int) $code['usages'],
                    'code_actif' => $code !== null];
            }
            $out[] = ['id' => (string) $e['id'], 'nom' => (string) $e['nom'], 'promos' => $promos];
        }
        return $out;
    }

    // ---------- Interne ----------

    /** Identifiants des personnes qui partagent au moins un groupe avec la personne (elle-même comprise). */
    private const SQL_COEQUIPIERS = 'SELECT m2.utilisateur_id FROM membres m1 JOIN membres m2 ON m2.groupe_id = m1.groupe_id WHERE m1.utilisateur_id = ?';

    /** @param array<string,mixed> $r une ligne avec prenom, nom, pseudo */
    private static function affichage(array $r): string
    {
        return Utilisateur::nomAffiche((string) $r['prenom'], (string) $r['nom'], $r['pseudo'] === null ? null : (string) $r['pseudo']);
    }

    /** Identifiants des groupes que la personne voit (les siens et ceux qu'elle administre). @return list<string> */
    public static function idsGroupesVisibles(Contexte $c): array
    {
        return $c->user->id === null ? [] : array_map('strval', array_keys(self::lignesGroupes($c, true)));
    }

    /**
     * @param bool $aussiMiens true : groupes dont la personne est membre en plus de ceux qu'elle administre ;
     *                         false : seulement ceux qu'elle administre
     * @return array<string,array<string,mixed>> groupes indexés par identifiant
     */
    private static function lignesGroupes(Contexte $c, bool $aussiMiens): array
    {
        $d = $c->droits();
        $sql = 'SELECT g.id, g.nom, g.cree_le, g.promo_id, e.nom AS etablissement, p.nom AS promo
                FROM groupes g JOIN promos p ON p.id = g.promo_id JOIN etablissements e ON e.id = p.etablissement_id';
        $conditions = [];
        $params = [];
        $promos = $d->promosAdministrees();
        if ($promos === null) {
            // admin : tous les groupes
        } else {
            if ($promos !== []) {
                $conditions[] = 'g.promo_id IN (' . implode(',', array_fill(0, count($promos), '?')) . ')';
                array_push($params, ...$promos);
            }
            if ($aussiMiens) {
                $conditions[] = 'g.id IN (SELECT groupe_id FROM membres WHERE utilisateur_id = ?)';
                $params[] = $c->user->id;
            }
            if ($conditions === []) {
                return [];
            }
            $sql .= ' WHERE ' . implode(' OR ', $conditions);
        }
        $st = $c->db->principale()->prepare($sql);
        $st->execute($params);
        $out = [];
        foreach ($st->fetchAll() as $r) {
            $out[(string) $r['id']] = $r;
        }
        return $out;
    }

    /**
     * @param list<string> $groupeIds
     * @return array<string,list<array<string,mixed>>> membres actifs, par groupe
     */
    private static function membres(Contexte $c, array $groupeIds): array
    {
        $marques = implode(',', array_fill(0, count($groupeIds), '?'));
        $st = $c->db->principale()->prepare(
            "SELECT m.groupe_id, u.id AS uid, u.pid, u.email, u.prenom, u.nom, u.pseudo, u.couleur,
                    EXISTS (SELECT 1 FROM attributions a WHERE a.utilisateur_id = u.id AND a.role = 'etudiant' AND a.promo_id = g.promo_id) AS etu
             FROM membres m JOIN utilisateurs u ON u.id = m.utilisateur_id JOIN groupes g ON g.id = m.groupe_id
             WHERE u.statut = 'actif' AND m.groupe_id IN ($marques)"
        );
        $st->execute($groupeIds);
        $out = [];
        foreach ($st->fetchAll() as $r) {
            $out[(string) $r['groupe_id']][] = $r;
        }
        return $out;
    }
}
