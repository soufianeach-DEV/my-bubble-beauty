-- Notes de l'équipe (users.notes) et mot de la cliente (users.client_note) chiffrés en base (AES-256-GCM, préfixe « enc1: »).
-- Le texte chiffré est plus long que le texte saisi : les limites portent désormais sur le texte stocké.
-- Les longueurs saisies restent bornées par l'application (4000 et 500). Les notes encore en clair sont rechiffrées par les tâches.
-- health_consent_text : libellé exact de l'accord santé accepté, pour pouvoir prouver ce qui a été consenti (RGPD art. 7.1).
-- Retour arrière : db/migrations/annuler/028_notes_chiffrees.sql.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_notes_check;
ALTER TABLE users ADD CONSTRAINT users_notes_check CHECK (char_length(notes) <= 24000);
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_client_note_check;
ALTER TABLE users ADD CONSTRAINT users_client_note_check CHECK (char_length(client_note) <= 3000);
ALTER TABLE users ADD COLUMN health_consent_text text CHECK (char_length(health_consent_text) <= 1000);
