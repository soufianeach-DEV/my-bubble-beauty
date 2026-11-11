-- Arrivée de la cliente au salon, notée d'un geste depuis l'écran « Aujourd'hui ». NULL = pas encore arrivée ou non notée.
-- Arrivée après l'heure du rendez-vous : le retard est calculé, sauf s'il a déjà été saisi à la main. Une absence efface l'arrivée.
-- Retour arrière : db/migrations/annuler/027_arrivee.sql.
ALTER TABLE bookings ADD COLUMN arrived_at timestamptz;
