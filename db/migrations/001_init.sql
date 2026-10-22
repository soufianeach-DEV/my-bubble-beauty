-- Schéma initial de la réservation : une seule praticienne, heures stockées en timestamptz, affichées à Bruxelles.

CREATE TABLE users (
  id bigserial PRIMARY KEY,
  -- Toujours en minuscules : l'unicité ne dépend pas de la casse saisie
  email text NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash text NOT NULL,
  name text,
  phone text,
  -- Langue des e-mails envoyés hors requête (webhook, annulation par l'admin)
  locale text NOT NULL DEFAULT 'fr' CHECK (locale IN ('fr', 'nl', 'en')),
  email_verified_at timestamptz,
  -- Dernier pas TOTP accepté (admin) : un code déjà utilisé ne passe plus
  totp_last_step bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Seul le SHA-256 du jeton est stocké : une fuite de la base ne donne aucune session
CREATE TABLE sessions (
  token_hash bytea PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users ON DELETE CASCADE,
  user_agent text NOT NULL DEFAULT '',
  -- Code TOTP validé dans cette session (exigé par /admin)
  mfa_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE email_tokens (
  token_hash bytea PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('verify', 'reset')),
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);
CREATE INDEX email_tokens_user_idx ON email_tokens (user_id);

CREATE TABLE services (
  id bigserial PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  -- Mêmes clés que les filtres des tarifs du site
  category text NOT NULL CHECK (category IN ('visage', 'corps', 'epilation', 'sourire', 'regard', 'mains')),
  name_fr text NOT NULL,
  name_nl text NOT NULL,
  name_en text NOT NULL,
  duration_min int CHECK (duration_min > 0),
  price_cents int NOT NULL CHECK (price_cents >= 0),
  deposit_cents int NOT NULL DEFAULT 0 CHECK (deposit_cents >= 0),
  active boolean NOT NULL DEFAULT false,
  sort int NOT NULL DEFAULT 0,
  -- Une prestation sans durée saisie ne peut pas être ouverte à la réservation
  CHECK (NOT active OR duration_min IS NOT NULL)
);

-- Plusieurs plages par jour possibles ; aucun jour = fermé
CREATE TABLE opening_hours (
  id bigserial PRIMARY KEY,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  opens time NOT NULL,
  closes time NOT NULL,
  -- Une plage inversée ferait échouer le calcul des créneaux de tout ce jour de semaine
  CHECK (opens < closes)
);
CREATE INDEX opening_hours_weekday_idx ON opening_hours (weekday);

-- Congés et créneaux bloqués
CREATE TABLE closures (
  id bigserial PRIMARY KEY,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  reason text NOT NULL DEFAULT '',
  CHECK (starts_at < ends_at)
);
CREATE INDEX closures_ends_idx ON closures (ends_at);

CREATE TABLE promo_codes (
  id bigserial PRIMARY KEY,
  code text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9-]{3,32}$'),
  kind text NOT NULL CHECK (kind IN ('percent', 'amount')),
  -- Pourcentage de 1 à 100, ou montant en centimes
  value int NOT NULL CHECK (value > 0 AND (kind = 'amount' OR value <= 100)),
  -- Portent sur le jour de la réservation (Europe/Brussels), ends_on inclus ; null = sans borne
  starts_on date,
  ends_on date,
  max_uses int CHECK (max_uses > 0),
  once_per_user boolean NOT NULL DEFAULT false,
  -- null = toutes les prestations
  service_ids bigint[],
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (starts_on <= ends_on)
);

CREATE TABLE bookings (
  id bigserial PRIMARY KEY,
  -- SET NULL : effacer une cliente (RGPD art. 17) garde les montants
  user_id bigint REFERENCES users ON DELETE SET NULL,
  -- Réservations saisies par l'admin (téléphone, WhatsApp)
  guest_name text,
  guest_phone text,
  service_id bigint NOT NULL REFERENCES services,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('pending_payment', 'confirmed', 'cancelled', 'expired')),
  price_cents int NOT NULL CHECK (price_cents >= 0),
  discount_cents int NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  deposit_cents int NOT NULL DEFAULT 0 CHECK (deposit_cents >= 0),
  promo_code_id bigint REFERENCES promo_codes,
  stripe_session_id text UNIQUE,
  stripe_payment_intent text,
  refunded_cents int NOT NULL DEFAULT 0 CHECK (refunded_cents >= 0),
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (starts_at < ends_at),
  -- Une seule praticienne : deux rendez-vous actifs ne se chevauchent jamais, même en cas de course (erreur 23P01)
  CONSTRAINT bookings_no_overlap EXCLUDE USING gist (tstzrange(starts_at, ends_at, '[)') WITH &&)
    WHERE (status IN ('pending_payment', 'confirmed'))
);
CREATE INDEX bookings_user_idx ON bookings (user_id, starts_at);
CREATE INDEX bookings_starts_idx ON bookings (starts_at);
CREATE INDEX bookings_promo_idx ON bookings (promo_code_id) WHERE promo_code_id IS NOT NULL;
CREATE INDEX bookings_pending_idx ON bookings (created_at) WHERE status = 'pending_payment';
