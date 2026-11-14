// Habillage d'hiver : dates en heure de Bruxelles (1er décembre → 6 janvier inclus) et choix de l'admin (toujours / jamais).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

Object.assign(process.env, { SITE_URL: 'https://test.local', DATABASE_URL: 'postgres://inutilisee@127.0.0.1:1/x', PASSWORD_PEPPER: 'poivre-de-test-32-caracteres-min!', ADMIN_EMAIL: 'gerante@test.local', ADMIN_TOTP_SECRET: 'JBSWY3DPEHPK3PXP' });
registerHooks({
  resolve: (spec, ctx, next) =>
    spec === 'astro:env/server' ? { url: 'data:text/javascript,export const { DATABASE_URL, SITE_URL, ADMIN_EMAIL, ADMIN_TOTP_SECRET, PASSWORD_PEPPER, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, RESEND_API_KEY, MAIL_FROM, GBP_CLIENT_ID, GBP_CLIENT_SECRET, GBP_REFRESH_TOKEN, GBP_LOCATION, GOOGLE_REVIEW_URL, TASKS_SECRET } = process.env;', shortCircuit: true } : next(spec, ctx),
  load: (u, ctx, next) => next(u, u.endsWith('.json') ? { ...ctx, importAttributes: { type: 'json' } } : ctx),
});

test('saison automatique : du 1er décembre au 6 janvier, heure de Bruxelles', async () => {
  const { seasonOn } = await import('./reglages.ts');
  const at = (iso: string) => seasonOn('auto', new Date(iso));
  assert.equal(at('2026-11-30T22:59:00Z'), false, '30 novembre, 23 h 59 à Bruxelles');
  assert.equal(at('2026-11-30T23:00:00Z'), true, '1er décembre, minuit à Bruxelles');
  assert.equal(at('2026-12-24T12:00:00Z'), true);
  assert.equal(at('2027-01-06T22:59:00Z'), true, '6 janvier, 23 h 59 à Bruxelles');
  assert.equal(at('2027-01-06T23:00:00Z'), false, '7 janvier, minuit à Bruxelles');
  assert.equal(at('2027-07-14T12:00:00Z'), false);
  assert.equal(seasonOn('on', new Date('2027-07-14T12:00:00Z')), true, 'toujours');
  assert.equal(seasonOn('off', new Date('2026-12-24T12:00:00Z')), false, 'jamais');
});
