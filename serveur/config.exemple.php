<?php
// Modèle de configuration serveur. NE PAS REMPLIR ICI.
// 1. Copier ce fichier hors du dépôt (par exemple sur le Bureau) sous le nom config.php.
// 2. Le remplir, puis le déposer par SFTP dans  /qocot/_prive/lespetitschercheurs/config.php
//    (dossier voisin de la racine web : il n'est jamais servi par le site).
// 3. Ne jamais le commiter ni le coller dans une conversation : il contient des mots de passe.
// Évitez les guillemets, le \ et le $ dans les mots de passe : ils compliquent l'écriture de ce fichier.

return [
    // Identifiant client OAuth de Google : le même que GOOGLE_CLIENT_ID dans config.js (public).
    'google_client_id' => 'xxxxxxxx.apps.googleusercontent.com',

    // Adresse de l'administrateur : toujours active, rôle « admin » global, créée au besoin à la première connexion.
    'admin_email' => 'adresse@exemple.fr',
    'nom_admin' => 'Administrateur',

    // Origines autorisées à appeler l'API depuis un navigateur (CORS). Retirer GitHub Pages après la bascule.
    'origines' => [
        'https://lespetitschercheurs.qocot.eu',
        'https://chrisguillet.github.io',
    ],

    // Base principale (tronc commun) : valeurs affichées dans l'espace client IONOS, page de la base.
    'db_principale' => [
        'hote' => 'dbXXXXXXXXXX.hosting-data.io',
        'port' => 3306,
        'nom' => 'dbsXXXXXXXX',
        'utilisateur' => 'dbuXXXXXXX',
        'mot_de_passe' => 'À REMPLIR',
    ],

    // Base du chat (et de la présence) : seconde base, hôte différent.
    'db_chat' => [
        'hote' => 'dbXXXXXXXXXX.hosting-data.io',
        'port' => 3306,
        'nom' => 'dbsXXXXXXXX',
        'utilisateur' => 'dbuXXXXXXX',
        'mot_de_passe' => 'À REMPLIR',
    ],

    // Dossier privé (cache, pièces jointes, sauvegardes). Facultatif : par défaut, le dossier de ce fichier.
    // 'dossier_prive' => '/chemin/absolu',

    // Clé du script de diagnostic (diagnostic/diag.php) : une longue chaîne au hasard. Supprimer le script après usage.
    'diagnostic_cle' => 'À REMPLIR AVEC UNE LONGUE CHAINE AU HASARD',
];
