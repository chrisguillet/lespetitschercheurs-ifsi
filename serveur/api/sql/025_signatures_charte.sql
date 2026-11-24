-- Signatures électroniques de la charte de fonctionnement : une par membre et par cible (une règle, ou la charte entière).
-- L'empreinte (SHA-256) est celle du texte signé ; si le texte change, elle ne correspond plus à celle d'aujourd'hui et la
-- signature est périmée. Le texte signé est conservé pour pouvoir montrer ce qui avait été signé.
CREATE TABLE signatures_charte (
  groupe_id VARCHAR(36) NOT NULL,
  utilisateur_id BIGINT UNSIGNED NOT NULL,
  cible VARCHAR(36) NOT NULL,            -- identifiant de la règle, ou « charte » pour la charte entière
  empreinte CHAR(64) NOT NULL,
  texte MEDIUMTEXT NOT NULL,
  signe_le DATETIME NOT NULL,
  PRIMARY KEY (groupe_id, utilisateur_id, cible),
  KEY ix_signatures_utilisateur (utilisateur_id),
  CONSTRAINT fk_signatures_groupe FOREIGN KEY (groupe_id) REFERENCES groupes (id) ON DELETE CASCADE,
  CONSTRAINT fk_signatures_utilisateur FOREIGN KEY (utilisateur_id) REFERENCES utilisateurs (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
