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
verifie('action connue mais pas migrée : « not_implemented »', (appel($config->emailAdmin(), 'add')['error'] ?? '') === 'not_implemented');

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

// ---------- Lot A : consentement, pseudo, changement de nom ----------
$admin = $config->emailAdmin();
$simple = creerUtilisateur($pdo, 'simple@ci.test');
Attributions::ajouter($pdo, $simple, 'etudiant', null, $promo);
$pdo->prepare('UPDATE utilisateurs SET prenom = ?, nom = ?, couleur = ? WHERE id = ?')->execute(['Paul', 'Martin', '#3cb44b', $simple]);
$autre = creerUtilisateur($pdo, 'autre@ci.test');
Attributions::ajouter($pdo, $autre, 'admin_promo', null, $promo3);
$neuf = creerUtilisateur($pdo, 'neuf@ci.test');
Attributions::ajouter($pdo, $neuf, 'etudiant', null, $promo);

$err = static fn (array $r): string => (string) ($r['error'] ?? '');

verifie('consentement refusé sans geste explicite', $err(appel('simple@ci.test', 'consentement', ['data' => ['consentement' => false]])) === 'invalid');
verifie('consentement : données absentes refusées', $err(appel('simple@ci.test', 'consentement')) === 'invalid');
verifie('consentement enregistré', (appel('simple@ci.test', 'consentement', ['data' => ['consentement' => true]])['ok'] ?? false) === true
    && valeur($pdo, 'SELECT consentement_version FROM utilisateurs WHERE id = ?', [$simple]) === Config::CONSENT_VERSION);
verifie('consentement daté', valeur($pdo, 'SELECT consentement_le FROM utilisateurs WHERE id = ?', [$simple]) !== null);
verifie('init : consentement reconnu', (appel('simple@ci.test', 'init')['me']['consentement'] ?? null) === true);

$r = appel('simple@ci.test', 'profile_update', ['data' => ['pseudo' => 'Pau-Pau']]);
verifie('pseudo modifié', ($r['me']['prenom'] ?? '') === 'Pau-Pau');
verifie('pseudo : la réponse porte aussi les données', array_key_exists('groupes', $r));
verifie('pseudo : le prénom ne se modifie pas', $err(appel('simple@ci.test', 'profile_update', ['data' => ['prenom' => 'Pierre']])) === 'forbidden');
verifie('pseudo : le nom ne se modifie pas', $err(appel('simple@ci.test', 'profile_update', ['data' => ['nom' => 'Autre', 'pseudo' => 'x']])) === 'forbidden');
verifie('pseudo : caractères interdits refusés', $err(appel('simple@ci.test', 'profile_update', ['data' => ['pseudo' => '<b>x']])) === 'invalid');
verifie('pseudo : « Administrateur » réservé', $err(appel('simple@ci.test', 'profile_update', ['data' => ['pseudo' => 'administrateur']])) === 'invalid');
verifie('pseudo : trop long refusé', $err(appel('simple@ci.test', 'profile_update', ['data' => ['pseudo' => str_repeat('a', 41)]])) === 'invalid');
verifie('pseudo : champ absent refusé', $err(appel('simple@ci.test', 'profile_update', ['data' => ['x' => 1]])) === 'invalid');
verifie('pseudo vidé : retour à « prénom + initiale »', (appel('simple@ci.test', 'profile_update', ['data' => ['pseudo' => '  ']])['me']['prenom'] ?? '') === 'Paul M.');

verifie('demande de nom identique refusée', $err(appel('simple@ci.test', 'nom_demande', ['data' => ['prenom' => 'paul', 'nom' => 'MARTIN']])) === 'invalid');
verifie('demande de nom invalide refusée', $err(appel('simple@ci.test', 'nom_demande', ['data' => ['prenom' => 'Pa1', 'nom' => 'Martin']])) === 'invalid');
verifie('demande de nom enregistrée', (appel('simple@ci.test', 'nom_demande', ['data' => ['prenom' => 'Paul-Henri', 'nom' => 'Martin']])['ok'] ?? false) === true);
verifie('une seule demande en attente à la fois', $err(appel('simple@ci.test', 'nom_demande', ['data' => ['prenom' => 'Pierre', 'nom' => 'Martin']])) === 'invalid');
verifie('le prénom ne change pas avant validation', valeur($pdo, 'SELECT prenom FROM utilisateurs WHERE id = ?', [$simple]) === 'Paul');
$r = appel('promo@ci.test', 'nom_demandes');
verifie('admin de promo : voit la demande de sa promo', count($r['demandes'] ?? []) === 1 && ($r['demandes'][0]['prenom'] ?? '') === 'Paul-Henri');
$demande = (int) ($r['demandes'][0]['id'] ?? 0);
verifie('étudiante simple : aucune demande à traiter', (appel('simple@ci.test', 'nom_demandes')['demandes'] ?? null) === []);
verifie('admin d\'une autre promo : ne voit pas la demande', (appel('autre@ci.test', 'nom_demandes')['demandes'] ?? null) === []);
verifie('admin d\'une autre promo : décision refusée', $err(appel('autre@ci.test', 'nom_decision', ['data' => ['id' => $demande, 'accepte' => true]])) === 'forbidden');
verifie('étudiante simple : décision refusée', $err(appel('simple@ci.test', 'nom_decision', ['data' => ['id' => $demande, 'accepte' => true]])) === 'forbidden');
$r = appel('promo@ci.test', 'nom_decision', ['data' => ['id' => $demande, 'accepte' => true]]);
verifie('admin de promo : demande acceptée', ($r['ok'] ?? false) === true && ($r['demandes'] ?? null) === []);
verifie('prénom mis à jour après acceptation', valeur($pdo, 'SELECT prenom FROM utilisateurs WHERE id = ?', [$simple]) === 'Paul-Henri');
verifie('demande marquée acceptée', valeur($pdo, 'SELECT statut FROM demandes_nom WHERE id = ?', [$demande]) === 'accepte');
verifie('décision journalisée', (int) valeur($pdo, "SELECT COUNT(*) FROM journal_admin WHERE action = 'nom_decision'") === 1);
verifie('demande déjà traitée : introuvable', $err(appel('promo@ci.test', 'nom_decision', ['data' => ['id' => $demande, 'accepte' => true]])) === 'not_found');
appel('simple@ci.test', 'nom_demande', ['data' => ['prenom' => 'Pierre', 'nom' => 'Martin']]);
$d2 = (int) valeur($pdo, "SELECT id FROM demandes_nom WHERE statut = 'en_attente'");
verifie('admin global : demande refusée', (appel($admin, 'nom_decision', ['data' => ['id' => $d2, 'accepte' => false]])['ok'] ?? false) === true
    && valeur($pdo, 'SELECT statut FROM demandes_nom WHERE id = ?', [$d2]) === 'refuse'
    && valeur($pdo, 'SELECT prenom FROM utilisateurs WHERE id = ?', [$simple]) === 'Paul-Henri');

// ---------- Lot A : structure et droits par périmètre ----------
verifie('étudiante : création d\'établissement refusée', $err(appel('simple@ci.test', 'etab_create', ['data' => ['nom' => 'X']])) === 'forbidden');
verifie('admin de site : création d\'établissement refusée', $err(appel('site@ci.test', 'etab_create', ['data' => ['nom' => 'X']])) === 'forbidden');
$r = appel($admin, 'etab_create', ['data' => ['nom' => 'IFSI Brest']]);
verifie('admin : établissement créé et renvoyé dans la structure', ($r['ok'] ?? false) === true && in_array('IFSI Brest', array_column($r['structure'] ?? [], 'nom'), true));
verifie('établissement en double refusé (casse et accents)', $err(appel($admin, 'etab_create', ['data' => ['nom' => 'ifsi brést']])) === 'invalid');
verifie('établissement sans nom refusé', $err(appel($admin, 'etab_create', ['data' => ['nom' => '  ']])) === 'invalid');
$brest = (string) valeur($pdo, 'SELECT id FROM etablissements WHERE nom = ?', ['IFSI Brest']);

$r = appel('site@ci.test', 'promo_create', ['data' => ['etablissement_id' => $etab, 'nom' => 'Promo 26-29']]);
verifie('admin de site : promo créée dans son établissement', ($r['ok'] ?? false) === true);
verifie('admin de site : ne voit que son établissement', array_column($r['structure'] ?? [], 'nom') === ['IFSI Saint-Nazaire']);
verifie('admin de site : promo dans un autre établissement refusée', $err(appel('site@ci.test', 'promo_create', ['data' => ['etablissement_id' => $etab2, 'nom' => 'P']])) === 'forbidden');
verifie('admin de promo : création de promo refusée', $err(appel('promo@ci.test', 'promo_create', ['data' => ['etablissement_id' => $etab, 'nom' => 'P']])) === 'forbidden');
verifie('promo en double refusée', $err(appel('site@ci.test', 'promo_create', ['data' => ['etablissement_id' => $etab, 'nom' => 'promo 26-29']])) === 'invalid');
verifie('établissement inconnu refusé', $err(appel($admin, 'promo_create', ['data' => ['etablissement_id' => Ids::uuid(), 'nom' => 'P']])) === 'not_found');
$p26 = (string) valeur($pdo, 'SELECT id FROM promos WHERE etablissement_id = ? AND nom = ?', [$etab, 'Promo 26-29']);
verifie('promo renommée', (appel('site@ci.test', 'promo_rename', ['data' => ['id' => $p26, 'nom' => 'Promo 26-29 bis']])['ok'] ?? false) === true);
verifie('renommage : collision refusée', $err(appel('site@ci.test', 'promo_rename', ['data' => ['id' => $p26, 'nom' => 'promo 24-27']])) === 'invalid');
verifie('admin d\'une autre promo : renommage refusé', $err(appel('autre@ci.test', 'promo_rename', ['data' => ['id' => $p26, 'nom' => 'Z']])) === 'forbidden');
verifie('admin de site : établissement renommé', (appel('site@ci.test', 'etab_rename', ['data' => ['id' => $etab, 'nom' => 'IFSI Saint-Nazaire']])['ok'] ?? false) === true);
verifie('admin de site : autre établissement non renommable', $err(appel('site@ci.test', 'etab_rename', ['data' => ['id' => $etab2, 'nom' => 'Z']])) === 'forbidden');

$r = appel('promo@ci.test', 'group_create', ['data' => ['promo_id' => $promo, 'nom' => 'Groupe B', 'membres' => ['simple@ci.test', 'etu@ci.test']]]);
$gb = (string) valeur($pdo, 'SELECT id FROM groupes WHERE promo_id = ? AND nom = ?', [$promo, 'Groupe B']);
verifie('admin de promo : groupe créé avec ses membres', ($r['ok'] ?? false) === true && $gb !== ''
    && (int) valeur($pdo, 'SELECT COUNT(*) FROM membres WHERE groupe_id = ?', [$gb]) === 2);
verifie('admin de promo : groupe renvoyé dans « groupes » et « groupesAdmin »', in_array('Groupe B', array_column($r['groupes'] ?? [], 'nom'), true)
    && in_array('Groupe B', array_column($r['groupesAdmin'] ?? [], 'nom'), true));
verifie('groupe en double refusé (casse)', $err(appel('promo@ci.test', 'group_create', ['data' => ['promo_id' => $promo, 'nom' => 'groupe b']])) === 'invalid');
verifie('étudiant déjà dans un groupe de la promo : refusé', $err(appel('promo@ci.test', 'group_create', ['data' => ['promo_id' => $promo, 'nom' => 'Groupe C', 'membres' => ['simple@ci.test']]])) === 'invalid');
verifie('membre inconnu refusé', $err(appel('promo@ci.test', 'group_create', ['data' => ['promo_id' => $promo, 'nom' => 'Groupe C', 'membres' => ['personne@ci.test']]])) === 'not_found');
$r = appel('promo@ci.test', 'group_create', ['data' => ['promo_id' => $promo, 'nom' => 'Groupe C', 'membres' => ['neuf@ci.test', 'NEUF@ci.test']]]);
verifie('membre indiqué deux fois refusé', $err($r) === 'invalid' && str_contains((string) ($r['message'] ?? ''), 'deux fois'));
verifie('groupe dans une promo non administrée : refusé', $err(appel('promo@ci.test', 'group_create', ['data' => ['promo_id' => $promo3, 'nom' => 'G']])) === 'forbidden');
verifie('groupe par noms : réservé à l\'admin global', $err(appel('site@ci.test', 'group_create', ['data' => ['etablissement' => 'IFSI Saint-Nazaire', 'promo' => 'Promo 24-27', 'nom' => 'G']])) === 'invalid');
verifie('étudiante simple : création de groupe refusée', $err(appel('simple@ci.test', 'group_create', ['data' => ['promo_id' => $promo, 'nom' => 'G']])) === 'forbidden');
$r = appel($admin, 'group_create', ['data' => ['etablissement' => 'IFSI Lorient', 'promo' => 'Promo 24-27', 'nom' => 'G1']]);
verifie('admin : groupe créé avec établissement et promo créés au besoin', ($r['ok'] ?? false) === true
    && (int) valeur($pdo, 'SELECT COUNT(*) FROM promos p JOIN etablissements e ON e.id = p.etablissement_id WHERE e.nom = ?', ['IFSI Lorient']) === 1);
verifie('groupe renommé', (appel('promo@ci.test', 'group_update', ['data' => ['id' => $gb, 'nom' => 'Groupe Bleu']])['ok'] ?? false) === true
    && valeur($pdo, 'SELECT nom FROM groupes WHERE id = ?', [$gb]) === 'Groupe Bleu');
verifie('groupe déplacé vers une promo non administrée : refusé', $err(appel('promo@ci.test', 'group_update', ['data' => ['id' => $gb, 'promo_id' => $promo3]])) === 'forbidden');
verifie('groupe inconnu : introuvable', $err(appel('promo@ci.test', 'group_update', ['data' => ['id' => Ids::uuid(), 'nom' => 'Z']])) === 'not_found');

// ---------- Lot A : ce que renvoie « init » ----------
$r = appel('simple@ci.test', 'init');
verifie('init : le groupe de l\'étudiante', array_column($r['groupes'] ?? [], 'nom') === ['Groupe Bleu']);
verifie('init : membres désignés par identifiant public, sans adresse', count($r['groupes'][0]['membres'] ?? []) === 2
    && isset($r['groupes'][0]['membres'][0]['pid']) && !isset($r['groupes'][0]['membres'][0]['email']));
verifie('init : un seul membre « moi »', count(array_filter($r['groupes'][0]['membres'] ?? [], static fn (array $m): bool => $m['moi'] === true)) === 1);
verifie('init : camarades étudiants du groupe', count($r['utilisateurs'] ?? []) === 2);
verifie('init : « en ligne » contient la personne', count(array_filter($r['enLigne'] ?? [], static fn (array $m): bool => $m['moi'] === true)) === 1);
verifie('init : aucune section d\'administration pour une étudiante simple', !array_key_exists('structure', $r) && !array_key_exists('groupesAdmin', $r));
verifie('init : aucune demande à traiter pour une étudiante simple', ($r['enAttente'] ?? -1) === 0);
verifie('init : « me » inchangé', ($r['me']['role'] ?? '') === 'etudiant');
$r = appel('promo@ci.test', 'init');
verifie('admin de promo : « groupesAdmin » limité à sa promo', $r['groupesAdmin'] !== [] && array_unique(array_column($r['groupesAdmin'], 'promo')) === ['Promo 24-27']);
verifie('admin de promo : voit les adresses des membres de ses groupes', isset($r['groupesAdmin'][0]['membres'][0]['email']) || $r['groupesAdmin'][0]['membres'] === []);
$r = appel($admin, 'init');
verifie('admin : demandes d\'accès en attente comptées', ($r['enAttente'] ?? 0) >= 1);
verifie('admin : voit tous les groupes', count($r['groupes'] ?? []) >= 3);
verifie('admin : camarades = tous les étudiants actifs', count($r['utilisateurs'] ?? []) >= 3);
verifie('list : mêmes sections sans « me »', ($l = appel('simple@ci.test', 'list')) && !array_key_exists('me', $l) && array_key_exists('groupes', $l));

// ---------- Lot A : suppressions ----------
verifie('promo avec groupes : suppression refusée', $err(appel($admin, 'promo_delete', ['id' => $promo])) === 'invalid');
verifie('établissement avec promos : suppression refusée', $err(appel($admin, 'etab_delete', ['id' => $etab])) === 'invalid');
verifie('admin de site : suppression d\'établissement refusée', $err(appel('site@ci.test', 'etab_delete', ['id' => $brest])) === 'forbidden');
verifie('étudiante simple : suppression de groupe refusée', $err(appel('simple@ci.test', 'group_delete', ['id' => $gb])) === 'forbidden');
verifie('groupe inconnu : suppression introuvable', $err(appel('promo@ci.test', 'group_delete', ['id' => Ids::uuid()])) === 'not_found');
verifie('admin de promo : groupe supprimé', (appel('promo@ci.test', 'group_delete', ['id' => $gb])['ok'] ?? false) === true
    && (int) valeur($pdo, 'SELECT COUNT(*) FROM membres WHERE groupe_id = ?', [$gb]) === 0);
verifie('établissement vide supprimé par l\'admin', (appel($admin, 'etab_delete', ['id' => $brest])['ok'] ?? false) === true
    && valeur($pdo, 'SELECT id FROM etablissements WHERE id = ?', [$brest]) === null);
verifie('promo vide supprimée par l\'admin de site', (appel('site@ci.test', 'promo_delete', ['id' => $p26])['ok'] ?? false) === true);

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
