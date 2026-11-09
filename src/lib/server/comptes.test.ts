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
      assert.ok((await clientAction(admin.id, form({ action: 'block', id: String(other.id), confirm: 'on' }))).ok);
      assert.equal(await readSession((jar as { get: (k: string) => { value: string } }).get('__Host-mb_session').value), null);
      assert.equal(await login(other.email, password, '10.0.0.3'), null);
      assert.ok((await clientAction(admin.id, form({ action: 'unblock', id: String(other.id), confirm: 'on' }))).ok);
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
      assert.deepEqual(await booking.setLate(p.id, 15), null, 'pas de retard sur une absence');
      assert.deepEqual(await booking.setNoShow(p.id, false), { user_id: other.id });
      assert.deepEqual(await booking.setLate(p.id, 15), { user_id: other.id });
      await assert.rejects(booking.setLate(p.id, 300), 'retard borné à 240 min');
      assert.deepEqual(await booking.setNoShow(p.id, true), { user_id: other.id });
      assert.equal((await sql`SELECT late_minutes FROM bookings WHERE id = ${p.id}`)[0].late_minutes, null, "l'absence efface le retard");
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

    const accounts = await import('./accounts.ts');
    const { hashToken, newToken } = await import('./cookie.ts');
    const who = (sub: string, email: string, emailVerified = true) => ({ provider: 'google' as const, subject: `${tag}${sub}`, email, emailVerified, name: 'Test' });

    await t.test("Google : nouveau compte vérifié, puis même identité = même compte même si l'adresse change", async () => {
      const first = await accounts.signInExternal(cookies(), who('g1', `${tag}g1@gmail.test`), 'fr', '127.0.0.1', null);
      assert.ok(first);
      const [u] = await sql`SELECT email_verified_at FROM users WHERE id = ${first.id}`;
      assert.ok(u.email_verified_at);
      const again = await accounts.signInExternal(cookies(), who('g1', `${tag}autre@gmail.test`), 'fr', '127.0.0.1', null);
      assert.equal(again?.id, first.id);
    });

    await t.test('Google : compte existant de même adresse relié, sans toucher à son mot de passe', async () => {
      const c = await mkUser('lie');
      const r = await accounts.signInExternal(cookies(), who('g2', c.email), 'fr', '127.0.0.1', null);
      assert.equal(r?.id, c.id);
      assert.ok(await login(c.email, password, '127.0.0.2'));
    });

    await t.test("compte jamais confirmé : repris par la propriétaire de l'adresse, le mot de passe choisi par un tiers ne marche plus", async () => {
      const email = `${tag}squat@test.local`;
      const [s] = await sql`INSERT INTO users (email, password_hash) VALUES (${email}, ${hash}) RETURNING id`;
      const r = await accounts.signInExternal(cookies(), who('g3', email), 'fr', '127.0.0.1', null);
      assert.equal(r?.id, s.id);
      assert.equal(await login(email, password, '127.0.0.3'), null);
    });

    await t.test('refusés : adresse non garantie par le fournisseur, adresse de la gérante, compte bloqué', async () => {
      assert.equal(await accounts.signInExternal(cookies(), who('g4', `${tag}nv@test.local`, false), 'fr', '127.0.0.1', null), null);
      assert.equal(await accounts.signInExternal(cookies(), who('g5', 'gerante@test.local'), 'fr', '127.0.0.1', null), null);
      const c = await mkUser('bloque');
      await sql`UPDATE users SET blocked_at = now() WHERE id = ${c.id}`;
      assert.equal(await accounts.signInExternal(cookies(), who('g6', c.email), 'fr', '127.0.0.1', null), null);
    });

    await t.test('« Se souvenir de moi » : 30 jours et cookie persistant si cochée, 30 min et cookie de session sinon', async () => {
      const u = await mkUser('souvenir');
      const opened = async (remember: boolean) => {
        const jar = new Map<string, { v: string; o: { maxAge?: number } }>();
        const c = { get: (k: string) => (jar.has(k) ? { value: jar.get(k)!.v } : undefined), set: (k: string, v: string, o: { maxAge?: number }) => jar.set(k, { v, o }), delete: (k: string) => jar.delete(k) } as never;
        await openSession(c, u.id, 'test', false, remember);
        const { v, o } = jar.get('__Host-mb_session')!;
        const [row] = await sql`SELECT remember, round(extract(epoch FROM expires_at - created_at) / 3600) AS hours FROM sessions WHERE user_id = ${u.id} ORDER BY created_at DESC LIMIT 1`;
        return { token: v, maxAge: o.maxAge, remember: row.remember, hours: Number(row.hours) };
      };
      const long = await opened(true);
      assert.deepEqual({ ...long, token: 0 }, { token: 0, maxAge: 30 * 24 * 3600, remember: true, hours: 30 * 24 });
      const short = await opened(false);
      assert.deepEqual({ ...short, token: 0 }, { token: 0, maxAge: undefined, remember: false, hours: 12 });
      // Deux heures sans activité : seule la session « souvenir » tient encore
      await sql`UPDATE sessions SET last_seen_at = now() - interval '2 hours' WHERE user_id = ${u.id}`;
      assert.ok(await readSession(long.token));
      assert.equal(await readSession(short.token), null);
    });

    await t.test('lien de connexion : ouvre la session une seule fois, refusé expiré', async () => {
      const c = await mkUser('lien');
      const token = newToken();
      await sql`INSERT INTO email_tokens (token_hash, user_id, purpose, expires_at) VALUES (${hashToken(token)}, ${c.id}, 'login', now() + interval '15 minutes')`;
      assert.equal((await accounts.signInWithLink(cookies(), token, '127.0.0.1', null))?.id, c.id);
      assert.equal(await accounts.signInWithLink(cookies(), token, '127.0.0.1', null), null);
      const old = newToken();
      await sql`INSERT INTO email_tokens (token_hash, user_id, purpose, expires_at) VALUES (${hashToken(old)}, ${c.id}, 'login', now() - interval '1 minute')`;
      assert.equal(await accounts.signInWithLink(cookies(), old, '127.0.0.1', null), null);
    });

    await t.test("équipe : ni lien de connexion ni Google, mot de passe et TOTP seulement", async () => {
      const g = await mkUser('equipe-lien');
      await sql`UPDATE users SET role = 'gestionnaire', role_at = now() WHERE id = ${g.id}`;
      const token = newToken();
      await sql`INSERT INTO email_tokens (token_hash, user_id, purpose, expires_at) VALUES (${hashToken(token)}, ${g.id}, 'login', now() + interval '15 minutes')`;
      assert.equal(await accounts.signInWithLink(cookies(), token, '127.0.0.1', null), null);
      assert.equal(await accounts.signInExternal(cookies(), who('g7', g.email), 'fr', '127.0.0.1', null), null);
      assert.equal((await sql`SELECT count(*)::int AS n FROM sessions WHERE user_id = ${g.id}`)[0].n, 0);
    });

    await t.test("équipe : rôle, second facteur propre, gardes, désactivation et suppression douce", async () => {
      const { listStaff, staffAction, totpState } = await import('./staff.ts');
      const { base32Decode, totp } = await import('./totp.ts');
      const form = (o: Record<string, string>) => Object.entries(o).reduce((f, [k, v]) => (f.set(k, v), f), new FormData());
      const tok = (j: unknown) => (j as { get: (k: string) => { value: string } }).get('__Host-mb_session').value;
      const [boss] = await sql`INSERT INTO users (email, password_hash, email_verified_at) VALUES (${ENV.ADMIN_EMAIL}, ${hash}, now())
        ON CONFLICT (email) DO UPDATE SET email_verified_at = now() RETURNING id`;
      const g = await mkUser('gest');
      const x = await mkUser('cliente');
      const ok = async (actor: number, o: Record<string, string>) => (await staffAction(actor, form({ confirm: 'on', ...o }))).ok;
      // Case « Je confirme » exigée côté serveur ; adresse lue sans casse
      assert.equal((await staffAction(boss.id, form({ action: 'grant', email: g.email, role: 'gestionnaire' }))).ok, false);
      // Session de cliente ouverte avant le rôle : fermée par l'attribution, elle ne voit jamais la clé
      const before = cookies();
      await openSession(before, g.id, 'test');
      const old = (await readSession(tok(before)))!;
      assert.ok(await ok(boss.id, { action: 'grant', email: g.email.toUpperCase(), role: 'gestionnaire' }));
      assert.equal(await readSession(tok(before)), null);
      assert.equal((await totpState({ ...old.user, role: 'gestionnaire' }, old.session.createdAt))?.kind, 'relogin');
      // Gérante intouchable, personne n'agit sur soi-même
      assert.equal(await ok(boss.id, { action: 'grant', email: ENV.ADMIN_EMAIL, role: 'admin' }), false);
      // « Tous les comptes » : rôle choisi sur la ligne (par id), mêmes garde-fous ; liste sans équipe, gérante ni comptes supprimés
      const { listAccounts } = await import('./staff.ts');
      const y = await mkUser('ligne');
      const [unv] = await sql`INSERT INTO users (email, password_hash, name) VALUES (${`${tag}nonconf@test.local`}, ${hash}, ${`Zz ${tag}`}) RETURNING id`;
      const [gone] = await sql`INSERT INTO users (email, password_hash, email_verified_at, removed_at) VALUES (${`${tag}parti@test.local`}, ${hash}, now(), now()) RETURNING id`;
      const listed = (await listAccounts(tag, 'recent', 1)).rows.map((r) => r.id);
      assert.ok(listed.includes(y.id) && listed.includes(unv.id), 'clientes listées, adresse confirmée ou non');
      assert.ok(!listed.includes(g.id) && !listed.includes(gone.id) && !listed.includes(boss.id), 'ni équipe, ni compte supprimé, ni gérante');
      assert.equal(await ok(boss.id, { action: 'assign', id: String(unv.id), role: 'gestionnaire' }), false, 'adresse non confirmée');
      assert.equal(await ok(boss.id, { action: 'assign', id: String(boss.id), role: 'admin' }), false, 'soi-même');
      assert.equal(await ok(boss.id, { action: 'assign', id: String(y.id), role: 'none' }), false, 'déjà cliente');
      assert.ok(await ok(boss.id, { action: 'assign', id: String(y.id), role: 'admin' }));
      assert.equal((await sql`SELECT role FROM users WHERE id = ${y.id}`)[0].role, 'admin');
      assert.ok(!(await listAccounts(tag, 'nom', 1)).rows.some((r) => r.id === y.id), 'promue : sort de « Tous les comptes »');
      assert.ok(await ok(boss.id, { action: 'assign', id: String(y.id), role: 'none' }));
      assert.equal((await sql`SELECT role FROM users WHERE id = ${y.id}`)[0].role, null, 'rétrogradée : redevient cliente');
      assert.equal(await ok(boss.id, { action: 'block', id: String(boss.id) }), false);
      assert.equal(await ok(g.id, { action: 'remove', id: String(boss.id) }), false);
      assert.equal(await ok(boss.id, { action: 'grant', email: `${tag}inconnue@test.local`, role: 'admin' }), false);

      // Session : rôle lu en base ; secret propre affiché puis validé par le premier code, chiffré en base
      const jar = cookies();
      await openSession(jar, g.id, 'test');
      const s = (await readSession(tok(jar)))!;
      assert.equal(s.user.role, 'gestionnaire');
      const st = await totpState(s.user, s.session.createdAt);
      assert.equal(st?.kind, 'enrol');
      const secret = (st as { secret: string }).secret;
      assert.equal(((await totpState(s.user, s.session.createdAt)) as { secret: string }).secret, secret);
      assert.equal(await accounts.verifyAdminTotp(jar, s.user, s.session.createdAt, '000000', 'test', '127.0.0.1'), false);
      assert.ok(await accounts.verifyAdminTotp(jar, s.user, s.session.createdAt, totp(base32Decode(secret), Math.floor(Date.now() / 30_000)), 'test', '127.0.0.1'));
      assert.equal((await totpState(s.user, s.session.createdAt))?.kind, 'ready');
      const [row] = await sql`SELECT totp_secret FROM users WHERE id = ${g.id}`;
      assert.ok(!Buffer.from(row.totp_secret).includes(Buffer.from(secret)));
      assert.ok((await readSession(tok(jar)))!.session.mfaAt);

      // La gestionnaire n'est pas une cliente ; elle écrit les notes mais n'agit pas sur un compte
      assert.equal(await clientDetail(g.id), null);
      assert.equal((await listClients(g.email, 'toutes', 1)).rows.length, 0);
      assert.equal((await clientAction(g.id, form({ action: 'block', id: String(x.id), confirm: 'on' }), false)).ok, false);
      assert.ok((await clientAction(g.id, form({ action: 'notes', id: String(x.id), notes: 'Peau sensible.' }), false)).ok);

      // Suppression douce d'une cliente : session coupée, connexion refusée, masquée, épargnée par la purge, restaurable
      const jx = cookies();
      await openSession(jx, x.id, 'test');
      assert.ok((await clientAction(boss.id, form({ action: 'remove', id: String(x.id), confirm: 'on' }))).ok);
      assert.equal(await readSession(tok(jx)), null);
      assert.equal(await login(x.email, password, '10.0.0.4'), null);
      assert.equal((await listClients(x.email, 'toutes', 1)).rows.length, 0);
      assert.ok((await listClients(x.email, 'supprimees', 1)).rows.some((r) => r.id === x.id));
      await purge(sql, ENV.ADMIN_EMAIL);
      assert.equal((await sql`SELECT 1 FROM users WHERE id = ${x.id}`).length, 1);
      assert.ok((await clientAction(boss.id, form({ action: 'unremove', id: String(x.id), confirm: 'on' }))).ok);
      assert.ok(await login(x.email, password, '10.0.0.4'));

      // Équipe : désactiver coupe la session, supprimer masque sans effacer, rétrograder retire rôle et secret
      assert.ok(await ok(boss.id, { action: 'block', id: String(g.id) }));
      assert.equal(await readSession(tok(jar)), null);
      assert.equal(await login(g.email, password, '10.0.0.5'), null);
      assert.ok(await ok(boss.id, { action: 'unblock', id: String(g.id) }));
      assert.ok(await ok(boss.id, { action: 'remove', id: String(g.id) }));
      assert.ok((await listStaff()).some((r) => r.id === g.id && r.removed_at));
      assert.ok(await ok(boss.id, { action: 'restore', id: String(g.id) }));
      assert.ok(await ok(boss.id, { action: 'role', id: String(g.id), role: 'admin' }));
      assert.ok(await ok(boss.id, { action: 'demote', id: String(g.id) }));
      const [d] = await sql`SELECT role, totp_secret FROM users WHERE id = ${g.id}`;
      assert.deepEqual({ ...d }, { role: null, totp_secret: null });

      // Délai de 7 jours passé : plus d'enregistrement possible tant que l'admin ne le relance pas
      assert.ok(await ok(boss.id, { action: 'grant', email: g.email, role: 'admin' }));
      await sql`UPDATE users SET role_at = now() - interval '8 days' WHERE id = ${g.id}`;
      assert.equal((await totpState({ id: g.id, email: g.email, role: 'admin' }, new Date()))?.kind, 'expired');
      assert.ok(await ok(boss.id, { action: 'reset_totp', id: String(g.id) }));
      assert.equal((await totpState({ id: g.id, email: g.email, role: 'admin' }, new Date(Date.now() + 1000)))?.kind, 'enrol');
      // Une personne de l'équipe ne supprime pas son compte elle-même, et l'effacement par la fiche la refuse
      assert.equal(await rgpd.deleteAccount(cookies(), g, password, '127.0.0.1'), 'admin');

      const [{ n }] = await sql`SELECT count(*)::int AS n FROM audit_log WHERE actor_id = ${boss.id}
        AND details->>'action' IN ('staff_role_given', 'account_removed', 'account_restored', 'account_disabled', 'staff_role_removed', 'staff_totp_reset')`;
      assert.ok(n >= 8);
    });
  } finally {
    // Rendez-vous du test retirés : relancée sur la même base, la suite ne bute plus sur bookings_no_overlap
    await sql`DELETE FROM bookings WHERE service_id IN (SELECT id FROM services WHERE slug = ${tag})`;
    await sql`DELETE FROM services WHERE slug = ${tag}`;
    await sql.end();
  }
});
