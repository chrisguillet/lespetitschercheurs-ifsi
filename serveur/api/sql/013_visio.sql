-- Lien de visioconférence d'une entrée du rétroplanning (réunion, tâche…), typiquement un lien Google Meet.
ALTER TABLE jalons ADD COLUMN visio VARCHAR(300) NOT NULL DEFAULT '' AFTER note;
