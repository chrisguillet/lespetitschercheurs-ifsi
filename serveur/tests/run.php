<?php
// Tests sans dépendance : php tests/run.php  (PHP 8.2+ avec l'extension openssl ; aucune base de données requise).
declare(strict_types=1);

require dirname(__DIR__) . '/api/src/autoload.php';
require __DIR__ . '/outils.php';

use Lpc\GoogleJeton;
use Lpc\Ids;
use Lpc\Temps;

// ---- Jeton Google : paire de clés RSA de test, JWT signé, clés « Google » servies par une fonction de remplacement ----
[$cle, $jwk, $pemOpenssl] = pairedeCles();

verifie('pem() reconstruit exactement la clé publique d\'OpenSSL', GoogleJeton::pem($jwk['n'], $jwk['e']) === $pemOpenssl);

$dossier = sys_get_temp_dir() . '/lpc-tests-' . bin2hex(random_bytes(4));
$appels = 0;
$recuperer = function (string $url) use ($jwk, &$appels): array {
    $appels++;
    return ['corps' => json_encode(['keys' => [$jwk]]), 'max_age' => 3600];
};
$client = 'client-de-test.apps.googleusercontent.com';
$google = new GoogleJeton($client, $dossier, $recuperer);

$maintenant = 1_800_000_000;
$base = [
    'iss' => 'https://accounts.google.com', 'aud' => $client, 'email' => 'Etudiante@Exemple.fr',
    'email_verified' => true, 'iat' => $maintenant - 10, 'exp' => $maintenant + 3000,
];

$r = $google->verifier(fabrique($cle, $base), $maintenant);
verifie('jeton valide : adresse en minuscules', $r['email'] === 'etudiante@exemple.fr');
verifie('jeton valide : exp renvoyé', $r['exp'] === $maintenant + 3000);
verifie('clés téléchargées une seule fois', $appels === 1);
$google->verifier(fabrique($cle, $base), $maintenant);
verifie('deuxième jeton : clés relues depuis le cache disque', $appels === 1);

verifie('email_verified = "true" (texte) accepté', $google->verifier(fabrique($cle, array_merge($base, ['email_verified' => 'true'])), $maintenant)['email'] !== '');
verifie('émetteur sans https accepté', $google->verifier(fabrique($cle, array_merge($base, ['iss' => 'accounts.google.com'])), $maintenant)['email'] !== '');

verifie('jeton expiré refusé', leve(fn () => $google->verifier(fabrique($cle, array_merge($base, ['exp' => $maintenant - 1])), $maintenant), 'unauthorized', 'expirée'));
verifie('mauvaise audience refusée', leve(fn () => $google->verifier(fabrique($cle, array_merge($base, ['aud' => 'autre'])), $maintenant), 'unauthorized', 'invalide'));
verifie('mauvais émetteur refusé', leve(fn () => $google->verifier(fabrique($cle, array_merge($base, ['iss' => 'https://pirate.example'])), $maintenant), 'unauthorized'));
verifie('adresse non vérifiée refusée', leve(fn () => $google->verifier(fabrique($cle, array_merge($base, ['email_verified' => false])), $maintenant), 'unauthorized', 'vérifiée'));
verifie('émission dans le futur refusée', leve(fn () => $google->verifier(fabrique($cle, array_merge($base, ['iat' => $maintenant + 3600])), $maintenant), 'unauthorized'));
verifie('algorithme « none » refusé', leve(fn () => $google->verifier(b64u('{"alg":"none","kid":"cle-de-test"}') . '.' . b64u(json_encode($base)) . '.', $maintenant), 'unauthorized'));
verifie('algorithme HS256 refusé', leve(fn () => $google->verifier(fabrique($cle, $base, ['alg' => 'HS256']), $maintenant), 'unauthorized'));

$jeton = fabrique($cle, $base);
[$h, $p, $s] = explode('.', $jeton);
$autre = fabrique($cle, array_merge($base, ['email' => 'pirate@exemple.fr']));
verifie('charge modifiée (signature d\'origine) refusée', leve(fn () => $google->verifier($h . '.' . explode('.', $autre)[1] . '.' . $s, $maintenant), 'unauthorized'));
verifie('signature tronquée refusée', leve(fn () => $google->verifier($h . '.' . $p . '.' . substr($s, 0, 20), $maintenant), 'unauthorized'));
verifie('jeton mal formé refusé', leve(fn () => $google->verifier('pas.un.jwt', $maintenant), 'unauthorized'));
verifie('jeton vide refusé', leve(fn () => $google->verifier('', $maintenant), 'unauthorized'));

$avant = $appels;
verifie('kid inconnu refusé', leve(fn () => $google->verifier(fabrique($cle, $base, ['kid' => 'inconnue']), $maintenant), 'unauthorized'));
verifie('kid inconnu : pas de nouveau téléchargement avant 5 minutes', $appels === $avant);

$cassee = new GoogleJeton($client, sys_get_temp_dir() . '/lpc-tests-vide-' . bin2hex(random_bytes(4)), function (): array {
    throw new RuntimeException('réseau coupé');
});
verifie('clés injoignables et sans cache : erreur serveur', leve(fn () => $cassee->verifier(fabrique($cle, $base), $maintenant), 'server'));

// ---- Identifiants ----
verifie('uuid v4 : format', preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/', Ids::uuid()) === 1);
verifie('uuid : deux appels différents', Ids::uuid() !== Ids::uuid());
verifie('pid : 12 caractères web-safe', preg_match('/^[A-Za-z0-9_-]{12}$/', Ids::pid('a@b.fr')) === 1);
verifie('pid : stable et distinct selon l\'adresse', Ids::pid('a@b.fr') === Ids::pid('a@b.fr') && Ids::pid('a@b.fr') !== Ids::pid('c@d.fr'));
verifie('jeton d\'invitation : 43 caractères, haché en 64', strlen(Ids::jeton()) === 43 && strlen(Ids::hacher(Ids::jeton())) === 64);

// ---- Dates ----
verifie('Temps::iso', Temps::iso('2026-11-21 08:30:00') === '2026-11-21T08:30:00.000Z');
verifie('Temps::iso : vide', Temps::iso(null) === '' && Temps::iso('') === '');

// ---- Sauvegarde des pièces jointes ----
$prive = sys_get_temp_dir() . '/lpc-sauv-' . bin2hex(random_bytes(4));
mkdir($prive . '/fichiers', 0700, true);
file_put_contents($prive . '/fichiers/a.pdf', '%PDF-a');
file_put_contents($prive . '/fichiers/b.pdf', '%PDF-b');
$jour = static fn (int $n): int => 1_800_000_000 + $n * 86400;   // jour 0, 1, 2…
$r = \Lpc\Sauvegarde::fichiers($prive, $jour(0));
$snap0 = $prive . '/sauvegardes/' . $r['instantane'];
verifie('sauvegarde : 2 fichiers dans l\'instantané du jour', $r['ajoutes'] === 2 && is_file($snap0 . '/a.pdf') && file_get_contents($snap0 . '/b.pdf') === '%PDF-b');
$r = \Lpc\Sauvegarde::fichiers($prive, $jour(0));
verifie('sauvegarde : rejouée le même jour, rien à ajouter', $r['ajoutes'] === 0 && $r['supprimes'] === []);
unlink($prive . '/fichiers/a.pdf');                       // effacé de l'application
file_put_contents($prive . '/fichiers/c.pdf', '%PDF-c');
$r = \Lpc\Sauvegarde::fichiers($prive, $jour(1));
$snap1 = $prive . '/sauvegardes/' . $r['instantane'];
verifie('sauvegarde : le fichier effacé n\'entre pas dans l\'instantané suivant', !is_file($snap1 . '/a.pdf') && is_file($snap1 . '/c.pdf') && $r['ajoutes'] === 2);
verifie('sauvegarde : le fichier effacé reste dans l\'ancien instantané', is_file($snap0 . '/a.pdf'));
$r = \Lpc\Sauvegarde::fichiers($prive, $jour(6));
verifie('sauvegarde : instantané de 6 jours conservé', is_dir($snap0) && $r['supprimes'] === []);
$r = \Lpc\Sauvegarde::fichiers($prive, $jour(7));
verifie('sauvegarde : instantané de 7 jours supprimé, avec le fichier effacé', $r['supprimes'] === [basename($snap0)] && !is_dir($snap0) && is_dir($snap1));
file_put_contents($prive . '/sauvegardes/autre-dossier', 'ne pas toucher');
mkdir($prive . '/sauvegardes/important');
\Lpc\Sauvegarde::fichiers($prive, $jour(30));
verifie('sauvegarde : ne touche que ses propres dossiers datés', is_file($prive . '/sauvegardes/autre-dossier') && is_dir($prive . '/sauvegardes/important') && !is_dir($snap1));
$vide = sys_get_temp_dir() . '/lpc-sauv-' . bin2hex(random_bytes(4));
mkdir($vide);
verifie('sauvegarde : aucun dossier de pièces jointes, aucun échec', \Lpc\Sauvegarde::fichiers($vide, $jour(0))['ajoutes'] === 0);

bilan();
