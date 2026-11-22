-- Pied de page du mémoire, saisi par le groupe : vide = pied par défaut (établissement, promo, UE, titre, auteurs, date).
ALTER TABLE memoires ADD COLUMN pied VARCHAR(300) NOT NULL DEFAULT '' AFTER auteurs;
