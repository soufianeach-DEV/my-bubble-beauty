-- Consentements signés (laser, photo-épilation, cavitation) et réglages de l'institut modifiables depuis l'admin.
-- Retour arrière : db/migrations/annuler/012_consentements.sql.
CREATE TABLE settings (
  key text PRIMARY KEY CHECK (key ~ '^[a-z_]{1,60}$'),
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by bigint REFERENCES users ON DELETE SET NULL
);
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

CREATE TABLE consents (
  id bigserial PRIMARY KEY,
  -- Effacement du compte : ses consentements partent avec lui (droit à l'effacement)
  user_id bigint NOT NULL REFERENCES users ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('laser', 'photo', 'cavitation')),
  version text NOT NULL CHECK (char_length(version) <= 20),
  -- Texte exact signé et son empreinte SHA-256 : la ligne prouve ce qui a été accepté, même si le modèle change ensuite
  text text NOT NULL CHECK (char_length(text) <= 20000),
  text_sha256 text NOT NULL CHECK (text_sha256 ~ '^[0-9a-f]{64}$'),
  signer_name text NOT NULL CHECK (char_length(signer_name) BETWEEN 3 AND 100),
  mention text NOT NULL CHECK (mention = 'Lu et approuvé'),
  specialist text NOT NULL DEFAULT '' CHECK (char_length(specialist) <= 100),
  channel text NOT NULL CHECK (channel IN ('online', 'institut')),
  -- Signature à l'institut : la personne de l'équipe connectée qui a tendu la tablette
  staff_id bigint REFERENCES users ON DELETE SET NULL,
  ip text CHECK (char_length(ip) <= 64),
  user_agent text NOT NULL DEFAULT '' CHECK (char_length(user_agent) <= 256),
  signed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX consents_user_idx ON consents (user_id, kind);
ALTER TABLE consents ENABLE ROW LEVEL SECURITY;
