# Les petits chercheurs – Lectures du mémoire (IFSI)

Outil partagé de suivi des lectures pour le mémoire : chaque étudiant saisit ses lectures,
le tableau commun les rassemble (filtres, recherche, export Excel/PDF), les étudiants et les formateurs commentent.
Une dernière colonne génère une référence APA 7 à partir des champs saisis (bouton « Copier », italique conservé dans Word) ; le formulaire propose revue/éditeur, volume, numéro, pages et DOI/URL (facultatifs).
Le formulaire accepte une date partielle (2021, mars 2021…), affiche la référence APA en direct, signale les doublons (même titre ou DOI) et garde un brouillon local si la page est fermée avant l’enregistrement.

Interface : l’accueil est le tableau commun (vue tableau ou cartes, colonnes masquables, mots-clés cliquables, badge « Nouveau »). Le formulaire s’ouvre dans un panneau latéral. Les onglets **Bibliographie** (références APA triées, copie, export Word/texte) et **Synthèse** (graphiques) complètent « Mes lectures ». Un bouton traduit les mots-clés en anglais (service de traduction d’Apps Script) avec un indice de fiabilité : glossaire de sciences infirmières, ou retraduction en français. Thème clair/sombre manuel. Chaque lecture peut avoir un **lien** (fiche, PDF, article en ligne), cliquable dans le tableau et les cartes (http/https uniquement, nouvel onglet). Une pastille **« N en ligne »** en haut à droite liste les personnes actives ces 2 min 30 (données du cache Apps Script, rien n’est écrit dans le Sheet ; l’administrateur reste discret). L’onglet **Commentaires** rassemble tous les commentaires (récents en tête) avec un suivi **lu / non lu** par personne, mémorisé sur le serveur donc identique d’un appareil à l’autre : pastille sur l’onglet, mention « non lus » sur chaque lecture, surlignage à l’ouverture d’une discussion, filtres « non lus seulement » et « sur mes lectures », boutons « marquer comme lu » / « marquer comme non lu » (pour y revenir plus tard) et « tout marquer comme lu ».

## Architecture

```
Navigateur (GitHub Pages)  ──jeton Google──▶  Apps Script (API)  ──▶  Google Sheet (privé)
   index.html / js/*.js                         apps-script/Code.gs      Lectures · Utilisateurs · Commentaires
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
| **Étudiant** | oui | modifier, supprimer sa fiche de lecture | ajouter **sa propre fiche de lecture** sur un article de la promo ; **proposer une correction** de la partie objective (validée par 3 étudiants) ; modification et suppression interdites | publier, modifier et supprimer les siens ; supprimer ceux des autres (modération) | oui |
| **Formateur** | oui | — | — | publier, modifier et supprimer les siens | non |
| **Administrateur** | oui | — | — | supprimer (modération) | oui, **y compris les étudiants** (prénom, couleur, rôle, adresse e-mail) et peut **supprimer** un utilisateur (plus d’accès ; ses lectures restent dans le Sheet mais ne sont plus affichées, et ses commentaires sur les lectures des autres apparaissent sous « Utilisateur supprimé ») |

L'**administrateur** est une adresse fixe, définie dans la propriété de script `ADMIN_EMAIL` (voir plus bas). Elle n'apparaît
ni dans la feuille ni dans le dépôt, et l'application ne permet pas de la modifier. Quand il change l'adresse d'un étudiant,
ses lectures et ses commentaires suivent automatiquement.

## Établissements, promos et groupes

Tout est organisé en **établissement → promo → groupe** (par exemple *IFSI Saint-Nazaire → Promo 24-27 → Les petits chercheurs*).

- **Documents et fiches de lecture.** La **partie objective** d'un article (titre, auteur, parution, type, références APA…) est **commune à la promo** ;
  chaque étudiant y ajoute **sa propre fiche de lecture** (mots-clés, concepts, objet, opinion, controverse, colonne libre). Une fiche de lecture
  **« En cours »** n'est visible que de son groupe ; dès qu'elle est **« Terminée »** elle est **partagée automatiquement avec toute la promo** :
  c'est la grande base de connaissances partagée. Le tableau liste d'abord **les documents étudiés (une ligne chacun)**, avec qui en a fait une fiche ; un clic sur le document **déplie ses fiches de lecture** en dessous (colonnes 2 à 8). Une recherche ou un filtre déplie d'office les documents trouvés.
- À l'ajout, un article déjà présent (même DOI, ou même titre) est détecté : on propose d'**ajouter sa fiche de lecture** à l'article existant.
  Une personne n'a qu'une fiche de lecture par article.
- **Corriger la partie objective** : l'auteur de l'article peut la modifier directement tant qu'il est seul à l'avoir analysé ; ensuite toute
  correction est une **proposition**, appliquée quand **3 étudiants de la promo** (proposant compris) l'ont approuvée, refusée quand 3 l'ont refusée,
  expirée après 14 jours (ancienne version conservée dans `Historique`). L'administrateur corrige directement.
- Chaque fiche de lecture a **deux fils de commentaires indépendants** : celui du **groupe** et celui de la **promo** (si la fiche est terminée, donc partagée).
  Rien ne passe de l'un à l'autre. Dans le fil du groupe, les étudiants du groupe peuvent supprimer un commentaire (modération) ; dans le fil
  de la promo, seuls l'auteur et l'administrateur le peuvent. Repasser une fiche « En cours » cache les commentaires de promo, sans les perdre.
- Le bandeau sous les onglets choisit le **groupe** (si l'on en a plusieurs, y compris dans d'autres promos) et la **vue** : *Mon groupe* ou *Toute la promo*.
  Tableau, cartes, bibliographie, synthèse et exports suivent la vue. Le choix est mémorisé.
- Un **étudiant** n'est que dans **un groupe par promo** ; un **formateur** peut être dans **plusieurs groupes** (voir « Rattachement des formateurs » ci-dessous)
  et ne voit que ceux-là (plus les fiches partagées avec la promo de ces groupes).
- **L'administrateur** crée, renomme, déplace et supprime les groupes, et gère les membres (onglet Administration, bloc *Groupes*).
  Supprimer un groupe conserve ses fiches dans le Sheet mais ne les affiche plus.
- **Un étudiant** peut, depuis **⚙️ Membres et votes**, **ajouter** à son groupe un étudiant qui n'a pas encore de groupe dans la promo.
  Pour **retirer un membre** ou **renommer le groupe**, il fait une proposition que les étudiants du groupe votent à la **majorité simple**
  (la personne visée ne vote pas ; la proposition compte pour un « oui » de son auteur). Garde-fous : la proposition expire après **7 jours** ;
  un retrait refusé ne peut pas être reproposé pendant **14 jours** ; à deux étudiants le retrait ne se vote pas (l'administrateur retire le membre) ;
  on ne vide jamais un groupe de ses étudiants ; tout est tracé dans l'onglet `Votes`. Les fiches d'un membre retiré restent au groupe.
- Un étudiant ne voit **pas les adresses e-mail des autres étudiants** (seulement les demandes en attente et les formateurs). Les autres étudiants
  sont désignés par un identifiant public dérivé de l'adresse.
- **Reprise de l'existant** : `setup` crée le groupe « Les petits chercheurs » (IFSI Saint-Nazaire, Promo 24-27) avec tous les accès actifs,
  et lui rattache les fiches et commentaires déjà saisis. Sans risque à relancer.

**Première connexion en autonomie** (voir plus bas la section *Première connexion, codes d'invitation et groupes*) : à sa première connexion,
une personne choisit son **établissement et sa promo**, indique son prénom et son rôle, ou entre le **code d'invitation** de sa promo.

**Demande d'accès** : une personne dont l'adresse n'est pas connue se connecte avec Google ; une ligne
`en_attente` est créée dans `Utilisateurs` (50 demandes en attente au maximum) et elle voit « demande envoyée ».
Elle ne lit rien tant qu'un étudiant n'a pas validé. Dans l'onglet **👥 Administration** (visible des
étudiants et de l'administrateur, avec un compteur de demandes), on donne un prénom et un rôle (Formateur ; l'administrateur peut aussi en faire un Étudiant), ou on refuse.
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
- **Rôle inconnu ou mal orthographié** dans `Utilisateurs` : traité comme `formateur` (tant qu'il n'est rattaché à aucun groupe, il ne voit rien). L'ancien rôle `lecteur` n'existe plus : `setup` le convertit en `formateur`.
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

## Performances

- Chaque requête lit chaque feuille **une seule fois**. Les feuilles de structure (`Etablissements`, `Promos`, `Inscriptions`), qui changent rarement, sont servies par le **cache du script (10 minutes)** ; il est vidé à chaque écriture faite par l'application. Si vous modifiez ces trois feuilles **à la main** dans le Sheet, la modification peut mettre jusqu'à 10 minutes à apparaître.
- Une écriture (commentaire, marque « lu », fiche, fichier joint, réunion, jalon) ne renvoie **que les sections qu'elle a pu modifier** (`partiel: true` dans la réponse, voir `donnees_(user, sections)` dans `Code.gs`) : le serveur ne relit pas les autres feuilles et le navigateur fusionne avec son dernier état complet. Les autres actions et l'actualisation automatique renvoient tout. Pour ajouter une action à ce régime, passer la liste des sections à `donnees_`.
- Côté navigateur, l'actualisation automatique ne reconstruit pas le tableau quand rien n'a changé, et déplier un document ne reconstruit pas non plus le tableau.

## Notes de sécurité

- `config.js` ne contient aucun secret : l'ID client et l'URL de l'API sont publics par nature.
- Le script refuse tout jeton dont l'audience n'est pas votre ID client, ou dont l'adresse n'est pas vérifiée.
- Les adresses e-mail ne sont renvoyées au navigateur qu'à l'administrateur (et, aux étudiants, uniquement pour les demandes en attente et les formateurs rattachés à leurs groupes ; les accès refusés et les formateurs sans lien avec leurs groupes restent réservés à l'administrateur, y compris côté serveur), dans l'onglet Administration.
- L'adresse de l'administrateur n'est pas dans le dépôt : elle vit dans les propriétés du script.
- Tant qu'une demande est en attente, ou refusée, aucune lecture ni aucun commentaire n'est renvoyé.


## Migration vers « articles + fiches de lecture »

Relancez `setup` après avoir collé le nouveau `Code.gs` : il crée les feuilles `Articles` et `Propositions`, rattache chaque lecture existante à un article
(les lectures du même article dans une promo — même DOI ou même titre, personnes différentes — sont fusionnées) et recalcule le partage
(Terminée → promo). Opération sans risque à relancer ; les colonnes objectives de `Lectures` ne sont plus lues. Puis nouveau déploiement (nouvelle version).

## Suivi de projet (onglet « 🗓️ Suivi de projet »)

Propre à chaque groupe (celui choisi dans le bandeau), visible **de son groupe seulement** : ses étudiants, ses formateurs rattachés et l'administrateur. Rien n'est partagé avec le reste de la promo (contrairement aux fiches de lecture terminées).

- **Réunions** : un compte rendu par réunion (date, titre, participants, **ce qui a été vu**, **ce qui est attendu**, **étapes pour la suite**), les plus récentes en premier.
- **Rétroplanning** : des **jalons** avec statut (à faire, en cours, fait), à **date fixe** ou sur une **plage de dates** (du … au …), avec une barre d'avancement,
  une frise (la ligne rouge est aujourd'hui) et le décompte « J-12 », « en cours · fin dans 4 j » ou « en retard de 3 j ».
- **Calendrier mensuel** : les jalons (une plage s'étale sur ses jours) et les réunions du groupe, navigation mois par mois ; un clic sur un jalon l'ouvre pour le modifier.
- **Alertes facultatives** : par jalon, « le jour même » ou 1 j / 3 j / 1 semaine / 2 semaines / 1 mois avant la première date (le début pour une plage). Tant que le jalon n'est pas « Fait »,
  une pastille s'affiche sur l'onglet, un bandeau sur les autres onglets (masquable le temps de la session), et le jalon est contouré dans le calendrier ; passé la date de fin, il apparaît en retard.
  Ce sont des alertes dans l'outil (pas d'e-mail).
- Les **étudiants du groupe** ajoutent, modifient et suppriment ; les formateurs rattachés lisent seulement ; l'administrateur peut supprimer.
- Feuilles `Reunions` et `Jalons` (créées par `setup`, ou automatiquement au premier usage). Les colonnes `debut` et `alerte_jours` sont ajoutées en fin de feuille `Jalons` : relancer `setup` pour afficher leurs en-têtes ; les anciens jalons restent valides (date fixe, sans alerte).

## Première connexion, codes d'invitation et groupes

- **À la première connexion** (adresse inconnue), l'écran d'accueil propose deux voies :
  1. **Un code d'invitation** (donné par le formateur ou l'administrateur) : avec son prénom, la personne devient **étudiant(e) de la promo tout de suite**, sans validation.
  2. **Une demande** : prénom, rôle (étudiant ou formateur), établissement et promo. Elle reste **en attente** et est validée comme avant ;
     l'administrateur voit la promo et le rôle demandés (rôle présélectionné), et **valider un étudiant l'inscrit à la promo demandée**.
     Seul l'administrateur donne le rôle étudiant ; un étudiant peut valider une demande de formateur.
- **Périmètre actuel : une seule promo** (IFSI Saint-Nazaire, Promo 24-27). Tant qu'une seule promo existe, l'accueil et le panneau « sans groupe » n'affichent aucun choix d'établissement ni de promo : elle est choisie d'office. Les choix réapparaissent automatiquement dès qu'une deuxième promo est créée.
- **Codes d'invitation** : onglet Administration, dans chaque **promo** → *Générer un code* (8 caractères, validité en jours et nombre d'utilisations réglables ;
  30 jours et 150 par défaut). Un nouveau code remplace l'ancien ; *Révoquer* l'invalide (les personnes déjà inscrites le restent). Un code n'est compté qu'une fois par personne.
  Essais limités : **5 codes faux en 15 minutes** par adresse. Un code ne donne que le rôle **étudiant** et un accès à **cette promo** (jamais à un groupe).
- **Sans groupe**, un étudiant inscrit à une promo voit la liste de ses groupes (noms et prénoms des membres, jamais d'adresses) et peut :
  - **demander à rejoindre un groupe** : les **étudiants du groupe votent à la majorité simple** (mêmes règles que les autres votes : 7 jours, refus non renouvelable pendant 14 jours ;
    une seule demande en cours par promo, annulable). Si elle est acceptée, la personne entre dans le groupe ;
  - **créer son groupe** (nom unique dans la promo). **Un groupe d'une seule personne est accepté** : d'autres pourront demander à le rejoindre.
- Un étudiant déjà actif peut entrer le code d'une **autre promo** depuis ce panneau (donc seulement tant qu'il n'a pas de groupe dans sa promo actuelle).
- **Pas de « quitter mon groupe » en libre-service** : un retrait passe par le vote du groupe (ou l'administrateur), car les fiches de lecture restent rattachées au groupe d'origine.
- Nouvelle feuille `Inscriptions` (email, promo, date, origine : `code` ou `admin`) et nouvelles colonnes (créées par `setup`) : `Promos` (code, expiration, maximum, usages),
  `Utilisateurs` (promo et rôle demandés), `Groupes` (créé par). Après collage du code : lancer `setup`, puis créer une nouvelle version du déploiement.

## Administration : établissements, promos, groupes

L'onglet Administration (administrateur) présente un **arbre** : chaque **établissement** contient ses **promos**, chaque promo ses **groupes**.

- On crée, **renomme** et supprime les établissements et les promos ; renommer met à jour tous les groupes concernés.
- On ne supprime un établissement qu'une fois ses promos supprimées, et une promo qu'une fois ses groupes supprimés (une promo peut exister sans groupe).
- Un groupe se crée directement dans sa promo, se renomme et peut être **déplacé vers une autre promo** (liste déroulante) ; on y ajoute ou retire des membres.
- Les volets repliés le restent d'une mise à jour à l'autre.
- Les feuilles `Etablissements` et `Promos` sont créées et remplies par `setup` à partir des groupes existants (idempotent).

## Fichiers joints aux documents

Dans le formulaire de **sa propre fiche de lecture** (section « Document joint », à la création comme à la modification), l'étudiant peut joindre un **PDF, PNG ou JPEG** (le contenu fait foi, pas l'extension).

- **Stockage** : dossier Drive `Fichiers – lectures IFSI`, créé automatiquement, **privé** (aucun lien public). Les fichiers ne sont servis que par le script (`file_get`), après contrôle des droits ; l'identifiant Drive n'est jamais envoyé au navigateur.
- **Limites** : 5 Mo par fichier, **un seul fichier par document** (pour en changer, supprimer l'actuel puis en ajouter un autre). Volume à prévoir : jusqu'à 4 000 documents, soit au pire 20 Go (4 000 × 5 Mo) dans le Drive du propriétaire du script (le total est affiché dans l'administration).
- **Visibilité** : celle du document (promo) ; le tableau commun ne fait que consulter (📄 cliquable). Ajout uniquement par un étudiant qui a une fiche sur ce document (contrôlé côté serveur), suppression (donc remplacement) par **tout étudiant qui a une fiche sur ce document**, même si le fichier a été déposé par un autre, ou par l'administrateur ; supprimer un document supprime ses fichiers.
- **Droit d'auteur** : un avertissement (partage interne, but pédagogique) est affiché sous les fichiers et demandé à chaque ajout ; mentionné dans `privacy.html`.
- **Mise en route** : coller le nouveau `Code.gs`, lancer `setup` (crée la feuille `Fichiers`), **accepter la nouvelle autorisation Drive**, puis déployer une nouvelle version.

## Retours sur l'outil

Lien discret « 💡 Un retour sur l'outil ? » en bas de page, pour **toute personne dont l'accès est validé** (étudiants, formateurs, administrateur) : type (🐞 bug, 💡 idée d'amélioration, 💬 autre) et texte (2 000 caractères maximum).

- **Limite** : 2 retours par jour et par personne (jour calendaire, fuseau Europe/Paris). Un retour reste **modifiable le jour même** par son auteur ; modifier ne libère pas de place, et les retours des jours précédents ne sont plus modifiables.
- **Contexte joint automatiquement** à l'envoi : onglet affiché, taille de fenêtre, navigateur (utile pour reproduire un bug). Mentionné dans `privacy.html`.
- **Lecture** : l'administrateur les voit dans l'onglet Administration (plus récents d'abord, avec l'auteur). Chacun ne voit que ses retours du jour. Pour les exploiter plus tard : feuille `Feedback` du Sheet, avec une colonne `statut` (`nouveau` par défaut) à changer à la main (traité, refusé…).
- Mise en route : relancer `setup` (crée la feuille `Feedback`) et redéployer.

## Onglets et filtres selon la personne

- **Accueil** (page d'arrivée, pour tous) : résumé du jour — jalons en retard ou proches, votes à donner, commentaires non lus, mes lectures, nouveautés de la semaine, demandes d'accès pour l'administrateur. **Tableau de bord** : formateurs et administrateur seulement (voir plus bas).
- **Mes lectures** : étudiants seulement. **Suivi de projet** : toute personne ayant un groupe. **Administration** : l'administrateur, et les étudiants qui ont un groupe (jamais un formateur).
- Le choix **Mon groupe / Toute la promo** n'apparaît que sur le tableau commun, les commentaires, la bibliographie et la synthèse ; « Mes lectures », « Suivi de projet » et « Administration » concernent toujours le groupe.
- La recherche permet de filtrer par **groupe** quand plusieurs groupes sont visibles, et chaque document affiche, pour chaque personne qui l'a lu, son groupe.

## Pause ludique (easter egg)

Menu du compte (en haut à droite) → **🎮 Pause ludique** : *La course aux transmissions* (saut / se baisser) et *Flappy Seringue* (poches et potences à perfusion, gouttes à attraper pour +2, ECG en bas), dans une fenêtre. Code dans `games.js` (canvas, sans dépendance) ; avatar de la course au choix (femme, homme, neutre) et records conservés dans le navigateur. Accessible à toute personne connectée (étudiant, formateur, administrateur). Après une défaite, seul le bouton « Rejouer » relance une partie.

**🏥 Urgences** (ouvert à tous) : on joue l'infirmier·ère d'un service de 3, 6 ou 9 lits (choix en haut de la fenêtre ; plus il y a de lits, plus les arrivées sont rapides et les patients fragiles, et le service est déjà occupé au départ). Chaque lit est dessiné avec la tête du patient sur l'oreiller, une couverture qui vire du vert au rouge selon son état. Les patients arrivent (salle d'attente, 40 s de patience) et se dégradent : cliquez dessus pour découvrir leur besoin (ECG, oxygène, perfusion, antalgique, injection, pansement, transfusion, constantes), puis cliquez le bon soin du plateau (ou touches 1 à 8). Les cas critiques (douleur thoracique, hémorragie, abdomen aigu) passent par le **bloc opératoire** : un seul patient à la fois, 7 s d'opération, bouton **« Envoyer au bloc »** (ou touche B) quand c'est leur tour. Un mauvais soin fait perdre de la vie au patient ; un décès ou un départ de la salle d'attente coûte une des 3 vies. Le compteur « Soignés » est le score, avec un record par nombre de lits.

## Rattachement des formateurs aux groupes

Un formateur est lié à sa **promo** (inscrite à la validation de son accès) puis à un ou plusieurs **groupes** de cette promo, dans les deux sens :

- **Il demande** à rejoindre un groupe (panneau « sans groupe », ou « Mes groupes » dans la fenêtre d'un groupe) ;
- **Le groupe l'invite** : un étudiant du groupe propose un formateur de la promo (fenêtre du groupe → inviter un formateur).

Dans les deux cas, c'est un **vote des étudiants du groupe** (majorité simple, 7 jours, comme les autres votes) ; une fois adopté, le formateur est rattaché sans autre étape. Une demande refusée ne peut pas être refaite tout de suite. La demande peut être annulée.
L'administrateur garde le rattachement et le retrait directs. Il n'y a pas de bouton « quitter le groupe » : c'est l'administrateur qui retire.
Après mise à jour du script, lancer `setup` une fois : il inscrit à leur promo les formateurs déjà validés.

## File d'attente « À lire » et réservation

Une lecture a trois statuts : **✅ Terminée**, **📖 En cours** et **📌 À lire**. « À lire » est une file d'attente personnelle : seul le titre est exigé, avec une **priorité** (🔥 haute, normale, 💤 basse). Elle est visible du **groupe** (jamais de la promo tant qu'elle n'est pas terminée) : c'est la **réservation**, on voit qui prévoit de lire quoi.
- Dans « Mes lectures », une section « File d'attente » triée par priorité : priorité modifiable en place, **▶ Commencer** (passe en cours), puis **✅ Marquer terminée**.
- Sur un document déjà présent : bouton **📌 À lire** (le met dans sa file sans formulaire).
- Si on saisit un document déjà connu, l'outil indique qui l'a déjà (et à quel stade).
- Colonne `priorite` ajoutée à la feuille `Lectures` : relancer `setup` une fois.

## Historique des modifications et retour en arrière

Chaque modification de la **partie commune d'un article** et de **sa propre fiche de lecture** est journalisée (feuille `Historique`). Bouton **🕘 Historique** sur l'article et **🕘** sur sa fiche : qui, quand, et ce qui a changé (avant → après). **↩ Revenir à la version d'avant** repasse par les mêmes règles que la modification elle-même : pour une fiche, son auteur seulement ; pour un article, correction directe (administrateur, créateur isolé) ou proposition soumise au vote de la promo. Une restauration est elle-même journalisée, donc réversible. Les 30 dernières versions sont affichées.

## Tableau de bord (formateurs et administrateur)

Une carte par groupe (celle des groupes rattachés pour un formateur, tous pour l'administrateur) : étudiants, fiches terminées / en cours / à lire, avancement des jalons, jalons en retard, prochain jalon, **dernier commentaire**, dernière réunion. Bandeau rouge (jalon en retard) ou orangé (aucune activité depuis 14 jours), groupes en retard en premier. Boutons vers le suivi de projet et les lectures du groupe. Calculé sur les données déjà visibles de la personne : aucune information supplémentaire n'est exposée.

## Confort et esthétique

- **Vues** du tableau commun : Tableau, **Cartes** (couverture colorée selon le type d'article, avatars des lecteurs, jauge d'avancement de chaque fiche) et **☰ Liste** compacte (vue par défaut sur téléphone ; un clic déplie le document).
- Petite animation de confettis quand une lecture passe à « Terminée » (désactivée si le système demande de réduire les animations).
- Sur téléphone : onglets défilables, pas de vue tableau.

## Changer son nom affiché

Menu du compte → **✏️ Modifier mon nom** : chaque utilisateur (étudiant, formateur, administrateur) choisit le nom montré aux autres. Il est unique (casse ignorée), de 60 caractères maximum. L'ancien nom reste sur les traces déjà écrites (historique des modifications, anciens commentaires). Le nom de l'administrateur, qui n'est pas dans la feuille « Utilisateurs », est conservé dans la propriété de script `NOM_ADMIN`.

## Notes personnelles

Menu du compte (sous votre nom) → **📝 Mes notes** : un carnet **privé** — ni le groupe, ni les formateurs, ni l'administrateur ne peuvent le lire. Chaque note a un titre, une date, un texte libre et des **fiches de lecture liées** (recherche par titre, auteur ou mot-clé ; un clic sur une fiche liée ferme le carnet et ouvre la fiche dans le tableau commun, filtrée sur son titre). Les notes sont dans la feuille `Notes` (créée toute seule au premier usage ; filtrées sur l'adresse de la personne à chaque lecture et écriture, et absentes de toutes les autres réponses du serveur). Elles suivent un changement d'adresse mais restent dans le Sheet : l'administrateur du Sheet peut les voir en l'ouvrant directement dans Google Sheets.

Chaque note peut porter des **étiquettes** (filtre par `#étiquette` dans la liste) et être **épinglée** (📌, en tête de liste). Les documents qui ont des notes liées affichent une pastille **📝 n** (visible de vous seul) qui ouvre le carnet filtré sur ces notes. Le bouton ⬇️ du carnet exporte toutes vos notes en texte.

## Exports

- **Tableau commun** (menu « ⬇️ Exporter ») : Excel, CSV (séparateur `;`, ouvrable directement dans Excel français) et PDF, selon les filtres en cours.
- **Une fiche** : bouton « ⬇️ PDF » dans les actions de la fiche dépliée.
- **Bibliographie** (onglet 📖) : copier, Word, texte, impression, en APA 7.
- **Mes notes** : bouton ⬇️ dans le carnet.

## Test de bout en bout

`node apps-script/e2e.js <JETON>` (Node 18+) interroge l'Apps Script **réellement déployé** (URL lue dans `config.js`, ou passée en premier argument). Le jeton se copie depuis la page connectée : outils de développement → Application → Session Storage → `lydia_token` (il expire au bout d'environ une heure). Le script lit les données, crée / modifie / supprime une note personnelle `[e2e] …` sur votre compte et vérifie la forme des réponses ; il ne touche à aucune lecture ni aucun groupe.

## Chat de groupe et de promo

**Masqué par défaut** : pour l'activer, ajouter `CHAT_ACTIF: true,` dans `config.js` (le code et le serveur sont en place).

Bouton **💬 Chat** en bas à droite (replié par défaut, pastille rouge quand il y a des messages non lus), avec deux salons : **👥 Groupe** (membres du groupe et administrateur) et **🌐 Promo** (toute la promo du groupe affiché). Texte simple et smileys (sélecteur 😀). Entrée envoie, Maj+Entrée passe à la ligne ; chacun peut retirer ses messages, l'administrateur n'importe lequel.

Règles pour que la feuille `Chat` (créée au premier usage) ne grossisse pas, appliquées **par le serveur** (constantes `CHAT_*` en tête de la partie Chat de `Code.gs`) : **5 messages sur 2 minutes glissantes** par personne (tous salons confondus), **500 caractères** par message, **1000 messages** au plus par salon, **7 jours** de conservation. Le nettoyage se fait à chaque envoi. Le panneau ouvert se met à jour toutes les 15 s, replié toutes les 60 s (uniquement onglet visible) ; il n'affiche que les 100 derniers messages, avec un bouton pour remonter. Ce n'est pas une messagerie instantanée ni un espace confidentiel : le contenu est lisible dans le Sheet par son administrateur.

## Accueil

« 🆕 Cette semaine » indique le groupe de chaque fiche ; « 💬 Derniers commentaires » liste les quatre plus récents (non lus surlignés) et un clic ouvre la discussion dans le bon groupe.

## Tableau commun : lignes compactes

Une ligne de document ne montre que son titre (avec un petit 🔗 collé au titre quand il y a un lien), ses références et ses pastilles. Une fois la ligne **dépliée**, un bouton discret **⋯** apparaît : il ouvre les options du document (ajouter ma fiche, À lire, corriger l'article, historique) ; les fichiers joints ne s'affichent eux aussi qu'à ce moment-là (le nombre reste visible dans la pastille 📎).

## Organisation du code côté navigateur

L'ancien `app.js` (2 800 lignes) est découpé en scripts classiques dans `js/` : `core` (configuration, API, connexion), `menu`, `notes`, `suivi`, `lectures`, `tableau`, `accueil`, `historique`, `feedback`, `fichiers`, `lignes`, `commentaires`, `filtres`, `biblio`, `admin`, `exports`, `chat`, `onboarding`, `groupes`, `demarrage`. Ils partagent la même portée globale et se chargent **dans l'ordre déclaré dans `index.html`** (la liste est lue aussi par les tests). Pour ajouter un fichier : le créer dans `js/` et l'ajouter à cette liste, à sa place dans l'ordre.
