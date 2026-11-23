-- Demande d'avis Google par WhatsApp, depuis l'agenda admin : une seule par cliente, même si elle revient.
-- La cliente est reconnue par son compte ou par son numéro (réservations saisies sans compte).
-- Retour arrière : db/migrations/annuler/030_avis_whatsapp.sql.

-- Numéro réduit aux chiffres, au format international sans « + » : 0484 11 83 95 → 32484118395 (Belgique par défaut).
-- Même règle que waDigits() dans src/lib/server/avis-whatsapp.ts.
CREATE FUNCTION wa_digits(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN d = '' THEN NULL
    WHEN left(d, 2) = '00' THEN nullif(substr(d, 3), '')
    WHEN left(d, 1) = '0' THEN '32' || substr(d, 2)
    ELSE d END
  FROM (SELECT regexp_replace(coalesce(p, ''), '\D', '', 'g') AS d) x
$$;

CREATE TABLE review_asks (
  id bigserial PRIMARY KEY,
  -- SET NULL : effacer une cliente (RGPD art. 17) ne garde que la date et le numéro réduit
  user_id bigint REFERENCES users ON DELETE SET NULL,
  phone text NOT NULL,
  booking_id bigint REFERENCES bookings ON DELETE SET NULL,
  asked_by bigint REFERENCES users ON DELETE SET NULL,
  asked_at timestamptz NOT NULL DEFAULT now()
);
-- Une seule demande par numéro et par compte : deux clics rapides n'en créent pas deux
CREATE UNIQUE INDEX review_asks_phone_idx ON review_asks (phone);
CREATE UNIQUE INDEX review_asks_user_idx ON review_asks (user_id) WHERE user_id IS NOT NULL;
