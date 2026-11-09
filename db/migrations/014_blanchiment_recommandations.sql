-- Recommandations envoyées par e-mail après un rendez-vous de blanchiment dentaire : une seule fois par rendez-vous.
-- Retour arrière : ALTER TABLE bookings DROP COLUMN aftercare_sent_at; puis DELETE FROM migrations WHERE name = '014_blanchiment_recommandations.sql';
ALTER TABLE bookings ADD COLUMN aftercare_sent_at timestamptz;
