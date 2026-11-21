-- Dictionnaire des traductions déjà obtenues (mots-clés français -> anglais) : un terme n'est envoyé au service externe qu'une fois.
-- Suivi du nombre de caractères envoyés au service externe, par mois (UTC), pour rester sous son quota.

CREATE TABLE traductions (
  cle VARCHAR(190) NOT NULL,
  en VARCHAR(190) NOT NULL,
  niveau VARCHAR(10) NOT NULL,
  raison VARCHAR(200) NOT NULL DEFAULT '',
  cree_le DATETIME NOT NULL,
  PRIMARY KEY (cle)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE traduction_usage (
  mois CHAR(7) NOT NULL,
  caracteres INT UNSIGNED NOT NULL DEFAULT 0,
  bloque TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (mois)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
