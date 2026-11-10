-- Encaissement au salon d'un rendez-vous passé et honoré : mode (espèces, carte, Payconiq, bon cadeau) et montant réellement payé.
-- Quand il existe, ce montant remplace le prix moins la remise dans le total payé, la fidélité et le chiffre d'affaires.
-- Retour arrière : ALTER TABLE bookings DROP COLUMN paid_method, DROP COLUMN paid_cents, DROP COLUMN paid_at; puis retirer la ligne 024 de la table migrations.
ALTER TABLE bookings
  ADD COLUMN paid_method text CHECK (paid_method IN ('especes', 'carte', 'payconiq', 'bon')),
  ADD COLUMN paid_cents integer CHECK (paid_cents BETWEEN 0 AND 10000000),
  ADD COLUMN paid_at timestamptz,
  ADD CONSTRAINT bookings_paid_all_or_none CHECK ((paid_method IS NULL) = (paid_cents IS NULL) AND (paid_method IS NULL) = (paid_at IS NULL));
