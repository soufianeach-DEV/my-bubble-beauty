-- Demande d'avis après la prestation (J+1, relance J+2, désinscription possible) et avis Google repris sur l'Accueil.
-- Retour arrière : db/migrations/annuler/026_avis_google.sql
-- Signaux qui évitent la relance : clic sur le lien suivi du mail, avis Google au nom de la cliente publié après le rendez-vous
ALTER TABLE bookings ADD COLUMN review_request_sent_at timestamptz, ADD COLUMN review_reminder_sent_at timestamptz,
  ADD COLUMN review_clicked_at timestamptz, ADD COLUMN review_found_at timestamptz, ADD COLUMN review_found_id text;
ALTER TABLE users ADD COLUMN review_mail_optout_at timestamptz;

-- Copie des avis de la fiche, lue par l'API Business Profile (accès propriétaire) ; un avis retiré chez Google disparaît ici au rafraîchissement suivant.
-- Ni photo ni lien de profil : le nom affiché chez Google, la note, le texte et la date.
CREATE TABLE google_reviews (
  review_id text PRIMARY KEY,
  author text NOT NULL,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE google_reviews ENABLE ROW LEVEL SECURITY;
CREATE INDEX google_reviews_recent_idx ON google_reviews (created_at DESC);
