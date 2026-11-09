// Migrations appliquées au démarrage (server.mjs) : chaque fichier db/migrations/NNN_nom.sql une seule fois, dans l'ordre, puis la graine des services.
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';

const DIR = new URL('./migrations/', import.meta.url);
const DATA = new URL('../src/data/', import.meta.url);
// Montants du site : espace insécable avant € (« 35 € », « 12,50 € »)
// « Dès 180 € » (prix selon la zone traitée) : 180 € en base, la gérante ajuste le prix du rendez-vous si besoin
const AMOUNT = /^(?:Dès )?(\d+)(?:,(\d{2}))? €$/;

// Durée affichée sur la carte → minutes réservées. « 30 min », « 30 à 45 min » (la plus longue : le créneau doit suffire),
// « 5 × 20 min » (cure : une séance), « 1 h 30 », « 1 h », « 45' ». Tout autre texte : null, jamais deviné.
export function parseDuration(text) {
  const t = String(text ?? '').trim().replace(/\s+/g, ' ');
  let m;
  if ((m = /^(\d{1,3}) ?(?:min|minutes|')$/.exec(t))) return Number(m[1]) || null;
  if ((m = /^\d{1,3} ?(?:à|-|–) ?(\d{1,3}) ?min$/.exec(t))) return Number(m[1]) || null;
  if ((m = /^\d{1,2} ?[×x] ?(\d{1,3}) ?min$/.exec(t))) return Number(m[1]) || null;
  if ((m = /^(\d) ?h(?: ?(\d{1,2}))?(?: ?min)?$/.exec(t))) return Number(m[1]) * 60 + Number(m[2] ?? 0) || null;
  return null;
}

const slugify = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Tarifs des JSON du site : nom « groupe, item » dans les 3 langues ; durée lue sur la carte française.
// Une prestation qui a une durée arrive en ligne, les autres attendent que la gérante la saisisse.
export async function serviceSeed() {
  const [fr, nl, en] = await Promise.all(['fr', 'nl', 'en'].map(async (l) => JSON.parse(await readFile(new URL(`${l}.json`, DATA), 'utf8')).home.tarifs.groups));
  // Groupe masqué (hidden) : hors carte, donc retiré de la réservation par syncServices (effacé, ou masqué si un rendez-vous y renvoie)
  return fr.flatMap((g, i) => (g.hidden ? [] : g.items).map((item, j) => {
    const m = AMOUNT.exec(item.amount);
    // Même soin en deux durées (Sculpt & Fermeté 30 et 60 min) : la durée distingue le slug (unique) et le nom
    const twin = g.items.filter((x) => x.name === item.name).length > 1;
    const suffix = (it) => (twin && it.duration ? ` (${it.duration})` : '');
    return {
      slug: slugify(`${g.id}-${item.name}${suffix(item)}`),
      category: g.cat,
      name_fr: `${g.title}, ${item.name}${suffix(item)}`,
      name_nl: `${nl[i].title}, ${nl[i].items[j].name}${suffix(nl[i].items[j])}`,
      name_en: `${en[i].title}, ${en[i].items[j].name}${suffix(en[i].items[j])}`,
      price_cents: m ? Number(m[1]) * 100 + Number(m[2] ?? 0) : 0,
      duration_min: parseDuration(item.duration),
      active: parseDuration(item.duration) !== null,
    };
  })).map((s, sort) => ({ ...s, sort }));
}

// Exportée pour le test (dans une transaction annulée) ; en production, appelée par migrate seulement
export async function syncServices(tx, seed) {
  await tx`INSERT INTO services ${tx(seed)} ON CONFLICT (slug) DO UPDATE SET
    category = excluded.category, name_fr = excluded.name_fr, name_nl = excluded.name_nl, name_en = excluded.name_en,
    price_cents = excluded.price_cents, sort = excluded.sort`;
  const slugs = seed.map((s) => s.slug);
  // Durée de la carte, sauf durée réglée à la main ; puis ouverture de ce qui a une durée, sauf fermeture voulue par la gérante
  const dur = seed.filter((s) => s.duration_min != null).map((s) => [s.slug, s.duration_min]);
  if (dur.length) await tx`UPDATE services s SET duration_min = v.d::int FROM (VALUES ${tx(dur)}) AS v(slug, d)
    WHERE s.slug = v.slug AND NOT s.duration_manual AND s.duration_min IS DISTINCT FROM v.d::int`;
  await tx`UPDATE services SET active = true WHERE slug = ANY(${slugs}::text[]) AND retired_at IS NULL AND NOT active AND NOT closed_by_admin AND duration_min IS NOT NULL`;
  // Prestation retirée de la carte : effacée si rien n'y renvoie, sinon hors ligne et masquée (rendez-vous, codes promo, bons cadeaux).
  // Toute table qui pointe vers services doit figurer ici : sinon la clé étrangère bloque, migrate échoue et le site ne démarre plus.
  await tx`DELETE FROM services s WHERE slug <> ALL(${slugs}::text[])
    AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.service_id = s.id) AND NOT EXISTS (SELECT 1 FROM promo_codes p WHERE s.id = ANY(p.service_ids))
    AND NOT EXISTS (SELECT 1 FROM gift_cards g WHERE g.service_id = s.id)`;
  await tx`UPDATE services SET active = false, retired_at = coalesce(retired_at, now()) WHERE slug <> ALL(${slugs}::text[])`;
  // Revenue sur la carte : visible de nouveau, toujours fermée tant que la gérante ne la rouvre pas
  await tx`UPDATE services SET retired_at = NULL WHERE retired_at IS NOT NULL AND slug = ANY(${slugs}::text[])`;
}

export async function migrate(sql) {
  return sql.begin(async (tx) => {
    // Verrou de transaction : deux démarrages simultanés (déploiement qui chevauche l'ancien) s'attendent
    await tx`SELECT pg_advisory_xact_lock(hashtext('my-bubble-migrations'))`;
    await tx`CREATE TABLE IF NOT EXISTS migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
    const done = new Set((await tx`SELECT name FROM migrations`).map((r) => r.name));
    const applied = [];
    for (const file of (await readdir(DIR)).filter((f) => f.endsWith('.sql')).sort()) {
      if (done.has(file)) continue;
      await tx.unsafe(await readFile(new URL(file, DIR), 'utf8')).simple();
      await tx`INSERT INTO migrations (name) VALUES (${file})`;
      applied.push(file);
    }
    const seed = await serviceSeed();
    if (!done.has('graine_services')) {
      await tx`INSERT INTO services ${tx(seed)}`;
      await tx`INSERT INTO migrations (name) VALUES ('graine_services')`;
      applied.push('graine_services');
    }
    // Tarifs du site modifiés (empreinte différente) : la réservation suit les pages. Nouvelles prestations ajoutées (inactives),
    // noms, catégorie, prix et ordre repris du site, prestations disparues effacées ou masquées (syncServices).
    // Durée et activation restent celles de la gérante. Rejoué seulement quand les tarifs ou la règle (v2) changent, pas à chaque démarrage.
    const step = `tarifs_site:${createHash('sha256').update(JSON.stringify({ v: 3, seed })).digest('hex').slice(0, 16)}`;
    if (!done.has(step)) {
      await syncServices(tx, seed);
      // Lignes de la carte sans durée lisible : listées au démarrage, la gérante les saisit dans Admin > Prestations
      const missing = seed.filter((s) => s.duration_min == null).map((s) => s.name_fr);
      console.log(JSON.stringify({ t: new Date().toISOString(), event: 'services_sans_duree', count: missing.length, items: missing }));
      await tx`INSERT INTO migrations (name) VALUES (${step})`;
      applied.push(step);
    }
    return applied;
  });
}
