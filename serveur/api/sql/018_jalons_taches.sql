-- Une tâche de compte rendu avec une échéance apparaît dans le calendrier : c'est un jalon de type « tâche », lié à la tâche.
-- Le jalon suit la tâche (titre, échéance, statut, personnes) et n'est pas modifiable directement.
ALTER TABLE jalons
  ADD COLUMN tache_id VARCHAR(36) NULL AFTER visio,
  ADD UNIQUE KEY uq_jalons_tache (tache_id),
  ADD CONSTRAINT fk_jalons_tache FOREIGN KEY (tache_id) REFERENCES taches (id) ON DELETE CASCADE;
