<?php
// Tests d'intégration contre de vraies bases (schéma déjà appliqué par bin/migrer.php) :
//   LPC_CONFIG=/chemin/config.php php tests/integration.php
// Rejoue le chemin complet d'une requête : jeton Google signé -> Auth -> Droits -> Routeur -> base.
// ATTENTION : écrit dans les bases de la configuration. À n'utiliser que sur des bases de test vides.
declare(strict_types=1);

require dirname(__DIR__) . '/api/src/autoload.php';
require __DIR__ . '/outils.php';

use Lpc\Attributions;
use Lpc\Auth;
use Lpc\Config;
use Lpc\Db;
use Lpc\Droits;
use Lpc\Erreur;
use Lpc\GoogleJeton;
use Lpc\Ids;
use Lpc\Routeur;

$config = Config::charger(getenv('LPC_CONFIG') ?: null);
$db = new Db($config);
$pdo = $db->principale();
$chat = $db->chat();

$n = (int) $pdo->query('SELECT COUNT(*) FROM utilisateurs')->fetchColumn();
if ($n !== 0) {
    fwrite(STDERR, "Refus : la base principale n'est pas vide ($n utilisateurs). Ces tests exigent une base de test vide.\n");
    exit(2);
}

[$cle, $jwk] = pairedeCles();
$google = new GoogleJeton(
    $config->clientIdGoogle(),
    sys_get_temp_dir() . '/lpc-int-' . bin2hex(random_bytes(4)),
    static fn (string $url): array => ['corps' => json_encode(['keys' => [$jwk]]), 'max_age' => 3600]
);
$routeur = new Routeur($config, $db, new Auth($config, $db, $google));

/** @return array<string,mixed> réponse du routeur, ou {ok:false,error,message} si une Erreur est levée */
function appel(string $email, string $action, array $plus = []): array
{
    global $cle, $routeur, $config;
    $jeton = fabrique($cle, [
        'iss' => 'https://accounts.google.com', 'aud' => $config->clientIdGoogle(), 'email' => $email,
        'email_verified' => true, 'iat' => time() - 10, 'exp' => time() + 3000,
    ]);
    try {
        return $routeur->traiter(array_merge(['action' => $action, 'token' => $jeton], $plus));
    } catch (Erreur $e) {
        return ['ok' => false, 'error' => $e->codeErreur, 'message' => $e->getMessage()];
    }
}

function valeur(PDO $pdo, string $sql, array $params = []): mixed
{
    $st = $pdo->prepare($sql);
    $st->execute($params);
    $v = $st->fetchColumn();
    return $v === false ? null : $v;
}

function creerUtilisateur(PDO $pdo, string $email, string $statut = 'actif'): int
{
    $now = gmdate('Y-m-d H:i:s');
    $pdo->prepare('INSERT INTO utilisateurs (pid, email, statut, cree_le) VALUES (?, ?, ?, ?)')
        ->execute([Ids::pid($email), $email, $statut, $now]);
    return (int) $pdo->lastInsertId();
}

function creerEtablissement(PDO $pdo, string $nom): string
{
    $id = Ids::uuid();
    $pdo->prepare('INSERT INTO etablissements (id, nom, cree_le) VALUES (?, ?, ?)')->execute([$id, $nom, gmdate('Y-m-d H:i:s')]);
    return $id;
}

function creerPromo(PDO $pdo, string $etab, string $nom): string
{
    $id = Ids::uuid();
    $pdo->prepare('INSERT INTO promos (id, etablissement_id, nom, cree_le) VALUES (?, ?, ?, ?)')->execute([$id, $etab, $nom, gmdate('Y-m-d H:i:s')]);
    return $id;
}

// ---------- Connexion : adresses inconnues, en attente, refusées ----------
verifie('jeton invalide refusé', leve(fn () => $routeur->traiter(['action' => 'init', 'token' => 'x.y.z']), 'unauthorized'));
verifie('absence de jeton refusée', leve(fn () => $routeur->traiter(['action' => 'init']), 'unauthorized', 'Connexion requise'));
verifie('action manquante refusée', leve(fn () => $routeur->traiter([]), 'bad_request'));

$r = appel('nouvelle@ci.test', 'init');
verifie('adresse inconnue : « pending »', ($r['error'] ?? '') === 'pending');
verifie('adresse inconnue : demande enregistrée en attente', valeur($pdo, 'SELECT statut FROM utilisateurs WHERE email = ?', ['nouvelle@ci.test']) === 'en_attente');
verifie('en attente : « pending » à nouveau', (appel('nouvelle@ci.test', 'init')['error'] ?? '') === 'pending');
verifie('en attente : une seule ligne', (int) valeur($pdo, 'SELECT COUNT(*) FROM utilisateurs WHERE email = ?', ['nouvelle@ci.test']) === 1);
verifie('en attente : actions d\'accueil autorisées', (appel('nouvelle@ci.test', 'onboarding')['error'] ?? '') === 'not_implemented');
verifie('inconnue : actions d\'accueil autorisées', (appel('inconnue@ci.test', 'onboarding')['error'] ?? '') === 'not_implemented');
verifie('inconnue : l\'accueil ne crée aucune ligne', (int) valeur($pdo, 'SELECT COUNT(*) FROM utilisateurs WHERE email = ?', ['inconnue@ci.test']) === 0);

creerUtilisateur($pdo, 'refuse@ci.test', 'refuse');
verifie('accès refusé : « forbidden »', (appel('refuse@ci.test', 'init')['error'] ?? '') === 'forbidden');

// ---------- Administrateur de la configuration ----------
$r = appel($config->emailAdmin(), 'init');
verifie('admin : ok', ($r['ok'] ?? false) === true);
verifie('admin : rôle « admin »', ($r['me']['role'] ?? '') === 'admin');
verifie('admin : doit consentir', ($r['me']['consentement'] ?? null) === false);
verifie('admin : version de consentement annoncée', ($r['me']['consent_version'] ?? '') === Config::CONSENT_VERSION);
appel($config->emailAdmin(), 'init');
$idAdmin = (int) valeur($pdo, 'SELECT id FROM utilisateurs WHERE email = ?', [$config->emailAdmin()]);
verifie('admin : un seul rôle global, même après deux connexions', (int) valeur($pdo, "SELECT COUNT(*) FROM attributions WHERE utilisateur_id = ? AND role = 'admin'", [$idAdmin]) === 1);
verifie('admin : discret (aucune présence)', (int) valeur($chat, 'SELECT COUNT(*) FROM presence WHERE utilisateur_id = ?', [$idAdmin]) === 0);
verifie('action inconnue : « bad_request »', (appel($config->emailAdmin(), 'nimporte_quoi')['error'] ?? '') === 'bad_request');
verifie('action connue mais pas migrée : « not_implemented »', (appel($config->emailAdmin(), 'list')['error'] ?? '') === 'not_implemented');

// ---------- Étudiante : rôle, consentement, nom affiché, présence ----------
$etab = creerEtablissement($pdo, 'IFSI Saint-Nazaire');
$etab2 = creerEtablissement($pdo, 'IFSI Nantes');
$promo = creerPromo($pdo, $etab, 'Promo 24-27');
$promo2 = creerPromo($pdo, $etab, 'Promo 25-28');
$promo3 = creerPromo($pdo, $etab2, 'Promo 24-27');

$etu = creerUtilisateur($pdo, 'etu@ci.test');
Attributions::ajouter($pdo, $etu, 'etudiant', null, $promo);
$r = appel('etu@ci.test', 'init');
verifie('étudiante : rôle « etudiant »', ($r['me']['role'] ?? '') === 'etudiant');
verifie('étudiante : consentement à donner', ($r['me']['consentement'] ?? null) === false);
$pdo->prepare('UPDATE utilisateurs SET consentement_version = ?, prenom = ?, nom = ? WHERE id = ?')->execute([Config::CONSENT_VERSION, 'Marie', 'dupont', $etu]);
$r = appel('etu@ci.test', 'init');
verifie('étudiante : consentement donné', ($r['me']['consentement'] ?? null) === true);
verifie('nom affiché : prénom + initiale du nom', ($r['me']['prenom'] ?? '') === 'Marie D.');
$pdo->prepare('UPDATE utilisateurs SET pseudo = ? WHERE id = ?')->execute(['Mimi', $etu]);
verifie('nom affiché : le pseudo prime', (appel('etu@ci.test', 'init')['me']['prenom'] ?? '') === 'Mimi');
verifie('dernière connexion enregistrée', valeur($pdo, 'SELECT derniere_connexion FROM utilisateurs WHERE id = ?', [$etu]) !== null);
verifie('présence enregistrée dans la base du chat', (int) valeur($chat, 'SELECT COUNT(*) FROM presence WHERE utilisateur_id = ?', [$etu]) === 1);
appel('etu@ci.test', 'bye');
verifie('« bye » retire la présence', (int) valeur($chat, 'SELECT COUNT(*) FROM presence WHERE utilisateur_id = ?', [$etu]) === 0);

// ---------- Droits : hiérarchie et périmètres ----------
$admSite = creerUtilisateur($pdo, 'site@ci.test');
Attributions::ajouter($pdo, $admSite, 'admin_site', $etab);
$admPromo = creerUtilisateur($pdo, 'promo@ci.test');
Attributions::ajouter($pdo, $admPromo, 'admin_promo', null, $promo);
$formateur = creerUtilisateur($pdo, 'formateur@ci.test');
Attributions::ajouter($pdo, $formateur, 'formateur', $etab);

$d = static fn (int $id): Droits => new Droits($pdo, $id);
verifie('admin global : administre tout', $d($idAdmin)->peutAdministrerPromo($promo3) && $d($idAdmin)->peutAdministrerEtablissement($etab2));
verifie('admin de site : toutes les promos de son établissement', $d($admSite)->peutAdministrerPromo($promo) && $d($admSite)->peutAdministrerPromo($promo2));
verifie('admin de site : pas un autre établissement', !$d($admSite)->peutAdministrerPromo($promo3) && !$d($admSite)->peutAdministrerEtablissement($etab2));
verifie('admin de promo : sa promo seulement', $d($admPromo)->peutAdministrerPromo($promo) && !$d($admPromo)->peutAdministrerPromo($promo2));
verifie('admin de promo : pas l\'établissement', !$d($admPromo)->peutAdministrerEtablissement($etab));
verifie('étudiante : n\'administre rien', !$d($etu)->peutAdministrerPromo($promo) && !$d($etu)->estAdminQuelconque());
verifie('étudiante : étudiante de sa promo seulement', $d($etu)->estEtudiantDans($promo) && !$d($etu)->estEtudiantDans($promo2));
verifie('formateur : rattaché à l\'établissement, n\'administre rien', $d($formateur)->estFormateurSur($etab) && !$d($formateur)->peutAdministrerPromo($promo));
verifie('personne sans rôle : n\'administre rien', !$d(creerUtilisateur($pdo, 'sansrole@ci.test'))->estAdminQuelconque());

$groupe = Ids::uuid();
$pdo->prepare('INSERT INTO groupes (id, promo_id, nom, cree_le) VALUES (?, ?, ?, ?)')->execute([$groupe, $promo, 'Les petits chercheurs', gmdate('Y-m-d H:i:s')]);
verifie('droits d\'un groupe = droits de sa promo', $d($admPromo)->peutAdministrerGroupe($groupe) && !$d($formateur)->peutAdministrerGroupe($groupe));
verifie('groupe inconnu : aucun droit', !$d($admPromo)->peutAdministrerGroupe(Ids::uuid()));

verifie('rôle d\'interface : admin de promo sans promo étudiante = formateur', (appel('promo@ci.test', 'init')['me']['role'] ?? '') === 'formateur');
verifie('rôle détaillé renvoyé (me.roles)', ($r = appel('promo@ci.test', 'init')['me']['roles'] ?? []) !== [] && $r[0]['role'] === 'admin_promo');

// ---------- Attributions : cohérence, doublons, cumul ----------
verifie('étudiante rattachée à un établissement : refusé', leve(fn () => Attributions::ajouter($pdo, $etu, 'etudiant', $etab, null), 'invalid'));
verifie('étudiante sans promo : refusé', leve(fn () => Attributions::ajouter($pdo, $etu, 'etudiant'), 'invalid'));
verifie('admin avec périmètre : refusé', leve(fn () => Attributions::ajouter($pdo, $etu, 'admin', $etab), 'invalid'));
verifie('rôle inconnu : refusé', leve(fn () => Attributions::ajouter($pdo, $etu, 'pirate', $etab), 'invalid'));
verifie('rôle déjà attribué : pas de doublon', Attributions::ajouter($pdo, $etu, 'etudiant', null, $promo) === false);
verifie('cumul : étudiante sur une deuxième promo', Attributions::ajouter($pdo, $etu, 'etudiant', null, $promo2) === true);
verifie('cumul : étudiante et admin de promo', Attributions::ajouter($pdo, $etu, 'admin_promo', null, $promo2) === true);
verifie('cumul : formateur sur deux établissements', Attributions::ajouter($pdo, $formateur, 'formateur', $etab2) === true);

// ---------- Contraintes de la base (portabilité MariaDB / MySQL) ----------
verifie('établissement : nom unique sans tenir compte de la casse ni des accents', leveSql(fn () => creerEtablissement($pdo, 'ifsi saint-nazairé'), '23000'));
verifie('promo : nom unique dans l\'établissement', leveSql(fn () => creerPromo($pdo, $etab, 'promo 24-27'), '23000'));
verifie('même nom de promo dans un autre établissement : permis', creerPromo($pdo, $etab2, 'Promo 25-28') !== '');
verifie('adresse unique (insensible à la casse)', leveSql(fn () => creerUtilisateur($pdo, 'ETU@ci.test'), '23000'));
verifie('mode strict : valeur trop longue refusée', leveSql(fn () => $pdo->prepare('UPDATE utilisateurs SET prenom = ? WHERE id = ?')->execute([str_repeat('a', 200), $etu]), '22001'));
verifie('énumération : statut inconnu refusé', refuseSql(fn () => $pdo->prepare('UPDATE utilisateurs SET statut = ? WHERE id = ?')->execute(['inconnu', $etu])));

// ---------- Suppressions en cascade ----------
$art = Ids::uuid();
$pdo->prepare('INSERT INTO articles (id, cree_par, groupe_id, ajoute, titre) VALUES (?, ?, ?, ?, ?)')->execute([$art, $etu, $groupe, gmdate('Y-m-d H:i:s'), 'Titre']);
$pdo->prepare('DELETE FROM groupes WHERE id = ?')->execute([$groupe]);
verifie('groupe supprimé : l\'article reste (base de partage durable)', valeur($pdo, 'SELECT titre FROM articles WHERE id = ?', [$art]) === 'Titre');
verifie('groupe supprimé : l\'article n\'a plus de groupe', valeur($pdo, 'SELECT groupe_id FROM articles WHERE id = ?', [$art]) === null);

$pdo->prepare('DELETE FROM promos WHERE id = ?')->execute([$promo2]);
verifie('promo supprimée : ses attributions disparaissent', (int) valeur($pdo, 'SELECT COUNT(*) FROM attributions WHERE promo_id = ?', [$promo2]) === 0);
$pdo->prepare('DELETE FROM utilisateurs WHERE id = ?')->execute([$etu]);
verifie('personne supprimée : ses attributions disparaissent', (int) valeur($pdo, 'SELECT COUNT(*) FROM attributions WHERE utilisateur_id = ?', [$etu]) === 0);
verifie('personne supprimée : ses articles restent, sans auteur', valeur($pdo, 'SELECT cree_par FROM articles WHERE id = ?', [$art]) === null);

bilan();
