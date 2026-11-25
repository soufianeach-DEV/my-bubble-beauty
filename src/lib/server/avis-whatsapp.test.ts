// Demande d'avis par WhatsApp depuis l'agenda : numéro international, message dans la langue de la cliente, lien wa.me,
// filtre du bouton, et sur une base jetable (TEST_DATABASE_URL=… npm test) une seule demande par cliente.
import { test } from 'node:test';
import assert from 'node:assert/strict';
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

const URL_AVIS = 'https://g.page/r/abc/review';

test('numéro au format wa.me', async () => {
  const { waDigits } = await import('./avis-whatsapp.ts');
  assert.equal(waDigits('0484 11 83 95'), '32484118395', 'numéro belge national');
  assert.equal(waDigits('+32 484 11 83 95'), '32484118395');
  assert.equal(waDigits('0032 (484) 11.83.95'), '32484118395');
  assert.equal(waDigits('+33 6 12 34 56 78'), '33612345678', 'numéro étranger gardé');
  assert.equal(waDigits(''), null);
  assert.equal(waDigits(null), null);
  assert.equal(waDigits('pas de numéro'), null);
});

test('message et lien wa.me, dans la langue de la cliente', async () => {
  const { reviewMessage, waLink } = await import('./avis-whatsapp.ts');
  const fr = reviewMessage('fr', 'Sophie Martin', URL_AVIS);
  assert.equal(fr, 'Coucou ma chère Sophie ❤️\n\nJ’espère que tu vas bien ! 🥰\n\n'
    + 'Si tu as quelques petites minutes, cela me ferait énormément plaisir que tu puisses laisser un petit avis sur Google concernant ton expérience chez moi. '
    + 'Ton retour compte beaucoup pour moi et m’aide énormément à faire connaître mon travail.\n\n'
    + 'Un grand merci pour ta confiance et ta gentillesse ! ❤️\n\nÀ très bientôt 😘\n' + URL_AVIS, 'modèle de Souade mot pour mot, prénom seul, lien en dernière ligne');
  assert.ok(!/ma douce|offert|cadeau|réduction/i.test(fr), 'ni « ma douce » ni contrepartie');
  assert.ok(reviewMessage('nl', 'Els', URL_AVIS).startsWith('Hallo Els') && reviewMessage('en', 'Jo', URL_AVIS).startsWith('Hello Jo'));
  assert.ok(reviewMessage('fr', null, URL_AVIS).startsWith('Coucou ma chère ❤️\n'), 'sans prénom : pas de trou');
  const link = waLink('32484118395', fr);
  assert.ok(link.startsWith('https://wa.me/32484118395?text=Coucou%20ma%20ch%C3%A8re%20Sophie%20%E2%9D%A4%EF%B8%8F'), 'cœur encodé');
  assert.ok(link.includes('J%E2%80%99esp%C3%A8re') && link.includes('%F0%9F%A5%B0') && link.includes('%F0%9F%98%98'), 'apostrophe typographique et emojis encodés');
  assert.equal(decodeURIComponent(link.split('?text=')[1]), fr, 'texte encodé sans perte');
  assert.ok(!/[\s]/.test(link), 'aucun espace ni saut de ligne brut');
});

test('filtre du bouton', async () => {
  const { canAskReview } = await import('./avis-whatsapp.ts');
  const ok = { status: 'confirmed', past: true, no_show: false, phone: '0484 11 83 95' };
  assert.ok(canAskReview(ok, URL_AVIS));
  assert.ok(!canAskReview(ok, undefined), 'lien Google absent : pas de bouton');
  assert.ok(!canAskReview({ ...ok, phone: null }, URL_AVIS), 'numéro absent');
  assert.ok(!canAskReview({ ...ok, status: 'cancelled' }, URL_AVIS), 'rendez-vous annulé');
  assert.ok(!canAskReview({ ...ok, past: false }, URL_AVIS), 'rendez-vous à venir');
  assert.ok(!canAskReview({ ...ok, no_show: true }, URL_AVIS), 'cliente absente');
});

test('une seule demande par cliente, sur une vraie base', { skip: !url && 'TEST_DATABASE_URL absente' }, async () => {
  const { sql } = await import('./db.ts');
  const { migrate } = await import('../../../db/migrate.mjs');
  const { askReview } = await import('./avis-whatsapp.ts');
  const tag = `w${Date.now()}`;
  const local = `0470${String(Date.now()).slice(-6)}`;
  const intl = `32${local.slice(1)}`;
  try {
    await migrate(sql);
    const [svc] = await sql`INSERT INTO services (slug, category, name_fr, name_nl, name_en, duration_min, price_cents, active)
      VALUES (${`soin-${tag}`}, 'visage', 'Soin test', 'x', 'x', 60, 5000, true) RETURNING id`;
    const [u] = await sql`INSERT INTO users (email, password_hash, name, phone, locale) VALUES (${`${tag}@test.local`}, 'x', 'Els Peeters', ${local}, 'nl') RETURNING id`;
    const book = async (hoursAgo: number, extra: { guest?: string; status?: string } = {}) => {
      const end = new Date(Date.now() - hoursAgo * 3_600_000);
      return (await sql`INSERT INTO bookings (user_id, guest_name, guest_phone, service_id, starts_at, ends_at, status, price_cents)
        VALUES (${extra.guest ? null : u.id}, ${extra.guest ? 'Invitée' : null}, ${extra.guest ?? null}, ${svc.id},
          ${new Date(end.getTime() - 600_000)}, ${end}, ${extra.status ?? 'confirmed'}, 5000) RETURNING id`)[0].id as number;
    };
    const b1 = await book(50);
    const b2 = await book(30);
    const cancelled = await book(40, { status: 'cancelled' });
    const staff = u.id as number;
    assert.equal((await askReview(cancelled, staff, URL_AVIS)).ok, false, 'annulé : refusé');
    assert.equal((await askReview(b1, staff, undefined)).ok, false, 'sans lien Google : refusé');
    const r = await askReview(b1, staff, URL_AVIS);
    assert.ok(r.ok && r.url.startsWith(`https://wa.me/${intl}?text=Hallo%20Els`), 'néerlandais, prénom, numéro international');
    assert.equal((await askReview(b2, staff, URL_AVIS)).ok, false, 'même cliente, autre rendez-vous : déjà demandé');
    const guest = await book(20, { guest: `+${intl.slice(0, 2)} ${intl.slice(2)}` });
    assert.equal((await askReview(guest, staff, URL_AVIS)).ok, false, 'même numéro sans compte : déjà demandé');
    const { adminAgenda } = await import('./booking.ts');
    const day = new Date(Date.now() - 52 * 3_600_000).toISOString().slice(0, 10);
    const rows = (await adminAgenda(day, 4)).filter((x) => [b1, b2, guest].includes(x.id));
    assert.equal(rows.length, 3);
    assert.ok(rows.every((x) => x.review_asked_at), 'agenda : mention grisée sur tous ses rendez-vous');
  } finally {
    await sql`DELETE FROM review_asks WHERE phone = ${intl}`;
    await sql`DELETE FROM bookings WHERE service_id IN (SELECT id FROM services WHERE slug = ${`soin-${tag}`})`;
    await sql`DELETE FROM services WHERE slug = ${`soin-${tag}`}`;
    await sql`DELETE FROM users WHERE email = ${`${tag}@test.local`}`;
    await sql.end();
  }
});
