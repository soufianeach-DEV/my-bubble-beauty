-- Bons cadeaux créés depuis l'admin (Pour, Soin, Durée, Message), valables 12 mois comme l'annoncent les CGV,
-- utilisables à la réservation avec leur code. Retour arrière : db/migrations/annuler/015_bons_cadeaux.sql.
CREATE TABLE gift_cards (
  id bigserial PRIMARY KEY,
  code text NOT NULL UNIQUE CHECK (code ~ '^CADEAU-[A-Z0-9]{4}-[A-Z0-9]{4}$'),
  recipient text NOT NULL CHECK (char_length(recipient) BETWEEN 1 AND 100),
  -- Le soin offert : le bon ne vaut que pour cette prestation, à son prix du jour de la réservation
  service_id bigint NOT NULL REFERENCES services,
  duration_label text NOT NULL DEFAULT '' CHECK (char_length(duration_label) <= 40),
  message text NOT NULL DEFAULT '' CHECK (char_length(message) <= 300),
  issued_on date NOT NULL DEFAULT current_date,
  expires_on date NOT NULL,
  -- Réglé à l'institut sans réservation en ligne, ou noté utilisé à la caisse
  used_at timestamptz,
  cancelled_at timestamptz,
  created_by bigint REFERENCES users ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_on > issued_on)
);
ALTER TABLE gift_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ADD COLUMN gift_card_id bigint REFERENCES gift_cards ON DELETE SET NULL;
CREATE INDEX bookings_gift_idx ON bookings (gift_card_id) WHERE gift_card_id IS NOT NULL;
