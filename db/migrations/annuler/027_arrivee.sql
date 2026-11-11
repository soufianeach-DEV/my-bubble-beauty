-- Retour arrière de 027, à lancer à la main puis : DELETE FROM migrations WHERE name = '027_arrivee.sql';
-- Les heures d'arrivée notées sont perdues ; les retards calculés restent dans late_minutes.
ALTER TABLE bookings DROP COLUMN IF EXISTS arrived_at;
