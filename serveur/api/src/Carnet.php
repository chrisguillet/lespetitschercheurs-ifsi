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
    public const FICHIERS_MAX = 3;
    public const IMAGE_MAX = 300 * 1024;

    /** @return list<array<string,mixed>> les plus récentes d'abord */
    public static function de(Contexte $c): array
    {
        $st = $c->db->principale()->prepare('SELECT id, date, vu, comprehension, apprentissage, types, interrogations, axe, transfert, cree_le, modifie_le FROM carnet WHERE utilisateur_id = ?');
        $st->execute([$c->user->id]);
        $fichiers = self::fichiersDe($c);
        $out = [];
        foreach ($st->fetchAll() as $n) {
            $e = ['id' => (string) $n['id'], 'date' => (string) $n['date']];
            foreach (self::CHAMPS as $k) {
                $e[$k] = (string) ($n[$k] ?? '');
            }
            $l = json_decode((string) $n['types'], true);
            $e['types'] = is_array($l) ? array_values(array_map('strval', $l)) : [];
            $e['fichiers'] = $fichiers[$e['id']] ?? [];
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
        $pdo = $c->db->principale();
        $st = $pdo->prepare('SELECT f.chemin FROM carnet_fichiers f JOIN carnet n ON n.id = f.carnet_id WHERE n.id = ? AND n.utilisateur_id = ?');
        $st->execute([$id, $c->user->id]);
        $chemins = array_map('strval', $st->fetchAll(\PDO::FETCH_COLUMN));
        $st = $pdo->prepare('DELETE FROM carnet WHERE id = ? AND utilisateur_id = ?');   // les lignes des fichiers : CASCADE
        $st->execute([$id, $c->user->id]);
        if ($st->rowCount() === 0) {
            throw new Erreur('not_found', 'Entrée introuvable');
        }
        Fichiers::supprimerDuDisque($c, $chemins);
    }

    // ---------- Documents joints (3 au plus par entrée : PDF, PNG ou JPEG ; images réduites à 300 Ko) ----------

    /** Dépose un document sur une entrée du carnet. Contenu en base64. */
    public static function ajouterFichier(Contexte $c, string $carnetId, mixed $nom, mixed $base64): void
    {
        $pdo = $c->db->principale();
        self::exigerEntree($pdo, $c, $carnetId);
        $b64 = is_string($base64) ? $base64 : '';
        if ($b64 === '') {
            throw new Erreur('invalid', 'Fichier vide');
        }
        if (strlen($b64) > intdiv(Fichiers::MAX_OCTETS * 4, 3) + 16) {
            throw new Erreur('invalid', 'Fichier trop volumineux (5 Mo maximum)');
        }
        $octets = base64_decode($b64, true);
        if ($octets === false || $octets === '') {
            throw new Erreur('invalid', 'Fichier illisible ou vide');
        }
        if (strlen($octets) > Fichiers::MAX_OCTETS) {
            throw new Erreur('invalid', 'Fichier trop volumineux (5 Mo maximum)');
        }
        $t = Fichiers::type($octets);
        if ($t === null) {
            throw new Erreur('invalid', 'Format non accepté : PDF, PNG ou JPEG uniquement');
        }
        $st = $pdo->prepare('SELECT COUNT(*) FROM carnet_fichiers WHERE carnet_id = ?');
        $st->execute([$carnetId]);
        if ((int) $st->fetchColumn() >= self::FICHIERS_MAX) {
            throw new Erreur('invalid', 'Trois documents au plus par entrée : supprimez-en un avant d’en ajouter un autre');
        }
        if ($t['type'] !== 'application/pdf') {
            $reduit = Fichiers::compresser(Fichiers::reduire($octets, $t['type']), $t['type'], self::IMAGE_MAX);
            if ($reduit === null) {
                throw new Erreur('invalid', 'Image trop lourde : 300 Ko maximum après réduction, essayez une photo de plus petite taille');
            }
            $octets = $reduit['contenu'];
            $t = Fichiers::type($octets) ?? $t;   // un PNG devenu JPEG change d'extension
        }
        $id = Ids::uuid();
        $chemin = $id . $t['ext'];
        $dossier = $c->config->dossierPrive() . '/fichiers';
        if (!is_dir($dossier) && !mkdir($dossier, 0700, true) && !is_dir($dossier)) {
            throw new Erreur('server', 'Stockage des pièces jointes indisponible');
        }
        if (file_put_contents($dossier . '/' . $chemin, $octets, LOCK_EX) === false) {
            throw new Erreur('server', 'Fichier non enregistré');
        }
        try {
            $pdo->prepare('INSERT INTO carnet_fichiers (id, carnet_id, nom, type, taille, chemin, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?)')
                ->execute([$id, $carnetId, Fichiers::nomDeFichier($nom, $t['ext']), $t['type'], strlen($octets), $chemin, Temps::maintenant()]);
        } catch (\Throwable $e) {
            @unlink($dossier . '/' . $chemin);
            throw $e;
        }
    }

    /** Le contenu passe par le serveur : aucun lien public. @return array<string,string> */
    public static function lireFichier(Contexte $c, string $id): array
    {
        $f = self::fichierDe($c, $id);
        $reel = Fichiers::cheminReel($c, (string) $f['chemin']);
        $octets = $reel === null ? false : file_get_contents($reel);
        if ($octets === false) {
            throw new Erreur('not_found', 'Fichier introuvable sur le serveur');
        }
        return ['nom' => (string) $f['nom'], 'type' => (string) $f['type'], 'data' => base64_encode($octets)];
    }

    public static function supprimerFichier(Contexte $c, string $id): void
    {
        $f = self::fichierDe($c, $id);
        $c->db->principale()->prepare('DELETE FROM carnet_fichiers WHERE id = ?')->execute([$id]);
        Fichiers::supprimerDuDisque($c, [(string) $f['chemin']]);
    }

    // ---------- Interne ----------

    /** @return array<string,list<array<string,mixed>>> documents de la personne, par entrée */
    private static function fichiersDe(Contexte $c): array
    {
        $st = $c->db->principale()->prepare(
            'SELECT f.id, f.carnet_id, f.nom, f.type, f.taille FROM carnet_fichiers f JOIN carnet n ON n.id = f.carnet_id WHERE n.utilisateur_id = ? ORDER BY f.cree_le, f.id'
        );
        $st->execute([$c->user->id]);
        $out = [];
        foreach ($st->fetchAll() as $f) {
            $out[(string) $f['carnet_id']][] = ['id' => (string) $f['id'], 'nom' => (string) $f['nom'], 'type' => (string) $f['type'], 'taille' => (int) $f['taille']];
        }
        return $out;
    }

    private static function exigerEntree(\PDO $pdo, Contexte $c, string $carnetId): void
    {
        $st = $pdo->prepare('SELECT 1 FROM carnet WHERE id = ? AND utilisateur_id = ?');
        $st->execute([$carnetId, $c->user->id]);
        if ($st->fetchColumn() === false) {
            throw new Erreur('not_found', 'Entrée introuvable');
        }
    }

    /** @return array<string,mixed> un document de la personne connectée, sinon « introuvable » (aucune différence avec un identifiant inconnu) */
    private static function fichierDe(Contexte $c, string $id): array
    {
        $st = $c->db->principale()->prepare('SELECT f.id, f.nom, f.type, f.chemin FROM carnet_fichiers f JOIN carnet n ON n.id = f.carnet_id WHERE f.id = ? AND n.utilisateur_id = ?');
        $st->execute([$id, $c->user->id]);
        $f = $st->fetch();
        if ($f === false) {
            throw new Erreur('not_found', 'Fichier introuvable');
        }
        return $f;
    }
}
