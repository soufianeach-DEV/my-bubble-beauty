// Sur une base jetable (TEST_DATABASE_URL=… npm test) : demande d'avis après la prestation (une fois, à toutes, jamais aux absentes,
// annulées ou désinscrites, marquée seulement si le mail part), lien de désinscription signé, copie des avis Google.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const url = process.env.TEST_DATABASE_URL;
const ENV = { SITE_URL: 'https://test.local', ADMIN_EMAIL: 'gerante@test.local', ADMIN_TOTP_SECRET: 'JBSWY3DPEHPK3PXP', PASSWORD_PEPPER: 'poivre-de-test-32-caracteres-min!',
  GBP_CLIENT_ID: 'id', GBP_CLIENT_SECRET: 'secret', GBP_REFRESH_TOKEN: 'rt', GBP_LOCATION: 'accounts/1/locations/2', GOOGLE_REVIEW_URL: 'https://g.page/r/abc/review' };
// Le module astro:env simulé lit process.env une seule fois : la base est connue avant le premier import
Object.assign(process.env, ENV, { DATABASE_URL: url ?? 'postgres://inutilisee@127.0.0.1:1/x' });
registerHooks({
  resolve: (spec, ctx, next) =>
    spec === 'astro:env/server'
      ? { url: 'data:text/javascript,export const { DATABASE_URL, SITE_URL, ADMIN_EMAIL, ADMIN_TOTP_SECRET, PASSWORD_PEPPER, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, RESEND_API_KEY, MAIL_FROM, GBP_CLIENT_ID, GBP_CLIENT_SECRET, GBP_REFRESH_TOKEN, GBP_LOCATION, GOOGLE_REVIEW_URL, TASKS_SECRET } = process.env;', shortCircuit: true }
      : next(spec, ctx),
  load: (u, ctx, next) => next(u, u.endsWith('.json') ? { ...ctx, importAttributes: { type: 'json' } } : ctx),
});

test('mail d’avis : lien Google et lien de désinscription', async () => {
  const { reviewRequestMail } = await import('./mail.ts');
  for (const lang of ['fr', 'nl', 'en'] as const) {
    const m = reviewRequestMail(lang, 'https://g.page/r/abc/review', 'https://test.local/fr/compte/avis-desinscription?u=1&s=x');
    assert.ok(m.text.includes('https://g.page/r/abc/review'));
    assert.equal(m.unsubscribe, 'https://test.local/fr/compte/avis-desinscription?u=1&s=x');
    assert.ok(m.html.includes('avis-desinscription?u=1&#38;s=x'), 'lien échappé dans le HTML');
  }
});

test('jeton du lien suivi : signé, propre au rendez-vous', async () => {
  const { reviewToken, clickUrl, checkReviewToken } = await import('./avis.ts');
  const t = reviewToken(42);
  assert.equal(checkReviewToken(t), 42);
  assert.equal(clickUrl(42), `https://test.local/avis/${t}`);
  assert.equal(checkReviewToken(`43.${t.split('.')[1]}`), null, 'signature d’un autre rendez-vous');
  for (const bad of [undefined, '', '42', '42.', `42.${'A'.repeat(22)}`, `${t}x`, '-1.abc']) assert.equal(checkReviewToken(bad), null, String(bad));
});

test('correspondance de nom : sans accents ni casse, prénom et nom exigés', async () => {
  const { sameName } = await import('./avis.ts');
  assert.ok(sameName('Hélène Dubois', 'helene DUBOIS'));
  assert.ok(sameName('Hélène Dubois', 'Dubois Hélène'), 'ordre libre');
  assert.ok(sameName('Anne-Marie Van den Berg', 'Anne Marie van den Berg'));
  assert.ok(!sameName('Hélène Dubois', 'Hélène'), 'prénom seul : ambigu');
  assert.ok(!sameName('Hélène Dubois', 'Hélène D.'), 'initiale : ambigu');
  assert.ok(!sameName('Hélène Dubois', 'Google'), 'anonyme');
  assert.ok(!sameName(null, 'Hélène Dubois'));
  assert.ok(!sameName('Hélène Dubois', 'Hélène Dupont'));
});

test('avis sur une vraie base', { skip: !url && 'TEST_DATABASE_URL absente' }, async () => {
  const { sql } = await import('./db.ts');
  const { migrate } = await import('../../../db/migrate.mjs');
  const avis = await import('./avis.ts');
  const tag = `a${Date.now()}`;
  const mk = async (n: string) => (await sql`INSERT INTO users (email, password_hash, name, email_verified_at, locale) VALUES (${`${tag}${n}@test.local`}, 'x', ${n}, now(), 'nl') RETURNING id`)[0].id as number;
  const wipe = async () => {
    await sql`DELETE FROM google_reviews`;
    await sql`DELETE FROM settings WHERE key = 'google_reviews'`;
  };
  try {
    await migrate(sql);
    const [svc] = await sql`INSERT INTO services (slug, category, name_fr, name_nl, name_en, duration_min, price_cents, active)
      VALUES (${`soin-${tag}`}, 'visage', 'Soin test', 'x', 'x', 60, 5000, true) RETURNING id`;
    const book = async (user: number, endedMinAgo: number, extra: { status?: string; no_show?: boolean } = {}) => {
      const end = new Date(Date.now() - endedMinAgo * 60_000);
      return (await sql`INSERT INTO bookings (user_id, service_id, starts_at, ends_at, status, price_cents, no_show)
        VALUES (${user}, ${svc.id}, ${new Date(end.getTime() - 600_000)}, ${end}, ${extra.status ?? 'confirmed'}, 5000, ${extra.no_show ?? false}) RETURNING id`)[0].id as number;
    };
    const ok = await mk('contente');
    const absent = await mk('absente');
    const annulee = await mk('annulee');
    const partie = await mk('desinscrite');
    const tropTot = await mk('trop-tot');
    const H = 60;
    const b1 = await book(ok, 25 * H);
    const b1bis = await book(ok, 27 * H); // même journée : une seule demande
    await book(absent, 25.5 * H, { no_show: true });
    await book(annulee, 26 * H, { status: 'cancelled' });
    await book(partie, 26.5 * H);
    await book(tropTot, 10 * H);
    await sql`UPDATE users SET review_mail_optout_at = now() WHERE id = ${partie}`;

    const mine = (to: string) => to.startsWith(tag);
    const URL_AVIS = 'https://g.page/r/abc/review';
    assert.equal(await avis.sendReviewRequests(undefined, async () => true), 0, 'sans lien de la fiche : rien');
    const tried: string[] = [];
    await avis.sendReviewRequests(URL_AVIS, async (to) => (tried.push(to), false));
    assert.deepEqual(tried.filter(mine), [`${tag}contente@test.local`], 'ni absente, ni annulée, ni désinscrite, ni avant 24 h');
    assert.equal((await sql`SELECT count(*)::int AS n FROM bookings WHERE id IN (${b1}, ${b1bis}) AND review_request_sent_at IS NOT NULL`)[0].n, 0, 'refus de Resend : rien de marqué');

    const sent: { to: string; subject: string; text: string }[] = [];
    await avis.sendReviewRequests(URL_AVIS, async (to, m) => (sent.push({ to, ...m }), true));
    const got = sent.filter((s) => mine(s.to));
    assert.equal(got.length, 1);
    assert.equal(got[0].subject, 'Hoe was uw behandeling?', 'langue de la cliente');
    assert.equal((await sql`SELECT count(*)::int AS n FROM bookings WHERE id IN (${b1}, ${b1bis}) AND review_request_sent_at IS NOT NULL`)[0].n, 1);
    const again: string[] = [];
    await avis.sendReviewRequests(URL_AVIS, async (to) => (again.push(to), true));
    assert.deepEqual(again.filter(mine), [], 'une demande par rendez-vous, pas de relance avant 48 h');

    // Relance à J+2 : seulement si la demande est partie ; la désinscription la coupe
    await sql`UPDATE bookings SET starts_at = starts_at - interval '24 hours', ends_at = ends_at - interval '24 hours',
      review_request_sent_at = now() - interval '21 hours' WHERE id = ${b1}`;
    const coupee = await mk('relance-coupee');
    const bc = await book(coupee, 50 * H);
    await sql`UPDATE bookings SET review_request_sent_at = now() - interval '22 hours' WHERE id = ${bc}`;
    await sql`UPDATE users SET review_mail_optout_at = now() WHERE id = ${coupee}`;
    const relance: { to: string; subject: string }[] = [];
    await avis.sendReviewRequests(URL_AVIS, async (to, m) => (relance.push({ to, subject: m.subject }), true));
    assert.deepEqual(relance.filter((r) => mine(r.to)), [{ to: `${tag}contente@test.local`, subject: 'Twee minuten voor uw review?' }], 'relance une fois, pas pour une désinscrite ni sans première demande');
    const encore: string[] = [];
    await avis.sendReviewRequests(URL_AVIS, async (to) => (encore.push(to), true));
    assert.deepEqual(encore.filter(mine), [], 'deux mails au plus par rendez-vous');

    // Clic sur le lien suivi : redirection vers Google, clic noté une fois, pas de relance
    const { GET } = await import('../../pages/avis/[jeton].ts');
    const L = tag.replace(/\d/g, (d) => 'bcdfghjklm'[Number(d)]);
    const sentDaysAgo = async (n: string, endedH: number, name?: string) => {
      const u = await mk(n);
      if (name) await sql`UPDATE users SET name = ${name} WHERE id = ${u}`;
      const b = await book(u, endedH * H);
      await sql`UPDATE bookings SET review_request_sent_at = now() - interval '22 hours' WHERE id = ${b}`;
      return b;
    };
    const bClic = await sentDaysAgo('clic', 51);
    const res = await GET({ params: { jeton: avis.reviewToken(bClic) } } as never);
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), 'https://g.page/r/abc/review');
    const [{ review_clicked_at: firstClick }] = await sql`SELECT review_clicked_at FROM bookings WHERE id = ${bClic}`;
    assert.ok(firstClick, 'clic noté');
    await GET({ params: { jeton: avis.reviewToken(bClic) } } as never);
    assert.deepEqual((await sql`SELECT review_clicked_at FROM bookings WHERE id = ${bClic}`)[0].review_clicked_at, firstClick, 'premier clic gardé');
    const faux = await GET({ params: { jeton: `${bClic}.${'A'.repeat(22)}` } } as never);
    assert.equal(faux.status, 302, 'jeton faux : la cliente arrive quand même sur Google');

    // Avis Google au nom de la cliente, publié après le rendez-vous : marqué, pas de relance. Homonymes : rien
    const bTrouvee = await sentDaysAgo('trouvee', 52, `Zoé Lettres${L}`);
    const bHomo = await sentDaysAgo('homonyme', 53, `Inès Homonyme${L}`);
    await mk('homonyme-bis').then((id) => sql`UPDATE users SET name = ${`Ines Homonyme${L}`} WHERE id = ${id}`);
    await sql`INSERT INTO google_reviews (review_id, author, rating, comment, created_at, updated_at) VALUES
      (${`t-${tag}`}, ${`zoe LETTRES${L}`}, 5, 'Bien', now() - interval '1 hour', now()),
      (${`h-${tag}`}, ${`Inès Homonyme${L}`}, 4, 'Bien', now() - interval '1 hour', now()),
      (${`v-${tag}`}, ${`Zoé Lettres${L}`}, 5, 'Avant le rendez-vous', now() - interval '20 days', now())`;
    assert.equal(await avis.matchReviews(), 1);
    assert.deepEqual((await sql`SELECT review_found_id FROM bookings WHERE id IN (${bTrouvee}, ${bHomo}) ORDER BY id`).map((r) => r.review_found_id), [`t-${tag}`, null]);
    assert.equal(await avis.matchReviews(), 0, 'un avis ne sert qu’une fois');
    const apres: string[] = [];
    await avis.sendReviewRequests(URL_AVIS, async (to) => (apres.push(to), true));
    assert.deepEqual(apres.filter(mine).sort(), [`${tag}homonyme@test.local`], 'relance seulement sans clic ni avis trouvé');

    // Lien de désinscription : signé, propre à la cliente
    const link = new URL(got[0].text.match(/https:\/\/test\.local\/nl\/compte\/avis-desinscription\S+/)![0]);
    assert.equal(avis.checkUnsubscribe(link.searchParams.get('u'), link.searchParams.get('s')), ok);
    assert.equal(avis.checkUnsubscribe(String(absent), link.searchParams.get('s')), null, 'signature d’une autre cliente');
    assert.equal(avis.checkUnsubscribe('abc', 'x'), null);
    await avis.optOutReviews(ok);
    assert.ok((await sql`SELECT review_mail_optout_at FROM users WHERE id = ${ok}`)[0].review_mail_optout_at);

    // Copie des avis : deux pages, traduction de Google retirée, avis retiré chez Google effacé, note moyenne gardée
    const calls: string[] = [];
    const page = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    const fake = (reviews: unknown[][]) => (async (u: string | URL | Request) => {
      const s = String(u);
      calls.push(s);
      if (s.startsWith('https://oauth2.googleapis.com/')) return page({ access_token: 'at' });
      const i = s.includes('pageToken=p2') ? 1 : 0;
      return page({ reviews: reviews[i], averageRating: 4.6, totalReviewCount: 3, ...(i === 0 && reviews.length > 1 ? { nextPageToken: 'p2' } : {}) });
    }) as typeof fetch;
    const rv = (id: string, star: string, comment: string, day: string) => ({ reviewId: id, reviewer: { displayName: `Auteur ${id}` }, starRating: star, comment, createTime: `${day}T10:00:00Z`, updateTime: `${day}T10:00:00Z` });
    await wipe();
    assert.equal(await avis.latestReviews(), null, 'jamais synchronisé : section cachée');
    assert.equal(await avis.refreshGoogleReviews(fake([
      [rv('r1', 'FIVE', 'Super soin', '2026-10-01'), rv('r2', 'TWO', '(Original)\nPas terrible\n\n(Translated by Google)\nNot great', '2026-10-05')],
      [rv('r3', 'FOUR', '', '2026-10-07')],
    ])), 3);
    assert.ok(calls.some((c) => c.includes('/v4/accounts/1/locations/2/reviews?')) && calls.some((c) => c.includes('pageToken=p2')));
    const view = (await avis.latestReviews())!;
    assert.equal(view.average, 4.6);
    assert.deepEqual(view.reviews.map((r) => [r.author, r.rating, r.text]), [['Auteur r2', 2, 'Pas terrible'], ['Auteur r1', 5, 'Super soin']], 'récents d’abord, note basse comprise, sans avis vide');
    assert.equal(await avis.refreshIfDue(fake([[]])), null, 'rafraîchi il y a moins de 2 heures : pas d’appel');
    assert.equal(await avis.refreshGoogleReviews(fake([[rv('r1', 'FIVE', 'Super soin', '2026-10-01')]])), 1);
    assert.deepEqual((await sql`SELECT review_id FROM google_reviews`).map((r) => r.review_id), ['r1'], 'avis retirés chez Google effacés');
    // Google en panne : la copie précédente reste
    assert.equal(await avis.refreshGoogleReviews((async () => new Response('', { status: 503 })) as typeof fetch), null);
    assert.equal((await sql`SELECT count(*)::int AS n FROM google_reviews`)[0].n, 1);
  } finally {
    await wipe();
    await sql`DELETE FROM bookings WHERE user_id IN (SELECT id FROM users WHERE email LIKE ${tag + '%'})`;
    await sql`DELETE FROM users WHERE email LIKE ${tag + '%'}`;
    await sql`DELETE FROM services WHERE slug = ${`soin-${tag}`}`;
    await sql.end();
  }
});
