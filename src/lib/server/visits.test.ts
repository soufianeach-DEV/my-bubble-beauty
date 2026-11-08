// Mesure d'audience (db/visits.mjs) : ce qui compte comme visite, et empreinte stable dans la journée.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCountable, visitorKey } from '../../../db/visits.mjs';

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const req = (headers: Record<string, string> = {}, method = 'GET') =>
  ({ method, headers: { 'user-agent': CHROME, 'x-forwarded-for': '203.0.113.7', ...headers }, socket: { remoteAddress: '10.0.0.1' } }) as never;

test('pages publiques vues par un navigateur : comptées', () => {
  for (const p of ['/', '/index.html', '/fr/index.html', '/nl/subPages/laserepilation.html', '/eng/terms.html']) assert.ok(isCountable(req(), p, 200), p);
  // Page revalidée depuis le cache du navigateur (ETag) : c'est aussi une visite
  assert.ok(isCountable(req(), '/fr/index.html', 304));
});

test('robots, préchargements, erreurs, pages privées et fichiers : pas comptés', () => {
  assert.ok(!isCountable(req({ 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' }), '/fr/index.html', 200));
  assert.ok(!isCountable(req({ 'user-agent': '' }), '/fr/index.html', 200));
  assert.ok(!isCountable(req({ 'sec-purpose': 'prefetch' }), '/fr/index.html', 200));
  assert.ok(!isCountable(req({}, 'HEAD'), '/fr/index.html', 200));
  assert.ok(!isCountable(req(), '/fr/index.html', 301));
  assert.ok(!isCountable(req(), '/fr/nexiste.html', 404));
  for (const p of ['/fr/compte', '/fr/reserver', '/admin', '/sitemap.xml', '/robots.txt', '/assets/img/og-image.jpg', '/404.html'])
    assert.ok(!isCountable(req(), p, 200), p);
});

test('refus du visiteur : cookie mb_nostats ou signal GPC, pas compté', () => {
  assert.ok(!isCountable(req({ cookie: 'mb_nostats=1' }), '/fr/index.html', 200));
  assert.ok(!isCountable(req({ cookie: 'autre=x; mb_nostats=1' }), '/fr/index.html', 200));
  assert.ok(!isCountable(req({ 'sec-gpc': '1' }), '/fr/index.html', 200));
  // Cookie retiré (case décochée) ou nom approchant : la visite compte
  assert.ok(isCountable(req({ cookie: 'mb_nostats=0' }), '/fr/index.html', 200));
  assert.ok(isCountable(req({ cookie: 'xmb_nostats=1' }), '/fr/index.html', 200));
});

test('empreinte : même personne = même empreinte le même jour, une autre IP = une autre', () => {
  const a = visitorKey(req());
  const b = visitorKey(req());
  const c = visitorKey(req({ 'x-forwarded-for': '198.51.100.9' }));
  assert.equal(a.id.length, 16);
  assert.ok(a.id.equals(b.id));
  assert.ok(!a.id.equals(c.id));
  // L'IP n'apparaît pas en clair dans l'empreinte
  assert.ok(!a.id.toString('latin1').includes('203.0.113.7'));
  assert.match(a.day, /^\d{4}-\d{2}-\d{2}$/);
});
