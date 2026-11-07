// Sur une base jetable (TEST_DATABASE_URL=postgres://…/base_de_test npm test) : chiffres de l'onglet Métriques.
// Mesure l'écart avant / après l'ajout de rendez-vous de test : le résultat ne dépend pas du contenu de la base.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const url = process.env.TEST_DATABASE_URL;
registerHooks({
  resolve: (spec, ctx, next) =>
    spec === 'astro:env/server'
      ? { url: 'data:text/javascript,export const { DATABASE_URL, ADMIN_EMAIL } = process.env;', shortCircuit: true }
      : next(spec, ctx),
  load: (u, ctx, next) => next(u, u.endsWith('.json') ? { ...ctx, importAttributes: { type: 'json' } } : ctx),
});

test('métriques : CA, absences, annulations, à venir, nouvelles clientes', { skip: !url && 'TEST_DATABASE_URL absente' }, async () => {
  process.env.DATABASE_URL = url;
  process.env.ADMIN_EMAIL ??= 'gerante@test.local';
  const { sql } = await import('./db.ts');
  const { migrate } = await import('../../../db/migrate.mjs');
  const { metrics, delta, rate } = await import('./metrics.ts');
  const tag = `metriques-${Date.now()}`;
  try {
    await migrate(sql);
    const before = await metrics(30);
    const [u] = await sql`INSERT INTO users (email, password_hash, email_verified_at) VALUES (${`${tag}@test.local`}, 'x', now()) RETURNING id`;
    const [s] = await sql`INSERT INTO services (slug, category, name_fr, name_nl, name_en, duration_min, price_cents) VALUES (${tag}, 'visage', 'Soin test', 'Test', 'Test', 60, 5000) RETURNING id`;
    // Rendez-vous d'une heure, placé à offsetDays jours de maintenant
    const ins = (offsetDays: number, status: string, discount = 0, noShow = false) => sql`
      INSERT INTO bookings (user_id, service_id, status, price_cents, discount_cents, no_show, starts_at, ends_at)
      VALUES (${u.id}, ${s.id}, ${status}, 5000, ${discount}, ${noShow},
        now() + make_interval(days => ${offsetDays}), now() + make_interval(days => ${offsetDays}, hours => 1))`;
    await ins(-3, 'confirmed', 500); // honoré : 45 €
    await ins(-4, 'confirmed', 0, true); // absence
    await ins(-5, 'cancelled'); // annulé
    await ins(5, 'confirmed'); // à venir
    // Audience : 2 visiteurs hier (3 pages en tout), 1 il y a 40 jours (hors période)
    const fp = (n: number) => Buffer.alloc(16, n);
    await sql`INSERT INTO site_visits (day, visitor, views) VALUES
      ((now() - interval '1 day')::date, ${fp(201)}, 2), ((now() - interval '1 day')::date, ${fp(202)}, 1),
      ((now() - interval '40 days')::date, ${fp(203)}, 5)`;
    const after = await metrics(30);
    const d = (k: keyof typeof after.now) => after.now[k] - before.now[k];
    assert.equal(d('revenue'), 4500);
    assert.equal(d('done'), 1);
    assert.equal(d('noShows'), 1);
    assert.equal(d('upcoming'), 1);
    assert.equal(d('upcomingRevenue'), 5000);
    assert.equal(d('created'), 4);
    assert.equal(d('cancelled'), 1);
    assert.equal(d('newClients'), 1);
    assert.equal(d('visits'), 2);
    assert.equal(d('pageViews'), 3);
    assert.equal(after.before.visits - before.before.visits, 1);
    assert.ok(after.top.some((t) => t.name === 'Soin test' && t.n === 1 && t.revenue === 4500));
    assert.equal(after.months.length, 6);
    assert.equal(delta(150, 100), 50);
    assert.equal(delta(5, 0), null);
    assert.equal(rate(1, 4), 25);
  } finally {
    await sql`DELETE FROM site_visits WHERE visitor IN (${Buffer.alloc(16, 201)}, ${Buffer.alloc(16, 202)}, ${Buffer.alloc(16, 203)})`;
    await sql`DELETE FROM bookings WHERE service_id IN (SELECT id FROM services WHERE slug = ${tag})`;
    await sql`DELETE FROM services WHERE slug = ${tag}`;
    await sql`DELETE FROM users WHERE email = ${`${tag}@test.local`}`;
    await sql.end();
  }
});
