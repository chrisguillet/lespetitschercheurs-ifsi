<?php
declare(strict_types=1);

namespace Lpc;

/** Deux connexions paresseuses : la base principale (tronc commun) et la base du chat. */
final class Db
{
    /** @var array<string,\PDO> */
    private array $connexions = [];

    public function __construct(private Config $config)
    {
    }

    public function principale(): \PDO
    {
        return $this->connexions['db_principale'] ??= $this->ouvrir('db_principale');
    }

    public function chat(): \PDO
    {
        return $this->connexions['db_chat'] ??= $this->ouvrir('db_chat');
    }

    private function ouvrir(string $cle): \PDO
    {
        $b = $this->config->base($cle);
        $dsn = sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', $b['hote'], $b['port'], $b['nom']);
        $pdo = new \PDO($dsn, $b['utilisateur'], $b['mot_de_passe'], [
            \PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION,
            \PDO::ATTR_DEFAULT_FETCH_MODE => \PDO::FETCH_ASSOC,
            \PDO::ATTR_EMULATE_PREPARES => false,
            \PDO::ATTR_TIMEOUT => 5,
        ]);
        // Dates en UTC et mode strict : une valeur trop longue est refusée, pas tronquée en silence.
        $pdo->exec("SET time_zone = '+00:00', sql_mode = 'STRICT_ALL_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO'");
        return $pdo;
    }
}
