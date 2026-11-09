-- Retour arrière de 013, à lancer à la main puis : DELETE FROM migrations WHERE name = '013_suivi_seances.sql';
-- Dates de naissance, antécédents médicaux, zones et praticiennes notés sont perdus.
ALTER TABLE bookings DROP COLUMN IF EXISTS practitioner_id, DROP COLUMN IF EXISTS zone;
ALTER TABLE users DROP COLUMN IF EXISTS medical_history, DROP COLUMN IF EXISTS birth_date;
