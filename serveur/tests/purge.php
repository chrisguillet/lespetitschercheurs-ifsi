<?php
// Tests de la purge des comptes inactifs, données fictives : LPC_CONFIG=/chemin/config.php php tests/purge.php
// ATTENTION : écrit dans les bases de la configuration. À n'utiliser que sur des bases de test vides.
declare(strict_types=1);

require dirname(__DIR__) . '/api/src/autoload.php';
require __DIR__ . '/outils.php';

use Lpc\Config;
use Lpc\Db;
use Lpc\Ids;
use Lpc\Purge;

$config = Config::charger(getenv('LPC_CONFIG') ?: null);
$db = new Db($config);
$pdo = $db->principale();
$chat = $db->chat();
if ((int) $pdo->query('SELECT COUNT(*) FROM utilisateurs')->fetchColumn() !== 0) {
    fwrite(STDERR, "Refus : la base principale n'est pas vide.\n");
    exit(2);
}

function val(PDO $pdo, string $sql, array $p = []): mixed
{
    $st = $pdo->prepare($sql);
    $st->execute($p);
    $v = $st->fetchColumn();
    return $v === false ? null : $v;
}

$maintenant = time();
$il_y_a = static fn (int $mois, int $jours = 0): string => gmdate('Y-m-d H:i:s', strtotime("-$mois months -$jours days", $maintenant));

function personne(PDO $pdo, string $email, string $statut, ?string $connexion, ?string $demande, string $cree): int
{
    $pdo->prepare('INSERT INTO utilisateurs (pid, email, prenom, nom, statut, demande_le, derniere_connexion, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        ->execute([Ids::pid($email), $email, 'Test', 'Fictif', $statut, $demande, $connexion, $cree]);
    return (int) $pdo->lastInsertId();
}

$now = gmdate('Y-m-d H:i:s');
$etab = Ids::uuid();
$promo = Ids::uuid();
$groupe = Ids::uuid();
$pdo->prepare('INSERT INTO etablissements (id, nom, cree_le) VALUES (?, ?, ?)')->execute([$etab, 'IFSI', $now]);
$pdo->prepare('INSERT INTO promos (id, etablissement_id, nom, cree_le) VALUES (?, ?, ?, ?)')->execute([$promo, $etab, 'P1', $now]);
$pdo->prepare('INSERT INTO groupes (id, promo_id, nom, cree_le) VALUES (?, ?, ?, ?)')->execute([$groupe, $promo, 'G1', $now]);

$ancien = personne($pdo, 'ancien@ci.test', 'actif', $il_y_a(13), null, $il_y_a(20));
$recent = personne($pdo, 'recent@ci.test', 'actif', $il_y_a(0, 2), null, $il_y_a(20));
$presque = personne($pdo, 'presque@ci.test', 'actif', $il_y_a(11), null, $il_y_a(20));
$admin = personne($pdo, 'admin@ci.test', 'actif', $il_y_a(30), null, $il_y_a(30));
$respPromo = personne($pdo, 'resp@ci.test', 'actif', $il_y_a(30), null, $il_y_a(30));
$attente = personne($pdo, 'attente@ci.test', 'en_attente', null, $il_y_a(14), $il_y_a(14));
$neuf = personne($pdo, 'neuf@ci.test', 'actif', null, null, $il_y_a(0, 3));   // jamais connecté, créé récemment (import)
$pdo->prepare("INSERT INTO attributions (utilisateur_id, role, promo_id, origine, cree_le) VALUES (?, 'admin_promo', ?, 'admin', ?)")->execute([$respPromo, $promo, $now]);
$pdo->prepare("INSERT INTO attributions (utilisateur_id, role, promo_id, origine, cree_le) VALUES (?, 'etudiant', ?, 'admin', ?)")->execute([$ancien, $promo, $now]);
$pdo->prepare('INSERT INTO membres (groupe_id, utilisateur_id, ajoute_le) VALUES (?, ?, ?)')->execute([$groupe, $ancien, $now]);

// Contenu de la personne « ancien »
$art = Ids::uuid();
$pdo->prepare('INSERT INTO articles (id, cree_par, groupe_id, ajoute, titre) VALUES (?, ?, ?, ?, ?)')->execute([$art, $ancien, $groupe, $now, 'Titre commun']);
$fin = Ids::uuid();
$brouillon = Ids::uuid();
$autre = Ids::uuid();
$ins = $pdo->prepare('INSERT INTO analyses (id, article_id, utilisateur_id, groupe_id, statut, portee, libre, ajoute, modifie_par) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
$ins->execute([$fin, $art, $ancien, $groupe, 'Terminée', 'promo', 'Analyse terminée', $now, $ancien]);
$ins->execute([$brouillon, $art, $ancien, $groupe, 'En cours', 'groupe', 'Brouillon', $now, null]);
$ins->execute([$autre, $art, $recent, $groupe, 'Terminée', 'promo', 'Analyse de la personne récente', $now, null]);
$com = Ids::uuid();
$comAutre = Ids::uuid();
$pdo->prepare('INSERT INTO commentaires (id, analyse_id, auteur_id, texte, cree_le) VALUES (?, ?, ?, ?, ?)')->execute([$com, $autre, $ancien, 'Commentaire de l\'ancien', $now]);
$pdo->prepare('INSERT INTO commentaires (id, analyse_id, auteur_id, texte, cree_le) VALUES (?, ?, ?, ?, ?)')->execute([$comAutre, $brouillon, $recent, 'Sur le brouillon', $now]);
$pdo->prepare("INSERT INTO historique (cible, cible_id, modifie_par, proprietaire, avant, modifie_le) VALUES ('analyse', ?, ?, ?, '{}', ?)")->execute([$fin, $ancien, $ancien, $now]);
$pdo->prepare("INSERT INTO historique (cible, cible_id, modifie_par, proprietaire, avant, modifie_le) VALUES ('analyse', ?, ?, ?, '{}', ?)")->execute([$brouillon, $ancien, $ancien, $now]);
$pdo->prepare('INSERT INTO glossaire (id, groupe_id, mot, cree_par, cree_le) VALUES (?, ?, ?, ?, ?)')->execute([Ids::uuid(), $groupe, 'Soin', $ancien, $now]);
$pdo->prepare('INSERT INTO notes (id, utilisateur_id, titre, cree_le) VALUES (?, ?, ?, ?)')->execute([Ids::uuid(), $ancien, 'Ma note', $now]);
$pdo->prepare('INSERT INTO feedback (id, auteur_id, type, texte, jour, cree_le) VALUES (?, ?, ?, ?, ?, ?)')->execute([Ids::uuid(), $ancien, 'idee', 'Une idée', gmdate('Y-m-d'), $now]);
$pdo->prepare("INSERT INTO invitations (jeton_hash, type, role, promo_id, email, cree_par, cree_le, expire_le) VALUES (?, 'personnel', 'etudiant', ?, ?, ?, ?, ?)")
    ->execute([hash('sha256', 'x'), $promo, 'ancien@ci.test', $respPromo, $now, $now]);
$pdo->prepare("INSERT INTO import_traces (entite, source_id, cible_id, empreinte_source, empreinte_cible, importe_le) VALUES ('utilisateur', ?, ?, 'a', 'b', ?)")->execute(['ancien@ci.test', (string) $ancien, $now]);
$pdo->prepare("INSERT INTO import_traces (entite, source_id, cible_id, empreinte_source, empreinte_cible, importe_le) VALUES ('utilisateur', ?, ?, 'a', 'b', ?)")->execute(['recent@ci.test', (string) $recent, $now]);
$vote = Ids::uuid();
$pdo->prepare("INSERT INTO votes (id, groupe_id, type, cible_id, propose_par, cree_le, statut) VALUES (?, ?, 'retrait', ?, ?, ?, 'ouvert')")->execute([$vote, $groupe, $ancien, $recent, $now]);
$pdo->prepare('INSERT INTO vote_reponses (vote_id, utilisateur_id, oui, repondu_le) VALUES (?, ?, 1, ?)')->execute([$vote, $ancien, $now]);

$dossier = $config->dossierPrive() . '/fichiers';
@mkdir($dossier, 0700, true);
file_put_contents($dossier . '/purge-test.pdf', '%PDF-test');
$pdo->prepare('INSERT INTO fichiers (id, article_id, nom, type, taille, chemin, cree_par, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    ->execute([Ids::uuid(), $art, 'cours.pdf', 'application/pdf', 9, 'purge-test.pdf', $ancien, $now]);
$chat->prepare('INSERT INTO chat_messages (canal, auteur_id, auteur_nom, cree_le, texte) VALUES (?, ?, ?, ?, ?)')->execute(['g:x', $ancien, 'Test F.', $now, 'bonjour']);
$chat->prepare('INSERT INTO presence (utilisateur_id, vu_le) VALUES (?, ?)')->execute([$ancien, $now]);

// ---------- Candidats ----------
$c = Purge::candidats($pdo, 'admin@ci.test', $maintenant);
$emails = array_column($c, 'email');
sort($emails);
verifie('candidats : inactif depuis 13 mois et demande en attente vieille de 14 mois', $emails === ['ancien@ci.test', 'attente@ci.test']);
verifie('candidats : ni la connexion récente, ni les 11 mois, ni le jamais-connecté récent', !in_array('recent@ci.test', $emails, true) && !in_array('presque@ci.test', $emails, true) && !in_array('neuf@ci.test', $emails, true));
verifie('candidats : jamais l\'administrateur ni un administrateur de promo', !in_array('admin@ci.test', $emails, true) && !in_array('resp@ci.test', $emails, true));

// ---------- À blanc ----------
$avant = (int) $pdo->query('SELECT COUNT(*) FROM utilisateurs')->fetchColumn();
$r = Purge::executer($config, $db, $maintenant, false);
verifie('à blanc : compte sans rien retirer', $r['mode'] === 'a_blanc' && $r['candidats'] === 2 && $r['retires'] === 0 && (int) $pdo->query('SELECT COUNT(*) FROM utilisateurs')->fetchColumn() === $avant);
verifie('à blanc : annonce les fiches conservées et les brouillons', $r['fiches_conservees'] === 1 && $r['brouillons_supprimes'] === 1);
verifie('à blanc : le fichier est toujours là', is_file($dossier . '/purge-test.pdf'));

// ---------- Réel ----------
$r = Purge::executer($config, $db, $maintenant, true);
verifie('réel : deux comptes retirés', $r['mode'] === 'reel' && $r['retires'] === 2);
verifie('réel : le compte et l\'adresse ont disparu', val($pdo, 'SELECT COUNT(*) FROM utilisateurs WHERE id IN (?, ?)', [$ancien, $attente]) == 0);
verifie('réel : les autres comptes sont intacts', (int) val($pdo, 'SELECT COUNT(*) FROM utilisateurs') === 5);
verifie('tronc commun : l\'article reste, sans auteur', val($pdo, 'SELECT titre FROM articles WHERE id = ?', [$art]) === 'Titre commun' && val($pdo, 'SELECT cree_par FROM articles WHERE id = ?', [$art]) === null);
verifie('tronc commun : la fiche terminée reste, anonyme', val($pdo, 'SELECT libre FROM analyses WHERE id = ?', [$fin]) === 'Analyse terminée' && val($pdo, 'SELECT utilisateur_id FROM analyses WHERE id = ?', [$fin]) === null);
verifie('tronc commun : « modifié par » est anonymisé', val($pdo, 'SELECT modifie_par FROM analyses WHERE id = ?', [$fin]) === null);
verifie('tronc commun : le commentaire reste, sans auteur', val($pdo, 'SELECT texte FROM commentaires WHERE id = ?', [$com]) === 'Commentaire de l\'ancien' && val($pdo, 'SELECT auteur_id FROM commentaires WHERE id = ?', [$com]) === null);
verifie('tronc commun : l\'historique de la fiche reste, sans personne', (int) val($pdo, "SELECT COUNT(*) FROM historique WHERE cible_id = ? AND proprietaire IS NULL AND modifie_par IS NULL", [$fin]) === 1);
verifie('tronc commun : le terme du glossaire reste, sans auteur', val($pdo, "SELECT cree_par FROM glossaire WHERE mot = 'Soin'") === null && (int) val($pdo, "SELECT COUNT(*) FROM glossaire WHERE mot = 'Soin'") === 1);
verifie('tronc commun : la fiche d\'une autre personne est intacte', val($pdo, 'SELECT utilisateur_id FROM analyses WHERE id = ?', [$autre]) == $recent);
verifie('brouillon supprimé avec son historique et ses commentaires', val($pdo, 'SELECT COUNT(*) FROM analyses WHERE id = ?', [$brouillon]) == 0
    && val($pdo, "SELECT COUNT(*) FROM historique WHERE cible_id = ?", [$brouillon]) == 0 && val($pdo, 'SELECT COUNT(*) FROM commentaires WHERE id = ?', [$comAutre]) == 0);
verifie('données personnelles supprimées : notes, retours, rôles, appartenances, bulletins', val($pdo, 'SELECT COUNT(*) FROM notes') == 0 && val($pdo, 'SELECT COUNT(*) FROM feedback') == 0
    && val($pdo, 'SELECT COUNT(*) FROM attributions WHERE utilisateur_id = ?', [$ancien]) == 0 && val($pdo, 'SELECT COUNT(*) FROM membres') == 0 && val($pdo, 'SELECT COUNT(*) FROM vote_reponses') == 0);
verifie('invitation à son adresse supprimée', val($pdo, 'SELECT COUNT(*) FROM invitations') == 0);
verifie('trace d\'import de son adresse supprimée, celle des autres conservée', val($pdo, "SELECT COUNT(*) FROM import_traces WHERE source_id = 'ancien@ci.test'") == 0 && val($pdo, "SELECT COUNT(*) FROM import_traces WHERE source_id = 'recent@ci.test'") == 1);
verifie('vote ouvert la concernant supprimé', val($pdo, 'SELECT COUNT(*) FROM votes WHERE id = ?', [$vote]) == 0);
verifie('pièce jointe supprimée (ligne et fichier)', val($pdo, 'SELECT COUNT(*) FROM fichiers') == 0 && !is_file($dossier . '/purge-test.pdf'));
verifie('chat : messages et présence supprimés', (int) $chat->query('SELECT COUNT(*) FROM chat_messages')->fetchColumn() === 0 && (int) $chat->query('SELECT COUNT(*) FROM presence')->fetchColumn() === 0);
verifie('journal : une ligne par compte retiré, sans adresse', (int) val($pdo, "SELECT COUNT(*) FROM journal_admin WHERE action = 'purge_inactif'") === 2 && val($pdo, "SELECT COUNT(*) FROM journal_admin WHERE detail LIKE '%@%' OR cible LIKE '%@%'") == 0);

// ---------- Rejeu ----------
$r = Purge::executer($config, $db, $maintenant, true);
verifie('rejeu : plus rien à retirer', $r['candidats'] === 0 && $r['retires'] === 0);

bilan();
