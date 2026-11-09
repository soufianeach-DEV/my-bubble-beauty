-- Retour arrière de 011, à lancer à la main puis : DELETE FROM migrations WHERE name = '011_prestations_retirees.sql';
-- Les prestations retirées réapparaissent dans l'admin (toujours hors ligne).
ALTER TABLE services DROP COLUMN IF EXISTS retired_at;
