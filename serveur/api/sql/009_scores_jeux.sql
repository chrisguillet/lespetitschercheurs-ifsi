-- Meilleur score de chaque personne aux mini-jeux de la pause ludique, avec sa date.
-- Un enregistrement par personne, par jeu et par niveau de difficulté (niveau vide pour un jeu sans niveaux). Supprimé avec le compte.

CREATE TABLE scores_jeux (
  utilisateur_id BIGINT UNSIGNED NOT NULL,
  jeu VARCHAR(30) NOT NULL,
  niveau VARCHAR(12) NOT NULL DEFAULT '',
  score INT UNSIGNED NOT NULL,
  obtenu_le DATETIME NOT NULL,
  PRIMARY KEY (utilisateur_id, jeu, niveau),
  CONSTRAINT fk_scores_jeux_utilisateur FOREIGN KEY (utilisateur_id) REFERENCES utilisateurs (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
