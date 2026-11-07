-- « HydraFacial » est une marque déposée : les prestations s'appellent désormais « Hydra Signature » (noms affichés seulement, slugs inchangés)
UPDATE services SET
  name_fr = replace(name_fr, 'HydraFacial', 'Hydra Signature'),
  name_nl = replace(name_nl, 'HydraFacial', 'Hydra Signature'),
  name_en = replace(name_en, 'HydraFacial', 'Hydra Signature')
WHERE name_fr LIKE '%HydraFacial%' OR name_nl LIKE '%HydraFacial%' OR name_en LIKE '%HydraFacial%';
