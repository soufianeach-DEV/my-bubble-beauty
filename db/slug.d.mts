type Item = { name: string; duration?: string };
type Group = { id: string; items: Item[] };
export function slugify(s: string): string;
export function itemSuffix(g: Group, item: Item): string;
export function itemSlug(g: Group, item: Item): string;
