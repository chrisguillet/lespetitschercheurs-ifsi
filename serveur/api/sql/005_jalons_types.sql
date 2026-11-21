-- Rétroplanning : chaque entrée a un type (tâche, réunion, rappel, évènement, échéance) et une heure facultative.
-- Les jalons déjà présents (anciens ou importés) sont des échéances.

ALTER TABLE jalons
  ADD COLUMN type VARCHAR(20) NOT NULL DEFAULT 'echeance' AFTER titre,
  ADD COLUMN heure CHAR(5) NULL AFTER echeance;
