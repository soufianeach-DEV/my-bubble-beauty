-- Prestations retirées de la carte du site mais gardées parce que des rendez-vous ou des codes promo y renvoient :
-- hors ligne et masquées dans l'admin. Retour arrière : db/migrations/annuler/011_prestations_retirees.sql.
ALTER TABLE services ADD COLUMN retired_at timestamptz;
