-- Qui est en train de saisir quoi (compte rendu de réunion) : une ligne par personne et par élément, rafraîchie pendant la saisie.
-- Éphémère : seules les lignes des dernières secondes comptent, les autres sont effacées à l'écriture suivante. Base du chat (écritures fréquentes).
CREATE TABLE saisies (
  utilisateur_id BIGINT UNSIGNED NOT NULL,
  cible VARCHAR(80) NOT NULL,
  vu_le DATETIME NOT NULL,
  PRIMARY KEY (utilisateur_id, cible),
  KEY ix_saisies_cible (cible, vu_le)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
