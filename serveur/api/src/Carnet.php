<?php
declare(strict_types=1);

namespace Lpc;

/**
 * Carnet d'apprentissage : strictement individuel. Chaque lecture et écriture est filtrée sur la personne connectée (même
 * l'administrateur ne lit pas celui des autres) et il ne figure dans aucune autre réponse. Une entrée = une séance.
 */
final class Carnet
{
    public const CHAMPS = ['vu', 'comprehension', 'apprentissage', 'interrogations', 'axe', 'transfert'];
    public const TEXTE_MAX = 10000;
    public const TYPES_MAX = 10;
    public const TYPE_MAX = 40;

    /** @return list<array<string,mixed>> les plus récentes d'abord */
    public static function de(Contexte $c): array
    {
        $st = $c->db->principale()->prepare('SELECT id, date, vu, comprehension, apprentissage, types, interrogations, axe, transfert, cree_le, modifie_le FROM carnet WHERE utilisateur_id = ?');
        $st->execute([$c->user->id]);
        $out = [];
        foreach ($st->fetchAll() as $n) {
            $e = ['id' => (string) $n['id'], 'date' => (string) $n['date']];
            foreach (self::CHAMPS as $k) {
                $e[$k] = (string) ($n[$k] ?? '');
            }
            $l = json_decode((string) $n['types'], true);
            $e['types'] = is_array($l) ? array_values(array_map('strval', $l)) : [];
            $e['cree_le'] = Temps::iso((string) $n['cree_le']);
            $e['modifie_le'] = Temps::iso($n['modifie_le'] === null ? null : (string) $n['modifie_le']);
            $out[] = $e;
        }
        usort($out, static fn (array $a, array $b): int => strcmp($b['date'], $a['date']) ?: strcmp($b['cree_le'], $a['cree_le']));
        return $out;
    }

    /** @return string identifiant de l'entrée enregistrée */
    public static function enregistrer(Contexte $c, mixed $data): string
    {
        if (!is_array($data)) {
            throw new Erreur('invalid', 'Données manquantes');
        }
        $date = is_scalar($data['date'] ?? null) ? (string) $data['date'] : '';
        if (preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $date, $m) !== 1 || !checkdate((int) $m[2], (int) $m[3], (int) $m[1])) {
            throw new Erreur('invalid', 'Date invalide');
        }
        $v = [];
        foreach (self::CHAMPS as $k) {
            $t = is_scalar($data[$k] ?? null) ? (string) $data[$k] : '';
            if (mb_strlen($t) > self::TEXTE_MAX) {
                throw new Erreur('invalid', 'Texte trop long');
            }
            $v[$k] = $t;
        }
        if (trim(implode('', $v)) === '') {
            throw new Erreur('invalid', 'Renseignez au moins une rubrique');
        }
        $types = [];
        $vus = [];
        foreach (is_array($data['types'] ?? null) ? $data['types'] : [] as $x) {
            $x = Valide::espaces($x);
            if ($x !== '' && mb_strlen($x) <= self::TYPE_MAX && !isset($vus[mb_strtolower($x)])) {
                $vus[mb_strtolower($x)] = true;
                $types[] = $x;
            }
        }
        if (count($types) > self::TYPES_MAX) {
            throw new Erreur('invalid', 'Trop de types d’apprentissage');
        }
        $jt = json_encode($types, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        $pdo = $c->db->principale();
        $now = Temps::maintenant();
        $id = is_string($data['id'] ?? null) ? $data['id'] : '';
        if ($id !== '') {
            $st = $pdo->prepare('UPDATE carnet SET date = ?, vu = ?, comprehension = ?, apprentissage = ?, types = ?, interrogations = ?, axe = ?, transfert = ?, modifie_le = ? WHERE id = ? AND utilisateur_id = ?');
            $st->execute([$date, $v['vu'], $v['comprehension'], $v['apprentissage'], $jt, $v['interrogations'], $v['axe'], $v['transfert'], $now, $id, $c->user->id]);
            $st = $pdo->prepare('SELECT 1 FROM carnet WHERE id = ? AND utilisateur_id = ?');   // une modification sans changement renvoie 0 ligne
            $st->execute([$id, $c->user->id]);
            if ($st->fetchColumn() === false) {
                throw new Erreur('not_found', 'Entrée introuvable');
            }
            return $id;
        }
        $id = Ids::uuid();
        $pdo->prepare('INSERT INTO carnet (id, utilisateur_id, date, vu, comprehension, apprentissage, types, interrogations, axe, transfert, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            ->execute([$id, $c->user->id, $date, $v['vu'], $v['comprehension'], $v['apprentissage'], $jt, $v['interrogations'], $v['axe'], $v['transfert'], $now]);
        return $id;
    }

    public static function supprimer(Contexte $c, string $id): void
    {
        $st = $c->db->principale()->prepare('DELETE FROM carnet WHERE id = ? AND utilisateur_id = ?');
        $st->execute([$id, $c->user->id]);
        if ($st->rowCount() === 0) {
            throw new Erreur('not_found', 'Entrée introuvable');
        }
    }
}
