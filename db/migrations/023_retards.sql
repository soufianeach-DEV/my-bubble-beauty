-- Retard d'une cliente à un rendez-vous passé et honoré, noté par l'équipe (agenda, fiche cliente). NULL = à l'heure ou non noté.
-- Une absence efface le retard (les deux ne vont pas ensemble).
-- Retour arrière : ALTER TABLE bookings DROP COLUMN late_minutes; puis retirer la ligne 023 de la table migrations.
ALTER TABLE bookings
  ADD COLUMN late_minutes smallint CHECK (late_minutes BETWEEN 1 AND 240);
