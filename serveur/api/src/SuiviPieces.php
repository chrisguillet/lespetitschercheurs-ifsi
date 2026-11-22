<?php
declare(strict_types=1);

namespace Lpc;

/**
 * Pièces jointes des comptes rendus de réunion : 5 au plus par compte rendu, PDF, PNG ou JPEG de 5 Mo au plus à l'envoi.
 * Les images sont réduites à 300 Ko au plus à l'enregistrement (voir Fichiers::compresser). Contenu dans le dossier privé du serveur.
 * Lecture : membres du groupe, formateurs rattachés et administrateurs (même périmètre que le compte rendu). Écriture : membres du groupe.
 */
final class SuiviPieces
{
    public const MAX_PAR_CR = 5;
    public const MAX_IMAGE = 300 * 1024;

    /** Pièces jointes des comptes rendus des groupes donnés. @param list<string> $gids @return array<string,list<array<string,mixed>>> */
    public static function pourReunions(\PDO $pdo, array $gids): array
    {
        if ($gids === []) {
            return [];
        }
        $st = $pdo->prepare(
            'SELECT f.id, f.reunion_id, f.nom, f.type, f.taille, f.cree_le, u.prenom, u.nom AS u_nom, u.pseudo
             FROM reunions_fichiers f JOIN reunions r ON r.id = f.reunion_id LEFT JOIN utilisateurs u ON u.id = f.cree_par
             WHERE r.groupe_id IN (' . Lectures::marques(count($gids)) . ') ORDER BY f.cree_le, f.id'
        );
        $st->execute($gids);
        $out = [];
        foreach ($st->fetchAll() as $f) {
            $out[(string) $f['reunion_id']][] = [
                'id' => (string) $f['id'], 'nom' => (string) $f['nom'], 'type' => (string) $f['type'], 'taille' => (int) $f['taille'],
                'par' => $f['prenom'] === null ? 'Utilisateur supprimé' : Utilisateur::nomAffiche((string) $f['prenom'], (string) $f['u_nom'], $f['pseudo'] === null ? null : (string) $f['pseudo']),
                'cree_le' => Temps::iso((string) $f['cree_le']),
            ];
        }
        return $out;
    }

    /** Dépose une pièce jointe sur un compte rendu. Contenu en base64. */
    public static function ajouter(Contexte $c, string $reunionId, mixed $nom, mixed $base64): void
    {
        Lectures::exigerEtudiant($c);
        $pdo = $c->db->principale();
        $gid = self::groupeDe($pdo, $reunionId);
        if (!Membres::estMembre($pdo, $gid, (int) $c->user->id)) {
            throw new Erreur('forbidden', 'Seules les membres du groupe ajoutent des pièces jointes à ses comptes rendus');
        }
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
        $st = $pdo->prepare('SELECT COUNT(*) FROM reunions_fichiers WHERE reunion_id = ?');
        $st->execute([$reunionId]);
        if ((int) $st->fetchColumn() >= self::MAX_PAR_CR) {
            throw new Erreur('invalid', 'Cinq pièces jointes au plus par compte rendu : supprimez-en une avant d’en ajouter une autre');
        }
        if ($t['type'] !== 'application/pdf') {
            $reduit = Fichiers::compresser(Fichiers::reduire($octets, $t['type']), $t['type'], self::MAX_IMAGE);
            if ($reduit === null) {
                throw new Erreur('invalid', 'Image trop lourde : 300 Ko maximum après réduction, essayez une photo de plus petite taille');
            }
            $octets = $reduit['contenu'];
            $t = Fichiers::type($octets) ?? $t;   // un PNG devenu JPEG change d'extension
        }
        self::verifierQuota($pdo, $gid, strlen($octets));

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
            $pdo->prepare('INSERT INTO reunions_fichiers (id, reunion_id, nom, type, taille, chemin, cree_par, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
                ->execute([$id, $reunionId, Fichiers::nomDeFichier($nom, $t['ext']), $t['type'], strlen($octets), $chemin, $c->user->id, Temps::maintenant()]);
        } catch (\Throwable $e) {
            @unlink($dossier . '/' . $chemin);
            throw $e;
        }
    }

    /** Le contenu passe par le serveur : aucun lien public. @return array<string,string> */
    public static function lire(Contexte $c, string $id): array
    {
        $f = self::visible($c, $id);
        $reel = Fichiers::cheminReel($c, (string) $f['chemin']);
        $octets = $reel === null ? false : file_get_contents($reel);
        if ($octets === false) {
            throw new Erreur('not_found', 'Fichier introuvable sur le serveur');
        }
        return ['nom' => (string) $f['nom'], 'type' => (string) $f['type'], 'data' => base64_encode($octets)];
    }

    /** Membres du groupe uniquement. */
    public static function supprimer(Contexte $c, string $id): void
    {
        $pdo = $c->db->principale();
        $f = self::visible($c, $id);
        Lectures::exigerEtudiant($c);
        if (!Membres::estMembre($pdo, (string) $f['groupe_id'], (int) $c->user->id)) {
            throw new Erreur('forbidden', 'Seules les membres du groupe suppriment une pièce jointe');
        }
        $pdo->prepare('DELETE FROM reunions_fichiers WHERE id = ?')->execute([$id]);
        Fichiers::supprimerDuDisque($c, [(string) $f['chemin']]);
    }

    // ---------- Interne ----------

    private static function groupeDe(\PDO $pdo, string $reunionId): string
    {
        $st = $pdo->prepare('SELECT groupe_id FROM reunions WHERE id = ?');
        $st->execute([$reunionId]);
        $g = $st->fetchColumn();
        if ($g === false) {
            throw new Erreur('not_found', 'Compte rendu introuvable');
        }
        return (string) $g;
    }

    /** @return array<string,mixed> */
    private static function visible(Contexte $c, string $id): array
    {
        $st = $c->db->principale()->prepare('SELECT f.id, f.nom, f.type, f.chemin, r.groupe_id FROM reunions_fichiers f JOIN reunions r ON r.id = f.reunion_id WHERE f.id = ?');
        $st->execute([$id]);
        $f = $st->fetch();
        if ($f === false) {
            throw new Erreur('not_found', 'Fichier introuvable');
        }
        if (!in_array((string) $f['groupe_id'], Donnees::idsGroupesVisibles($c), true)) {
            throw new Erreur('forbidden', 'Ce groupe ne vous est pas accessible');
        }
        return $f;
    }

    /** Quota d'espace du groupe (articles et comptes rendus compris). */
    private static function verifierQuota(\PDO $pdo, string $gid, int $taille): void
    {
        $st = $pdo->prepare('SELECT quota_octets FROM groupes WHERE id = ?');
        $st->execute([$gid]);
        $quota = $st->fetchColumn();
        if ($quota === false || $quota === null) {
            return;
        }
        $st = $pdo->prepare(
            'SELECT (SELECT COALESCE(SUM(f.taille), 0) FROM fichiers f JOIN articles a ON a.id = f.article_id WHERE a.groupe_id = ?)
                  + (SELECT COALESCE(SUM(rf.taille), 0) FROM reunions_fichiers rf JOIN reunions r ON r.id = rf.reunion_id WHERE r.groupe_id = ?)'
        );
        $st->execute([$gid, $gid]);
        if ((int) $st->fetchColumn() + $taille > (int) $quota) {
            throw new Erreur('invalid', 'Le quota d’espace du groupe est atteint : supprimez un fichier avant d’en ajouter un autre');
        }
    }
}
