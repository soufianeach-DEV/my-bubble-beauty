// Note Google de l'Accueil (TEST_DATABASE_URL=… npm test) : tâche Places avec un fetch simulé (deux champs demandés, une fois
// par jour, note gardée en cas d'erreur), fusion avec la saisie de l'admin, valeurs par défaut.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const url = process.env.TEST_DATABASE_URL;
// Clés Places posées, Business Profile absent : c'est le cas où la note s'affiche
const ENV = { SITE_URL: 'https://test.local', ADMIN_EMAIL: 'gerante@test.local', ADMIN_TOTP_SECRET: 'JBSWY3DPEHPK3PXP', PASSWORD_PEPPER: 'poivre-de-test-32-caracteres-min!',
  GOOGLE_PLACES_KEY: 'cle-places-de-test', GOOGLE_PLACE_ID: 'ChIJtest_123-abc', GBP_CLIENT_ID: '', GBP_CLIENT_SECRET: '', GBP_REFRESH_TOKEN: '', GBP_LOCATION: '' };
Object.assign(process.env, ENV, { DATABASE_URL: url ?? 'postgres://inutilisee@127.0.0.1:1/x' });
registerHooks({
  resolve: (spec, ctx, next) =>
    spec === 'astro:env/server'
      ? { url: 'data:text/javascript,export const { DATABASE_URL, SITE_URL, ADMIN_EMAIL, ADMIN_TOTP_SECRET, PASSWORD_PEPPER, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, RESEND_API_KEY, MAIL_FROM, GBP_CLIENT_ID, GBP_CLIENT_SECRET, GBP_REFRESH_TOKEN, GBP_LOCATION, GOOGLE_REVIEW_URL, TASKS_SECRET, GOOGLE_PLACES_KEY, GOOGLE_PLACE_ID } = process.env;', shortCircuit: true }
      : next(spec, ctx),
  load: (u, ctx, next) => next(u, u.endsWith('.json') ? { ...ctx, importAttributes: { type: 'json' } } : ctx),
});

test('note valable : de 1 à 5, nombre d’avis entier', async () => {
  const { validRating } = await import('./note-google.ts');
  assert.ok(validRating(4.6, 42));
  assert.ok(validRating(5, 0));
  for (const [r, c] of [[0, 3], [5.1, 3], ['4.6', 42], [4.6, 4.5], [4.6, -1], [undefined, 42], [4.6, undefined], [NaN, 1]]) assert.ok(!validRating(r, c), `${r} / ${c}`);
});

test('tâche Places sur une vraie base', { skip: !url && 'TEST_DATABASE_URL absente' }, async () => {
  const { sql } = await import('./db.ts');
  const { migrate } = await import('../../../db/migrate.mjs');
  const g = { ...(await import('./reglages.ts')), ...(await import('./note-google.ts')) };
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fake = (status: number, body: unknown): typeof fetch => (async (u: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(u), headers: init?.headers as Record<string, string> });
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  try {
    await migrate(sql);
    await sql`DELETE FROM settings WHERE key = 'google_rating'`;
    assert.deepEqual(await g.readRating(), { rating: 4.6, count: 42, source: 'defaut', updated_at: null }, 'valeurs relevées par défaut');

    // Premier passage : un appel, deux champs seulement, clé dans l'en-tête et pas dans l'URL
    assert.equal(await g.refreshRatingIfDue(fake(200, { rating: 4.66, userRatingCount: 45 })), true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://places.googleapis.com/v1/places/ChIJtest_123-abc');
    assert.equal(calls[0].headers['X-Goog-FieldMask'], 'rating,userRatingCount');
    assert.equal(calls[0].headers['X-Goog-Api-Key'], 'cle-places-de-test');
    let r = await g.readRating();
    assert.equal(r.rating, 4.7, 'arrondie au dixième');
    assert.equal(r.count, 45);
    assert.equal(r.source, 'places');

    // Même jour : pas de second appel facturé
    assert.equal(await g.refreshRatingIfDue(fake(200, { rating: 3, userRatingCount: 1 })), null);
    assert.equal(calls.length, 1);

    // La gérante corrige à la main : la date du dernier passage reste, la tâche ne repart pas aujourd'hui
    await g.saveRating(sql, { rating: 4.8, count: 50, source: 'admin', updated_at: new Date().toISOString() });
    assert.equal(await g.refreshRatingIfDue(fake(200, { rating: 3, userRatingCount: 1 })), null);
    assert.equal((await g.readRating()).rating, 4.8);

    // Lendemain (passage daté de la veille) : Google en panne ou réponse sans note, la note enregistrée reste
    const yesterday = async () => sql`UPDATE settings SET value = jsonb_set(value, '{checked_at}', to_jsonb((now() - interval '1 day')::text)) WHERE key = 'google_rating'`;
    await yesterday();
    assert.equal(await g.refreshRatingIfDue(fake(500, { error: 'x' })), false);
    await yesterday();
    assert.equal(await g.refreshRatingIfDue(fake(200, { rating: 9, userRatingCount: 12 })), false);
    await yesterday();
    assert.equal(await g.refreshRatingIfDue(fake(200, {})), false);
    r = await g.readRating();
    assert.deepEqual([r.rating, r.count, r.source], [4.8, 50, 'admin']);
    // Une erreur compte comme le passage du jour : pas de nouvel essai toutes les 15 minutes
    assert.equal(await g.refreshRatingIfDue(fake(200, { rating: 4.9, userRatingCount: 60 })), null);

    // Rien d'autre que la note et le nombre n'est gardé
    const [{ value }] = await sql`SELECT value FROM settings WHERE key = 'google_rating'`;
    assert.deepEqual(Object.keys(value).sort(), ['checked_at', 'count', 'rating', 'source', 'updated_at']);
  } finally {
    await sql`DELETE FROM settings WHERE key = 'google_rating'`;
    await sql.end();
  }
});
