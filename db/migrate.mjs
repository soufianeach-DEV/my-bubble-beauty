// Migrations appliquées au démarrage (server.mjs) : chaque fichier db/migrations/NNN_nom.sql une seule fois, dans l'ordre, puis la graine des services.
import { readdir, readFile } from 'node:fs/promises';

const DIR = new URL('./migrations/', import.meta.url);
const DATA = new URL('../src/data/', import.meta.url);
// Montants du site : espace insécable avant € (« 35 € », « 12,50 € »)
const AMOUNT = /^(\d+)(?:,(\d{2}))? €$/;

const slugify = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Tarifs des JSON du site : nom « groupe — item » dans les 3 langues, tous inactifs tant que la gérante n'a pas saisi durée et acompte
async function serviceSeed() {
  const [fr, nl, en] = await Promise.all(['fr', 'nl', 'en'].map(async (l) => JSON.parse(await readFile(new URL(`${l}.json`, DATA), 'utf8')).home.tarifs.groups));
  return fr.flatMap((g, i) => g.items.map((item, j) => {
    const m = AMOUNT.exec(item.amount);
    return {
      slug: slugify(`${g.id}-${item.name}`),
      category: g.cat,
      name_fr: `${g.title} — ${item.name}`,
      name_nl: `${nl[i].title} — ${nl[i].items[j].name}`,
      name_en: `${en[i].title} — ${en[i].items[j].name}`,
      price_cents: m ? Number(m[1]) * 100 + Number(m[2] ?? 0) : 0,
      active: false,
    };
  })).map((s, sort) => ({ ...s, sort }));
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
    if (!done.has('graine_services')) {
      await tx`INSERT INTO services ${tx(await serviceSeed())}`;
      await tx`INSERT INTO migrations (name) VALUES ('graine_services')`;
      applied.push('graine_services');
    }
    return applied;
  });
}
