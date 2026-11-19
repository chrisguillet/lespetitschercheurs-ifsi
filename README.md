# Les petits chercheurs – Lectures du mémoire (IFSI)

Outil partagé de suivi des lectures pour le mémoire : chaque étudiant saisit ses lectures,
le tableau commun les rassemble (filtres, recherche, export Excel/PDF), les étudiants et les formateurs commentent.
Une dernière colonne génère une référence APA 7 à partir des champs saisis (bouton « Copier », italique conservé dans Word) ; le formulaire propose revue/éditeur, volume, numéro, pages et DOI/URL (facultatifs).
Le formulaire accepte une date partielle (2021, mars 2021…), affiche la référence APA en direct, signale les doublons (même titre ou DOI) et garde un brouillon local si la page est fermée avant l’enregistrement.

Interface : l’accueil est le tableau commun (vue tableau ou cartes, colonnes masquables, mots-clés cliquables, badge « Nouveau »). Le formulaire s’ouvre dans un panneau latéral. Les onglets **Bibliographie** (références APA triées, copie, export Word/texte) et **Synthèse** (graphiques) complètent « Mes lectures ». Un bouton traduit les mots-clés en anglais (service de traduction d’Apps Script) avec un indice de fiabilité : glossaire de sciences infirmières, ou retraduction en français. Thème clair/sombre manuel. Chaque lecture peut avoir un **lien** (fiche, PDF, article en ligne), cliquable dans le tableau et les cartes (http/https uniquement, nouvel onglet). Une pastille **« N en ligne »** en haut à droite liste les personnes actives ces 2 min 30 (données du cache Apps Script, rien n’est écrit dans le Sheet ; l’administrateur reste discret). L’onglet **Commentaires** rassemble tous les commentaires (récents en tête) avec un suivi **lu / non lu** par personne, mémorisé sur le serveur donc identique d’un appareil à l’autre : pastille sur l’onglet, mention « non lus » sur chaque lecture, surlignage à l’ouverture d’une discussion, filtres « non lus seulement » et « sur mes lectures », boutons « marquer comme lu » / « marquer comme non lu » (pour y revenir plus tard) et « tout marquer comme lu ».

## Architecture

```
Navigateur (GitHub Pages)  ──jeton Google──▶  Apps Script (API)  ──▶  Google Sheet (privé)
   index.html / app.js                         apps-script/Code.gs      Lectures · Utilisateurs · Commentaires
                                                                         Historique · Lus
                                                                         Groupes · Membres · Votes
```

- **Front** : fichiers statiques à la racine, hébergés sur GitHub Pages.
- **API** : `apps-script/Code.gs`, script lié au Sheet. Il s'exécute avec le compte du propriétaire,
  donc le Sheet n'a besoin d'être partagé avec personne.
- **Identité** : connexion Google côté page. Le script vérifie le jeton auprès de Google et déduit
  l'adresse e-mail, puis la compare à l'onglet `Utilisateurs`.

## Rôles et accès

| Rôle | Lire | Ses lectures | Lectures des autres | Commentaires | Administration |
|---|---|---|---|---|---|
| **Étudiant** | oui | modifier, supprimer | « Contribuer » (avertissement, ancienne version dans `Historique`) ; suppression interdite | publier, modifier et supprimer les siens ; supprimer ceux des autres (modération) | oui |
| **Formateur** | oui | — | — | publier, modifier et supprimer les siens | non |
| **Lecteur** | oui | — | — | — | non |
| **Administrateur** | oui | — | — | supprimer (modération) | oui, **y compris les étudiants** (prénom, couleur, rôle, adresse e-mail) et peut **supprimer** un utilisateur (plus d’accès ; ses lectures restent dans le Sheet mais ne sont plus affichées, et ses commentaires sur les lectures des autres apparaissent sous « Utilisateur supprimé ») |

L'**administrateur** est une adresse fixe, définie dans la propriété de script `ADMIN_EMAIL` (voir plus bas). Elle n'apparaît
ni dans la feuille ni dans le dépôt, et l'application ne permet pas de la modifier. Quand il change l'adresse d'un étudiant,
ses lectures et ses commentaires suivent automatiquement.

## Établissements, promos et groupes

Tout est organisé en **établissement → promo → groupe** (par exemple *IFSI Saint-Nazaire → Promo 24-27 → Les petits chercheurs*).

- Chaque **fiche** appartient à un groupe : seuls les membres du groupe (et l'administrateur) la voient. Son propriétaire peut cocher
  **« La partager avec toute la promo »** : les autres groupes de la même promo la lisent et la commentent, sans pouvoir la modifier.
- Chaque fiche a **deux fils de commentaires indépendants** : celui du **groupe** et celui de la **promo** (si elle est partagée).
  Rien ne passe de l'un à l'autre. Dans le fil du groupe, les étudiants du groupe peuvent supprimer un commentaire (modération) ; dans le fil
  de la promo, seuls l'auteur et l'administrateur le peuvent. Retirer le partage cache les commentaires de promo, sans les perdre.
- Le bandeau sous les onglets choisit le **groupe** (si l'on en a plusieurs, y compris dans d'autres promos) et la **vue** : *Mon groupe* ou *Toute la promo*.
  Tableau, cartes, bibliographie, synthèse et exports suivent la vue. Le choix est mémorisé.
- Un **étudiant** n'est que dans **un groupe par promo** ; un **formateur** ou un **lecteur** est rattaché par l'administrateur à un ou plusieurs groupes
  et ne voit que ceux-là (plus les fiches partagées avec la promo de ces groupes).
- **L'administrateur** crée, renomme, déplace et supprime les groupes, et gère les membres (onglet Administration, bloc *Groupes*).
  Supprimer un groupe conserve ses fiches dans le Sheet mais ne les affiche plus.
- **Un étudiant** peut, depuis **⚙️ Membres et votes**, **ajouter** à son groupe un étudiant qui n'a pas encore de groupe dans la promo.
  Pour **retirer un membre** ou **renommer le groupe**, il fait une proposition que les étudiants du groupe votent à la **majorité simple**
  (la personne visée ne vote pas ; la proposition compte pour un « oui » de son auteur). Garde-fous : la proposition expire après **7 jours** ;
  un retrait refusé ne peut pas être reproposé pendant **14 jours** ; à deux étudiants le retrait ne se vote pas (l'administrateur retire le membre) ;
  on ne vide jamais un groupe de ses étudiants ; tout est tracé dans l'onglet `Votes`. Les fiches d'un membre retiré restent au groupe.
- Un étudiant ne voit **pas les adresses e-mail des autres étudiants** (seulement les demandes en attente et les formateurs / lecteurs). Les autres étudiants
  sont désignés par un identifiant public dérivé de l'adresse.
- **Reprise de l'existant** : `setup` crée le groupe « Les petits chercheurs » (IFSI Saint-Nazaire, Promo 24-27) avec tous les accès actifs,
  et lui rattache les fiches et commentaires déjà saisis. Sans risque à relancer.

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
   Elle crée les onglets `Lectures`, `Utilisateurs`, `Commentaires`, `Lus` (suivi lu/non lu) et `Historique`. On peut la relancer
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
- **Sauvegarde automatique** : dans l'éditeur Apps Script, lancer **une fois** `activerSauvegardes` (accepter les nouvelles
  autorisations Drive). Une copie du Sheet est alors faite chaque jour vers 3 h dans le dossier Drive
  « Sauvegardes – lectures IFSI ». On garde les **7 plus récentes** (une par jour) et les **8 dernières faites un lundi**
  (une par semaine), soit au plus 15 copies ; les autres vont à la corbeille Drive.
  `sauvegarder` peut aussi se lancer à la main avant une opération risquée. Pour restaurer : ouvrir la copie voulue,
  ou recopier l'onglet concerné dans le Sheet de production.
- **Passage aux groupes** : coller le nouveau `Code.gs`, lancer `setup` **une fois** (crée `Groupes`, `Membres`, `Votes`, ajoute les colonnes `groupe_id` et `portee`,
  puis rattache l'existant au groupe « Les petits chercheurs »), puis créer une nouvelle version du déploiement. Entre le collage du code et `setup`, l'application ne montre rien.
- **Nouvelle colonne `lien`** dans `Lectures` : relancer `setup` après avoir collé le nouveau `Code.gs` (les lectures existantes restent intactes, le lien est facultatif).
- **Renommer le Sheet** : sans effet sur l'application (le script lui est rattaché par son identifiant).
- Le tableau se rafraîchit toutes les 45 secondes (et au retour sur l’onglet) (réglable dans `config.js`).

## Notes de sécurité

- `config.js` ne contient aucun secret : l'ID client et l'URL de l'API sont publics par nature.
- Le script refuse tout jeton dont l'audience n'est pas votre ID client, ou dont l'adresse n'est pas vérifiée.
- Les adresses e-mail ne sont renvoyées au navigateur qu'à l'administrateur (et, pour les demandes en attente et les formateurs / lecteurs, aux étudiants), dans l'onglet Administration.
- L'adresse de l'administrateur n'est pas dans le dépôt : elle vit dans les propriétés du script.
- Tant qu'une demande est en attente, ou refusée, aucune lecture ni aucun commentaire n'est renvoyé.
