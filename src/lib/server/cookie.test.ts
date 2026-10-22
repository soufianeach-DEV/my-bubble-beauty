import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COOKIE, DEVICE, DEVICE_COOKIE, SESSION_COOKIE, deviceToken, hashToken, isDevice, newToken } from './cookie.ts';

test('cookie __Host- : Secure, HttpOnly, Path=/, Lax, sans Domain ni expiration', () => {
  assert.match(SESSION_COOKIE, /^__Host-/);
  assert.deepEqual(COOKIE, { httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
  assert.equal('domain' in COOKIE || 'maxAge' in COOKIE || 'expires' in COOKIE, false);
});

test('jeton : 32 octets aléatoires, seul un SHA-256 de 32 octets va en base', () => {
  const a = newToken();
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(Buffer.from(a, 'base64url').length, 32);
  assert.notEqual(a, newToken());
  assert.equal(hashToken(a).length, 32);
  assert.deepEqual(hashToken(a), hashToken(a));
});

test("cookie d'appareil : __Host-, Secure, HttpOnly, Lax, Path=/, un an, HMAC de l'adresse comparé à temps constant", () => {
  assert.match(DEVICE_COOKIE, /^__Host-/);
  assert.deepEqual(DEVICE, { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 31_536_000 });
  assert.equal('domain' in DEVICE, false);
  const key = 'poivre-de-test-32-octets-minimum!!';
  const v = deviceToken(key, 'gerante@example.com');
  assert.match(v, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(v, deviceToken(key, 'gerante@example.com'));
  assert.notEqual(v, deviceToken(key, 'cliente@example.com'));
  assert.notEqual(v, deviceToken('autre poivre', 'gerante@example.com'));
  assert.equal(isDevice(key, 'gerante@example.com', v), true);
  assert.equal(isDevice(key, 'cliente@example.com', v), false);
  assert.equal(isDevice(key, 'gerante@example.com', `${v.slice(0, -1)}${v.endsWith('A') ? 'B' : 'A'}`), false);
  assert.equal(isDevice(key, 'gerante@example.com', v.slice(1)), false);
  assert.equal(isDevice(key, 'gerante@example.com', ''), false);
  assert.equal(isDevice(key, 'gerante@example.com', undefined), false);
  assert.equal(isDevice(key, 'gerante@example.com', 'é'.repeat(43)), false);
});
