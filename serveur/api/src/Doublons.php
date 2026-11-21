<?php
declare(strict_types=1);

namespace Lpc;

/**
 * Doublons d'articles : même article saisi plusieurs fois (même DOI, ou même titre sans DOI différents, voir Lectures::memeArticle).
 *
 * La fusion garde un article « principal » et lui rattache tout ce qui dépend des autres : fiches de lecture (avec leurs commentaires),
 * propositions de correction, historique, pièce jointe. Les champs vides du principal sont complétés par ceux des doublons, puis les doublons
 * sont supprimés. Elle est refusée si une même personne a une fiche sur deux de ces articles (rien n'est perdu : il faut d'abord la résoudre).
 * Réservé aux administrateurs ; un administrateur de site ou de promo ne traite que les groupes d'articles dont tous les articles sont dans son périmètre.
 */
final class Doublons
{
    /** @return list<array<string,mixed>> groupes d'articles probablement identiques, que la personne peut fusionner */
    public static function grappes(Contexte $c): array
    {
        if (!$c->droits()->estAdminQuelconque()) {
            throw new Erreur('forbidden', 'Réservé à un administrateur');
        }
        $pdo = $c->db->principale();
        $lignes = $pdo->query(
            'SELECT r.*, g.nom AS g_nom, g.promo_id, p.nom AS p_nom, e.nom AS e_nom
             FROM articles r LEFT JOIN groupes g ON g.id = r.groupe_id LEFT JOIN promos p ON p.id = g.promo_id LEFT JOIN etablissements e ON e.id = p.etablissement_id
             ORDER BY r.ajoute, r.id'
        )->fetchAll();
        $par = [];
        $compartiments = [];
        foreach ($lignes as $r) {
            $id = (string) $r['id'];
            $par[$id] = $r;
            $doi = Lectures::cleDoi((string) ($r['doi'] ?? ''));
            if ($doi !== '') {
                $compartiments['d:' . $doi][] = $id;
            }
            $titre = Lectures::normaliser((string) ($r['titre'] ?? ''));
            if (strlen($titre) >= 8) {
                $compartiments['t:' . $titre][] = $id;
            }
        }
        // Regroupement : deux articles d'un même compartiment qui « sont le même » se retrouvent dans la même grappe.
        $parent = array_combine(array_keys($par), array_keys($par));
        $racine = static function (string $x) use (&$parent): string {
            while ($parent[$x] !== $x) {
                $parent[$x] = $parent[$parent[$x]];
                $x = $parent[$x];
            }
            return $x;
        };
        foreach ($compartiments as $ids) {
            for ($i = 0, $n = count($ids); $i < $n; $i++) {
                for ($j = $i + 1; $j < $n; $j++) {
                    if (Lectures::memeArticle(self::champs($par[$ids[$i]]), self::champs($par[$ids[$j]]))) {
                        $parent[$racine($ids[$j])] = $racine($ids[$i]);
                    }
                }
            }
        }
        $grappes = [];
        foreach (array_keys($par) as $id) {
            $grappes[$racine($id)][] = $id;
        }
        $grappes = array_filter($grappes, static fn (array $g): bool => count($g) > 1);
        if ($grappes === []) {
            return [];
        }

        $ignores = array_map('strval', $pdo->query('SELECT cle FROM doublons_ignores')->fetchAll(\PDO::FETCH_COLUMN));
        $nbFiches = self::compte($pdo, 'SELECT article_id, COUNT(*) FROM analyses GROUP BY article_id');
        $nbProps = self::compte($pdo, 'SELECT article_id, COUNT(*) FROM propositions GROUP BY article_id');
        $fichiers = self::compte($pdo, 'SELECT article_id, COUNT(*) FROM fichiers GROUP BY article_id');
        $out = [];
        foreach ($grappes as $ids) {
            if (in_array(self::cle($ids), $ignores, true) || !self::tousGerables($c, $par, $ids)) {
                continue;
            }
            $articles = [];
            foreach ($ids as $id) {
                $r = $par[$id];
                $articles[] = [
                    'id' => $id, 'titre' => (string) $r['titre'], 'auteur' => (string) ($r['auteur'] ?? ''), 'parution' => (string) $r['parution'],
                    'doi' => (string) $r['doi'], 'source' => (string) $r['source'], 'ajoute' => Temps::iso((string) $r['ajoute']),
                    'lieu' => $r['g_nom'] === null ? 'Sans groupe' : trim(($r['e_nom'] ?? '') . ' · ' . ($r['p_nom'] ?? '') . ' · ' . $r['g_nom'], ' ·'),
                    'fiches' => $nbFiches[$id] ?? 0, 'propositions' => $nbProps[$id] ?? 0, 'fichier' => ($fichiers[$id] ?? 0) > 0,
                ];
            }
            // Proposition de principal : l'article qui a le plus de fiches, puis le plus ancien.
            usort($articles, static fn (array $a, array $b): int => $b['fiches'] <=> $a['fiches'] ?: strcmp($a['ajoute'], $b['ajoute']));
            $out[] = ['cle' => self::cle($ids), 'articles' => $articles, 'propose' => $articles[0]['id']];
        }
        return $out;
    }

    /**
     * Fusionne les doublons dans l'article principal.
     *
     * @param list<string> $doublons
     * @return array{fiches:int,fichiers_retires:int,champs_completes:int}
     */
    public static function fusionner(Contexte $c, string $principal, array $doublons): array
    {
        if (!$c->droits()->estAdminQuelconque()) {
            throw new Erreur('forbidden', 'Réservé à un administrateur');
        }
        $doublons = array_values(array_unique(array_filter(array_map('strval', $doublons), static fn (string $d): bool => $d !== '' && $d !== $principal)));
        if ($principal === '' || $doublons === []) {
            throw new Erreur('invalid', 'Choisissez l’article à garder et au moins un doublon');
        }
        $pdo = $c->db->principale();
        $ids = array_merge([$principal], $doublons);
        $st = $pdo->prepare('SELECT r.*, g.promo_id FROM articles r LEFT JOIN groupes g ON g.id = r.groupe_id WHERE r.id IN (' . Lectures::marques(count($ids)) . ')');
        $st->execute($ids);
        $par = [];
        foreach ($st->fetchAll() as $r) {
            $par[(string) $r['id']] = $r;
        }
        if (count($par) !== count($ids)) {
            throw new Erreur('not_found', 'Article introuvable (déjà fusionné ?)');
        }
        if (!self::tousGerables($c, $par, $ids)) {
            throw new Erreur('forbidden', 'Ces articles ne sont pas tous dans votre périmètre');
        }
        foreach ($doublons as $d) {
            $st = $pdo->prepare('SELECT COUNT(*) FROM analyses a1 JOIN analyses a2 ON a2.utilisateur_id = a1.utilisateur_id WHERE a1.article_id = ? AND a2.article_id = ?');
            $st->execute([$principal, $d]);
            if ((int) $st->fetchColumn() > 0) {
                throw new Erreur('invalid', 'Fusion impossible : une même personne a une fiche sur « ' . $par[$principal]['titre'] . ' » et sur « ' . $par[$d]['titre']
                    . ' ». Supprimez ou regroupez d’abord l’une de ces fiches.');
            }
        }

        $bilan = ['fiches' => 0, 'fichiers_retires' => 0, 'champs_completes' => 0];
        $pdo->beginTransaction();
        try {
            $courant = $par[$principal];
            foreach ($doublons as $d) {
                $x = $par[$d];
                // Champs vides du principal complétés par le doublon.
                foreach (Lectures::OBJECTIFS as $k) {
                    if (trim((string) ($courant[$k] ?? '')) === '' && trim((string) ($x[$k] ?? '')) !== '') {
                        $pdo->prepare("UPDATE articles SET `$k` = ? WHERE id = ?")->execute([$x[$k], $principal]);
                        $courant[$k] = $x[$k];
                        $bilan['champs_completes']++;
                    }
                }
                $mv = $pdo->prepare('UPDATE analyses SET article_id = ? WHERE article_id = ?');
                $mv->execute([$principal, $d]);
                $bilan['fiches'] += $mv->rowCount();
                $pdo->prepare('UPDATE propositions SET article_id = ? WHERE article_id = ?')->execute([$principal, $d]);
                $pdo->prepare("UPDATE historique SET cible_id = ? WHERE cible = 'article' AND cible_id = ?")->execute([$principal, $d]);
                $pdo->prepare("UPDATE import_traces SET cible_id = ? WHERE entite = 'article' AND cible_id = ?")->execute([$principal, $d]);
                // Une seule pièce jointe par article : celle du principal est gardée ; sinon celle du doublon est reprise.
                $st = $pdo->prepare('SELECT COUNT(*) FROM fichiers WHERE article_id = ?');
                $st->execute([$principal]);
                if ((int) $st->fetchColumn() > 0) {
                    $st = $pdo->prepare('SELECT COUNT(*) FROM fichiers WHERE article_id = ?');
                    $st->execute([$d]);
                    $bilan['fichiers_retires'] += (int) $st->fetchColumn();
                    Fichiers::retirerFichiersArticle($c, $pdo, $d);
                } else {
                    $pdo->prepare('UPDATE fichiers SET article_id = ? WHERE article_id = ?')->execute([$principal, $d]);
                }
                $pdo->prepare('DELETE FROM articles WHERE id = ?')->execute([$d]);
            }
            Actions\Acces::journal($pdo, $c, 'article_merge', 'article:' . $principal, 'doublons=' . count($doublons) . ' fiches=' . $bilan['fiches']);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        return $bilan;
    }

    /** Marque un groupe d'articles comme « pas des doublons » : il n'est plus proposé. @param list<string> $ids */
    public static function ignorer(Contexte $c, array $ids): void
    {
        if (!$c->droits()->estAdminQuelconque()) {
            throw new Erreur('forbidden', 'Réservé à un administrateur');
        }
        $ids = array_values(array_unique(array_map('strval', $ids)));
        if (count($ids) < 2) {
            throw new Erreur('invalid', 'Indiquez les articles concernés');
        }
        $pdo = $c->db->principale();
        $st = $pdo->prepare('SELECT r.*, g.promo_id FROM articles r LEFT JOIN groupes g ON g.id = r.groupe_id WHERE r.id IN (' . Lectures::marques(count($ids)) . ')');
        $st->execute($ids);
        $par = [];
        foreach ($st->fetchAll() as $r) {
            $par[(string) $r['id']] = $r;
        }
        if (count($par) !== count($ids) || !self::tousGerables($c, $par, $ids)) {
            throw new Erreur('forbidden', 'Ces articles ne sont pas tous dans votre périmètre');
        }
        $pdo->prepare('INSERT IGNORE INTO doublons_ignores (cle, cree_le, cree_par) VALUES (?, ?, ?)')->execute([self::cle($ids), Temps::maintenant(), $c->user->id]);
    }

    // ---------- Interne ----------

    /** @param list<string> $ids */
    private static function cle(array $ids): string
    {
        sort($ids);
        return sha1(implode('|', $ids));
    }

    /** Un article sans groupe ne se gère que par l'administrateur général. @param array<string,array<string,mixed>> $par @param list<string> $ids */
    private static function tousGerables(Contexte $c, array $par, array $ids): bool
    {
        if ($c->droits()->estAdmin()) {
            return true;
        }
        foreach ($ids as $id) {
            $g = $par[$id]['groupe_id'] ?? null;
            if ($g === null || !$c->droits()->peutAdministrerGroupe((string) $g)) {
                return false;
            }
        }
        return true;
    }

    /** @param array<string,mixed> $r @return array<string,mixed> */
    private static function champs(array $r): array
    {
        return ['titre' => (string) ($r['titre'] ?? ''), 'doi' => (string) ($r['doi'] ?? '')];
    }

    /** @return array<string,int> */
    private static function compte(\PDO $pdo, string $sql): array
    {
        $out = [];
        foreach ($pdo->query($sql)->fetchAll(\PDO::FETCH_NUM) as [$id, $n]) {
            $out[(string) $id] = (int) $n;
        }
        return $out;
    }
}
