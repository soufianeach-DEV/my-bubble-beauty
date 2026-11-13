// Identifiant stable d'une ligne de la carte : groupe + nom français, plus la durée quand le même soin existe en deux durées.
// Partagé par la synchro des prestations (migrate.mjs) et les boutons « Réserver » des tarifs (?soin=slug) : ils ne divergent jamais.
export const slugify = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const itemSuffix = (g, item) => (g.items.filter((x) => x.name === item.name).length > 1 && item.duration ? ` (${item.duration})` : '');
export const itemSlug = (g, item) => slugify(`${g.id}-${item.name}${itemSuffix(g, item)}`);
