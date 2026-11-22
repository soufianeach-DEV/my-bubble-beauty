// Nouvelle cliente créée par l'équipe depuis l'admin, sur une base jetable (TEST_DATABASE_URL=postgres://…/base_de_test npm test) :
// compte vérifié d'office, jeton reset de 24 h, mail dans la langue choisie, adresse déjà prise refusée sans mail, gestionnaire autorisée.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const url = process.env.TEST_DATABASE_URL;
// Clé Resend factice : l'envoi passe par le fetch remplacé ci-dessous, rien ne sort
const ENV = { SITE_URL: 'https://test.local', ADMIN_EMAIL: 'gerante@test.local', ADMIN_TOTP_SECRET: 'JBSWY3DPEHPK3PXP', PASSWORD_PEPPER: 'poivre-de-test-32-caracteres-min!', RESEND_API_KEY: 're_test', MAIL_FROM: 'test@test.local' };
Object.assign(process.env, ENV);
registerHooks({
  resolve: (spec, ctx, next) =>
    spec === 'astro:env/server'
      ? { url: 'data:text/javascript,export const { DATABASE_URL, SITE_URL, ADMIN_EMAIL, ADMIN_TOTP_SECRET, PASSWORD_PEPPER, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, RESEND_API_KEY, MAIL_FROM } = process.env;', shortCircuit: true }
      : next(spec, ctx),
  load: (u, ctx, next) => next(u, u.endsWith('.json') ? { ...ctx, importAttributes: { type: 'json' } } : ctx),
});

test('nouvelle cliente créée depuis l\'admin', { skip: !url && 'TEST_DATABASE_URL absente' }, async (t) => {
  process.env.DATABASE_URL = url;
  const { sql } = await import('./db.ts');
  const { migrate } = await import('../../../db/migrate.mjs');
  const { purge } = await import('../../../db/purge.mjs');
  const { hashPassword } = await import('./auth.ts');
  const { hashToken } = await import('./cookie.ts');
  const { createClient, listClients } = await import('./admin-clientes.ts');
  const { giftClients } = await import('./cadeaux.ts');
  const { resetPassword } = await import('./accounts.ts');
  const { hit } = await import('./rate.ts');
  await migrate(sql);

  // Mails capturés ; tout autre appel (HIBP) répond « mot de passe inconnu »
  const mails: { to: string[]; subject: string; text: string }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (u: string | URL, init?: RequestInit) => {
    if (String(u).includes('api.resend.com')) {
      mails.push(JSON.parse(String(init?.body)));
      return new Response('{}', { status: 200 });
    }
    return new Response('', { status: 200 });
  }) as typeof fetch;
  t.after(async () => {
    globalThis.fetch = realFetch;
    await sql.end();
  });

  const tag = `n${Date.now()}`;
  const hash = await hashPassword('Un mot de passe de test assez long');
  const [admin] = await sql`INSERT INTO users (email, password_hash, email_verified_at, role, role_at) VALUES (${`${tag}-admin@test.local`}, ${hash}, now(), 'admin', now()) RETURNING id`;
  const [gest] = await sql`INSERT INTO users (email, password_hash, email_verified_at, role, role_at) VALUES (${`${tag}-gest@test.local`}, ${hash}, now(), 'gestionnaire', now()) RETURNING id`;
  const form = (o: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries({ action: 'create', ...o })) f.set(k, v);
    return f;
  };
  const email = `${tag}-lea@test.local`;

  await t.test('création : compte vérifié, jeton de 24 h, mail dans sa langue, journal', async () => {
    const r = await createClient(Number(admin.id), form({ name: ' Léa Dupont ', email: email.toUpperCase(), phone: '0484 11 83 95', locale: 'nl' }));
    assert.ok(r.ok);
    assert.equal(r.key, 'cree');
    const id = r.id;
    const [u] = await sql`SELECT email, name, phone, locale, email_verified_at IS NOT NULL AS verified, role FROM users WHERE id = ${id}`;
    assert.deepEqual({ ...u }, { email, name: 'Léa Dupont', phone: '0484 11 83 95', locale: 'nl', verified: true, role: null });
    const [tok] = await sql`SELECT purpose, used_at, expires_at > now() + interval '23 hours 59 minutes' AND expires_at <= now() + interval '24 hours' AS day FROM email_tokens WHERE user_id = ${id}`;
    assert.deepEqual({ ...tok }, { purpose: 'reset', used_at: null, day: true });
    assert.equal(mails.length, 1);
    assert.deepEqual(mails[0].to, [email]);
    assert.equal(mails[0].subject, 'Uw account bij My Bubble Beauty');
    assert.match(mails[0].text, /24 uur geldig/);
    const token = mails[0].text.match(/\/compte\/nouveau-mot-de-passe\?token=([\w-]+)/)?.[1];
    assert.ok(token, 'lien de mot de passe dans le mail');
    const [same] = await sql`SELECT 1 FROM email_tokens WHERE token_hash = ${hashToken(token)} AND user_id = ${id}`;
    assert.ok(same, 'le jeton du mail est celui de la base');
    // journal() n'est pas attendu par createClient : l'écriture peut suivre de peu
    await new Promise((ok) => setTimeout(ok, 50));
    const [j] = await sql`SELECT actor_id FROM audit_log WHERE action = 'client_created' AND client_id = ${id}`;
    assert.equal(Number(j.actor_id), Number(admin.id));
    // Visible tout de suite : liste des clientes et choix de la cliente pour un rendez-vous
    assert.ok((await listClients(tag, 'actives', 1)).rows.some((c) => Number(c.id) === id));
    assert.ok((await giftClients()).some((c) => Number(c.id) === id));
    // Le lien sert une fois et fixe le mot de passe
    assert.equal(await resetPassword(token, 'Un autre mot de passe assez long'), 'ok');
    assert.equal(await resetPassword(token, 'Un autre mot de passe assez long'), 'invalid');
    // Activé ou pas, la purge des adresses non confirmées (7 jours) ne l'efface pas
    await sql`UPDATE users SET created_at = now() - interval '8 days' WHERE id = ${id}`;
    await purge(sql, ENV.ADMIN_EMAIL);
    assert.equal((await sql`SELECT 1 FROM users WHERE id = ${id}`).length, 1);
  });

  await t.test('adresse déjà prise : refus, aucun mail, aucun doublon', async () => {
    const before = mails.length;
    const r = await createClient(Number(admin.id), form({ name: 'Autre', email }));
    assert.deepEqual(r, { ok: false, error: 'Cette adresse a déjà un compte.' });
    assert.equal(mails.length, before);
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM users WHERE email = ${email}`;
    assert.equal(n, 1);
  });

  await t.test('gestionnaire autorisée, langue française par défaut', async () => {
    const r = await createClient(Number(gest.id), form({ name: 'Nora', email: `${tag}-nora@test.local` }));
    assert.ok(r.ok);
    assert.equal(r.key, 'cree');
    const [u] = await sql`SELECT locale, phone FROM users WHERE email = ${`${tag}-nora@test.local`}`;
    assert.deepEqual({ ...u }, { locale: 'fr', phone: null });
    assert.equal(mails.at(-1)!.subject, 'Votre compte My Bubble Beauty');
  });

  await t.test('saisies refusées : adresse invalide, adresse de la gérante, nom vide', async () => {
    assert.deepEqual(await createClient(Number(admin.id), form({ name: 'X', email: 'pas-une-adresse' })), { ok: false, error: 'Adresse e-mail invalide.' });
    assert.deepEqual(await createClient(Number(admin.id), form({ name: 'X', email: ENV.ADMIN_EMAIL })), { ok: false, error: 'Adresse e-mail invalide.' });
    assert.equal((await createClient(Number(admin.id), form({ name: '', email: `${tag}-vide@test.local` }))).ok, false);
  });

  await t.test('garde-fou : 50 créations par heure et par membre de l\'équipe', async () => {
    const [x] = await sql`INSERT INTO users (email, password_hash, email_verified_at, role, role_at) VALUES (${`${tag}-x@test.local`}, ${hash}, now(), 'admin', now()) RETURNING id`;
    for (let i = 0; i < 50; i++) hit('clientCreate', String(x.id));
    const r = await createClient(Number(x.id), form({ name: 'Y', email: `${tag}-y@test.local` }));
    assert.deepEqual(r, { ok: false, error: 'Trop de comptes créés en une heure. Réessayez plus tard.' });
    assert.equal((await sql`SELECT 1 FROM users WHERE email = ${`${tag}-y@test.local`}`).length, 0);
  });

  await t.test('mail qui ne part pas : compte créé, échec dit', async () => {
    globalThis.fetch = (async () => new Response('', { status: 500 })) as typeof fetch;
    const r = await createClient(Number(admin.id), form({ name: 'Zoé', email: `${tag}-zoe@test.local` }));
    assert.ok(r.ok);
    assert.equal(r.key, 'cree-sans-mail');
  });
});
