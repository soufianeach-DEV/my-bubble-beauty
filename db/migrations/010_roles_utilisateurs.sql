-- Équipe de l'institut et comptes retirés par l'admin. Retour arrière : db/migrations/annuler/010_roles_utilisateurs.sql.
ALTER TABLE users
  -- Rôle donné par l'admin à un compte confirmé ; NULL = cliente. La gérante (ADMIN_EMAIL) est super-admin sans ligne de rôle.
  ADD COLUMN role text CHECK (role IN ('admin', 'gestionnaire')),
  -- Date du rôle : la personne a 7 jours pour enregistrer son application d'authentification
  ADD COLUMN role_at timestamptz,
  -- Secret TOTP propre à la personne, chiffré (AES-256-GCM, clé dérivée du poivre) ; validé quand totp_confirmed_at est posé
  ADD COLUMN totp_secret bytea,
  ADD COLUMN totp_confirmed_at timestamptz,
  -- Suppression par l'admin : compte masqué, connexion refusée, rendez-vous et journal gardés, restaurable. Jamais purgé à 30 jours.
  ADD COLUMN removed_at timestamptz,
  ADD CONSTRAINT users_role_at_check CHECK (role IS NULL OR role_at IS NOT NULL);
CREATE INDEX users_role_idx ON users (role) WHERE role IS NOT NULL;
CREATE INDEX users_removed_idx ON users (removed_at) WHERE removed_at IS NOT NULL;
