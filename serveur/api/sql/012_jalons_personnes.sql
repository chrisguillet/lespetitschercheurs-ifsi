-- Personnes assignées à un jalon du rétroplanning : une pastille de leur couleur apparaît sur l'entrée.
-- Supprimé avec l'entrée ou avec la personne. Une personne qui quitte le groupe n'apparaît plus (filtré à la lecture).

CREATE TABLE jalons_personnes (
  jalon_id VARCHAR(36) NOT NULL,
  utilisateur_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (jalon_id, utilisateur_id),
  KEY ix_jalons_personnes_utilisateur (utilisateur_id),
  CONSTRAINT fk_jp_jalon FOREIGN KEY (jalon_id) REFERENCES jalons (id) ON DELETE CASCADE,
  CONSTRAINT fk_jp_utilisateur FOREIGN KEY (utilisateur_id) REFERENCES utilisateurs (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
