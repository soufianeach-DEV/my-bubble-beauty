-- Comptes : suppression douce (30 jours pour réactiver), blocage par l'institut, consentement aux données de santé et notes de la fiche cliente.
ALTER TABLE users
  ADD COLUMN deleted_at timestamptz,
  ADD COLUMN blocked_at timestamptz,
  ADD COLUMN health_consent_at timestamptz,
  ADD COLUMN notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 4000);
CREATE INDEX users_deleted_idx ON users (deleted_at) WHERE deleted_at IS NOT NULL;

-- Temps de remise en état après le soin : compris dans ends_at, donc dans l'exclusion des chevauchements
ALTER TABLE services ADD COLUMN buffer_min int NOT NULL DEFAULT 0 CHECK (buffer_min BETWEEN 0 AND 120);

ALTER TABLE bookings
  -- Cliente absente à un rendez-vous confirmé et passé
  ADD COLUMN no_show boolean NOT NULL DEFAULT false,
  -- Compte effacé : user_id passe à NULL, la ligne ne doit pas passer pour une saisie de l'institut
  ADD COLUMN client_erased boolean NOT NULL DEFAULT false,
  ADD COLUMN cancel_reason text CHECK (cancel_reason IN ('client', 'admin', 'account_deleted')),
  -- Acompte rendu hors du site (virement, espèces) : refunded_cents est mis à jour à la main par l'admin
  ADD COLUMN refunded_manually_at timestamptz,
  ADD COLUMN reminder_sent_at timestamptz,
  ADD COLUMN moved_at timestamptz;
CREATE INDEX bookings_reminder_idx ON bookings (starts_at) WHERE status = 'confirmed' AND reminder_sent_at IS NULL;

-- Journal d'audit en base (12 mois, purgé par db/purge.mjs) ; stdout garde aussi chaque ligne
CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  action text NOT NULL CHECK (action ~ '^[a-z_]{1,60}$'),
  -- Qui agit (cliente ou admin) et sur quelle cliente ; SET NULL : effacer un compte n'efface pas la trace de l'action
  actor_id bigint REFERENCES users ON DELETE SET NULL,
  client_id bigint REFERENCES users ON DELETE SET NULL,
  booking_id bigint,
  ip text CHECK (char_length(ip) <= 64),
  details jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX audit_log_at_idx ON audit_log (at);
CREATE INDEX audit_log_client_idx ON audit_log (client_id, at) WHERE client_id IS NOT NULL;
CREATE INDEX audit_log_action_idx ON audit_log (action, at);
-- Même fermeture que 003 pour la nouvelle table (API REST de Supabase)
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
