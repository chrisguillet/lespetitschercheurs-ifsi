# Les petits chercheurs – Lectures du mémoire (IFSI)

Outil partagé de suivi des lectures pour le mémoire : chaque étudiant saisit ses lectures,
le tableau commun les rassemble (filtres, recherche, export Excel/PDF), les formateurs commentent.

## Architecture

```
Navigateur (GitHub Pages)  ──jeton Google──▶  Apps Script (API)  ──▶  Google Sheet (privé)
   index.html / app.js                         apps-script/Code.gs      Lectures · Utilisateurs
                                                                         Commentaires · Historique
```

- **Front** : fichiers statiques à la racine, hébergés sur GitHub Pages.
- **API** : `apps-script/Code.gs`, script lié au Sheet. Il s'exécute avec le compte du propriétaire,
  donc le Sheet n'a besoin d'être partagé avec personne.
- **Identité** : connexion Google côté page. Le script vérifie le jeton auprès de Google et déduit
  l'adresse e-mail, puis la compare à l'onglet `Utilisateurs`.

## Rôles et accès

| Rôle | Lire | Ses lectures | Lectures des autres | Commentaires | Administration |
|---|---|---|---|---|---|
| **Étudiant** | oui | modifier, supprimer | « Contribuer » (avertissement, ancienne version dans `Historique`) ; suppression interdite | supprimer (modération) | oui |
| **Formateur** | oui | — | — | publier, modifier et supprimer les siens | non |
| **Lecteur** | oui | — | — | — | non |
| **Administrateur** | oui | — | — | supprimer (modération) | oui, **y compris les étudiants** (prénom, couleur, rôle, adresse e-mail) |

L'**administrateur** est une adresse fixe, définie dans la propriété de script `ADMIN_EMAIL` (voir plus bas). Elle n'apparaît
ni dans la feuille ni dans le dépôt, et l'application ne permet pas de la modifier. Quand il change l'adresse d'un étudiant,
ses lectures et ses commentaires suivent automatiquement.

**Demande d'accès** : une personne dont l'adresse n'est pas connue se connecte avec Google ; une ligne
`en_attente` est créée dans `Utilisateurs` (50 demandes en attente au maximum) et elle voit « demande envoyée ».
Elle ne lit rien tant qu'un étudiant n'a pas validé. Dans l'onglet **👥 Administration** (visible des
étudiants et de l'administrateur, avec un compteur de demandes), on donne un prénom et un rôle (Lecteur ou Formateur), ou on refuse.
On peut ensuite changer le rôle, ou retirer l'accès. Seul l'administrateur peut gérer les étudiants.

## Mise en place

### 1. Le Sheet et le script

1. Créer un Google Sheet vide, puis **Extensions → Apps Script**.
2. Remplacer le contenu de `Code.gs` par `apps-script/Code.gs`.
3. **Paramètres du projet** → cocher « Afficher le fichier manifeste appsscript.json », puis remplacer
   son contenu par `apps-script/appsscript.json`.
4. Choisir la fonction `setup` et cliquer sur **Exécuter** (autoriser l'accès demandé).
   Elle crée les onglets `Lectures`, `Utilisateurs`, `Commentaires` et `Historique`. On peut la relancer
   sans risque après une mise à jour du code : elle n'efface aucune donnée.
5. Dans `Utilisateurs`, remplacer les adresses factices des **quatre étudiants** par les vraies adresses Gmail
   (colonnes `email`, `prenom`, `role` = `etudiant`, `couleur` = `#rrggbb`, `statut` = `actif`).
   Les colonnes `demande_le` et `derniere_connexion` sont remplies automatiquement.

### 2. L'identifiant client Google (connexion)

1. [console.cloud.google.com](https://console.cloud.google.com) → créer un projet.
2. **Google Auth Platform** → configurer l'écran de consentement : type **Externe**, nom de l'application,
   adresses e-mail de contact.
3. **Audience** → **Publier l'application** (passage en production). C'est nécessaire pour que n'importe
   quelle adresse puisse demander un accès : en mode « Test », seules les adresses listées comme utilisateurs
   de test peuvent se connecter. Pour une simple connexion (e-mail, profil), aucune validation par Google n'est requise.
4. **Clients → Créer un client** → type « Application Web ».
   - **Origines JavaScript autorisées** : `https://chrisguillet.github.io` et, pour les tests locaux, `http://localhost:8080`.
5. Copier l'**ID client** (`xxxx.apps.googleusercontent.com`).
6. Dans Apps Script : **Paramètres du projet → Propriétés du script**, ajouter deux propriétés :
   - `GOOGLE_CLIENT_ID` = l'ID client ;
   - `ADMIN_EMAIL` = l'adresse de l'administrateur (par exemple `prenom.nom@gmail.com`).

### 3. Déployer l'API

1. **Déployer → Nouveau déploiement → Application Web** : exécuter en tant que **Moi**, accès **Tout le monde**
   (l'accès réel est contrôlé par le jeton Google et l'onglet `Utilisateurs`).
2. Copier l'URL se terminant par `/exec`.
3. À chaque modification de `Code.gs` : **Déployer → Gérer les déploiements → Modifier → Nouvelle version**
   (l'URL ne change pas), et relancer `setup` si la structure a changé.

### 4. Le front

1. Renseigner `config.js` : `GOOGLE_CLIENT_ID` et `API_URL`, puis commiter et pousser.
2. GitHub : **Settings → Pages → Deploy from a branch → `main` / racine**.
3. L'application est sur `https://chrisguillet.github.io/lespetitschercheurs-ifsi/`.

Test local : `python3 -m http.server 8080` puis ouvrir `http://localhost:8080`.

## Exploitation

- **Ajouter ou corriger un étudiant** : par l'administrateur, dans l'onglet Administration (rôle « Étudiant » pour en promouvoir un,
  champ « Adresse » pour corriger une adresse). On peut aussi éditer `Utilisateurs` à la main, mais alors les lectures
  ne suivent pas un changement d'adresse.
- **Annuler une contribution** : retrouver l'ancienne version dans `Historique` (colonne `avant`, JSON)
  et la recopier dans la lecture concernée.
- **Ne pas modifier** les colonnes `id` et `owner` de `Lectures`, ni les ids de `Commentaires`.
- **Rôle inconnu ou mal orthographié** dans `Utilisateurs` : traité comme `lecteur` (le moins privilégié).
- Le tableau se rafraîchit toutes les 45 secondes (et au retour sur l’onglet) (réglable dans `config.js`).

## Notes de sécurité

- `config.js` ne contient aucun secret : l'ID client et l'URL de l'API sont publics par nature.
- Le script refuse tout jeton dont l'audience n'est pas votre ID client, ou dont l'adresse n'est pas vérifiée.
- Les adresses e-mail ne sont renvoyées au navigateur qu'aux étudiants et à l'administrateur, dans l'onglet Administration.
- L'adresse de l'administrateur n'est pas dans le dépôt : elle vit dans les propriétés du script.
- Tant qu'une demande est en attente, ou refusée, aucune lecture ni aucun commentaire n'est renvoyé.
