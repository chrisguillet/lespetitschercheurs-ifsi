-- Documents joints à une entrée du carnet d'apprentissage (3 au plus, photos comprises). Contenu dans le dossier privé du serveur ;
-- visibles de la seule personne qui tient le carnet. Supprimés avec l'entrée (le fichier sur disque l'est par le code).
CREATE TABLE carnet_fichiers (
  id VARCHAR(36) NOT NULL,
  carnet_id VARCHAR(36) NOT NULL,
  nom VARCHAR(255) NOT NULL,
  type VARCHAR(80) NOT NULL,
  taille INT UNSIGNED NOT NULL,
  chemin VARCHAR(255) NOT NULL,
  cree_le DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY ix_carnet_fichiers_carnet (carnet_id),
  CONSTRAINT fk_carnet_fichiers_carnet FOREIGN KEY (carnet_id) REFERENCES carnet (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
