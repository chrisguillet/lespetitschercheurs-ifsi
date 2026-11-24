<?php
declare(strict_types=1);

namespace Lpc;

/**
 * Signature électronique de la charte de fonctionnement d'un groupe, par ses membres étudiants : règle par règle, et pour la charte entière.
 * Une signature enregistre la personne connectée, la date et l'empreinte (SHA-256) du texte signé. Dès que le texte change, l'empreinte
 * d'aujourd'hui ne correspond plus : la signature est « périmée » et la personne doit signer de nouveau. Rien n'est à réinitialiser.
 * La charte entière porte sur toutes les règles et leur ordre : ajouter, retirer, modifier ou déplacer une règle périme ces signatures.
 */
final class Signatures
{
    /** Cible de la signature de la charte entière (les règles sont désignées par leur identifiant). */
    public const CHARTE = 'charte';

    public static function empreinteRegle(string $titre, string $description): string
    {
        return hash('sha256', (string) json_encode([trim($titre), trim($description)], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    }

    /** @param list<array<string,mixed>> $regles dans l'ordre de la charte */
    public static function empreinteCharte(array $regles): string
    {
        $liste = array_map(static fn (array $r): array => [trim((string) $r['titre']), trim((string) $r['description'])], $regles);
        return hash('sha256', (string) json_encode($liste, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    }

    /** Règles d'un groupe, dans l'ordre de la charte. @return list<array<string,mixed>> */
    private static function regles(\PDO $pdo, string $gid): array
    {
        $st = $pdo->prepare('SELECT id, titre, description FROM regles WHERE groupe_id = ? ORDER BY ordre, cree_le, id');
        $st->execute([$gid]);
        return $st->fetchAll();
    }

    private static function texteRegle(array $r): string
    {
        return trim((string) $r['titre']) . (trim((string) $r['description']) === '' ? '' : "\n" . trim((string) $r['description']));
    }

    /** @param list<array<string,mixed>> $regles */
    private static function texteCharte(string $nomGroupe, array $regles): string
    {
        $lignes = ['Charte de fonctionnement du groupe ' . $nomGroupe];
        foreach ($regles as $i => $r) {
            $lignes[] = ($i + 1) . '. ' . str_replace("\n", "\n   ", self::texteRegle($r));
        }
        return implode("\n", $lignes);
    }

    /** Signe une règle (cible = son identifiant) ou la charte entière (cible = « charte »), telle que la personne la voit (empreinte). */
    public static function signer(Contexte $c, mixed $groupeId, mixed $cible, mixed $empreinte): void
    {
        Lectures::exigerEtudiant($c);
        $pdo = $c->db->principale();
        $uid = (int) $c->user->id;
        $gid = is_string($groupeId) ? $groupeId : '';
        if ($gid === '' || !Membres::estMembre($pdo, $gid, $uid)) {
            throw new Erreur('forbidden', 'Vous ne faites pas partie de ce groupe');
        }
        $cible = is_string($cible) ? $cible : '';
        $regles = self::regles($pdo, $gid);
        if ($cible === self::CHARTE) {
            if ($regles === []) {
                throw new Erreur('invalid', 'La charte est vide : il n’y a rien à signer');
            }
            $actuelle = self::empreinteCharte($regles);
            $st = $pdo->prepare('SELECT nom FROM groupes WHERE id = ?');
            $st->execute([$gid]);
            $texte = self::texteCharte((string) $st->fetchColumn(), $regles);
        } else {
            $regle = null;
            foreach ($regles as $r) {
                if ((string) $r['id'] === $cible) {
                    $regle = $r;
                }
            }
            if ($regle === null) {
                throw new Erreur('not_found', 'Règle introuvable');
            }
            $actuelle = self::empreinteRegle((string) $regle['titre'], (string) $regle['description']);
            $texte = self::texteRegle($regle);
        }
        if (!is_string($empreinte) || !hash_equals($actuelle, $empreinte)) {
            throw new Erreur('conflict', 'Le texte a changé depuis que vous l’avez lu : relisez-le avant de signer');
        }
        $pdo->prepare('REPLACE INTO signatures_charte (groupe_id, utilisateur_id, cible, empreinte, texte, signe_le) VALUES (?, ?, ?, ?, ?, ?)')
            ->execute([$gid, $uid, $cible, $actuelle, $texte, Temps::maintenant()]);
    }

    /** Retire la signature de la personne (la sienne seulement). */
    public static function retirer(Contexte $c, mixed $groupeId, mixed $cible): void
    {
        Lectures::exigerEtudiant($c);
        $pdo = $c->db->principale();
        $gid = is_string($groupeId) ? $groupeId : '';
        if ($gid === '' || !Membres::estMembre($pdo, $gid, (int) $c->user->id)) {
            throw new Erreur('forbidden', 'Vous ne faites pas partie de ce groupe');
        }
        $pdo->prepare('DELETE FROM signatures_charte WHERE groupe_id = ? AND utilisateur_id = ? AND cible = ?')
            ->execute([$gid, (int) $c->user->id, is_string($cible) ? $cible : '']);
    }

    /** Efface les signatures d'une règle supprimée. */
    public static function oublierRegle(\PDO $pdo, string $regleId): void
    {
        $pdo->prepare('DELETE FROM signatures_charte WHERE cible = ?')->execute([$regleId]);
    }

    /**
     * Pour chaque groupe visible : empreinte de la charte et signatures (membres actuels seulement), et de même pour chaque règle.
     * « a_jour » : la signature porte sur le texte d'aujourd'hui.
     *
     * @return list<array<string,mixed>>
     */
    public static function pourClient(Contexte $c): array
    {
        $gids = Donnees::idsGroupesVisibles($c);
        if ($gids === []) {
            return [];
        }
        $pdo = $c->db->principale();
        $marques = Lectures::marques(count($gids));
        $st = $pdo->prepare("SELECT id, groupe_id, titre, description FROM regles WHERE groupe_id IN ($marques) ORDER BY groupe_id, ordre, cree_le, id");
        $st->execute($gids);
        $regles = [];
        foreach ($st->fetchAll() as $r) {
            $regles[(string) $r['groupe_id']][] = $r;
        }
        $st = $pdo->prepare("SELECT s.groupe_id, s.cible, s.empreinte, s.signe_le, u.pid, u.prenom, u.nom, u.pseudo
                             FROM signatures_charte s JOIN utilisateurs u ON u.id = s.utilisateur_id
                             JOIN membres m ON m.groupe_id = s.groupe_id AND m.utilisateur_id = s.utilisateur_id
                             WHERE u.statut = 'actif' AND s.groupe_id IN ($marques) ORDER BY s.signe_le, u.prenom");
        $st->execute($gids);
        $signees = [];
        foreach ($st->fetchAll() as $s) {
            $signees[(string) $s['groupe_id']][(string) $s['cible']][] = $s;
        }
        $out = [];
        foreach ($gids as $gid) {
            $liste = $regles[$gid] ?? [];
            $vue = static function (string $cible, string $empreinte) use ($signees, $gid): array {
                return array_map(static fn (array $s): array => [
                    'pid' => (string) $s['pid'],
                    'prenom' => Utilisateur::nomAffiche((string) $s['prenom'], (string) $s['nom'], $s['pseudo'] === null ? null : (string) $s['pseudo']),
                    'le' => Temps::iso((string) $s['signe_le']),
                    'a_jour' => hash_equals($empreinte, (string) $s['empreinte']),
                ], $signees[$gid][$cible] ?? []);
            };
            $empCharte = self::empreinteCharte($liste);
            $parRegle = [];
            foreach ($liste as $r) {
                $e = self::empreinteRegle((string) $r['titre'], (string) $r['description']);
                $parRegle[(string) $r['id']] = ['empreinte' => $e, 'signatures' => $vue((string) $r['id'], $e)];
            }
            $out[] = ['groupe_id' => $gid, 'empreinte' => $empCharte, 'signatures' => $vue(self::CHARTE, $empCharte), 'regles' => $parRegle];
        }
        return $out;
    }
}
