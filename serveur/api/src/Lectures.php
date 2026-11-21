<?php
declare(strict_types=1);

namespace Lpc;

/**
 * Lectures : un article (partie objective, commune à la promo) porte une analyse par étudiante (sa fiche de lecture).
 *
 *  - Une fiche « Terminée » est partagée avec toute la promo (portee « promo »), sinon elle reste dans le groupe.
 *  - La fiche n'est modifiable que par son autrice ; l'article, par toute étudiante de la promo, directement s'il est neuf
 *    et qu'elle en est la créatrice isolée (ou si elle administre la promo), sinon par une proposition validée à 3 approbations.
 *  - Un article sans plus aucune fiche disparaît. Toute modification de fiche ou d'article est historisée.
 */
final class Lectures
{
    public const OBJECTIFS = ['titre', 'parution', 'auteur', 'qualite', 'nation', 'type', 'source', 'volume', 'numero', 'pages', 'doi', 'lien'];
    public const ANALYSES = ['statut', 'mots', 'kw', 'concepts', 'objet', 'opinion', 'controverse', 'libre', 'priorite'];
    public const CHAMPS = ['statut', 'titre', 'parution', 'auteur', 'qualite', 'nation', 'type', 'mots', 'kw', 'concepts', 'objet', 'opinion',
        'controverse', 'libre', 'source', 'volume', 'numero', 'pages', 'doi', 'lien', 'priorite'];
    public const STATUTS = ['Terminée', 'En cours', 'À lire'];
    public const PRIORITES = ['haute', 'normale', 'basse'];
    public const TYPES = ['Article scientifique', 'Article de recherche', 'Revue de littérature', 'Article professionnel',
        'Rapport / recommandation HAS', 'Thèse / mémoire', 'Autre'];
    public const OBLIGATOIRES_TERMINEE = ['titre', 'parution', 'auteur', 'qualite', 'nation', 'type'];
    public const LIBELLES = ['titre' => 'titre', 'parution' => 'date de parution', 'auteur' => 'auteur', 'qualite' => 'qualité',
        'nation' => 'nationalité', 'type' => 'type d’article'];
    public const LONGUEUR_MAX = 2500;
    public const PROP_SEUIL = 3;
    public const PROP_DUREE_S = 14 * 86400;
    public const HISTORIQUE_MAX = 30;

    /** Largeur des colonnes courtes de la base : au-delà, la valeur serait refusée par le mode strict. */
    private const LARGEURS = ['titre' => 500, 'parution' => 20, 'qualite' => 80, 'nation' => 80, 'type' => 80, 'source' => 500,
        'volume' => 40, 'numero' => 40, 'pages' => 40, 'doi' => 190];
    private const ACCENTS = ['à' => 'a', 'á' => 'a', 'â' => 'a', 'ä' => 'a', 'ã' => 'a', 'å' => 'a', 'ç' => 'c', 'è' => 'e', 'é' => 'e',
        'ê' => 'e', 'ë' => 'e', 'ì' => 'i', 'í' => 'i', 'î' => 'i', 'ï' => 'i', 'ñ' => 'n', 'ò' => 'o', 'ó' => 'o', 'ô' => 'o', 'ö' => 'o',
        'õ' => 'o', 'ù' => 'u', 'ú' => 'u', 'û' => 'u', 'ü' => 'u', 'ý' => 'y', 'ÿ' => 'y', 'œ' => 'oe', 'æ' => 'ae'];

    // ---------- Saisie ----------

    /**
     * Valeurs saisies, nettoyées. La priorité n'a de sens que dans la file d'attente (« À lire »).
     *
     * @return array<string,string>
     */
    public static function nettoyer(mixed $data): array
    {
        if (!is_array($data)) {
            throw new Erreur('invalid', 'Données manquantes');
        }
        $d = [];
        foreach (self::CHAMPS as $c) {
            $v = array_key_exists($c, $data) && is_scalar($data[$c]) ? trim((string) $data[$c]) : '';
            $max = min(self::LONGUEUR_MAX, self::LARGEURS[$c] ?? self::LONGUEUR_MAX);
            if (mb_strlen($v) > $max) {
                throw new Erreur('invalid', 'Champ trop long (' . $max . ' caractères maximum)');
            }
            $d[$c] = $v;
        }
        $d['priorite'] = $d['statut'] === 'À lire' ? ($d['priorite'] !== '' ? $d['priorite'] : 'normale') : '';
        return $d;
    }

    /** @param array<string,mixed> $d */
    public static function valider(array $d): void
    {
        $statut = (string) ($d['statut'] ?? '');
        if (!in_array($statut, self::STATUTS, true)) {
            throw new Erreur('invalid', 'Statut invalide');
        }
        $priorite = (string) ($d['priorite'] ?? '');
        if ($priorite !== '' && !in_array($priorite, self::PRIORITES, true)) {
            throw new Erreur('invalid', 'Priorité invalide');
        }
        $manquants = [];
        foreach ($statut === 'Terminée' ? self::OBLIGATOIRES_TERMINEE : ['titre'] as $k) {
            if ((string) ($d[$k] ?? '') === '') {
                $manquants[] = self::LIBELLES[$k];
            }
        }
        if ($manquants !== []) {
            throw new Erreur('invalid', 'À compléter : ' . implode(', ', $manquants));
        }
        $type = (string) ($d['type'] ?? '');
        if ($type !== '' && !in_array($type, self::TYPES, true)) {
            throw new Erreur('invalid', 'Type d’article invalide');
        }
        $parution = (string) ($d['parution'] ?? '');
        if ($parution !== '' && preg_match('/^\d{4}(-\d{2}(-\d{2})?)?$/', $parution) !== 1) {
            throw new Erreur('invalid', 'Date de parution invalide');
        }
        // Le lien est cliquable dans l'application : seuls http(s) sont acceptés (jamais javascript:, data:, etc.).
        $lien = (string) ($d['lien'] ?? '');
        if ($lien !== '' && preg_match('#^https?://[^\s<>"\']+$#i', $lien) !== 1) {
            throw new Erreur('invalid', 'Lien invalide : il doit commencer par http:// ou https://');
        }
    }

    public static function porteeDe(string $statut): string
    {
        return $statut === 'Terminée' ? 'promo' : 'groupe';
    }

    /** Minuscules, sans accents, signes remplacés par des espaces : sert à comparer deux titres. */
    public static function normaliser(string $t): string
    {
        return trim((string) preg_replace('/[^a-z0-9]+/', ' ', strtr(mb_strtolower($t), self::ACCENTS)));
    }

    public static function cleDoi(string $d): string
    {
        $d = mb_strtolower(trim($d));
        $d = (string) preg_replace('#^(https?://)?(dx\.)?doi\.org/#', '', $d);
        return (string) preg_replace('/^doi:\s*/', '', $d);
    }

    /** Deux fiches décrivent le même article : même DOI, ou (sans DOI différents) même titre d'au moins 8 caractères. @param array<string,mixed> $a @param array<string,mixed> $b */
    public static function memeArticle(array $a, array $b): bool
    {
        $da = self::cleDoi((string) ($a['doi'] ?? ''));
        $db = self::cleDoi((string) ($b['doi'] ?? ''));
        if ($da !== '' && $db !== '') {
            return $da === $db;
        }
        $ta = self::normaliser((string) ($a['titre'] ?? ''));
        return mb_strlen($ta) >= 8 && $ta === self::normaliser((string) ($b['titre'] ?? ''));
    }

    // ---------- Droits ----------

    public static function exigerEtudiant(Contexte $c): void
    {
        if (!$c->droits()->estEtudiant()) {
            throw new Erreur('forbidden', 'Accès en lecture seule');
        }
    }

    /** Étudiante ou formateur : peut commenter. */
    public static function peutCommenter(Contexte $c): bool
    {
        return $c->droits()->estEtudiant() || $c->droits()->etablissementsFormateur() !== [];
    }

    /**
     * Promos dont la personne lit les fiches partagées : celles où elle est étudiante, celles de ses établissements de formateur,
     * celles de ses groupes et celles qu'elle administre.
     *
     * @return list<string>
     */
    public static function promosLecture(Contexte $c): array
    {
        $d = $c->droits();
        $pdo = $c->db->principale();
        $ids = $d->promosEtudiant();
        $etabs = $d->etablissementsFormateur();
        if ($etabs !== []) {
            $st = $pdo->prepare('SELECT id FROM promos WHERE etablissement_id IN (' . self::marques(count($etabs)) . ')');
            $st->execute($etabs);
            array_push($ids, ...array_map('strval', $st->fetchAll(\PDO::FETCH_COLUMN)));
        }
        $st = $pdo->prepare('SELECT DISTINCT g.promo_id FROM membres m JOIN groupes g ON g.id = m.groupe_id WHERE m.utilisateur_id = ?');
        $st->execute([$c->user->id]);
        array_push($ids, ...array_map('strval', $st->fetchAll(\PDO::FETCH_COLUMN)));
        $adm = $d->promosAdministrees();
        if ($adm !== null) {
            array_push($ids, ...$adm);
        }
        return array_values(array_unique($ids));
    }

    /**
     * Condition SQL « la personne voit cette analyse » : celles de ses groupes (ou des groupes qu'elle administre), et les fiches
     * partagées avec la promo des promos qu'elle lit. L'admin global voit tout. Les alias sont ceux de analyses et de groupes.
     *
     * @return array{0:string,1:list<mixed>}
     */
    public static function filtreVisible(Contexte $c, string $a = 'a', string $g = 'g'): array
    {
        // Une fiche « À lire » (file d'attente personnelle) n'est visible que de l'étudiant concerné, même en vue de groupe et même pour un administrateur.
        $prive = "($a.statut <> 'À lire' OR $a.utilisateur_id = ?)";
        $moi = (int) $c->user->id;
        if ($c->droits()->estAdmin()) {
            return [$prive, [$moi]];
        }
        $conds = [];
        $params = [];
        $gids = Donnees::idsGroupesVisibles($c);
        if ($gids !== []) {
            $conds[] = "$a.groupe_id IN (" . self::marques(count($gids)) . ')';
            array_push($params, ...$gids);
        }
        $promos = self::promosLecture($c);
        if ($promos !== []) {
            $conds[] = "($a.portee = 'promo' AND $g.promo_id IN (" . self::marques(count($promos)) . '))';
            array_push($params, ...$promos);
        }
        return $conds === [] ? ['1 = 0', []] : ['(' . implode(' OR ', $conds) . ') AND ' . $prive, [...$params, $moi]];
    }

    /** @return array<string,mixed>|null l'article avec la promo de son groupe, texte « '' » pour les valeurs absentes */
    public static function article(\PDO $pdo, string $id): ?array
    {
        $st = $pdo->prepare('SELECT r.*, g.promo_id FROM articles r LEFT JOIN groupes g ON g.id = r.groupe_id WHERE r.id = ?');
        $st->execute([$id]);
        $r = $st->fetch();
        if ($r === false) {
            return null;
        }
        foreach (self::OBJECTIFS as $k) {
            $r[$k] = (string) ($r[$k] ?? '');
        }
        return $r;
    }

    /** L'article, s'il existe et si la personne voit au moins une de ses fiches (l'admin global le voit toujours). @return array<string,mixed> */
    public static function articleVisible(Contexte $c, string $id): array
    {
        $pdo = $c->db->principale();
        $a = self::article($pdo, $id);
        if ($a === null || $a['promo_id'] === null) {
            throw new Erreur('not_found', 'Article introuvable');
        }
        if (!$c->droits()->estAdmin()) {
            [$where, $params] = self::filtreVisible($c);
            $st = $pdo->prepare("SELECT COUNT(*) FROM analyses a JOIN groupes g ON g.id = a.groupe_id WHERE a.article_id = ? AND $where");
            $st->execute([$id, ...$params]);
            if ((int) $st->fetchColumn() === 0) {
                throw new Erreur('not_found', 'Article introuvable');
            }
        }
        return $a;
    }

    /** @param array<string,mixed> $article */
    public static function articleModifiable(Contexte $c, array $article): bool
    {
        return $article['promo_id'] !== null && $c->droits()->estEtudiantDans((string) $article['promo_id']);
    }

    // ---------- Fiches ----------

    /**
     * Ajoute SA fiche : à un article existant (data.article_id : les champs objectifs ne comblent que les vides) ou en créant l'article
     * (avec détection des doublons dans la promo, sauf data.nouveau = true).
     *
     * @return string identifiant de la fiche
     */
    public static function ajouter(Contexte $c, mixed $data): string
    {
        self::exigerEtudiant($c);
        $pdo = $c->db->principale();
        $d = self::nettoyer($data);
        /** @var array<string,mixed> $data */
        $uid = (int) $c->user->id;
        $now = Temps::maintenant();

        if (!empty($data['article_id'])) {
            $art = self::articleVisible($c, (string) $data['article_id']);
            $gid = self::groupeDansPromo($c, (string) $art['promo_id']);
            $st = $pdo->prepare('SELECT 1 FROM analyses WHERE article_id = ? AND utilisateur_id = ?');
            $st->execute([$art['id'], $uid]);
            if ($st->fetchColumn() !== false) {
                throw new Erreur('invalid', 'Vous avez déjà une fiche de lecture pour cet article');
            }
            $fusion = [];
            foreach (self::OBJECTIFS as $k) {
                $fusion[$k] = $art[$k] !== '' ? $art[$k] : $d[$k];
            }
            self::valider(array_merge($d, $fusion));
            if (array_filter(self::OBJECTIFS, static fn (string $k): bool => $fusion[$k] !== $art[$k]) !== []) {
                self::ecrireArticle($pdo, $art, $fusion, $uid, $now);
            }
            $articleId = (string) $art['id'];
        } else {
            $gid = self::groupeParDefaut($c, $data['groupe_id'] ?? null);
            $promo = (string) $c->droits()->promoDeGroupe($gid);
            self::valider($d);
            if (($data['nouveau'] ?? null) !== true) {
                self::refuserDoublon($c, $promo, $d);
            }
            $articleId = Ids::uuid();
            $colonnes = implode(', ', self::OBJECTIFS);
            $marques = self::marques(count(self::OBJECTIFS));
            $pdo->prepare("INSERT INTO articles (id, cree_par, groupe_id, ajoute, $colonnes) VALUES (?, ?, ?, ?, $marques)")
                ->execute([$articleId, $uid, $gid, $now, ...array_map(static fn (string $k): string => $d[$k], self::OBJECTIFS)]);
        }

        $id = Ids::uuid();
        $pdo->prepare(
            'INSERT INTO analyses (id, article_id, utilisateur_id, groupe_id, statut, priorite, mots, kw, concepts, objet, opinion, controverse, libre, portee, ajoute)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )->execute([$id, $articleId, $uid, $gid, $d['statut'], $d['priorite'] !== '' ? $d['priorite'] : 'normale', $d['mots'], $d['kw'], $d['concepts'],
            $d['objet'], $d['opinion'], $d['controverse'], $d['libre'], self::porteeDe($d['statut']), $now]);
        return $id;
    }

    /** Modifie sa fiche et, si les champs objectifs sont fournis, la partie objective de l'article (directement ou par proposition). */
    public static function modifier(Contexte $c, string $id, mixed $data): void
    {
        self::exigerEtudiant($c);
        $pdo = $c->db->principale();
        $a = self::analyse($pdo, $id);
        if ($a === null) {
            throw new Erreur('not_found', 'Lecture introuvable');
        }
        $uid = (int) $c->user->id;
        if ($a['groupe_id'] === null || !Membres::estMembre($pdo, (string) $a['groupe_id'], $uid)) {
            throw new Erreur('forbidden', 'Vous ne faites pas partie de ce groupe');
        }
        if ($a['utilisateur_id'] === null || (int) $a['utilisateur_id'] !== $uid) {
            throw new Erreur('not_owner', 'Cette lecture appartient à quelqu’un d’autre');
        }
        $art = self::article($pdo, (string) $a['article_id']);
        if ($art === null) {
            throw new Erreur('not_found', 'Article introuvable');
        }
        $d = self::nettoyer($data);
        /** @var array<string,mixed> $data */
        $voulu = [];
        foreach (self::OBJECTIFS as $k) {
            $voulu[$k] = array_key_exists($k, $data) ? $d[$k] : $art[$k];
        }
        $change = array_filter(self::OBJECTIFS, static fn (string $k): bool => $voulu[$k] !== $art[$k]) !== [];
        $direct = !$change || self::modifDirecte($c, $art);
        $obj = $direct ? $voulu : array_intersect_key($art, array_flip(self::OBJECTIFS));
        self::valider(array_merge($d, $obj));
        $now = Temps::maintenant();

        $pdo->beginTransaction();
        try {
            if ($change && $direct) {
                self::validerArticleTerminees($pdo, (string) $art['id'], $obj, $id);
                self::ecrireArticle($pdo, $art, $obj, $uid, $now);
            } elseif ($change) {
                self::validerArticleTerminees($pdo, (string) $art['id'], $voulu, $id);
                self::proposer($pdo, $art, $voulu, $uid, $now);
            }
            $avant = self::valeursAnalyse($a);
            if (array_filter(self::ANALYSES, static fn (string $k): bool => $avant[$k] !== $d[$k]) !== []) {
                self::historiser($pdo, 'analyse', $id, $uid, $a['utilisateur_id'] === null ? null : (int) $a['utilisateur_id'], $avant, $now);
            }
            $pdo->prepare(
                'UPDATE analyses SET statut = ?, priorite = ?, mots = ?, kw = ?, concepts = ?, objet = ?, opinion = ?, controverse = ?, libre = ?,
                        portee = ?, modifie_le = ?, modifie_par = ? WHERE id = ?'
            )->execute([$d['statut'], $d['priorite'] !== '' ? $d['priorite'] : 'normale', $d['mots'], $d['kw'], $d['concepts'], $d['objet'], $d['opinion'],
                $d['controverse'], $d['libre'], self::porteeDe($d['statut']), $now, $uid, $id]);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
    }

    /** Correction de la partie objective : directe pour l'admin de la promo ou la créatrice isolée, sinon proposition à valider. */
    public static function modifierArticle(Contexte $c, string $articleId, mixed $data): void
    {
        $pdo = $c->db->principale();
        $art = self::articleVisible($c, $articleId);
        $d = $c->droits();
        $admin = $d->peutAdministrerPromo((string) $art['promo_id']);
        if (!$admin && !$d->estEtudiant()) {
            throw new Erreur('forbidden', 'Accès en lecture seule');
        }
        if (!$admin && !self::articleModifiable($c, $art)) {
            throw new Erreur('forbidden', 'Réservé aux étudiantes de la promo');
        }
        $dn = self::nettoyer($data);
        /** @var array<string,mixed> $data */
        $obj = [];
        foreach (self::OBJECTIFS as $k) {
            $obj[$k] = array_key_exists($k, $data) ? $dn[$k] : $art[$k];
        }
        if (array_filter(self::OBJECTIFS, static fn (string $k): bool => $obj[$k] !== $art[$k]) === []) {
            throw new Erreur('invalid', 'Aucune modification');
        }
        $pdo->beginTransaction();
        try {
            self::validerArticleTerminees($pdo, (string) $art['id'], $obj, '');
            $uid = (int) $c->user->id;
            $now = Temps::maintenant();
            if (self::modifDirecte($c, $art)) {
                self::ecrireArticle($pdo, $art, $obj, $uid, $now);
            } else {
                self::proposer($pdo, $art, $obj, $uid, $now);
            }
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
    }

    /** Supprime sa fiche, ses commentaires et son historique ; un article sans plus aucune fiche disparaît avec ses pièces jointes. */
    public static function supprimer(Contexte $c, string $id): void
    {
        self::exigerEtudiant($c);
        $pdo = $c->db->principale();
        $a = self::analyse($pdo, $id);
        if ($a === null) {
            throw new Erreur('not_found', 'Lecture introuvable');
        }
        $uid = (int) $c->user->id;
        if ($a['utilisateur_id'] === null || (int) $a['utilisateur_id'] !== $uid) {
            throw new Erreur('not_owner', 'Seul le propriétaire peut supprimer une lecture');
        }
        if ($a['groupe_id'] === null || !Membres::estMembre($pdo, (string) $a['groupe_id'], $uid)) {
            throw new Erreur('forbidden', 'Vous ne faites pas partie de ce groupe');
        }
        $pdo->beginTransaction();
        try {
            $pdo->prepare('DELETE FROM analyses WHERE id = ?')->execute([$id]);   // commentaires et « lus » suivent (CASCADE)
            $pdo->prepare("DELETE FROM historique WHERE cible = 'analyse' AND cible_id = ?")->execute([$id]);
            $st = $pdo->prepare('SELECT 1 FROM analyses WHERE article_id = ?');
            $st->execute([$a['article_id']]);
            if ($st->fetchColumn() === false) {
                Fichiers::retirerFichiersArticle($c, $pdo, (string) $a['article_id']);
                $pdo->prepare("DELETE FROM historique WHERE cible = 'article' AND cible_id = ?")->execute([$a['article_id']]);
                $pdo->prepare('DELETE FROM articles WHERE id = ?')->execute([$a['article_id']]);
            } else {
                // L'article reste : si c'était son créateur, la propriété passe à l'autrice de la plus ancienne fiche restante.
                $st = $pdo->prepare('SELECT cree_par FROM articles WHERE id = ?');
                $st->execute([$a['article_id']]);
                $createur = $st->fetchColumn();
                if ($createur !== false && $createur !== null && (int) $createur === $uid) {
                    $st = $pdo->prepare('SELECT utilisateur_id FROM analyses WHERE article_id = ? AND utilisateur_id IS NOT NULL ORDER BY ajoute, id LIMIT 1');
                    $st->execute([$a['article_id']]);
                    $suivante = $st->fetchColumn();
                    $pdo->prepare('UPDATE articles SET cree_par = ? WHERE id = ?')->execute([$suivante === false ? null : (int) $suivante, $a['article_id']]);
                }
            }
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
    }

    // ---------- Propositions de correction ----------

    public static function cloreExpirees(\PDO $pdo): void
    {
        $pdo->prepare("UPDATE propositions SET statut = 'expire', clos_le = ? WHERE statut = 'ouvert' AND cree_le <= ?")
            ->execute([Temps::maintenant(), Temps::depuis(-self::PROP_DUREE_S)]);
    }

    /** Vote d'une étudiante de la promo : adoptée à 3 approbations, refusée à 3 refus. */
    public static function voter(Contexte $c, string $id, bool $oui): void
    {
        self::exigerEtudiant($c);
        $pdo = $c->db->principale();
        self::cloreExpirees($pdo);
        $st = $pdo->prepare('SELECT id, article_id, propose_par, valeurs, statut FROM propositions WHERE id = ?');
        $st->execute([$id]);
        $p = $st->fetch();
        if ($p === false) {
            throw new Erreur('not_found', 'Proposition introuvable');
        }
        if ($p['statut'] !== 'ouvert') {
            throw new Erreur('invalid', 'Cette proposition est close');
        }
        $art = self::articleVisible($c, (string) $p['article_id']);
        if (!self::articleModifiable($c, $art)) {
            throw new Erreur('forbidden', 'Réservé aux étudiantes de la promo');
        }
        $uid = (int) $c->user->id;
        if ($p['propose_par'] !== null && (int) $p['propose_par'] === $uid && !$oui) {
            throw new Erreur('invalid', 'Annulez votre proposition plutôt que la refuser');
        }
        $now = Temps::maintenant();
        $pdo->beginTransaction();
        try {
            $pdo->prepare('DELETE FROM proposition_votes WHERE proposition_id = ? AND utilisateur_id = ?')->execute([$id, $uid]);
            $pdo->prepare('INSERT INTO proposition_votes (proposition_id, utilisateur_id, oui, vote_le) VALUES (?, ?, ?, ?)')->execute([$id, $uid, $oui ? 1 : 0, $now]);
            [$pour, $contre] = self::compter($pdo, $id, (string) $art['promo_id']);
            $statut = $pour >= self::PROP_SEUIL ? 'adopte' : ($contre >= self::PROP_SEUIL ? 'refuse' : 'ouvert');
            if ($statut === 'adopte') {
                $valeurs = json_decode((string) $p['valeurs'], true);
                $valeurs = is_array($valeurs) ? $valeurs : [];
                // Si l'article est devenu incomplet entre-temps, la proposition ne peut pas être appliquée : le vote n'est pas enregistré.
                self::validerArticleTerminees($pdo, (string) $art['id'], $valeurs, '');
                self::ecrireArticle($pdo, $art, array_merge(array_intersect_key($art, array_flip(self::OBJECTIFS)), $valeurs), $uid, $now);
            }
            if ($statut !== 'ouvert') {
                $pdo->prepare('UPDATE propositions SET statut = ?, clos_le = ? WHERE id = ?')->execute([$statut, $now, $id]);
            }
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
    }

    /** L'autrice d'une proposition l'annule ; un admin de la promo aussi. */
    public static function annulerProposition(Contexte $c, string $id): void
    {
        $pdo = $c->db->principale();
        $st = $pdo->prepare('SELECT p.id, p.propose_par, p.statut, g.promo_id FROM propositions p
                             JOIN articles r ON r.id = p.article_id LEFT JOIN groupes g ON g.id = r.groupe_id WHERE p.id = ?');
        $st->execute([$id]);
        $p = $st->fetch();
        if ($p === false) {
            throw new Erreur('not_found', 'Proposition introuvable');
        }
        $auteur = $p['propose_par'] !== null && (int) $p['propose_par'] === $c->user->id;
        $admin = $p['promo_id'] !== null && $c->droits()->peutAdministrerPromo((string) $p['promo_id']);
        if (!$auteur && !$admin) {
            throw new Erreur('forbidden', 'Seule l’autrice peut annuler');
        }
        if ($p['statut'] !== 'ouvert') {
            throw new Erreur('invalid', 'Cette proposition est close');
        }
        $pdo->prepare("UPDATE propositions SET statut = 'annule', clos_le = ? WHERE id = ?")->execute([Temps::maintenant(), $id]);
    }

    // ---------- Sections renvoyées au client ----------

    /** Fiches que la personne voit, avec la partie objective de leur article. @return list<array<string,mixed>> */
    public static function lister(Contexte $c): array
    {
        if ($c->user->id === null) {
            return [];
        }
        $pdo = $c->db->principale();
        [$where, $params] = self::filtreVisible($c);
        $st = $pdo->prepare(
            "SELECT a.id, a.article_id, a.utilisateur_id, a.groupe_id, a.statut, a.priorite, a.mots, a.kw, a.concepts, a.objet, a.opinion,
                    a.controverse, a.libre, a.portee, a.ajoute, a.modifie_le AS a_modifie_le, a.modifie_par AS a_modifie_par,
                    r.titre, r.parution, r.auteur, r.qualite, r.nation, r.type, r.source, r.volume, r.numero, r.pages, r.doi, r.lien,
                    r.modifie_le AS r_modifie_le, r.modifie_par AS r_modifie_par,
                    g.nom AS groupe, g.promo_id, p.nom AS promo, e.nom AS etab, u.prenom, u.nom AS u_nom, u.pseudo, u.couleur
             FROM analyses a JOIN articles r ON r.id = a.article_id JOIN groupes g ON g.id = a.groupe_id
             JOIN promos p ON p.id = g.promo_id JOIN etablissements e ON e.id = p.etablissement_id
             LEFT JOIN utilisateurs u ON u.id = a.utilisateur_id
             WHERE $where ORDER BY a.ajoute, a.id"
        );
        $st->execute($params);
        $lignes = $st->fetchAll();
        $noms = self::noms($pdo, array_merge(array_column($lignes, 'a_modifie_par'), array_column($lignes, 'r_modifie_par')));
        $etudiant = $c->droits()->estEtudiant();
        $uid = $c->user->id;
        $out = [];
        foreach ($lignes as $r) {
            $apresArticle = (string) ($r['r_modifie_le'] ?? '') > (string) ($r['a_modifie_le'] ?? '');
            $modLe = $apresArticle ? $r['r_modifie_le'] : $r['a_modifie_le'];
            $modPar = $apresArticle ? $r['r_modifie_par'] : $r['a_modifie_par'];
            $pub = [
                'id' => (string) $r['id'], 'statut' => (string) $r['statut'],
                'mots' => (string) ($r['mots'] ?? ''), 'kw' => (string) ($r['kw'] ?? ''), 'concepts' => (string) ($r['concepts'] ?? ''),
                'objet' => (string) ($r['objet'] ?? ''), 'opinion' => (string) ($r['opinion'] ?? ''),
                'controverse' => (string) ($r['controverse'] ?? ''), 'libre' => (string) ($r['libre'] ?? ''),
                'ajoute' => Temps::iso((string) $r['ajoute']), 'modifie_le' => Temps::iso($modLe === null ? null : (string) $modLe),
                'modifie_par' => $modPar === null ? '' : ($noms[(int) $modPar] ?? ''),
                'groupe_id' => (string) $r['groupe_id'], 'portee' => self::porteeDe((string) $r['statut']), 'article_id' => (string) $r['article_id'],
                'priorite' => $r['statut'] === 'À lire' ? (string) $r['priorite'] : '',
                'etudiant' => $r['prenom'] === null ? 'Utilisateur supprimé'
                    : Utilisateur::nomAffiche((string) $r['prenom'], (string) $r['u_nom'], $r['pseudo'] === null ? null : (string) $r['pseudo']),
                'couleur' => $r['couleur'] === null ? Config::COULEUR_DEFAUT : (string) $r['couleur'],
                'mine' => $r['utilisateur_id'] !== null && (int) $r['utilisateur_id'] === $uid,
                'groupe' => (string) $r['groupe'], 'etablissement' => (string) $r['etab'], 'promo' => (string) $r['promo'],
                'modifiable' => $etudiant && $r['utilisateur_id'] !== null && (int) $r['utilisateur_id'] === $uid,
                'article_modifiable' => $c->droits()->estEtudiantDans((string) $r['promo_id']),
            ];
            foreach (self::OBJECTIFS as $k) {
                $pub[$k] = (string) ($r[$k] ?? '');
            }
            $out[] = $pub;
        }
        return $out;
    }

    /** Propositions de correction ouvertes sur les articles que la personne voit (identifiants publics, jamais d'adresses). @return list<array<string,mixed>> */
    public static function propositionsPourClient(Contexte $c): array
    {
        if ($c->user->id === null) {
            return [];
        }
        $pdo = $c->db->principale();
        self::cloreExpirees($pdo);
        [$where, $params] = self::filtreVisible($c);
        $st = $pdo->prepare(
            "SELECT p.id, p.article_id, p.propose_par, p.cree_le, p.valeurs, u.prenom, u.nom, u.pseudo, g.promo_id
             FROM propositions p JOIN utilisateurs u ON u.id = p.propose_par
             JOIN articles r ON r.id = p.article_id JOIN groupes g ON g.id = r.groupe_id
             WHERE p.statut = 'ouvert' AND p.article_id IN (SELECT a.article_id FROM analyses a JOIN groupes g ON g.id = a.groupe_id WHERE $where)
             ORDER BY p.cree_le, p.id"
        );
        $st->execute($params);
        $out = [];
        foreach ($st->fetchAll() as $p) {
            [$pour, $contre] = self::compter($pdo, (string) $p['id'], (string) $p['promo_id']);
            $s = $pdo->prepare('SELECT oui FROM proposition_votes WHERE proposition_id = ? AND utilisateur_id = ?');
            $s->execute([$p['id'], $c->user->id]);
            $mon = $s->fetchColumn();
            $valeurs = json_decode((string) $p['valeurs'], true);
            $out[] = [
                'id' => (string) $p['id'], 'article_id' => (string) $p['article_id'], 'par' => Membres::affiche($p),
                'cree_le' => Temps::iso((string) $p['cree_le']), 'valeurs' => is_array($valeurs) ? $valeurs : [],
                'pour' => $pour, 'contre' => $contre, 'seuil' => self::PROP_SEUIL,
                'mine' => (int) $p['propose_par'] === $c->user->id, 'monVote' => $mon === false ? -1 : ((int) $mon === 1 ? 1 : 0),
            ];
        }
        return $out;
    }

    /**
     * Versions successives d'un article ou d'une fiche, de la plus récente à la plus ancienne : qui a modifié, quand, ce qui a changé,
     * et « valeurs » (la version d'avant) que le client renvoie pour la restaurer par les mêmes actions (donc les mêmes règles).
     *
     * @return list<array<string,mixed>>
     */
    public static function historique(Contexte $c, string $kind, string $id): array
    {
        $pdo = $c->db->principale();
        if ($kind === 'article') {
            $actuel = self::articleVisible($c, $id);
            $champs = self::OBJECTIFS;
            $cible = 'article';
        } elseif ($kind === 'lecture') {
            [$where, $params] = self::filtreVisible($c);
            $st = $pdo->prepare("SELECT a.* FROM analyses a JOIN groupes g ON g.id = a.groupe_id WHERE a.id = ? AND $where");
            $st->execute([$id, ...$params]);
            $a = $st->fetch();
            if ($a === false) {
                throw new Erreur('not_found', 'Lecture introuvable');
            }
            $actuel = self::valeursAnalyse($a);
            $champs = self::ANALYSES;
            $cible = 'analyse';
        } else {
            throw new Erreur('invalid', 'Type inconnu');
        }
        $st = $pdo->prepare('SELECT modifie_par, avant, modifie_le FROM historique WHERE cible = ? AND cible_id = ? ORDER BY modifie_le, id');
        $st->execute([$cible, $id]);
        $rows = $st->fetchAll();
        $etats = array_map(static function (array $h): array {
            $e = json_decode((string) $h['avant'], true);
            return is_array($e) ? $e : [];
        }, $rows);
        $noms = self::noms($pdo, array_column($rows, 'modifie_par'));
        $sortie = [];
        foreach ($rows as $i => $h) {
            $apres = $etats[$i + 1] ?? $actuel;
            $diff = [];
            $valeurs = [];
            foreach ($champs as $k) {
                $av = (string) ($etats[$i][$k] ?? '');
                $ap = (string) ($apres[$k] ?? '');
                $valeurs[$k] = $av;
                if ($av !== $ap) {
                    $diff[] = ['k' => $k, 'avant' => $av, 'apres' => $ap];
                }
            }
            if ($diff !== []) {
                $sortie[] = ['date' => Temps::iso((string) $h['modifie_le']), 'par' => $h['modifie_par'] === null ? '' : ($noms[(int) $h['modifie_par']] ?? ''),
                    'champs' => $diff, 'valeurs' => $valeurs];
            }
        }
        return array_slice(array_reverse($sortie), 0, self::HISTORIQUE_MAX);
    }

    // ---------- Interne ----------

    /** @return array<string,mixed>|null */
    private static function analyse(\PDO $pdo, string $id): ?array
    {
        $st = $pdo->prepare('SELECT * FROM analyses WHERE id = ?');
        $st->execute([$id]);
        $r = $st->fetch();
        return $r === false ? null : $r;
    }

    /** Valeurs d'une analyse telles que le client les connaît (« priorité » vide hors de la file d'attente). @param array<string,mixed> $a @return array<string,string> */
    private static function valeursAnalyse(array $a): array
    {
        $v = [];
        foreach (self::ANALYSES as $k) {
            $v[$k] = (string) ($a[$k] ?? '');
        }
        $v['priorite'] = $v['statut'] === 'À lire' ? $v['priorite'] : '';
        return $v;
    }

    private static function groupeParDefaut(Contexte $c, mixed $demande): string
    {
        $pdo = $c->db->principale();
        $uid = (int) $c->user->id;
        $gid = is_string($demande) ? $demande : '';
        if ($gid !== '') {
            if (!Membres::estMembre($pdo, $gid, $uid)) {
                throw new Erreur('forbidden', 'Vous ne faites pas partie de ce groupe');
            }
            return $gid;
        }
        $st = $pdo->prepare('SELECT groupe_id FROM membres WHERE utilisateur_id = ?');
        $st->execute([$uid]);
        $mes = $st->fetchAll(\PDO::FETCH_COLUMN);
        if (count($mes) === 1) {
            return (string) $mes[0];
        }
        throw new Erreur('invalid', $mes === [] ? 'Vous ne faites encore partie d’aucun groupe' : 'Choisissez un groupe');
    }

    private static function groupeDansPromo(Contexte $c, string $promoId): string
    {
        $st = $c->db->principale()->prepare('SELECT g.id FROM membres m JOIN groupes g ON g.id = m.groupe_id WHERE m.utilisateur_id = ? AND g.promo_id = ? LIMIT 1');
        $st->execute([$c->user->id, $promoId]);
        $g = $st->fetchColumn();
        if ($g === false) {
            throw new Erreur('forbidden', 'Vous ne faites pas partie de cette promo');
        }
        return (string) $g;
    }

    /** @param array<string,string> $d */
    private static function refuserDoublon(Contexte $c, string $promo, array $d): void
    {
        $pdo = $c->db->principale();
        $st = $pdo->prepare('SELECT r.* FROM articles r JOIN groupes g ON g.id = r.groupe_id WHERE g.promo_id = ?');
        $st->execute([$promo]);
        [$where, $params] = self::filtreVisible($c);
        foreach ($st->fetchAll() as $x) {
            foreach (self::OBJECTIFS as $k) {
                $x[$k] = (string) ($x[$k] ?? '');
            }
            if (!self::memeArticle($x, $d)) {
                continue;
            }
            $s = $pdo->prepare(
                "SELECT a.statut, u.prenom, u.nom, u.pseudo FROM analyses a JOIN groupes g ON g.id = a.groupe_id
                 LEFT JOIN utilisateurs u ON u.id = a.utilisateur_id WHERE a.article_id = ? AND $where"
            );
            $s->execute([$x['id'], ...$params]);
            $lecteurs = [];
            foreach ($s->fetchAll() as $l) {
                $lecteurs[] = ['prenom' => $l['prenom'] === null ? '' : Membres::affiche($l), 'statut' => (string) $l['statut']];
            }
            if ($lecteurs !== []) {
                throw new Erreur('duplicate', 'Cet article existe déjà dans la promo : ajoutez-y plutôt votre fiche de lecture.',
                    ['article_id' => (string) $x['id'], 'titre' => $x['titre'], 'lecteurs' => $lecteurs]);
            }
        }
    }

    /** Correction directe : un admin de la promo, ou la créatrice de l'article tant qu'elle est seule à l'avoir analysé. @param array<string,mixed> $art */
    private static function modifDirecte(Contexte $c, array $art): bool
    {
        if ($art['promo_id'] !== null && $c->droits()->peutAdministrerPromo((string) $art['promo_id'])) {
            return true;
        }
        if ($art['cree_par'] === null || (int) $art['cree_par'] !== $c->user->id) {
            return false;
        }
        $st = $c->db->principale()->prepare('SELECT 1 FROM analyses WHERE article_id = ? AND (utilisateur_id IS NULL OR utilisateur_id <> ?)');
        $st->execute([$art['id'], $c->user->id]);
        return $st->fetchColumn() === false;
    }

    /** Si une fiche de l'article est terminée, les six champs obligatoires de l'article doivent rester renseignés. @param array<string,mixed> $obj */
    private static function validerArticleTerminees(\PDO $pdo, string $articleId, array $obj, string $sauf): void
    {
        $st = $pdo->prepare("SELECT 1 FROM analyses WHERE article_id = ? AND id <> ? AND statut = 'Terminée'");
        $st->execute([$articleId, $sauf]);
        self::valider(array_merge(['statut' => $st->fetchColumn() !== false ? 'Terminée' : 'En cours'], $obj));
    }

    /**
     * @param array<string,mixed> $art
     * @param array<string,mixed> $valeurs
     */
    private static function ecrireArticle(\PDO $pdo, array $art, array $valeurs, int $uid, string $now): void
    {
        $avant = [];
        foreach (self::OBJECTIFS as $k) {
            $avant[$k] = $art[$k];
        }
        self::historiser($pdo, 'article', (string) $art['id'], $uid, $art['cree_par'] === null ? null : (int) $art['cree_par'], $avant, $now);
        $sets = implode(', ', array_map(static fn (string $k): string => "$k = ?", self::OBJECTIFS));
        $pdo->prepare("UPDATE articles SET $sets, modifie_le = ?, modifie_par = ? WHERE id = ?")
            ->execute([...array_map(static fn (string $k): string => (string) $valeurs[$k], self::OBJECTIFS), $now, $uid, $art['id']]);
    }

    /** @param array<string,string> $avant */
    private static function historiser(\PDO $pdo, string $cible, string $id, int $modifiePar, ?int $proprietaire, array $avant, string $now): void
    {
        $pdo->prepare('INSERT INTO historique (cible, cible_id, modifie_par, proprietaire, avant, modifie_le) VALUES (?, ?, ?, ?, ?, ?)')
            ->execute([$cible, $id, $modifiePar, $proprietaire, json_encode($avant, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), $now]);
    }

    /**
     * Une seule proposition ouverte par personne et par article : la nouvelle remplace l'ancienne.
     *
     * @param array<string,mixed> $art
     * @param array<string,mixed> $valeurs
     */
    private static function proposer(\PDO $pdo, array $art, array $valeurs, int $uid, string $now): void
    {
        $pdo->prepare("UPDATE propositions SET statut = 'annule', clos_le = ? WHERE article_id = ? AND propose_par = ? AND statut = 'ouvert'")
            ->execute([$now, $art['id'], $uid]);
        $val = [];
        foreach (self::OBJECTIFS as $k) {
            $val[$k] = (string) $valeurs[$k];
        }
        $id = Ids::uuid();
        $pdo->prepare('INSERT INTO propositions (id, article_id, propose_par, cree_le, valeurs, statut) VALUES (?, ?, ?, ?, ?, ?)')
            ->execute([$id, $art['id'], $uid, $now, json_encode($val, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), 'ouvert']);
        $pdo->prepare('INSERT INTO proposition_votes (proposition_id, utilisateur_id, oui, vote_le) VALUES (?, ?, 1, ?)')->execute([$id, $uid, $now]);
    }

    /** Votes comptés : seules les étudiantes actives de la promo de l'article, jamais un formateur. @return array{0:int,1:int} */
    private static function compter(\PDO $pdo, string $propositionId, string $promoId): array
    {
        $st = $pdo->prepare(
            "SELECT v.oui, COUNT(*) AS n FROM proposition_votes v JOIN utilisateurs u ON u.id = v.utilisateur_id
             WHERE v.proposition_id = ? AND u.statut = 'actif'
               AND EXISTS (SELECT 1 FROM attributions a WHERE a.utilisateur_id = u.id AND a.role = 'etudiant' AND a.promo_id = ?)
             GROUP BY v.oui"
        );
        $st->execute([$propositionId, $promoId]);
        $pour = 0;
        $contre = 0;
        foreach ($st->fetchAll() as $r) {
            if ((int) $r['oui'] === 1) {
                $pour = (int) $r['n'];
            } else {
                $contre = (int) $r['n'];
            }
        }
        return [$pour, $contre];
    }

    /** Noms affichés d'un ensemble d'identifiants de personnes. @param array<int,mixed> $ids @return array<int,string> */
    private static function noms(\PDO $pdo, array $ids): array
    {
        $ids = array_values(array_unique(array_map('intval', array_filter($ids, static fn (mixed $i): bool => $i !== null))));
        if ($ids === []) {
            return [];
        }
        $st = $pdo->prepare('SELECT id, prenom, nom, pseudo FROM utilisateurs WHERE id IN (' . self::marques(count($ids)) . ')');
        $st->execute($ids);
        $out = [];
        foreach ($st->fetchAll() as $r) {
            $out[(int) $r['id']] = Membres::affiche($r);
        }
        return $out;
    }

    public static function marques(int $n): string
    {
        return implode(',', array_fill(0, $n, '?'));
    }
}
