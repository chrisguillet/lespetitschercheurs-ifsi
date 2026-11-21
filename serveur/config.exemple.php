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

    // Import de l'ancien Google Sheet (facultatif, pendant la transition). sheet_id : l'identifiant dans l'adresse du Sheet.
    // cle_json : le contenu complet du fichier JSON du compte de service, entre les deux marqueurs ci-dessous (nowdoc : rien à échapper).
    // Le Sheet et le dossier Drive des pièces jointes doivent être partagés en « lecteur » avec l'adresse client_email de cette clé.
    // 'import' => [
    //     'sheet_id' => 'IDENTIFIANT_DU_SHEET',
    //     'cle_json' => <<<'JSON'
    // COLLER ICI LE CONTENU DU FICHIER JSON
    // JSON,
    // ],

    // Traduction automatique des mots-clés (DeepL), facultative. Sans clé, seuls le glossaire de l'outil et le dictionnaire des
    // traductions déjà obtenues sont utilisés. Chaque traduction obtenue est mémorisée : un terme n'est envoyé qu'une fois.
    // 'deepl_cle' => 'VOTRE-CLE-DEEPL',                       // une clé de l'offre gratuite se termine par :fx
    // 'deepl_url' => 'https://api-free.deepl.com/v2/translate', // adresse de l'offre gratuite (défaut) ; offre payante : https://api.deepl.com/v2/translate
    // 'deepl_limite' => 45000,   // caractères envoyés par mois : à régler un peu sous le quota de votre offre (défaut 45000)

    // Purge des comptes inactifs depuis 12 mois (tâche de nuit). Tant que cette ligne est absente ou à false, la purge se contente
    // de compter (journal d'administration, action purge_inactifs). À activer seulement quand l'ancien outil est arrêté : tant que
    // l'import relit l'ancien Sheet, il recréerait les comptes retirés.
    // 'purge_auto' => true,

    // Clé du script de diagnostic (diagnostic/diag.php) : une longue chaîne au hasard. Supprimer le script après usage.
    'diagnostic_cle' => 'À REMPLIR AVEC UNE LONGUE CHAINE AU HASARD',
];
