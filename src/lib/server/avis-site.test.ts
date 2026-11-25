// Avis déposé sur le site : bouton Google montré quelle que soit la note, et sur une base jetable (TEST_DATABASE_URL=… npm test)
// un avis par rendez-vous honoré de la cliente connectée, jamais sur celui d'une autre.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

const url = process.env.TEST_DATABASE_URL;
const ENV = { SITE_URL: 'https://test.local', ADMIN_EMAIL: 'gerante@test.local', ADMIN_TOTP_SECRET: 'JBSWY3DPEHPK3PXP', PASSWORD_PEPPER: 'poivre-de-test-32-caracteres-min!' };
Object.assign(process.env, ENV, { DATABASE_URL: url ?? 'postgres://inutilisee@127.0.0.1:1/x' });
registerHooks({
  resolve: (spec, ctx, next) =>
    spec === 'astro:env/server'
      ? { url: 'data:text/javascript,export const { DATABASE_URL, SITE_URL, ADMIN_EMAIL, ADMIN_TOTP_SECRET, PASSWORD_PEPPER, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, RESEND_API_KEY, MAIL_FROM, GBP_CLIENT_ID, GBP_CLIENT_SECRET, GBP_REFRESH_TOKEN, GBP_LOCATION, GOOGLE_REVIEW_URL, TASKS_SECRET } = process.env;', shortCircuit: true }
      : next(spec, ctx),
  load: (u, ctx, next) => next(u, u.endsWith('.json') ? { ...ctx, importAttributes: { type: 'json' } } : ctx),
});

test('page de merci : bouton Google sans condition sur la note (pas de tri des avis)', () => {
  const page = readFileSync(new URL('../../pages/[folder]/compte/avis.astro', import.meta.url), 'utf8');
  const block = page.slice(page.indexOf('{GOOGLE_REVIEW_URL && <div class="to-google">'));
  assert.ok(block.length > 0 && block.includes('data-copy-review="avis-texte"'), 'bouton présent, lié au texte de l’avis');
  assert.ok(!/rating\s*[<>=]/.test(page), 'aucune condition sur la note');
  assert.ok(page.includes('Votre avis est copié, il suffit de le coller sur Google.'));
});

test('un avis par rendez-vous honoré de la cliente', { skip: !url && 'TEST_DATABASE_URL absente' }, async () => {
  const { sql } = await import('./db.ts');
  const { migrate } = await import('../../../db/migrate.mjs');
  const { reviewableBooking, saveSiteReview } = await import('./avis-site.ts');
  const tag = `s${Date.now()}`;
  try {
    await migrate(sql);
    const [svc] = await sql`INSERT INTO services (slug, category, name_fr, name_nl, name_en, duration_min, price_cents, active)
      VALUES (${`soin-${tag}`}, 'visage', 'Soin test', 'x', 'x', 60, 5000, true) RETURNING id`;
    const [u] = await sql`INSERT INTO users (email, password_hash, name, locale) VALUES (${`${tag}@test.local`}, 'x', 'Els', 'nl') RETURNING id`;
    const [o] = await sql`INSERT INTO users (email, password_hash, name, locale) VALUES (${`${tag}-o@test.local`}, 'x', 'Autre', 'fr') RETURNING id`;
    const book = async (hours: number, extra: { status?: string; noShow?: boolean } = {}) => {
      const start = new Date(Date.now() + hours * 3_600_000);
      return (await sql`INSERT INTO bookings (user_id, service_id, starts_at, ends_at, status, price_cents, no_show)
        VALUES (${u.id}, ${svc.id}, ${start}, ${new Date(start.getTime() + 3_600_000)}, ${extra.status ?? 'confirmed'}, 5000, ${extra.noShow ?? false}) RETURNING id`)[0].id as number;
    };
    const past = await book(-48);
    const future = await book(48);
    const missed = await book(-30, { noShow: true });
    const cancelled = await book(-20, { status: 'cancelled' });
    assert.equal(await reviewableBooking(o.id, past, 'fr'), null, 'rendez-vous d’une autre cliente : introuvable');
    for (const b of [future, missed, cancelled]) assert.equal(await saveSiteReview(u.id, b, 5, 'x'), false, 'à venir, manqué ou annulé : refusé');
    assert.equal(await saveSiteReview(o.id, past, 5, 'x'), false, 'autre cliente : refusé');
    assert.equal((await reviewableBooking(u.id, past, 'fr'))?.review, null);
    assert.equal(await saveSiteReview(u.id, past, 2, 'Accueil sympa,\nattente trop longue.'), true);
    assert.equal(await saveSiteReview(u.id, past, 5, 'double envoi'), false, 'un seul avis par rendez-vous');
    assert.deepEqual((await reviewableBooking(u.id, past, 'fr'))?.review, { rating: 2, comment: 'Accueil sympa,\nattente trop longue.' }, 'note basse gardée telle quelle');
  } finally {
    await sql`DELETE FROM bookings WHERE service_id IN (SELECT id FROM services WHERE slug = ${`soin-${tag}`})`;
    await sql`DELETE FROM services WHERE slug = ${`soin-${tag}`}`;
    await sql`DELETE FROM users WHERE email LIKE ${`${tag}%@test.local`}`;
    await sql.end();
  }
});
