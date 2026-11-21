-- Base principale (tronc commun) : MariaDB 11.x, portable vers MySQL 8.
-- Règles de portabilité : InnoDB, utf8mb4 avec une collation explicite (utf8mb4_unicode_ci, présente
-- partout), JSON stocké en TEXT, pas de colonne générée, pas de procédure stockée.
-- Dates en UTC (DATETIME), converties en ISO 8601 par l'API.
-- Les identifiants hérités du Sheet sont des UUID (VARCHAR(36)), conservés à l'import.
-- Chaque instruction se termine par un point-virgule en fin de ligne : bin/migrer.php découpe sur cette marque.

CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(40) NOT NULL,
  applique_le DATETIME NOT NULL,
  PRIMARY KEY (version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/* ---------- Structure : établissement (= site) > promo > groupe ---------- */

CREATE TABLE etablissements (
  id VARCHAR(36) NOT NULL,
  nom VARCHAR(120) NOT NULL,
  cree_le DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_etablissements_nom (nom)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE promos (
  id VARCHAR(36) NOT NULL,
  etablissement_id VARCHAR(36) NOT NULL,
  nom VARCHAR(120) NOT NULL,
  cree_le DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_promos_nom (etablissement_id, nom),
  CONSTRAINT fk_promos_etablissement FOREIGN KEY (etablissement_id) REFERENCES etablissements (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/* ---------- Personnes ---------- */

-- pid : identifiant public (12 caractères, dérivé de l'adresse) qui désigne une personne côté interface sans exposer son adresse.
-- prenom et nom : obligatoires et fixes (changement par demande validée, voir demandes_nom). pseudo : libre.
CREATE TABLE utilisateurs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  pid CHAR(12) NOT NULL,
  email VARCHAR(190) NOT NULL,
  prenom VARCHAR(60) NOT NULL DEFAULT '',
  nom VARCHAR(60) NOT NULL DEFAULT '',
  pseudo VARCHAR(60) NULL,
  couleur CHAR(7) NOT NULL DEFAULT '#888888',
  statut ENUM('en_attente','actif','refuse') NOT NULL DEFAULT 'en_attente',
  demande_le DATETIME NULL,
  derniere_connexion DATETIME NULL,
  consentement_le DATETIME NULL,
  consentement_version VARCHAR(20) NULL,
  invitation_id BIGINT UNSIGNED NULL,
  cree_le DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_utilisateurs_pid (pid),
  UNIQUE KEY uq_utilisateurs_email (email),
  KEY ix_utilisateurs_statut (statut)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE groupes (
  id VARCHAR(36) NOT NULL,
  promo_id VARCHAR(36) NOT NULL,
  nom VARCHAR(120) NOT NULL,
  cree_le DATETIME NOT NULL,
  cree_par BIGINT UNSIGNED NULL,
  quota_octets BIGINT UNSIGNED NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_groupes_nom (promo_id, nom),
  CONSTRAINT fk_groupes_promo FOREIGN KEY (promo_id) REFERENCES promos (id) ON DELETE CASCADE,
  CONSTRAINT fk_groupes_createur FOREIGN KEY (cree_par) REFERENCES utilisateurs (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE membres (
  groupe_id VARCHAR(36) NOT NULL,
  utilisateur_id BIGINT UNSIGNED NOT NULL,
  ajoute_le DATETIME NOT NULL,
  PRIMARY KEY (groupe_id, utilisateur_id),
  KEY ix_membres_utilisateur (utilisateur_id),
  CONSTRAINT fk_membres_groupe FOREIGN KEY (groupe_id) REFERENCES groupes (id) ON DELETE CASCADE,
  CONSTRAINT fk_membres_utilisateur FOREIGN KEY (utilisateur_id) REFERENCES utilisateurs (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/* ---------- Invitations et demandes ---------- */

-- Le jeton n'est jamais stocké en clair (SHA-256 hexadécimal). type 'personnel' : lié à une adresse (email) et à un rôle cible.
-- Cohérence validée par l'application : promo -> promo_id ; groupe -> groupe_id ; personnel -> email + (promo_id ou etablissement_id).
CREATE TABLE invitations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  jeton_hash CHAR(64) NOT NULL,
  type ENUM('promo','groupe','personnel') NOT NULL,
  role ENUM('etudiant','formateur') NOT NULL DEFAULT 'etudiant',
  etablissement_id VARCHAR(36) NULL,
  promo_id VARCHAR(36) NULL,
  groupe_id VARCHAR(36) NULL,
  email VARCHAR(190) NULL,
  cree_par BIGINT UNSIGNED NULL,
  cree_le DATETIME NOT NULL,
  expire_le DATETIME NOT NULL,
  max_usages INT UNSIGNED NOT NULL DEFAULT 1,
  usages INT UNSIGNED NOT NULL DEFAULT 0,
  revoque_le DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_invitations_jeton (jeton_hash),
  KEY ix_invitations_promo (promo_id),
  KEY ix_invitations_groupe (groupe_id),
  CONSTRAINT fk_invitations_etablissement FOREIGN KEY (etablissement_id) REFERENCES etablissements (id) ON DELETE CASCADE,
  CONSTRAINT fk_invitations_promo FOREIGN KEY (promo_id) REFERENCES promos (id) ON DELETE CASCADE,
  CONSTRAINT fk_invitations_groupe FOREIGN KEY (groupe_id) REFERENCES groupes (id) ON DELETE CASCADE,
  CONSTRAINT fk_invitations_createur FOREIGN KEY (cree_par) REFERENCES utilisateurs (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE utilisateurs
  ADD CONSTRAINT fk_utilisateurs_invitation FOREIGN KEY (invitation_id) REFERENCES invitations (id) ON DELETE SET NULL;

-- Rôles avec périmètre. Un compte peut cumuler plusieurs lignes.
--   admin       : global (aucun périmètre)
--   admin_site  : un établissement      formateur : un établissement
--   admin_promo : une promo             etudiant  : une promo
-- Hiérarchie : admin > admin_site > admin_promo (voir Droits.php). La cohérence rôle / périmètre est validée par
-- l'application (Attributions.php), pas par un CHECK : MySQL 8 refuse un CHECK sur des colonnes à clé étrangère en CASCADE.
-- L'unicité par périmètre est portée par deux index (les NULL ne se comparent pas) ; celle de la ligne « admin » globale
-- est vérifiée par l'application.
CREATE TABLE attributions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  utilisateur_id BIGINT UNSIGNED NOT NULL,
  role ENUM('admin','admin_site','admin_promo','formateur','etudiant') NOT NULL,
  etablissement_id VARCHAR(36) NULL,
  promo_id VARCHAR(36) NULL,
  origine ENUM('admin','invitation','demande','migration') NOT NULL DEFAULT 'admin',
  invitation_id BIGINT UNSIGNED NULL,
  cree_le DATETIME NOT NULL,
  cree_par BIGINT UNSIGNED NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_attributions_etablissement (utilisateur_id, role, etablissement_id),
  UNIQUE KEY uq_attributions_promo (utilisateur_id, role, promo_id),
  KEY ix_attributions_promo (promo_id),
  KEY ix_attributions_etablissement (etablissement_id),
  CONSTRAINT fk_attributions_utilisateur FOREIGN KEY (utilisateur_id) REFERENCES utilisateurs (id) ON DELETE CASCADE,
  CONSTRAINT fk_attributions_etablissement FOREIGN KEY (etablissement_id) REFERENCES etablissements (id) ON DELETE CASCADE,
  CONSTRAINT fk_attributions_promo FOREIGN KEY (promo_id) REFERENCES promos (id) ON DELETE CASCADE,
  CONSTRAINT fk_attributions_invitation FOREIGN KEY (invitation_id) REFERENCES invitations (id) ON DELETE SET NULL,
  CONSTRAINT fk_attributions_createur FOREIGN KEY (cree_par) REFERENCES utilisateurs (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Demande d'accès : établissement, promo, prénom et nom obligatoires, à valider par un admin de promo ou plus.
CREATE TABLE demandes_acces (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  utilisateur_id BIGINT UNSIGNED NOT NULL,
  etablissement_id VARCHAR(36) NOT NULL,
  promo_id VARCHAR(36) NOT NULL,
  prenom VARCHAR(60) NOT NULL,
  nom VARCHAR(60) NOT NULL,
  statut ENUM('en_attente','accepte','refuse') NOT NULL DEFAULT 'en_attente',
  cree_le DATETIME NOT NULL,
  traite_par BIGINT UNSIGNED NULL,
  traite_le DATETIME NULL,
  PRIMARY KEY (id),
  KEY ix_demandes_acces_promo (promo_id, statut),
  KEY ix_demandes_acces_utilisateur (utilisateur_id),
  CONSTRAINT fk_demandes_acces_utilisateur FOREIGN KEY (utilisateur_id) REFERENCES utilisateurs (id) ON DELETE CASCADE,
  CONSTRAINT fk_demandes_acces_etablissement FOREIGN KEY (etablissement_id) REFERENCES etablissements (id) ON DELETE CASCADE,
  CONSTRAINT fk_demandes_acces_promo FOREIGN KEY (promo_id) REFERENCES promos (id) ON DELETE CASCADE,
  CONSTRAINT fk_demandes_acces_traitant FOREIGN KEY (traite_par) REFERENCES utilisateurs (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Changement de prénom et nom : sur demande, validé par un admin de promo ou plus. Le pseudo se change librement.
CREATE TABLE demandes_nom (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  utilisateur_id BIGINT UNSIGNED NOT NULL,
  prenom VARCHAR(60) NOT NULL,
  nom VARCHAR(60) NOT NULL,
  statut ENUM('en_attente','accepte','refuse') NOT NULL DEFAULT 'en_attente',
  cree_le DATETIME NOT NULL,
  traite_par BIGINT UNSIGNED NULL,
  traite_le DATETIME NULL,
  PRIMARY KEY (id),
  KEY ix_demandes_nom_utilisateur (utilisateur_id, statut),
  CONSTRAINT fk_demandes_nom_utilisateur FOREIGN KEY (utilisateur_id) REFERENCES utilisateurs (id) ON DELETE CASCADE,
  CONSTRAINT fk_demandes_nom_traitant FOREIGN KEY (traite_par) REFERENCES utilisateurs (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Essais de jeton d'invitation par personne (limite d'essais sur une fenêtre de temps).
CREATE TABLE essais_invitation (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  utilisateur_id BIGINT UNSIGNED NOT NULL,
  essaye_le DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY ix_essais_invitation (utilisateur_id, essaye_le),
  CONSTRAINT fk_essais_invitation_utilisateur FOREIGN KEY (utilisateur_id) REFERENCES utilisateurs (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/* ---------- Votes de groupe ---------- */

-- type : adhesion, formateur_demande, formateur_invite, retrait, nom. statut : ouvert, adopte, refuse, expire, annule.
CREATE TABLE votes (
  id VARCHAR(36) NOT NULL,
  groupe_id VARCHAR(36) NOT NULL,
  type VARCHAR(30) NOT NULL,
  cible_id BIGINT UNSIGNED NULL,
  valeur VARCHAR(190) NULL,
  propose_par BIGINT UNSIGNED NULL,
  cree_le DATETIME NOT NULL,
  statut VARCHAR(20) NOT NULL DEFAULT 'ouvert',
  clos_le DATETIME NULL,
  PRIMARY KEY (id),
  KEY ix_votes_groupe (groupe_id, statut),
  CONSTRAINT fk_votes_groupe FOREIGN KEY (groupe_id) REFERENCES groupes (id) ON DELETE CASCADE,
  CONSTRAINT fk_votes_cible FOREIGN KEY (cible_id) REFERENCES utilisateurs (id) ON DELETE SET NULL,
  CONSTRAINT fk_votes_proposant FOREIGN KEY (propose_par) REFERENCES utilisateurs (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE vote_reponses (
  vote_id VARCHAR(36) NOT NULL,
  utilisateur_id BIGINT UNSIGNED NOT NULL,
  oui TINYINT(1) NOT NULL,
  repondu_le DATETIME NOT NULL,
  PRIMARY KEY (vote_id, utilisateur_id),
  CONSTRAINT fk_vote_reponses_vote FOREIGN KEY (vote_id) REFERENCES votes (id) ON DELETE CASCADE,
  CONSTRAINT fk_vote_reponses_utilisateur FOREIGN KEY (utilisateur_id) REFERENCES utilisateurs (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/* ---------- Lectures : article (partie objective) et analyses (une par personne) ---------- */

-- groupe_id peut devenir NULL si le groupe est supprimé : l'article reste (base de partage durable).
CREATE TABLE articles (
  id VARCHAR(36) NOT NULL,
  cree_par BIGINT UNSIGNED NULL,
  groupe_id VARCHAR(36) NULL,
  ajoute DATETIME NOT NULL,
  modifie_le DATETIME NULL,
  modifie_par BIGINT UNSIGNED NULL,
  titre VARCHAR(500) NOT NULL DEFAULT '',
  parution VARCHAR(20) NOT NULL DEFAULT '',
  auteur TEXT NULL,
  qualite VARCHAR(80) NOT NULL DEFAULT '',
  nation VARCHAR(80) NOT NULL DEFAULT '',
  type VARCHAR(80) NOT NULL DEFAULT '',
  source VARCHAR(500) NOT NULL DEFAULT '',
  volume VARCHAR(40) NOT NULL DEFAULT '',
  numero VARCHAR(40) NOT NULL DEFAULT '',
  pages VARCHAR(40) NOT NULL DEFAULT '',
  doi VARCHAR(190) NOT NULL DEFAULT '',
  lien TEXT NULL,
  PRIMARY KEY (id),
  KEY ix_articles_groupe (groupe_id),
  KEY ix_articles_doi (doi),
  CONSTRAINT fk_articles_createur FOREIGN KEY (cree_par) REFERENCES utilisateurs (id) ON DELETE SET NULL,
  CONSTRAINT fk_articles_modifieur FOREIGN KEY (modifie_par) REFERENCES utilisateurs (id) ON DELETE SET NULL,
  CONSTRAINT fk_articles_groupe FOREIGN KEY (groupe_id) REFERENCES groupes (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- portee : qui peut lire l'analyse. Aujourd'hui « groupe » (en cours) ou « promo » (terminée) ; « etablissement » et « tout »
-- sont prévus pour le partage entre promos et établissements, désactivé tant que RGPD et droit d'auteur ne sont pas tranchés.
CREATE TABLE analyses (
  id VARCHAR(36) NOT NULL,
  article_id VARCHAR(36) NOT NULL,
  utilisateur_id BIGINT UNSIGNED NULL,
  groupe_id VARCHAR(36) NULL,
  statut ENUM('Terminée','En cours','À lire') NOT NULL DEFAULT 'À lire',
  priorite ENUM('haute','normale','basse') NOT NULL DEFAULT 'normale',
  mots TEXT NULL,
  kw TEXT NULL,
  concepts TEXT NULL,
  objet TEXT NULL,
  opinion TEXT NULL,
  controverse TEXT NULL,
  libre TEXT NULL,
  portee ENUM('groupe','promo','etablissement','tout') NOT NULL DEFAULT 'groupe',
  ajoute DATETIME NOT NULL,
  modifie_le DATETIME NULL,
  modifie_par BIGINT UNSIGNED NULL,
  PRIMARY KEY (id),
  KEY ix_analyses_article (article_id),
  KEY ix_analyses_utilisateur (utilisateur_id),
  KEY ix_analyses_groupe (groupe_id),
  CONSTRAINT fk_analyses_article FOREIGN KEY (article_id) REFERENCES articles (id) ON DELETE CASCADE,
  CONSTRAINT fk_analyses_utilisateur FOREIGN KEY (utilisateur_id) REFERENCES utilisateurs (id) ON DELETE SET NULL,
  CONSTRAINT fk_analyses_groupe FOREIGN KEY (groupe_id) REFERENCES groupes (id) ON DELETE SET NULL,
  CONSTRAINT fk_analyses_modifieur FOREIGN KEY (modifie_par) REFERENCES utilisateurs (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Correction de la partie objective, appliquée à 3 approbations (voir PROP_SEUIL dans l'ancien Code.gs).
CREATE TABLE propositions (
  id VARCHAR(36) NOT NULL,
  article_id VARCHAR(36) NOT NULL,
  propose_par BIGINT UNSIGNED NULL,
  cree_le DATETIME NOT NULL,
  valeurs TEXT NOT NULL,
  statut VARCHAR(20) NOT NULL DEFAULT 'ouvert',
  clos_le DATETIME NULL,
  PRIMARY KEY (id),
  KEY ix_propositions_article (article_id, statut),
  CONSTRAINT fk_propositions_article FOREIGN KEY (article_id) REFERENCES articles (id) ON DELETE CASCADE,
  CONSTRAINT fk_propositions_proposant FOREIGN KEY (propose_par) REFERENCES utilisateurs (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE proposition_votes (
  proposition_id VARCHAR(36) NOT NULL,
  utilisateur_id BIGINT UNSIGNED NOT NULL,
  oui TINYINT(1) NOT NULL,
  vote_le DATETIME NOT NULL,
  PRIMARY KEY (proposition_id, utilisateur_id),
  CONSTRAINT fk_proposition_votes_proposition FOREIGN KEY (proposition_id) REFERENCES propositions (id) ON DELETE CASCADE,
  CONSTRAINT fk_proposition_votes_utilisateur FOREIGN KEY (utilisateur_id) REFERENCES utilisateurs (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE commentaires (
  id VARCHAR(36) NOT NULL,
  analyse_id VARCHAR(36) NOT NULL,
  auteur_id BIGINT UNSIGNED NULL,
  texte TEXT NOT NULL,
  cree_le DATETIME NOT NULL,
  modifie_le DATETIME NULL,
  portee ENUM('groupe','promo') NOT NULL DEFAULT 'groupe',
  groupe_id VARCHAR(36) NULL,
  PRIMARY KEY (id),
  KEY ix_commentaires_analyse (analyse_id),
  CONSTRAINT fk_commentaires_analyse FOREIGN KEY (analyse_id) REFERENCES analyses (id) ON DELETE CASCADE,
  CONSTRAINT fk_commentaires_auteur FOREIGN KEY (auteur_id) REFERENCES utilisateurs (id) ON DELETE SET NULL,
  CONSTRAINT fk_commentaires_groupe FOREIGN KEY (groupe_id) REFERENCES groupes (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE commentaires_lus (
  utilisateur_id BIGINT UNSIGNED NOT NULL,
  commentaire_id VARCHAR(36) NOT NULL,
  PRIMARY KEY (utilisateur_id, commentaire_id),
  CONSTRAINT fk_commentaires_lus_utilisateur FOREIGN KEY (utilisateur_id) REFERENCES utilisateurs (id) ON DELETE CASCADE,
  CONSTRAINT fk_commentaires_lus_commentaire FOREIGN KEY (commentaire_id) REFERENCES commentaires (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Pièce jointe d'un article : le contenu est sur le serveur (dossier privé, hors web), jamais public. chemin est relatif à ce dossier.
CREATE TABLE fichiers (
  id VARCHAR(36) NOT NULL,
  article_id VARCHAR(36) NOT NULL,
  nom VARCHAR(255) NOT NULL,
  type VARCHAR(80) NOT NULL,
  taille INT UNSIGNED NOT NULL,
  chemin VARCHAR(255) NOT NULL,
  cree_par BIGINT UNSIGNED NULL,
  cree_le DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY ix_fichiers_article (article_id),
  CONSTRAINT fk_fichiers_article FOREIGN KEY (article_id) REFERENCES articles (id) ON DELETE CASCADE,
  CONSTRAINT fk_fichiers_createur FOREIGN KEY (cree_par) REFERENCES utilisateurs (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- cible : 'article' ou 'analyse' ; avant : état précédent en JSON (texte).
CREATE TABLE historique (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  cible ENUM('article','analyse') NOT NULL,
  cible_id VARCHAR(36) NOT NULL,
  modifie_par BIGINT UNSIGNED NULL,
  proprietaire BIGINT UNSIGNED NULL,
  avant MEDIUMTEXT NOT NULL,
  modifie_le DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY ix_historique_cible (cible, cible_id),
  CONSTRAINT fk_historique_modifieur FOREIGN KEY (modifie_par) REFERENCES utilisateurs (id) ON DELETE SET NULL,
  CONSTRAINT fk_historique_proprietaire FOREIGN KEY (proprietaire) REFERENCES utilisateurs (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/* ---------- Groupe : suivi de projet, glossaire ---------- */

CREATE TABLE reunions (
  id VARCHAR(36) NOT NULL,
  groupe_id VARCHAR(36) NOT NULL,
  date DATE NULL,
  titre VARCHAR(200) NOT NULL DEFAULT '',
  participants TEXT NULL,
  vu TEXT NULL,
  attendu TEXT NULL,
  suite TEXT NULL,
  cree_par BIGINT UNSIGNED NULL,
  cree_le DATETIME NOT NULL,
  modifie_le DATETIME NULL,
  modifie_par BIGINT UNSIGNED NULL,
  PRIMARY KEY (id),
  KEY ix_reunions_groupe (groupe_id),
  CONSTRAINT fk_reunions_groupe FOREIGN KEY (groupe_id) REFERENCES groupes (id) ON DELETE CASCADE,
  CONSTRAINT fk_reunions_createur FOREIGN KEY (cree_par) REFERENCES utilisateurs (id) ON DELETE SET NULL,
  CONSTRAINT fk_reunions_modifieur FOREIGN KEY (modifie_par) REFERENCES utilisateurs (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- echeance : date fixe, ou date de fin d'une plage (debut renseigné). alerte_jours : jours avant la première date (NULL = pas d'alerte).
CREATE TABLE jalons (
  id VARCHAR(36) NOT NULL,
  groupe_id VARCHAR(36) NOT NULL,
  titre VARCHAR(200) NOT NULL DEFAULT '',
  debut DATE NULL,
  echeance DATE NULL,
  statut ENUM('a_faire','en_cours','fait') NOT NULL DEFAULT 'a_faire',
  note TEXT NULL,
  alerte_jours SMALLINT UNSIGNED NULL,
  cree_par BIGINT UNSIGNED NULL,
  cree_le DATETIME NOT NULL,
  modifie_le DATETIME NULL,
  modifie_par BIGINT UNSIGNED NULL,
  PRIMARY KEY (id),
  KEY ix_jalons_groupe (groupe_id),
  CONSTRAINT fk_jalons_groupe FOREIGN KEY (groupe_id) REFERENCES groupes (id) ON DELETE CASCADE,
  CONSTRAINT fk_jalons_createur FOREIGN KEY (cree_par) REFERENCES utilisateurs (id) ON DELETE SET NULL,
  CONSTRAINT fk_jalons_modifieur FOREIGN KEY (modifie_par) REFERENCES utilisateurs (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE glossaire (
  id VARCHAR(36) NOT NULL,
  groupe_id VARCHAR(36) NOT NULL,
  mot VARCHAR(200) NOT NULL,
  definition TEXT NULL,
  reference TEXT NULL,
  cree_par BIGINT UNSIGNED NULL,
  cree_le DATETIME NOT NULL,
  modifie_le DATETIME NULL,
  modifie_par BIGINT UNSIGNED NULL,
  PRIMARY KEY (id),
  KEY ix_glossaire_groupe (groupe_id),
  CONSTRAINT fk_glossaire_groupe FOREIGN KEY (groupe_id) REFERENCES groupes (id) ON DELETE CASCADE,
  CONSTRAINT fk_glossaire_createur FOREIGN KEY (cree_par) REFERENCES utilisateurs (id) ON DELETE SET NULL,
  CONSTRAINT fk_glossaire_modifieur FOREIGN KEY (modifie_par) REFERENCES utilisateurs (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/* ---------- Personnel : notes privées, retours sur l'outil ---------- */

-- liens et etiquettes : listes JSON stockées en texte.
CREATE TABLE notes (
  id VARCHAR(36) NOT NULL,
  utilisateur_id BIGINT UNSIGNED NOT NULL,
  titre VARCHAR(120) NOT NULL DEFAULT '',
  date VARCHAR(10) NOT NULL DEFAULT '',
  texte MEDIUMTEXT NULL,
  liens TEXT NULL,
  etiquettes TEXT NULL,
  epingle TINYINT(1) NOT NULL DEFAULT 0,
  cree_le DATETIME NOT NULL,
  modifie_le DATETIME NULL,
  PRIMARY KEY (id),
  KEY ix_notes_utilisateur (utilisateur_id),
  CONSTRAINT fk_notes_utilisateur FOREIGN KEY (utilisateur_id) REFERENCES utilisateurs (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE feedback (
  id VARCHAR(36) NOT NULL,
  auteur_id BIGINT UNSIGNED NULL,
  type ENUM('bug','idee','autre') NOT NULL,
  texte TEXT NOT NULL,
  contexte VARCHAR(500) NOT NULL DEFAULT '',
  jour DATE NOT NULL,
  cree_le DATETIME NOT NULL,
  modifie_le DATETIME NULL,
  statut VARCHAR(20) NOT NULL DEFAULT 'nouveau',
  PRIMARY KEY (id),
  KEY ix_feedback_auteur (auteur_id, jour),
  CONSTRAINT fk_feedback_auteur FOREIGN KEY (auteur_id) REFERENCES utilisateurs (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/* ---------- Journal d'administration (traçabilité RGPD) ---------- */

CREATE TABLE journal_admin (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  acteur_id BIGINT UNSIGNED NULL,
  action VARCHAR(40) NOT NULL,
  cible VARCHAR(80) NULL,
  detail TEXT NULL,
  cree_le DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY ix_journal_admin_date (cree_le),
  CONSTRAINT fk_journal_admin_acteur FOREIGN KEY (acteur_id) REFERENCES utilisateurs (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
