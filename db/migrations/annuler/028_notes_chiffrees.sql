-- Retour arrière de 028, à lancer à la main puis : DELETE FROM migrations WHERE name = '028_notes_chiffrees.sql';
-- Seulement après être revenu à une version du site qui lit les notes en clair : les notes déjà chiffrées (« enc1: »)
-- lui seraient illisibles, et les anciennes limites échouent si une note chiffrée dépasse 4000 ou 500 caractères.
ALTER TABLE users DROP COLUMN IF EXISTS health_consent_text;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_client_note_check;
ALTER TABLE users ADD CONSTRAINT users_client_note_check CHECK (char_length(client_note) <= 500);
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_notes_check;
ALTER TABLE users ADD CONSTRAINT users_notes_check CHECK (char_length(notes) <= 4000);
