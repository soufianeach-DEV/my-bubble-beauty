-- Retour arrière de 015, à lancer à la main puis : DELETE FROM migrations WHERE name = '015_bons_cadeaux.sql';
-- Les bons cadeaux émis sont perdus : les noter (code, bénéficiaire, soin, validité) avant.
ALTER TABLE bookings DROP COLUMN IF EXISTS gift_card_id;
DROP TABLE IF EXISTS gift_cards;
