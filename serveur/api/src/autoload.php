<?php
// Chargement automatique minimal : Lpc\Actions\Session -> src/Actions/Session.php
declare(strict_types=1);

spl_autoload_register(static function (string $classe): void {
    $prefixe = 'Lpc\\';
    if (strncmp($classe, $prefixe, strlen($prefixe)) !== 0) {
        return;
    }
    $chemin = __DIR__ . '/' . str_replace('\\', '/', substr($classe, strlen($prefixe))) . '.php';
    if (is_file($chemin)) {
        require $chemin;
    }
});
