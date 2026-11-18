# Lydia – Lectures du mémoire (IFSI)

Outil partagé de suivi des lectures pour le mémoire : chaque étudiant saisit ses lectures,
le tableau commun les rassemble (filtres, recherche, export Excel/PDF).

## Architecture

```
Navigateur (GitHub Pages)  ──jeton Google──▶  Apps Script (API)  ──▶  Google Sheet (privé)
   index.html / app.js                         apps-script/Code.gs      Lectures / Utilisateurs / Historique
```

- **Front** : fichiers statiques à la racine, hébergés sur GitHub Pages.
- **API** : `apps-script/Code.gs`, script lié au Sheet. Il s'exécute avec le compte du propriétaire,
  donc le Sheet n'a besoin d'être partagé avec personne.
- **Identité** : connexion Google côté page. Le script vérifie le jeton auprès de Google et déduit
  l'adresse e-mail, puis la compare à l'onglet `Utilisateurs`.

### Règles d'accès

| Rôle | Ses lectures | Lectures des autres |
|---|---|---|
| Étudiant | modifier, supprimer | lecture seule ; **modification possible** via « Contribuer » (avertissement, ancienne version gardée dans `Historique`) ; suppression interdite |
| Formateur | — | lecture seule stricte |

## Mise en place

### 1. Le Sheet et le script

1. Créer un Google Sheet vide (nom libre, par exemple « Lydia – lectures »).
2. **Extensions → Apps Script**.
3. Remplacer le contenu de `Code.gs` par `apps-script/Code.gs`.
4. **Paramètres du projet** → cocher « Afficher le fichier manifeste appsscript.json », puis remplacer
   son contenu par `apps-script/appsscript.json`.
5. Dans l'éditeur, choisir la fonction `setup` et cliquer sur **Exécuter** (autoriser l'accès demandé).
   Elle crée les onglets `Lectures`, `Utilisateurs` et `Historique`.
6. Dans l'onglet `Utilisateurs`, remplacer les adresses factices par les vraies adresses Gmail
   (colonnes : `email`, `prenom`, `role` = `etudiant` ou `formateur`, `couleur` au format `#rrggbb`).

### 2. L'identifiant client Google (connexion)

1. [console.cloud.google.com](https://console.cloud.google.com) → créer un projet (ou en réutiliser un).
2. **API et services → Écran de consentement OAuth** : type « Externe », renseigner le nom de l'application
   et ton e-mail. Laisser en mode « Test » et ajouter les adresses des utilisateurs comme **utilisateurs
   de test** (maximum 100, largement suffisant), ou publier l'application (la simple connexion ne demande pas de validation).
3. **Identifiants → Créer des identifiants → ID client OAuth** → type « Application Web ».
   - **Origines JavaScript autorisées** : `https://chrisguillet.github.io` et, pour les tests locaux,
     `http://localhost:8080`.
4. Copier l'**ID client** (`xxxx.apps.googleusercontent.com`).
5. Dans Apps Script : **Paramètres du projet → Propriétés du script** → ajouter
   `GOOGLE_CLIENT_ID` = l'ID client.

### 3. Déployer l'API

1. Apps Script : **Déployer → Nouveau déploiement → Application Web**.
   - Exécuter en tant que : **Moi**
   - Qui a accès : **Tout le monde** (l'accès est contrôlé par le jeton Google, pas par ce réglage)
2. Copier l'URL se terminant par `/exec`.
3. À chaque modification de `Code.gs` : **Déployer → Gérer les déploiements → Modifier → Nouvelle version**
   (l'URL ne change pas).

### 4. Le front

1. Renseigner `config.js` : `GOOGLE_CLIENT_ID` et `API_URL`.
2. Pousser le dépôt sur GitHub, puis **Settings → Pages → Deploy from a branch → `main` / racine**.
3. L'application est disponible sur `https://chrisguillet.github.io/lydia/`.

Test local : `python3 -m http.server 8080` puis ouvrir `http://localhost:8080`.

## Exploitation

- **Ajouter ou retirer un utilisateur** : modifier l'onglet `Utilisateurs` (effet immédiat).
- **Annuler une contribution** : retrouver l'ancienne version dans l'onglet `Historique`
  (colonne `avant`, au format JSON) et la recopier dans la lecture concernée.
- **Données** : l'onglet `Lectures` est lisible directement ; ne pas modifier la colonne `id` ni `owner`.
- **Quotas** : largement suffisants pour quelques utilisateurs ; le tableau se rafraîchit toutes les
  20 secondes (réglable dans `config.js`).

## Notes de sécurité

- `config.js` ne contient aucun secret : l'ID client et l'URL de l'API sont publics par nature.
- Le script refuse tout jeton dont l'audience n'est pas votre ID client, et toute adresse absente de `Utilisateurs`.
- Les adresses e-mail ne sont jamais renvoyées au navigateur.
