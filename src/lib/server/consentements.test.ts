// Sur une base jetable (TEST_DATABASE_URL=… npm test) : consentement laser demandé avant le rendez-vous, signé avec la mention,
// texte figé et vérifiable, cloisonné entre clientes, rien de personnel au journal, effacé avec le compte.
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

test('consentements sur une vraie base', { skip: !url && 'TEST_DATABASE_URL absente' }, async () => {
  process.env.DATABASE_URL = url;
  const { sql } = await import('./db.ts');
  const { migrate } = await import('../../../db/migrate.mjs');
  const cons = await import('./consentements.ts');
  const rgpd = await import('./rgpd.ts');
  const tag = `k${Date.now()}`;
  const mk = async (n: string) => (await sql`INSERT INTO users (email, password_hash, name, email_verified_at) VALUES (${`${tag}${n}@test.local`}, 'x', ${n}, now()) RETURNING id`)[0].id as number;
  try {
    await migrate(sql);
    const cl = await mk('cliente');
    const other = await mk('autre');
    const [laser] = await sql`INSERT INTO services (slug, category, name_fr, name_nl, name_en, duration_min, price_cents, active)
      VALUES (${`laser-${tag}`}, 'epilation', 'Laser test', 'Laser test', 'Laser test', 30, 4500, true) RETURNING id`;
    const soon = new Date(Date.now() + 40 * 86_400_000);
    await sql`INSERT INTO bookings (user_id, service_id, starts_at, ends_at, status, price_cents)
      VALUES (${cl}, ${laser.id}, ${soon}, ${new Date(soon.getTime() + 1_800_000)}, 'confirmed', 4500)`;
    assert.deepEqual(await cons.pendingConsents(cl), ['laser']);
    assert.deepEqual(await cons.pendingConsents(other), []);

    const sign = (mention: string, name = 'Cliente Test') => cons.signConsent({ userId: cl, kind: 'laser', signerName: name, mention, ip: '127.0.0.1', userAgent: 'test' });
    // Sans nom du spécialiste réglé, le texte serait incomplet : rien n'est signé
    await sql`UPDATE settings SET value = '""' WHERE key = 'specialist_name'`;
    assert.deepEqual(await sign('Lu et approuvé'), { ok: false, error: 'specialist' });
    await sql`INSERT INTO settings (key, value) VALUES ('specialist_name', '"Spécialiste Test"') ON CONFLICT (key) DO UPDATE SET value = excluded.value`;
    assert.deepEqual(await sign('lu'), { ok: false, error: 'mention' });
    assert.deepEqual(await sign('Lu et approuvé', 'X'), { ok: false, error: 'name' });
    const r = await sign(' lu  et APPROUVÉ ');
    assert.ok(r.ok);
    assert.deepEqual(await cons.pendingConsents(cl), []);

    const c = (await cons.readConsent(cl, (r as { id: number }).id))!;
    assert.ok(c.intact);
    assert.equal(c.mention, 'Lu et approuvé');
    assert.equal(c.channel, 'online');
    assert.ok(c.text.includes('poser toutes les questions à Spécialiste Test'));
    // Une autre cliente ne lit pas ce consentement
    assert.equal(await cons.readConsent(other, c.id), null);
    // Texte modifié en base après coup : l'empreinte le signale
    await sql`UPDATE consents SET text = text || ' ' WHERE id = ${c.id}`;
    assert.equal((await cons.readConsent(cl, c.id))!.intact, false);
    // Ni nom ni texte au journal
    const [j] = await sql`SELECT details FROM audit_log WHERE action = 'consent_signed' AND client_id = ${cl}`;
    assert.deepEqual(j.details, { kind: 'laser', version: cons.FORMS.laser.version, channel: 'online' });
    // Export de la cliente : son consentement y figure ; effacement : il part avec le compte
    assert.equal((await rgpd.exportData(cl, '127.0.0.1')).consents.length, 1);
    await rgpd.eraseUser(cl, cl, null, 'self');
    assert.equal((await sql`SELECT 1 FROM consents WHERE user_id = ${cl}`).length, 0);

    // Suivi des séances : antécédents refusés sans accord santé, chiffrés avec, effacés au retrait de l'accord ; zone d'une séance réalisée
    const sv = await import('./suivi.ts');
    const f = (o: Record<string, string>) => Object.entries(o).reduce((x, [k, v]) => (x.set(k, v), x), new FormData());
    const health = { action: 'health', id: String(other), birth_date: '1990-05-04', medical_history: 'Allergie au latex' };
    assert.equal((await sv.suiviAction(other, f(health))).ok, false);
    await rgpd.setConsent(other, true, '127.0.0.1');
    const saved = await sv.suiviAction(other, f(health));
    assert.ok(saved.ok, JSON.stringify(saved));
    const [row] = await sql`SELECT medical_history, birth_date::text FROM users WHERE id = ${other}`;
    assert.ok(!Buffer.from(row.medical_history).includes(Buffer.from('latex')));
    assert.equal((await sv.suivi(other)).history, 'Allergie au latex');
    const [h] = await sql`SELECT details FROM audit_log WHERE details->>'action' = 'client_health' AND client_id = ${other}`;
    assert.equal(JSON.stringify(h.details).includes('latex'), false);
    await rgpd.setConsent(other, false, '127.0.0.1');
    assert.equal((await sql`SELECT medical_history FROM users WHERE id = ${other}`)[0].medical_history, null);
    const past = new Date(Date.now() - 50 * 86_400_000);
    const [b] = await sql`INSERT INTO bookings (user_id, service_id, starts_at, ends_at, status, price_cents)
      VALUES (${other}, ${laser.id}, ${past}, ${new Date(past.getTime() + 1_800_000)}, 'confirmed', 4500) RETURNING id`;
    assert.ok((await sv.suiviAction(other, f({ action: 'seance', id: String(other), booking: String(b.id), zone: 'Aisselles', practitioner: '' }))).ok);
    assert.deepEqual((await sv.suivi(other)).seances.map((s) => s.zone), ['Aisselles']);
    // Une séance d'une autre cliente n'est pas modifiable par cette fiche
    assert.equal((await sv.suiviAction(other, f({ action: 'seance', id: String(cl), booking: String(b.id), zone: 'x', practitioner: '' }))).ok, false);
  } finally {
    await sql`DELETE FROM bookings WHERE service_id IN (SELECT id FROM services WHERE slug = ${`laser-${tag}`})`;
    await sql`DELETE FROM services WHERE slug = ${`laser-${tag}`}`;
    await sql`DELETE FROM users WHERE email LIKE ${`${tag}%`}`;
    await sql`DELETE FROM settings WHERE key = 'specialist_name'`;
    await sql.end();
  }
});
