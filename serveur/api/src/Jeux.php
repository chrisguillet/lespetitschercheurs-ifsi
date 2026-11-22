<?php
declare(strict_types=1);

namespace Lpc;

/**
 * Meilleurs scores des mini-jeux de la pause ludique : un par personne, par jeu et par niveau de difficulté, avec sa date.
 * Le score est annoncé par le navigateur (jeu pour le plaisir, sans enjeu) : on contrôle seulement le jeu, le niveau et une borne raisonnable.
 */
final class Jeux
{
    /** Jeux connus, avec les niveaux de difficulté permis (liste vide : pas de niveau). */
    public const JEUX = ['course-m' => [], 'seringue' => [], 'urgences' => ['3', '6', '9'], 'couloir' => [], 'dejeuner' => []];
    public const SCORE_MAX = 1000000;

    /** @return list<array{jeu:string,niveau:string,score:int,obtenu_le:?string}> les meilleurs scores de la personne */
    public static function pourClient(Contexte $c): array
    {
        self::exigerCompte($c);
        $st = $c->db->principale()->prepare('SELECT jeu, niveau, score, obtenu_le FROM scores_jeux WHERE utilisateur_id = ? ORDER BY jeu, niveau');
        $st->execute([$c->user->id]);
        $out = [];
        foreach ($st->fetchAll() as $r) {
            $out[] = ['jeu' => (string) $r['jeu'], 'niveau' => (string) $r['niveau'], 'score' => (int) $r['score'], 'obtenu_le' => Temps::iso((string) $r['obtenu_le'])];
        }
        return $out;
    }

    /** Enregistre le score s'il bat le meilleur de la personne pour ce jeu et ce niveau. */
    public static function enregistrer(Contexte $c, mixed $data): void
    {
        self::exigerCompte($c);
        if (!is_array($data)) {
            throw new Erreur('invalid', 'Données manquantes');
        }
        $jeu = is_string($data['jeu'] ?? null) ? $data['jeu'] : '';
        if (!array_key_exists($jeu, self::JEUX)) {
            throw new Erreur('invalid', 'Jeu inconnu');
        }
        $niveau = is_scalar($data['niveau'] ?? null) ? (string) $data['niveau'] : '';
        $permis = self::JEUX[$jeu];
        if (($permis === [] && $niveau !== '') || ($permis !== [] && !in_array($niveau, $permis, true))) {
            throw new Erreur('invalid', 'Niveau inconnu');
        }
        $score = $data['score'] ?? null;
        if (!is_int($score) && !(is_float($score) && floor($score) === $score) && !(is_string($score) && ctype_digit($score))) {
            throw new Erreur('invalid', 'Score invalide');
        }
        $score = (int) $score;
        if ($score < 0 || $score > self::SCORE_MAX) {
            throw new Erreur('invalid', 'Score invalide');
        }
        $pdo = $c->db->principale();
        $st = $pdo->prepare('SELECT score FROM scores_jeux WHERE utilisateur_id = ? AND jeu = ? AND niveau = ?');
        $st->execute([$c->user->id, $jeu, $niveau]);
        $actuel = $st->fetchColumn();
        if ($actuel === false) {
            $pdo->prepare('INSERT INTO scores_jeux (utilisateur_id, jeu, niveau, score, obtenu_le) VALUES (?, ?, ?, ?, ?)')
                ->execute([$c->user->id, $jeu, $niveau, $score, Temps::maintenant()]);
        } elseif ($score > (int) $actuel) {
            $pdo->prepare('UPDATE scores_jeux SET score = ?, obtenu_le = ? WHERE utilisateur_id = ? AND jeu = ? AND niveau = ?')
                ->execute([$score, Temps::maintenant(), $c->user->id, $jeu, $niveau]);
        }
    }

    private static function exigerCompte(Contexte $c): void
    {
        if ($c->user->id === null || $c->user->accueil) {
            throw new Erreur('forbidden', 'Votre accès doit d’abord être validé');
        }
    }
}
