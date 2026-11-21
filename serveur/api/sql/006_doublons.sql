-- Fusion des doublons d'articles : les groupes d'articles que l'administration a jugés différents ne sont plus proposés.
-- cle : empreinte (SHA-1) de la liste triée des identifiants d'articles du groupe.

CREATE TABLE doublons_ignores (
  cle CHAR(40) NOT NULL,
  cree_le DATETIME NOT NULL,
  cree_par BIGINT UNSIGNED NULL,
  PRIMARY KEY (cle),
  CONSTRAINT fk_doublons_ignores_createur FOREIGN KEY (cree_par) REFERENCES utilisateurs (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
