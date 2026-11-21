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
verifie('en attente : actions d\'accueil autorisées', (appel('nouvelle@ci.test', 'onboarding')['ok'] ?? false) === true);
verifie('inconnue : actions d\'accueil autorisées', (appel('inconnue@ci.test', 'onboarding')['ok'] ?? false) === true);
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

// ---------- Lot B1 : schéma et migrations ----------
$rejeu = \Lpc\Migrations::appliquer($pdo, \Lpc\Migrations::FICHIERS['principale'], dirname(__DIR__) . '/api/sql');
verifie('migrations : rejouées sans effet', $rejeu !== [] && count(array_filter($rejeu, static fn (string $l): bool => str_starts_with($l, '='))) === count($rejeu));
verifie('migration 003 : demandes_acces porte le rôle demandé', (int) valeur($pdo, "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'demandes_acces' AND column_name = 'role'") === 1);
verifie('migrations : découpage des instructions', count(\Lpc\Migrations::instructions("-- commentaire\nCREATE TABLE a (x INT);\n/* bloc ; */\nALTER TABLE a ADD y INT;\n")) === 2);

// ---------- Lot B1 : demande d'accès ----------
$ligne = static function (array $r, string $email): ?array {
    foreach ($r['acces'] ?? [] as $a) {
        if ($a['email'] === $email) {
            return $a;
        }
    }
    return null;
};
$r = appel('nouvelle@ci.test', 'onboarding');
verifie('onboarding : structure complète (noms seulement)', ($r['ok'] ?? false) === true && count($r['structure'] ?? []) >= 2 && isset($r['structure'][0]['promos']));
verifie('onboarding : en attente et sans demande', ($r['statut'] ?? '') === 'en_attente' && ($r['demande']['promo_id'] ?? 'x') === '');
$base = ['role' => 'etudiant', 'promo_id' => $promo, 'prenom' => 'Léa', 'nom' => 'Durand', 'consentement' => true];
$demande = static fn (array $plus): array => appel('nouvelle@ci.test', 'onboarding_demande', ['data' => array_merge($base, $plus)]);
verifie('demande : consentement exigé', $err($demande(['consentement' => false])) === 'invalid');
verifie('demande : rôle invalide refusé', $err($demande(['role' => 'admin'])) === 'invalid');
verifie('demande : prénom invalide refusé', $err($demande(['prenom' => 'L3a'])) === 'invalid');
verifie('demande : nom obligatoire', $err($demande(['nom' => ''])) === 'invalid');
verifie('demande : promo à choisir (plusieurs promos)', $err($demande(['promo_id' => ''])) === 'invalid');
verifie('demande : promo inconnue refusée', $err($demande(['promo_id' => Ids::uuid()])) === 'invalid');
$r = $demande([]);
verifie('demande enregistrée', ($r['ok'] ?? false) === true && ($r['demande']['role'] ?? '') === 'etudiant' && str_contains((string) ($r['demande']['promo'] ?? ''), 'Promo 24-27'));
$nouvelle = (int) valeur($pdo, 'SELECT id FROM utilisateurs WHERE email = ?', ['nouvelle@ci.test']);
verifie('demande : prénom, nom et consentement enregistrés', valeur($pdo, 'SELECT prenom FROM utilisateurs WHERE id = ?', [$nouvelle]) === 'Léa'
    && valeur($pdo, 'SELECT nom FROM utilisateurs WHERE id = ?', [$nouvelle]) === 'Durand'
    && valeur($pdo, 'SELECT consentement_version FROM utilisateurs WHERE id = ?', [$nouvelle]) === Config::CONSENT_VERSION);
$demande(['role' => 'formateur', 'promo_id' => $promo3]);
verifie('nouvelle demande : remplace la précédente', (int) valeur($pdo, "SELECT COUNT(*) FROM demandes_acces WHERE utilisateur_id = ? AND statut = 'en_attente'", [$nouvelle]) === 1
    && valeur($pdo, "SELECT role FROM demandes_acces WHERE utilisateur_id = ? AND statut = 'en_attente'", [$nouvelle]) === 'formateur');
$demande([]);
verifie('personne active : ne demande plus', $err(appel('simple@ci.test', 'onboarding_demande', ['data' => $base])) === 'invalid');
verifie('administrateur : pas de demande', $err(appel($admin, 'onboarding_demande', ['data' => $base])) === 'invalid');
$r = appel('prof@ci.test', 'onboarding_demande', ['data' => ['role' => 'formateur', 'promo_id' => $promo, 'prenom' => 'Marc', 'nom' => 'Leroy', 'consentement' => true]]);
verifie('adresse inconnue : compte créé en attente', ($r['ok'] ?? false) === true && valeur($pdo, 'SELECT statut FROM utilisateurs WHERE email = ?', ['prof@ci.test']) === 'en_attente');

// ---------- Lot B1 : liste et validation par périmètre ----------
$r = appel('promo@ci.test', 'admin_list');
verifie('admin de promo : voit la demande d\'étudiante de sa promo', ($l = $ligne($r, 'nouvelle@ci.test')) !== null && $l['statut'] === 'en_attente'
    && $l['demande']['role'] === 'etudiant' && $l['prenom_legal'] === 'Léa');
verifie('admin de promo : voit la demande de formateur de sa promo', $ligne($r, 'prof@ci.test') !== null);
verifie('admin de promo : ne voit pas hors de sa promo', $ligne($r, 'site@ci.test') === null);
verifie('admin d\'une autre promo : ne voit pas la demande', $ligne(appel('autre@ci.test', 'admin_list'), 'nouvelle@ci.test') === null);
verifie('étudiante simple : administration refusée', $err(appel('simple@ci.test', 'admin_list')) === 'forbidden');
$r = appel($admin, 'admin_list');
verifie('admin global : voit tout le monde', count($r['acces'] ?? []) >= 10);
verifie('admin global : stockage renvoyé', isset($r['stockage']['nb']) && array_key_exists('feedbacks', $r));
verifie('liste : rôles détaillés par personne', ($l = $ligne($r, 'simple@ci.test')) !== null && $l['attributions'][0]['role'] === 'etudiant');

verifie('admin d\'une autre promo : validation refusée', $err(appel('autre@ci.test', 'admin_set', ['data' => ['email' => 'nouvelle@ci.test', 'statut' => 'actif']])) === 'forbidden');
verifie('statut invalide refusé', $err(appel('promo@ci.test', 'admin_set', ['data' => ['email' => 'nouvelle@ci.test', 'statut' => 'zzz']])) === 'invalid');
verifie('adresse inconnue refusée', $err(appel('promo@ci.test', 'admin_set', ['data' => ['email' => 'rien@ci.test', 'statut' => 'actif']])) === 'not_found');
verifie('compte administrateur protégé', $err(appel($admin, 'admin_set', ['data' => ['email' => $admin, 'statut' => 'refuse']])) === 'forbidden');
$r = appel('promo@ci.test', 'admin_set', ['data' => ['email' => 'nouvelle@ci.test', 'statut' => 'actif']]);
verifie('admin de promo : étudiante validée', ($r['ok'] ?? false) === true && valeur($pdo, 'SELECT statut FROM utilisateurs WHERE id = ?', [$nouvelle]) === 'actif');
verifie('validation : rôle étudiant de la promo créé', (int) valeur($pdo, "SELECT COUNT(*) FROM attributions WHERE utilisateur_id = ? AND role = 'etudiant' AND promo_id = ?", [$nouvelle, $promo]) === 1);
verifie('validation : couleur de la palette', in_array(valeur($pdo, 'SELECT couleur FROM utilisateurs WHERE id = ?', [$nouvelle]), \Lpc\Utilisateurs::PALETTE_ETUDIANTS, true));
verifie('validation : demande marquée acceptée', valeur($pdo, 'SELECT statut FROM demandes_acces WHERE utilisateur_id = ? ORDER BY id DESC LIMIT 1', [$nouvelle]) === 'accepte');
verifie('validée : se connecte comme étudiante', (appel('nouvelle@ci.test', 'init')['me']['role'] ?? '') === 'etudiant');
verifie('formateur : l\'admin de promo ne le valide pas', $err(appel('promo@ci.test', 'admin_set', ['data' => ['email' => 'prof@ci.test', 'statut' => 'actif']])) === 'forbidden');
verifie('formateur : l\'admin du site le valide', (appel('site@ci.test', 'admin_set', ['data' => ['email' => 'prof@ci.test', 'statut' => 'actif']])['ok'] ?? false) === true);
verifie('formateur validé : rôle sur l\'établissement', (int) valeur($pdo, "SELECT COUNT(*) FROM attributions a JOIN utilisateurs u ON u.id = a.utilisateur_id WHERE u.email = ? AND a.role = 'formateur' AND a.etablissement_id = ?", ['prof@ci.test', $etab]) === 1);
verifie('formateur validé : rôle d\'interface', (appel('prof@ci.test', 'init')['me']['role'] ?? '') === 'formateur');
appel('refus2@ci.test', 'onboarding_demande', ['data' => ['role' => 'etudiant', 'promo_id' => $promo, 'prenom' => 'Noé', 'nom' => 'Blanc', 'consentement' => true]]);
verifie('demande refusée', (appel('promo@ci.test', 'admin_set', ['data' => ['email' => 'refus2@ci.test', 'statut' => 'refuse']])['ok'] ?? false) === true
    && valeur($pdo, 'SELECT statut FROM utilisateurs WHERE email = ?', ['refus2@ci.test']) === 'refuse');
verifie('accès refusé : « forbidden » à la connexion', $err(appel('refus2@ci.test', 'init')) === 'forbidden');
appel('promo@ci.test', 'admin_set', ['data' => ['email' => 'simple@ci.test', 'statut' => 'actif', 'prenom' => 'Zed', 'nom' => 'Zorro', 'couleur' => '#000000']]);
verifie('admin de promo : ne modifie ni prénom, ni nom, ni couleur', valeur($pdo, 'SELECT prenom FROM utilisateurs WHERE id = ?', [$simple]) === 'Paul-Henri'
    && valeur($pdo, 'SELECT couleur FROM utilisateurs WHERE id = ?', [$simple]) === '#3cb44b');
verifie('admin global : couleur invalide refusée', $err(appel($admin, 'admin_set', ['data' => ['email' => 'neuf@ci.test', 'statut' => 'actif', 'couleur' => 'rouge']])) === 'invalid');
verifie('admin global : adresse invalide refusée', $err(appel($admin, 'admin_set', ['data' => ['email' => 'neuf@ci.test', 'statut' => 'actif', 'nouvel_email' => 'pas-une-adresse']])) === 'invalid');
verifie('admin global : adresse déjà utilisée refusée', $err(appel($admin, 'admin_set', ['data' => ['email' => 'neuf@ci.test', 'statut' => 'actif', 'nouvel_email' => 'ETU@ci.test']])) === 'invalid');
$r = appel($admin, 'admin_set', ['data' => ['email' => 'neuf@ci.test', 'statut' => 'actif', 'prenom' => 'Naïs', 'nom' => 'Roux', 'couleur' => '#112233', 'nouvel_email' => 'Neuf2@ci.test']]);
verifie('admin global : prénom, nom, couleur et adresse corrigés', ($r['ok'] ?? false) === true
    && valeur($pdo, 'SELECT prenom FROM utilisateurs WHERE email = ?', ['neuf2@ci.test']) === 'Naïs'
    && valeur($pdo, 'SELECT nom FROM utilisateurs WHERE email = ?', ['neuf2@ci.test']) === 'Roux'
    && valeur($pdo, 'SELECT couleur FROM utilisateurs WHERE email = ?', ['neuf2@ci.test']) === '#112233'
    && valeur($pdo, 'SELECT pid FROM utilisateurs WHERE email = ?', ['neuf2@ci.test']) === Ids::pid('neuf2@ci.test'));
verifie('admin global : ancienne adresse libérée', (int) valeur($pdo, 'SELECT COUNT(*) FROM utilisateurs WHERE email = ?', ['neuf@ci.test']) === 0);

// ---------- Lot B1 : rôles avec périmètre ----------
$r = appel('promo@ci.test', 'attribution_add', ['data' => ['email' => 'neuf2@ci.test', 'role' => 'admin_promo', 'promo_id' => $promo]]);
verifie('admin de promo : donne le rôle d\'admin de sa promo', ($r['ok'] ?? false) === true
    && (int) valeur($pdo, "SELECT COUNT(*) FROM attributions WHERE utilisateur_id = ? AND role = 'admin_promo' AND promo_id = ?", [$neuf, $promo]) === 1);
verifie('admin de promo : pas de rôle d\'admin de site', $err(appel('promo@ci.test', 'attribution_add', ['data' => ['email' => 'neuf2@ci.test', 'role' => 'admin_site', 'etablissement_id' => $etab]])) === 'forbidden');
verifie('admin de promo : pas de rôle d\'admin global', $err(appel('promo@ci.test', 'attribution_add', ['data' => ['email' => 'neuf2@ci.test', 'role' => 'admin']])) === 'forbidden');
verifie('admin de promo : rien hors de sa promo', $err(appel('promo@ci.test', 'attribution_add', ['data' => ['email' => 'neuf2@ci.test', 'role' => 'etudiant', 'promo_id' => $promo3]])) === 'forbidden');
verifie('admin de site : formateur dans son établissement', (appel('site@ci.test', 'attribution_add', ['data' => ['email' => 'neuf2@ci.test', 'role' => 'formateur', 'etablissement_id' => $etab]])['ok'] ?? false) === true);
verifie('admin de site : rien dans un autre établissement', $err(appel('site@ci.test', 'attribution_add', ['data' => ['email' => 'neuf2@ci.test', 'role' => 'formateur', 'etablissement_id' => $etab2]])) === 'forbidden');
verifie('rôle pour une personne refusée : invalide', $err(appel($admin, 'attribution_add', ['data' => ['email' => 'refus2@ci.test', 'role' => 'etudiant', 'promo_id' => $promo]])) === 'invalid');
verifie('périmètre inconnu : introuvable', $err(appel($admin, 'attribution_add', ['data' => ['email' => 'neuf2@ci.test', 'role' => 'etudiant', 'promo_id' => Ids::uuid()]])) === 'not_found');
verifie('rôle inconnu refusé', $err(appel($admin, 'attribution_add', ['data' => ['email' => 'neuf2@ci.test', 'role' => 'roi', 'promo_id' => $promo]])) === 'invalid');
$aid = (int) valeur($pdo, "SELECT id FROM attributions WHERE utilisateur_id = ? AND role = 'admin_promo' AND promo_id = ?", [$neuf, $promo]);
verifie('admin d\'une autre promo : retrait refusé', $err(appel('autre@ci.test', 'attribution_remove', ['data' => ['id' => $aid]])) === 'forbidden');
verifie('rôle retiré par l\'admin de la promo', (appel('promo@ci.test', 'attribution_remove', ['data' => ['id' => $aid]])['ok'] ?? false) === true
    && (int) valeur($pdo, 'SELECT COUNT(*) FROM attributions WHERE id = ?', [$aid]) === 0);
verifie('rôle introuvable', $err(appel($admin, 'attribution_remove', ['data' => ['id' => 999999]])) === 'not_found');
$aidAdmin = (int) valeur($pdo, "SELECT id FROM attributions WHERE utilisateur_id = ? AND role = 'admin'", [$idAdmin]);
verifie('rôle de l\'administrateur de la configuration protégé', $err(appel($admin, 'attribution_remove', ['data' => ['id' => $aidAdmin]])) === 'forbidden');

// ---------- Lot B1 : invitations ----------
$r = appel('promo@ci.test', 'invitation_create', ['data' => ['type' => 'promo', 'promo_id' => $promo, 'jours' => 7, 'max' => 3]]);
$inv = $r['invitation'] ?? [];
$jeton = (string) ($inv['jeton'] ?? '');
verifie('invitation de promo créée', ($r['ok'] ?? false) === true && strlen($jeton) === 43 && str_contains((string) $inv['lien'], '?invitation=' . $jeton) && $inv['max'] === 3);
verifie('invitation : seul le hachage est enregistré', (int) valeur($pdo, 'SELECT COUNT(*) FROM invitations WHERE jeton_hash = ?', [Ids::hacher($jeton)]) === 1
    && (int) valeur($pdo, 'SELECT COUNT(*) FROM invitations WHERE jeton_hash = ?', [$jeton]) === 0);
verifie('invitation : refusée à un admin d\'une autre promo', $err(appel('autre@ci.test', 'invitation_create', ['data' => ['type' => 'promo', 'promo_id' => $promo]])) === 'forbidden');
verifie('invitation : refusée à une étudiante', $err(appel('simple@ci.test', 'invitation_create', ['data' => ['type' => 'promo', 'promo_id' => $promo]])) === 'forbidden');
verifie('invitation : type inconnu refusé', $err(appel('promo@ci.test', 'invitation_create', ['data' => ['type' => 'x']])) === 'invalid');
verifie('invitation : promo inconnue', $err(appel('promo@ci.test', 'invitation_create', ['data' => ['type' => 'promo', 'promo_id' => Ids::uuid()]])) === 'not_found');
$l = appel('promo@ci.test', 'invitation_list')['invitations'] ?? [];
verifie('liste : invitation visible et active', count(array_filter($l, static fn (array $i): bool => $i['id'] === $inv['id'] && $i['actif'] === true)) === 1);
verifie('liste : invisible hors périmètre', array_filter(appel('autre@ci.test', 'invitation_list')['invitations'] ?? [], static fn (array $i): bool => $i['id'] === $inv['id']) === []);
verifie('liste : refusée à une étudiante', $err(appel('simple@ci.test', 'invitation_list')) === 'forbidden');

$d = ['code' => $jeton, 'prenom' => 'Jade', 'nom' => 'Petit', 'consentement' => true];
verifie('invitation : consentement exigé pour une nouvelle personne', $err(appel('invite0@ci.test', 'join_code', ['data' => array_merge($d, ['consentement' => false])])) === 'invalid');
verifie('invitation : prénom exigé', $err(appel('invite0@ci.test', 'join_code', ['data' => array_merge($d, ['prenom' => ''])])) === 'invalid');
verifie('invitation : compteur inchangé après refus', (int) valeur($pdo, 'SELECT usages FROM invitations WHERE id = ?', [$inv['id']]) === 0);
$r = appel('invite1@ci.test', 'join_code', ['data' => $d]);
verifie('invitation utilisée : compte créé et actif', ($r['ok'] ?? false) === true && valeur($pdo, 'SELECT statut FROM utilisateurs WHERE email = ?', ['invite1@ci.test']) === 'actif'
    && valeur($pdo, 'SELECT prenom FROM utilisateurs WHERE email = ?', ['invite1@ci.test']) === 'Jade');
$i1 = (int) valeur($pdo, 'SELECT id FROM utilisateurs WHERE email = ?', ['invite1@ci.test']);
verifie('invitation : étudiante de la promo', (int) valeur($pdo, "SELECT COUNT(*) FROM attributions WHERE utilisateur_id = ? AND role = 'etudiant' AND promo_id = ?", [$i1, $promo]) === 1);
verifie('invitation : origine du compte tracée', (int) valeur($pdo, 'SELECT invitation_id FROM utilisateurs WHERE id = ?', [$i1]) === $inv['id']
    && (int) valeur($pdo, "SELECT invitation_id FROM attributions WHERE utilisateur_id = ? AND role = 'etudiant'", [$i1]) === $inv['id']);
verifie('invitation : usage compté et consentement enregistré', (int) valeur($pdo, 'SELECT usages FROM invitations WHERE id = ?', [$inv['id']]) === 1
    && valeur($pdo, 'SELECT consentement_version FROM utilisateurs WHERE id = ?', [$i1]) === Config::CONSENT_VERSION);
$r = appel('invite1@ci.test', 'init');
verifie('invitation : première connexion en étudiante', ($r['me']['role'] ?? '') === 'etudiant' && ($r['me']['consentement'] ?? null) === true);
appel('invite1@ci.test', 'join_code', ['data' => ['code' => $jeton]]);
verifie('invitation : pas de double usage par la même personne', (int) valeur($pdo, 'SELECT usages FROM invitations WHERE id = ?', [$inv['id']]) === 1);

for ($i = 0; $i < 5; $i++) {
    $e = appel('essais@ci.test', 'join_code', ['data' => ['code' => str_repeat('x', 30)]]);
}
verifie('code faux : refusé', $err($e) === 'invalid');
verifie('trop d\'essais : bloqué même avec le bon code', $err(appel('essais@ci.test', 'join_code', ['data' => $d])) === 'forbidden');

$j1 = (string) appel('promo@ci.test', 'invitation_create', ['data' => ['type' => 'promo', 'promo_id' => $promo, 'max' => 1]])['invitation']['jeton'];
verifie('invitation à usage unique : première utilisation', (appel('u1@ci.test', 'join_code', ['data' => array_merge($d, ['code' => $j1])])['ok'] ?? false) === true);
$r = appel('u2@ci.test', 'join_code', ['data' => array_merge($d, ['code' => $j1])]);
verifie('invitation épuisée : refusée', $err($r) === 'invalid' && str_contains((string) ($r['message'] ?? ''), 'maximal'));
$r = appel('promo@ci.test', 'invitation_create', ['data' => ['type' => 'promo', 'promo_id' => $promo]]);
$pdo->prepare('UPDATE invitations SET expire_le = ? WHERE id = ?')->execute([gmdate('Y-m-d H:i:s', time() - 60), $r['invitation']['id']]);
verifie('invitation expirée : refusée', $err(appel('u3@ci.test', 'join_code', ['data' => array_merge($d, ['code' => $r['invitation']['jeton']])])) === 'invalid');
$r = appel('promo@ci.test', 'invitation_create', ['data' => ['type' => 'promo', 'promo_id' => $promo]]);
verifie('révocation refusée hors périmètre', $err(appel('autre@ci.test', 'invitation_revoke', ['data' => ['id' => $r['invitation']['id']]])) === 'forbidden');
$l = appel('promo@ci.test', 'invitation_revoke', ['data' => ['id' => $r['invitation']['id']]])['invitations'] ?? [];
verifie('invitation révoquée : marquée dans la liste', count(array_filter($l, static fn (array $i): bool => $i['id'] === $r['invitation']['id'] && $i['revoquee'] === true && $i['actif'] === false)) === 1);
verifie('invitation révoquée : refusée à l\'utilisation', $err(appel('u4@ci.test', 'join_code', ['data' => array_merge($d, ['code' => $r['invitation']['jeton']])])) === 'invalid');
verifie('révocation : invitation introuvable', $err(appel('promo@ci.test', 'invitation_revoke', ['data' => ['id' => 999999]])) === 'not_found');

$r = appel('promo@ci.test', 'invitation_create', ['data' => ['type' => 'personnel', 'email' => 'Perso@ci.test', 'role' => 'etudiant', 'promo_id' => $promo, 'max' => 50]]);
verifie('invitation personnelle : un seul usage, adresse en minuscules', ($r['invitation']['max'] ?? 0) === 1 && ($r['invitation']['email'] ?? '') === 'perso@ci.test');
$jp = (string) $r['invitation']['jeton'];
$r = appel('intrus@ci.test', 'join_code', ['data' => array_merge($d, ['code' => $jp])]);
verifie('invitation personnelle : autre adresse refusée', $err($r) === 'invalid' && str_contains((string) ($r['message'] ?? ''), 'autre adresse'));
verifie('invitation personnelle : utilisée par son destinataire', (appel('perso@ci.test', 'join_code', ['data' => array_merge($d, ['code' => $jp])])['ok'] ?? false) === true);
verifie('invitation personnelle : adresse invalide refusée', $err(appel('promo@ci.test', 'invitation_create', ['data' => ['type' => 'personnel', 'email' => 'x', 'role' => 'etudiant', 'promo_id' => $promo]])) === 'invalid');
verifie('invitation personnelle formateur : refusée à un admin de promo', $err(appel('promo@ci.test', 'invitation_create', ['data' => ['type' => 'personnel', 'email' => 'f2@ci.test', 'role' => 'formateur', 'etablissement_id' => $etab]])) === 'forbidden');
$r = appel('site@ci.test', 'invitation_create', ['data' => ['type' => 'personnel', 'email' => 'f2@ci.test', 'role' => 'formateur', 'etablissement_id' => $etab]]);
verifie('invitation personnelle formateur : créée par l\'admin du site', ($r['ok'] ?? false) === true);
appel('f2@ci.test', 'join_code', ['data' => array_merge($d, ['code' => $r['invitation']['jeton'], 'prenom' => 'Lou', 'nom' => 'Garnier'])]);
verifie('invitation formateur : rôle sur l\'établissement', (int) valeur($pdo, "SELECT COUNT(*) FROM attributions a JOIN utilisateurs u ON u.id = a.utilisateur_id WHERE u.email = ? AND a.role = 'formateur' AND a.etablissement_id = ?", ['f2@ci.test', $etab]) === 1);

$r = appel('promo@ci.test', 'invitation_create', ['data' => ['type' => 'groupe', 'groupe_id' => $groupe]]);
$jg = (string) ($r['invitation']['jeton'] ?? '');
$idg = (int) ($r['invitation']['id'] ?? 0);
verifie('invitation de groupe : créée', ($r['ok'] ?? false) === true && $jg !== '');
verifie('invitation de groupe : groupe inconnu', $err(appel('promo@ci.test', 'invitation_create', ['data' => ['type' => 'groupe', 'groupe_id' => Ids::uuid()]])) === 'not_found');
verifie('invitation de groupe : refusée à un admin d\'une autre promo', $err(appel('autre@ci.test', 'invitation_create', ['data' => ['type' => 'groupe', 'groupe_id' => $groupe]])) === 'forbidden');
appel('g1@ci.test', 'join_code', ['data' => array_merge($d, ['code' => $jg, 'prenom' => 'Eli', 'nom' => 'Moreau'])]);
verifie('invitation de groupe : dans le groupe et étudiante de la promo', (int) valeur($pdo, 'SELECT COUNT(*) FROM membres m JOIN utilisateurs u ON u.id = m.utilisateur_id WHERE m.groupe_id = ? AND u.email = ?', [$groupe, 'g1@ci.test']) === 1
    && (int) valeur($pdo, "SELECT COUNT(*) FROM attributions a JOIN utilisateurs u ON u.id = a.utilisateur_id WHERE u.email = ? AND a.role = 'etudiant' AND a.promo_id = ?", ['g1@ci.test', $promo]) === 1);
appel('neuf2@ci.test', 'join_code', ['data' => ['code' => $jg]]);
verifie('invitation de groupe : une personne déjà active rejoint le groupe', (int) valeur($pdo, 'SELECT COUNT(*) FROM membres WHERE groupe_id = ? AND utilisateur_id = ?', [$groupe, $neuf]) === 1
    && (int) valeur($pdo, 'SELECT usages FROM invitations WHERE id = ?', [$idg]) === 2);
appel('promo@ci.test', 'group_create', ['data' => ['promo_id' => $promo, 'nom' => 'Groupe D']]);
$gd = (string) valeur($pdo, 'SELECT id FROM groupes WHERE promo_id = ? AND nom = ?', [$promo, 'Groupe D']);
$jd = (string) appel('promo@ci.test', 'invitation_create', ['data' => ['type' => 'groupe', 'groupe_id' => $gd]])['invitation']['jeton'];
verifie('invitation de groupe : déjà dans un groupe de la promo, refusé', $err(appel('neuf2@ci.test', 'join_code', ['data' => ['code' => $jd]])) === 'invalid'
    && (int) valeur($pdo, 'SELECT COUNT(*) FROM membres WHERE groupe_id = ? AND utilisateur_id = ?', [$gd, $neuf]) === 0);

$r = appel('promo@ci.test', 'promo_code', ['data' => ['id' => $promo, 'jours' => 5, 'max' => 10]]);
$structPromo = static function (array $r, string $promoId): ?array {
    foreach ($r['structure'] ?? [] as $e) {
        foreach ($e['promos'] as $p) {
            if ($p['id'] === $promoId) {
                return $p;
            }
        }
    }
    return null;
};
verifie('promo_code : jeton renvoyé une seule fois', ($r['ok'] ?? false) === true && strlen((string) ($r['code'] ?? '')) === 43 && str_contains((string) ($r['lien'] ?? ''), '?invitation='));
verifie('promo_code : état dans la structure', ($p = $structPromo($r, $promo)) !== null && $p['code_actif'] === true && $p['code_max'] === 10 && $p['code'] === '');
$r = appel('promo@ci.test', 'promo_code_revoke', ['id' => $promo]);
verifie('promo_code_revoke : plus de code actif', ($r['ok'] ?? false) === true && ($p = $structPromo($r, $promo)) !== null && $p['code_actif'] === false);
verifie('promo_code_revoke : promo inconnue', $err(appel('promo@ci.test', 'promo_code_revoke', ['id' => Ids::uuid()])) === 'not_found');
verifie('promo_code_revoke : refusé hors périmètre', $err(appel('autre@ci.test', 'promo_code_revoke', ['id' => $promo])) === 'forbidden');

// ---------- Lot B1 : droit d'accès, effacement, suppression ----------
$export = appel('simple@ci.test', 'mes_donnees')['export'] ?? [];
verifie('export : compte et rôles', ($export['compte']['email'] ?? '') === 'simple@ci.test' && count($export['roles'] ?? []) >= 1);
verifie('export : sections présentes', array_key_exists('fiches_de_lecture', $export) && array_key_exists('messages_chat', $export) && isset($export['genere_le']));
verifie('export : dates en ISO 8601', str_ends_with((string) ($export['compte']['cree_le'] ?? ''), 'Z'));

$now = gmdate('Y-m-d H:i:s');
$er = creerUtilisateur($pdo, 'erase@ci.test');
Attributions::ajouter($pdo, $er, 'etudiant', null, $promo);
$xart = Ids::uuid();
$pdo->prepare('INSERT INTO articles (id, cree_par, ajoute, titre) VALUES (?, ?, ?, ?)')->execute([$xart, $er, $now, 'Article X']);
$xan = Ids::uuid();
$xan2 = Ids::uuid();
$pdo->prepare('INSERT INTO analyses (id, article_id, utilisateur_id, ajoute) VALUES (?, ?, ?, ?)')->execute([$xan, $xart, $er, $now]);
$pdo->prepare('INSERT INTO analyses (id, article_id, utilisateur_id, ajoute) VALUES (?, ?, ?, ?)')->execute([$xan2, $xart, $simple, $now]);
$xcom = Ids::uuid();
$xcom2 = Ids::uuid();
$pdo->prepare('INSERT INTO commentaires (id, analyse_id, auteur_id, texte, cree_le) VALUES (?, ?, ?, ?, ?)')->execute([$xcom, $xan, $simple, 'sur sa fiche', $now]);
$pdo->prepare('INSERT INTO commentaires (id, analyse_id, auteur_id, texte, cree_le) VALUES (?, ?, ?, ?, ?)')->execute([$xcom2, $xan2, $er, 'sur celle d\'une autre', $now]);
$pdo->prepare('INSERT INTO notes (id, utilisateur_id, cree_le) VALUES (?, ?, ?)')->execute([Ids::uuid(), $er, $now]);
$pdo->prepare('INSERT INTO feedback (id, auteur_id, type, texte, jour, cree_le) VALUES (?, ?, ?, ?, ?, ?)')->execute([Ids::uuid(), $er, 'idee', 'idée', gmdate('Y-m-d'), $now]);
$pdo->prepare('INSERT INTO fichiers (id, article_id, nom, type, taille, chemin, cree_par, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')->execute([Ids::uuid(), $xart, 'a.pdf', 'application/pdf', 10, 'inexistant/a.pdf', $er, $now]);
$pdo->prepare('INSERT INTO historique (cible, cible_id, modifie_par, proprietaire, avant, modifie_le) VALUES (?, ?, ?, ?, ?, ?)')->execute(['analyse', $xan, $er, $er, '{}', $now]);
$pdo->prepare('INSERT INTO membres (groupe_id, utilisateur_id, ajoute_le) VALUES (?, ?, ?)')->execute([$groupe, $er, $now]);
$chat->prepare('INSERT INTO chat_messages (canal, auteur_id, auteur_nom, cree_le, texte) VALUES (?, ?, ?, ?, ?)')->execute(['g:x', $er, 'Erase', $now, 'salut']);
verifie('effacement : refusé à un admin de promo', $err(appel('promo@ci.test', 'admin_erase', ['email' => 'erase@ci.test'])) === 'forbidden');
verifie('effacement : adresse inconnue', $err(appel($admin, 'admin_erase', ['email' => 'rien@ci.test'])) === 'not_found');
verifie('effacement : compte administrateur protégé', $err(appel($admin, 'admin_erase', ['email' => $admin])) === 'forbidden');
verifie('effacement : réponse ok', (appel($admin, 'admin_erase', ['email' => 'erase@ci.test'])['ok'] ?? false) === true);
verifie('effacement : compte supprimé', (int) valeur($pdo, 'SELECT COUNT(*) FROM utilisateurs WHERE id = ?', [$er]) === 0);
verifie('effacement : fiche supprimée', (int) valeur($pdo, 'SELECT COUNT(*) FROM analyses WHERE id = ?', [$xan]) === 0);
verifie('effacement : commentaires de la personne et sur sa fiche supprimés', (int) valeur($pdo, 'SELECT COUNT(*) FROM commentaires WHERE id IN (?, ?)', [$xcom, $xcom2]) === 0);
verifie('effacement : notes, retours, fichiers et historique supprimés', (int) valeur($pdo, 'SELECT COUNT(*) FROM notes WHERE utilisateur_id = ?', [$er]) === 0
    && (int) valeur($pdo, 'SELECT COUNT(*) FROM feedback WHERE auteur_id = ?', [$er]) === 0
    && (int) valeur($pdo, 'SELECT COUNT(*) FROM fichiers WHERE cree_par = ?', [$er]) === 0
    && (int) valeur($pdo, 'SELECT COUNT(*) FROM historique WHERE cible_id = ?', [$xan]) === 0);
verifie('effacement : messages du chat supprimés', (int) valeur($chat, 'SELECT COUNT(*) FROM chat_messages WHERE auteur_id = ?', [$er]) === 0);
verifie('effacement : appartenances supprimées', (int) valeur($pdo, 'SELECT COUNT(*) FROM membres WHERE utilisateur_id = ?', [$er]) === 0);
verifie('effacement : l\'article partagé reste, sans auteur', valeur($pdo, 'SELECT titre FROM articles WHERE id = ?', [$xart]) === 'Article X'
    && valeur($pdo, 'SELECT cree_par FROM articles WHERE id = ?', [$xart]) === null);
verifie('effacement : la fiche d\'une autre personne reste', (int) valeur($pdo, 'SELECT COUNT(*) FROM analyses WHERE id = ?', [$xan2]) === 1);

$dl = creerUtilisateur($pdo, 'del@ci.test');
Attributions::ajouter($pdo, $dl, 'etudiant', null, $promo);
$xan3 = Ids::uuid();
$pdo->prepare('INSERT INTO analyses (id, article_id, utilisateur_id, ajoute) VALUES (?, ?, ?, ?)')->execute([$xan3, $xart, $dl, $now]);
verifie('suppression d\'accès : refusée à un admin de promo', $err(appel('promo@ci.test', 'admin_delete', ['email' => 'del@ci.test'])) === 'forbidden');
verifie('suppression d\'accès : compte administrateur protégé', $err(appel($admin, 'admin_delete', ['email' => $admin])) === 'forbidden');
verifie('suppression d\'accès : adresse inconnue', $err(appel($admin, 'admin_delete', ['email' => 'rien@ci.test'])) === 'not_found');
verifie('accès supprimé : le compte disparaît', (appel($admin, 'admin_delete', ['email' => 'del@ci.test'])['ok'] ?? false) === true
    && (int) valeur($pdo, 'SELECT COUNT(*) FROM utilisateurs WHERE id = ?', [$dl]) === 0);
verifie('accès supprimé : ses contributions restent, sans auteur', (int) valeur($pdo, 'SELECT COUNT(*) FROM analyses WHERE id = ? AND utilisateur_id IS NULL', [$xan3]) === 1);
verifie('journal : les décisions d\'administration sont tracées', (int) valeur($pdo, "SELECT COUNT(*) FROM journal_admin WHERE action IN ('admin_set','admin_erase','admin_delete','attribution_add','attribution_remove')") >= 8);

// ---------- Lot B2 : membres, votes, adhésions, rattachements ----------
$e3 = creerEtablissement($pdo, 'IFSI Vannes');
$pv = creerPromo($pdo, $e3, 'Promo V');
$B = [];
foreach (['a1' => 'Ana', 'a2' => 'Ben', 'a3' => 'Cléo', 'a4' => 'Dan', 'a5' => 'Eva', 'a6' => 'Fay', 'a7' => 'Gus'] as $k => $prenom) {
    $B[$k] = creerUtilisateur($pdo, $k . '@ci.test');
    Attributions::ajouter($pdo, $B[$k], 'etudiant', null, $pv);
    $pdo->prepare('UPDATE utilisateurs SET prenom = ?, nom = ? WHERE id = ?')->execute([$prenom, 'Test', $B[$k]]);
}
foreach (['forma' => 'Alice', 'formb' => 'Bob', 'formc' => 'Chloé'] as $k => $prenom) {
    $B[$k] = creerUtilisateur($pdo, $k . '@ci.test');
    Attributions::ajouter($pdo, $B[$k], 'formateur', $e3);
    $pdo->prepare('UPDATE utilisateurs SET prenom = ?, nom = ? WHERE id = ?')->execute([$prenom, 'Prof', $B[$k]]);
}
$B['ap'] = creerUtilisateur($pdo, 'ap@ci.test');
Attributions::ajouter($pdo, $B['ap'], 'admin_promo', null, $pv);
appel('ap@ci.test', 'group_create', ['data' => ['promo_id' => $pv, 'nom' => 'Alpha', 'membres' => ['a1@ci.test', 'a2@ci.test', 'a3@ci.test']]]);
appel('ap@ci.test', 'group_create', ['data' => ['promo_id' => $pv, 'nom' => 'Beta', 'membres' => ['a4@ci.test']]]);
$gid = static fn (string $nom): string => (string) valeur($GLOBALS['pdo'], 'SELECT id FROM groupes WHERE promo_id = ? AND nom = ?', [$GLOBALS['pv'], $nom]);
$alpha = $gid('Alpha');
$beta = $gid('Beta');
$effectif = static fn (string $g): int => (int) valeur($GLOBALS['pdo'], 'SELECT COUNT(*) FROM membres WHERE groupe_id = ?', [$g]);
$estMembre = static fn (string $g, string $k): bool => (int) valeur($GLOBALS['pdo'], 'SELECT COUNT(*) FROM membres WHERE groupe_id = ? AND utilisateur_id = ?', [$g, $GLOBALS['B'][$k]]) === 1;
$votes = static fn (string $email): array => appel($email, 'init')['votes'] ?? [];
$statutId = static fn (string $id): ?string => valeur($GLOBALS['pdo'], 'SELECT statut FROM votes WHERE id = ?', [$id]);

verifie('lot B2 : groupes de départ', $alpha !== '' && $beta !== '' && $effectif($alpha) === 3 && $effectif($beta) === 1);

// membres : candidats et ajout
$r = appel('a1@ci.test', 'member_candidates', ['groupe_id' => $alpha]);
verifie('candidats : étudiantes de la promo sans groupe, désignées par identifiant public', ($r['ok'] ?? false) === true && count($r['candidats'] ?? []) === 3
    && ($r['candidats'][0]['pid'] ?? '') === Ids::pid('a5@ci.test') && !isset($r['candidats'][0]['email']) && ($r['candidats'][0]['prenom'] ?? '') === 'Eva T.');
verifie('candidats : refusés à une personne étrangère au groupe', $err(appel('a5@ci.test', 'member_candidates', ['groupe_id' => $alpha])) === 'forbidden');
verifie('candidats : permis à l\'admin de la promo', count(appel('ap@ci.test', 'member_candidates', ['groupe_id' => $alpha])['candidats'] ?? []) === 3);
verifie('candidats : groupe inconnu', $err(appel('a1@ci.test', 'member_candidates', ['groupe_id' => Ids::uuid()])) === 'not_found');
verifie('membre ajouté par une étudiante du groupe', (appel('a1@ci.test', 'member_add', ['groupe_id' => $alpha, 'pid' => Ids::pid('a5@ci.test')])['ok'] ?? false) === true && $estMembre($alpha, 'a5'));
verifie('ajout : déjà membre refusé', $err(appel('a1@ci.test', 'member_add', ['groupe_id' => $alpha, 'pid' => Ids::pid('a5@ci.test')])) === 'invalid');
verifie('ajout : étudiante déjà dans un groupe de la promo refusée', $err(appel('a1@ci.test', 'member_add', ['groupe_id' => $alpha, 'pid' => Ids::pid('a4@ci.test')])) === 'invalid');
verifie('ajout : un formateur ne s\'ajoute pas par une étudiante', $err(appel('a1@ci.test', 'member_add', ['groupe_id' => $alpha, 'pid' => Ids::pid('forma@ci.test')])) === 'forbidden');
verifie('ajout : refusé à une étudiante étrangère au groupe', $err(appel('a4@ci.test', 'member_add', ['groupe_id' => $alpha, 'pid' => Ids::pid('a6@ci.test')])) === 'forbidden');
verifie('ajout : personne introuvable', $err(appel('a1@ci.test', 'member_add', ['groupe_id' => $alpha, 'pid' => 'inexistant'])) === 'not_found');
verifie('ajout : groupe introuvable', $err(appel('a1@ci.test', 'member_add', ['groupe_id' => Ids::uuid(), 'pid' => Ids::pid('a6@ci.test')])) === 'not_found');
verifie('ajout d\'un formateur par l\'admin de la promo, par adresse', (appel('ap@ci.test', 'member_add', ['groupe_id' => $alpha, 'email' => 'forma@ci.test'])['ok'] ?? false) === true && $estMembre($alpha, 'forma'));
verifie('retrait : refusé à une étudiante', $err(appel('a1@ci.test', 'member_remove', ['groupe_id' => $alpha, 'email' => 'forma@ci.test'])) === 'forbidden');
verifie('retrait par l\'admin de la promo', (appel('ap@ci.test', 'member_remove', ['groupe_id' => $alpha, 'email' => 'forma@ci.test'])['ok'] ?? false) === true && !$estMembre($alpha, 'forma'));
verifie('retrait : ce n\'est plus un membre', $err(appel('ap@ci.test', 'member_remove', ['groupe_id' => $alpha, 'email' => 'forma@ci.test'])) === 'not_found');
verifie('retrait : adresse inconnue', $err(appel('ap@ci.test', 'member_remove', ['groupe_id' => $alpha, 'email' => 'rien@ci.test'])) === 'not_found');

// vote de retrait
$r = appel('a1@ci.test', 'vote_propose', ['groupe_id' => $alpha, 'type' => 'retrait', 'pid' => Ids::pid('a5@ci.test')]);
verifie('retrait : proposition ouverte avec le vote de l\'auteur', ($r['ok'] ?? false) === true && count($r['votes'] ?? []) === 1);
$v = $votes('a2@ci.test')[0] ?? [];
verifie('retrait : forme du vote côté client', ($v['type'] ?? '') === 'retrait' && ($v['oui'] ?? 0) === 1 && ($v['n'] ?? 0) === 3 && ($v['besoin'] ?? 0) === 2
    && ($v['cible_pid'] ?? '') === Ids::pid('a5@ci.test') && ($v['cible'] ?? '') === 'Eva T.' && ($v['peut_voter'] ?? false) === true && array_key_exists('mon_vote', $v) && $v['mon_vote'] === null);
verifie('retrait : l\'auteur voit sa proposition', ($votes('a1@ci.test')[0]['proposant'] ?? false) === true && ($votes('a1@ci.test')[0]['mon_vote'] ?? null) === 1);
verifie('retrait : la personne visée ne vote pas', $err(appel('a5@ci.test', 'vote_answer', ['id' => $v['id'] ?? '', 'oui' => false])) === 'forbidden');
verifie('retrait : un groupe étranger ne voit pas le vote', $votes('a4@ci.test') === []);
verifie('retrait : l\'admin de la promo voit le vote', count($votes('ap@ci.test')) === 1 && ($votes('ap@ci.test')[0]['peut_voter'] ?? true) === false);
verifie('retrait : l\'admin global voit le vote', count($votes($admin)) >= 1);
verifie('retrait : proposition en double refusée', $err(appel('a2@ci.test', 'vote_propose', ['groupe_id' => $alpha, 'type' => 'retrait', 'pid' => Ids::pid('a5@ci.test')])) === 'invalid');
appel('a2@ci.test', 'vote_answer', ['id' => $v['id'], 'oui' => true]);
verifie('retrait adopté à la majorité : le membre est retiré', $statutId($v['id']) === 'adopte' && !$estMembre($alpha, 'a5') && $effectif($alpha) === 3);
verifie('retrait adopté : plus de vote ouvert', $votes('a1@ci.test') === []);
verifie('vote clos : réponse refusée', $err(appel('a3@ci.test', 'vote_answer', ['id' => $v['id'], 'oui' => true])) === 'invalid');
verifie('vote inconnu : introuvable', $err(appel('a3@ci.test', 'vote_answer', ['id' => Ids::uuid(), 'oui' => true])) === 'not_found');
verifie('retrait de soi-même refusé', $err(appel('a1@ci.test', 'vote_propose', ['groupe_id' => $alpha, 'type' => 'retrait', 'pid' => Ids::pid('a1@ci.test')])) === 'invalid');
verifie('retrait : membre introuvable', $err(appel('a1@ci.test', 'vote_propose', ['groupe_id' => $alpha, 'type' => 'retrait', 'pid' => Ids::pid('a7@ci.test')])) === 'not_found');
verifie('retrait : type inconnu refusé', $err(appel('a1@ci.test', 'vote_propose', ['groupe_id' => $alpha, 'type' => 'magie'])) === 'invalid');
verifie('retrait : refusé à une étudiante étrangère au groupe', $err(appel('a4@ci.test', 'vote_propose', ['groupe_id' => $alpha, 'type' => 'retrait', 'pid' => Ids::pid('a1@ci.test')])) === 'forbidden');
appel('a1@ci.test', 'vote_propose', ['groupe_id' => $alpha, 'type' => 'retrait', 'pid' => Ids::pid('a3@ci.test')]);
$v = $votes('a2@ci.test')[0] ?? [];
verifie('retrait : à deux électrices, la majorité est de deux', ($v['n'] ?? 0) === 2 && ($v['besoin'] ?? 0) === 2);
appel('a2@ci.test', 'vote_answer', ['id' => $v['id'], 'oui' => false]);
verifie('retrait refusé dès que la majorité n\'est plus atteignable', $statutId($v['id']) === 'refuse' && $estMembre($alpha, 'a3'));
verifie('retrait refusé : proposition bloquée 14 jours', $err(appel('a1@ci.test', 'vote_propose', ['groupe_id' => $alpha, 'type' => 'retrait', 'pid' => Ids::pid('a3@ci.test')])) === 'invalid');
verifie('retrait : seule membre du groupe, rien à proposer', $err(appel('a4@ci.test', 'vote_propose', ['groupe_id' => $beta, 'type' => 'retrait', 'pid' => Ids::pid('a4@ci.test')])) === 'invalid');

// vote de nom, annulation
verifie('nom : déjà le nom du groupe', $err(appel('a1@ci.test', 'vote_propose', ['groupe_id' => $alpha, 'type' => 'nom', 'nom' => 'alpha'])) === 'invalid');
verifie('nom : déjà pris dans la promo', $err(appel('a1@ci.test', 'vote_propose', ['groupe_id' => $alpha, 'type' => 'nom', 'nom' => 'Beta'])) === 'invalid');
verifie('nom : vide refusé', $err(appel('a1@ci.test', 'vote_propose', ['groupe_id' => $alpha, 'type' => 'nom', 'nom' => '  '])) === 'invalid');
appel('a1@ci.test', 'vote_propose', ['groupe_id' => $alpha, 'type' => 'nom', 'nom' => 'Alpha 2']);
verifie('nom : proposition ouverte', count($votes('a3@ci.test')) === 1 && ($votes('a3@ci.test')[0]['valeur'] ?? '') === 'Alpha 2');
verifie('nom : un seul changement de nom à la fois', $err(appel('a2@ci.test', 'vote_propose', ['groupe_id' => $alpha, 'type' => 'nom', 'nom' => 'Alpha 3'])) === 'invalid');
$vn = $votes('a3@ci.test')[0] ?? [];
appel('a3@ci.test', 'vote_answer', ['id' => $vn['id'], 'oui' => true]);
verifie('nom adopté : le groupe est renommé', $statutId($vn['id']) === 'adopte' && valeur($pdo, 'SELECT nom FROM groupes WHERE id = ?', [$alpha]) === 'Alpha 2');
appel('a2@ci.test', 'vote_propose', ['groupe_id' => $alpha, 'type' => 'nom', 'nom' => 'Alpha 3']);
$vc = $votes('a1@ci.test')[0] ?? [];
verifie('annulation : refusée à qui n\'est ni auteur ni admin', $err(appel('a1@ci.test', 'vote_cancel', ['id' => $vc['id'] ?? ''])) === 'forbidden');
verifie('annulation par l\'auteur', (appel('a2@ci.test', 'vote_cancel', ['id' => $vc['id']])['ok'] ?? false) === true && $statutId($vc['id']) === 'annule');
verifie('annulation : vote déjà clos', $err(appel('a2@ci.test', 'vote_cancel', ['id' => $vc['id']])) === 'invalid');
appel('a2@ci.test', 'vote_propose', ['groupe_id' => $alpha, 'type' => 'nom', 'nom' => 'Alpha 4']);
$vc = $votes('a1@ci.test')[0] ?? [];
verifie('annulation par l\'admin de la promo', (appel('ap@ci.test', 'vote_cancel', ['id' => $vc['id'] ?? ''])['ok'] ?? false) === true);
verifie('annulation : vote inconnu', $err(appel('a2@ci.test', 'vote_cancel', ['id' => Ids::uuid()])) === 'not_found');

// vote d'expiration
$ancien = Ids::uuid();
$pdo->prepare('INSERT INTO votes (id, groupe_id, type, valeur, propose_par, cree_le, statut) VALUES (?, ?, ?, ?, ?, ?, ?)')
    ->execute([$ancien, $alpha, 'nom', 'Trop tard', $B['a1'], gmdate('Y-m-d H:i:s', time() - 8 * 86400), 'ouvert']);
verifie('vote vieux de huit jours : absent des votes ouverts', array_filter($votes('a2@ci.test'), static fn (array $x): bool => $x['id'] === $ancien) === []);
verifie('vote expiré : réponse refusée et vote clos', $err(appel('a2@ci.test', 'vote_answer', ['id' => $ancien, 'oui' => true])) === 'invalid'
    && valeur($pdo, 'SELECT statut FROM votes WHERE id = ?', [$ancien]) === 'expire');

// formateurs : invitation par le groupe
$r = appel('a1@ci.test', 'formateur_candidates', ['groupe_id' => $alpha]);
verifie('formateurs invitables : ceux de l\'établissement', ($r['ok'] ?? false) === true && count($r['candidats'] ?? []) === 3);
verifie('formateurs invitables : refusés à une étudiante étrangère', $err(appel('a4@ci.test', 'formateur_candidates', ['groupe_id' => $alpha])) === 'forbidden');
verifie('invitation : un étudiant n\'est pas un formateur', $err(appel('a1@ci.test', 'vote_propose', ['groupe_id' => $alpha, 'type' => 'formateur_invite', 'pid' => Ids::pid('a7@ci.test')])) === 'not_found');
appel('a1@ci.test', 'vote_propose', ['groupe_id' => $alpha, 'type' => 'formateur_invite', 'pid' => Ids::pid('forma@ci.test')]);
verifie('invitation : proposition ouverte, formateur retiré des invitables', count($votes('a2@ci.test')) === 1
    && count(appel('a1@ci.test', 'formateur_candidates', ['groupe_id' => $alpha])['candidats'] ?? []) === 2);
verifie('invitation : une seule proposition par formateur', $err(appel('a2@ci.test', 'vote_propose', ['groupe_id' => $alpha, 'type' => 'formateur_invite', 'pid' => Ids::pid('forma@ci.test')])) === 'invalid');
$vf = $votes('a2@ci.test')[0] ?? [];
appel('a2@ci.test', 'vote_answer', ['id' => $vf['id'], 'oui' => true]);
verifie('invitation adoptée : le formateur rejoint le groupe', $statutId($vf['id']) === 'adopte' && $estMembre($alpha, 'forma'));
verifie('invitation : formateur déjà membre refusé', $err(appel('a1@ci.test', 'vote_propose', ['groupe_id' => $alpha, 'type' => 'formateur_invite', 'pid' => Ids::pid('forma@ci.test')])) === 'invalid');
appel('a1@ci.test', 'vote_propose', ['groupe_id' => $alpha, 'type' => 'formateur_invite', 'pid' => Ids::pid('formb@ci.test')]);
$vf = $votes('a2@ci.test')[0] ?? [];
verifie('un formateur membre ne vote pas', $err(appel('forma@ci.test', 'vote_answer', ['id' => $vf['id'], 'oui' => true])) === 'forbidden');
appel('a2@ci.test', 'vote_answer', ['id' => $vf['id'], 'oui' => false]);
appel('a3@ci.test', 'vote_answer', ['id' => $vf['id'], 'oui' => false]);
verifie('invitation refusée : le formateur ne rejoint pas', $statutId($vf['id']) === 'refuse' && !$estMembre($alpha, 'formb'));
verifie('invitation refusée : bloquée 14 jours', $err(appel('a1@ci.test', 'vote_propose', ['groupe_id' => $alpha, 'type' => 'formateur_invite', 'pid' => Ids::pid('formb@ci.test')])) === 'invalid');

// formateurs : demande de rattachement
$r = appel('formb@ci.test', 'init');
verifie('rattachements : groupes des promos de l\'établissement', count($r['rattachements'] ?? []) === 1 && ($r['rattachements'][0]['titre'] ?? '') === 'IFSI Vannes · Promo V'
    && count($r['rattachements'][0]['groupes'] ?? []) === 2);
verifie('formateur : sections étudiantes vides', ($r['promosMoi'] ?? null) === []);
verifie('demande de rattachement : réservée aux formateurs de l\'établissement', $err(appel('a1@ci.test', 'formateur_request', ['groupe_id' => $alpha])) === 'forbidden'
    && $err(appel('prof@ci.test', 'formateur_request', ['groupe_id' => $alpha])) === 'forbidden');
verifie('demande : déjà membre refusée', $err(appel('forma@ci.test', 'formateur_request', ['groupe_id' => $alpha])) === 'invalid');
verifie('demande : groupe introuvable', $err(appel('formb@ci.test', 'formateur_request', ['groupe_id' => Ids::uuid()])) === 'not_found');
verifie('demande : proposition faite', (appel('formb@ci.test', 'formateur_request', ['groupe_id' => $alpha])['ok'] ?? false) === true);
$r = appel('formb@ci.test', 'init');
$gAlpha = array_values(array_filter($r['rattachements'][0]['groupes'] ?? [], static fn (array $g): bool => $g['id'] === $alpha))[0] ?? [];
verifie('demande : visible côté formateur avec le décompte', ($gAlpha['demande']['n'] ?? 0) === 3 && ($gAlpha['demande']['besoin'] ?? 0) === 2 && ($gAlpha['demande']['oui'] ?? -1) === 0 && ($gAlpha['membre'] ?? true) === false);
verifie('demande : une seule à la fois', $err(appel('formb@ci.test', 'formateur_request', ['groupe_id' => $alpha])) === 'invalid');
$vd = $votes('a1@ci.test')[0] ?? [];
verifie('demande : visible des étudiantes du groupe', ($vd['type'] ?? '') === 'formateur_demande' && ($vd['cible'] ?? '') === 'Bob P.');
appel('a1@ci.test', 'vote_answer', ['id' => $vd['id'], 'oui' => true]);
appel('a2@ci.test', 'vote_answer', ['id' => $vd['id'], 'oui' => true]);
verifie('demande adoptée : le formateur rejoint le groupe', $statutId($vd['id']) === 'adopte' && $estMembre($alpha, 'formb'));
verifie('rattachement : appartenance visible côté formateur', (array_values(array_filter(appel('formb@ci.test', 'init')['rattachements'][0]['groupes'] ?? [], static fn (array $g): bool => $g['id'] === $alpha))[0]['membre'] ?? false) === true);
appel('formc@ci.test', 'formateur_request', ['groupe_id' => $beta]);
$vb = $votes('a4@ci.test')[0] ?? [];
appel('a4@ci.test', 'vote_answer', ['id' => $vb['id'], 'oui' => false]);
verifie('demande refusée : bloquée 14 jours', $statutId($vb['id']) === 'refuse' && $err(appel('formc@ci.test', 'formateur_request', ['groupe_id' => $beta])) === 'invalid');
verifie('demande refusée : « bloque » côté formateur', (array_values(array_filter(appel('formc@ci.test', 'init')['rattachements'][0]['groupes'] ?? [], static fn (array $g): bool => $g['id'] === $beta))[0]['bloque'] ?? false) === true);

// étudiantes : demande d'adhésion et groupe créé par soi
$r = appel('a5@ci.test', 'init');
verifie('promosMoi : promo de l\'étudiante sans groupe, avec les groupes possibles', count($r['promosMoi'] ?? []) === 1 && ($r['promosMoi'][0]['mon_groupe_id'] ?? 'x') === ''
    && count($r['promosMoi'][0]['groupes'] ?? []) === 2 && array_key_exists('demande', $r['promosMoi'][0]['groupes'][0]) && $r['promosMoi'][0]['groupes'][0]['demande'] === null);
verifie('promosMoi : camarades du groupe listés sans adresse', count($r['promosMoi'][0]['groupes'][0]['membres'] ?? []) >= 1 && !isset($r['promosMoi'][0]['groupes'][0]['membres'][0]['email']));
verifie('adhésion : une personne non inscrite est refusée', $err(appel('sansrole@ci.test', 'join_request', ['groupe_id' => $alpha])) === 'forbidden');
verifie('adhésion : groupe introuvable', $err(appel('a5@ci.test', 'join_request', ['groupe_id' => Ids::uuid()])) === 'not_found');
verifie('adhésion : déjà dans un groupe refusée', $err(appel('a4@ci.test', 'join_request', ['groupe_id' => $alpha])) === 'invalid');
appel('ap@ci.test', 'group_create', ['data' => ['promo_id' => $pv, 'nom' => 'Vide']]);
verifie('adhésion : groupe sans étudiante refusé', $err(appel('a5@ci.test', 'join_request', ['groupe_id' => $gid('Vide')])) === 'invalid');
verifie('adhésion : demande déposée', (appel('a5@ci.test', 'join_request', ['groupe_id' => $alpha])['ok'] ?? false) === true);
$r = appel('a5@ci.test', 'init');
$ga = array_values(array_filter($r['promosMoi'][0]['groupes'] ?? [], static fn (array $g): bool => $g['id'] === $alpha))[0] ?? [];
verifie('adhésion : demande visible dans promosMoi', ($ga['demande']['n'] ?? 0) === 3 && ($ga['demande']['oui'] ?? -1) === 0);
verifie('adhésion : une seule demande ouverte par promo', $err(appel('a5@ci.test', 'join_request', ['groupe_id' => $beta])) === 'invalid');
$va = array_values(array_filter($votes('a1@ci.test'), static fn (array $x): bool => $x['type'] === 'adhesion'))[0] ?? [];
verifie('adhésion : visible des étudiantes du groupe', ($va['cible'] ?? '') === 'Eva T.' && ($va['peut_voter'] ?? false) === true);
appel('a1@ci.test', 'vote_answer', ['id' => $va['id'], 'oui' => true]);
appel('a3@ci.test', 'vote_answer', ['id' => $va['id'], 'oui' => true]);
verifie('adhésion adoptée : l\'étudiante rejoint le groupe', $statutId($va['id']) === 'adopte' && $estMembre($alpha, 'a5'));
verifie('adhésion : promosMoi indique le groupe', (appel('a5@ci.test', 'init')['promosMoi'][0]['mon_groupe_id'] ?? '') === $alpha && (appel('a5@ci.test', 'init')['promosMoi'][0]['groupes'] ?? null) === []);
appel('a6@ci.test', 'join_request', ['groupe_id' => $beta]);
$v6 = array_values(array_filter($votes('a4@ci.test'), static fn (array $x): bool => $x['type'] === 'adhesion'))[0] ?? [];
verifie('adhésion : une autre demande dans la même promo est refusée', $err(appel('a6@ci.test', 'join_request', ['groupe_id' => $alpha])) === 'invalid');
verifie('création d\'un groupe par soi : nom vide refusé', $err(appel('a6@ci.test', 'group_create_self', ['promo_id' => $pv, 'nom' => ''])) === 'invalid');
verifie('création d\'un groupe par soi : nom déjà pris', $err(appel('a6@ci.test', 'group_create_self', ['promo_id' => $pv, 'nom' => 'beta'])) === 'invalid');
verifie('création d\'un groupe par soi : promo inconnue', $err(appel('a6@ci.test', 'group_create_self', ['promo_id' => Ids::uuid(), 'nom' => 'Gamma'])) === 'not_found');
verifie('création d\'un groupe par soi : réservée aux inscrites', $err(appel('sansrole@ci.test', 'group_create_self', ['promo_id' => $pv, 'nom' => 'Gamma'])) === 'forbidden');
verifie('création d\'un groupe par soi : déjà dans un groupe', $err(appel('a1@ci.test', 'group_create_self', ['promo_id' => $pv, 'nom' => 'Gamma'])) === 'invalid');
verifie('création d\'un groupe par soi : groupe créé', (appel('a6@ci.test', 'group_create_self', ['promo_id' => $pv, 'nom' => 'Gamma'])['ok'] ?? false) === true
    && (int) valeur($pdo, 'SELECT COUNT(*) FROM membres WHERE groupe_id = ? AND utilisateur_id = ?', [$gid('Gamma'), $B['a6']]) === 1);
verifie('création d\'un groupe par soi : sa demande d\'adhésion est annulée', $statutId($v6['id'] ?? '') === 'annule');
appel('a7@ci.test', 'join_request', ['groupe_id' => $beta]);
$vb = array_values(array_filter($votes('a4@ci.test'), static fn (array $x): bool => $x['type'] === 'adhesion'))[0] ?? [];
appel('a4@ci.test', 'vote_answer', ['id' => $vb['id'], 'oui' => false]);
verifie('adhésion refusée : l\'étudiante ne rejoint pas', $statutId($vb['id'] ?? '') === 'refuse' && !$estMembre($beta, 'a7'));
verifie('adhésion refusée : bloquée 14 jours', $err(appel('a7@ci.test', 'join_request', ['groupe_id' => $beta])) === 'invalid');
verifie('adhésion refusée : « bloque » dans promosMoi', (array_values(array_filter(appel('a7@ci.test', 'init')['promosMoi'][0]['groupes'] ?? [], static fn (array $g): bool => $g['id'] === $beta))[0]['bloque'] ?? false) === true);
verifie('suppression d\'un groupe : ses votes disparaissent', (appel('ap@ci.test', 'group_delete', ['id' => $beta])['ok'] ?? false) === true
    && (int) valeur($pdo, 'SELECT COUNT(*) FROM votes WHERE groupe_id = ?', [$beta]) === 0);

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
