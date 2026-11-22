-- Charte de fonctionnement d'un groupe : des règles (titre, description), rangées dans l'ordre choisi par le groupe.
CREATE TABLE regles (
  id VARCHAR(36) NOT NULL,
  groupe_id VARCHAR(36) NOT NULL,
  titre VARCHAR(200) NOT NULL,
  description TEXT NULL,
  ordre INT NOT NULL DEFAULT 0,
  cree_par BIGINT UNSIGNED NULL,
  cree_le DATETIME NOT NULL,
  modifie_le DATETIME NULL,
  modifie_par BIGINT UNSIGNED NULL,
  PRIMARY KEY (id),
  KEY ix_regles_groupe (groupe_id, ordre),
  CONSTRAINT fk_regles_groupe FOREIGN KEY (groupe_id) REFERENCES groupes (id) ON DELETE CASCADE,
  CONSTRAINT fk_regles_createur FOREIGN KEY (cree_par) REFERENCES utilisateurs (id) ON DELETE SET NULL,
  CONSTRAINT fk_regles_modifieur FOREIGN KEY (modifie_par) REFERENCES utilisateurs (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
