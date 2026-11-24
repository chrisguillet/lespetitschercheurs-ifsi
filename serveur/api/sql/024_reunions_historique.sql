-- Comptes rendus : numéro de version (détecte une modification arrivée entre-temps) et historique des états écrasés.
-- Chaque enregistrement qui modifie un compte rendu range l'état précédent ici ; on garde les 25 derniers par compte rendu.
ALTER TABLE reunions ADD COLUMN version INT NOT NULL DEFAULT 1;

CREATE TABLE reunions_historique (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  reunion_id VARCHAR(36) NOT NULL,
  version INT NOT NULL,
  date DATE NULL,
  titre VARCHAR(200) NOT NULL DEFAULT '',
  participants TEXT NULL,
  objectifs TEXT NULL,
  vu TEXT NULL,
  attendu TEXT NULL,
  suite TEXT NULL,
  auteur_id BIGINT UNSIGNED NULL,
  ecrit_le DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY ix_reunions_historique (reunion_id, id),
  CONSTRAINT fk_reunions_historique_reunion FOREIGN KEY (reunion_id) REFERENCES reunions (id) ON DELETE CASCADE,
  CONSTRAINT fk_reunions_historique_auteur FOREIGN KEY (auteur_id) REFERENCES utilisateurs (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
