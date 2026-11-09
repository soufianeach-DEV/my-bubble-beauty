-- Fiche de suivi des séances : date de naissance et antécédents médicaux de la cliente, zone traitée et praticienne de chaque séance.
-- Retour arrière : db/migrations/annuler/013_suivi_seances.sql.
ALTER TABLE users
  ADD COLUMN birth_date date CHECK (birth_date > '1900-01-01'),
  -- Données de santé : chiffrées (AES-256-GCM, clé dérivée du poivre), notées seulement avec l'accord de la cliente (health_consent_at)
  ADD COLUMN medical_history bytea CHECK (octet_length(medical_history) <= 9000);
ALTER TABLE bookings
  ADD COLUMN zone text CHECK (char_length(zone) <= 100),
  ADD COLUMN practitioner_id bigint REFERENCES users ON DELETE SET NULL;
