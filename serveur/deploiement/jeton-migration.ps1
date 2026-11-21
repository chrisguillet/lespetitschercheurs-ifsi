# Prepare les migrations automatiques : genere un jeton aleatoire, le copie dans le presse-papiers (pour le secret GitHub
# MIGRATION_JETON) et inscrit son empreinte SHA-256 dans serveur\config.php (migration_jeton_sha256). Aucun mot de passe.
#   .\serveur\deploiement\jeton-migration.ps1
# Ensuite : coller le jeton dans GitHub (Settings > Secrets and variables > Actions > New repository secret : MIGRATION_JETON),
# puis relancer .\serveur\deploiement\envoyer.ps1 pour deposer la configuration mise a jour. Le jeton n'est jamais ecrit sur le disque.

$ErrorActionPreference = 'Stop'
$config = Join-Path (Split-Path -Parent $PSScriptRoot) 'config.php'
if (-not (Test-Path $config)) { throw 'serveur\config.php est introuvable.' }

$octets = New-Object byte[] 32
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($octets)
$jeton = [Convert]::ToBase64String($octets).TrimEnd('=').Replace('+', '-').Replace('/', '_')

$sha = [System.Security.Cryptography.SHA256]::Create()
$hash = ([BitConverter]::ToString($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($jeton))) -replace '-', '').ToLower()

# UTF-8 SANS BOM : un BOM avant <?php casserait toutes les reponses de l'API.
$sansBom = New-Object System.Text.UTF8Encoding($false)
$texte = [System.IO.File]::ReadAllText($config, $sansBom)
$ligne = "    'migration_jeton_sha256' => '$hash',"
if ($texte -match "'migration_jeton_sha256'") {
    $texte = [regex]::Replace($texte, "(?m)^\s*'migration_jeton_sha256'\s*=>\s*'[0-9a-fA-F]*',?\s*$", $ligne)
} else {
    $texte = [regex]::Replace($texte, '(?m)^\];\s*$', $ligne + "`r`n];")
}
[System.IO.File]::WriteAllText($config, $texte, $sansBom)

Set-Clipboard -Value $jeton
Write-Host 'Empreinte inscrite dans serveur\config.php.'
Write-Host 'Le jeton est dans le presse-papiers : collez-le maintenant dans le secret GitHub MIGRATION_JETON.'
Write-Host 'Puis lancez .\serveur\deploiement\envoyer.ps1 pour deposer la configuration.'
