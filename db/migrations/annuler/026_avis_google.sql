-- Retour arrière de 026, à lancer à la main puis : DELETE FROM migrations WHERE name = '026_avis_google.sql';
-- Les désinscriptions au mail d'avis sont perdues.
DROP TABLE IF EXISTS google_reviews;
DELETE FROM settings WHERE key = 'google_reviews';
ALTER TABLE users DROP COLUMN IF EXISTS review_mail_optout_at;
ALTER TABLE bookings DROP COLUMN IF EXISTS review_request_sent_at;
