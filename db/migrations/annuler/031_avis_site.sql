-- Retour arrière de 031, à lancer à la main puis : DELETE FROM migrations WHERE name = '031_avis_site.sql';
-- Remettre aussi le code d'avant (page compte/avis et lien « Laisser un avis » de l'historique), sinon ils lisent une table absente.
DROP TABLE IF EXISTS site_reviews;
