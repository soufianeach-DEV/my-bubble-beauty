-- Bon cadeau rattaché à une cliente existante (facultatif) : il apparaît sur sa fiche, l'e-mail part dans sa langue.
-- Retour arrière : ALTER TABLE gift_cards DROP COLUMN user_id; puis retirer la ligne 021 de la table migrations.
ALTER TABLE gift_cards ADD COLUMN user_id bigint REFERENCES users ON DELETE SET NULL;
CREATE INDEX gift_cards_user_idx ON gift_cards (user_id) WHERE user_id IS NOT NULL;
