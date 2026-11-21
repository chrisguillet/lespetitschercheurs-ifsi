<?php
// Crée les deux bases vides de l'intégration continue : php tests/preparer-ci.php /chemin/config.php
// Se connecte avec les identifiants de la configuration (compte root du conteneur de test), sans choisir de base.
declare(strict_types=1);

require dirname(__DIR__) . '/api/src/autoload.php';

use Lpc\Config;

$config = Config::charger($argv[1] ?? null);
$b = $config->base('db_principale');
$pdo = new PDO(sprintf('mysql:host=%s;port=%d;charset=utf8mb4', $b['hote'], $b['port']), $b['utilisateur'], $b['mot_de_passe'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
// Le schéma lui-même est appliqué ensuite par bin/migrer.php (principale puis chat), comme sur le serveur.
foreach (['db_principale', 'db_chat'] as $cle) {
    $nom = $config->base($cle)['nom'];
    $pdo->exec('DROP DATABASE IF EXISTS `' . $nom . '`');
    $pdo->exec('CREATE DATABASE `' . $nom . '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
    echo "Base $nom créée\n";
}
