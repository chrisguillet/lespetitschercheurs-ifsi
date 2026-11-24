-- Compte rendu de réunion : les objectifs de la réunion, avant « Ce qui a été vu ».
ALTER TABLE reunions ADD COLUMN objectifs TEXT NULL AFTER participants;
