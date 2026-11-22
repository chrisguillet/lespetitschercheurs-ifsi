<?php
declare(strict_types=1);

namespace Lpc;

/**
 * Bac à sable : un établissement fictif, une promo, deux groupes et des comptes de test (un par rôle) avec quelques données d'exemple.
 * L'administrateur général peut se mettre dans la peau de l'un de ces comptes fictifs (jamais d'une vraie personne) pour essayer l'application,
 * y compris en écriture, puis tout remettre à zéro. Rien de réel n'y entre : les vraies personnes ne voient ni cet établissement ni ces comptes.
 */
final class BacASable
{
    public const ETABLISSEMENT = '🧪 Bac à sable';
    public const DOMAINE = '@bac-a-sable.invalid';

    /** cle, prénom, nom, libellé du rôle, rôles [role, niveau], groupe (index) ou null */
    private const PERSONAS = [
        ['admin_site', 'Alix', 'Site', 'Administratrice de site', [['admin_site', 'etab']], null],
        ['admin_promo', 'Camille', 'Promo', 'Administratrice de promo', [['admin_promo', 'promo']], null],
        ['formateur', 'Gaël', 'Formation', 'Formateur', [['formateur', 'etab']], null],
        ['etudiante_a', 'Ana', 'Test', 'Étudiante · groupe 1', [['etudiant', 'promo']], 0],
        ['etudiant_b', 'Ben', 'Test', 'Étudiant · groupe 1', [['etudiant', 'promo']], 0],
        ['etudiante_c', 'Cléo', 'Test', 'Étudiante · groupe 2', [['etudiant', 'promo']], 1],
        ['sans_groupe', 'Dan', 'Test', 'Étudiant sans groupe', [['etudiant', 'promo']], null],
    ];
    private const COULEURS = ['#2a5bd7', '#d9622b', '#0d9488', '#8b3fd9', '#be185d', '#d97706', '#0369a1'];

    private static function exigerAdmin(Contexte $c): void
    {
        if (!$c->droits()->estAdmin()) {
            throw new Erreur('forbidden', 'Réservé à l’administrateur général');
        }
    }

    public static function estTest(\PDO $pdo, int $utilisateurId): bool
    {
        $st = $pdo->prepare('SELECT test FROM utilisateurs WHERE id = ?');
        $st->execute([$utilisateurId]);
        return (int) $st->fetchColumn() === 1;
    }

    /** @return array{existe:bool,personas:list<array<string,string>>} */
    public static function etat(Contexte $c): array
    {
        self::exigerAdmin($c);
        $pdo = $c->db->principale();
        $st = $pdo->query('SELECT id, pid, prenom, nom, email, statut FROM utilisateurs WHERE test = 1 ORDER BY id');
        $par = [];
        foreach (self::PERSONAS as $p) {
            $par[$p[0] . self::DOMAINE] = $p;
        }
        $out = [];
        foreach ($st->fetchAll() as $r) {
            $p = $par[(string) $r['email']] ?? null;
            if ($p === null || (string) $r['statut'] !== 'actif') {
                continue;
            }
            $out[] = ['pid' => (string) $r['pid'], 'nom' => $p[1] . ' ' . $p[2], 'role' => $p[3]];
        }
        return ['existe' => $out !== [], 'personas' => $out];
    }

    /** Supprime puis recrée le bac à sable (comptes, structure et données d'exemple). */
    public static function reinitialiser(Contexte $c): void
    {
        self::exigerAdmin($c);
        $pdo = $c->db->principale();
        $now = Temps::maintenant();
        $pdo->beginTransaction();
        try {
            self::vider($pdo);
            $etab = Ids::uuid();
            $promo = Ids::uuid();
            $pdo->prepare('INSERT INTO etablissements (id, nom, cree_le, test) VALUES (?, ?, ?, 1)')->execute([$etab, self::ETABLISSEMENT, $now]);
            $pdo->prepare('INSERT INTO promos (id, etablissement_id, nom, cree_le) VALUES (?, ?, ?, ?)')->execute([$promo, $etab, 'Promo de test', $now]);
            $groupes = [Ids::uuid(), Ids::uuid()];
            foreach ($groupes as $i => $g) {
                $pdo->prepare('INSERT INTO groupes (id, promo_id, nom, cree_le) VALUES (?, ?, ?, ?)')->execute([$g, $promo, 'Groupe test ' . ($i + 1), $now]);
            }
            $ids = [];
            foreach (self::PERSONAS as $i => [$cle, $prenom, $nom, , $roles, $groupe]) {
                $email = $cle . self::DOMAINE;
                $pdo->prepare('INSERT INTO utilisateurs (pid, email, prenom, nom, couleur, statut, consentement_le, consentement_version, cree_le, test) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)')
                    ->execute([Ids::pid($email), $email, $prenom, $nom, self::COULEURS[$i % count(self::COULEURS)], 'actif', $now, Config::CONSENT_VERSION, $now]);
                $id = (int) $pdo->lastInsertId();
                $ids[$cle] = $id;
                foreach ($roles as [$role, $niveau]) {
                    Attributions::ajouter($pdo, $id, $role, $niveau === 'etab' ? $etab : null, $niveau === 'promo' ? $promo : null, 'admin');
                }
                if ($groupe !== null) {
                    Membres::ajouter($pdo, $groupes[$groupe], $promo, $id);
                }
            }
            // Une personne qui attend la validation de son accès : de quoi essayer l'écran « À traiter » avec un compte administrateur de test.
            $pdo->prepare('INSERT INTO utilisateurs (pid, email, prenom, nom, couleur, statut, demande_le, cree_le, test) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)')
                ->execute([Ids::pid('demande' . self::DOMAINE), 'demande' . self::DOMAINE, 'Eli', 'Attente', '#888888', 'en_attente', $now, $now]);
            $pdo->prepare('INSERT INTO demandes_acces (utilisateur_id, etablissement_id, promo_id, role, prenom, nom, statut, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
                ->execute([(int) $pdo->lastInsertId(), $etab, $promo, 'etudiant', 'Eli', 'Attente', 'en_attente', $now]);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        self::exemples($c, $ids, $groupes, $promo);
    }

    /** @param list<string> $groupes */
    private static function vider(\PDO $pdo): void
    {
        $pdo->exec('DELETE FROM articles WHERE groupe_id IN (SELECT g.id FROM groupes g JOIN promos p ON p.id = g.promo_id JOIN etablissements e ON e.id = p.etablissement_id WHERE e.test = 1)');
        $pdo->exec('DELETE FROM etablissements WHERE test = 1');
        $pdo->exec('DELETE FROM utilisateurs WHERE test = 1');
    }

    /**
     * Quelques lectures, commentaires, un jalon, une réunion, un terme et une proposition de lecture, créés par les comptes de test eux-mêmes
     * (donc avec les vraies règles de l'application). Un échec ici ne doit pas empêcher d'utiliser le bac à sable.
     *
     * @param array<string,int> $ids
     * @param list<string> $groupes
     */
    private static function exemples(Contexte $c, array $ids, array $groupes, string $promo): void
    {
        $ctx = static function (string $cle) use ($c, $ids): Contexte {
            $u = Utilisateurs::parId($c->db->principale(), $ids[$cle]);
            return new Contexte($c->config, $c->db, $u ?? $c->user);
        };
        $art = ['titre' => 'L’autonomie en soins infirmiers', 'parution' => '2020', 'auteur' => 'Dupont', 'qualite' => 'Infirmière', 'nation' => 'Française',
            'type' => 'Article scientifique', 'source' => 'Revue de soins', 'mots' => 'Autonomie, Responsabilité', 'kw' => 'Autonomy, Responsibility',
            'concepts' => 'Autonomie', 'objet' => 'Définition du concept d’autonomie.', 'opinion' => 'Un article clair et utile.', 'controverse' => '', 'libre' => ''];
        try {
            $fa = Lectures::ajouter($ctx('etudiante_a'), $art + ['statut' => 'Terminée', 'groupe_id' => $groupes[0]]);
            Lectures::ajouter($ctx('etudiant_b'), ['article_id' => self::articleDe($c, $fa), 'statut' => 'Terminée', 'mots' => 'Autonomie', 'objet' => 'Mon point de vue.', 'opinion' => 'Intéressant.']);
            Commentaires::ajouter($ctx('etudiant_b'), $fa, 'Super fiche, merci !', 'groupe');
            Lectures::ajouter($ctx('etudiante_a'), ['statut' => 'En cours', 'groupe_id' => $groupes[0], 'titre' => 'La relation de soin', 'auteur' => 'Martin', 'parution' => '2018', 'type' => 'Article professionnel']);
            Lectures::ajouter($ctx('etudiante_c'), ['statut' => 'À lire', 'groupe_id' => $groupes[1], 'titre' => 'Éthique et fin de vie', 'auteur' => 'Durand', 'parution' => '2022', 'type' => 'Revue de littérature']);
            Suivi::enregistrer($ctx('etudiante_a'), 'jalon', $groupes[0], null, ['titre' => 'Remettre la problématique', 'type' => 'echeance', 'echeance' => gmdate('Y-m-d', time() + 14 * 86400), 'statut' => 'a_faire']);
            Suivi::enregistrer($ctx('etudiante_a'), 'reunion', $groupes[0], null, ['date' => gmdate('Y-m-d'), 'titre' => 'Premier point', 'participants' => 'Ana, Ben', 'vu' => 'Choix du sujet', 'attendu' => 'Plan détaillé', 'suite' => 'Chercher des articles']);
            Suivi::enregistrer($ctx('etudiante_a'), 'terme', $groupes[0], null, ['mot' => 'Autonomie', 'definition' => 'Capacité à décider pour soi-même.', 'reference' => 'Dupont (2020)']);
            Suggestions::enregistrer($ctx('formateur'), null, ['promo_id' => $promo, 'titre' => 'Prendre soin : une approche relationnelle', 'auteur' => 'Lefèvre', 'parution' => '2021', 'type' => 'Article scientifique',
                'note' => 'À lire avant la prochaine réunion.', 'groupes' => [$groupes[1]]]);
        } catch (\Throwable $e) {
            error_log('Bac à sable : données d’exemple incomplètes : ' . $e->getMessage());
        }
    }

    private static function articleDe(Contexte $c, string $ficheId): string
    {
        $st = $c->db->principale()->prepare('SELECT article_id FROM analyses WHERE id = ?');
        $st->execute([$ficheId]);
        return (string) $st->fetchColumn();
    }
}
