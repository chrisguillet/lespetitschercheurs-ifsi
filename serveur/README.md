# Serveur PHP + MariaDB (étape 1 : socle)

Remplace l'ancien backend Apps Script (`apps-script/Code.gs`) sans changer l'interface : même `POST` JSON
`{action, token, ...}`, mêmes noms d'actions, même enveloppe de réponse `{ok, ...}` / `{ok:false, error, message, extra}`,
toujours en HTTP 200.

## Où va quoi sur IONOS

```
/qocot/lespetitschercheurs/            racine web du site (lespetitschercheurs.qocot.eu)
    index.html, style.css, js/ ...     le front
    api/                               contenu de serveur/api/ (index.php, src/, .htaccess)
/qocot/_prive/lespetitschercheurs/     jamais servi par le web
    config.php                         secrets (modèle : serveur/config.exemple.php), hors dépôt
    cache/                             clés publiques de Google (créé automatiquement)
    fichiers/ sauvegardes/             à venir (étapes 3 et 5)
```

Le compte SFTP de déploiement (GitHub) est limité à `/qocot/lespetitschercheurs` : il ne peut pas toucher à `_prive/`.
`config.php` se dépose donc avec l'accès administrateur (SFTP + SSH), une fois.

## Déploiement automatique

Un `push` sur `main` lance les tests, puis (s'ils sont verts) envoie `serveur/api/` en miroir sur IONOS par SFTP
(`.github/workflows/serveur.yml`, job « Déploiement »). Il utilise le compte SFTP seul limité à `/qocot/lespetitschercheurs`,
dont l'hôte, l'utilisateur et le mot de passe sont dans les secrets GitHub `SFTP_HOTE`, `SFTP_UTILISATEUR` et `SFTP_MOT_DE_PASSE`.
Le miroir supprime du serveur ce qui n'est plus dans le dépôt. Restent manuels : `config.php` et les migrations SQL
(scripts `deploiement/envoyer.ps1` et `deploiement/migrer.ps1`, avec le compte administrateur).

### Migrations SQL automatiques

Après l'envoi des fichiers, le déploiement appelle `api/migrer.php` (POST, en-tête `X-Migration-Token`). Ce point d'entrée applique les
fichiers de `api/sql/` pas encore appliqués, une seule fois chacun, et n'exécute **jamais** du SQL venant de la requête. Il est
désactivé tant que `migration_jeton_sha256` (empreinte SHA-256 du jeton) est absent de `config.php`. Mise en place, une seule fois :
`.\serveur\deploiement\jeton-migration.ps1` (génère le jeton, copié dans le presse-papiers, et inscrit l'empreinte dans `config.php`),
coller le jeton dans le secret GitHub `MIGRATION_JETON`, puis `.\serveur\deploiement\envoyer.ps1` pour déposer la configuration.
Un schéma s'ajoute en créant `api/sql/00N_nom.sql` et en le déclarant dans `Migrations::FICHIERS`.

## Mise en route

0. Raccourci : remplir `serveur/config.php` (ignoré par git), puis `.\serveur\deploiement\envoyer.ps1` fait les étapes 1 et 3
   d'un coup (envoi par scp, installation par ssh ; le mot de passe est tapé à la main).
   Puis `.\serveur\deploiement\migrer.ps1` crée les tables (PHP ≥ 8.2 détecté sur le serveur) et supprime `diag.php`.
1. Copier `config.exemple.php` en `config.php` **hors du dépôt**, le remplir, le déposer dans `/qocot/_prive/lespetitschercheurs/`.
2. Créer les tables, en SSH : `php serveur/bin/migrer.php principale` puis `php serveur/bin/migrer.php chat`
   (ou importer `sql/001_principal.sql` et `sql/002_chat.sql` dans phpMyAdmin, chacun dans sa base).
3. Déposer `serveur/api/` dans `/qocot/lespetitschercheurs/api/` et, le temps du test, `serveur/diagnostic/diag.php`
   sous `api/diag.php`. Ouvrir `https://lespetitschercheurs.qocot.eu/api/diag.php?cle=<diagnostic_cle>`, **puis supprimer `diag.php`**.
4. Vérifier : `GET https://lespetitschercheurs.qocot.eu/api/` renvoie `{"ok":true,"service":"lespetitschercheurs"}`.

## Tests

- `php serveur/tests/run.php` : tests unitaires (jeton Google, identifiants, dates), sans base de données.
- `LPC_CONFIG=... php serveur/tests/integration.php` : chemin complet d'une requête contre de vraies bases
  (accès, rôles, droits, contraintes SQL, cascades). **Écrit dans les bases : réservé à des bases de test vides**, le script
  refuse de s'exécuter si la base contient déjà des utilisateurs.
- Le workflow `.github/workflows/serveur.yml` lance tout à chaque `push` touchant `serveur/` : syntaxe et tests unitaires
  sous PHP 8.2, 8.3 et 8.4, puis schéma et intégration sur MariaDB 11.8 et MySQL 8.0 (portabilité du SQL).

## Ce que fait l'étape 1

| Élément | Fichier | Note |
|---|---|---|
| Point d'entrée, cycle d'une requête | `api/index.php`, `Application.php` | erreurs internes jamais exposées, journalisées |
| Configuration hors web | `Config.php` | `CONSENT_VERSION = '2026-11-21'` (nouvelle version : le consentement est redemandé) |
| Deux bases | `Db.php` | principale + chat, UTC, mode SQL strict |
| Jeton Google vérifié localement | `GoogleJeton.php` | signature RS256, émetteur, audience, expiration, adresse vérifiée ; clés Google en cache disque (1 h) |
| Accès | `Auth.php`, `Utilisateurs.php` | mêmes règles et messages que l'ancien `authentifier_` |
| Droits | `Droits.php`, `Attributions.php` | rôles avec périmètre, hiérarchie admin > admin de site > admin de promo |
| Routeur | `Routeur.php` | les 64 actions de l'ancien script sont listées ; seules `init` (partielle) et `bye` existent |
| Schéma | `sql/001_principal.sql`, `002_chat.sql` | voir ci-dessous |

Une action listée mais pas encore migrée répond `{ok:false, error:"not_implemented"}`.

## Avancement de l'étape 2

- Lot A (consentement, profil, structure) et lot B1 (accès, invitations, administration des personnes, RGPD) : livrés.
- Lots B2, C et D (membres, votes, lectures, fiches, pièces jointes, suivi, glossaire, notes, retours, chat, traduction) : livrés.

## Import de l'ancien Google Sheet (transition)

Le serveur lit directement le Sheet et le dossier Drive avec un compte de service en lecture seule (`GoogleApi.php`), puis
`Importation.php` rapproche chaque onglet des tables. Les données vont de Google au serveur : elles ne passent ni par le dépôt
ni par GitHub, et le rapport ne contient que des nombres.

- **Rejouable** : chaque ligne importée laisse une trace (`import_traces` : empreinte de la ligne du Sheet et de la ligne écrite).
  Ligne inchangée : ignorée. Nouvelle : créée. Modifiée dans le Sheet : mise à jour, sauf si la base a été retouchée depuis
  l'import (conflit : signalé, laissé tel quel).
- **Identifiants conservés** (UUID du Sheet) ; personnes reconnues par leur adresse ; un compte déjà créé dans le nouvel outil prévaut.
- **Suppressions** : une ligne disparue du Sheet est seulement signalée ; avec l'option « supprimer » elle est supprimée si la base
  n'a pas bougé, jamais pour les personnes, établissements et promos, jamais si l'onglet est entièrement vide.
- **Rôles** : étudiant de chaque promo où la personne est inscrite ou en groupe, formateur de l'établissement de ces promos (ajouts seulement).
- **À blanc** : tout est calculé dans une transaction annulée à la fin (rien n'est écrit, aucun fichier téléchargé).

Mise en route : activer les API Google Sheets et Drive, créer le compte de service, partager le Sheet et le dossier avec son adresse
(lecteur), puis ajouter la section `import` de `config.exemple.php` à `config.php` (clé JSON collée dans le fichier, jamais dans une
conversation). Lancement : onglet Actions de GitHub > « Import de l'ancien Sheet » > Run workflow (« à blanc » par défaut). Pour un import
horaire automatique, créer la variable de dépôt `IMPORT_AUTO` = `true`. Tests : `tests/import.php` (données fictives, bases vides).

## Décisions de conception

- **Rôles** : table `attributions` (personne, rôle, établissement ou promo). Un compte peut cumuler des rôles.
  Pour l'interface actuelle, `me.role` reste `admin | etudiant | formateur` (admin global ; sinon étudiant s'il a une promo ;
  sinon formateur). Le détail est dans `me.roles`. Les écrans d'un admin de site ou de promo viennent avec l'étape 2.
- **Identité** : `prenom` et `nom` fixes (changement par `demandes_nom`, validé par un admin de promo ou plus),
  `pseudo` libre. Le nom affiché est le pseudo s'il existe, sinon « prénom + initiale du nom ».
- **Invitations** : table `invitations` (jeton stocké haché, expiration, usages max, révocation) ; le compte créé garde
  `invitation_id` pour tracer l'origine. Une invitation personnelle est liée à une adresse précise.
- **Visibilité** : `analyses.portee` vaut `groupe`, `promo`, `etablissement` ou `tout`. Seuls `groupe` et `promo` servent
  aujourd'hui. Le partage entre promos et établissements reste fermé tant que RGPD et droit d'auteur ne sont pas tranchés.
- **Quota** : `groupes.quota_octets` (NULL = pas de quota) et `fichiers.taille` permettent la somme par groupe.
- **Présence et chat** : dans la base du chat (écritures fréquentes). Le chat passera par une interrogation régulière.
- **Identifiants** : UUID conservés à l'import pour les lectures, articles, groupes… ; les personnes ont un identifiant
  numérique et un `pid` identique à celui de l'ancien script (12 caractères dérivés de l'adresse).
- **Administrateur** : l'adresse `admin_email` de `config.php` est créée au besoin, active, avec le rôle admin global.
  Contrairement à l'ancien script, elle passe aussi par le consentement (elle a désormais une ligne en base).

## Limites connues

- Rien de tout ceci n'a encore été exécuté : sur le poste de développement, Windows (Smart App Control) bloque `php.exe`.
  Les tests et la vérification de syntaxe passent par GitHub Actions ; le premier résultat est à lire après le premier `push`.
- `init` ne renvoie que `me` : les sections de données arrivent à l'étape 2.
- Les codes d'invitation de promo de l'ancien Sheet ne sont pas repris (le nouveau mécanisme utilise des liens).
- Pas de `CHECK` SQL sur rôle et périmètre (MySQL 8 les refuse avec des clés étrangères en `CASCADE`) : la cohérence est
  vérifiée par `Attributions.php`.

## Deux fronts dans le dépôt

- **À la racine du dépôt** (`index.html`, `js/`, `style.css`…) : l'ancien outil, figé dans son état du 20 novembre 2026. GitHub Pages le publie, il parle à Apps Script et au Google Sheet. On n'y touche plus pendant la double exploitation.
- **Dans `site/`** : le front du nouvel outil. Le déploiement automatique l'envoie à la racine de lespetitschercheurs.qocot.eu, en réécrivant seulement `config.js` (adresse de l'API et chat activé). Toutes les évolutions du front se font ici.
