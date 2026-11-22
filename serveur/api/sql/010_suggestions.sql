-- Suggestions de lecture : un formateur (ou un administrateur) propose un article à une promo, sans fiche de lecture.
-- La suggestion est visible de toute la promo ; les groupes « tagués » ne le sont que pour déclencher une alerte chez leurs membres (le tag n'est visible que de l'auteur et des administrateurs).

CREATE TABLE suggestions (
  id VARCHAR(36) NOT NULL,
  promo_id VARCHAR(36) NOT NULL,
  propose_par BIGINT UNSIGNED NULL,
  titre VARCHAR(500) NOT NULL,
  auteur VARCHAR(500) NOT NULL DEFAULT '',
  parution VARCHAR(20) NOT NULL DEFAULT '',
  type VARCHAR(80) NOT NULL DEFAULT '',
  source VARCHAR(500) NOT NULL DEFAULT '',
  doi VARCHAR(190) NOT NULL DEFAULT '',
  lien VARCHAR(500) NOT NULL DEFAULT '',
  note TEXT NULL,
  cree_le DATETIME NOT NULL,
  modifie_le DATETIME NULL,
  PRIMARY KEY (id),
  KEY ix_suggestions_promo (promo_id, cree_le),
  CONSTRAINT fk_suggestions_promo FOREIGN KEY (promo_id) REFERENCES promos (id) ON DELETE CASCADE,
  CONSTRAINT fk_suggestions_auteur FOREIGN KEY (propose_par) REFERENCES utilisateurs (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE suggestions_groupes (
  suggestion_id VARCHAR(36) NOT NULL,
  groupe_id VARCHAR(36) NOT NULL,
  PRIMARY KEY (suggestion_id, groupe_id),
  KEY ix_suggestions_groupes_groupe (groupe_id),
  CONSTRAINT fk_sg_suggestion FOREIGN KEY (suggestion_id) REFERENCES suggestions (id) ON DELETE CASCADE,
  CONSTRAINT fk_sg_groupe FOREIGN KEY (groupe_id) REFERENCES groupes (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE suggestions_vues (
  suggestion_id VARCHAR(36) NOT NULL,
  utilisateur_id BIGINT UNSIGNED NOT NULL,
  vue_le DATETIME NOT NULL,
  PRIMARY KEY (suggestion_id, utilisateur_id),
  KEY ix_suggestions_vues_utilisateur (utilisateur_id),
  CONSTRAINT fk_sv_suggestion FOREIGN KEY (suggestion_id) REFERENCES suggestions (id) ON DELETE CASCADE,
  CONSTRAINT fk_sv_utilisateur FOREIGN KEY (utilisateur_id) REFERENCES utilisateurs (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
