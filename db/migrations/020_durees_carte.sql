-- Durées de la carte reprises au démarrage (syncServices) : on garde la main de la gérante.
-- duration_manual : durée saisie dans Admin > Prestations, jamais écrasée par la grille du site.
-- closed_by_admin : prestation mise hors ligne exprès, jamais rouverte au démarrage.
-- Avant cette migration, seule la gérante posait une durée (la graine n'en mettait aucune) : toute durée existante est donc manuelle,
-- et une prestation qui a une durée mais reste hors ligne a été fermée par elle.
-- Retour arrière : ALTER TABLE services DROP COLUMN duration_manual, DROP COLUMN closed_by_admin; puis retirer la ligne 020 de la table migrations.
ALTER TABLE services
  ADD COLUMN duration_manual boolean NOT NULL DEFAULT false,
  ADD COLUMN closed_by_admin boolean NOT NULL DEFAULT false;
UPDATE services SET duration_manual = true WHERE duration_min IS NOT NULL;
UPDATE services SET closed_by_admin = true WHERE duration_min IS NOT NULL AND NOT active;
