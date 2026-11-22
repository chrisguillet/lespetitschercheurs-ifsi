-- Une entrée du glossaire est une définition ou une citation. Une citation porte ses champs APA (la référence est recalculée à l'affichage).
ALTER TABLE glossaire
  ADD COLUMN type VARCHAR(12) NOT NULL DEFAULT 'definition' AFTER definition,
  ADD COLUMN auteur VARCHAR(300) NOT NULL DEFAULT '' AFTER type,
  ADD COLUMN annee VARCHAR(20) NOT NULL DEFAULT '' AFTER auteur,
  ADD COLUMN titre_source VARCHAR(300) NOT NULL DEFAULT '' AFTER annee,
  ADD COLUMN editeur VARCHAR(200) NOT NULL DEFAULT '' AFTER titre_source,
  ADD COLUMN page VARCHAR(40) NOT NULL DEFAULT '' AFTER editeur,
  ADD COLUMN lien VARCHAR(300) NOT NULL DEFAULT '' AFTER page;
