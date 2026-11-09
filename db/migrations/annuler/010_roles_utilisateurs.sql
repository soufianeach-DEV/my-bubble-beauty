-- Retour arrière de 010, à lancer à la main (psql -f) puis : DELETE FROM migrations WHERE name = '010_roles_utilisateurs.sql';
-- Les rôles, secrets TOTP et suppressions par l'admin sont perdus : les comptes retirés redeviennent visibles et utilisables.
BEGIN;
DROP INDEX IF EXISTS users_removed_idx;
DROP INDEX IF EXISTS users_role_idx;
ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_role_at_check,
  DROP COLUMN IF EXISTS removed_at,
  DROP COLUMN IF EXISTS totp_confirmed_at,
  DROP COLUMN IF EXISTS totp_secret,
  DROP COLUMN IF EXISTS role_at,
  DROP COLUMN IF EXISTS role;
COMMIT;
