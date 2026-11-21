# Envoie le serveur sur IONOS. A lancer depuis la racine du depot, une fois serveur\config.php rempli :
#   .\serveur\deploiement\envoyer.ps1
# Le mot de passe de l'acces SFTP + SSH (su953491) est demande par scp puis par ssh : on le tape soi-meme,
# il n'est jamais ecrit nulle part. Ce script peut etre relance sans risque.
#
# Resultat sur le serveur :
#   qocot/lespetitschercheurs/api/                 le service web (index.php, src/, diag.php temporaire)
#   qocot/_prive/lespetitschercheurs/config.php    la configuration (droits 600), hors web
#   qocot/_prive/serveur/                          copie complete du dossier serveur (bin, sql, tests) pour l'administration

$ErrorActionPreference = 'Stop'
$hote = 'su953491@access-5021963953.webspace-host.com'
$serveur = Split-Path -Parent $PSScriptRoot
$config = Join-Path $serveur 'config.php'

if (-not (Test-Path $config)) { throw 'serveur\config.php est introuvable.' }
if (Select-String -Path $config -Pattern 'REMPLIR' -Quiet) { throw 'serveur\config.php contient encore des champs a remplir.' }

$archive = Join-Path $env:TEMP 'lpc-serveur.tar'
if (Test-Path $archive) { Remove-Item $archive }
tar -cf $archive -C $serveur .
if ($LASTEXITCODE -ne 0) { throw 'Creation de l archive impossible.' }

try {
    Write-Host '1/2 Envoi de l archive (mot de passe SFTP + SSH demande)...'
    scp $archive "${hote}:lpc-serveur.tar"
    if ($LASTEXITCODE -ne 0) { throw 'Envoi echoue.' }
} finally {
    Remove-Item $archive -ErrorAction SilentlyContinue
}

# Commandes executees sur le serveur (une seule ligne, sans guillemets : Windows les deforme).
$distant = 'set -e; test -d qocot/lespetitschercheurs || { echo CHEMIN-INTROUVABLE; pwd; ls; exit 1; }; ' +
    'D=qocot/_prive/serveur; mkdir -p $D qocot/_prive/lespetitschercheurs; ' +
    'tar -xf lpc-serveur.tar -C $D; rm lpc-serveur.tar; ' +
    'mv -f $D/config.php qocot/_prive/lespetitschercheurs/config.php; chmod 600 qocot/_prive/lespetitschercheurs/config.php; ' +
    '(php -l qocot/_prive/lespetitschercheurs/config.php) || echo ATTENTION-SYNTAXE-DE-CONFIG-A-VERIFIER; ' +
    'rm -rf qocot/lespetitschercheurs/api; cp -r $D/api qocot/lespetitschercheurs/api; ' +
    'cp $D/diagnostic/diag.php qocot/lespetitschercheurs/api/diag.php; ' +
    'echo DEPLOYE; pwd; (php -v | head -1) || true; (ls /usr/bin | grep -i ^php) || true'

Write-Host '2/2 Installation sur le serveur (mot de passe a nouveau)...'
ssh $hote $distant
if ($LASTEXITCODE -ne 0) { throw 'Installation echouee : lisez le message ci-dessus.' }

Write-Host ''
Write-Host 'Termine. Dites a Claude : deploye.'
