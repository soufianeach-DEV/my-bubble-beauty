-- Bon cadeau : adresse e-mail du bénéficiaire (facultative), pour le contacter ou lui envoyer son bon.
-- Retour arrière : ALTER TABLE gift_cards DROP COLUMN recipient_email; puis DELETE FROM migrations WHERE name = '018_bon_email.sql';
ALTER TABLE gift_cards ADD COLUMN recipient_email text CHECK (recipient_email = lower(recipient_email) AND char_length(recipient_email) <= 254);
