-- Mentions (« tags ») : un étudiant signale à un camarade de son groupe un document ou une fiche de lecture, avec un mot facultatif.
-- La mention n'est visible que de son expéditeur et de son destinataire. article_id / analyse_id : cible facultative (le titre est recopié,
-- la mention reste lisible même si la fiche est ensuite supprimée). lue_le NULL : pas encore lue par le destinataire.
CREATE TABLE mentions (
  id VARCHAR(36) NOT NULL,
  de_id BIGINT UNSIGNED NOT NULL,
  a_id BIGINT UNSIGNED NOT NULL,
  article_id VARCHAR(36) NULL,
  analyse_id VARCHAR(36) NULL,
  titre VARCHAR(500) NOT NULL DEFAULT '',
  description TEXT NULL,
  cree_le DATETIME NOT NULL,
  lue_le DATETIME NULL,
  PRIMARY KEY (id),
  KEY ix_mentions_destinataire (a_id, lue_le, cree_le),
  KEY ix_mentions_expediteur (de_id, cree_le),
  CONSTRAINT fk_mentions_de FOREIGN KEY (de_id) REFERENCES utilisateurs (id) ON DELETE CASCADE,
  CONSTRAINT fk_mentions_a FOREIGN KEY (a_id) REFERENCES utilisateurs (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
