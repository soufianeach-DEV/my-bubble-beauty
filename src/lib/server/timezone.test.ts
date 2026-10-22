// Sur une base jetable (TEST_DATABASE_URL=postgres://…/base_de_test npm test) : heures de Bruxelles et créneaux, avec Node hors de ce fuseau.
// postgres.js relit tout paramètre typé date ou timestamp avec new Date(), dans le fuseau de Node : une heure locale en texte passe par ::text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const url = process.env.TEST_DATABASE_URL;
// Fuseau de Node différent de celui du salon (serveur en UTC, poste à l'étranger) : l'ancien ${s}::timestamp décalait les fermetures
process.env.TZ = 'America/New_York';
// Hors d'Astro : astro:env lu dans process.env, JSON du site importés comme le fait Vite
registerHooks({
  resolve: (spec, ctx, next) =>
    spec === 'astro:env/server'
      ? { url: 'data:text/javascript,export const { DATABASE_URL, SITE_URL, ADMIN_EMAIL, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, RESEND_API_KEY, MAIL_FROM } = process.env;', shortCircuit: true }
      : next(spec, ctx),
  load: (u, ctx, next) => next(u, u.endsWith('.json') ? { ...ctx, importAttributes: { type: 'json' } } : ctx),
});

test('heures de Bruxelles en base, Node à New York', { skip: !url && 'TEST_DATABASE_URL absente' }, async (t) => {
  process.env.DATABASE_URL = url;
  const { sql } = await import('./db.ts');
  const { migrate } = await import('../../../db/migrate.mjs');
  const { addClosure } = await import('./admin.ts');
  const { isFree, slots } = await import('./slots.ts');
  const { addDays } = await import('./admin-form.ts');
  const { todayBrussels } = await import('./pricing.ts');
  assert.notEqual(new Date('2026-11-10T09:00').getTimezoneOffset(), -60, 'le test doit tourner hors du fuseau de Bruxelles');
  try {
    await migrate(sql);

    await t.test('fermeture saisie 09:00–12:30 le 10/11 : 08:00–11:30 UTC', async () => {
      const form = new FormData();
      for (const [k, v] of Object.entries({ start_day: '2026-11-10', start_time: '09:00', end_day: '2026-11-10', end_time: '12:30', reason: 'test fuseau' })) form.set(k, v);
      const r = await addClosure(0, form);
      assert.ok(r.ok);
      const [c] = await sql`DELETE FROM closures WHERE id = ${r.id} RETURNING starts_at, ends_at`;
      assert.equal(c.starts_at.toISOString(), '2026-11-10T08:00:00.000Z');
      assert.equal(c.ends_at.toISOString(), '2026-11-10T11:30:00.000Z');
    });

    await t.test("créneaux : le paiement en cours d'une cliente ne masque son créneau qu'aux autres", async () => {
      const tag = `tz${Date.now()}`;
      const [a, b] = await sql`INSERT INTO users (email, password_hash) VALUES (${`${tag}a@test.local`}, 'x'), (${`${tag}b@test.local`}, 'x') RETURNING id`;
      const [svc] = await sql`INSERT INTO services (slug, category, name_fr, name_nl, name_en, duration_min, price_cents, active) VALUES (${tag}, 'visage', 'T', 'T', 'T', 60, 0, true) RETURNING id`;
      const day = addDays(todayBrussels(), 7);
      const [h] = await sql`INSERT INTO opening_hours (weekday, opens, closes) VALUES (extract(isodow FROM ${day}::text::date), '09:00', '12:00') RETURNING id`;
      try {
        const ten = (await slots(svc.id, day, a.id)).find((s) => s.label === '10:00');
        assert.ok(ten, '10:00 proposé avant toute réservation');
        // Jour et heure relus par Postgres : 10:00 à Bruxelles, quel que soit le fuseau de Node
        assert.equal(todayBrussels(ten.at), day);
        assert.equal(new Intl.DateTimeFormat('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' }).format(ten.at), '10:00');
        await sql`INSERT INTO bookings (user_id, service_id, starts_at, ends_at, status, price_cents)
          VALUES (${a.id}, ${svc.id}, ${ten.at}, ${ten.at}::timestamptz + interval '60 minutes', 'pending_payment', 0)`;
        const labels = async (u: number | null) => (await slots(svc.id, day, u)).map((s) => s.label);
        assert.ok((await labels(a.id)).includes('10:00'), 'sa propre réservation en attente ne lui masque pas le créneau');
        assert.ok(!(await labels(b.id)).includes('10:00'), 'une autre cliente ne le voit pas');
        assert.ok(!(await labels(null)).includes('10:00'));
        assert.equal(await isFree(sql, svc.id, ten.at, a.id), true);
        assert.equal(await isFree(sql, svc.id, ten.at, b.id), false);
      } finally {
        await sql`DELETE FROM bookings WHERE service_id = ${svc.id}`;
        await sql`DELETE FROM opening_hours WHERE id = ${h.id}`;
        await sql`DELETE FROM services WHERE id = ${svc.id}`;
        await sql`DELETE FROM users WHERE id IN (${a.id}, ${b.id})`;
      }
    });
  } finally {
    await sql.end();
  }
});
