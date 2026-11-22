-- Auteurs d'une lecture : liste JSON [{nom, nation, qualite}]. Nationalités et métiers appartiennent à chaque auteur ;
-- auteur, nation et qualite de l'article en sont dérivés (filtres, export, référence APA).
ALTER TABLE articles
  ADD COLUMN auteurs TEXT NULL AFTER parution,
  MODIFY COLUMN qualite VARCHAR(300) NOT NULL DEFAULT '',
  MODIFY COLUMN nation VARCHAR(300) NOT NULL DEFAULT '';
UPDATE articles SET auteurs = CONCAT('[{"nom":', JSON_QUOTE(auteur), ',"nation":', JSON_QUOTE(nation), ',"qualite":', JSON_QUOTE(qualite), '}]')
  WHERE auteur IS NOT NULL AND auteur <> '';
