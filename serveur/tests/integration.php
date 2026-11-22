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
        return ['ok' => false, 'error' => $e->codeErreur, 'message' => $e->getMessage(), 'extra' => $e->extra];
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
verifie('toutes les actions de l\'ancien serveur ont un traitement', array_diff(Routeur::ACTIONS, $routeur->actionsImplementees()) === []);
verifie('les actions nouvelles aussi', array_diff(Routeur::NOUVELLES, $routeur->actionsImplementees()) === []);

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
verifie('nom affiché : le pseudo ne compte que s\'il est activé', ((appel('etu@ci.test', 'init')['me']['prenom'] ?? '') === 'Mimi') === \Lpc\Utilisateur::PSEUDO_ACTIF);
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
verifie('pseudo modifié (affiché seulement s\'il est activé)', (($r['me']['prenom'] ?? '') === 'Pau-Pau') === \Lpc\Utilisateur::PSEUDO_ACTIF);
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
$moi = appel('simple@ci.test', 'init');
verifie('me : identité légale et pseudo fournis pour « Mon profil »', strtolower($moi['me']['identite']['prenom'] ?? '') === 'paul' && strtolower($moi['me']['identite']['nom'] ?? '') === 'martin' && array_key_exists('pseudo', $moi['me']['identite'] ?? []));
verifie('me : demande de changement de nom en attente visible', ($moi['me']['demande_nom']['prenom'] ?? '') === 'Paul-Henri' && ($moi['me']['demande_nom']['nom'] ?? '') === 'Martin');
verifie('une seule demande en attente à la fois',$err(appel('simple@ci.test', 'nom_demande', ['data' => ['prenom' => 'Pierre', 'nom' => 'Martin']])) === 'invalid');
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
verifie('liste : le compte administrateur est « admin » (pas « formateur »)', ($l = $ligne($r, $admin)) !== null && $l['role'] === 'admin');
verifie('liste : une étudiante garde le rôle « etudiant »', ($ligne($r, 'simple@ci.test')['role'] ?? '') === 'etudiant');

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
verifie('effacement : réponse ok', (appel($admin, 'admin_erase', ['email' => 'erase@ci.test', 'contributions' => 'supprimer'])['ok'] ?? false) === true);
verifie('effacement : compte supprimé', (int) valeur($pdo, 'SELECT COUNT(*) FROM utilisateurs WHERE id = ?', [$er]) === 0);
verifie('effacement : fiche supprimée', (int) valeur($pdo, 'SELECT COUNT(*) FROM analyses WHERE id = ?', [$xan]) === 0);
verifie('effacement : commentaires de la personne et sur sa fiche supprimés', (int) valeur($pdo, 'SELECT COUNT(*) FROM commentaires WHERE id IN (?, ?)', [$xcom, $xcom2]) === 0);
verifie('effacement : notes, retours, fichiers et historique supprimés', (int) valeur($pdo, 'SELECT COUNT(*) FROM notes WHERE utilisateur_id = ?', [$er]) === 0
    && (int) valeur($pdo, 'SELECT COUNT(*) FROM feedback WHERE auteur_id = ?', [$er]) === 0
    && (int) valeur($pdo, 'SELECT COUNT(*) FROM fichiers WHERE cree_par = ?', [$er]) === 0
    && (int) valeur($pdo, 'SELECT COUNT(*) FROM historique WHERE cible_id = ?', [$xan]) === 0);
verifie('effacement : messages du chat supprimés', (int) valeur($chat, 'SELECT COUNT(*) FROM chat_messages WHERE auteur_id = ?', [$er]) === 0);
verifie('effacement : appartenances supprimées', (int) valeur($pdo, 'SELECT COUNT(*) FROM membres WHERE utilisateur_id = ?', [$er]) === 0);
verifie('effacement : l\'article partagé reste, et passe à l\'autrice de l\'autre fiche', valeur($pdo, 'SELECT titre FROM articles WHERE id = ?', [$xart]) === 'Article X'
    && (int) valeur($pdo, 'SELECT cree_par FROM articles WHERE id = ?', [$xart]) === $simple);
verifie('effacement : la fiche d\'une autre personne reste', (int) valeur($pdo, 'SELECT COUNT(*) FROM analyses WHERE id = ?', [$xan2]) === 1);

// Effacement avec anonymisation (choix par défaut) : la personne disparaît, ses contributions restent sans auteur
$an = creerUtilisateur($pdo, 'anonyme@ci.test');
$xanA = Ids::uuid();
$xanB = Ids::uuid();
$xcomA = Ids::uuid();
$pdo->prepare("INSERT INTO analyses (id, article_id, utilisateur_id, ajoute, statut, libre) VALUES (?, ?, ?, ?, 'Terminée', 'Contribution terminée')")->execute([$xanA, $xart, $an, $now]);
$pdo->prepare("INSERT INTO analyses (id, article_id, utilisateur_id, ajoute, statut) VALUES (?, ?, ?, ?, 'En cours')")->execute([$xanB, $xart, $an, $now]);
$pdo->prepare('INSERT INTO commentaires (id, analyse_id, auteur_id, texte, cree_le) VALUES (?, ?, ?, ?, ?)')->execute([$xcomA, $xan2, $an, 'Commentaire à garder', $now]);
$pdo->prepare('INSERT INTO notes (id, utilisateur_id, cree_le) VALUES (?, ?, ?)')->execute([Ids::uuid(), $an, $now]);
verifie('effacement : choix invalide refusé', $err(appel($admin, 'admin_erase', ['email' => 'anonyme@ci.test', 'contributions' => 'peut-etre'])) === 'bad_request');
verifie('effacement anonymisé : réponse ok', (appel($admin, 'admin_erase', ['email' => 'anonyme@ci.test'])['ok'] ?? false) === true);
verifie('effacement anonymisé : compte et notes supprimés', (int) valeur($pdo, 'SELECT COUNT(*) FROM utilisateurs WHERE id = ?', [$an]) === 0 && (int) valeur($pdo, 'SELECT COUNT(*) FROM notes WHERE utilisateur_id = ?', [$an]) === 0);
verifie('effacement anonymisé : la fiche terminée reste, sans auteur', valeur($pdo, 'SELECT libre FROM analyses WHERE id = ?', [$xanA]) === 'Contribution terminée' && valeur($pdo, 'SELECT utilisateur_id FROM analyses WHERE id = ?', [$xanA]) === null);
verifie('effacement anonymisé : le brouillon est supprimé', (int) valeur($pdo, 'SELECT COUNT(*) FROM analyses WHERE id = ?', [$xanB]) === 0);
verifie('effacement anonymisé : le commentaire reste, sans auteur', valeur($pdo, 'SELECT texte FROM commentaires WHERE id = ?', [$xcomA]) === 'Commentaire à garder' && valeur($pdo, 'SELECT auteur_id FROM commentaires WHERE id = ?', [$xcomA]) === null);
verifie('effacement : le journal garde le choix, sans adresse', (int) valeur($pdo, "SELECT COUNT(*) FROM journal_admin WHERE action = 'admin_erase' AND detail LIKE 'contributions=anonymisees%'") === 1
    && (int) valeur($pdo, "SELECT COUNT(*) FROM journal_admin WHERE action = 'admin_erase' AND detail LIKE 'contributions=supprimees%'") === 1);

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
// Propriété des articles : quand le créateur part (accès supprimé, effacement), elle passe à l'autrice d'une autre fiche.
$to = creerUtilisateur($pdo, 'to@ci.test');
Attributions::ajouter($pdo, $to, 'etudiant', null, $promo);
foreach ([['tc1@ci.test', 'admin_delete', []], ['tc2@ci.test', 'admin_erase', ['contributions' => 'anonymiser']], ['tc3@ci.test', 'admin_erase', ['contributions' => 'supprimer']]] as [$mail, $act, $extra]) {
    $tc = creerUtilisateur($pdo, $mail);
    Attributions::ajouter($pdo, $tc, 'etudiant', null, $promo);
    $ta = Ids::uuid();
    $pdo->prepare('INSERT INTO articles (id, cree_par, ajoute, titre) VALUES (?, ?, ?, ?)')->execute([$ta, $tc, $now, 'Article ' . $mail]);
    $pdo->prepare('INSERT INTO analyses (id, article_id, utilisateur_id, ajoute) VALUES (?, ?, ?, ?)')->execute([Ids::uuid(), $ta, $tc, $now]);
    $pdo->prepare('INSERT INTO analyses (id, article_id, utilisateur_id, ajoute) VALUES (?, ?, ?, ?)')->execute([Ids::uuid(), $ta, $to, $now]);
    appel($admin, $act, array_merge(['email' => $mail], $extra));
    verifie('propriété de l\'article transmise (' . $mail . ')', (int) valeur($pdo, 'SELECT cree_par FROM articles WHERE id = ?', [$ta]) === $to);
}
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

// ---------- Lot C : fiches de lecture ----------
$art1 = ['statut' => 'En cours', 'titre' => 'Soins palliatifs en gériatrie', 'auteur' => 'Dupont, A.', 'parution' => '2020',
    'qualite' => 'Revue à comité de lecture', 'nation' => 'France', 'type' => 'Article scientifique', 'mots' => 'fin de vie', 'opinion' => 'Intéressant'];
$lect = static fn (string $email): array => appel($email, 'init')['lectures'] ?? [];
$trouve = static function (array $liste, string $id): ?array {
    foreach ($liste as $x) {
        if ($x['id'] === $id) {
            return $x;
        }
    }
    return null;
};
$propositions = static fn (string $email): array => appel($email, 'init')['propositions'] ?? [];
$comms = static fn (string $email): array => appel($email, 'init')['commentaires'] ?? [];

verifie('fiche : champs obligatoires d\'une fiche terminée', str_contains((string) (appel('a1@ci.test', 'add', ['data' => array_merge($art1, ['statut' => 'Terminée', 'nation' => ''])])['message'] ?? ''), 'nationalité'));
verifie('fiche : type d\'article invalide', $err(appel('a1@ci.test', 'add', ['data' => array_merge($art1, ['type' => 'Roman'])])) === 'invalid');
verifie('fiche : date de parution invalide', $err(appel('a1@ci.test', 'add', ['data' => array_merge($art1, ['parution' => 'vingt'])])) === 'invalid');
verifie('fiche : lien javascript: refusé', $err(appel('a1@ci.test', 'add', ['data' => array_merge($art1, ['lien' => 'javascript:alert(1)'])])) === 'invalid');
verifie('fiche : statut inconnu refusé', $err(appel('a1@ci.test', 'add', ['data' => array_merge($art1, ['statut' => 'Zzz'])])) === 'invalid');
verifie('fiche : priorité inconnue refusée', $err(appel('a1@ci.test', 'add', ['data' => array_merge($art1, ['statut' => 'À lire', 'priorite' => 'urgente'])])) === 'invalid');
verifie('fiche : titre obligatoire', $err(appel('a1@ci.test', 'add', ['data' => array_merge($art1, ['titre' => ''])])) === 'invalid');
verifie('fiche : titre trop long refusé', $err(appel('a1@ci.test', 'add', ['data' => array_merge($art1, ['titre' => str_repeat('a', 501)])])) === 'invalid');
verifie('fiche : données absentes refusées', $err(appel('a1@ci.test', 'add')) === 'invalid');
verifie('fiche : un formateur est en lecture seule', $err(appel('forma@ci.test', 'add', ['data' => $art1])) === 'forbidden');
verifie('fiche : un admin n\'ajoute pas de fiche', $err(appel('ap@ci.test', 'add', ['data' => $art1])) === 'forbidden');
verifie('fiche : sans groupe, refusée', $err(appel('a4@ci.test', 'add', ['data' => $art1])) === 'invalid');
verifie('fiche : groupe dont on n\'est pas membre', $err(appel('a4@ci.test', 'add', ['data' => array_merge($art1, ['groupe_id' => $alpha])])) === 'forbidden');

$r = appel('a1@ci.test', 'add', ['data' => $art1]);
$f1 = (string) ($r['id'] ?? '');
$m = $trouve($lect('a1@ci.test'), $f1);
verifie('fiche créée : visible de son autrice, modifiable', ($r['ok'] ?? false) === true && $m !== null && $m['mine'] === true && $m['modifiable'] === true
    && $m['article_modifiable'] === true && $m['groupe'] === 'Alpha 2' && $m['portee'] === 'groupe' && $m['priorite'] === '' && $m['etudiant'] === 'Ana T.'
    && $m['titre'] === 'Soins palliatifs en gériatrie' && $m['etablissement'] === 'IFSI Vannes' && $m['promo'] === 'Promo V');
verifie('fiche : réponse partielle (lectures et propositions)', ($r['partiel'] ?? false) === true && array_key_exists('lectures', $r) && array_key_exists('propositions', $r) && !array_key_exists('groupes', $r));
verifie('en cours : vue par les camarades du groupe', ($m2 = $trouve($lect('a2@ci.test'), $f1)) !== null && $m2['mine'] === false && $m2['modifiable'] === false);
verifie('en cours : vue par un formateur du groupe', $trouve($lect('forma@ci.test'), $f1) !== null);
verifie('en cours : vue par l\'admin de la promo et l\'admin global', $trouve($lect('ap@ci.test'), $f1) !== null && $trouve($lect($admin), $f1) !== null);
verifie('en cours : invisible hors du groupe', $trouve($lect('a6@ci.test'), $f1) === null && $trouve($lect('a4@ci.test'), $f1) === null
    && $trouve($lect('formc@ci.test'), $f1) === null && $trouve($lect('autre@ci.test'), $f1) === null && $lect('sansrole@ci.test') === []);

$art = (string) valeur($pdo, 'SELECT article_id FROM analyses WHERE id = ?', [$f1]);
$r = appel('a1@ci.test', 'update', ['id' => $f1, 'data' => array_merge($art1, ['statut' => 'Terminée', 'objet' => 'Évaluer les soins'])]);
verifie('fiche terminée : partagée avec la promo', ($r['ok'] ?? false) === true && valeur($pdo, 'SELECT portee FROM analyses WHERE id = ?', [$f1]) === 'promo');
verifie('terminée : vue des étudiantes de la promo, même sans groupe', $trouve($lect('a6@ci.test'), $f1) !== null && $trouve($lect('a4@ci.test'), $f1) !== null && $trouve($lect('a7@ci.test'), $f1) !== null);
verifie('terminée : vue d\'un formateur de l\'établissement, en lecture seule', ($mf = $trouve($lect('formc@ci.test'), $f1)) !== null && $mf['modifiable'] === false && $mf['article_modifiable'] === false);
verifie('terminée : invisible d\'une autre promo et d\'un autre établissement', $trouve($lect('nouvelle@ci.test'), $f1) === null && $trouve($lect('autre@ci.test'), $f1) === null);
verifie('terminée : l\'étudiante d\'une autre promo ne trouve pas l\'article', $err(appel('nouvelle@ci.test', 'add', ['data' => ['article_id' => $art, 'statut' => 'À lire']])) === 'not_found');

$h = appel('a1@ci.test', 'history_get', ['kind' => 'lecture', 'id' => $f1])['historique'] ?? [];
verifie('historique de la fiche : passage à « Terminée »', count($h) === 1 && in_array('statut', array_column($h[0]['champs'], 'k'), true) && ($h[0]['valeurs']['statut'] ?? '') === 'En cours');
appel('a1@ci.test', 'update', ['id' => $f1, 'data' => array_merge($art1, ['statut' => 'Terminée', 'objet' => 'Évaluer les soins', 'opinion' => 'Très utile'])]);
$h = appel('a1@ci.test', 'history_get', ['kind' => 'lecture', 'id' => $f1])['historique'] ?? [];
verifie('historique : le plus récent d\'abord', count($h) === 2 && $h[0]['champs'][0]['k'] === 'opinion' && $h[0]['champs'][0]['avant'] === 'Intéressant' && $h[0]['champs'][0]['apres'] === 'Très utile');
verifie('historique : invisible hors de la promo', $err(appel('nouvelle@ci.test', 'history_get', ['kind' => 'lecture', 'id' => $f1])) === 'not_found');
verifie('historique : type inconnu', $err(appel('a1@ci.test', 'history_get', ['kind' => 'zzz', 'id' => $f1])) === 'invalid');

// article : correction directe, puis par proposition
$r = appel('a1@ci.test', 'article_update', ['article_id' => $art, 'data' => ['doi' => '10.1000/abc']]);
verifie('article : correction directe de la créatrice isolée', ($r['ok'] ?? false) === true && valeur($pdo, 'SELECT doi FROM articles WHERE id = ?', [$art]) === '10.1000/abc'
    && (int) valeur($pdo, 'SELECT modifie_par FROM articles WHERE id = ?', [$art]) === $B['a1']);
verifie('article : aucune modification refusée', $err(appel('a1@ci.test', 'article_update', ['article_id' => $art, 'data' => ['doi' => '10.1000/abc']])) === 'invalid');
verifie('article : champ obligatoire retiré refusé (fiche terminée)', $err(appel('a1@ci.test', 'article_update', ['article_id' => $art, 'data' => ['titre' => '']])) === 'invalid');
$h = appel('a1@ci.test', 'history_get', ['kind' => 'article', 'id' => $art])['historique'] ?? [];
verifie('historique de l\'article', count($h) === 1 && $h[0]['champs'][0] === ['k' => 'doi', 'avant' => '', 'apres' => '10.1000/abc'] && $h[0]['par'] === 'Ana T.'
    && ($h[0]['valeurs']['titre'] ?? '') === 'Soins palliatifs en gériatrie');
verifie('article : un formateur est en lecture seule', $err(appel('forma@ci.test', 'article_update', ['article_id' => $art, 'data' => ['titre' => 'X']])) === 'forbidden');
verifie('article inconnu', $err(appel('a1@ci.test', 'article_update', ['article_id' => Ids::uuid(), 'data' => ['titre' => 'X']])) === 'not_found');

// doublons
$dup = appel('a6@ci.test', 'add', ['data' => array_merge($art1, ['titre' => 'soins palliatifs en geriatrie'])]);
verifie('doublon par titre : refusé avec l\'article existant', ($dup['error'] ?? '') === 'duplicate' && ($dup['extra']['article_id'] ?? '') === $art
    && count($dup['extra']['lecteurs'] ?? []) === 1 && ($dup['extra']['lecteurs'][0]['statut'] ?? '') === 'Terminée');
$dup = appel('a6@ci.test', 'add', ['data' => array_merge($art1, ['titre' => 'Un tout autre titre', 'doi' => 'https://doi.org/10.1000/ABC'])]);
verifie('doublon par DOI (casse et préfixe ignorés)', ($dup['error'] ?? '') === 'duplicate' && ($dup['extra']['article_id'] ?? '') === $art);
$r = appel('a6@ci.test', 'add', ['data' => array_merge($art1, ['doi' => '10.9999/zzz'])]);
$f6b = (string) ($r['id'] ?? '');
verifie('même titre mais DOI différents : deux articles distincts', ($r['ok'] ?? false) === true && valeur($pdo, 'SELECT article_id FROM analyses WHERE id = ?', [$f6b]) !== $art);
$r = appel('a6@ci.test', 'add', ['data' => array_merge($art1, ['nouveau' => true])]);
$f6c = (string) ($r['id'] ?? '');
verifie('doublon ignoré à la demande (nouveau = true)', ($r['ok'] ?? false) === true && $f6c !== '');

// ajout à un article existant
$r = appel('a6@ci.test', 'add', ['data' => ['article_id' => $art, 'statut' => 'À lire', 'priorite' => 'haute']]);
$f6 = (string) ($r['id'] ?? '');
$m6 = $trouve($lect('a6@ci.test'), $f6);
verifie('fiche ajoutée à un article existant', ($r['ok'] ?? false) === true && $m6 !== null && $m6['priorite'] === 'haute' && $m6['groupe'] === 'Gamma' && $m6['titre'] === 'Soins palliatifs en gériatrie');
verifie('une seule fiche par article et par personne', $err(appel('a6@ci.test', 'add', ['data' => ['article_id' => $art, 'statut' => 'À lire']])) === 'invalid');
verifie('fiche « à lire » : visible de son autrice seulement', $trouve($lect('a1@ci.test'), $f6) === null && $trouve($lect('a6@ci.test'), $f6) !== null
    && $trouve($lect($admin), $f6) === null && $trouve($lect('ap@ci.test'), $f6) === null);
verifie('article inconnu : introuvable', $err(appel('a6@ci.test', 'add', ['data' => ['article_id' => Ids::uuid(), 'statut' => 'À lire']])) === 'not_found');
verifie('étudiante de la promo sans groupe : refusée', $err(appel('a4@ci.test', 'add', ['data' => ['article_id' => $art, 'statut' => 'À lire']])) === 'forbidden');
verifie('modification : fiche d\'une autre', $err(appel('a2@ci.test', 'update', ['id' => $f1, 'data' => $art1])) === 'not_owner');
verifie('modification : hors du groupe', $err(appel('a6@ci.test', 'update', ['id' => $f1, 'data' => $art1])) === 'forbidden');
verifie('modification : fiche inconnue', $err(appel('a1@ci.test', 'update', ['id' => Ids::uuid(), 'data' => $art1])) === 'not_found');
verifie('modification : un formateur est en lecture seule', $err(appel('forma@ci.test', 'update', ['id' => $f1, 'data' => $art1])) === 'forbidden');

// propositions de correction
$titre2 = 'Soins palliatifs en gériatrie (révisé)';
$r = appel('a6@ci.test', 'update', ['id' => $f6, 'data' => ['statut' => 'En cours', 'titre' => $titre2]]);
verifie('article partagé : la correction devient une proposition', ($r['ok'] ?? false) === true
    && valeur($pdo, 'SELECT titre FROM articles WHERE id = ?', [$art]) === 'Soins palliatifs en gériatrie' && count($r['propositions'] ?? []) === 1
    && $r['propositions'][0]['pour'] === 1 && $r['propositions'][0]['seuil'] === 3 && $r['propositions'][0]['mine'] === true
    && $r['propositions'][0]['monVote'] === 1 && ($r['propositions'][0]['valeurs']['titre'] ?? '') === $titre2 && $r['propositions'][0]['par'] === 'Fay T.');
$pid1 = (string) $r['propositions'][0]['id'];
verifie('proposition : l\'autrice ne peut pas la refuser', $err(appel('a6@ci.test', 'article_vote', ['id' => $pid1, 'vote' => false])) === 'invalid');
verifie('proposition : un formateur ne vote pas', $err(appel('forma@ci.test', 'article_vote', ['id' => $pid1, 'vote' => true])) === 'forbidden');
verifie('proposition : une étudiante d\'une autre promo ne la trouve pas', $err(appel('nouvelle@ci.test', 'article_vote', ['id' => $pid1, 'vote' => true])) === 'not_found');
verifie('proposition inconnue', $err(appel('a2@ci.test', 'article_vote', ['id' => Ids::uuid(), 'vote' => true])) === 'not_found');
appel('a2@ci.test', 'article_vote', ['id' => $pid1, 'vote' => true]);
$p2 = $propositions('a2@ci.test')[0] ?? [];
verifie('proposition : décompte et vote de la personne', ($p2['pour'] ?? 0) === 2 && ($p2['monVote'] ?? 9) === 1 && ($p2['mine'] ?? true) === false);
verifie('proposition : visible des étudiantes de la promo sans groupe', count($propositions('a4@ci.test')) === 1 && ($propositions('a4@ci.test')[0]['monVote'] ?? 9) === -1);
appel('a3@ci.test', 'article_vote', ['id' => $pid1, 'vote' => true]);
verifie('proposition adoptée à trois approbations : l\'article est corrigé', valeur($pdo, 'SELECT titre FROM articles WHERE id = ?', [$art]) === $titre2
    && valeur($pdo, 'SELECT statut FROM propositions WHERE id = ?', [$pid1]) === 'adopte' && $propositions('a6@ci.test') === []);
$h = appel('a1@ci.test', 'history_get', ['kind' => 'article', 'id' => $art])['historique'] ?? [];
verifie('historique : la correction adoptée est tracée', count($h) === 2 && in_array('titre', array_column($h[0]['champs'], 'k'), true));

appel('a2@ci.test', 'article_update', ['article_id' => $art, 'data' => ['titre' => 'Autre titre']]);
$pid2 = (string) ($propositions('a2@ci.test')[0]['id'] ?? '');
foreach (['a1', 'a3', 'a6'] as $nonVotant) {
    appel($nonVotant . '@ci.test', 'article_vote', ['id' => $pid2, 'vote' => false]);
}
verifie('proposition refusée à trois refus : l\'article ne change pas', valeur($pdo, 'SELECT statut FROM propositions WHERE id = ?', [$pid2]) === 'refuse'
    && valeur($pdo, 'SELECT titre FROM articles WHERE id = ?', [$art]) === $titre2);
verifie('proposition close : vote refusé', $err(appel('a2@ci.test', 'article_vote', ['id' => $pid2, 'vote' => true])) === 'invalid');

appel('a3@ci.test', 'article_update', ['article_id' => $art, 'data' => ['titre' => 'T3']]);
appel('a3@ci.test', 'article_update', ['article_id' => $art, 'data' => ['titre' => 'T3 bis']]);
verifie('proposition : une seule ouverte par personne et par article', (int) valeur($pdo, "SELECT COUNT(*) FROM propositions WHERE article_id = ? AND propose_par = ? AND statut = 'ouvert'", [$art, $B['a3']]) === 1);
$pid3 = (string) valeur($pdo, "SELECT id FROM propositions WHERE article_id = ? AND propose_par = ? AND statut = 'ouvert'", [$art, $B['a3']]);
verifie('annulation : refusée à qui n\'est ni autrice ni admin', $err(appel('a1@ci.test', 'article_cancel', ['id' => $pid3])) === 'forbidden');
verifie('annulation par l\'autrice', (appel('a3@ci.test', 'article_cancel', ['id' => $pid3])['ok'] ?? false) === true && valeur($pdo, 'SELECT statut FROM propositions WHERE id = ?', [$pid3]) === 'annule');
verifie('annulation : proposition déjà close', $err(appel('a3@ci.test', 'article_cancel', ['id' => $pid3])) === 'invalid');
verifie('annulation : proposition inconnue', $err(appel('a3@ci.test', 'article_cancel', ['id' => Ids::uuid()])) === 'not_found');
appel('a2@ci.test', 'article_update', ['article_id' => $art, 'data' => ['titre' => 'T2']]);
$pid4 = (string) ($propositions('a2@ci.test')[0]['id'] ?? '');
verifie('annulation par l\'admin de la promo', (appel('ap@ci.test', 'article_cancel', ['id' => $pid4])['ok'] ?? false) === true);
$ancienne = Ids::uuid();
$pdo->prepare('INSERT INTO propositions (id, article_id, propose_par, cree_le, valeurs, statut) VALUES (?, ?, ?, ?, ?, ?)')
    ->execute([$ancienne, $art, $B['a1'], gmdate('Y-m-d H:i:s', time() - 15 * 86400), '{"titre":"Trop tard"}', 'ouvert']);
verifie('proposition expirée : vote refusé et proposition close', $err(appel('a2@ci.test', 'article_vote', ['id' => $ancienne, 'vote' => true])) === 'invalid'
    && valeur($pdo, 'SELECT statut FROM propositions WHERE id = ?', [$ancienne]) === 'expire');
verifie('article : correction directe par l\'admin de la promo', (appel('ap@ci.test', 'article_update', ['article_id' => $art, 'data' => ['titre' => 'Titre corrigé par l\'admin']])['ok'] ?? false) === true
    && valeur($pdo, 'SELECT titre FROM articles WHERE id = ?', [$art]) === 'Titre corrigé par l\'admin');

// commentaires
$r = appel('a2@ci.test', 'comment_add', ['lecture_id' => $f1, 'texte' => 'Très utile', 'portee' => 'groupe']);
$idc1 = (string) ($r['id'] ?? '');
verifie('commentaire de groupe : ajouté, réponse partielle', ($r['ok'] ?? false) === true && $idc1 !== '' && ($r['partiel'] ?? false) === true && array_key_exists('commentaires', $r) && array_key_exists('lus', $r));
$mc = $trouve($comms('a1@ci.test'), $idc1);
verifie('commentaire de groupe : visible du groupe, avec son auteur', $mc !== null && $mc['auteur'] === 'Ben T.' && $mc['mine'] === false && $mc['portee'] === 'groupe'
    && $mc['groupe'] === 'Alpha 2' && $mc['lecture_id'] === $f1);
verifie('commentaire de groupe : invisible hors du groupe', $trouve($comms('a6@ci.test'), $idc1) === null && $trouve($comms('a4@ci.test'), $idc1) === null);
verifie('commentaire de groupe : refusé hors du groupe', $err(appel('a6@ci.test', 'comment_add', ['lecture_id' => $f1, 'texte' => 'x', 'portee' => 'groupe'])) === 'forbidden');
$r = appel('a6@ci.test', 'comment_add', ['lecture_id' => $f1, 'texte' => 'Merci du partage', 'portee' => 'promo']);
$idc2 = (string) ($r['id'] ?? '');
verifie('commentaire de promo : ajouté par une étudiante d\'un autre groupe', ($r['ok'] ?? false) === true && $idc2 !== '');
verifie('commentaire de promo : visible de tous les lecteurs de la fiche', $trouve($comms('a1@ci.test'), $idc2) !== null && $trouve($comms('a2@ci.test'), $idc2) !== null
    && $trouve($comms('a4@ci.test'), $idc2) !== null && $trouve($comms('formc@ci.test'), $idc2) !== null);
verifie('commentaire de promo : le groupe de l\'autrice est conservé', ($trouve($comms('a1@ci.test'), $idc2)['groupe'] ?? '') === 'Gamma');
verifie('commentaire de promo : refusé sans groupe dans la promo', $err(appel('a4@ci.test', 'comment_add', ['lecture_id' => $f1, 'texte' => 'x', 'portee' => 'promo'])) === 'forbidden');
verifie('commentaire de promo : fiche non partagée', $err(appel('a6@ci.test', 'comment_add', ['lecture_id' => $f6, 'texte' => 'x', 'portee' => 'promo'])) === 'forbidden');
verifie('commentaire : un formateur du groupe peut commenter', ($rf = appel('forma@ci.test', 'comment_add', ['lecture_id' => $f1, 'texte' => 'Bravo', 'portee' => 'groupe']))['ok'] ?? false);
verifie('commentaire : un formateur hors groupe ne commente pas la promo', $err(appel('formc@ci.test', 'comment_add', ['lecture_id' => $f1, 'texte' => 'x', 'portee' => 'promo'])) === 'forbidden');
verifie('commentaire : un admin seul ne commente pas', $err(appel('ap@ci.test', 'comment_add', ['lecture_id' => $f1, 'texte' => 'x', 'portee' => 'groupe'])) === 'forbidden');
verifie('commentaire : vide refusé', $err(appel('a2@ci.test', 'comment_add', ['lecture_id' => $f1, 'texte' => '   ', 'portee' => 'groupe'])) === 'invalid');
verifie('commentaire : trop long refusé', $err(appel('a2@ci.test', 'comment_add', ['lecture_id' => $f1, 'texte' => str_repeat('a', 2001), 'portee' => 'groupe'])) === 'invalid');
verifie('commentaire : lecture inconnue', $err(appel('a2@ci.test', 'comment_add', ['lecture_id' => Ids::uuid(), 'texte' => 'x', 'portee' => 'groupe'])) === 'not_found');
verifie('commentaire modifié par son autrice', (appel('a2@ci.test', 'comment_update', ['id' => $idc1, 'texte' => 'Très utile, merci'])['ok'] ?? false) === true
    && ($trouve($comms('a2@ci.test'), $idc1)['texte'] ?? '') === 'Très utile, merci' && ($trouve($comms('a2@ci.test'), $idc1)['modifie_le'] ?? '') !== '');
verifie('commentaire : modification par un autre refusée', $err(appel('a1@ci.test', 'comment_update', ['id' => $idc1, 'texte' => 'x'])) === 'not_owner');
verifie('commentaire inconnu', $err(appel('a1@ci.test', 'comment_delete', ['id' => Ids::uuid()])) === 'not_found');
verifie('commentaire : le fil de la promo n\'est pas modéré par les étudiantes', $err(appel('a1@ci.test', 'comment_delete', ['id' => $idc2])) === 'forbidden');
verifie('commentaire : un formateur ne modère pas', $err(appel('forma@ci.test', 'comment_delete', ['id' => $idc1])) === 'forbidden');
verifie('commentaire de promo supprimé par un admin du groupe', (appel('ap@ci.test', 'comment_delete', ['id' => $idc2])['ok'] ?? false) === true && $trouve($comms('a1@ci.test'), $idc2) === null);
$idc3 = (string) appel('a2@ci.test', 'comment_add', ['lecture_id' => $f1, 'texte' => 'À relire', 'portee' => 'groupe'])['id'];
verifie('commentaire de groupe : modéré par un membre étudiant', (appel('a1@ci.test', 'comment_delete', ['id' => $idc1])['ok'] ?? false) === true);
verifie('commentaire supprimé par son autrice', (appel('a2@ci.test', 'comment_delete', ['id' => $idc3])['ok'] ?? false) === true);
$idc4 = (string) appel('a2@ci.test', 'comment_add', ['lecture_id' => $f1, 'texte' => 'Pour les lus', 'portee' => 'groupe'])['id'];
$lus = static fn (string $email): array => appel($email, 'init')['lus'] ?? [];
appel('a1@ci.test', 'comments_read', ['ids' => [$idc4, 'inconnu']]);
verifie('commentaires lus : seuls les commentaires existants comptent', $lus('a1@ci.test') === [$idc4] && $lus('a2@ci.test') === []);
$r = appel('a1@ci.test', 'comments_unread', ['ids' => [$idc4]]);
verifie('commentaires : remis en non lu, réponse partielle', ($r['partiel'] ?? false) === true && $lus('a1@ci.test') === []);
appel('a1@ci.test', 'comments_read', ['tous' => true]);
verifie('commentaires : tout marquer comme lu', in_array($idc4, $lus('a1@ci.test'), true));

// suppression et sections d'init
$r = appel('a1@ci.test', 'init');
verifie('init : sections de lecture présentes', array_key_exists('lectures', $r) && array_key_exists('commentaires', $r) && array_key_exists('lus', $r) && array_key_exists('propositions', $r) && ($r['migration'] ?? '') === 'complet');
verifie('suppression : refusée à une autre', $err(appel('a2@ci.test', 'delete', ['id' => $f1])) === 'not_owner');
verifie('suppression : fiche inconnue', $err(appel('a1@ci.test', 'delete', ['id' => Ids::uuid()])) === 'not_found');
verifie('suppression : un formateur est en lecture seule', $err(appel('forma@ci.test', 'delete', ['id' => $f1])) === 'forbidden');
$r = appel('a1@ci.test', 'delete', ['id' => $f1]);
verifie('fiche supprimée : réponse partielle', ($r['ok'] ?? false) === true && ($r['partiel'] ?? false) === true && array_key_exists('lectures', $r) && array_key_exists('commentaires', $r));
verifie('fiche supprimée : ses commentaires, « lus » et historique aussi', (int) valeur($pdo, 'SELECT COUNT(*) FROM analyses WHERE id = ?', [$f1]) === 0
    && (int) valeur($pdo, 'SELECT COUNT(*) FROM commentaires WHERE analyse_id = ?', [$f1]) === 0
    && (int) valeur($pdo, 'SELECT COUNT(*) FROM commentaires_lus WHERE commentaire_id = ?', [$idc4]) === 0
    && (int) valeur($pdo, "SELECT COUNT(*) FROM historique WHERE cible = 'analyse' AND cible_id = ?", [$f1]) === 0);
verifie('article conservé tant qu\'une fiche l\'utilise', (int) valeur($pdo, 'SELECT COUNT(*) FROM articles WHERE id = ?', [$art]) === 1);
verifie('article : la propriété passe à l\'autrice de la fiche restante', (int) valeur($pdo, 'SELECT COUNT(*) FROM articles ar WHERE ar.id = ? AND ar.cree_par IS NOT NULL AND ar.cree_par <> ? AND EXISTS (SELECT 1 FROM analyses an WHERE an.article_id = ar.id AND an.utilisateur_id = ar.cree_par)', [$art, $B['a1']]) === 1);
appel('a6@ci.test', 'delete', ['id' => $f6]);
verifie('article supprimé avec sa dernière fiche, et son historique et ses propositions', (int) valeur($pdo, 'SELECT COUNT(*) FROM articles WHERE id = ?', [$art]) === 0
    && (int) valeur($pdo, "SELECT COUNT(*) FROM historique WHERE cible = 'article' AND cible_id = ?", [$art]) === 0
    && (int) valeur($pdo, 'SELECT COUNT(*) FROM propositions WHERE article_id = ?', [$art]) === 0);
appel('a6@ci.test', 'delete', ['id' => $f6b]);
appel('a6@ci.test', 'delete', ['id' => $f6c]);
verifie('toutes les fiches de test supprimées', (int) valeur($pdo, 'SELECT COUNT(*) FROM analyses WHERE utilisateur_id = ?', [$B['a6']]) === 0 && $lect('a6@ci.test') === []);

// ---------- Lot D : suivi de projet ----------
$reunion = ['date' => '2026-12-01', 'titre' => 'Point lectures', 'participants' => 'Ana, Ben', 'vu' => 'Voir les articles', 'attendu' => 'Choisir une question', 'suite' => 'Relire'];
$r = appel('a1@ci.test', 'reunion_save', ['groupe_id' => $alpha, 'data' => $reunion]);
verifie('réunion créée, réponse partielle', ($r['ok'] ?? false) === true && ($r['partiel'] ?? false) === true && array_key_exists('reunions', $r) && array_key_exists('jalons', $r)
    && count($r['reunions']) === 1 && $r['reunions'][0]['modifiable'] === true && $r['reunions'][0]['par'] === 'Ana T.' && $r['reunions'][0]['date'] === '2026-12-01');
$rid = (string) ($r['reunions'][0]['id'] ?? '');
$suivi = static fn (string $email, string $section): array => appel($email, 'init')[$section] ?? [];
verifie('réunion : visible du groupe, de son formateur et des administrateurs', count($suivi('a2@ci.test', 'reunions')) === 1 && count($suivi('forma@ci.test', 'reunions')) === 1
    && count($suivi('ap@ci.test', 'reunions')) === 1 && count($suivi($admin, 'reunions')) >= 1);
verifie('réunion : invisible hors du groupe', $suivi('a6@ci.test', 'reunions') === [] && $suivi('a4@ci.test', 'reunions') === [] && $suivi('formc@ci.test', 'reunions') === []);
verifie('réunion : le formateur ne modifie pas', ($suivi('forma@ci.test', 'reunions')[0]['modifiable'] ?? true) === false);
verifie('réunion : date invalide', $err(appel('a1@ci.test', 'reunion_save', ['groupe_id' => $alpha, 'data' => array_merge($reunion, ['date' => '2026-02-30'])])) === 'invalid');
verifie('réunion : un titre ou un compte rendu au moins', $err(appel('a1@ci.test', 'reunion_save', ['groupe_id' => $alpha, 'data' => ['date' => '2026-12-01']])) === 'invalid');
verifie('réunion : titre trop long', $err(appel('a1@ci.test', 'reunion_save', ['groupe_id' => $alpha, 'data' => array_merge($reunion, ['titre' => str_repeat('a', 201)])])) === 'invalid');
verifie('réunion : refusée hors du groupe', $err(appel('a6@ci.test', 'reunion_save', ['groupe_id' => $alpha, 'data' => $reunion])) === 'forbidden');
verifie('réunion : un formateur est en lecture seule', $err(appel('forma@ci.test', 'reunion_save', ['groupe_id' => $alpha, 'data' => $reunion])) === 'forbidden');
verifie('réunion : élément introuvable', $err(appel('a1@ci.test', 'reunion_save', ['id' => Ids::uuid(), 'data' => $reunion])) === 'not_found');
$r = appel('a2@ci.test', 'reunion_save', ['id' => $rid, 'data' => array_merge($reunion, ['suite' => 'Relire et résumer'])]);
verifie('réunion modifiée par une autre membre', ($r['reunions'][0]['suite'] ?? '') === 'Relire et résumer' && ($r['reunions'][0]['modifie_par'] ?? '') === 'Ben T.' && ($r['reunions'][0]['modifie_le'] ?? '') !== '');
verifie('réunion : suppression refusée hors du groupe', $err(appel('a6@ci.test', 'reunion_delete', ['id' => $rid])) === 'forbidden' && $err(appel('forma@ci.test', 'reunion_delete', ['id' => $rid])) === 'forbidden');
verifie('réunion supprimée par l\'admin de la promo (modération)', (appel('ap@ci.test', 'reunion_delete', ['id' => $rid])['reunions'] ?? null) === []);
verifie('réunion : suppression d\'un élément inconnu', $err(appel('ap@ci.test', 'reunion_delete', ['id' => Ids::uuid()])) === 'not_found');

$jalon = ['titre' => 'Rendu du plan', 'echeance' => '2027-01-15', 'statut' => 'en_cours', 'note' => '', 'debut' => '2027-01-10', 'alerte_jours' => '7'];
$r = appel('a1@ci.test', 'jalon_save', ['groupe_id' => $alpha, 'data' => $jalon]);
verifie('jalon créé avec plage et alerte', ($r['ok'] ?? false) === true && count($r['jalons'] ?? []) === 1 && $r['jalons'][0]['debut'] === '2027-01-10'
    && $r['jalons'][0]['alerte_jours'] === '7' && $r['jalons'][0]['statut'] === 'en_cours');
$jid = (string) $r['jalons'][0]['id'];
verifie('jalon : type « tâche » par défaut, sans heure', ($r['jalons'][0]['type'] ?? '') === 'tache' && ($r['jalons'][0]['heure'] ?? 'x') === '');
$r = appel('a1@ci.test', 'jalon_save', ['groupe_id' => $alpha, 'data' => ['titre' => 'Point avec la formatrice', 'type' => 'reunion', 'echeance' => '2027-01-20', 'heure' => '14:30']]);
$reuJalon = array_values(array_filter($r['jalons'] ?? [], static fn (array $j): bool => $j['titre'] === 'Point avec la formatrice'))[0] ?? [];
verifie('jalon : réunion avec heure', ($r['ok'] ?? false) === true && ($reuJalon['type'] ?? '') === 'reunion' && ($reuJalon['heure'] ?? '') === '14:30');
foreach (['rappel', 'evenement', 'echeance'] as $tp) {
    $rr = appel('a1@ci.test', 'jalon_save', ['groupe_id' => $alpha, 'data' => ['titre' => 'T ' . $tp, 'type' => $tp, 'echeance' => '2027-01-21']]);
}
verifie('jalon : rappel, évènement et échéance acceptés', ($rr['ok'] ?? false) === true);
verifie('jalon : type invalide refusé', $err(appel('a1@ci.test', 'jalon_save', ['groupe_id' => $alpha, 'data' => ['titre' => 'x', 'type' => 'zzz', 'echeance' => '2027-01-21']])) === 'invalid');
verifie('jalon : heure invalide refusée', $err(appel('a1@ci.test', 'jalon_save', ['groupe_id' => $alpha, 'data' => ['titre' => 'x', 'echeance' => '2027-01-21', 'heure' => '25:99']])) === 'invalid'
    && $err(appel('a1@ci.test', 'jalon_save', ['groupe_id' => $alpha, 'data' => ['titre' => 'x', 'echeance' => '2027-01-21', 'heure' => '9h']])) === 'invalid');
$r = appel('a1@ci.test', 'jalon_save', ['groupe_id' => $alpha, 'data' => ['titre' => 'Sans statut', 'echeance' => '2027-02-01']]);
verifie('jalon : statut « à faire » par défaut, sans alerte', ($r['ok'] ?? false) === true && (array_values(array_filter($r['jalons'], static fn (array $j): bool => $j['titre'] === 'Sans statut'))[0]['statut'] ?? '') === 'a_faire');
$r = appel('a1@ci.test', 'jalon_save', ['groupe_id' => $alpha, 'data' => ['titre' => 'Un jour', 'echeance' => '2027-03-01', 'debut' => '2027-03-01']]);
verifie('jalon : une plage d\'un jour est une date fixe', (array_values(array_filter($r['jalons'], static fn (array $j): bool => $j['titre'] === 'Un jour'))[0]['debut'] ?? 'x') === '');
verifie('jalon : début après la fin refusé', $err(appel('a1@ci.test', 'jalon_save', ['groupe_id' => $alpha, 'data' => array_merge($jalon, ['debut' => '2027-02-01'])])) === 'invalid');
verifie('jalon : statut invalide refusé', $err(appel('a1@ci.test', 'jalon_save', ['groupe_id' => $alpha, 'data' => array_merge($jalon, ['statut' => 'zzz'])])) === 'invalid');
verifie('jalon : alerte invalide refusée', $err(appel('a1@ci.test', 'jalon_save', ['groupe_id' => $alpha, 'data' => array_merge($jalon, ['alerte_jours' => '400'])])) === 'invalid'
    && $err(appel('a1@ci.test', 'jalon_save', ['groupe_id' => $alpha, 'data' => array_merge($jalon, ['alerte_jours' => 'x'])])) === 'invalid');
verifie('jalon : échéance et titre obligatoires', $err(appel('a1@ci.test', 'jalon_save', ['groupe_id' => $alpha, 'data' => array_merge($jalon, ['echeance' => ''])])) === 'invalid'
    && $err(appel('a1@ci.test', 'jalon_save', ['groupe_id' => $alpha, 'data' => array_merge($jalon, ['titre' => ''])])) === 'invalid');
$r = appel('a3@ci.test', 'jalon_save', ['id' => $jid, 'data' => array_merge($jalon, ['statut' => 'fait'])]);
verifie('jalon modifié et supprimé', (array_values(array_filter($r['jalons'] ?? [], static fn (array $j): bool => $j['id'] === $jid))[0]['statut'] ?? '') === 'fait'
    && (appel('a2@ci.test', 'jalon_delete', ['id' => $jid])['ok'] ?? false) === true);

$terme = ['mot' => 'Bientraitance', 'definition' => 'Démarche de soin respectueuse de la personne', 'reference' => 'HAS, 2012'];
$r = appel('a1@ci.test', 'terme_save', ['groupe_id' => $alpha, 'data' => $terme]);
verifie('terme créé, réponse partielle (termes)', ($r['ok'] ?? false) === true && count($r['termes'] ?? []) === 1 && !array_key_exists('reunions', $r) && $r['termes'][0]['reference'] === 'HAS, 2012');
$tid = (string) $r['termes'][0]['id'];
verifie('terme : doublon refusé (casse et accents)', $err(appel('a2@ci.test', 'terme_save', ['groupe_id' => $alpha, 'data' => array_merge($terme, ['mot' => 'bientraitancé'])])) === 'duplicate');
verifie('terme : modification de la définition', (appel('a2@ci.test', 'terme_save', ['id' => $tid, 'data' => array_merge($terme, ['definition' => 'Autre définition'])])['termes'][0]['definition'] ?? '') === 'Autre définition');
verifie('terme : mot, définition et références bornés', $err(appel('a1@ci.test', 'terme_save', ['groupe_id' => $alpha, 'data' => array_merge($terme, ['mot' => ''])])) === 'invalid'
    && $err(appel('a1@ci.test', 'terme_save', ['groupe_id' => $alpha, 'data' => array_merge($terme, ['mot' => str_repeat('a', 121)])])) === 'invalid'
    && $err(appel('a1@ci.test', 'terme_save', ['groupe_id' => $alpha, 'data' => array_merge($terme, ['mot' => 'Autre', 'definition' => ''])])) === 'invalid'
    && $err(appel('a1@ci.test', 'terme_save', ['groupe_id' => $alpha, 'data' => array_merge($terme, ['mot' => 'Autre', 'reference' => str_repeat('r', 501)])])) === 'invalid');
verifie('terme supprimé', (appel('a1@ci.test', 'terme_delete', ['id' => $tid])['termes'] ?? null) === []);

// ---------- Lot D : notes privées ----------
$note = ['titre' => 'Idées', 'date' => '2026-11-20', 'texte' => 'Penser aux entretiens', 'liens' => ['abc', 'abc', str_repeat('x', 65)],
    'etiquettes' => ['Méthode', 'méthode', '  Soins  ', 'x'], 'epingle' => true];
$r = appel('a1@ci.test', 'note_save', ['data' => $note]);
verifie('note créée : liens et étiquettes dédoublonnés', ($r['ok'] ?? false) === true && count($r['notes'] ?? []) === 1 && $r['notes'][0]['liens'] === ['abc']
    && $r['notes'][0]['etiquettes'] === ['Méthode', 'Soins', 'x'] && $r['notes'][0]['epingle'] === true);
$nid = (string) $r['notes'][0]['id'];
verifie('notes : strictement privées', (appel('a2@ci.test', 'notes_list')['notes'] ?? null) === [] && (appel($admin, 'notes_list')['notes'] ?? null) === [] && (appel('ap@ci.test', 'notes_list')['notes'] ?? null) === []);
appel('a1@ci.test', 'note_save', ['data' => ['titre' => 'Ancienne', 'date' => '2026-01-01']]);
appel('a1@ci.test', 'note_save', ['data' => ['titre' => 'Récente', 'date' => '2026-11-30']]);
verifie('notes : épinglées d\'abord, puis les plus récentes', array_column(appel('a1@ci.test', 'notes_list')['notes'], 'titre') === ['Idées', 'Récente', 'Ancienne']);
verifie('note modifiée', (appel('a1@ci.test', 'note_save', ['data' => array_merge($note, ['id' => $nid, 'titre' => 'Idées v2'])])['notes'][0]['titre'] ?? '') === 'Idées v2');
verifie('note : modification et suppression par un autre refusées', $err(appel('a2@ci.test', 'note_save', ['data' => array_merge($note, ['id' => $nid])])) === 'not_found'
    && $err(appel('a2@ci.test', 'note_delete', ['id' => $nid])) === 'not_found');
verifie('note : validations', $err(appel('a1@ci.test', 'note_save', ['data' => array_merge($note, ['titre' => ''])])) === 'invalid'
    && $err(appel('a1@ci.test', 'note_save', ['data' => array_merge($note, ['titre' => str_repeat('a', 121)])])) === 'invalid'
    && $err(appel('a1@ci.test', 'note_save', ['data' => array_merge($note, ['texte' => str_repeat('a', 20001)])])) === 'invalid'
    && $err(appel('a1@ci.test', 'note_save', ['data' => array_merge($note, ['date' => '2026-02-30'])])) === 'invalid'
    && $err(appel('a1@ci.test', 'note_save', ['data' => array_merge($note, ['liens' => array_map(static fn (int $i): string => 'l' . $i, range(1, 31))])])) === 'invalid'
    && $err(appel('a1@ci.test', 'note_save', ['data' => array_merge($note, ['etiquettes' => array_map(static fn (int $i): string => 'e' . $i, range(1, 11))])])) === 'invalid');
verifie('note supprimée', count(appel('a1@ci.test', 'note_delete', ['id' => $nid])['notes'] ?? []) === 2);

// ---------- Lot D : retours sur l'outil ----------
$fb = ['type' => 'idee', 'texte' => 'Un mode sombre', 'contexte' => "page\nlectures"];
$r = appel('a1@ci.test', 'feedback_save', ['data' => $fb]);
verifie('retour enregistré, quota restant', ($r['ok'] ?? false) === true && count($r['feedbacks'] ?? []) === 1 && $r['feedbackRestants']['idee'] === 4 && $r['feedbackRestants']['bug'] === 10 && $r['feedbackLimites'] === ['bug' => 10, 'idee' => 5, 'autre' => 3]);
verifie('retour : contexte sur une seule ligne', valeur($pdo, 'SELECT contexte FROM feedback WHERE auteur_id = ? ORDER BY cree_le LIMIT 1', [$B['a1']]) === 'page lectures');
$fid = (string) $r['feedbacks'][0]['id'];
for ($k = 0; $k < 4; $k++) {
    appel('a1@ci.test', 'feedback_save', ['data' => array_merge($fb, ['texte' => 'Idée ' . $k])]);
}
verifie('retour : cinq idées permises, la sixième refusée', $err(appel('a1@ci.test', 'feedback_save', ['data' => $fb])) === 'limit');
$r = appel('a1@ci.test', 'feedback_save', ['data' => ['type' => 'bug', 'texte' => 'Un bug']]);
verifie('retour : la limite est par type (un bug reste permis)', ($r['ok'] ?? false) === true && $r['feedbackRestants']['bug'] === 9 && $r['feedbackRestants']['idee'] === 0);
$r = appel('a1@ci.test', 'feedback_save', ['id' => $fid, 'data' => array_merge($fb, ['texte' => 'Modifié'])]);
verifie('retour : modifié le jour même', (array_values(array_filter($r['feedbacks'] ?? [], static fn (array $f): bool => $f['id'] === $fid))[0]['texte'] ?? '') === 'Modifié');
verifie('retour : celui d\'un autre introuvable', $err(appel('a2@ci.test', 'feedback_save', ['id' => $fid, 'data' => $fb])) === 'not_found');
verifie('retour : validations', $err(appel('a2@ci.test', 'feedback_save', ['data' => array_merge($fb, ['type' => 'zzz'])])) === 'invalid'
    && $err(appel('a2@ci.test', 'feedback_save', ['data' => array_merge($fb, ['texte' => '  '])])) === 'invalid'
    && $err(appel('a2@ci.test', 'feedback_save', ['data' => array_merge($fb, ['texte' => str_repeat('a', 2001)])])) === 'invalid');
$ancien = Ids::uuid();
$pdo->prepare('INSERT INTO feedback (id, auteur_id, type, texte, jour, cree_le) VALUES (?, ?, ?, ?, ?, ?)')->execute([$ancien, $B['a2'], 'bug', 'Hier', gmdate('Y-m-d', time() - 3 * 86400), gmdate('Y-m-d H:i:s', time() - 3 * 86400)]);
verifie('retour : plus modifiable un autre jour', $err(appel('a2@ci.test', 'feedback_save', ['id' => $ancien, 'data' => $fb])) === 'forbidden');
verifie('retours : liste du jour de la personne', count(appel('a1@ci.test', 'feedback_list')['feedbacks'] ?? []) === 6 && count(appel('a2@ci.test', 'feedback_list')['feedbacks'] ?? []) === 0);
$r = appel($admin, 'admin_list');
verifie('retours : lus par l\'admin global seulement', count($r['feedbacks'] ?? []) >= 3 && ($r['feedbacks'][0]['par'] ?? '') !== '' && isset($r['feedbacks'][0]['email']) && !array_key_exists('feedbacks', appel('ap@ci.test', 'admin_list')));

$fbId = (string) ($r['feedbacks'][0]['id'] ?? '');
verifie('retours : non traité par défaut', ($r['feedbacks'][0]['statut'] ?? '') === 'nouveau');
verifie('retours : statut réservé à l\'admin global', $err(appel('a1@ci.test', 'feedback_status', ['data' => ['id' => $fbId, 'statut' => 'traitee']])) === 'forbidden');
verifie('retours : statut inconnu refusé', $err(appel($admin, 'feedback_status', ['data' => ['id' => $fbId, 'statut' => 'peut-etre']])) === 'invalid');
verifie('retours : retour inconnu', $err(appel($admin, 'feedback_status', ['data' => ['id' => 'inconnu', 'statut' => 'a_faire']])) === 'not_found');
$s = appel($admin, 'feedback_status', ['data' => ['id' => $fbId, 'statut' => 'a_faire']]);
verifie('retours : statut « à faire » enregistré', ($s['ok'] ?? false) === true && ($s['feedbacks'][0]['statut'] ?? '') === 'a_faire');
foreach (['ecartee', 'traitee', 'nouveau'] as $stt) {
    $s = appel($admin, 'feedback_status', ['data' => ['id' => $fbId, 'statut' => $stt]]);
}
verifie('retours : écartée, traitée, puis de nouveau non traité', ($s['feedbacks'][0]['statut'] ?? '') === 'nouveau');

// ---------- Mini-jeux : meilleur score par personne, par jeu et par niveau ----------
$sc = static fn (string $email, array $data): array => appel($email, 'jeu_score', ['data' => $data]);
$meilleur = static fn (array $r, string $jeu, string $niveau): ?array => array_values(array_filter($r['scores'] ?? [], static fn (array $s): bool => $s['jeu'] === $jeu && $s['niveau'] === $niveau))[0] ?? null;
$r = $sc('a1@ci.test', ['jeu' => 'seringue', 'score' => 10]);
verifie('score : enregistré avec sa date', ($meilleur($r, 'seringue', '')['score'] ?? -1) === 10 && str_ends_with((string) ($meilleur($r, 'seringue', '')['obtenu_le'] ?? ''), 'Z'));
$r = $sc('a1@ci.test', ['jeu' => 'seringue', 'score' => 4]);
verifie('score : un moins bon score ne remplace pas le meilleur', ($meilleur($r, 'seringue', '')['score'] ?? -1) === 10);
$pdo->prepare("UPDATE scores_jeux SET obtenu_le = '2026-01-01 10:00:00' WHERE utilisateur_id = ? AND jeu = 'seringue'")->execute([$B['a1']]);
$r = $sc('a1@ci.test', ['jeu' => 'seringue', 'score' => 12]);
verifie('score : un meilleur score le remplace, avec une nouvelle date', ($meilleur($r, 'seringue', '')['score'] ?? -1) === 12 && ($meilleur($r, 'seringue', '')['obtenu_le'] ?? '') > '2026-01-01T10:00:00Z');
$sc('a1@ci.test', ['jeu' => 'urgences', 'niveau' => '3', 'score' => 5]);
$r = $sc('a1@ci.test', ['jeu' => 'urgences', 'niveau' => '6', 'score' => 9]);
verifie('score : un enregistrement par niveau de difficulté', ($meilleur($r, 'urgences', '3')['score'] ?? -1) === 5 && ($meilleur($r, 'urgences', '6')['score'] ?? -1) === 9 && count($r['scores']) === 3);
verifie('score : jeu, niveau et valeur contrôlés', $err($sc('a1@ci.test', ['jeu' => 'zzz', 'score' => 1])) === 'invalid'
    && $err($sc('a1@ci.test', ['jeu' => 'urgences', 'score' => 1])) === 'invalid'
    && $err($sc('a1@ci.test', ['jeu' => 'urgences', 'niveau' => '4', 'score' => 1])) === 'invalid'
    && $err($sc('a1@ci.test', ['jeu' => 'seringue', 'niveau' => '3', 'score' => 1])) === 'invalid'
    && $err($sc('a1@ci.test', ['jeu' => 'seringue', 'score' => -1])) === 'invalid'
    && $err($sc('a1@ci.test', ['jeu' => 'seringue', 'score' => 99999999])) === 'invalid'
    && $err($sc('a1@ci.test', ['jeu' => 'seringue', 'score' => 'abc'])) === 'invalid');
verifie('scores : chaque personne ne voit que les siens', count(appel('a1@ci.test', 'jeux_scores')['scores'] ?? []) === 3 && count(appel('a2@ci.test', 'jeux_scores')['scores'] ?? []) === 0);
$exp = appel('a1@ci.test', 'mes_donnees')['export'] ?? [];
verifie('export : les scores de jeux y figurent', count($exp['scores_jeux'] ?? []) === 3);
$js = creerUtilisateur($pdo, 'jeux@ci.test');
Attributions::ajouter($pdo, $js, 'etudiant', null, $pv);
$sc('jeux@ci.test', ['jeu' => 'couloir', 'score' => 3]);
appel($admin, 'admin_erase', ['email' => 'jeux@ci.test', 'contributions' => 'anonymiser']);
verifie('effacement : les scores de jeux disparaissent avec le compte', (int) valeur($pdo, 'SELECT COUNT(*) FROM scores_jeux WHERE utilisateur_id = ?', [$js]) === 0);

// ---------- Suggestions de lecture : un formateur propose un article à la promo, des groupes tagués sont alertés ----------
// Un second groupe pour la promo (Beta a été supprimé plus haut) avec une étudiante qui n'est pas dans Alpha.
$sb = creerUtilisateur($pdo, 'sugb@ci.test');
Attributions::ajouter($pdo, $sb, 'etudiant', null, $pv);
$beta = Ids::uuid();
$pdo->prepare('INSERT INTO groupes (id, promo_id, nom, cree_le, cree_par) VALUES (?, ?, ?, ?, ?)')->execute([$beta, $pv, 'Sug', gmdate('Y-m-d H:i:s'), $B['ap']]);
$pdo->prepare('INSERT INTO membres (groupe_id, utilisateur_id, ajoute_le) VALUES (?, ?, ?)')->execute([$beta, $sb, gmdate('Y-m-d H:i:s')]);
$sg = static fn (string $email, string $action, array $req): array => appel($email, $action, $req);
$liste = static fn (string $email): array => appel($email, 'init')['suggestions'] ?? [];
$data = ['promo_id' => $pv, 'titre' => 'Prendre soin à l’hôpital', 'auteur' => 'Dupont', 'parution' => '2021', 'type' => 'Article scientifique', 'doi' => '10.1000/xyz', 'lien' => 'https://exemple.org/a', 'note' => 'À lire avant la réunion', 'groupes' => [$alpha]];
verifie('suggestion : une étudiante ne peut pas proposer', $err($sg('a1@ci.test', 'suggestion_save', ['data' => $data])) === 'forbidden');
verifie('suggestion : titre obligatoire', $err($sg('forma@ci.test', 'suggestion_save', ['data' => array_merge($data, ['titre' => '  '])])) === 'invalid');
verifie('suggestion : lien contrôlé', $err($sg('forma@ci.test', 'suggestion_save', ['data' => array_merge($data, ['lien' => 'javascript:alert(1)'])])) === 'invalid');
verifie('suggestion : groupe inconnu refusé', $err($sg('forma@ci.test', 'suggestion_save', ['data' => array_merge($data, ['groupes' => ['inconnu']])])) === 'invalid');
verifie('suggestion : une saisie refusée ne laisse rien derrière elle', (int) valeur($pdo, 'SELECT COUNT(*) FROM suggestions') === 0);
$r = $sg('forma@ci.test', 'suggestion_save', ['data' => $data]);
$sug = $r['suggestions'] ?? [];
$idS = (string) ($sug['liste'][0]['id'] ?? '');
verifie('suggestion : créée par le formateur, qui voit ses tags ' . json_encode([$r['ok'] ?? null, $r['message'] ?? null, $r['error'] ?? null, $sug['liste'][0]['groupes'] ?? null, $sug['liste'][0]['modifiable'] ?? null, $sug['peut'] ?? null, $alpha, $pv]), ($r['ok'] ?? false) === true && count($sug['liste'] ?? []) === 1 && ($sug['liste'][0]['modifiable'] ?? false) === true && ($sug['liste'][0]['groupes'] ?? []) === [$alpha] && in_array($pv, $sug['peut'] ?? [], true));
$l1 = $liste('a1@ci.test');
verifie('suggestion : visible de toute la promo, avec alerte pour le groupe tagué ' . json_encode($l1), count($l1['liste'] ?? []) === 1 && ($l1['liste'][0]['nouveau'] ?? false) === true && ($l1['liste'][0]['alerte'] ?? false) === true && ($l1['alertes'] ?? 0) === 1);
verifie('suggestion : le tag reste invisible des étudiantes', ($l1['liste'][0]['groupes'] ?? ['x']) === [] && ($l1['liste'][0]['modifiable'] ?? true) === false && ($l1['peut'] ?? ['x']) === []);
$l4 = $liste('sugb@ci.test');
verifie('suggestion : un autre groupe la voit sans alerte', count($l4['liste'] ?? []) === 1 && ($l4['liste'][0]['nouveau'] ?? false) === true && ($l4['liste'][0]['alerte'] ?? true) === false && ($l4['alertes'] ?? 9) === 0);
verifie('suggestion : hors promo, personne ne la voit', count($liste('simple@ci.test')['liste'] ?? []) === 0);
$r = $sg('a1@ci.test', 'suggestion_vues', ['ids' => [$idS, 'inconnue']]);
verifie('suggestion : ouverte, l’alerte s’efface', ($r['suggestions']['alertes'] ?? 9) === 0 && ($r['suggestions']['liste'][0]['nouveau'] ?? true) === false);
verifie('suggestion : l’alerte des autres reste', ($liste('a2@ci.test')['alertes'] ?? 0) === 1);
verifie('suggestion : un autre formateur ne la modifie pas', $err($sg('formb@ci.test', 'suggestion_save', ['id' => $idS, 'data' => $data])) === 'forbidden'
    && $err($sg('formb@ci.test', 'suggestion_delete', ['id' => $idS])) === 'forbidden');
$r = $sg('forma@ci.test', 'suggestion_save', ['id' => $idS, 'data' => array_merge($data, ['titre' => 'Titre corrigé', 'groupes' => [$alpha, $beta]])]);
verifie('suggestion : l’auteur la corrige et change les tags', ($r['suggestions']['liste'][0]['titre'] ?? '') === 'Titre corrigé' && count($r['suggestions']['liste'][0]['groupes'] ?? []) === 2);
verifie('suggestion : le groupe nouvellement tagué est alerté', ($liste('sugb@ci.test')['alertes'] ?? 0) === 1);
verifie('suggestion : un administrateur de la promo peut la corriger', ($sg('ap@ci.test', 'suggestion_save', ['id' => $idS, 'data' => array_merge($data, ['titre' => 'Corrigé par l’admin'])])['ok'] ?? false) === true);
verifie('suggestion : préremplissage par DOI permis aux formateurs', ($sg('forma@ci.test', 'doi_lookup', ['doi' => 'pas-un-doi'])['error'] ?? '') !== 'forbidden');
$r = $sg('ap@ci.test', 'suggestion_delete', ['id' => $idS]);
verifie('suggestion : supprimée ' . json_encode([$r['ok'] ?? null, $r['message'] ?? null, $r['suggestions']['liste'] ?? null]), ($r['ok'] ?? false) === true && count($r['suggestions']['liste'] ?? []) === 0);
foreach ([['formx@ci.test', 'anonymiser'], ['formy@ci.test', 'supprimer']] as [$mail, $mode]) {
    $fx = creerUtilisateur($pdo, $mail);
    Attributions::ajouter($pdo, $fx, 'formateur', $e3);
    $pdo->prepare('UPDATE utilisateurs SET prenom = ?, nom = ? WHERE id = ?')->execute(['Fx', 'Prof', $fx]);
    $sg($mail, 'suggestion_save', ['data' => ['promo_id' => $pv, 'titre' => 'De ' . $mail]]);
    appel($admin, 'admin_erase', ['email' => $mail, 'contributions' => $mode]);
}
verifie('effacement : la suggestion reste détachée (anonymisation) ou disparaît (suppression)', (int) valeur($pdo, "SELECT COUNT(*) FROM suggestions WHERE titre = 'De formx@ci.test' AND propose_par IS NULL") === 1
    && (int) valeur($pdo, "SELECT COUNT(*) FROM suggestions WHERE titre = 'De formy@ci.test'") === 0);
$pdo->prepare("DELETE FROM suggestions")->execute();
$pdo->prepare('DELETE FROM groupes WHERE id = ?')->execute([$beta]);   // on remet la promo comme avant ce bloc
$pdo->prepare('DELETE FROM utilisateurs WHERE id = ?')->execute([$sb]);

// ---------- Lot D : chat ----------
$salon =static fn (string $type): array => ['groupe_id' => $alpha, 'type' => $type];
$r = appel('a1@ci.test', 'chat_send', $salon('groupe') + ['texte' => "Bonjour\r\n\r\n\r\n\r\nà tous"]);
verifie('chat : message envoyé, retour du salon', ($r['ok'] ?? false) === true && $r['total'] === 1 && $r['messages'][0]['moi'] === true && $r['messages'][0]['auteur'] === 'Ana T.'
    && $r['messages'][0]['texte'] === "Bonjour\n\nà tous" && $r['restant'] === 0);
$r = appel('a2@ci.test', 'chat_list', $salon('groupe') + ['vu' => ['groupe' => '2000-01-01T00:00:00.000Z']]);
verifie('chat : lu par un camarade, avec les nouveaux messages d\'autrui', count($r['messages'] ?? []) === 1 && $r['messages'][0]['moi'] === false && ($r['nouveaux']['groupe'] ?? 0) === 1
    && $r['messages'][0]['couleur'] !== '');
verifie('chat : « vu » dans le futur : plus de nouveaux', (appel('a2@ci.test', 'chat_list', $salon('groupe') + ['vu' => ['groupe' => '2999-01-01T00:00:00.000Z']])['nouveaux']['groupe'] ?? -1) === 0);
verifie('chat : salon de groupe fermé aux autres', $err(appel('a6@ci.test', 'chat_list', $salon('groupe'))) === 'forbidden' && $err(appel('a4@ci.test', 'chat_list', $salon('groupe'))) === 'forbidden'
    && $err(appel('formc@ci.test', 'chat_list', $salon('groupe'))) === 'forbidden');
verifie('chat : le formateur du groupe et l\'admin de la promo y accèdent', (appel('forma@ci.test', 'chat_send', $salon('groupe') + ['texte' => 'Bonne séance'])['ok'] ?? false) === true
    && $err(appel('ap@ci.test', 'chat_list', $salon('groupe'))) === 'forbidden' && $err(appel($admin, 'chat_list', $salon('groupe'))) === 'forbidden'
    && $err(appel('ap@ci.test', 'chat_send', $salon('groupe') + ['texte' => 'Je ne suis pas membre'])) === 'forbidden');
appel('a1@ci.test', 'chat_send', $salon('promo') + ['texte' => 'Pour toute la promo']);
verifie('chat : salon de promo lu par les étudiantes de la promo, même sans groupe', count(appel('a6@ci.test', 'chat_list', $salon('promo'))['messages'] ?? []) === 1
    && count(appel('a4@ci.test', 'chat_list', $salon('promo'))['messages'] ?? []) === 1 && count(appel('formc@ci.test', 'chat_list', $salon('promo'))['messages'] ?? []) === 1);
verifie('chat : salons indépendants', count(appel('a2@ci.test', 'chat_list', $salon('groupe'))['messages'] ?? []) === 2 && ($r2 = appel('a6@ci.test', 'chat_list', $salon('promo'))) && ($r2['nouveaux']['groupe'] ?? -1) === 0);
verifie('chat : salon de promo fermé à une autre promo', $err(appel('nouvelle@ci.test', 'chat_list', $salon('promo'))) === 'forbidden');
verifie('chat : groupe inconnu', $err(appel('a1@ci.test', 'chat_list', ['groupe_id' => Ids::uuid(), 'type' => 'groupe'])) === 'not_found');
verifie('chat : message vide ou trop long refusé', $err(appel('a1@ci.test', 'chat_send', $salon('groupe') + ['texte' => '   '])) === 'invalid'
    && $err(appel('a1@ci.test', 'chat_send', $salon('groupe') + ['texte' => str_repeat('a', 501)])) === 'invalid');
for ($i = 1; $i <= 4; $i++) {
    $e = appel('a3@ci.test', 'chat_send', $salon('groupe') + ['texte' => 'Message ' . $i]);
}
verifie('chat : quatre messages permis', ($e['ok'] ?? false) === true && ($e['restant'] ?? 0) >= 1);
$e = appel('a3@ci.test', 'chat_send', $salon('groupe') + ['texte' => 'Cinquième']);
verifie('chat : limite de quatre messages par minute glissante', ($e['error'] ?? '') === 'rate' && str_contains((string) ($e['message'] ?? ''), 'encore'));
$mid = (string) (appel('a2@ci.test', 'chat_list', $salon('groupe'))['messages'][0]['id'] ?? '');
verifie('chat : on ne retire que ses messages', $err(appel('a2@ci.test', 'chat_delete', $salon('groupe') + ['id' => $mid])) === 'forbidden');
verifie('chat : message retiré par son auteur', (appel('a1@ci.test', 'chat_delete', $salon('groupe') + ['id' => $mid])['ok'] ?? false) === true);
$mid2 = (string) (appel('a2@ci.test', 'chat_list', $salon('groupe'))['messages'][0]['id'] ?? '');
verifie('chat : un administrateur ne modère pas un salon de groupe', $err(appel('ap@ci.test', 'chat_delete', $salon('groupe') + ['id' => $mid2])) === 'forbidden' && $err(appel($admin, 'chat_delete', $salon('groupe') + ['id' => $mid2])) === 'forbidden');
$pm = (string) (appel('a6@ci.test', 'chat_list', $salon('promo'))['messages'][0]['id'] ?? '');
verifie('chat : message du salon de promo retiré par l\'admin de la promo', (appel('ap@ci.test', 'chat_delete', $salon('promo') + ['id' => $pm])['ok'] ?? false) === true);
verifie('chat : message inconnu', $err(appel('a1@ci.test', 'chat_delete', $salon('groupe') + ['id' => '99999999'])) === 'not_found');
$chat->prepare('INSERT INTO chat_messages (canal, auteur_id, auteur_nom, cree_le, texte) VALUES (?, ?, ?, ?, ?)')->execute(['g:ancien', $B['a7'], 'Gus T.', gmdate('Y-m-d H:i:s', time() - 8 * 86400), 'très vieux']);
appel('a1@ci.test', 'chat_send', $salon('groupe') + ['texte' => 'Nettoyage']);
verifie('chat : les messages de plus de sept jours sont purgés à l\'envoi', (int) valeur($chat, "SELECT COUNT(*) FROM chat_messages WHERE canal = 'g:ancien'") === 0);
$gamma = $gid('Gamma');
$lot = [];
for ($i = 0; $i < 1001; $i++) {
    $lot[] = '(?, ?, ?, ?, ?)';
}
$chat->prepare('INSERT INTO chat_messages (canal, auteur_id, auteur_nom, cree_le, texte) VALUES ' . implode(', ', $lot))
    ->execute(array_merge(...array_map(static fn (int $i): array => ['g:' . $gamma, $B['a7'], 'Gus T.', gmdate('Y-m-d H:i:s'), 'bruit ' . $i], range(1, 1001))));
appel('a6@ci.test', 'chat_send', ['groupe_id' => $gamma, 'type' => 'groupe', 'texte' => 'Un de plus']);
verifie('chat : au plus mille messages par salon de groupe', (int) valeur($chat, 'SELECT COUNT(*) FROM chat_messages WHERE canal = ?', ['g:' . $gamma]) === 1000);
$promoGamma = 'p:' . (string) valeur($pdo, 'SELECT promo_id FROM groupes WHERE id = ?', [$gamma]);
$lotP = [];
for ($i = 0; $i < 5001; $i++) {
    $lotP[] = '(?, ?, ?, ?, ?)';
}
$chat->prepare('INSERT INTO chat_messages (canal, auteur_id, auteur_nom, cree_le, texte) VALUES ' . implode(', ', $lotP))
    ->execute(array_merge(...array_map(static fn (int $i): array => [$promoGamma, $B['a7'], 'Gus T.', gmdate('Y-m-d H:i:s'), 'promo ' . $i], range(1, 5001))));
appel('a6@ci.test', 'chat_send', ['groupe_id' => $gamma, 'type' => 'promo', 'texte' => 'Un de plus pour la promo']);
verifie('chat : au plus cinq mille messages par salon de promo', (int) valeur($chat, 'SELECT COUNT(*) FROM chat_messages WHERE canal = ?', [$promoGamma]) === 5000);

// ---------- Préremplissage par DOI (la requête Crossref elle-même est testée sans réseau dans run.php) ----------
verifie('doi_lookup : saisie invalide refusée', $err(appel('a1@ci.test', 'doi_lookup', ['doi' => 'pas un doi'])) === 'invalid' && $err(appel('a1@ci.test', 'doi_lookup', [])) === 'invalid');
verifie('doi_lookup : permis aux formateurs pour leurs propositions (DOI invalide : erreur de saisie, pas de refus)', $err(appel('forma@ci.test', 'doi_lookup', ['doi' => 'pas-un-doi'])) === 'invalid');

// ---------- Fusion des doublons d'articles ----------
$nowM = gmdate('Y-m-d H:i:s');
$mkArt = static function (string $groupe, string $titre, string $doi = '', string $source = '') use ($pdo, $nowM): string {
    $id = Ids::uuid();
    $pdo->prepare('INSERT INTO articles (id, groupe_id, ajoute, titre, doi, source) VALUES (?, ?, ?, ?, ?, ?)')->execute([$id, $groupe, $nowM, $titre, $doi, $source]);
    return $id;
};
$mkAn = static function (string $art, int $uid, string $groupe, string $libre) use ($pdo, $nowM): string {
    $id = Ids::uuid();
    $pdo->prepare("INSERT INTO analyses (id, article_id, utilisateur_id, groupe_id, statut, portee, libre, ajoute) VALUES (?, ?, ?, ?, 'Terminée', 'promo', ?, ?)")->execute([$id, $art, $uid, $groupe, $libre, $nowM]);
    return $id;
};
$dA = $mkArt($alpha, 'Les soins palliatifs en gériatrie', '10.1234/soins');
$dB = $mkArt($alpha, 'Soins palliatifs en gériatrie, version longue', 'https://doi.org/10.1234/SOINS', 'Revue X');
$dC = $mkArt($gamma, 'Un article sans rapport avec les autres', '10.9999/autre');
$mkAn($dA, $B['a1'], $alpha, 'fiche A1');
$mkAn($dA, $B['a2'], $alpha, 'fiche A2');
$anB = $mkAn($dB, $B['a1'], $alpha, 'fiche B1 (même personne que A1)');
$pdo->prepare("INSERT INTO historique (cible, cible_id, modifie_par, proprietaire, avant, modifie_le) VALUES ('article', ?, NULL, NULL, '{}', ?)")->execute([$dB, $nowM]);
$pdo->prepare("INSERT INTO propositions (id, article_id, propose_par, cree_le, valeurs, statut) VALUES (?, ?, NULL, ?, '{}', 'ouvert')")->execute([Ids::uuid(), $dB, $nowM]);
verifie('doublons : réservé aux administrateurs', $err(appel('a1@ci.test', 'doublons_list')) === 'forbidden' && $err(appel('a1@ci.test', 'article_merge', ['data' => ['principal' => $dA, 'doublons' => [$dB]]])) === 'forbidden');
$cl = appel('ap@ci.test', 'doublons_list')['clusters'] ?? [];
$cl = array_values(array_filter($cl, static fn (array $g): bool => in_array($dA, array_column($g['articles'], 'id'), true)));
verifie('doublons : même DOI écrit différemment regroupé, article sans rapport écarté', count($cl) === 1 && count($cl[0]['articles']) === 2 && !in_array($dC, array_column($cl[0]['articles'], 'id'), true));
verifie('doublons : principal proposé = celui qui a le plus de fiches', ($cl[0]['propose'] ?? '') === $dA && ($cl[0]['articles'][0]['fiches'] ?? 0) === 2);
$e = appel('ap@ci.test', 'article_merge', ['data' => ['principal' => $dA, 'doublons' => [$dB]]]);
verifie('doublons : fusion refusée si une même personne a une fiche sur les deux', ($e['error'] ?? '') === 'invalid' && str_contains((string) ($e['message'] ?? ''), 'même personne')
    && (int) valeur($pdo, 'SELECT COUNT(*) FROM articles WHERE id = ?', [$dB]) === 1);
$pdo->prepare('DELETE FROM analyses WHERE id = ?')->execute([$anB]);
$mkAn($dB, $B['a3'], $alpha, 'fiche B3');
verifie('doublons : un article ne se fusionne pas avec lui-même, ni avec un inconnu', $err(appel('ap@ci.test', 'article_merge', ['data' => ['principal' => $dA, 'doublons' => [$dA]]])) === 'invalid'
    && $err(appel('ap@ci.test', 'article_merge', ['data' => ['principal' => $dA, 'doublons' => [Ids::uuid()]]])) === 'not_found');
$r = appel('ap@ci.test', 'article_merge', ['data' => ['principal' => $dA, 'doublons' => [$dB]]]);
verifie('doublons : fusion réussie, bilan renvoyé', ($r['ok'] ?? false) === true && ($r['bilan']['fiches'] ?? 0) === 1 && ($r['bilan']['champs_completes'] ?? 0) >= 1);
verifie('doublons : le doublon est supprimé, ses fiches rattachées au principal', (int) valeur($pdo, 'SELECT COUNT(*) FROM articles WHERE id = ?', [$dB]) === 0
    && (int) valeur($pdo, 'SELECT COUNT(*) FROM analyses WHERE article_id = ?', [$dA]) === 3);
verifie('doublons : champ vide du principal complété', valeur($pdo, 'SELECT source FROM articles WHERE id = ?', [$dA]) === 'Revue X');
verifie('doublons : historique et propositions suivent', (int) valeur($pdo, "SELECT COUNT(*) FROM historique WHERE cible = 'article' AND cible_id = ?", [$dA]) === 1
    && (int) valeur($pdo, 'SELECT COUNT(*) FROM propositions WHERE article_id = ?', [$dA]) === 1);
verifie('doublons : la grappe fusionnée n\'est plus proposée', array_filter(appel('ap@ci.test', 'doublons_list')['clusters'] ?? [], static fn (array $g): bool => in_array($dA, array_column($g['articles'], 'id'), true)) === []);
verifie('doublons : journal de la fusion', (int) valeur($pdo, "SELECT COUNT(*) FROM journal_admin WHERE action = 'article_merge'") === 1);
// Pièces jointes : une seule par article, celle du principal est gardée
$dE = $mkArt($alpha, 'Autre texte à fusionner : pièces jointes', '10.4321/pj');
$dF = $mkArt($alpha, 'Autre texte à fusionner : pièces jointes, bis', '10.4321/PJ');
foreach ([[$dE, 'e.pdf'], [$dF, 'f.pdf']] as [$art, $nom]) {
    $pdo->prepare('INSERT INTO fichiers (id, article_id, nom, type, taille, chemin, cree_par, cree_le) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)')->execute([Ids::uuid(), $art, $nom, 'application/pdf', 5, 'absent-' . $nom, $nowM]);
}
verifie('doublons : fusion avec deux pièces jointes', (appel('ap@ci.test', 'article_merge', ['data' => ['principal' => $dE, 'doublons' => [$dF]]])['bilan']['fichiers_retires'] ?? 0) === 1
    && (int) valeur($pdo, 'SELECT COUNT(*) FROM fichiers WHERE article_id = ?', [$dE]) === 1 && valeur($pdo, 'SELECT nom FROM fichiers WHERE article_id = ?', [$dE]) === 'e.pdf');
// « Pas des doublons »
$dG = $mkArt($alpha, 'Deux éditions différentes du même titre', '');
$dH = $mkArt($alpha, 'Deux éditions différentes du même titre', '');
$vu = static fn (string $a): int => count(array_filter(appel('ap@ci.test', 'doublons_list')['clusters'] ?? [], static fn (array $g): bool => in_array($a, array_column($g['articles'], 'id'), true)));
verifie('doublons : même titre sans DOI proposé', $vu($dG) === 1);
verifie('doublons : « pas des doublons » les retire de la liste', (appel('ap@ci.test', 'doublons_ignore', ['data' => ['ids' => [$dG, $dH]]])['ok'] ?? false) === true && $vu($dG) === 0);
// Périmètre : un article d'une autre promo
$g2 = Ids::uuid();
$pdo->prepare('INSERT INTO groupes (id, promo_id, nom, cree_le) VALUES (?, ?, ?, ?)')->execute([$g2, $promo2, 'Hors périmètre', $nowM]);
$dD = $mkArt($g2, 'Les soins palliatifs en gériatrie', '10.1234/SOINS');
verifie('doublons : un groupe d\'articles dont un est hors périmètre n\'est pas proposé à l\'admin de promo', $vu($dA) === 0
    && $err(appel('ap@ci.test', 'article_merge', ['data' => ['principal' => $dA, 'doublons' => [$dD]]])) === 'forbidden');
$vuAdmin = array_values(array_filter(appel($admin, 'doublons_list')['clusters'] ?? [], static fn (array $g): bool => in_array($dD, array_column($g['articles'], 'id'), true)));
verifie('doublons : l\'administrateur général le voit et le fusionne', count($vuAdmin) === 1 && (appel($admin, 'article_merge', ['data' => ['principal' => $dA, 'doublons' => [$dD]]])['ok'] ?? false) === true
    && (int) valeur($pdo, 'SELECT COUNT(*) FROM articles WHERE id = ?', [$dD]) === 0);

// ---------- Lot D : traduction des mots-clés ----------
$r = appel('a1@ci.test', 'translate', ['texte' => 'soins palliatifs, Douleur; fin de vie, Éthique, douleur']);
verifie('traduction : termes du glossaire, sans service externe', ($r['ok'] ?? false) === true && array_column($r['items'], 'en') === ['palliative care', 'pain', 'end of life', 'ethics']
    && array_unique(array_column($r['items'], 'niveau')) === ['haute']);
$r = appel('a1@ci.test', 'translate', ['texte' => 'cirrhose']);
verifie('traduction : terme inconnu sans service, signalé', ($r['items'][0]['en'] ?? 'x') === '' && ($r['items'][0]['niveau'] ?? '') === 'faible' && str_contains((string) ($r['items'][0]['raison'] ?? ''), 'aucun service'));
verifie('traduction : validations', $err(appel('a1@ci.test', 'translate', ['texte' => ' , ; '])) === 'invalid' && $err(appel('a1@ci.test', 'translate', ['texte' => str_repeat('a', 601)])) === 'invalid'
    && $err(appel('a1@ci.test', 'translate', ['texte' => implode(',', array_map(static fn (int $i): string => 'terme' . $i, range(1, 31)))])) === 'invalid'
    && $err(appel('forma@ci.test', 'translate', ['texte' => 'douleur'])) === 'forbidden');
$faux = static function (array $termes, string $de, string $vers): array {
    $aller = ['cirrhose' => 'cirrhosis', 'hépatite virale' => 'viral hepatitis', 'ADN' => 'ADN', 'prise en charge globale' => 'comprehensive care', 'foie gras' => 'fatty liver', 'x y z' => 'a b c'];
    $retour = ['cirrhosis' => 'cirrhose', 'viral hepatitis' => 'hépatite virale', 'ADN' => 'ADN', 'comprehensive care' => 'prise en charge', 'fatty liver' => 'foie gras', 'a b c' => 'u v w'];
    return array_map(static fn (string $t): string => ($de === 'fr' ? $aller : $retour)[$t] ?? '', $termes);
};
$r = \Lpc\Traduction::traduire('cirrhose, hépatite virale, ADN, prise en charge globale, foie gras, x y z, santé publique', $faux);
$niv = array_column($r, 'niveau', 'fr');
verifie('traduction : fiabilité selon la retraduction', $niv['cirrhose'] === 'haute' && $niv['hépatite virale'] === 'haute' && $niv['ADN'] === 'moyenne' && $niv['prise en charge globale'] === 'moyenne'
    && $niv['foie gras'] === 'haute' && $niv['x y z'] === 'faible' && $niv['santé publique'] === 'haute' && array_column($r, 'en', 'fr')['santé publique'] === 'public health');
$r = \Lpc\Traduction::traduire('cirrhose', static function (array $t, string $d, string $v): array {
    throw new RuntimeException('service coupé');
});
verifie('traduction : service en panne, terme signalé sans traduction', $r[0]['en'] === '' && $r[0]['niveau'] === 'faible' && $r[0]['raison'] === 'aucune traduction obtenue');

// ---------- Lot D : pièces jointes ----------
$pdf = "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n";
$png = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==');
$dossierFichiers = $config->dossierPrive() . '/fichiers';
$r = appel('a6@ci.test', 'add', ['data' => array_merge($art1, ['titre' => 'Article pour pièces jointes', 'statut' => 'Terminée'])]);
$fx = (string) ($r['id'] ?? '');
$ax = (string) valeur($pdo, 'SELECT article_id FROM analyses WHERE id = ?', [$fx]);
$fa1 = (string) (appel('a1@ci.test', 'add', ['data' => ['article_id' => $ax, 'statut' => 'À lire']])['id'] ?? '');
verifie('pièces jointes : fiche de départ', $fx !== '' && $fa1 !== '');
$envoi = static fn (string $email, string $contenu, string $nom = 'rapport.pdf'): array => appel($email, 'file_add', ['article_id' => $ax, 'nom' => $nom, 'data' => base64_encode($contenu)]);
verifie('pièce jointe : refusée sans fiche sur l\'article', $err($envoi('a2@ci.test', $pdf)) === 'forbidden');
verifie('pièce jointe : lecture seule pour un formateur', $err($envoi('forma@ci.test', $pdf)) === 'forbidden');
verifie('pièce jointe : article invisible', $err(appel('nouvelle@ci.test', 'file_add', ['article_id' => $ax, 'nom' => 'a.pdf', 'data' => base64_encode($pdf)])) === 'not_found');
verifie('pièce jointe : vide, illisible, format ou taille refusés', $err(appel('a6@ci.test', 'file_add', ['article_id' => $ax, 'nom' => 'a.pdf', 'data' => ''])) === 'invalid'
    && $err(appel('a6@ci.test', 'file_add', ['article_id' => $ax, 'nom' => 'a.pdf', 'data' => '!!!'])) === 'invalid'
    && $err($envoi('a6@ci.test', 'bonjour, ce n\'est pas un PDF')) === 'invalid'
    && $err($envoi('a6@ci.test', '%PDF' . str_repeat('A', 6 * 1024 * 1024))) === 'invalid');
$r = $envoi('a6@ci.test', $pdf, "..\\dossier/Mon Rapport.PDF");
$fic = $r['fichiers'][0] ?? [];
verifie('pièce jointe : déposée, nom assaini, réponse partielle', ($r['ok'] ?? false) === true && ($r['partiel'] ?? false) === true && ($fic['nom'] ?? '') === 'Mon Rapport.pdf'
    && ($fic['type'] ?? '') === 'application/pdf' && ($fic['taille'] ?? 0) === strlen($pdf) && ($fic['par'] ?? '') === 'Fay T.' && ($fic['supprimable'] ?? false) === true);
$fid = (string) ($fic['id'] ?? '');
$chemin = (string) valeur($pdo, 'SELECT chemin FROM fichiers WHERE id = ?', [$fid]);
verifie('pièce jointe : stockée hors du web, en base seulement le chemin relatif', str_ends_with($chemin, '.pdf') && !str_contains($chemin, '/') && is_file($dossierFichiers . '/' . $chemin)
    && file_get_contents($dossierFichiers . '/' . $chemin) === $pdf);
verifie('pièce jointe : une seule par article', $err($envoi('a1@ci.test', $pdf)) === 'invalid');
verifie('pièce jointe : visible de qui voit l\'article', count($suivi('a1@ci.test', 'fichiers')) === 1 && count($suivi('a4@ci.test', 'fichiers')) === 1 && $suivi('nouvelle@ci.test', 'fichiers') === []);
verifie('pièce jointe : supprimable par une autre autrice d\'une fiche sur l\'article', ($suivi('a1@ci.test', 'fichiers')[0]['supprimable'] ?? false) === true && ($suivi('a4@ci.test', 'fichiers')[0]['supprimable'] ?? true) === false);
$lu = appel('a4@ci.test', 'file_get', ['id' => $fid]);
verifie('pièce jointe : lue par qui voit l\'article', ($lu['ok'] ?? false) === true && base64_decode((string) $lu['data']) === $pdf && $lu['nom'] === 'Mon Rapport.pdf' && $lu['type'] === 'application/pdf');
verifie('pièce jointe : introuvable pour qui ne voit pas l\'article', $err(appel('nouvelle@ci.test', 'file_get', ['id' => $fid])) === 'not_found' && $err(appel('a4@ci.test', 'file_get', ['id' => Ids::uuid()])) === 'not_found');
verifie('pièce jointe : suppression refusée à qui n\'a pas de fiche sur l\'article', $err(appel('a4@ci.test', 'file_delete', ['id' => $fid])) === 'forbidden');
verifie('pièce jointe supprimée par une autre autrice, fichier effacé du disque', (appel('a1@ci.test', 'file_delete', ['id' => $fid])['fichiers'] ?? null) === [] && !is_file($dossierFichiers . '/' . $chemin));
$r = $envoi('a1@ci.test', $png, 'schema.pdf');
verifie('pièce jointe : le type vient du contenu, pas du nom', ($r['fichiers'][0]['type'] ?? '') === 'image/png' && ($r['fichiers'][0]['nom'] ?? '') === 'schema.png');
appel('a1@ci.test', 'file_delete', ['id' => (string) valeur($pdo, 'SELECT id FROM fichiers WHERE article_id = ?', [$ax])]);
$pdo->prepare('UPDATE groupes SET quota_octets = 10 WHERE id = ?')->execute([$gamma]);
$r = $envoi('a6@ci.test', $pdf);
verifie('pièce jointe : refusée au-delà du quota du groupe', ($r['error'] ?? '') === 'invalid' && str_contains((string) ($r['message'] ?? ''), 'quota')
    && (int) valeur($pdo, 'SELECT COUNT(*) FROM fichiers WHERE article_id = ?', [$ax]) === 0);
$pdo->prepare('UPDATE groupes SET quota_octets = NULL WHERE id = ?')->execute([$gamma]);
if (function_exists('imagecreatetruecolor') && function_exists('imagejpeg')) {
    $im = imagecreatetruecolor(2400, 1200);
    for ($i = 0; $i < 600; $i++) {
        imagefilledrectangle($im, random_int(0, 2300), random_int(0, 1100), random_int(0, 2300) + 100, random_int(0, 1100) + 100, (int) imagecolorallocate($im, random_int(0, 255), random_int(0, 255), random_int(0, 255)));
    }
    ob_start();
    imagejpeg($im, null, 95);
    $grande = (string) ob_get_clean();
    $r = $envoi('a6@ci.test', $grande, 'grande.jpg');
    $stocke = (string) file_get_contents($dossierFichiers . '/' . (string) valeur($pdo, 'SELECT chemin FROM fichiers WHERE article_id = ?', [$ax]));
    $dim = getimagesizefromstring($stocke) ?: [0, 0];
    verifie('image trop grande : réduite à 1600 px', ($r['ok'] ?? false) === true && $dim[0] === 1600 && $dim[1] === 800 && strlen($stocke) < strlen($grande));
} else {
    echo "saut   réduction d'image : GD absent\n";
}
verifie('stockage : visible de l\'admin global', ($s = appel($admin, 'admin_list')['stockage'] ?? []) && $s['nb'] >= 1 && $s['octets'] > 0);
$stockes = array_map('strval', $pdo->query('SELECT chemin FROM fichiers')->fetchAll(PDO::FETCH_COLUMN));
appel('a6@ci.test', 'delete', ['id' => $fx]);
appel('a1@ci.test', 'delete', ['id' => $fa1]);
verifie('article supprimé : ses pièces jointes aussi, base et disque', (int) valeur($pdo, 'SELECT COUNT(*) FROM articles WHERE id = ?', [$ax]) === 0
    && (int) valeur($pdo, 'SELECT COUNT(*) FROM fichiers WHERE article_id = ?', [$ax]) === 0
    && array_filter($stockes, static fn (string $c): bool => is_file($GLOBALS['dossierFichiers'] . '/' . $c)) === []);

// ---------- Contraintes de la base (portabilité MariaDB / MySQL) ----------
verifie('établissement : nom unique sans tenir compte de la casse ni des accents', leveSql(fn () => creerEtablissement($pdo, 'ifsi saint-nazairé'), '23000'));
verifie('promo : nom unique dans l\'établissement', leveSql(fn () => creerPromo($pdo, $etab, 'promo 24-27'), '23000'));
verifie('même nom de promo dans un autre établissement : permis', creerPromo($pdo, $etab2, 'Promo 25-28') !== '');
verifie('adresse unique (insensible à la casse)', leveSql(fn () => creerUtilisateur($pdo, 'ETU@ci.test'), '23000'));
verifie('mode strict : valeur trop longue refusée', leveSql(fn () => $pdo->prepare('UPDATE utilisateurs SET prenom = ? WHERE id = ?')->execute([str_repeat('a', 200), $etu]), '22001'));
verifie('énumération : statut inconnu refusé', refuseSql(fn () => $pdo->prepare('UPDATE utilisateurs SET statut = ? WHERE id = ?')->execute(['inconnu', $etu])));

// ---------- Dictionnaire de traductions et quota du service externe ----------
$appelsSvc = 0;
$svc = static function (array $t, string $d, string $v) use (&$appelsSvc): array {
    $appelsSvc++;
    return array_map(static fn (string $x): string => $d === 'fr' ? 'EN:' . $x : (str_starts_with($x, 'EN:') ? substr($x, 3) : $x), $t);
};
$r1 = \Lpc\Traduction::traduireAvecDictionnaire('cirrhose hépatique, douleur', $svc, $pdo, 1000, '2099-01');
verifie('dictionnaire : terme inconnu envoyé au service (aller et retour), terme du glossaire non', $appelsSvc === 2 && $r1['items'][1]['en'] === 'pain' && $r1['items'][0]['en'] === 'EN:cirrhose hépatique' && $r1['quota'] === false);
verifie('dictionnaire : caractères envoyés comptés', $r1['caracteres'] === 39 && (int) valeur($pdo, "SELECT caracteres FROM traduction_usage WHERE mois = '2099-01'") === 39);
verifie('dictionnaire : traduction mémorisée', valeur($pdo, "SELECT en FROM traductions WHERE cle = 'cirrhose hepatique'") === 'EN:cirrhose hépatique');
$r2 = \Lpc\Traduction::traduireAvecDictionnaire('Cirrhose hépatique', $svc, $pdo, 1000, '2099-01');
verifie('dictionnaire : un terme déjà traduit ne repart pas au service', $appelsSvc === 2 && $r2['items'][0]['en'] === 'EN:cirrhose hépatique' && str_contains($r2['items'][0]['raison'], 'déjà traduit') && $r2['caracteres'] === 0);
$r3 = \Lpc\Traduction::traduireAvecDictionnaire('hépatite virale chronique', $svc, $pdo, 50, '2099-01');
verifie('quota local atteint : pas d\'appel, terme sans traduction, avertissement possible', $appelsSvc === 2 && $r3['quota'] === true && $r3['items'][0]['en'] === '' && str_contains($r3['items'][0]['raison'], 'limité ce mois-ci'));
verifie('quota local atteint : les termes connus restent traduits', \Lpc\Traduction::traduireAvecDictionnaire('douleur, cirrhose hépatique, hépatite virale chronique', $svc, $pdo, 50, '2099-01')['items'][0]['en'] === 'pain');
$refus = static function (array $t, string $d, string $v) use (&$appelsSvc): array {
    $appelsSvc++;
    throw new \Lpc\QuotaDeepl('quota');
};
$avant = $appelsSvc;
$r4 = \Lpc\Traduction::traduireAvecDictionnaire('suivi post-opératoire', $refus, $pdo, 0, '2099-02');
verifie('quota refusé par le service : détecté, le reste n\'est pas bloqué', $r4['quota'] === true && $r4['items'][0]['en'] === '' && $appelsSvc === $avant + 1);
$r5 = \Lpc\Traduction::traduireAvecDictionnaire('autre terme inconnu', $svc, $pdo, 0, '2099-02');
verifie('quota refusé : plus aucun appel jusqu\'au mois suivant', $r5['quota'] === true && $appelsSvc === $avant + 1 && (int) valeur($pdo, "SELECT bloque FROM traduction_usage WHERE mois = '2099-02'") === 1);
$r6 = \Lpc\Traduction::traduireAvecDictionnaire('autre terme inconnu', $svc, $pdo, 0, '2099-03');
verifie('nouveau mois : le service est de nouveau utilisé', $r6['quota'] === false && $r6['items'][0]['en'] === 'EN:autre terme inconnu' && $appelsSvc === $avant + 3);
verifie('dictionnaire : sans service, les termes inconnus reviennent vides sans alerte de quota', \Lpc\Traduction::traduireAvecDictionnaire('terme jamais vu', null, $pdo, 0, '2099-04')['quota'] === false);
verifie('dictionnaire : saisie vide refusée comme avant', leve(fn () => \Lpc\Traduction::traduireAvecDictionnaire(' , ', $svc, $pdo), 'invalid'));
$rt = appel('a1@ci.test', 'translate', ['texte' => 'douleur']);
verifie('translate : réponse avec indicateur de quota', ($rt['ok'] ?? false) === true && ($rt['quota'] ?? null) === false && !isset($rt['avertissement']));

// ---------- Chat activable, couleur du profil, « voir en tant que » ----------
verifie('chat : règles réservées aux administrateurs', $err(appel('a1@ci.test', 'chat_regles')) === 'forbidden');
$rg = appel('ap@ci.test', 'chat_regles')['regles'] ?? [];
verifie('chat : l\'admin de promo ne voit pas la règle générale', ($rg['peut_general'] ?? true) === false && array_key_exists('general', $rg) && $rg['general'] === null);
verifie('chat : par défaut, actif partout', ($salonA = appel('a1@ci.test', 'chat_list', $salon('groupe'))['ok'] ?? false) === true);
verifie('chat : l\'admin de promo ne règle ni le général ni une autre promo', $err(appel('ap@ci.test', 'chat_regle_set', ['data' => ['portee' => 'general', 'valeur' => 'inactif']])) === 'forbidden'
    && $err(appel('ap@ci.test', 'chat_regle_set', ['data' => ['portee' => 'promo', 'cible' => $promo2, 'valeur' => 'inactif']])) === 'forbidden');
verifie('chat : valeur ou portée inconnues refusées', $err(appel('ap@ci.test', 'chat_regle_set', ['data' => ['portee' => 'promo', 'cible' => $pv, 'valeur' => 'peut-etre']])) === 'invalid'
    && $err(appel('ap@ci.test', 'chat_regle_set', ['data' => ['portee' => 'ciel', 'cible' => $pv, 'valeur' => 'actif']])) === 'invalid');
verifie('chat : désactivé pour une promo', (appel('ap@ci.test', 'chat_regle_set', ['data' => ['portee' => 'promo', 'cible' => $pv, 'valeur' => 'inactif']])['ok'] ?? false) === true);
$e = appel('a1@ci.test', 'chat_list', $salon('groupe'));
verifie('chat : salons du groupe et de la promo refusés, avec le motif', ($e['error'] ?? '') === 'forbidden' && str_contains((string) ($e['message'] ?? ''), 'désactivé')
    && $err(appel('a1@ci.test', 'chat_list', $salon('promo'))) === 'forbidden' && $err(appel('a1@ci.test', 'chat_send', $salon('groupe') + ['texte' => 'x'])) === 'forbidden');
$ga = array_values(array_filter(appel('a1@ci.test', 'init')['groupes'] ?? [], static fn (array $g): bool => $g['id'] === $alpha))[0] ?? [];
verifie('chat : l\'indicateur du groupe suit la règle', ($ga['chat'] ?? null) === false && ($ga['chat_promo'] ?? null) === false);
appel('ap@ci.test', 'chat_regle_set', ['data' => ['portee' => 'groupe', 'cible' => $alpha, 'valeur' => 'actif']]);
verifie('chat : la règle du groupe l\'emporte sur celle de la promo', ($ga2 = appel('a1@ci.test', 'chat_list', $salon('groupe'))['ok'] ?? false) === true && $err(appel('a1@ci.test', 'chat_list', $salon('promo'))) === 'forbidden');
appel($admin, 'chat_regle_set', ['data' => ['portee' => 'general', 'valeur' => 'inactif']]);
appel('ap@ci.test', 'chat_regle_set', ['data' => ['portee' => 'promo', 'cible' => $pv, 'valeur' => 'herite']]);
appel('ap@ci.test', 'chat_regle_set', ['data' => ['portee' => 'groupe', 'cible' => $alpha, 'valeur' => 'herite']]);
verifie('chat : la règle générale s\'applique quand rien de plus précis n\'existe', $err(appel('a1@ci.test', 'chat_list', $salon('groupe'))) === 'forbidden' && (appel($admin, 'chat_regles')['regles']['general'] ?? null) === false);
appel($admin, 'chat_regle_set', ['data' => ['portee' => 'general', 'valeur' => 'herite']]);
verifie('chat : règles retirées, chat de nouveau actif', (appel('a1@ci.test', 'chat_list', $salon('groupe'))['ok'] ?? false) === true && (int) valeur($pdo, 'SELECT COUNT(*) FROM chat_regles') === 0);

$rc = appel('a1@ci.test', 'profile_update', ['data' => ['couleur' => '#AABBCC']]);
verifie('profil : couleur choisie', ($rc['ok'] ?? false) === true && ($rc['me']['couleur'] ?? '') === '#aabbcc' && valeur($pdo, "SELECT couleur FROM utilisateurs WHERE email = 'a1@ci.test'") === '#aabbcc');
verifie('profil : couleur invalide refusée', $err(appel('a1@ci.test', 'profile_update', ['data' => ['couleur' => 'rouge']])) === 'invalid' && $err(appel('a1@ci.test', 'profile_update', ['data' => ['couleur' => '#12345']])) === 'invalid');
$jl = appel('a1@ci.test', 'list')['jalons'] ?? [];
verifie('rétroplanning : couleur de la personne qui a créé l\'entrée', $jl !== [] && preg_match('/^#[0-9a-f]{6}$/i', (string) ($jl[0]['par_couleur'] ?? '')) === 1);

// ---------- Bac à sable : comptes de test par rôle, jamais ceux de vraies personnes ----------
$pidA1 = (string) valeur($pdo, "SELECT pid FROM utilisateurs WHERE email = 'a1@ci.test'");
$bs = appel($admin, 'bac_sable_reinit');
$pidDe = static fn (array $r, string $role): string => (string) (array_values(array_filter($r['personas'] ?? [], static fn (array $p): bool => $p['role'] === $role))[0]['pid'] ?? '');
verifie('bac à sable : créé avec un compte de test par rôle', ($bs['ok'] ?? false) === true && count($bs['personas'] ?? []) === 7 && ($bs['existe'] ?? false) === true);
verifie('bac à sable : réservé à l\'administrateur général', $err(appel('ap@ci.test', 'bac_sable_reinit')) === 'forbidden' && $err(appel('a1@ci.test', 'bac_sable_etat')) === 'forbidden');
verifie('bac à sable : données d\'exemple créées par les comptes de test', (int) valeur($pdo, 'SELECT COUNT(*) FROM analyses a JOIN utilisateurs u ON u.id = a.utilisateur_id WHERE u.test = 1') >= 4
    && (int) valeur($pdo, "SELECT COUNT(*) FROM suggestions s JOIN promos p ON p.id = s.promo_id JOIN etablissements e ON e.id = p.etablissement_id WHERE e.test = 1") === 1);
$pidAna = $pidDe($bs, 'Étudiante · groupe 1');
$vc = appel($admin, 'init', ['as' => $pidAna]);
verifie('bac à sable : l\'administrateur agit comme le compte de test', ($vc['ok'] ?? false) === true && ($vc['me']['role'] ?? '') === 'etudiant' && ($vc['vue_en_tant_que']['pid'] ?? '') === $pidAna);
verifie('bac à sable : jamais le compte d\'une vraie personne', $err(appel($admin, 'init', ['as' => $pidA1])) === 'not_found' && $err(appel($admin, 'init', ['as' => 'inconnu00000'])) === 'not_found');
verifie('bac à sable : réservé à l\'administrateur général (usurpation)', $err(appel('a2@ci.test', 'init', ['as' => $pidAna])) === 'forbidden' && $err(appel('ap@ci.test', 'init', ['as' => $pidAna])) === 'forbidden');
$avant = count(appel($admin, 'list', ['as' => $pidAna])['lectures'] ?? []);
$r = appel($admin, 'add', ['as' => $pidAna, 'data' => ['titre' => 'Essai dans le bac à sable', 'statut' => 'À lire']]);
verifie('bac à sable : on peut agir (écrire) avec un compte de test', ($r['ok'] ?? false) === true && count($r['lectures'] ?? []) === $avant + 1);
$pidAp = $pidDe($bs, 'Administratrice de promo');
verifie('bac à sable : un compte administrateur de test voit la demande d\'accès fictive', array_filter(appel($admin, 'admin_list', ['as' => $pidAp])['acces'] ?? [], static fn (array $a): bool => str_contains((string) $a['email'], 'bac-a-sable') && $a['statut'] === 'en_attente') !== []);
verifie('bac à sable : invisible des vraies listes', array_filter(appel($admin, 'admin_list')['acces'] ?? [], static fn (array $a): bool => str_contains((string) $a['email'], 'bac-a-sable')) === []
    && !str_contains(json_encode(appel('inconnue@ci.test', 'onboarding')) ?: '', 'Bac à sable'));
verifie('bac à sable : journalisé', (int) valeur($pdo, "SELECT COUNT(*) FROM journal_admin WHERE action = 'voir_en_tant_que'") >= 1 && (int) valeur($pdo, "SELECT COUNT(*) FROM journal_admin WHERE action = 'bac_sable_reinit'") === 1);
appel($admin, 'bac_sable_reinit');
verifie('bac à sable : remis à zéro sans doublon ni reste', (int) valeur($pdo, 'SELECT COUNT(*) FROM etablissements WHERE test = 1') === 1 && (int) valeur($pdo, 'SELECT COUNT(*) FROM utilisateurs WHERE test = 1') === 8
    && (int) valeur($pdo, 'SELECT COUNT(*) FROM analyses a JOIN utilisateurs u ON u.id = a.utilisateur_id WHERE u.test = 1 AND a.article_id IN (SELECT id FROM articles WHERE titre = ?)', ['Essai dans le bac à sable']) === 0);
// On nettoie : la suite des tests ne doit pas voir le bac à sable.
$pdo->exec('DELETE FROM articles WHERE groupe_id IN (SELECT g.id FROM groupes g JOIN promos p ON p.id = g.promo_id JOIN etablissements e ON e.id = p.etablissement_id WHERE e.test = 1)');
$pdo->exec('DELETE FROM etablissements WHERE test = 1');
$pdo->exec('DELETE FROM utilisateurs WHERE test = 1');

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
