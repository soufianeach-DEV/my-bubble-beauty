// Sur une base jetable (TEST_DATABASE_URL=postgres://…/base_de_test npm test) : requêtes de l'accueil admin.
// Jour J+41 avant l'aube : ni le même jour de semaine que les autres tests (J+7, J+9), ni leurs heures. Tout est retiré à la fin.
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

test('accueil : temps libre, charge du jour, fiches des clientes du jour, alertes', { skip: !url && 'TEST_DATABASE_URL absente' }, async () => {
  process.env.DATABASE_URL = url;
  const { sql } = await import('./db.ts');
  const { migrate } = await import('../../../db/migrate.mjs');
  const { alerts, clientCards, dayFrame, freeMinutes, loadByDay } = await import('./accueil.ts');
  const { addDays } = await import('./admin-form.ts');
  const { todayBrussels } = await import('./pricing.ts');
  const tag = `accueil-${Date.now()}`;
  const day = addDays(todayBrussels(), 41);
  const at = async (d: string, hhmm: string) => (await sql`SELECT (${d}::text::date + ${hhmm}::time) AT TIME ZONE 'Europe/Brussels' AS t`)[0].t as Date;
  let hoursId = 0;
  try {
    await migrate(sql);
    const [s] = await sql`INSERT INTO services (slug, category, name_fr, name_nl, name_en, duration_min, price_cents) VALUES (${tag}, 'visage', ${`Soin ${tag}`}, 'T', 'T', 45, 5000) RETURNING id`;
    const [u] = await sql`INSERT INTO users (email, password_hash, name, email_verified_at) VALUES (${`${tag}@test.local`}, 'x', 'Cliente accueil', now()) RETURNING id`;
    const book = async (d: string, from: string, to: string, status = 'confirmed', noShow = false) =>
      (await sql`INSERT INTO bookings (user_id, service_id, starts_at, ends_at, status, price_cents, no_show)
        VALUES (${u.id}, ${s.id}, ${await at(d, from)}, ${await at(d, to)}, ${status}, 5000, ${noShow}) RETURNING id`)[0].id as number;

    // Temps libre : 2 h d'ouverture, moins 45 min de soin, moins 30 min de fermeture dans la plage
    const f0 = await freeMinutes(day);
    [{ id: hoursId }] = await sql`INSERT INTO opening_hours (weekday, opens, closes) VALUES (extract(isodow FROM ${day}::text::date), '04:00', '06:00') RETURNING id`;
    assert.equal(await freeMinutes(day), f0 + 120);
    await book(day, '04:30', '05:15');
    assert.equal(await freeMinutes(day), f0 + 75);
    await sql`INSERT INTO closures (starts_at, ends_at, reason) VALUES (${await at(day, '05:30')}, ${await at(day, '06:30')}, ${tag})`;
    assert.equal(await freeMinutes(day), f0 + 45);
    const frame = await dayFrame(day);
    assert.ok(frame.hours.some((h) => h.opens === '04:00' && h.closes === '06:00'));
    assert.ok(frame.closures.some((c) => c.reason === tag));

    assert.equal((await loadByDay(day, addDays(day, 1)))[day], 1);

    // Fiche du jour : une visite honorée, une absence, prestation passée listée
    await book(addDays(day, -400), '04:00', '04:45');
    await book(addDays(day, -390), '04:00', '04:45', 'confirmed', true);
    const [card] = (await clientCards(day)).filter((c) => c.id === u.id);
    assert.deepEqual({ visits: card.visits, no_shows: card.no_shows, services: card.services }, { visits: 1, no_shows: 1, services: [`Soin ${tag}`] });
    assert.ok(card.last_visit);

    // Alertes : annulation et déplacement récents, nouvelle inscrite ; le compte de la gérante n'y figure jamais
    const c = await book(addDays(day, 1), '04:00', '04:45');
    await sql`UPDATE bookings SET status = 'cancelled', cancelled_at = now() WHERE id = ${c}`;
    const m = await book(addDays(day, 2), '04:00', '04:45');
    await sql`UPDATE bookings SET moved_at = now() WHERE id = ${m}`;
    const a = await alerts(`${tag}@test.local`);
    assert.ok(a.cancelled.some((r) => r.id === c));
    assert.ok(a.moved.some((r) => r.id === m));
    assert.equal(a.newClients.some((r) => r.id === u.id), false);
    assert.ok((await alerts('autre@test.local')).newClients.some((r) => r.id === u.id));
  } finally {
    await sql`DELETE FROM bookings WHERE service_id IN (SELECT id FROM services WHERE slug = ${tag})`;
    await sql`DELETE FROM closures WHERE reason = ${tag}`;
    if (hoursId) await sql`DELETE FROM opening_hours WHERE id = ${hoursId}`;
    await sql`DELETE FROM users WHERE email = ${`${tag}@test.local`}`;
    await sql`DELETE FROM services WHERE slug = ${tag}`;
    await sql.end();
  }
});
