-- Fiche de soin remplie par la cliente elle-même (après sa première connexion, puis depuis Mon compte).
-- care_filled_at : dernière mise à jour par la cliente (affichée côté institut) ; care_skipped_at : « Plus tard », plus de renvoi automatique.
-- client_note : « Un mot pour l'institut », séparé des notes internes de l'équipe (users.notes).
-- Retour arrière : ALTER TABLE users DROP COLUMN care_filled_at, DROP COLUMN care_skipped_at, DROP COLUMN client_note; puis retirer la ligne 022 de la table migrations.
ALTER TABLE users
  ADD COLUMN care_filled_at timestamptz,
  ADD COLUMN care_skipped_at timestamptz,
  ADD COLUMN client_note text NOT NULL DEFAULT '' CHECK (char_length(client_note) <= 500);
