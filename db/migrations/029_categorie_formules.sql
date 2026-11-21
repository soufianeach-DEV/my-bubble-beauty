-- Catégorie « formules » (Future Mariée) : premier groupe de l'accordéon de réservation, premier filtre de la page Tarifs.
-- Mêmes clés que home.tarifs.filters des JSON du site. La synchro des prestations range ensuite les formules dans cette catégorie.
-- Retour arrière : db/migrations/annuler/029_categorie_formules.sql.
ALTER TABLE services DROP CONSTRAINT IF EXISTS services_category_check;
ALTER TABLE services ADD CONSTRAINT services_category_check
  CHECK (category IN ('formules', 'visage', 'corps', 'epilation', 'sourire', 'regard', 'mains'));
