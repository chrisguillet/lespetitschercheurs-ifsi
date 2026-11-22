<?php
declare(strict_types=1);

namespace Lpc;

/**
 * Suggestions de lecture : un formateur (ou un administrateur) propose un article à une promo, sans fiche de lecture.
 * Visibles de toute la promo ; les groupes « tagués » ne servent qu'à alerter leurs membres (le tag n'est montré qu'à l'auteur et aux administrateurs).
 * Une personne « voit » une suggestion quand elle l'a ouverte : l'alerte et la marque « Nouveau » disparaissent alors.
 */
final class Suggestions
{
    public const CHAMPS = ['titre' => 500, 'auteur' => 500, 'parution' => 20, 'type' => 80, 'source' => 500, 'doi' => 190, 'lien' => 500];
    public const NOTE_MAX = 1500;
    public const MAX_PAR_PROMO = 500;

    /** @return list<string> promos où la personne peut proposer une lecture (formateur de l'établissement, ou administrateur du périmètre) */
    public static function promosOuProposer(Contexte $c): array
    {
        $d = $c->droits();
        $out = [];
        foreach (self::promosVisibles($c) as $p) {
            $etab = $d->etablissementDePromo($p);
            if ($d->peutAdministrerPromo($p) || ($etab !== null && $d->estFormateurSur($etab))) {
                $out[] = $p;
            }
        }
        return $out;
    }

    /** @return list<string> promos dont la personne voit les suggestions : sa promo d'étudiante, l'établissement où elle est formatrice, son périmètre d'administration */
    public static function promosVisibles(Contexte $c): array
    {
        if ($c->user->id === null || $c->user->accueil) {
            return [];
        }
        $d = $c->droits();
        $pdo = $c->db->principale();
        $ids = $d->promosEtudiant();
        $admin = $d->promosAdministrees();   // null : administrateur général (toutes)
        if ($admin === null) {
            return array_map('strval', $pdo->query('SELECT id FROM promos')->fetchAll(\PDO::FETCH_COLUMN));
        }
        $ids = array_merge($ids, $admin);
        $etabs = $d->etablissementsFormateur();
        if ($etabs !== []) {
            $st = $pdo->prepare('SELECT id FROM promos WHERE etablissement_id IN (' . Lectures::marques(count($etabs)) . ')');
            $st->execute($etabs);
            $ids = array_merge($ids, array_map('strval', $st->fetchAll(\PDO::FETCH_COLUMN)));
        }
        return array_values(array_unique(array_map('strval', $ids)));
    }

    /**
     * Section « suggestions » des données : la liste, les promos où l'on peut proposer, et les groupes qu'on peut tagguer.
     *
     * @return array<string,mixed>
     */
    public static function pourClient(Contexte $c): array
    {
        $vide = ['liste' => [], 'peut' => [], 'groupes' => [], 'alertes' => 0];
        $promos = self::promosVisibles($c);
        if ($promos === []) {
            return $vide;
        }
        $pdo = $c->db->principale();
        $uid = (int) $c->user->id;
        $d = $c->droits();
        $st = $pdo->prepare(
            'SELECT s.*, u.prenom, u.nom AS u_nom, u.pseudo, p.nom AS promo_nom, e.nom AS etab
             FROM suggestions s JOIN promos p ON p.id = s.promo_id JOIN etablissements e ON e.id = p.etablissement_id
             LEFT JOIN utilisateurs u ON u.id = s.propose_par
             WHERE s.promo_id IN (' . Lectures::marques(count($promos)) . ') ORDER BY s.cree_le DESC, s.id DESC LIMIT 300'
        );
        $st->execute($promos);
        $lignes = $st->fetchAll();
        $ids = array_map(static fn (array $r): string => (string) $r['id'], $lignes);

        $vues = [];
        $tags = [];
        $mesGroupes = [];
        if ($ids !== []) {
            $m = Lectures::marques(count($ids));
            $s = $pdo->prepare("SELECT suggestion_id FROM suggestions_vues WHERE utilisateur_id = ? AND suggestion_id IN ($m)");
            $s->execute([$uid, ...$ids]);
            $vues = array_flip(array_map('strval', $s->fetchAll(\PDO::FETCH_COLUMN)));
            $s = $pdo->prepare("SELECT suggestion_id, groupe_id FROM suggestions_groupes WHERE suggestion_id IN ($m)");
            $s->execute($ids);
            foreach ($s->fetchAll() as $r) {
                $tags[(string) $r['suggestion_id']][] = (string) $r['groupe_id'];
            }
            $s = $pdo->prepare('SELECT groupe_id FROM membres WHERE utilisateur_id = ?');
            $s->execute([$uid]);
            $mesGroupes = array_flip(array_map('strval', $s->fetchAll(\PDO::FETCH_COLUMN)));
        }

        $liste = [];
        $alertes = 0;
        foreach ($lignes as $r) {
            $id = (string) $r['id'];
            $modifiable = ($r['propose_par'] !== null && (int) $r['propose_par'] === $uid) || $d->peutAdministrerPromo((string) $r['promo_id']);
            $nouveau = !isset($vues[$id]);
            $alerte = false;
            foreach ($tags[$id] ?? [] as $g) {
                $alerte = $alerte || isset($mesGroupes[$g]);
            }
            $alerte = $alerte && $nouveau;
            $alertes += $alerte ? 1 : 0;
            $liste[] = [
                'id' => $id, 'promo_id' => (string) $r['promo_id'], 'promo' => $r['etab'] . ' · ' . $r['promo_nom'],
                'titre' => (string) $r['titre'], 'auteur' => (string) $r['auteur'], 'parution' => (string) $r['parution'], 'type' => (string) $r['type'],
                'source' => (string) $r['source'], 'doi' => (string) $r['doi'], 'lien' => (string) $r['lien'], 'note' => (string) ($r['note'] ?? ''),
                'cree_le' => Temps::iso((string) $r['cree_le']),
                'par' => $r['prenom'] === null ? 'Utilisateur supprimé' : Membres::affiche(['prenom' => $r['prenom'], 'nom' => $r['u_nom'], 'pseudo' => $r['pseudo']]),
                'modifiable' => $modifiable, 'nouveau' => $nouveau, 'alerte' => $alerte,
                'groupes' => $modifiable ? ($tags[$id] ?? []) : [],   // le tag n'est jamais montré aux autres
            ];
        }

        $peut = self::promosOuProposer($c);
        $groupes = [];
        if ($peut !== []) {
            $s = $pdo->prepare('SELECT id, nom, promo_id FROM groupes WHERE promo_id IN (' . Lectures::marques(count($peut)) . ') ORDER BY nom');
            $s->execute($peut);
            foreach ($s->fetchAll() as $g) {
                $groupes[] = ['id' => (string) $g['id'], 'nom' => (string) $g['nom'], 'promo_id' => (string) $g['promo_id']];
            }
        }
        return ['liste' => $liste, 'peut' => $peut, 'groupes' => $groupes, 'alertes' => $alertes];
    }

    /** Crée (sans id) ou modifie (avec id) une suggestion. */
    public static function enregistrer(Contexte $c, mixed $id, mixed $data): void
    {
        if (!is_array($data)) {
            throw new Erreur('invalid', 'Données manquantes');
        }
        $pdo = $c->db->principale();
        $uid = (int) $c->user->id;
        $identifiant = is_string($id) ? $id : '';
        $d = [];
        foreach (self::CHAMPS as $k => $max) {
            $v = is_scalar($data[$k] ?? null) ? trim((string) preg_replace('/\s+/u', ' ', (string) $data[$k])) : '';
            if (mb_strlen($v) > $max) {
                throw new Erreur('invalid', "Champ « $k » trop long ($max caractères maximum)");
            }
            $d[$k] = $v;
        }
        if ($d['titre'] === '') {
            throw new Erreur('invalid', 'Indiquez le titre de l’article');
        }
        if ($d['lien'] !== '' && preg_match('#^https?://#i', $d['lien']) !== 1) {
            throw new Erreur('invalid', 'Le lien doit commencer par http:// ou https://');
        }
        $note = is_scalar($data['note'] ?? null) ? trim((string) $data['note']) : '';
        if (mb_strlen($note) > self::NOTE_MAX) {
            throw new Erreur('invalid', 'Commentaire trop long (' . self::NOTE_MAX . ' caractères maximum)');
        }
        $now = Temps::maintenant();

        // Tout est contrôlé avant la première écriture : une erreur ne laisse jamais une suggestion à moitié créée.
        $creation = $identifiant === '';
        if ($creation) {
            $promo = is_string($data['promo_id'] ?? null) ? $data['promo_id'] : '';
            if (!in_array($promo, self::promosOuProposer($c), true)) {
                throw new Erreur('forbidden', 'Seuls les formateurs et les administrateurs de la promo peuvent proposer une lecture');
            }
            $st = $pdo->prepare('SELECT COUNT(*) FROM suggestions WHERE promo_id = ?');
            $st->execute([$promo]);
            if ((int) $st->fetchColumn() >= self::MAX_PAR_PROMO) {
                throw new Erreur('limit', 'Trop de suggestions dans cette promo : supprimez-en d’anciennes');
            }
        } else {
            $s = self::trouver($pdo, $identifiant);
            self::exigerModifiable($c, $s);
            $promo = (string) $s['promo_id'];
        }
        // Groupes tagués : de cette promo seulement.
        $tags = is_array($data['groupes'] ?? null) ? array_values(array_unique(array_filter($data['groupes'], 'is_string'))) : [];
        if ($tags !== []) {
            $st = $pdo->prepare('SELECT id FROM groupes WHERE promo_id = ? AND id IN (' . Lectures::marques(count($tags)) . ')');
            $st->execute([$promo, ...$tags]);
            if (count($st->fetchAll(\PDO::FETCH_COLUMN)) !== count($tags)) {
                throw new Erreur('invalid', 'Un des groupes ne fait pas partie de cette promo');
            }
        }

        $pdo->beginTransaction();
        try {
            if ($creation) {
                $identifiant = Ids::uuid();
                $pdo->prepare('INSERT INTO suggestions (id, promo_id, propose_par, titre, auteur, parution, type, source, doi, lien, note, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
                    ->execute([$identifiant, $promo, $uid, $d['titre'], $d['auteur'], $d['parution'], $d['type'], $d['source'], $d['doi'], $d['lien'], $note, $now]);
            } else {
                $pdo->prepare('UPDATE suggestions SET titre = ?, auteur = ?, parution = ?, type = ?, source = ?, doi = ?, lien = ?, note = ?, modifie_le = ? WHERE id = ?')
                    ->execute([$d['titre'], $d['auteur'], $d['parution'], $d['type'], $d['source'], $d['doi'], $d['lien'], $note, $now, $identifiant]);
            }
            // Les groupes ajoutés alertent leurs membres ; ceux qu'on retire ne les alertent plus.
            $pdo->prepare('DELETE FROM suggestions_groupes WHERE suggestion_id = ?')->execute([$identifiant]);
            foreach ($tags as $g) {
                $pdo->prepare('INSERT INTO suggestions_groupes (suggestion_id, groupe_id) VALUES (?, ?)')->execute([$identifiant, $g]);
            }
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
    }

    public static function supprimer(Contexte $c, mixed $id): void
    {
        $s = self::trouver($c->db->principale(), is_string($id) ? $id : '');
        self::exigerModifiable($c, $s);
        $c->db->principale()->prepare('DELETE FROM suggestions WHERE id = ?')->execute([$s['id']]);
    }

    /** La personne a ouvert ces suggestions : l'alerte et la marque « Nouveau » s'effacent pour elle. @param mixed $ids */
    public static function marquerVues(Contexte $c, mixed $ids): void
    {
        if (!is_array($ids) || $ids === [] || $c->user->id === null || $c->user->accueil) {
            return;
        }
        $pdo = $c->db->principale();
        $ids = array_slice(array_values(array_unique(array_filter($ids, 'is_string'))), 0, 300);
        if ($ids === []) {
            return;
        }
        $visibles = self::promosVisibles($c);
        if ($visibles === []) {
            return;
        }
        $st = $pdo->prepare('SELECT id FROM suggestions WHERE promo_id IN (' . Lectures::marques(count($visibles)) . ') AND id IN (' . Lectures::marques(count($ids)) . ')');
        $st->execute([...$visibles, ...$ids]);
        $now = Temps::maintenant();
        foreach ($st->fetchAll(\PDO::FETCH_COLUMN) as $id) {
            $deja = $pdo->prepare('SELECT 1 FROM suggestions_vues WHERE suggestion_id = ? AND utilisateur_id = ?');
            $deja->execute([(string) $id, $c->user->id]);
            if ($deja->fetchColumn() === false) {
                $pdo->prepare('INSERT INTO suggestions_vues (suggestion_id, utilisateur_id, vue_le) VALUES (?, ?, ?)')->execute([(string) $id, $c->user->id, $now]);
            }
        }
    }

    /** @return array<string,mixed> */
    private static function trouver(\PDO $pdo, string $id): array
    {
        $st = $pdo->prepare('SELECT * FROM suggestions WHERE id = ?');
        $st->execute([$id]);
        $r = $st->fetch();
        if ($r === false) {
            throw new Erreur('not_found', 'Suggestion introuvable');
        }
        return $r;
    }

    /** @param array<string,mixed> $s */
    private static function exigerModifiable(Contexte $c, array $s): void
    {
        $auteur = $s['propose_par'] !== null && (int) $s['propose_par'] === $c->user->id;
        if (!$auteur && !$c->droits()->peutAdministrerPromo((string) $s['promo_id'])) {
            throw new Erreur('forbidden', 'Seul l’auteur de la suggestion ou un administrateur de la promo peut la modifier');
        }
    }
}
