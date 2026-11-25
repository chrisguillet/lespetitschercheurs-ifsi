-- Carnet d'apprentissage : strictement individuel (jamais visible du groupe, des formateurs ni de l'administrateur de l'outil).
-- Une entrée par séance : ce qui a été vu par le groupe, la compréhension, l'apprentissage retenu, les interrogations,
-- l'axe de développement et le transfert envisagé. types : liste JSON de types d'apprentissage cochés.
CREATE TABLE carnet (
  id VARCHAR(36) NOT NULL,
  utilisateur_id BIGINT UNSIGNED NOT NULL,
  date VARCHAR(10) NOT NULL,
  vu MEDIUMTEXT NULL,
  comprehension MEDIUMTEXT NULL,
  apprentissage MEDIUMTEXT NULL,
  types TEXT NULL,
  interrogations MEDIUMTEXT NULL,
  axe MEDIUMTEXT NULL,
  transfert MEDIUMTEXT NULL,
  cree_le DATETIME NOT NULL,
  modifie_le DATETIME NULL,
  PRIMARY KEY (id),
  KEY ix_carnet_utilisateur (utilisateur_id, date),
  CONSTRAINT fk_carnet_utilisateur FOREIGN KEY (utilisateur_id) REFERENCES utilisateurs (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
