<?php
declare(strict_types=1);

namespace Lpc;

/**
 * Import différentiel de l'ancien Google Sheet. Rejouable à volonté pendant la transition :
 *  - les identifiants (UUID) du Sheet sont conservés, les personnes sont reconnues par leur adresse ;
 *  - chaque ligne importée laisse une trace (import_traces) : empreinte de la ligne du Sheet et de la ligne écrite en base ;
 *  - ligne inchangée dans le Sheet : ignorée ; nouvelle : créée ; modifiée dans le Sheet : mise à jour, sauf si la ligne de la base
 *    a été retouchée depuis l'import (conflit : signalé, laissé tel quel) ;
 *  - ligne disparue du Sheet : signalée seulement, supprimée uniquement avec l'option « supprimer » (et si la base n'a pas bougé) ;
 *  - tout se fait dans une seule transaction : une erreur annule tout ; le mode « à blanc » compte sans rien écrire.
 * Le rapport ne contient que des nombres : jamais de nom, d'adresse ni de texte des étudiantes.
 */
final class Importation
{
    /** Colonnes de chaque onglet, dans l'ordre (l'ancien script lisait les feuilles par position). */
    public const COLONNES = [
        'Etablissements' => ['id', 'nom', 'cree_le'],
        'Promos' => ['id', 'etablissement_id', 'nom', 'cree_le', 'code', 'code_expire', 'code_max', 'code_usages'],
        'Utilisateurs' => ['email', 'prenom', 'role', 'couleur', 'statut', 'demande_le', 'derniere_connexion', 'promo_demandee', 'role_demande', 'consentement_le', 'consentement_version'],
        'Inscriptions' => ['id', 'email', 'promo_id', 'ajoute_le', 'via'],
        'Groupes' => ['id', 'etablissement', 'promo', 'nom', 'cree_le', 'cree_par'],
        'Membres' => ['id', 'groupe_id', 'email', 'ajoute_le'],
        'Votes' => ['id', 'groupe_id', 'type', 'cible', 'valeur', 'propose_par', 'cree_le', 'votes', 'statut', 'clos_le'],
        'Articles' => ['id', 'cree_par', 'groupe_id', 'ajoute', 'modifie_le', 'modifie_par', 'titre', 'parution', 'auteur', 'qualite', 'nation', 'type',
            'source', 'volume', 'numero', 'pages', 'doi', 'lien'],
        'Lectures' => ['id', 'owner', 'statut', 'titre', 'parution', 'auteur', 'qualite', 'nation', 'type', 'mots', 'kw', 'concepts', 'objet', 'opinion',
            'controverse', 'libre', 'ajoute', 'modifie_le', 'modifie_par', 'source', 'volume', 'numero', 'pages', 'doi', 'lien', 'groupe_id', 'portee',
            'article_id', 'priorite'],
        'Propositions' => ['id', 'article_id', 'propose_par', 'cree_le', 'valeurs', 'votes', 'statut', 'clos_le'],
        'Commentaires' => ['id', 'lecture_id', 'auteur_email', 'auteur', 'date', 'texte', 'modifie_le', 'portee', 'groupe_id'],
        'Lus' => ['id', 'commentaires'],
        'Historique' => ['date', 'id', 'modifie_par', 'proprietaire', 'avant'],
        'Reunions' => ['id', 'groupe_id', 'date', 'titre', 'participants', 'vu', 'attendu', 'suite', 'cree_par', 'cree_le', 'modifie_le', 'modifie_par'],
        'Jalons' => ['id', 'groupe_id', 'titre', 'echeance', 'statut', 'note', 'cree_par', 'cree_le', 'modifie_le', 'modifie_par', 'debut', 'alerte_jours'],
        'Glossaire' => ['id', 'groupe_id', 'mot', 'definition', 'reference', 'cree_par', 'cree_le', 'modifie_le', 'modifie_par'],
        'Notes' => ['id', 'owner', 'titre', 'date', 'texte', 'liens', 'cree_le', 'modifie_le', 'etiquettes', 'epingle'],
        'Feedback' => ['id', 'auteur_email', 'type', 'texte', 'contexte', 'jour', 'cree_le', 'modifie_le', 'statut'],
        'Fichiers' => ['id', 'article_id', 'drive_id', 'nom', 'type', 'taille', 'cree_par', 'cree_le'],
    ];

    /** Colonne qui identifie une ligne (les lignes sans identifiant sont ignorées, comme dans l'ancien script). */
    private const CLES = ['Utilisateurs' => 'email', 'Historique' => 'id', 'Lus' => 'id'];
    private const STATUTS_VOTE = ['ouvert', 'adopte', 'refuse', 'expire', 'annule'];
    private const TYPES_VOTE = ['adhesion', 'formateur_demande', 'formateur_invite', 'retrait', 'nom'];
    /** Entités dont une ligne disparue du Sheet peut être supprimée : entité => [table, colonne d'identifiant]. */
    private const SUPPRESSIBLES = ['groupe' => ['groupes', 'id'], 'vote' => ['votes', 'id'], 'article' => ['articles', 'id'], 'analyse' => ['analyses', 'id'],
        'proposition' => ['propositions', 'id'], 'commentaire' => ['commentaires', 'id'], 'reunion' => ['reunions', 'id'], 'jalon' => ['jalons', 'id'],
        'terme' => ['glossaire', 'id'], 'note' => ['notes', 'id'], 'feedback' => ['feedback', 'id'], 'historique' => ['historique', 'id'],
        'demande' => ['demandes_acces', 'id']];

    /** Entités qui laissent une trace, dans l'ordre d'import. */
    private const ENTITES = ['etablissement', 'promo', 'utilisateur', 'demande', 'groupe', 'membre', 'vote', 'article', 'analyse', 'proposition',
        'commentaire', 'historique', 'reunion', 'jalon', 'terme', 'note', 'feedback', 'fichier'];

    /** @var array<string,array<string,int>> */
    private array $rapport = [];
    /** @var array<string,int> */
    private array $raisons = [];
    /** @var array<string,array<string,true>> identifiants du Sheet vus pendant ce passage, par entité */
    private array $vus = [];
    /** @var array<string,array<string,string>> identifiant du Sheet => identifiant en base, par entité */
    private array $carte = [];
    /** @var array<string,callable(string):?string> */
    private array $relires = [];
    /** @var list<string> fichiers écrits pendant ce passage (retirés si tout est annulé) */
    private array $ecrits = [];
    /** @var array<string,int> adresse => identifiant de la personne */
    private array $emailId = [];
    /** @var array<string,list<int>> nom affiché de l'ancien outil => personnes (« Camille D. ») */
    private array $nomId = [];
    /** @var array<string,list<string>> adresse => promos (identifiants du Sheet) où la personne est inscrite ou en groupe */
    private array $promosDe = [];
    /** @var array<string,array{statut:string,role:string}> */
    private array $personnes = [];
    private \PDO $pdo;
    /** @var callable|null */
    private $drive;

    /**
     * @param array<string,list<list<string>>> $onglets lignes de chaque onglet, sans l'en-tête
     * @param null|callable(string):string $drive contenu d'un fichier du Drive d'après son identifiant
     */
    public function __construct(
        private Config $config,
        private Db $db,
        private array $onglets,
        ?callable $drive = null,
        private bool $aBlanc = false,
        private bool $supprimer = false,
        private bool $fichiers = true
    ) {
        $this->drive = $drive;
    }

    /** @return array<string,mixed> rapport (uniquement des nombres) */
    public function executer(): array
    {
        $debut = microtime(true);
        $this->pdo = $this->db->principale();
        $this->pdo->beginTransaction();
        try {
            $this->etablissements();
            $this->promos();
            $this->utilisateurs();
            $this->cartes();
            $this->demandes();
            $this->inscriptions();
            $this->groupes();
            $this->membres();
            $this->attributions();
            $this->votes();
            $this->articles();
            $this->analyses();
            $this->propositions();
            $this->commentaires();
            $this->lus();
            $this->historique();
            $this->suivi();
            $this->notes();
            $this->feedback();
            $this->fichiers();
            $absentes = $this->orphelins();
            if ($this->aBlanc) {
                $this->pdo->rollBack();
                $this->retirerEcrits();
            } else {
                $this->pdo->commit();
            }
        } catch (\Throwable $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            $this->retirerEcrits();
            throw $e;
        }
        ksort($this->raisons);
        return ['mode' => $this->aBlanc ? 'a_blanc' : 'reel', 'entites' => $this->rapport, 'absentes_de_la_source' => $absentes['absentes'],
            'supprimees' => $absentes['supprimees'], 'ignorees' => $this->raisons, 'duree_ms' => (int) round((microtime(true) - $debut) * 1000)];
    }

    // ---------- Structure ----------

    private function etablissements(): void
    {
        foreach ($this->lignes('Etablissements') as $l) {
            $this->traiter('etablissement', $l['id'], $l, function (?string $existant) use ($l): ?array {
                $nom = $this->court(Valide::espaces($l['nom']), 120);
                if ($nom === '') {
                    return $this->ignorer('etablissement', 'nom vide');
                }
                $id = $existant ?? $this->idParValeur('etablissements', 'nom', $nom) ?? $l['id'];
                $existe = $existant !== null || $this->existe('etablissements', 'id', $id);
                $this->ecrire('etablissements', $id, ['nom' => $nom, 'cree_le' => $this->dt($l['cree_le']) ?? Temps::maintenant()], $existe);
                return [$id, !$existe];
            }, fn (string $id): ?string => $this->ligne('etablissements', $id, ['nom']));
        }
    }

    private function promos(): void
    {
        foreach ($this->lignes('Promos') as $l) {
            $this->traiter('promo', $l['id'], $l, function (?string $existant) use ($l): ?array {
                $etab = $this->cible('etablissement', $l['etablissement_id']);
                $nom = $this->court(Valide::espaces($l['nom']), 120);
                if ($etab === null || $nom === '') {
                    return $this->ignorer('promo', 'établissement ou nom manquant');
                }
                $st = $this->pdo->prepare('SELECT id FROM promos WHERE etablissement_id = ? AND nom = ?');
                $st->execute([$etab, $nom]);
                $autre = $st->fetchColumn();
                $id = $existant ?? ($autre === false ? $l['id'] : (string) $autre);
                $existe = $existant !== null || $this->existe('promos', 'id', $id);
                $this->ecrire('promos', $id, ['etablissement_id' => $etab, 'nom' => $nom, 'cree_le' => $this->dt($l['cree_le']) ?? Temps::maintenant()], $existe);
                return [$id, !$existe];
            }, fn (string $id): ?string => $this->ligne('promos', $id, ['etablissement_id', 'nom']));
        }
    }

    private function groupes(): void
    {
        foreach ($this->lignes('Groupes') as $l) {
            $this->traiter('groupe', $l['id'], $l, function (?string $existant) use ($l): ?array {
                $nom = $this->court(Valide::espaces($l['nom']), 120);
                $promo = $this->promoParNoms($l['etablissement'], $l['promo']);
                if ($nom === '' || $promo === null) {
                    return $this->ignorer('groupe', 'nom ou promo manquant');
                }
                $st = $this->pdo->prepare('SELECT id FROM groupes WHERE promo_id = ? AND nom = ?');
                $st->execute([$promo, $nom]);
                $autre = $st->fetchColumn();
                $id = $existant ?? ($autre === false ? $l['id'] : (string) $autre);
                $existe = $existant !== null || $this->existe('groupes', 'id', $id);
                $this->ecrire('groupes', $id, ['promo_id' => $promo, 'nom' => $nom, 'cree_le' => $this->dt($l['cree_le']) ?? Temps::maintenant(),
                    'cree_par' => $this->email($l['cree_par'])], $existe);
                return [$id, !$existe];
            }, fn (string $id): ?string => $this->ligne('groupes', $id, ['promo_id', 'nom']));
        }
    }

    private function membres(): void
    {
        foreach ($this->lignes('Membres') as $l) {
            $this->traiter('membre', $l['id'], $l, function (?string $existant) use ($l): ?array {
                $groupe = $this->cible('groupe', $l['groupe_id']);
                $uid = $this->email($l['email']);
                if ($groupe === null || $uid === null) {
                    return $this->ignorer('membre', 'groupe ou personne introuvable');
                }
                $cle = $groupe . '|' . $uid;
                $deja = $this->existeDouble('membres', ['groupe_id' => $groupe, 'utilisateur_id' => $uid]);
                if (!$deja) {
                    $this->pdo->prepare('INSERT INTO membres (groupe_id, utilisateur_id, ajoute_le) VALUES (?, ?, ?)')
                        ->execute([$groupe, $uid, $this->dt($l['ajoute_le']) ?? Temps::maintenant()]);
                }
                $st = $this->pdo->prepare('SELECT g.promo_id FROM groupes g WHERE g.id = ?');
                $st->execute([$groupe]);
                $this->promosDe[strtolower(trim($l['email']))][] = 'cible:' . $st->fetchColumn();
                return [$cle, !$deja];
            }, function (string $cle): ?string {
                [$g, $u] = array_pad(explode('|', $cle, 2), 2, '');
                $st = $this->pdo->prepare('SELECT ajoute_le FROM membres WHERE groupe_id = ? AND utilisateur_id = ?');
                $st->execute([$g, (int) $u]);
                $r = $st->fetch();
                return $r === false ? null : (string) json_encode($r);
            });
        }
    }

    // ---------- Personnes ----------

    private function utilisateurs(): void
    {
        foreach ($this->lignes('Utilisateurs') as $l) {
            $email = strtolower(trim($l['email']));
            if (filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
                $this->ignorer('utilisateur', 'adresse invalide');
                continue;
            }
            $statut = strtolower(trim($l['statut']));
            $statut = in_array($statut, ['en_attente', 'refuse'], true) ? $statut : 'actif';
            $role = strtolower(trim($l['role'])) === 'etudiant' ? 'etudiant' : 'formateur';
            $this->personnes[$email] = ['statut' => $statut, 'role' => $role];
            $this->traiter('utilisateur', $email, $l, function (?string $existant) use ($l, $email, $statut): ?array {
                [$prenom, $nom] = self::separerNom(trim($l['prenom']));
                if ($nom === '') {
                    $nom = '-';   // l'ancien outil ne gardait pas le nom de famille : à compléter dans l'administration
                }
                $couleur = preg_match('/^#[0-9a-fA-F]{6}$/', trim($l['couleur'])) === 1 ? trim($l['couleur']) : Config::COULEUR_DEFAUT;
                $valeurs = ['prenom' => $prenom, 'nom' => $nom, 'couleur' => $couleur, 'statut' => $statut,
                    'derniere_connexion' => $this->dt($l['derniere_connexion']), 'consentement_le' => $this->dt($l['consentement_le']),
                    'consentement_version' => trim($l['consentement_version']) === '' ? null : $this->court(trim($l['consentement_version']), 20)];
                if ($existant === null) {
                    $st = $this->pdo->prepare('SELECT id FROM utilisateurs WHERE email = ?');
                    $st->execute([$email]);
                    $deja = $st->fetchColumn();
                    if ($deja !== false) {
                        return [(string) $deja, false];   // compte déjà créé dans le nouvel outil : il prévaut
                    }
                    $now = Temps::maintenant();
                    $this->pdo->prepare(
                        'INSERT INTO utilisateurs (pid, email, prenom, nom, couleur, statut, demande_le, derniere_connexion, consentement_le, consentement_version, cree_le)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
                    )->execute([Ids::pid($email), $email, $prenom, $nom, $couleur, $statut, $this->dt($l['demande_le']), $valeurs['derniere_connexion'],
                        $valeurs['consentement_le'], $valeurs['consentement_version'], $this->dt($l['demande_le']) ?? $now]);
                    return [(string) $this->pdo->lastInsertId(), true];
                }
                $sets = implode(', ', array_map(static fn (string $k): string => "`$k` = ?", array_keys($valeurs)));
                $this->pdo->prepare("UPDATE utilisateurs SET $sets WHERE id = ?")->execute([...array_values($valeurs), (int) $existant]);
                return [$existant, false];
            }, fn (string $id): ?string => $this->ligne('utilisateurs', $id, ['prenom', 'nom', 'couleur', 'statut', 'derniere_connexion', 'consentement_le', 'consentement_version']));
            $legacy = trim($l['prenom']);
            $id = $this->carte['utilisateur'][$email] ?? null;
            if ($legacy !== '' && $id !== null) {
                $this->nomId[$legacy][] = (int) $id;
            }
        }
    }

    /** « Camille D. » => [« Camille », « D »] ; un nom sans initiale reste le prénom. @return array{0:string,1:string} */
    public static function separerNom(string $p): array
    {
        if (preg_match('/^(.*\S)\s+((?:\p{L}\.)+)$/u', $p, $m) === 1) {
            return [mb_substr(trim($m[1]), 0, 60), str_replace('.', '', $m[2])];
        }
        return [mb_substr($p, 0, 60), ''];
    }

    private function cartes(): void
    {
        foreach ($this->pdo->query('SELECT id, email FROM utilisateurs')->fetchAll() as $u) {
            $this->emailId[(string) $u['email']] = (int) $u['id'];
        }
    }

    private function demandes(): void
    {
        foreach ($this->lignes('Utilisateurs') as $l) {
            $email = strtolower(trim($l['email']));
            if (($this->personnes[$email]['statut'] ?? '') !== 'en_attente' || trim($l['promo_demandee']) === '') {
                continue;
            }
            $ligne = ['email' => $email, 'promo' => $l['promo_demandee'], 'role' => $l['role_demande'], 'prenom' => $l['prenom']];
            $this->traiter('demande', $email, $ligne, function (?string $existant) use ($l, $email): ?array {
                $uid = $this->emailId[$email] ?? null;
                $promo = $this->cible('promo', trim($l['promo_demandee']));
                if ($uid === null || $promo === null) {
                    return $this->ignorer('demande', 'personne ou promo introuvable');
                }
                $st = $this->pdo->prepare('SELECT etablissement_id FROM promos WHERE id = ?');
                $st->execute([$promo]);
                $etab = (string) $st->fetchColumn();
                [$prenom, $nom] = self::separerNom(trim($l['prenom']));
                $role = strtolower(trim($l['role_demande'])) === 'formateur' ? 'formateur' : 'etudiant';
                $this->pdo->prepare("DELETE FROM demandes_acces WHERE utilisateur_id = ? AND statut = 'en_attente'")->execute([$uid]);
                $this->pdo->prepare('INSERT INTO demandes_acces (utilisateur_id, etablissement_id, promo_id, role, prenom, nom, statut, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
                    ->execute([$uid, $etab, $promo, $role, $prenom !== '' ? $prenom : '?', $nom !== '' ? $nom : '?', 'en_attente', $this->dt($l['demande_le']) ?? Temps::maintenant()]);
                return [(string) $this->pdo->lastInsertId(), $existant === null];
            }, function (string $id): ?string {
                $st = $this->pdo->prepare('SELECT promo_id, role, statut FROM demandes_acces WHERE id = ?');
                $st->execute([(int) $id]);
                $r = $st->fetch();
                return $r === false ? null : (string) json_encode($r);
            });
        }
    }

    private function inscriptions(): void
    {
        foreach ($this->lignes('Inscriptions') as $l) {
            $this->vu('inscription', $l['id']);
            $promo = $this->cible('promo', $l['promo_id']);
            if ($promo === null) {
                $this->ignorer('inscription', 'promo introuvable');
                continue;
            }
            $this->promosDe[strtolower(trim($l['email']))][] = 'cible:' . $promo;
        }
    }

    /** Rôles : étudiante d'une promo (inscription ou groupe), formateur de l'établissement de ses promos. Ajouts seulement. */
    private function attributions(): void
    {
        foreach ($this->personnes as $email => $p) {
            $uid = $this->emailId[$email] ?? null;
            if ($p['statut'] !== 'actif' || $uid === null) {
                continue;
            }
            $promos = [];
            foreach ($this->promosDe[$email] ?? [] as $x) {
                $promos[] = str_starts_with($x, 'cible:') ? substr($x, 6) : (string) ($this->cible('promo', $x) ?? '');
            }
            $promos = array_values(array_filter(array_unique($promos), static fn (string $x): bool => $x !== ''));
            if ($promos === []) {
                $this->ignorer('attribution', 'aucune promo ni groupe : rôle non attribué');
                continue;
            }
            foreach ($promos as $promo) {
                try {
                    if ($p['role'] === 'etudiant') {
                        $cree = Attributions::ajouter($this->pdo, $uid, 'etudiant', null, $promo, 'migration');
                    } else {
                        $st = $this->pdo->prepare('SELECT etablissement_id FROM promos WHERE id = ?');
                        $st->execute([$promo]);
                        $cree = Attributions::ajouter($this->pdo, $uid, 'formateur', (string) $st->fetchColumn(), null, 'migration');
                    }
                    $this->compte('attribution', $cree ? 'creees' : 'inchangees');
                } catch (Erreur) {
                    $this->ignorer('attribution', 'rôle incohérent');
                }
            }
        }
    }

    // ---------- Groupes : votes ----------

    private function votes(): void
    {
        foreach ($this->lignes('Votes') as $l) {
            $this->traiter('vote', $l['id'], $l, function (?string $existant) use ($l): ?array {
                $groupe = $this->cible('groupe', $l['groupe_id']);
                $type = trim($l['type']);
                if ($groupe === null || !in_array($type, self::TYPES_VOTE, true)) {
                    return $this->ignorer('vote', 'groupe ou type inconnu');
                }
                $statut = in_array(trim($l['statut']), self::STATUTS_VOTE, true) ? trim($l['statut']) : 'annule';
                $id = $existant ?? $l['id'];
                $existe = $existant !== null || $this->existe('votes', 'id', $id);
                $this->ecrire('votes', $id, ['groupe_id' => $groupe, 'type' => $type, 'cible_id' => $this->email($l['cible']),
                    'valeur' => $l['valeur'] === '' ? null : $this->court($l['valeur'], 190), 'propose_par' => $this->email($l['propose_par']),
                    'cree_le' => $this->dt($l['cree_le']) ?? Temps::maintenant(), 'statut' => $statut, 'clos_le' => $this->dt($l['clos_le'])], $existe);
                $this->reponses('vote_reponses', 'vote_id', $id, $l['votes'], $this->dt($l['cree_le']) ?? Temps::maintenant(), 'repondu_le');
                return [$id, !$existe];
            }, fn (string $id): ?string => $this->ligne('votes', $id, ['statut', 'clos_le', 'valeur']) . $this->resumeReponses('vote_reponses', 'vote_id', $id));
        }
    }

    // ---------- Lectures ----------

    private function articles(): void
    {
        foreach ($this->lignes('Articles') as $l) {
            $this->traiter('article', $l['id'], $l, function (?string $existant) use ($l): ?array {
                $groupe = $this->cible('groupe', $l['groupe_id']);
                if ($groupe === null) {
                    return $this->ignorer('article', 'groupe introuvable');
                }
                $id = $existant ?? $l['id'];
                $existe = $existant !== null || $this->existe('articles', 'id', $id);
                $v = ['cree_par' => $this->email($l['cree_par']), 'groupe_id' => $groupe, 'ajoute' => $this->dt($l['ajoute']) ?? Temps::maintenant(),
                    'modifie_le' => $this->dt($l['modifie_le']), 'modifie_par' => $this->parNom($l['modifie_par'])];
                foreach (Lectures::OBJECTIFS as $k) {
                    $v[$k] = $this->court(trim($l[$k]), $k === 'lien' || $k === 'auteur' ? 100000 : $this->largeur($k));
                }
                $this->ecrire('articles', $id, $v, $existe);
                return [$id, !$existe];
            }, fn (string $id): ?string => $this->ligne('articles', $id, array_merge(['modifie_le'], Lectures::OBJECTIFS)));
        }
    }

    private function analyses(): void
    {
        foreach ($this->lignes('Lectures') as $l) {
            $this->traiter('analyse', $l['id'], $l, function (?string $existant) use ($l): ?array {
                $article = $this->cible('article', $l['article_id']);
                $groupe = $this->cible('groupe', $l['groupe_id']);
                $statut = trim($l['statut']);
                if ($article === null || $groupe === null || !in_array($statut, Lectures::STATUTS, true)) {
                    return $this->ignorer('analyse', 'article, groupe ou statut inconnu');
                }
                $proprio = $this->email($l['owner']);
                if ($proprio === null) {
                    $this->ignorer('analyse', 'propriétaire inconnu (fiche importée sans auteur)', false);
                }
                $priorite = in_array(trim($l['priorite']), Lectures::PRIORITES, true) ? trim($l['priorite']) : 'normale';
                $id = $existant ?? $l['id'];
                $existe = $existant !== null || $this->existe('analyses', 'id', $id);
                $this->ecrire('analyses', $id, ['article_id' => $article, 'utilisateur_id' => $proprio, 'groupe_id' => $groupe, 'statut' => $statut, 'priorite' => $priorite,
                    'mots' => $l['mots'], 'kw' => $l['kw'], 'concepts' => $l['concepts'], 'objet' => $l['objet'], 'opinion' => $l['opinion'],
                    'controverse' => $l['controverse'], 'libre' => $l['libre'], 'portee' => Lectures::porteeDe($statut),
                    'ajoute' => $this->dt($l['ajoute']) ?? Temps::maintenant(), 'modifie_le' => $this->dt($l['modifie_le']), 'modifie_par' => $this->parNom($l['modifie_par'])], $existe);
                return [$id, !$existe];
            }, fn (string $id): ?string => $this->ligne('analyses', $id, ['statut', 'priorite', 'mots', 'kw', 'concepts', 'objet', 'opinion', 'controverse', 'libre', 'modifie_le']));
        }
    }

    private function propositions(): void
    {
        foreach ($this->lignes('Propositions') as $l) {
            $this->traiter('proposition', $l['id'], $l, function (?string $existant) use ($l): ?array {
                $article = $this->cible('article', $l['article_id']);
                $valeurs = json_decode($l['valeurs'], true);
                if ($article === null || !is_array($valeurs)) {
                    return $this->ignorer('proposition', 'article inconnu ou valeurs illisibles');
                }
                $statut = in_array(trim($l['statut']), self::STATUTS_VOTE, true) ? trim($l['statut']) : 'annule';
                $id = $existant ?? $l['id'];
                $existe = $existant !== null || $this->existe('propositions', 'id', $id);
                $this->ecrire('propositions', $id, ['article_id' => $article, 'propose_par' => $this->email($l['propose_par']),
                    'cree_le' => $this->dt($l['cree_le']) ?? Temps::maintenant(), 'valeurs' => (string) json_encode($valeurs, JSON_UNESCAPED_UNICODE),
                    'statut' => $statut, 'clos_le' => $this->dt($l['clos_le'])], $existe);
                $this->reponses('proposition_votes', 'proposition_id', $id, $l['votes'], $this->dt($l['cree_le']) ?? Temps::maintenant(), 'vote_le');
                return [$id, !$existe];
            }, fn (string $id): ?string => $this->ligne('propositions', $id, ['statut', 'clos_le', 'valeurs']) . $this->resumeReponses('proposition_votes', 'proposition_id', $id));
        }
    }

    private function commentaires(): void
    {
        foreach ($this->lignes('Commentaires') as $l) {
            $this->traiter('commentaire', $l['id'], $l, function (?string $existant) use ($l): ?array {
                $analyse = $this->cible('analyse', $l['lecture_id']);
                $texte = trim($l['texte']);
                if ($analyse === null || $texte === '') {
                    return $this->ignorer('commentaire', 'fiche inconnue ou texte vide');
                }
                $id = $existant ?? $l['id'];
                $existe = $existant !== null || $this->existe('commentaires', 'id', $id);
                $this->ecrire('commentaires', $id, ['analyse_id' => $analyse, 'auteur_id' => $this->email($l['auteur_email']), 'texte' => $texte,
                    'cree_le' => $this->dt($l['date']) ?? Temps::maintenant(), 'modifie_le' => $this->dt($l['modifie_le']),
                    'portee' => trim($l['portee']) === 'promo' ? 'promo' : 'groupe', 'groupe_id' => $this->cible('groupe', $l['groupe_id'])], $existe);
                return [$id, !$existe];
            }, fn (string $id): ?string => $this->ligne('commentaires', $id, ['texte', 'modifie_le', 'portee']));
        }
    }

    /** Commentaires lus : ajouts seulement (un commentaire remis en « non lu » dans l'ancien outil n'est pas repris). */
    private function lus(): void
    {
        foreach ($this->lignes('Lus') as $l) {
            $uid = $this->email($l['id']);
            if ($uid === null) {
                $this->ignorer('lus', 'personne introuvable');
                continue;
            }
            foreach (array_filter(explode(',', $l['commentaires'])) as $sid) {
                $cid = $this->cible('commentaire', trim($sid));
                if ($cid === null) {
                    continue;
                }
                $st = $this->pdo->prepare('INSERT IGNORE INTO commentaires_lus (utilisateur_id, commentaire_id) VALUES (?, ?)');
                $st->execute([$uid, $cid]);
                $this->compte('lus', $st->rowCount() > 0 ? 'creees' : 'inchangees');
            }
        }
    }

    private function historique(): void
    {
        foreach ($this->lignes('Historique') as $l) {
            $sid = sha1($l['date'] . '|' . $l['id'] . '|' . $l['avant']);
            $this->traiter('historique', $sid, $l, function (?string $existant) use ($l): ?array {
                $article = $this->cible('article', $l['id']);
                $analyse = $article === null ? $this->cible('analyse', $l['id']) : null;
                $avant = json_decode($l['avant'], true);
                if (($article === null && $analyse === null) || !is_array($avant)) {
                    return $this->ignorer('historique', 'fiche ou article inconnu, ou version illisible');
                }
                $v = ['cible' => $article !== null ? 'article' : 'analyse', 'cible_id' => $article ?? $analyse, 'modifie_par' => $this->parNom($l['modifie_par']),
                    'proprietaire' => $this->parNom($l['proprietaire']), 'avant' => (string) json_encode($avant, JSON_UNESCAPED_UNICODE),
                    'modifie_le' => $this->dt($l['date']) ?? Temps::maintenant()];
                if ($existant !== null) {
                    $this->pdo->prepare('UPDATE historique SET cible = ?, cible_id = ?, modifie_par = ?, proprietaire = ?, avant = ?, modifie_le = ? WHERE id = ?')
                        ->execute([...array_values($v), (int) $existant]);
                    return [$existant, false];
                }
                $this->pdo->prepare('INSERT INTO historique (cible, cible_id, modifie_par, proprietaire, avant, modifie_le) VALUES (?, ?, ?, ?, ?, ?)')->execute(array_values($v));
                return [(string) $this->pdo->lastInsertId(), true];
            }, function (string $id): ?string {
                $st = $this->pdo->prepare('SELECT avant FROM historique WHERE id = ?');
                $st->execute([(int) $id]);
                $r = $st->fetch();
                return $r === false ? null : (string) json_encode($r);
            });
        }
    }

    // ---------- Groupe : suivi, glossaire ----------

    private function suivi(): void
    {
        foreach ($this->lignes('Reunions') as $l) {
            $this->traiter('reunion', $l['id'], $l, function (?string $existant) use ($l): ?array {
                $groupe = $this->cible('groupe', $l['groupe_id']);
                if ($groupe === null) {
                    return $this->ignorer('reunion', 'groupe introuvable');
                }
                $id = $existant ?? $l['id'];
                $existe = $existant !== null || $this->existe('reunions', 'id', $id);
                $this->ecrire('reunions', $id, ['groupe_id' => $groupe, 'date' => $this->jour($l['date']), 'titre' => $this->court($l['titre'], 200),
                    'participants' => $l['participants'], 'vu' => $l['vu'], 'attendu' => $l['attendu'], 'suite' => $l['suite'], 'cree_par' => $this->email($l['cree_par']),
                    'cree_le' => $this->dt($l['cree_le']) ?? Temps::maintenant(), 'modifie_le' => $this->dt($l['modifie_le']), 'modifie_par' => $this->parNom($l['modifie_par'])], $existe);
                return [$id, !$existe];
            }, fn (string $id): ?string => $this->ligne('reunions', $id, ['date', 'titre', 'participants', 'vu', 'attendu', 'suite', 'modifie_le']));
        }
        foreach ($this->lignes('Jalons') as $l) {
            $this->traiter('jalon', $l['id'], $l, function (?string $existant) use ($l): ?array {
                $groupe = $this->cible('groupe', $l['groupe_id']);
                if ($groupe === null) {
                    return $this->ignorer('jalon', 'groupe introuvable');
                }
                $id = $existant ?? $l['id'];
                $existe = $existant !== null || $this->existe('jalons', 'id', $id);
                $alerte = preg_match('/^\d{1,3}$/', trim($l['alerte_jours'])) === 1 ? (int) $l['alerte_jours'] : null;
                $this->ecrire('jalons', $id, ['groupe_id' => $groupe, 'titre' => $this->court($l['titre'], 200), 'debut' => $this->jour($l['debut']),
                    'echeance' => $this->jour($l['echeance']), 'statut' => in_array(trim($l['statut']), Suivi::STATUTS_JALON, true) ? trim($l['statut']) : 'a_faire',
                    'note' => $l['note'], 'alerte_jours' => $alerte, 'cree_par' => $this->email($l['cree_par']), 'cree_le' => $this->dt($l['cree_le']) ?? Temps::maintenant(),
                    'modifie_le' => $this->dt($l['modifie_le']), 'modifie_par' => $this->parNom($l['modifie_par'])], $existe);
                return [$id, !$existe];
            }, fn (string $id): ?string => $this->ligne('jalons', $id, ['titre', 'debut', 'echeance', 'statut', 'note', 'alerte_jours', 'modifie_le']));
        }
        foreach ($this->lignes('Glossaire') as $l) {
            $this->traiter('terme', $l['id'], $l, function (?string $existant) use ($l): ?array {
                $groupe = $this->cible('groupe', $l['groupe_id']);
                if ($groupe === null || trim($l['mot']) === '') {
                    return $this->ignorer('terme', 'groupe ou mot manquant');
                }
                $id = $existant ?? $l['id'];
                $existe = $existant !== null || $this->existe('glossaire', 'id', $id);
                $this->ecrire('glossaire', $id, ['groupe_id' => $groupe, 'mot' => $this->court(trim($l['mot']), 200), 'definition' => $l['definition'],
                    'reference' => $l['reference'], 'cree_par' => $this->email($l['cree_par']), 'cree_le' => $this->dt($l['cree_le']) ?? Temps::maintenant(),
                    'modifie_le' => $this->dt($l['modifie_le']), 'modifie_par' => $this->parNom($l['modifie_par'])], $existe);
                return [$id, !$existe];
            }, fn (string $id): ?string => $this->ligne('glossaire', $id, ['mot', 'definition', 'reference', 'modifie_le']));
        }
    }

    // ---------- Personnel ----------

    private function notes(): void
    {
        foreach ($this->lignes('Notes') as $l) {
            $this->traiter('note', $l['id'], $l, function (?string $existant) use ($l): ?array {
                $uid = $this->email($l['owner']);
                if ($uid === null || trim($l['titre']) === '') {
                    return $this->ignorer('note', 'propriétaire inconnu ou titre vide');
                }
                $id = $existant ?? $l['id'];
                $existe = $existant !== null || $this->existe('notes', 'id', $id);
                $this->ecrire('notes', $id, ['utilisateur_id' => $uid, 'titre' => $this->court(trim($l['titre']), 120), 'date' => $this->court($this->jour($l['date']) ?? '', 10),
                    'texte' => $l['texte'], 'liens' => $this->listeJson($l['liens']), 'etiquettes' => $this->listeJson($l['etiquettes']), 'epingle' => $l['epingle'] === '1' ? 1 : 0,
                    'cree_le' => $this->dt($l['cree_le']) ?? Temps::maintenant(), 'modifie_le' => $this->dt($l['modifie_le'])], $existe);
                return [$id, !$existe];
            }, fn (string $id): ?string => $this->ligne('notes', $id, ['titre', 'date', 'texte', 'liens', 'etiquettes', 'epingle', 'modifie_le']));
        }
    }

    private function feedback(): void
    {
        foreach ($this->lignes('Feedback') as $l) {
            $this->traiter('feedback', $l['id'], $l, function (?string $existant) use ($l): ?array {
                if (trim($l['texte']) === '') {
                    return $this->ignorer('feedback', 'texte vide');
                }
                $creation = $this->dt($l['cree_le']) ?? Temps::maintenant();
                $id = $existant ?? $l['id'];
                $existe = $existant !== null || $this->existe('feedback', 'id', $id);
                $this->ecrire('feedback', $id, ['auteur_id' => $this->email($l['auteur_email']), 'type' => in_array(trim($l['type']), Feedback::TYPES, true) ? trim($l['type']) : 'autre',
                    'texte' => trim($l['texte']), 'contexte' => $this->court($l['contexte'], 500), 'jour' => $this->jour($l['jour']) ?? substr($creation, 0, 10),
                    'cree_le' => $creation, 'modifie_le' => $this->dt($l['modifie_le']), 'statut' => $this->court(trim($l['statut']) ?: 'nouveau', 20)], $existe);
                return [$id, !$existe];
            }, fn (string $id): ?string => $this->ligne('feedback', $id, ['type', 'texte', 'statut', 'modifie_le']));
        }
    }

    /** Pièces jointes : téléchargées depuis le Drive (une seule fois : un fichier inchangé n'est pas retéléchargé). */
    private function fichiers(): void
    {
        if (!$this->fichiers) {
            return;
        }
        foreach ($this->lignes('Fichiers') as $l) {
            $this->traiter('fichier', $l['id'], $l, function (?string $existant) use ($l): ?array {
                $article = $this->cible('article', $l['article_id']);
                if ($article === null || trim($l['drive_id']) === '' || $this->drive === null) {
                    return $this->ignorer('fichier', 'article inconnu ou Drive non disponible');
                }
                $st = $this->pdo->prepare('SELECT id, chemin FROM fichiers WHERE article_id = ?');
                $st->execute([$article]);
                $autre = $st->fetch();
                if ($autre !== false && (string) $autre['id'] !== ($existant ?? $l['id'])) {
                    return $this->ignorer('fichier', 'article déjà muni d\'une autre pièce jointe');
                }
                $chemin = 'dry-run';
                $taille = (int) $l['taille'];
                $type = Fichiers::type('') ?? ['type' => 'application/pdf', 'ext' => '.pdf'];
                if (!$this->aBlanc) {
                    $octets = ($this->drive)(trim($l['drive_id']));
                    $t = Fichiers::type($octets);
                    if ($octets === '' || strlen($octets) > Fichiers::MAX_OCTETS || $t === null) {
                        return $this->ignorer('fichier', 'fichier vide, trop gros ou de format non accepté');
                    }
                    if ($t['type'] !== 'application/pdf') {
                        $octets = Fichiers::reduire($octets, $t['type']);
                    }
                    $type = $t;
                    $taille = strlen($octets);
                    $dossier = $this->config->dossierPrive() . '/fichiers';
                    if (!is_dir($dossier) && !mkdir($dossier, 0700, true) && !is_dir($dossier)) {
                        throw new \RuntimeException('Dossier des pièces jointes inaccessible');
                    }
                    $chemin = Ids::uuid() . $t['ext'];
                    file_put_contents($dossier . '/' . $chemin, $octets, LOCK_EX);
                    $this->ecrits[] = $dossier . '/' . $chemin;
                }
                $id = $existant ?? $l['id'];
                if ($autre !== false) {
                    $this->pdo->prepare('DELETE FROM fichiers WHERE id = ?')->execute([$autre['id']]);
                    $this->supprimerDuDisque([(string) $autre['chemin']]);
                }
                $this->ecrire('fichiers', $id, ['article_id' => $article, 'nom' => Fichiers::nomDeFichier($l['nom'], $type['ext']), 'type' => $type['type'], 'taille' => $taille,
                    'chemin' => $chemin, 'cree_par' => $this->email($l['cree_par']), 'cree_le' => $this->dt($l['cree_le']) ?? Temps::maintenant()], false);
                return [$id, $autre === false];
            }, fn (string $id): ?string => $this->ligne('fichiers', $id, ['nom', 'type', 'taille']));
        }
    }

    // ---------- Moteur différentiel ----------

    /**
     * @param array<string,string> $ligne ligne du Sheet
     * @param callable(?string):?array{0:string,1:bool} $appliquer écrit la ligne (identifiant en base, ou null à la création) ; renvoie [identifiant, créée] ou null si ignorée
     * @param callable(string):?string $relire contenu de la ligne en base (pour l'empreinte), null si elle n'existe plus
     */
    private function traiter(string $entite, string $sourceId, array $ligne, callable $appliquer, callable $relire): void
    {
        $this->relires[$entite] = $relire;
        $this->vu($entite, $sourceId);
        $emp = hash('sha256', (string) json_encode($ligne, JSON_UNESCAPED_UNICODE));
        $st = $this->pdo->prepare('SELECT cible_id, empreinte_source, empreinte_cible FROM import_traces WHERE entite = ? AND source_id = ?');
        $st->execute([$entite, $sourceId]);
        $trace = $st->fetch();
        try {
            if ($trace !== false) {
                $this->carte[$entite][$sourceId] = (string) $trace['cible_id'];
                if ($trace['empreinte_source'] === $emp) {
                    $this->compte($entite, 'inchangees');
                    return;
                }
                $actuel = $relire((string) $trace['cible_id']);
                if ($actuel === null || hash('sha256', $actuel) !== $trace['empreinte_cible']) {
                    $this->compte($entite, 'conflits');
                    return;
                }
                $r = $appliquer((string) $trace['cible_id']);
                $this->compte($entite, 'mises_a_jour');
            } else {
                $r = $appliquer(null);
                if ($r !== null) {
                    $this->compte($entite, $r[1] ? 'creees' : 'mises_a_jour');
                }
            }
            if ($r === null) {
                return;
            }
            $this->carte[$entite][$sourceId] = $r[0];
            $cible = $relire($r[0]);
            $this->tracer($entite, $sourceId, $r[0], $emp, hash('sha256', (string) $cible));
        } catch (\PDOException $e) {
            $this->compte($entite, 'erreurs');
            $this->raisons[$entite . ' : erreur SQL ' . $e->getCode()] = ($this->raisons[$entite . ' : erreur SQL ' . $e->getCode()] ?? 0) + 1;
        } catch (\RuntimeException $e) {
            $this->compte($entite, 'erreurs');
            $this->raisons[$entite . ' : ' . $this->nettoyerMessage($e->getMessage())] = ($this->raisons[$entite . ' : ' . $this->nettoyerMessage($e->getMessage())] ?? 0) + 1;
        }
    }

    private function tracer(string $entite, string $sourceId, string $cibleId, string $empSource, string $empCible): void
    {
        $st = $this->pdo->prepare('UPDATE import_traces SET cible_id = ?, empreinte_source = ?, empreinte_cible = ?, importe_le = ? WHERE entite = ? AND source_id = ?');
        $st->execute([$cibleId, $empSource, $empCible, Temps::maintenant(), $entite, $sourceId]);
        $s = $this->pdo->prepare('SELECT 1 FROM import_traces WHERE entite = ? AND source_id = ?');
        $s->execute([$entite, $sourceId]);
        if ($s->fetchColumn() === false) {
            $this->pdo->prepare('INSERT INTO import_traces (entite, source_id, cible_id, empreinte_source, empreinte_cible, importe_le) VALUES (?, ?, ?, ?, ?, ?)')
                ->execute([$entite, $sourceId, $cibleId, $empSource, $empCible, Temps::maintenant()]);
        }
    }

    /**
     * Lignes disparues du Sheet : comptées, et supprimées (si la base n'a pas bougé) avec l'option « supprimer ».
     *
     * @return array{absentes:array<string,int>,supprimees:array<string,int>}
     */
    private function orphelins(): array
    {
        $absentes = [];
        $supprimees = [];
        foreach (self::ENTITES as $entite) {
            if ($entite === 'fichier' && !$this->fichiers) {
                continue;
            }
            // Sécurité : un onglet entièrement vide (lecture ratée, onglet vidé par erreur) ne déclenche jamais de suppression.
            $suppression = $this->supprimer && isset($this->relires[$entite]) && ($entite === 'membre' || $entite === 'fichier' || isset(self::SUPPRESSIBLES[$entite]));
            $st = $this->pdo->prepare('SELECT source_id, cible_id, empreinte_cible FROM import_traces WHERE entite = ?');
            $st->execute([$entite]);
            foreach ($st->fetchAll() as $t) {
                if (isset($this->vus[$entite][(string) $t['source_id']])) {
                    continue;
                }
                $absentes[$entite] = ($absentes[$entite] ?? 0) + 1;
                if (!$suppression) {
                    continue;
                }
                $actuel = ($this->relires[$entite])((string) $t['cible_id']);
                if ($actuel !== null && hash('sha256', $actuel) !== $t['empreinte_cible']) {
                    $this->compte($entite, 'conflits');
                    continue;
                }
                $this->supprimerCible($entite, (string) $t['cible_id']);
                $this->pdo->prepare('DELETE FROM import_traces WHERE entite = ? AND source_id = ?')->execute([$entite, $t['source_id']]);
                $supprimees[$entite] = ($supprimees[$entite] ?? 0) + 1;
            }
        }
        return ['absentes' => $absentes, 'supprimees' => $supprimees];
    }

    private function supprimerCible(string $entite, string $cible): void
    {
        if ($entite === 'membre') {
            [$g, $u] = array_pad(explode('|', $cible, 2), 2, '');
            $this->pdo->prepare('DELETE FROM membres WHERE groupe_id = ? AND utilisateur_id = ?')->execute([$g, (int) $u]);
        } elseif ($entite === 'fichier') {
            $st = $this->pdo->prepare('SELECT chemin FROM fichiers WHERE id = ?');
            $st->execute([$cible]);
            $chemin = $st->fetchColumn();
            $this->pdo->prepare('DELETE FROM fichiers WHERE id = ?')->execute([$cible]);
            if ($chemin !== false) {
                $this->supprimerDuDisque([(string) $chemin]);
            }
        } elseif (isset(self::SUPPRESSIBLES[$entite])) {
            [$table, $colonne] = self::SUPPRESSIBLES[$entite];
            $this->pdo->prepare("DELETE FROM `$table` WHERE `$colonne` = ?")->execute([$cible]);
        }
    }

    // ---------- Aides ----------

    /** @return list<array<string,string>> les lignes d'un onglet, par nom de colonne */
    private function lignes(string $onglet): array
    {
        $cols = self::COLONNES[$onglet];
        $cle = self::CLES[$onglet] ?? 'id';
        $out = [];
        foreach ($this->onglets[$onglet] ?? [] as $r) {
            $l = array_combine($cols, array_slice(array_pad(array_map('strval', $r), count($cols), ''), 0, count($cols)));
            if (trim($l[$cle]) !== '') {
                $l[$cle] = trim($l[$cle]);
                $out[] = $l;
            }
        }
        return $out;
    }

    private function vu(string $entite, string $sourceId): void
    {
        $this->vus[$entite][$sourceId] = true;
    }

    private function compte(string $entite, string $cle): void
    {
        $this->rapport[$entite][$cle] = ($this->rapport[$entite][$cle] ?? 0) + 1;
    }

    /** @return null toujours : pratique pour « return $this->ignorer(...) » */
    private function ignorer(string $entite, string $raison, bool $compter = true): ?array
    {
        $this->raisons[$entite . ' : ' . $raison] = ($this->raisons[$entite . ' : ' . $raison] ?? 0) + 1;
        if ($compter) {
            $this->compte($entite, 'ignorees');
        }
        return null;
    }

    private function cible(string $entite, string $sourceId): ?string
    {
        return $this->carte[$entite][trim($sourceId)] ?? null;
    }

    private function email(string $email): ?int
    {
        $e = strtolower(trim($email));
        return $e === '' ? null : ($this->emailId[$e] ?? null);
    }

    /** Personne désignée par son nom affiché de l'ancien outil (« modifié par Camille D. ») ; null si ambigu ou inconnu. */
    private function parNom(string $nom): ?int
    {
        $ids = array_values(array_unique($this->nomId[trim($nom)] ?? []));
        return count($ids) === 1 ? $ids[0] : null;
    }

    private function promoParNoms(string $etab, string $promo): ?string
    {
        $etab = Valide::espaces($etab);
        $promo = Valide::espaces($promo);
        if ($etab === '' || $promo === '') {
            return null;
        }
        $st = $this->pdo->prepare('SELECT p.id FROM promos p JOIN etablissements e ON e.id = p.etablissement_id WHERE e.nom = ? AND p.nom = ?');
        $st->execute([$etab, $promo]);
        $id = $st->fetchColumn();
        if ($id !== false) {
            return (string) $id;
        }
        // Établissement ou promo absents de leurs onglets (anciennes installations) : créés d'après les noms.
        $eid = $this->idParValeur('etablissements', 'nom', $etab);
        if ($eid === null) {
            $eid = Ids::uuid();
            $this->ecrire('etablissements', $eid, ['nom' => $this->court($etab, 120), 'cree_le' => Temps::maintenant()], false);
        }
        $pid = Ids::uuid();
        $this->ecrire('promos', $pid, ['etablissement_id' => $eid, 'nom' => $this->court($promo, 120), 'cree_le' => Temps::maintenant()], false);
        return $pid;
    }

    private function idParValeur(string $table, string $colonne, string $valeur): ?string
    {
        $st = $this->pdo->prepare("SELECT id FROM `$table` WHERE `$colonne` = ?");
        $st->execute([$valeur]);
        $id = $st->fetchColumn();
        return $id === false ? null : (string) $id;
    }

    private function existe(string $table, string $colonne, string $valeur): bool
    {
        $st = $this->pdo->prepare("SELECT 1 FROM `$table` WHERE `$colonne` = ?");
        $st->execute([$valeur]);
        return $st->fetchColumn() !== false;
    }

    /** @param array<string,mixed> $cles */
    private function existeDouble(string $table, array $cles): bool
    {
        $st = $this->pdo->prepare("SELECT 1 FROM `$table` WHERE " . implode(' AND ', array_map(static fn (string $k): string => "`$k` = ?", array_keys($cles))));
        $st->execute(array_values($cles));
        return $st->fetchColumn() !== false;
    }

    /** @param array<string,mixed> $v */
    private function ecrire(string $table, string $id, array $v, bool $existe): void
    {
        if ($existe) {
            $sets = implode(', ', array_map(static fn (string $k): string => "`$k` = ?", array_keys($v)));
            $this->pdo->prepare("UPDATE `$table` SET $sets WHERE id = ?")->execute([...array_values($v), $id]);
            return;
        }
        $cols = implode(', ', array_map(static fn (string $k): string => "`$k`", array_keys($v)));
        $this->pdo->prepare("INSERT INTO `$table` (id, $cols) VALUES (?, " . Lectures::marques(count($v)) . ')')->execute([$id, ...array_values($v)]);
    }

    /** @param list<string> $colonnes */
    private function ligne(string $table, string $id, array $colonnes): ?string
    {
        $st = $this->pdo->prepare('SELECT ' . implode(', ', array_map(static fn (string $c): string => "`$c`", $colonnes)) . " FROM `$table` WHERE id = ?");
        $st->execute([$id]);
        $r = $st->fetch();
        return $r === false ? null : (string) json_encode($r, JSON_UNESCAPED_UNICODE);
    }

    /** Bulletins « {adresse: 1|0} » de l'ancien outil, réécrits en lignes (remplacés à chaque mise à jour). */
    private function reponses(string $table, string $cleParent, string $parent, string $json, string $date, string $colDate): void
    {
        $this->pdo->prepare("DELETE FROM `$table` WHERE `$cleParent` = ?")->execute([$parent]);
        $v = json_decode($json, true);
        foreach (is_array($v) ? $v : [] as $email => $oui) {
            $uid = $this->email((string) $email);
            if ($uid !== null) {
                $this->pdo->prepare("INSERT IGNORE INTO `$table` (`$cleParent`, utilisateur_id, oui, `$colDate`) VALUES (?, ?, ?, ?)")->execute([$parent, $uid, (int) $oui === 1 ? 1 : 0, $date]);
            }
        }
    }

    private function resumeReponses(string $table, string $cleParent, string $parent): string
    {
        $st = $this->pdo->prepare("SELECT utilisateur_id, oui FROM `$table` WHERE `$cleParent` = ? ORDER BY utilisateur_id");
        $st->execute([$parent]);
        return '|' . json_encode($st->fetchAll());
    }

    /** Date ISO de l'ancien outil => date de la base (UTC), null si vide ou illisible. */
    private function dt(string $v): ?string
    {
        $v = trim($v);
        if ($v === '') {
            return null;
        }
        try {
            return (new \DateTimeImmutable($v, new \DateTimeZone('UTC')))->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d H:i:s');
        } catch (\Throwable) {
            return null;
        }
    }

    private function jour(string $v): ?string
    {
        return preg_match('/^(\d{4})-(\d{2})-(\d{2})/', trim($v), $m) === 1 && checkdate((int) $m[2], (int) $m[3], (int) $m[1]) ? substr(trim($v), 0, 10) : null;
    }

    private function court(string $v, int $max): string
    {
        return mb_substr($v, 0, $max);
    }

    private function largeur(string $champ): int
    {
        return ['titre' => 500, 'parution' => 20, 'qualite' => 80, 'nation' => 80, 'type' => 80, 'source' => 500, 'volume' => 40, 'numero' => 40, 'pages' => 40, 'doi' => 190][$champ] ?? 500;
    }

    private function listeJson(string $v): string
    {
        $d = json_decode($v === '' ? '[]' : $v, true);
        return (string) json_encode(is_array($d) ? array_values($d) : [], JSON_UNESCAPED_UNICODE);
    }

    private function nettoyerMessage(string $m): string
    {
        return mb_substr((string) preg_replace('/[^\p{L} :()-]/u', '', $m), 0, 80);
    }

    /** @param list<string> $chemins */
    private function supprimerDuDisque(array $chemins): void
    {
        if ($this->aBlanc) {
            return;   // à blanc : rien ne doit quitter le disque
        }
        $racine = realpath($this->config->dossierPrive() . '/fichiers');
        foreach ($chemins as $c) {
            $reel = $racine === false ? false : realpath($racine . '/' . $c);
            if ($reel !== false && str_starts_with($reel, $racine . DIRECTORY_SEPARATOR) && is_file($reel)) {
                @unlink($reel);
            }
        }
    }

    private function retirerEcrits(): void
    {
        foreach ($this->ecrits as $f) {
            @unlink($f);
        }
        $this->ecrits = [];
    }

    // ---------- Point d'entrée web, protégé par jeton ----------

    /**
     * POST avec l'en-tête X-Migration-Token (le même jeton que les migrations). Paramètres facultatifs (requête) : a_blanc=1,
     * supprimer=1, fichiers=0. Désactivé tant que la section « import » (sheet_id et cle_json du compte de service) manque de config.php.
     */
    public static function executerWeb(): void
    {
        Http::entetes();
        try {
            $config = Config::charger();
            $attendu = strtolower((string) $config->get('migration_jeton_sha256', ''));
            $cfg = $config->get('import');
            if (preg_match('/^[0-9a-f]{64}$/', $attendu) !== 1 || !is_array($cfg) || empty($cfg['sheet_id']) || empty($cfg['cle_json'])) {
                http_response_code(404);
                Http::json(['ok' => false, 'error' => 'not_found', 'message' => 'Import non configuré']);
                return;
            }
            if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
                http_response_code(405);
                Http::json(['ok' => false, 'error' => 'bad_request']);
                return;
            }
            $jeton = (string) ($_SERVER['HTTP_X_MIGRATION_TOKEN'] ?? '');
            if ($jeton === '' || !hash_equals($attendu, hash('sha256', $jeton))) {
                usleep(500000);
                http_response_code(403);
                Http::json(['ok' => false, 'error' => 'forbidden']);
                return;
            }
            $cle = json_decode((string) $cfg['cle_json'], true);
            if (!is_array($cle)) {
                throw new \RuntimeException('cle_json : JSON invalide');
            }
            $db = new Db($config);
            $verrou = $db->principale()->query("SELECT GET_LOCK('lpc_import', 0)")->fetchColumn();
            if ((int) $verrou !== 1) {
                http_response_code(409);
                Http::json(['ok' => false, 'error' => 'busy', 'message' => 'Un import est déjà en cours']);
                return;
            }
            try {
                $api = new GoogleApi($cle);
                $imp = new self($config, $db, $api->onglets((string) $cfg['sheet_id'], array_keys(self::COLONNES)), static fn (string $id): string => $api->fichier($id),
                    ($_GET['a_blanc'] ?? '') === '1', ($_GET['supprimer'] ?? '') === '1', ($_GET['fichiers'] ?? '1') !== '0');
                $rapport = $imp->executer();
            } finally {
                $db->principale()->query("SELECT RELEASE_LOCK('lpc_import')");
            }
            Http::json(['ok' => true] + $rapport);
        } catch (\Throwable $e) {
            error_log(sprintf('Import : %s dans %s:%d', $e->getMessage(), $e->getFile(), $e->getLine()));
            http_response_code(500);
            Http::json(['ok' => false, 'error' => 'server', 'message' => $e instanceof \RuntimeException ? $e->getMessage() : 'Erreur serveur']);
        }
    }
}
