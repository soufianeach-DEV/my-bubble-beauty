-- Fiche de soin structurée : préférences, zones et toucher (pas des données de santé) ; allergies, type de peau et contre-indications
-- (données de santé, chiffrées, seulement avec l'accord de la cliente). Les notes libres restent dans users.notes : rien n'est perdu.
-- Retour arrière : ALTER TABLE users DROP COLUMN health_profile, DROP COLUMN care_profile; puis DELETE FROM migrations WHERE name = '017_fiche_de_soin.sql';
ALTER TABLE users
  ADD COLUMN care_profile jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(care_profile) = 'object' AND octet_length(care_profile::text) <= 4000),
  ADD COLUMN health_profile bytea CHECK (octet_length(health_profile) <= 9000);
