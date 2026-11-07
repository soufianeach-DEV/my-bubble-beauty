-- Connexion par Google ou Microsoft (OpenID Connect) et par lien de connexion envoyé par e-mail.
-- Une identité externe = (fournisseur, identifiant stable chez lui) ; jamais l'adresse, qui peut changer chez le fournisseur.
CREATE TABLE user_identities (
  provider text NOT NULL CHECK (provider IN ('google', 'microsoft')),
  subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 255),
  user_id bigint NOT NULL REFERENCES users ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, subject)
);
CREATE INDEX user_identities_user_idx ON user_identities (user_id);
-- Même fermeture à l'API REST de Supabase que les autres tables (voir 003)
ALTER TABLE user_identities ENABLE ROW LEVEL SECURITY;

-- Lien de connexion : troisième usage des jetons d'e-mail (15 minutes, usage unique)
ALTER TABLE email_tokens DROP CONSTRAINT email_tokens_purpose_check;
ALTER TABLE email_tokens ADD CONSTRAINT email_tokens_purpose_check CHECK (purpose IN ('verify', 'reset', 'login'));
