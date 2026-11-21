<?php
declare(strict_types=1);

namespace Lpc;

/**
 * Notes personnelles : strictement privées. Chaque lecture et écriture est filtrée sur la personne connectée, même l'administrateur
 * ne lit pas celles des autres, et elles ne figurent dans aucune autre réponse. Les « liens » sont des identifiants de fiches.
 */
final class Notes
{
    public const ETIQ_MAX = 30;
    public const ETIQS_MAX = 10;
    public const TITRE_MAX = 120;
    public const TEXTE_MAX = 20000;
    public const LIENS_MAX = 30;

    /** @return list<array<string,mixed>> épinglées d'abord, puis les plus récentes */
    public static function de(Contexte $c): array
    {
        $st = $c->db->principale()->prepare('SELECT id, titre, date, texte, liens, etiquettes, epingle, cree_le, modifie_le FROM notes WHERE utilisateur_id = ?');
        $st->execute([$c->user->id]);
        $out = [];
        foreach ($st->fetchAll() as $n) {
            $out[] = [
                'id' => (string) $n['id'], 'titre' => (string) $n['titre'], 'date' => (string) $n['date'], 'texte' => (string) ($n['texte'] ?? ''),
                'liens' => self::liste($n['liens']), 'etiquettes' => self::liste($n['etiquettes']), 'epingle' => (int) $n['epingle'] === 1,
                'cree_le' => Temps::iso((string) $n['cree_le']), 'modifie_le' => Temps::iso($n['modifie_le'] === null ? null : (string) $n['modifie_le']),
            ];
        }
        usort($out, static fn (array $a, array $b): int => ((int) $b['epingle'] <=> (int) $a['epingle']) ?: strcmp($b['date'], $a['date']) ?: strcmp($b['cree_le'], $a['cree_le']));
        return $out;
    }

    public static function enregistrer(Contexte $c, mixed $data): void
    {
        if (!is_array($data)) {
            throw new Erreur('invalid', 'Données manquantes');
        }
        $titre = is_scalar($data['titre'] ?? null) ? trim((string) $data['titre']) : '';
        $texte = is_scalar($data['texte'] ?? null) ? (string) $data['texte'] : '';
        $date = is_scalar($data['date'] ?? null) ? (string) $data['date'] : '';
        if ($titre === '') {
            throw new Erreur('invalid', 'Titre requis');
        }
        if (mb_strlen($titre) > self::TITRE_MAX) {
            throw new Erreur('invalid', 'Titre trop long');
        }
        if (mb_strlen($texte) > self::TEXTE_MAX) {
            throw new Erreur('invalid', 'Note trop longue');
        }
        if (preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $date, $m) !== 1 || !checkdate((int) $m[2], (int) $m[3], (int) $m[1])) {
            throw new Erreur('invalid', 'Date invalide');
        }
        $liens = [];
        foreach (is_array($data['liens'] ?? null) ? $data['liens'] : [] as $x) {
            $x = is_scalar($x) ? (string) $x : '';
            if ($x !== '' && strlen($x) <= 64 && !in_array($x, $liens, true)) {
                $liens[] = $x;
            }
        }
        if (count($liens) > self::LIENS_MAX) {
            throw new Erreur('invalid', 'Trop de fiches liées');
        }
        $etiquettes = [];
        $vues = [];
        foreach (is_array($data['etiquettes'] ?? null) ? $data['etiquettes'] : [] as $x) {
            $x = Valide::espaces($x);
            if ($x !== '' && mb_strlen($x) <= self::ETIQ_MAX && !isset($vues[mb_strtolower($x)])) {
                $vues[mb_strtolower($x)] = true;
                $etiquettes[] = $x;
            }
        }
        if (count($etiquettes) > self::ETIQS_MAX) {
            throw new Erreur('invalid', 'Trop d’étiquettes');
        }
        $epingle = empty($data['epingle']) ? 0 : 1;
        $pdo = $c->db->principale();
        $now = Temps::maintenant();
        $jl = json_encode($liens, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        $je = json_encode($etiquettes, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        $id = is_string($data['id'] ?? null) ? $data['id'] : '';
        if ($id !== '') {
            $st = $pdo->prepare('UPDATE notes SET titre = ?, date = ?, texte = ?, liens = ?, etiquettes = ?, epingle = ?, modifie_le = ? WHERE id = ? AND utilisateur_id = ?');
            $st->execute([$titre, $date, $texte, $jl, $je, $epingle, $now, $id, $c->user->id]);
            $st = $pdo->prepare('SELECT 1 FROM notes WHERE id = ? AND utilisateur_id = ?');   // une modification sans changement renvoie 0 ligne
            $st->execute([$id, $c->user->id]);
            if ($st->fetchColumn() === false) {
                throw new Erreur('not_found', 'Note introuvable');
            }
            return;
        }
        $pdo->prepare('INSERT INTO notes (id, utilisateur_id, titre, date, texte, liens, etiquettes, epingle, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
            ->execute([Ids::uuid(), $c->user->id, $titre, $date, $texte, $jl, $je, $epingle, $now]);
    }

    public static function supprimer(Contexte $c, string $id): void
    {
        $st = $c->db->principale()->prepare('DELETE FROM notes WHERE id = ? AND utilisateur_id = ?');
        $st->execute([$id, $c->user->id]);
        if ($st->rowCount() === 0) {
            throw new Erreur('not_found', 'Note introuvable');
        }
    }

    /** @return list<string> */
    private static function liste(mixed $json): array
    {
        $l = json_decode((string) $json, true);
        return is_array($l) ? array_values(array_map('strval', $l)) : [];
    }
}
