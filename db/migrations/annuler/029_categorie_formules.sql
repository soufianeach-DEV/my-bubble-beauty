-- Retour arrière de 029, à lancer à la main puis : DELETE FROM migrations WHERE name = '029_categorie_formules.sql';
-- Les formules repassent dans « visage » avant de retirer la catégorie, sinon la contrainte refuse les lignes existantes.
-- Remettre aussi le code d'avant (filtre « formules » et cat des formules dans les JSON), sinon la synchro les y renvoie au démarrage.
UPDATE services SET category = 'visage' WHERE category = 'formules';
ALTER TABLE services DROP CONSTRAINT IF EXISTS services_category_check;
ALTER TABLE services ADD CONSTRAINT services_category_check
  CHECK (category IN ('visage', 'corps', 'epilation', 'sourire', 'regard', 'mains'));
