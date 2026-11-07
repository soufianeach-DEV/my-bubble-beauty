// Migrations appliquées au démarrage (server.mjs) : chaque fichier db/migrations/NNN_nom.sql une seule fois, dans l'ordre, puis la graine des services.
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';

const DIR = new URL('./migrations/', import.meta.url);
const DATA = new URL('../src/data/', import.meta.url);
// Montants du site : espace insécable avant € (« 35 € », « 12,50 € »)
// « Dès 180 € » (prix selon la zone traitée) : 180 € en base, la gérante ajuste le prix du rendez-vous si besoin
const AMOUNT = /^(?:Dès )?(\d+)(?:,(\d{2}))? €$/;

const slugify = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Tarifs des JSON du site : nom « groupe — item » dans les 3 langues, tous inactifs tant que la gérante n'a pas saisi durée et acompte
async function serviceSeed() {
  const [fr, nl, en] = await Promise.all(['fr', 'nl', 'en'].map(async (l) => JSON.parse(await readFile(new URL(`${l}.json`, DATA), 'utf8')).home.tarifs.groups));
  return fr.flatMap((g, i) => g.items.map((item, j) => {
    const m = AMOUNT.exec(item.amount);
    // Même soin en deux durées (Sculpt & Fermeté 30 et 60 min) : la durée distingue le slug (unique) et le nom
    const twin = g.items.filter((x) => x.name === item.name).length > 1;
    const suffix = (it) => (twin && it.duration ? ` (${it.duration})` : '');
    return {
      slug: slugify(`${g.id}-${item.name}${suffix(item)}`),
      category: g.cat,
      name_fr: `${g.title} — ${item.name}${suffix(item)}`,
      name_nl: `${nl[i].title} — ${nl[i].items[j].name}${suffix(nl[i].items[j])}`,
      name_en: `${en[i].title} — ${en[i].items[j].name}${suffix(en[i].items[j])}`,
      price_cents: m ? Number(m[1]) * 100 + Number(m[2] ?? 0) : 0,
      active: false,
    };
  })).map((s, sort) => ({ ...s, sort }));
}

// Exportée pour le test (dans une transaction annulée) ; en production, appelée par migrate seulement
export async function syncServices(tx, seed) {
  await tx`INSERT INTO services ${tx(seed)} ON CONFLICT (slug) DO UPDATE SET
    category = excluded.category, name_fr = excluded.name_fr, name_nl = excluded.name_nl, name_en = excluded.name_en,
    price_cents = excluded.price_cents, sort = excluded.sort`;
  await tx`UPDATE services SET active = false WHERE active AND slug <> ALL(${seed.map((s) => s.slug)}::text[])`;
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
    // noms, catégorie, prix et ordre repris du site, prestations disparues retirées de la réservation (jamais supprimées : des rendez-vous y renvoient).
    // Durée, acompte et activation restent ceux de la gérante. Rejoué seulement quand les tarifs changent, pas à chaque démarrage.
    const step = `tarifs_site:${createHash('sha256').update(JSON.stringify(seed)).digest('hex').slice(0, 16)}`;
    if (!done.has(step)) {
      await syncServices(tx, seed);
      await tx`INSERT INTO migrations (name) VALUES (${step})`;
      applied.push(step);
    }
    return applied;
  });
}
