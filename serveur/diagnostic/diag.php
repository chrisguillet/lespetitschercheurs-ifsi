<?php
// Diagnostic ponctuel de l'hébergement : versions, extensions, limites PHP, droits d'écriture, connexions aux deux bases,
// accès sortant vers Google. À déposer sous  api/diag.php  le temps du test, puis À SUPPRIMER.
// Appel : https://lespetitschercheurs.qocot.eu/api/diag.php?cle=<diagnostic_cle de config.php>
// Aucun mot de passe n'est affiché.
declare(strict_types=1);

ini_set('display_errors', '0');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

require __DIR__ . '/src/autoload.php';

use Lpc\Config;
use Lpc\Db;
use Lpc\GoogleJeton;

function sortie(array $d, int $code = 200): never
{
    http_response_code($code);
    echo json_encode($d, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

try {
    $config = Config::charger();
} catch (Throwable $e) {
    sortie(['erreur' => 'configuration', 'detail' => $e->getMessage()], 500);
}

$attendue = (string) $config->get('diagnostic_cle', '');
$fournie = (string) ($_GET['cle'] ?? '');
if ($attendue === '' || str_starts_with($attendue, 'À REMPLIR') || !hash_equals($attendue, $fournie)) {
    sortie(['erreur' => 'clé invalide'], 403);
}

$ini = static fn (string $k): string => (string) ini_get($k);
$rapport = [
    'php' => ['version' => PHP_VERSION, 'sapi' => PHP_SAPI, 'os' => PHP_OS_FAMILY],
    'limites' => [
        'max_execution_time_s' => $ini('max_execution_time'),
        'memory_limit' => $ini('memory_limit'),
        'post_max_size' => $ini('post_max_size'),
        'upload_max_filesize' => $ini('upload_max_filesize'),
        'max_input_time_s' => $ini('max_input_time'),
        'allow_url_fopen' => $ini('allow_url_fopen'),
        'open_basedir' => $ini('open_basedir'),
    ],
    'extensions' => array_combine(
        ['pdo_mysql', 'openssl', 'curl', 'mbstring', 'json', 'gd', 'imagick', 'intl', 'fileinfo', 'zip'],
        array_map('extension_loaded', ['pdo_mysql', 'openssl', 'curl', 'mbstring', 'json', 'gd', 'imagick', 'intl', 'fileinfo', 'zip'])
    ),
    'horloge_serveur_utc' => gmdate('c'),
];

$prive = $config->dossierPrive();
$essai = $prive . '/.ecriture-' . bin2hex(random_bytes(3));
$ecrit = @file_put_contents($essai, 'ok') !== false;
if ($ecrit) {
    @unlink($essai);
}
$rapport['dossier_prive'] = ['existe' => is_dir($prive), 'ecriture' => $ecrit];

$db = new Db($config);
foreach (['principale' => 'principale', 'chat' => 'chat'] as $nom => $methode) {
    try {
        $pdo = $db->$methode();
        $v = $pdo->query('SELECT VERSION() AS v, @@time_zone AS tz, @@character_set_database AS cs')->fetch();
        $tables = (int) $pdo->query('SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE()')->fetchColumn();
        $rapport['base_' . $nom] = ['ok' => true, 'version' => $v['v'], 'time_zone_session' => $v['tz'], 'jeu_de_caracteres' => $v['cs'], 'tables' => $tables];
    } catch (Throwable $e) {
        $rapport['base_' . $nom] = ['ok' => false, 'erreur' => $e->getMessage()];
    }
}

$t0 = microtime(true);
try {
    $r = GoogleJeton::telecharger('https://www.googleapis.com/oauth2/v3/certs');
    $cles = json_decode($r['corps'], true);
    $rapport['google_cles'] = ['ok' => true, 'nb_cles' => is_array($cles['keys'] ?? null) ? count($cles['keys']) : 0,
        'max_age_s' => $r['max_age'], 'duree_ms' => (int) round((microtime(true) - $t0) * 1000)];
} catch (Throwable $e) {
    $rapport['google_cles'] = ['ok' => false, 'erreur' => $e->getMessage()];
}

sortie($rapport);
