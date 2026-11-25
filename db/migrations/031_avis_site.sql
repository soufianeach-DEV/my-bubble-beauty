-- Avis déposé sur le site par une cliente connectée, après un rendez-vous honoré : note et texte.
-- La page de merci propose ensuite « Publier aussi sur Google » à toutes, quelle que soit la note (pas de tri des avis).
-- Retour arrière : db/migrations/annuler/031_avis_site.sql.
CREATE TABLE site_reviews (
  id bigserial PRIMARY KEY,
  -- CASCADE : effacer une cliente (RGPD art. 17) efface aussi son avis
  user_id bigint NOT NULL REFERENCES users ON DELETE CASCADE,
  booking_id bigint NOT NULL REFERENCES bookings ON DELETE CASCADE,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text NOT NULL CHECK (char_length(comment) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE site_reviews ENABLE ROW LEVEL SECURITY;
-- Un seul avis par rendez-vous : un double envoi n'en crée pas deux
CREATE UNIQUE INDEX site_reviews_booking_idx ON site_reviews (booking_id);
CREATE INDEX site_reviews_user_idx ON site_reviews (user_id);
