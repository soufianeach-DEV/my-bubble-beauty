-- « A laissé un avis Google » : case de la fiche cliente, cochée par l'équipe. Posée, plus aucune demande d'avis
-- (ni mail, ni relance, ni WhatsApp). Ajout seul, aucune donnée touchée.
-- Retour arrière : db/migrations/annuler/032_avis_google_laisse.sql.
ALTER TABLE users ADD COLUMN google_review_at timestamptz;
