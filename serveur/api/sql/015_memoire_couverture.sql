-- Noms des auteurs (couverture du mémoire), saisis dans l'en-tête.
ALTER TABLE memoires ADD COLUMN auteurs VARCHAR(300) NOT NULL DEFAULT '' AFTER referent;
