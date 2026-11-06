-- Fuseau de Bruxelles fixé sur la base elle-même : le pooler Supabase peut ignorer le paramètre TimeZone envoyé à la connexion.
-- Sans le droit de modifier la base (base locale d'un autre propriétaire), le paramètre de connexion reste seul en place.
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET timezone TO %L', current_database(), 'Europe/Brussels');
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'Fuseau de la base non modifié : droit insuffisant';
END $$;
