-- Mesure d'audience sans cookie (db/visits.mjs) : une ligne par visiteur et par jour, empreinte anonyme, aucune IP.
-- Gardée 13 mois (db/purge.mjs) pour pouvoir afficher les 12 derniers mois et la période précédente.
CREATE TABLE site_visits (
  day date NOT NULL,
  visitor bytea NOT NULL CHECK (octet_length(visitor) = 16),
  views int NOT NULL DEFAULT 1 CHECK (views > 0),
  PRIMARY KEY (day, visitor)
);
