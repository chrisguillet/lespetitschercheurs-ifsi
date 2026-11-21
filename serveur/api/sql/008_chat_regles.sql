-- Activation du chat : une règle par portée. La plus précise l'emporte : groupe, puis promo, puis général. Sans règle, le chat est actif.
-- cible : identifiant du groupe ou de la promo ; vide pour la règle générale.

CREATE TABLE chat_regles (
  portee VARCHAR(10) NOT NULL,
  cible VARCHAR(36) NOT NULL DEFAULT '',
  actif TINYINT(1) NOT NULL,
  modifie_le DATETIME NOT NULL,
  modifie_par BIGINT UNSIGNED NULL,
  PRIMARY KEY (portee, cible)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
