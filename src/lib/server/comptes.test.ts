// Sur une base jetable (TEST_DATABASE_URL=postgres://…/base_de_test npm test) : réservation concurrente, cloisonnement entre clientes,
// temps tampon, déplacement, suppression douce et réactivation, effacement, purge, blocage, export, remboursement hors site, rappels.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const url = process.env.TEST_DATABASE_URL;
const ENV = { SITE_URL: 'https://test.local', ADMIN_EMAIL: 'gerante@test.local', ADMIN_TOTP_SECRET: 'JBSWY3DPEHPK3PXP', PASSWORD_PEPPER: 'poivre-de-test-32-caracteres-min!' };
Object.assign(process.env, ENV);
registerHooks({
  resolve: (spec, ctx, next) =>
    spec === 'astro:env/server'
      ? { url: 'data:text/javascript,export const { DATABASE_URL, SITE_URL, ADMIN_EMAIL, ADMIN_TOTP_SECRET, PASSWORD_PEPPER, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, RESEND_API_KEY, MAIL_FROM } = process.env;', shortCircuit: true }
      : next(spec, ctx),
  load: (u, ctx, next) => next(u, u.endsWith('.json') ? { ...ctx, importAttributes: { type: 'json' } } : ctx),
});

// Cookies d'Astro réduits à ce que closeSession lit et efface
const cookies = () => {
  const jar = new Map<string, string>();
  return { get: (k: string) => (jar.has(k) ? { value: jar.get(k)! } : undefined), set: (k: string, v: string) => jar.set(k, v), delete: (k: string) => jar.delete(k) } as never;
};

test('comptes, réservations et sécurité sur une vraie base', { skip: !url && 'TEST_DATABASE_URL absente' }, async (t) => {
  process.env.DATABASE_URL = url;
  const { sql } = await import('./db.ts');
  const { migrate } = await import('../../../db/migrate.mjs');
  const { purge } = await import('../../../db/purge.mjs');
  const { hashPassword } = await import('./auth.ts');
  const { login } = await import('./auth.ts');
  const booking = await import('./booking.ts');
  const { slots } = await import('./slots.ts');
  const rgpd = await import('./rgpd.ts');
  const { clientAction, clientDetail, listClients } = await import('./admin-clientes.ts');
  const { readSession, openSession } = await import('./session.ts');
  const { addDays } = await import('./admin-form.ts');
  const { todayBrussels } = await import('./pricing.ts');
  const tag = `c${Date.now()}`;
  const password = 'Un mot de passe de test assez long';
  const hash = await hashPassword(password);
  const mkUser = async (n: string) =>
    (await sql`INSERT INTO users (email, password_hash, name, email_verified_at) VALUES (${`${tag}${n}@test.local`}, ${hash}, ${n}, now()) RETURNING id, email`)[0] as { id: number; email: string };
  // J+9 : pas le jour de timezone.test.ts (J+7), les deux fichiers tournent en parallèle sur la même base
  const day = addDays(todayBrussels(), 9);
  const at = async (hhmm: string) => (await sql`SELECT (${day}::text::date + ${hhmm}::time) AT TIME ZONE 'Europe/Brussels' AS t`)[0].t as Date;
  try {
    await migrate(sql);
    // Rejouée : aucune migration ne s'applique deux fois
    await migrate(sql);
    const [svc] = await sql`INSERT INTO services (slug, category, name_fr, name_nl, name_en, duration_min, buffer_min, price_cents, active)
      VALUES (${tag}, 'visage', 'Soin test', 'Soin test', 'Soin test', 60, 15, 5000, true) RETURNING id`;
    await sql`INSERT INTO opening_hours (weekday, opens, closes) VALUES (extract(isodow FROM ${day}::text::date), '09:00', '18:00')`;
    const a = await mkUser('a');
    const b = await mkUser('b');

    await t.test('deux clientes sur le même créneau au même instant : une seule réservation', async () => {
      const ten = await at('10:00');
      const res = await Promise.all([a, b].map((u) => booking.createBooking({ userId: u.id, serviceId: svc.id, startsAt: ten, lang: 'fr' })));
      assert.equal(res.filter((r) => r.ok).length, 1);
      assert.deepEqual(res.filter((r) => !r.ok).map((r) => !r.ok && r.error), ['unavailable']);
      const [{ n }] = await sql`SELECT count(*)::int AS n FROM bookings WHERE service_id = ${svc.id} AND status = 'confirmed'`;
      assert.equal(n, 1);
    });

    await t.test('temps tampon : 10:00–11:00 + 15 min bloque jusqu’à 11:15, et un soin de 09:00 empiéterait par son tampon', async () => {
      const labels = (await slots(svc.id, day, null)).map((s) => s.label);
      assert.ok(!labels.includes('11:00') && !labels.includes('09:00'), labels.join(' '));
      assert.ok(labels.includes('11:15') && labels.includes('17:00') && !labels.includes('17:15'), labels.join(' '));
    });

    const [mine] = await sql`SELECT id, user_id FROM bookings WHERE service_id = ${svc.id} AND status = 'confirmed'`;
    const owner = mine.user_id === a.id ? a : b;
    const other = owner === a ? b : a;

    await t.test("une cliente ne voit, n'annule ni ne déplace le rendez-vous d'une autre", async () => {
      assert.equal(await booking.movableBooking(other.id, mine.id, 'fr'), null);
      assert.deepEqual(await booking.cancelByClient(other.id, mine.id), { ok: false, error: 'not_found' });
      assert.equal(await booking.rescheduleByClient(other.id, mine.id, await at('14:00')), 'not_found');
      assert.equal((await booking.clientBookings(other.id, 'fr')).length, 0);
      assert.equal((await booking.clientBookings(owner.id, 'fr')).length, 1);
    });

    await t.test('déplacement par la cliente : créneau libre accepté, créneau pris refusé', async () => {
      const [x] = await sql`INSERT INTO bookings (user_id, service_id, starts_at, ends_at, status, price_cents)
        VALUES (${other.id}, ${svc.id}, ${await at('15:00')}, ${await at('16:15')}, 'confirmed', 5000) RETURNING id`;
      assert.equal(await booking.rescheduleByClient(owner.id, mine.id, await at('14:30')), 'unavailable');
      assert.equal(await booking.rescheduleByClient(owner.id, mine.id, await at('12:00')), 'ok');
      const [m] = await sql`SELECT starts_at, ends_at, moved_at FROM bookings WHERE id = ${mine.id}`;
      assert.equal(m.starts_at.getTime(), (await at('12:00')).getTime());
      assert.equal(m.ends_at.getTime() - m.starts_at.getTime(), 75 * 60_000);
      assert.ok(m.moved_at);
      await sql`UPDATE bookings SET status = 'cancelled' WHERE id = ${x.id}`;
    });

    await t.test('suppression douce : rendez-vous annulés, sessions fermées, journal, réactivation dans les 30 jours', async () => {
      const jar = cookies();
      await openSession(jar, owner.id, 'test');
      assert.equal(await rgpd.deleteAccount(cookies(), owner, 'mauvais', '127.0.0.1'), 'wrong');
      assert.equal(await rgpd.deleteAccount(jar, owner, password, '127.0.0.1'), 'ok');
      const [u] = await sql`SELECT deleted_at FROM users WHERE id = ${owner.id}`;
      assert.ok(u.deleted_at);
      const [bk] = await sql`SELECT status, cancel_reason FROM bookings WHERE id = ${mine.id}`;
      assert.deepEqual({ ...bk }, { status: 'cancelled', cancel_reason: 'account_deleted' });
      const [{ n }] = await sql`SELECT count(*)::int AS n FROM sessions WHERE user_id = ${owner.id}`;
      assert.equal(n, 0);
      // Connexion encore possible : le middleware n'ouvre alors que la page de réactivation
      assert.ok(await login(owner.email, password, '10.0.0.1'));
      const j2 = cookies();
      await openSession(j2, owner.id, 'test');
      const s = await readSession((j2 as { get: (k: string) => { value: string } }).get('__Host-mb_session').value);
      assert.ok(s?.user.deletedAt);
      assert.equal(await rgpd.reactivate(owner.id, '127.0.0.1'), true);
      assert.equal((await sql`SELECT deleted_at FROM users WHERE id = ${owner.id}`)[0].deleted_at, null);
      await new Promise((r) => setTimeout(r, 200));
      const acts = (await sql`SELECT action FROM audit_log WHERE client_id = ${owner.id} ORDER BY id`).map((r) => r.action);
      assert.ok(acts.includes('account_deleted') && acts.includes('account_reactivated'), acts.join(' '));
    });

    await t.test('après 30 jours : plus de réactivation ni de connexion, la purge efface et garde les rendez-vous anonymes', async () => {
      await sql`UPDATE users SET deleted_at = now() - interval '31 days' WHERE id = ${owner.id}`;
      assert.equal(await rgpd.reactivate(owner.id, '127.0.0.1'), false);
      assert.equal(await login(owner.email, password, '10.0.0.2'), null);
      const counts = await purge(sql, ENV.ADMIN_EMAIL);
      assert.ok(counts.deleted >= 1);
      assert.equal((await sql`SELECT 1 FROM users WHERE id = ${owner.id}`).length, 0);
      const [bk] = await sql`SELECT user_id, client_erased FROM bookings WHERE id = ${mine.id}`;
      assert.deepEqual({ ...bk }, { user_id: null, client_erased: true });
      const [{ n }] = await sql`SELECT count(*)::int AS n FROM audit_log WHERE action = 'account_erased' AND details->>'by' = 'deleted'`;
      assert.ok(n >= 1);
    });

    await t.test("blocage par l'admin : sessions fermées, connexion refusée, déblocage", async () => {
      const [admin] = await sql`INSERT INTO users (email, password_hash, email_verified_at) VALUES (${ENV.ADMIN_EMAIL}, ${hash}, now())
        ON CONFLICT (email) DO UPDATE SET email_verified_at = now() RETURNING id`;
      const jar = cookies();
      await openSession(jar, other.id, 'test');
      const form = (o: Record<string, string>) => Object.entries(o).reduce((f, [k, v]) => (f.set(k, v), f), new FormData());
      assert.ok((await clientAction(admin.id, form({ action: 'block', id: String(other.id) }))).ok);
      assert.equal(await readSession((jar as { get: (k: string) => { value: string } }).get('__Host-mb_session').value), null);
      assert.equal(await login(other.email, password, '10.0.0.3'), null);
      assert.ok((await clientAction(admin.id, form({ action: 'unblock', id: String(other.id) }))).ok);
      assert.ok(await login(other.email, password, '10.0.0.3'));
      // La gérante n'apparaît jamais comme cliente et ne peut pas être effacée par la fiche
      assert.equal(await clientDetail(admin.id), null);
      assert.equal((await clientAction(admin.id, form({ action: 'erase', id: String(admin.id), confirm: 'EFFACER' }))).ok, false);
      assert.ok((await listClients(other.email, 'toutes', 1)).rows.some((r) => r.id === other.id));
      assert.ok((await clientAction(admin.id, form({ action: 'notes', id: String(other.id), notes: 'Préfère le matin.' }))).ok);
    });

    await t.test('export : compte, notes de l\'institut et rendez-vous', async () => {
      const data = await rgpd.exportData(other.id, '127.0.0.1');
      assert.equal(data.account.email, other.email);
      assert.equal(data.account.institute_notes, 'Préfère le matin.');
      assert.ok(Array.isArray(data.bookings));
    });

    await t.test('acompte rendu hors site, absence, rappel unique', async () => {
      const past = new Date(Date.now() - 3 * 86_400_000);
      const [c] = await sql`INSERT INTO bookings (user_id, service_id, starts_at, ends_at, status, price_cents, deposit_cents, stripe_payment_intent, cancel_reason)
        VALUES (${other.id}, ${svc.id}, ${past}, ${new Date(past.getTime() + 3600_000)}, 'cancelled', 5000, 2000, ${`pi_${tag}`}, 'account_deleted') RETURNING id`;
      assert.deepEqual(await booking.markRefundedManually(c.id), { amount: 2000, user_id: other.id });
      assert.equal(await booking.markRefundedManually(c.id), null);
      const [p] = await sql`INSERT INTO bookings (user_id, service_id, starts_at, ends_at, status, price_cents)
        VALUES (${other.id}, ${svc.id}, ${new Date(past.getTime() - 86_400_000)}, ${past}, 'confirmed', 5000) RETURNING id`;
      assert.deepEqual(await booking.setNoShow(p.id, true), { user_id: other.id });
      const soon = new Date(Date.now() + 20 * 3600_000);
      await sql`INSERT INTO bookings (user_id, service_id, starts_at, ends_at, status, price_cents, created_at)
        VALUES (${other.id}, ${svc.id}, ${soon}, ${new Date(soon.getTime() + 3600_000)}, 'confirmed', 5000, now() - interval '3 days')`;
      assert.ok((await booking.sendReminders()) >= 1);
      assert.equal(await booking.sendReminders(), 0);
    });

    await t.test('compte supprimé : plus de réservation ; recherche par téléphone ; export sans IP de tiers', async () => {
      await sql`UPDATE users SET deleted_at = now(), phone = '0470 12 34 56' WHERE id = ${other.id}`;
      const r = await booking.createBooking({ userId: other.id, serviceId: svc.id, startsAt: await at('13:30'), lang: 'fr' });
      assert.deepEqual(r, { ok: false, error: 'unavailable' });
      await sql`UPDATE users SET deleted_at = NULL WHERE id = ${other.id}`;
      assert.ok((await listClients('0470 123', 'toutes', 1)).rows.some((x) => x.id === other.id));
      assert.equal((await listClients('100%', 'toutes', 1)).rows.length, 0);
      await login(other.email, 'faux mot de passe', '203.0.113.9');
      await new Promise((res) => setTimeout(res, 200));
      const data = await rgpd.exportData(other.id, '127.0.0.1');
      assert.ok(!JSON.stringify(data).includes('203.0.113.9'));
    });

    await t.test('effacement immédiat par la cliente', async () => {
      assert.equal(await rgpd.eraseNow(cookies(), other, password, '127.0.0.1'), 'ok');
      assert.equal((await sql`SELECT 1 FROM users WHERE id = ${other.id}`).length, 0);
      const rows = await sql`SELECT client_erased, user_id FROM bookings WHERE service_id = ${svc.id} AND client_erased`;
      assert.ok(rows.length >= 3 && rows.every((r) => r.user_id === null));
    });
  } finally {
    await sql.end();
  }
});
