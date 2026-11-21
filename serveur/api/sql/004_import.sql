-- Import différentiel depuis l'ancien Google Sheet : une trace par ligne importée.
-- empreinte_source : empreinte de la ligne lue dans le Sheet ; empreinte_cible : empreinte de la ligne telle qu'écrite dans la base.
-- À l'import suivant, une ligne du Sheet modifiée n'est appliquée que si la ligne de la base n'a pas été retouchée depuis
-- (son empreinte est toujours empreinte_cible) : sinon c'est un conflit, signalé et laissé tel quel.

CREATE TABLE import_traces (
  entite VARCHAR(30) NOT NULL,
  source_id VARCHAR(190) NOT NULL,
  cible_id VARCHAR(80) NULL,
  empreinte_source CHAR(64) NOT NULL,
  empreinte_cible CHAR(64) NOT NULL,
  importe_le DATETIME NOT NULL,
  PRIMARY KEY (entite, source_id),
  KEY ix_import_traces_cible (entite, cible_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
