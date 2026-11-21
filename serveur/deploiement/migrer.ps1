# Cree les tables sur IONOS et supprime le script de diagnostic. A lancer depuis la racine du depot :
#   .\serveur\deploiement\migrer.ps1
# Une seule connexion SSH : le mot de passe de l'acces SFTP + SSH (su953491) est tape a la main.
# Peut etre relance sans risque : un fichier SQL deja applique est simplement signale.
#
# Sur le serveur, le script choisit lui-meme un PHP en ligne de commande >= 8.2 (php8.4-cli, php8.4, php8.3-cli...).

$ErrorActionPreference = 'Stop'
$hote = 'su953491@access-5021963953.webspace-host.com'

# Une seule ligne, sans guillemets doubles (Windows les deforme). Les apostrophes sont doublees pour PowerShell.
$distant = 'P=; for p in php8.4-cli php8.4 php8.3-cli php8.3 php8.2-cli php8.2 php; do ' +
    'if command -v $p >/dev/null 2>&1 && $p -r ''exit(PHP_VERSION_ID >= 80200 ? 0 : 1);'' ; then P=$p; break; fi; done; ' +
    'test -z $P && { echo AUCUN-PHP-8.2-EN-LIGNE-DE-COMMANDE; ls /usr/bin | grep -i ^php; exit 1; }; ' +
    'echo PHP-UTILISE=$P; $P -v | head -1; ' +
    'rm -f qocot/lespetitschercheurs/api/diag.php && echo DIAG-SUPPRIME; ' +
    'C=qocot/_prive/lespetitschercheurs/config.php; B=qocot/_prive/serveur/bin/migrer.php; ' +
    '$P $B principale $C && $P $B chat $C'

ssh $hote $distant
if ($LASTEXITCODE -ne 0) { throw 'Echec : lisez le message ci-dessus.' }
Write-Host ''
Write-Host 'Termine. Dites a Claude : migre.'
