<?php
// Tests de l'import différentiel, avec des données entièrement fictives (aucun vrai Sheet, aucun réseau) :
//   LPC_CONFIG=/chemin/config.php php tests/import.php
// ATTENTION : écrit dans les bases de la configuration. À n'utiliser que sur des bases de test vides.
declare(strict_types=1);

require dirname(__DIR__) . '/api/src/autoload.php';
require __DIR__ . '/outils.php';

use Lpc\Config;
use Lpc\Db;
use Lpc\GoogleApi;
use Lpc\Importation;

$config = Config::charger(getenv('LPC_CONFIG') ?: null);
$db = new Db($config);
$pdo = $db->principale();

if ((int) $pdo->query('SELECT COUNT(*) FROM utilisateurs')->fetchColumn() !== 0) {
    fwrite(STDERR, "Refus : la base principale n'est pas vide. Ces tests exigent une base de test vide.\n");
    exit(2);
}

function valeur(PDO $pdo, string $sql, array $params = []): mixed
{
    $st = $pdo->prepare($sql);
    $st->execute($params);
    $v = $st->fetchColumn();
    return $v === false ? null : $v;
}

function u(int $n): string
{
    return sprintf('00000000-0000-4000-8000-%012d', $n);
}

/** Ligne d'un onglet (par noms de colonnes), complétée à la largeur de l'onglet. */
function ligne(string $onglet, array $v): array
{
    $out = [];
    foreach (Importation::COLONNES[$onglet] as $c) {
        $out[] = (string) ($v[$c] ?? '');
    }
    return $out;
}

const T0 = '2024-05-01T10:00:00.000Z';

/** @return array<string,list<list<string>>> */
function sheet(): array
{
    return [
        'Etablissements' => [ligne('Etablissements', ['id' => u(1), 'nom' => 'IFSI Test', 'cree_le' => T0])],
        'Promos' => [ligne('Promos', ['id' => u(2), 'etablissement_id' => u(1), 'nom' => 'Promo 2024', 'cree_le' => T0])],
        'Utilisateurs' => [
            ligne('Utilisateurs', ['email' => 'prof@ci.test', 'prenom' => 'Pat Prof', 'role' => 'formateur', 'couleur' => '#112233', 'statut' => 'actif']),
            ligne('Utilisateurs', ['email' => 'Etu1@CI.test', 'prenom' => 'Camille D.', 'role' => 'etudiant', 'statut' => 'actif', 'derniere_connexion' => T0,
                'consentement_le' => T0, 'consentement_version' => '1']),
            ligne('Utilisateurs', ['email' => 'etu2@ci.test', 'prenom' => 'Alex M.', 'role' => 'etudiant', 'statut' => 'actif']),
            ligne('Utilisateurs', ['email' => 'attente@ci.test', 'prenom' => 'Nono N.', 'role' => 'etudiant', 'statut' => 'en_attente', 'demande_le' => T0,
                'promo_demandee' => u(2), 'role_demande' => 'etudiant']),
            ligne('Utilisateurs', ['email' => 'adopte@ci.test', 'prenom' => 'Ancien A.', 'role' => 'etudiant', 'statut' => 'actif']),
            ligne('Utilisateurs', ['email' => 'pas-une-adresse', 'prenom' => 'X', 'role' => 'etudiant', 'statut' => 'actif']),
        ],
        'Inscriptions' => [
            ligne('Inscriptions', ['id' => u(10), 'email' => 'etu1@ci.test', 'promo_id' => u(2), 'ajoute_le' => T0]),
            ligne('Inscriptions', ['id' => u(11), 'email' => 'prof@ci.test', 'promo_id' => u(2), 'ajoute_le' => T0]),
        ],
        'Groupes' => [ligne('Groupes', ['id' => u(20), 'etablissement' => 'IFSI Test', 'promo' => 'Promo 2024', 'nom' => 'Groupe A', 'cree_le' => T0, 'cree_par' => 'etu1@ci.test'])],
        'Membres' => [
            ligne('Membres', ['id' => u(21), 'groupe_id' => u(20), 'email' => 'etu1@ci.test', 'ajoute_le' => T0]),
            ligne('Membres', ['id' => u(22), 'groupe_id' => u(20), 'email' => 'etu2@ci.test', 'ajoute_le' => T0]),
        ],
        'Votes' => [ligne('Votes', ['id' => u(30), 'groupe_id' => u(20), 'type' => 'retrait', 'cible' => 'etu2@ci.test', 'propose_par' => 'etu1@ci.test',
            'cree_le' => T0, 'votes' => '{"etu1@ci.test":1}', 'statut' => 'ouvert'])],
        'Articles' => [ligne('Articles', ['id' => u(40), 'cree_par' => 'etu1@ci.test', 'groupe_id' => u(20), 'ajoute' => T0, 'modifie_par' => 'Camille D.',
            'titre' => 'Titre A', 'parution' => '2020', 'auteur' => 'Dupont', 'type' => 'Article scientifique', 'doi' => '10.1/abc'])],
        'Lectures' => [
            ligne('Lectures', ['id' => u(50), 'owner' => 'etu1@ci.test', 'statut' => 'Terminée', 'article_id' => u(40), 'groupe_id' => u(20), 'ajoute' => T0, 'libre' => 'Ma lecture']),
            ligne('Lectures', ['id' => u(51), 'owner' => 'etu2@ci.test', 'statut' => 'En cours', 'article_id' => u(40), 'groupe_id' => u(20), 'ajoute' => T0, 'priorite' => 'haute']),
        ],
        'Propositions' => [ligne('Propositions', ['id' => u(60), 'article_id' => u(40), 'propose_par' => 'etu2@ci.test', 'cree_le' => T0,
            'valeurs' => '{"titre":"Titre B"}', 'votes' => '{"etu1@ci.test":1}', 'statut' => 'ouvert'])],
        'Commentaires' => [ligne('Commentaires', ['id' => u(70), 'lecture_id' => u(50), 'auteur_email' => 'etu2@ci.test', 'date' => T0, 'texte' => 'Bravo', 'portee' => 'groupe', 'groupe_id' => u(20)])],
        'Lus' => [ligne('Lus', ['id' => 'etu1@ci.test', 'commentaires' => u(70)])],
        'Historique' => [ligne('Historique', ['date' => T0, 'id' => u(40), 'modifie_par' => 'Camille D.', 'proprietaire' => 'Camille D.', 'avant' => '{"titre":"Titre 0"}'])],
        'Reunions' => [ligne('Reunions', ['id' => u(80), 'groupe_id' => u(20), 'date' => '2024-06-01', 'titre' => 'Lancement', 'cree_par' => 'etu1@ci.test', 'cree_le' => T0])],
        'Jalons' => [ligne('Jalons', ['id' => u(81), 'groupe_id' => u(20), 'titre' => 'Plan', 'echeance' => '2024-09-01', 'statut' => 'en_cours', 'cree_le' => T0, 'alerte_jours' => '7'])],
        'Glossaire' => [ligne('Glossaire', ['id' => u(82), 'groupe_id' => u(20), 'mot' => 'Soin', 'definition' => 'Un soin', 'cree_le' => T0])],
        'Notes' => [
            ligne('Notes', ['id' => u(83), 'owner' => 'etu1@ci.test', 'titre' => 'Ma note', 'date' => '2024-05-02', 'texte' => 'Texte', 'liens' => '[]', 'etiquettes' => '["a"]', 'cree_le' => T0]),
            ligne('Notes', ['id' => u(87), 'owner' => 'etu1@ci.test', 'titre' => 'Autre note', 'date' => '2024-05-02', 'cree_le' => T0]),
        ],
        'Feedback' => [
            ligne('Feedback', ['id' => u(84), 'auteur_email' => 'etu2@ci.test', 'type' => 'idee', 'texte' => 'Une idée', 'jour' => '2024-05-03', 'cree_le' => T0]),
            ligne('Feedback', ['id' => u(86), 'auteur_email' => 'etu2@ci.test', 'type' => 'bug', 'texte' => 'Un bug', 'jour' => '2024-05-03', 'cree_le' => T0]),
        ],
        'Fichiers' => [ligne('Fichiers', ['id' => u(85), 'article_id' => u(40), 'drive_id' => 'DRV1', 'nom' => 'cours.pdf', 'cree_par' => 'etu1@ci.test', 'cree_le' => T0])],
    ];
}

$telechargements = 0;
$drive = static function (string $id) use (&$telechargements): string {
    $telechargements++;
    return "%PDF-1.4\nfichier fictif $id\n";
};

function importer(array $onglets, bool $aBlanc = false, bool $supprimer = false): array
{
    global $config, $db, $drive;
    return (new Importation($config, $db, $onglets, $drive, $aBlanc, $supprimer))->executer();
}

function nb(PDO $pdo, string $table): int
{
    return (int) $pdo->query("SELECT COUNT(*) FROM `$table`")->fetchColumn();
}

// ---------- Aides ----------
verifie('nom « Camille D. » séparé en prénom et initiale', Importation::separerNom('Camille D.') === ['Camille', 'D']);
verifie('nom composé sans initiale : tout en prénom', Importation::separerNom('Jean-Pierre') === ['Jean-Pierre', '']);
verifie('deux initiales', Importation::separerNom('Marie A.B.') === ['Marie', 'AB']);

// Compte déjà créé dans le nouvel outil avant l'import : il prévaut
$now = gmdate('Y-m-d H:i:s');
$pdo->prepare('INSERT INTO utilisateurs (pid, email, prenom, nom, statut, cree_le) VALUES (?, ?, ?, ?, ?, ?)')
    ->execute([\Lpc\Ids::pid('adopte@ci.test'), 'adopte@ci.test', 'Neuf', 'Nom', 'actif', $now]);
$idAdopte = (int) $pdo->lastInsertId();

// ---------- À blanc : rien n'est écrit ----------
$r = importer(sheet(), true);
verifie('à blanc : mode annoncé', $r['mode'] === 'a_blanc');
verifie('à blanc : aucune personne créée', nb($pdo, 'utilisateurs') === 1);
verifie('à blanc : aucun établissement', nb($pdo, 'etablissements') === 0);
verifie('à blanc : aucune trace', nb($pdo, 'import_traces') === 0);
verifie('à blanc : le Drive n\'est pas appelé', $telechargements === 0);
verifie('à blanc : les créations sont comptées', ($r['entites']['article']['creees'] ?? 0) === 1 && ($r['entites']['utilisateur']['creees'] ?? 0) === 4);

// ---------- Premier import réel ----------
$r = importer(sheet());
$e = $r['entites'];
verifie('import : établissement et promo', ($e['etablissement']['creees'] ?? 0) === 1 && ($e['promo']['creees'] ?? 0) === 1);
verifie('import : 4 personnes créées (l\'adresse invalide est ignorée, le compte existant adopté)', ($e['utilisateur']['creees'] ?? 0) === 4 && nb($pdo, 'utilisateurs') === 5);
verifie('import : adresse invalide signalée sans la nommer', ($r['ignorees']['utilisateur : adresse invalide'] ?? 0) === 1);
verifie('import : compte existant conservé tel quel', valeur($pdo, 'SELECT prenom FROM utilisateurs WHERE id = ?', [$idAdopte]) === 'Neuf');
verifie('import : prénom et initiale séparés', valeur($pdo, "SELECT CONCAT(prenom, '/', nom) FROM utilisateurs WHERE email = 'etu1@ci.test'") === 'Camille/D');
verifie('import : adresse en minuscules, dates en UTC', valeur($pdo, "SELECT derniere_connexion FROM utilisateurs WHERE email = 'etu1@ci.test'") === '2024-05-01 10:00:00');
verifie('import : couleur conservée', valeur($pdo, "SELECT couleur FROM utilisateurs WHERE email = 'prof@ci.test'") === '#112233');
verifie('import : identifiants du Sheet conservés', valeur($pdo, 'SELECT nom FROM groupes WHERE id = ?', [u(20)]) === 'Groupe A');
verifie('import : membres', nb($pdo, 'membres') === 2);
verifie('import : étudiante inscrite devient étudiante de la promo', (int) valeur($pdo, "SELECT COUNT(*) FROM attributions a JOIN utilisateurs x ON x.id = a.utilisateur_id WHERE x.email = 'etu1@ci.test' AND a.role = 'etudiant' AND a.promo_id = ?", [u(2)]) === 1);
verifie('import : étudiant membre d\'un groupe devient étudiant de la promo', (int) valeur($pdo, "SELECT COUNT(*) FROM attributions a JOIN utilisateurs x ON x.id = a.utilisateur_id WHERE x.email = 'etu2@ci.test' AND a.role = 'etudiant' AND a.promo_id = ?", [u(2)]) === 1);
verifie('import : formateur rattaché à l\'établissement', (int) valeur($pdo, "SELECT COUNT(*) FROM attributions a JOIN utilisateurs x ON x.id = a.utilisateur_id WHERE x.email = 'prof@ci.test' AND a.role = 'formateur' AND a.etablissement_id = ?", [u(1)]) === 1);
verifie('import : personne en attente sans rôle', (int) valeur($pdo, "SELECT COUNT(*) FROM attributions a JOIN utilisateurs x ON x.id = a.utilisateur_id WHERE x.email = 'attente@ci.test'") === 0);
verifie('import : demande d\'accès en attente recréée', (int) valeur($pdo, "SELECT COUNT(*) FROM demandes_acces d JOIN utilisateurs x ON x.id = d.utilisateur_id WHERE x.email = 'attente@ci.test' AND d.statut = 'en_attente' AND d.promo_id = ?", [u(2)]) === 1);
verifie('import : vote et bulletin', valeur($pdo, 'SELECT statut FROM votes WHERE id = ?', [u(30)]) === 'ouvert' && nb($pdo, 'vote_reponses') === 1);
verifie('import : article', valeur($pdo, 'SELECT titre FROM articles WHERE id = ?', [u(40)]) === 'Titre A');
verifie('import : « modifié par Camille D. » relié à la personne', (int) valeur($pdo, 'SELECT modifie_par FROM articles WHERE id = ?', [u(40)]) === (int) valeur($pdo, "SELECT id FROM utilisateurs WHERE email = 'etu1@ci.test'"));
verifie('import : fiches', nb($pdo, 'analyses') === 2 && valeur($pdo, 'SELECT portee FROM analyses WHERE id = ?', [u(50)]) === 'promo' && valeur($pdo, 'SELECT portee FROM analyses WHERE id = ?', [u(51)]) === 'groupe');
verifie('import : priorité de fiche', valeur($pdo, 'SELECT priorite FROM analyses WHERE id = ?', [u(51)]) === 'haute');
verifie('import : proposition et bulletin', nb($pdo, 'propositions') === 1 && nb($pdo, 'proposition_votes') === 1);
verifie('import : commentaire et lu', nb($pdo, 'commentaires') === 1 && nb($pdo, 'commentaires_lus') === 1);
verifie('import : historique', nb($pdo, 'historique') === 1);
verifie('import : réunion, jalon, terme', nb($pdo, 'reunions') === 1 && nb($pdo, 'jalons') === 1 && nb($pdo, 'glossaire') === 1);
verifie('import : jalon, alerte et statut', (int) valeur($pdo, 'SELECT alerte_jours FROM jalons WHERE id = ?', [u(81)]) === 7 && valeur($pdo, 'SELECT statut FROM jalons WHERE id = ?', [u(81)]) === 'en_cours');
verifie('import : notes et retours', nb($pdo, 'notes') === 2 && nb($pdo, 'feedback') === 2);
verifie('import : pièce jointe téléchargée une fois', $telechargements === 1 && nb($pdo, 'fichiers') === 1);
$chemin = (string) valeur($pdo, 'SELECT chemin FROM fichiers WHERE id = ?', [u(85)]);
verifie('import : pièce jointe écrite sur le disque privé', is_file($config->dossierPrive() . '/fichiers/' . $chemin));
verifie('import : nom du fichier conservé', valeur($pdo, 'SELECT nom FROM fichiers WHERE id = ?', [u(85)]) === 'cours.pdf');
$json = (string) json_encode($r);
verifie('rapport : aucun nom ni adresse', !str_contains(strtolower($json), 'camille') && !str_contains($json, '@') && !str_contains($json, 'Titre'));

// ---------- Rejeu : rien ne change ----------
$avant = [nb($pdo, 'utilisateurs'), nb($pdo, 'analyses'), nb($pdo, 'attributions'), nb($pdo, 'commentaires_lus'), nb($pdo, 'import_traces')];
$r = importer(sheet());
$creees = 0;
$maj = 0;
$conflits = 0;
foreach ($r['entites'] as $nom => $c) {
    $creees += $c['creees'] ?? 0;
    $maj += $c['mises_a_jour'] ?? 0;
    $conflits += $c['conflits'] ?? 0;
}
verifie('rejeu : rien de créé, de modifié ni en conflit', $creees === 0 && $maj === 0 && $conflits === 0);
verifie('rejeu : les lignes inchangées sont comptées', ($r['entites']['article']['inchangees'] ?? 0) === 1);
verifie('rejeu : les comptes de la base sont identiques', $avant === [nb($pdo, 'utilisateurs'), nb($pdo, 'analyses'), nb($pdo, 'attributions'), nb($pdo, 'commentaires_lus'), nb($pdo, 'import_traces')]);
verifie('rejeu : la pièce jointe n\'est pas retéléchargée', $telechargements === 1);

// ---------- Modification dans le Sheet : mise à jour ----------
$s = sheet();
$s['Articles'][0] = ligne('Articles', ['id' => u(40), 'cree_par' => 'etu1@ci.test', 'groupe_id' => u(20), 'ajoute' => T0, 'modifie_par' => 'Camille D.',
    'titre' => 'Titre A corrigé', 'parution' => '2020', 'auteur' => 'Dupont', 'type' => 'Article scientifique', 'doi' => '10.1/abc']);
$s['Lectures'][0] = ligne('Lectures', ['id' => u(50), 'owner' => 'etu1@ci.test', 'statut' => 'Terminée', 'article_id' => u(40), 'groupe_id' => u(20), 'ajoute' => T0, 'libre' => 'Lecture revue']);
$r = importer($s);
verifie('modification du Sheet : une mise à jour par ligne modifiée', ($r['entites']['article']['mises_a_jour'] ?? 0) === 1 && ($r['entites']['analyse']['mises_a_jour'] ?? 0) === 1);
verifie('modification du Sheet : appliquée', valeur($pdo, 'SELECT titre FROM articles WHERE id = ?', [u(40)]) === 'Titre A corrigé' && valeur($pdo, 'SELECT libre FROM analyses WHERE id = ?', [u(50)]) === 'Lecture revue');
verifie('modification du Sheet : le reste est inchangé', ($r['entites']['groupe']['inchangees'] ?? 0) === 1 && ($r['entites']['analyse']['inchangees'] ?? 0) === 1);

// ---------- Conflit : la base a été retouchée depuis l'import ----------
$pdo->prepare('UPDATE articles SET titre = ? WHERE id = ?')->execute(['Corrigé dans le nouvel outil', u(40)]);
$s['Articles'][0][array_search('titre', Importation::COLONNES['Articles'], true)] = 'Titre encore changé dans le Sheet';
$r = importer($s);
verifie('conflit : signalé', ($r['entites']['article']['conflits'] ?? 0) === 1);
verifie('conflit : la base n\'est pas écrasée', valeur($pdo, 'SELECT titre FROM articles WHERE id = ?', [u(40)]) === 'Corrigé dans le nouvel outil');
$r = importer($s);
verifie('conflit : toujours signalé aux passages suivants', ($r['entites']['article']['conflits'] ?? 0) === 1);

// ---------- Ligne disparue du Sheet ----------
$s2 = $s;
array_shift($s2['Notes']);       // la note u(83) disparaît, la note u(87) reste
array_shift($s2['Feedback']);    // le retour u(84) disparaît, u(86) reste
$pdo->prepare('UPDATE feedback SET texte = ? WHERE id = ?')->execute(['Retouché ici', u(84)]);
$r = importer($s2);
verifie('disparue : signalée seulement', ($r['absentes_de_la_source']['note'] ?? 0) === 1 && nb($pdo, 'notes') === 2 && $r['supprimees'] === []);
$r = importer($s2, false, true);
verifie('disparue + option supprimer : supprimée', ($r['supprimees']['note'] ?? 0) === 1 && nb($pdo, 'notes') === 1);
verifie('disparue + base retouchée : conservée', nb($pdo, 'feedback') === 2 && ($r['entites']['feedback']['conflits'] ?? 0) === 1);
verifie('personnes jamais supprimées', nb($pdo, 'utilisateurs') === 5);

// ---------- Onglet entièrement vide : jamais de suppression (lecture ratée ?) ----------
$s3 = $s2;
$s3['Fichiers'] = [];
$r = importer($s3, false, true);
verifie('onglet vide : la disparition est signalée', ($r['absentes_de_la_source']['fichier'] ?? 0) === 1);
verifie('onglet vide : rien n\'est supprimé', nb($pdo, 'fichiers') === 1 && is_file($config->dossierPrive() . '/fichiers/' . $chemin));
$r = importer([], false, true);
verifie('Sheet entièrement vide : rien n\'est supprimé', nb($pdo, 'articles') === 1 && nb($pdo, 'groupes') === 1 && nb($pdo, 'fichiers') === 1);

// ---------- À blanc avec suppression : rien ne bouge ----------
$s4 = $s2;
array_pop($s4['Notes']);
$s4['Notes'][] = ligne('Notes', ['id' => u(88), 'owner' => 'etu1@ci.test', 'titre' => 'Nouvelle', 'cree_le' => T0]);
$r = importer($s4, true, true);
verifie('à blanc + supprimer : annoncé mais rien d\'écrit', ($r['supprimees']['note'] ?? 0) === 1 && nb($pdo, 'notes') === 1
    && valeur($pdo, 'SELECT titre FROM notes WHERE id = ?', [u(87)]) === 'Autre note');

// ---------- Compte de service : assertion JWT signée ----------
$cle = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
openssl_pkey_export($cle, $pem);
$detail = openssl_pkey_get_details($cle);
$jwt = GoogleApi::assertion(['client_email' => 'robot@projet.iam.gserviceaccount.com', 'private_key' => $pem], 1_800_000_000);
[$h, $p, $sig] = explode('.', $jwt);
$charge = json_decode(base64_decode(strtr($p, '-_', '+/')), true);
verifie('assertion : émetteur, portées et durée', $charge['iss'] === 'robot@projet.iam.gserviceaccount.com' && str_contains($charge['scope'], 'spreadsheets.readonly')
    && str_contains($charge['scope'], 'drive.readonly') && $charge['exp'] - $charge['iat'] === 3600);
verifie('assertion : signature RS256 valide', openssl_verify($h . '.' . $p, base64_decode(strtr($sig, '-_', '+/')), $detail['key'], OPENSSL_ALGO_SHA256) === 1);

// Lecture du Sheet par une fausse API : en-tête retiré, valeurs en texte, pièce jointe téléchargée avec le jeton
$appels = [];
$http = static function (string $m, string $url, array $entetes, ?string $corps) use (&$appels): array {
    $appels[] = $m . ' ' . $url;
    if ($m === 'POST') {
        return ['code' => 200, 'corps' => json_encode(['access_token' => 'jeton-test', 'expires_in' => 3600])];
    }
    if (str_contains($url, 'values:batchGet')) {
        return ['code' => 200, 'corps' => json_encode(['valueRanges' => [
            ['values' => [['id', 'nom'], ['1', 'IFSI']]], ['values' => [['id']]], ['range' => 'vide'],
        ]])];
    }
    return ['code' => 200, 'corps' => 'contenu'];
};
$api = new GoogleApi(['client_email' => 'robot@projet.iam.gserviceaccount.com', 'private_key' => $pem], $http);
$o = $api->onglets('SHEETID', ['A', 'B', 'C']);
verifie('lecture Sheet : en-tête retiré', $o['A'] === [['1', 'IFSI']] && $o['B'] === [] && $o['C'] === []);
verifie('lecture Drive : contenu renvoyé', $api->fichier('F1') === 'contenu');
verifie('lecture : un seul échange de jeton', count(array_filter($appels, static fn (string $a): bool => str_starts_with($a, 'POST'))) === 1);
verifie('clé incomplète refusée', (function (): bool {
    try {
        new GoogleApi(['client_email' => 'x']);
    } catch (RuntimeException) {
        return true;
    }
    return false;
})());

bilan();
