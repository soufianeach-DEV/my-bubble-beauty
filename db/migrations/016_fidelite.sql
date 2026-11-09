-- Carte de fidélité : avantages appliqués à la caisse (remise après N séances, soin offert après M séances, qui remet la carte à zéro).
-- Les règles vivent dans settings (clé loyalty). Retour arrière : DROP TABLE loyalty_rewards; puis DELETE FROM migrations WHERE name = '016_fidelite.sql';
CREATE TABLE loyalty_rewards (
  id bigserial PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('discount', 'free')),
  -- Rendez-vous sur lequel l'avantage a été appliqué (remise portée dans bookings.discount_cents)
  booking_id bigint REFERENCES bookings ON DELETE SET NULL,
  percent int CHECK (percent BETWEEN 1 AND 100),
  amount_cents int NOT NULL CHECK (amount_cents >= 0),
  sessions int NOT NULL CHECK (sessions >= 0),
  actor_id bigint REFERENCES users ON DELETE SET NULL,
  used_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX loyalty_rewards_user_idx ON loyalty_rewards (user_id, used_at);
CREATE UNIQUE INDEX loyalty_rewards_booking_idx ON loyalty_rewards (booking_id) WHERE booking_id IS NOT NULL;
ALTER TABLE loyalty_rewards ENABLE ROW LEVEL SECURITY;
