import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FLOW_MAX_MS, MS_CONSUMERS, authorizeUrl, challenge, packFlow, readIdToken, same, unpackFlow, type Flow } from './oidc.ts';

const now = 1_800_000_000;
const flow = (p: Partial<Flow> = {}): Flow => ({ provider: 'google', state: 's'.repeat(43), verifier: 'v'.repeat(43), nonce: 'n'.repeat(43), lang: 'fr', back: '/fr/compte', at: now * 1000, ...p });
const jwt = (c: Record<string, unknown>) => `x.${Buffer.from(JSON.stringify(c)).toString('base64url')}.sig`;
const google = (c: Record<string, unknown> = {}) => jwt({ iss: 'https://accounts.google.com', aud: 'cid', exp: now + 300, nonce: 'n'.repeat(43), sub: '123', email: 'Anna@Gmail.com', email_verified: true, name: ' Anna ', ...c });

test("URL d'autorisation : PKCE S256, state, nonce, choix du compte", () => {
  const u = new URL(authorizeUrl(flow(), 'cid', 'https://site.test/oauth/google/retour'));
  assert.equal(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(u.searchParams.get('code_challenge'), challenge('v'.repeat(43)));
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(u.searchParams.get('state'), 's'.repeat(43));
  assert.equal(u.searchParams.get('prompt'), 'select_account');
  assert.equal(u.searchParams.get('redirect_uri'), 'https://site.test/oauth/google/retour');
});

test("cookie d'aller-retour : relu tel quel, refusé expiré, abîmé ou d'un fournisseur inconnu", () => {
  const f = flow();
  assert.deepEqual(unpackFlow(packFlow(f), f.at + 1000), f);
  assert.equal(unpackFlow(packFlow(f), f.at + FLOW_MAX_MS + 1), null);
  assert.equal(unpackFlow('pas du json', f.at), null);
  assert.equal(unpackFlow(undefined, f.at), null);
  assert.equal(unpackFlow(packFlow({ ...f, provider: 'facebook' as never }), f.at), null);
});

test('comparaison du state', () => {
  assert.equal(same('abc', 'abc'), true);
  assert.equal(same('abd', 'abc'), false);
  assert.equal(same(null, 'abc'), false);
});

test('jeton Google valide : adresse en minuscules, nom nettoyé', () => {
  assert.deepEqual(readIdToken(google(), flow(), 'cid', now), { provider: 'google', subject: '123', email: 'anna@gmail.com', emailVerified: true, name: 'Anna' });
});

test('jeton refusé : émetteur, audience, expiration, nonce, sujet ou adresse manquants', () => {
  for (const bad of [{ iss: 'https://evil.test' }, { aud: 'autre' }, { exp: now - 120 }, { nonce: 'x'.repeat(43) }, { sub: '' }, { email: '' }]) {
    assert.equal(readIdToken(google(bad), flow(), 'cid', now), null, JSON.stringify(bad));
  }
  assert.equal(readIdToken('pas-un-jwt', flow(), 'cid', now), null);
});

test('Google : adresse non vérifiée signalée comme telle', () => {
  assert.equal(readIdToken(google({ email_verified: false }), flow(), 'cid', now)?.emailVerified, false);
});

test('Microsoft : seuls les comptes personnels ont une adresse tenue pour vérifiée', () => {
  const ms = (tid: string) => jwt({ iss: `https://login.microsoftonline.com/${MS_CONSUMERS}/v2.0`, aud: 'cid', exp: now + 300, nonce: 'n'.repeat(43), sub: 'abc', email: 'b@outlook.com', tid });
  assert.equal(readIdToken(ms(MS_CONSUMERS), flow({ provider: 'microsoft' }), 'cid', now)?.emailVerified, true);
  assert.equal(readIdToken(ms('autre-locataire'), flow({ provider: 'microsoft' }), 'cid', now)?.emailVerified, false);
  // Jeton Google présenté au retour Microsoft : émetteur refusé
  assert.equal(readIdToken(google(), flow({ provider: 'microsoft' }), 'cid', now), null);
});
