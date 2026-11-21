-- Base du chat : séparée du tronc commun pour que les écritures fréquentes (messages, présence)
-- ne pèsent pas sur le reste. Aucune clé étrangère vers la base principale (bases distinctes) :
-- les personnes sont désignées par leur identifiant numérique, et le nom affiché est recopié dans le message.
-- Même règles de portabilité que 001_principal.sql.

CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(40) NOT NULL,
  applique_le DATETIME NOT NULL,
  PRIMARY KEY (version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- canal : « g:<id du groupe> » ou « p:<id de la promo> ». Les anciens messages (7 jours) ne sont pas repris à la bascule.
CREATE TABLE chat_messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  canal VARCHAR(80) NOT NULL,
  auteur_id BIGINT UNSIGNED NOT NULL,
  auteur_nom VARCHAR(80) NOT NULL,
  cree_le DATETIME NOT NULL,
  texte VARCHAR(500) NOT NULL,
  PRIMARY KEY (id),
  KEY ix_chat_canal (canal, id),
  KEY ix_chat_auteur (auteur_id, cree_le),
  KEY ix_chat_date (cree_le)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Qui est en ligne : une ligne par personne, mise à jour à chaque requête, purgée par cron.
CREATE TABLE presence (
  utilisateur_id BIGINT UNSIGNED NOT NULL,
  vu_le DATETIME NOT NULL,
  PRIMARY KEY (utilisateur_id),
  KEY ix_presence_date (vu_le)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
