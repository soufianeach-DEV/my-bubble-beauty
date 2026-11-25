-- Retour arrière de 032, à lancer à la main puis : DELETE FROM migrations WHERE name = '032_avis_google_laisse.sql';
-- Remettre aussi le code d'avant (case de la fiche cliente, filtres des demandes d'avis), sinon ils lisent une colonne absente.
ALTER TABLE users DROP COLUMN IF EXISTS google_review_at;
