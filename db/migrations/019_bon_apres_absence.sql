-- Bon cadeau après une absence : il redevient utilisable (décision de la gérante), donc le rendez-vous manqué ne le bloque plus.
-- Retour arrière : DROP INDEX bookings_gift_idx; CREATE UNIQUE INDEX bookings_gift_idx ON bookings (gift_card_id)
--   WHERE gift_card_id IS NOT NULL AND status IN ('pending_payment', 'confirmed'); puis retirer la ligne 019 de la table migrations.
DROP INDEX bookings_gift_idx;
CREATE UNIQUE INDEX bookings_gift_idx ON bookings (gift_card_id)
  WHERE gift_card_id IS NOT NULL AND status IN ('pending_payment', 'confirmed') AND NOT no_show;
