// Forfaits : état (pur), puis sur une base jetable (TEST_DATABASE_URL) vente, séance prise en ligne et par l'équipe,
// absence qui rend la séance, forfait épuisé, rendez-vous retiré du forfait, arrêt et échéance.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const url = process.env.TEST_DATABASE_URL;
// Avant tout import de db.ts (le test pur le charge aussi) ; sans base, aucune connexion n'est ouverte
Object.assign(process.env, { DATABASE_URL: url ?? 'postgres://localhost/aucune', SITE_URL: 'https://test.local', ADMIN_EMAIL: 'gerante@test.local', ADMIN_TOTP_SECRET: 'JBSWY3DPEHPK3PXP', PASSWORD_PEPPER: 'poivre-de-test-32-caracteres-min!' });
registerHooks({
  resolve: (spec, ctx, next) =>
    spec === 'astro:env/server'
      ? { url: 'data:text/javascript,export const { DATABASE_URL, SITE_URL, ADMIN_EMAIL, ADMIN_TOTP_SECRET, PASSWORD_PEPPER, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, RESEND_API_KEY, MAIL_FROM } = process.env;', shortCircuit: true }
      : next(spec, ctx),
  load: (u, ctx, next) => next(u, u.endsWith('.json') ? { ...ctx, importAttributes: { type: 'json' } } : ctx),
});

test('forfait : état et soins couverts', async () => {
  const { coversSlug, packageState } = await import('./forfaits.ts');
  const p = { total: 3, done: 1, booked: 1, expires_on: '2028-11-10', cancelled: false };
  assert.equal(packageState(p, '2026-11-10'), 'actif');
  assert.equal(packageState({ ...p, booked: 2 }, '2026-11-10'), 'epuise');
  assert.equal(packageState(p, '2028-11-10'), 'actif', "valable le jour de l'échéance");
  assert.equal(packageState(p, '2028-11-11'), 'expire');
  assert.equal(packageState({ ...p, cancelled: true }, '2026-11-10'), 'arrete');
  assert.ok(coversSlug('peeling-green-peel', 'peeling-green-peel') && !coversSlug('peeling-green-peel', 'peeling-green-peel-3-seances'));
  assert.ok(coversSlug('lumiere-led-', 'lumiere-led-double-eclat') && !coversSlug('lumiere-led-', 'cures-led-cure-eclat'));
});

test('forfaits sur une vraie base', { skip: !url && 'TEST_DATABASE_URL absente' }, async () => {
  process.env.DATABASE_URL = url;
  const { sql } = await import('./db.ts');
  const { migrate } = await import('../../../db/migrate.mjs');
  const booking = await import('./booking.ts');
  const { quote } = await import('./quote.ts');
  const f = await import('./forfaits.ts');
  const { listClients } = await import('./admin-clientes.ts');
  const { addDays } = await import('./admin-form.ts');
  const { todayBrussels } = await import('./pricing.ts');
  const tag = `f${Date.now()}`;
  // J+11 : aucun autre fichier de test ne réserve ce jour-là
  const day = addDays(todayBrussels(), 11);
  const at = async (hhmm: string) => (await sql`SELECT (${day}::text::date + ${hhmm}::time) AT TIME ZONE 'Europe/Brussels' AS t`)[0].t as Date;
  const fd = (o: Record<string, string>) => Object.entries(o).reduce((x, [k, v]) => (x.append(k, v), x), new FormData());
  const row = async (id: number) => (await sql`SELECT price_cents, package_id FROM bookings WHERE id = ${id}`)[0];
  try {
    await migrate(sql);
    const [unit] = await sql`INSERT INTO services (slug, category, name_fr, name_nl, name_en, duration_min, buffer_min, price_cents, active)
      VALUES (${tag}, 'visage', 'Peel test', 'Peel test', 'Peel test', 60, 0, 5000, true) RETURNING id`;
    const [line] = await sql`INSERT INTO services (slug, category, name_fr, name_nl, name_en, duration_min, price_cents, active)
      VALUES (${`${tag}-3-seances`}, 'visage', 'Peel test – 3 séances', 'Peel test – 3 sessies', 'Peel test – 3 sessions', NULL, 12000, false) RETURNING id`;
    f.PACKAGE_LINES[`${tag}-3-seances`] = { sessions: 3, covers: tag };
    await sql`INSERT INTO opening_hours (weekday, opens, closes) VALUES (extract(isodow FROM ${day}::text::date), '09:00', '18:00')`;
    const [a] = await sql`INSERT INTO users (email, password_hash, name, email_verified_at) VALUES (${`${tag}a@test.local`}, 'x', 'Amina test', now()) RETURNING id`;
    const [staff] = await sql`INSERT INTO users (email, password_hash, name, email_verified_at) VALUES (${`${tag}s@test.local`}, 'x', 'Équipe', now()) RETURNING id`;

    // Vente : prix de la carte, 3 séances, 24 mois
    assert.equal((await f.sellPackage(staff.id, a.id, fd({ offer: `${line.id}-${unit.id}` }))).ok, false, 'case « Je confirme » exigée');
    assert.equal((await f.sellPackage(staff.id, a.id, fd({ offer: `${line.id}-${line.id}`, confirm: 'on' }))).ok, false, 'soin hors de la ligne refusé');
    assert.ok((await f.sellPackage(staff.id, a.id, fd({ offer: `${line.id}-${unit.id}`, confirm: 'on' }))).ok);
    const [sold] = await sql`SELECT id, price_cents, sessions_total, expires_on::text,
      ((now() AT TIME ZONE 'Europe/Brussels')::date + interval '24 months')::date::text AS expect FROM packages WHERE user_id = ${a.id}`;
    assert.deepEqual([sold.price_cents, sold.sessions_total, sold.expires_on], [12000, 3, sold.expect]);

    // En ligne : devis puis réservation à 0 €, sans acompte ni code consommé
    const ten = await at('10:00');
    const q = await quote({ userId: a.id, serviceId: unit.id, startsAt: ten, promoCode: 'INCONNU', lang: 'fr' });
    assert.ok(q.ok && q.quote.packageLeft === 2 && q.quote.final_cents === 0, JSON.stringify(q));
    const r1 = await booking.createBooking({ userId: a.id, serviceId: unit.id, startsAt: ten, promoCode: 'INCONNU', lang: 'fr' });
    assert.ok(r1.ok && r1.checkoutUrl === null);
    assert.deepEqual({ ...(await row(r1.ok ? r1.id : 0)) }, { price_cents: 0, package_id: sold.id });

    // Par l'équipe : même forfait, sous le verrou de la cliente
    const r2 = await booking.createAdminBooking({ serviceId: unit.id, startsAt: await at('12:00'), guestName: '', userId: a.id });
    assert.ok(r2.ok && r2.packageLeft === 1);
    let [p] = await f.clientPackages(a.id);
    assert.deepEqual([p.booked, p.left, p.state], [2, 1, 'actif']);
    const [listed] = (await listClients(`${tag}a`, 'actives', 1)).rows;
    assert.deepEqual(listed.packages.map((x) => x.left), [1], 'colonne Abonnements : solde du forfait');

    // Une absence ne décompte pas de séance
    await sql`UPDATE bookings SET no_show = true WHERE id = ${r1.ok ? r1.id : 0}`;
    [p] = await f.clientPackages(a.id);
    assert.equal(p.left, 2);

    // Deux séances encore : la troisième réservation de l'équipe passe au prix de la carte
    const r3 = await booking.createAdminBooking({ serviceId: unit.id, startsAt: await at('14:00'), guestName: '', userId: a.id });
    const r4 = await booking.createAdminBooking({ serviceId: unit.id, startsAt: await at('16:00'), guestName: '', userId: a.id });
    const r5 = await booking.createAdminBooking({ serviceId: unit.id, startsAt: await at('17:00'), guestName: '', userId: a.id });
    assert.ok(r3.ok && r4.ok && r5.ok);
    assert.deepEqual([r3.packageLeft, r4.packageLeft, r5.packageLeft], [1, 0, null]);
    assert.deepEqual({ ...(await row(r5.id)) }, { price_cents: 5000, package_id: null });
    [p] = await f.clientPackages(a.id);
    assert.equal(p.state, 'epuise');

    // Retiré du forfait : prix de la carte, séance rendue
    assert.equal((await f.unlinkPackage(r4.id))?.package_id, sold.id);
    assert.deepEqual({ ...(await row(r4.id)) }, { price_cents: 5000, package_id: null });
    assert.equal(await f.unlinkPackage(r4.id), null, 'déjà retiré');
    [p] = await f.clientPackages(a.id);
    assert.equal(p.left, 1);

    // Arrêt : plus aucune séance prise ; un forfait expiré ne sert plus non plus
    assert.ok((await f.stopPackage(staff.id, a.id, fd({ package: String(sold.id), reason: 'Déménagement', confirm: 'on' }))).ok);
    assert.equal((await f.stopPackage(staff.id, a.id, fd({ package: String(sold.id), confirm: 'on' }))).ok, false, 'déjà arrêté');
    assert.equal(await f.packageFor(sql, a.id, unit.id, ten), null);
    await sql`INSERT INTO packages (user_id, service_id, line_id, label, sessions_total, price_cents, expires_on)
      VALUES (${a.id}, ${unit.id}, ${line.id}, 'Ancien', 3, 12000, current_date - 1)`;
    assert.equal(await f.packageFor(sql, a.id, unit.id, ten), null, 'échéance passée');
    assert.deepEqual((await f.clientPackages(a.id)).map((x) => x.state).sort(), ['arrete', 'expire']);
  } finally {
    await sql`DELETE FROM bookings WHERE service_id IN (SELECT id FROM services WHERE slug LIKE ${`${tag}%`})`;
    await sql`DELETE FROM packages WHERE service_id IN (SELECT id FROM services WHERE slug LIKE ${`${tag}%`})`;
    await sql`DELETE FROM services WHERE slug LIKE ${`${tag}%`}`;
    await sql.end();
  }
});
