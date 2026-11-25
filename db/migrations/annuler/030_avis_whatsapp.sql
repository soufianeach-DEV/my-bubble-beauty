-- Retour arrière de 030, à lancer à la main puis : DELETE FROM migrations WHERE name = '030_avis_whatsapp.sql';
-- Remettre aussi le code d'avant (bouton « Demander un avis » de l'agenda), sinon l'agenda lit une table absente.
DROP TABLE IF EXISTS review_asks;
DROP FUNCTION IF EXISTS wa_digits(text);
