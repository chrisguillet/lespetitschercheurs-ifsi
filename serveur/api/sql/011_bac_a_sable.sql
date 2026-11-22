-- Bac à sable : un établissement et des comptes entièrement fictifs, pour tester l'application avec chaque rôle sans prendre le compte d'une vraie personne.
-- Les lignes marquées « test » n'apparaissent jamais aux vraies personnes (choix d'établissement à l'inscription, liste des accès, demandes en attente, purge automatique).

ALTER TABLE utilisateurs ADD COLUMN test TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE etablissements ADD COLUMN test TINYINT(1) NOT NULL DEFAULT 0;
