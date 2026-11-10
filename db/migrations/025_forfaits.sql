-- Forfaits vendus à l'institut (Green Peel 3 ou 5 séances, cures LED…) : une ligne par vente, le solde se calcule sur les rendez-vous.
-- Séance comptée : rendez-vous confirmé rattaché au forfait et non marqué absente (honoré ou à venir). Une absence ou une annulation la rend.
-- Valable 24 mois après la vente ; arrêté par la gérante (elle rembourse elle-même, le site ne gère aucun paiement).
-- Retour arrière : ALTER TABLE bookings DROP COLUMN package_id; DROP TABLE packages; puis retirer la ligne 025 de la table migrations.
CREATE TABLE packages (
  id bigserial PRIMARY KEY,
  -- Compte effacé : la vente reste pour la comptabilité, sans cliente
  user_id bigint REFERENCES users ON DELETE SET NULL,
  -- Soin couvert (une séance de Green Peel) et ligne de la carte vendue (Green Peel – 3 séances)
  service_id bigint NOT NULL REFERENCES services,
  line_id bigint NOT NULL REFERENCES services,
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 200),
  sessions_total integer NOT NULL CHECK (sessions_total BETWEEN 1 AND 50),
  price_cents integer NOT NULL CHECK (price_cents BETWEEN 0 AND 10000000),
  sold_at timestamptz NOT NULL DEFAULT now(),
  sold_by bigint REFERENCES users ON DELETE SET NULL,
  expires_on date NOT NULL,
  cancelled_at timestamptz,
  cancel_reason text NOT NULL DEFAULT '' CHECK (char_length(cancel_reason) <= 300)
);
CREATE INDEX packages_user_idx ON packages (user_id);

ALTER TABLE bookings ADD COLUMN package_id bigint REFERENCES packages ON DELETE SET NULL;
CREATE INDEX bookings_package_idx ON bookings (package_id) WHERE package_id IS NOT NULL;
