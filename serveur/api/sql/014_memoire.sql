-- Mémoire partagé par le groupe : un document par groupe, fait de blocs ordonnés (titres, paragraphes, citations, références APA).
CREATE TABLE memoires (
  groupe_id VARCHAR(36) NOT NULL,
  titre VARCHAR(200) NOT NULL DEFAULT '',
  ue VARCHAR(200) NOT NULL DEFAULT '',
  referent VARCHAR(120) NOT NULL DEFAULT '',
  date_rendu VARCHAR(10) NOT NULL DEFAULT '',
  modifie_le DATETIME NULL,
  modifie_par BIGINT UNSIGNED NULL,
  PRIMARY KEY (groupe_id),
  CONSTRAINT fk_memoires_groupe FOREIGN KEY (groupe_id) REFERENCES groupes (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE memoire_blocs (
  id VARCHAR(36) NOT NULL,
  groupe_id VARCHAR(36) NOT NULL,
  ordre INT UNSIGNED NOT NULL,
  type VARCHAR(20) NOT NULL,
  texte MEDIUMTEXT NULL,
  auteur_id BIGINT UNSIGNED NULL,
  modifie_le DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY ix_memoire_blocs_groupe (groupe_id, ordre),
  CONSTRAINT fk_memoire_blocs_groupe FOREIGN KEY (groupe_id) REFERENCES groupes (id) ON DELETE CASCADE,
  CONSTRAINT fk_memoire_blocs_auteur FOREIGN KEY (auteur_id) REFERENCES utilisateurs (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
