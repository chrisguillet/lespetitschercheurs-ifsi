-- Pièces jointes d'un compte rendu (5 au plus, images réduites à l'envoi). Contenu sur le serveur, dossier privé ; chemin relatif.
CREATE TABLE reunions_fichiers (
  id VARCHAR(36) NOT NULL,
  reunion_id VARCHAR(36) NOT NULL,
  nom VARCHAR(255) NOT NULL,
  type VARCHAR(80) NOT NULL,
  taille INT UNSIGNED NOT NULL,
  chemin VARCHAR(255) NOT NULL,
  cree_par BIGINT UNSIGNED NULL,
  cree_le DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY ix_reunions_fichiers_reunion (reunion_id),
  CONSTRAINT fk_reunions_fichiers_reunion FOREIGN KEY (reunion_id) REFERENCES reunions (id) ON DELETE CASCADE,
  CONSTRAINT fk_reunions_fichiers_createur FOREIGN KEY (cree_par) REFERENCES utilisateurs (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tâches issues d'un compte rendu : remplacent « Étapes pour la suite ». Une tâche peut être confiée à plusieurs personnes du groupe.
CREATE TABLE taches (
  id VARCHAR(36) NOT NULL,
  groupe_id VARCHAR(36) NOT NULL,
  reunion_id VARCHAR(36) NOT NULL,
  texte VARCHAR(300) NOT NULL,
  fait TINYINT(1) NOT NULL DEFAULT 0,
  ordre INT UNSIGNED NOT NULL DEFAULT 0,
  cree_par BIGINT UNSIGNED NULL,
  cree_le DATETIME NOT NULL,
  modifie_le DATETIME NULL,
  modifie_par BIGINT UNSIGNED NULL,
  PRIMARY KEY (id),
  KEY ix_taches_groupe (groupe_id),
  KEY ix_taches_reunion (reunion_id),
  CONSTRAINT fk_taches_groupe FOREIGN KEY (groupe_id) REFERENCES groupes (id) ON DELETE CASCADE,
  CONSTRAINT fk_taches_reunion FOREIGN KEY (reunion_id) REFERENCES reunions (id) ON DELETE CASCADE,
  CONSTRAINT fk_taches_createur FOREIGN KEY (cree_par) REFERENCES utilisateurs (id) ON DELETE SET NULL,
  CONSTRAINT fk_taches_modifieur FOREIGN KEY (modifie_par) REFERENCES utilisateurs (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE taches_personnes (
  tache_id VARCHAR(36) NOT NULL,
  utilisateur_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (tache_id, utilisateur_id),
  CONSTRAINT fk_taches_personnes_tache FOREIGN KEY (tache_id) REFERENCES taches (id) ON DELETE CASCADE,
  CONSTRAINT fk_taches_personnes_utilisateur FOREIGN KEY (utilisateur_id) REFERENCES utilisateurs (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Liens d'un compte rendu (reunion_id) ou d'une de ses tâches (tache_id), avec la raison du lien.
-- cible_id pointe vers une fiche de lecture (analyses) ou un bloc du mémoire : vérifié à l'écriture, pas de clé étrangère.
CREATE TABLE liens (
  id VARCHAR(36) NOT NULL,
  groupe_id VARCHAR(36) NOT NULL,
  reunion_id VARCHAR(36) NOT NULL,
  tache_id VARCHAR(36) NULL,
  cible_type ENUM('fiche','bloc_memoire') NOT NULL,
  cible_id VARCHAR(36) NOT NULL,
  description VARCHAR(300) NOT NULL DEFAULT '',
  cree_par BIGINT UNSIGNED NULL,
  cree_le DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY ix_liens_groupe (groupe_id),
  KEY ix_liens_reunion (reunion_id),
  KEY ix_liens_tache (tache_id),
  CONSTRAINT fk_liens_groupe FOREIGN KEY (groupe_id) REFERENCES groupes (id) ON DELETE CASCADE,
  CONSTRAINT fk_liens_reunion FOREIGN KEY (reunion_id) REFERENCES reunions (id) ON DELETE CASCADE,
  CONSTRAINT fk_liens_tache FOREIGN KEY (tache_id) REFERENCES taches (id) ON DELETE CASCADE,
  CONSTRAINT fk_liens_createur FOREIGN KEY (cree_par) REFERENCES utilisateurs (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
