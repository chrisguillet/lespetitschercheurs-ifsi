-- Lot B : le rôle demandé fait partie de la demande d'accès (étudiant ou formateur), pour que l'admin de promo ou de site
-- valide sans autre information. Les demandes déjà présentes sont des demandes d'étudiants.

ALTER TABLE demandes_acces
  ADD COLUMN role ENUM('etudiant','formateur') NOT NULL DEFAULT 'etudiant' AFTER promo_id;
