import { test } from 'node:test';
import assert from 'node:assert/strict';
import { base32Decode, base32Encode, totp, verifyTotp } from './totp.ts';

const KEY = Buffer.from('12345678901234567890');

test("vecteurs SHA-1 de l'annexe B de la RFC 6238", () => {
  const vectors: [number, string][] = [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130']];
  for (const [t, code] of vectors) assert.equal(totp(KEY, Math.floor(t / 30), 8), code);
});

test('base32 : aller-retour et vecteur RFC 4648', () => {
  assert.equal(base32Encode(Buffer.from('foobar')), 'MZXW6YTBOI');
  assert.deepEqual(base32Decode('mzxw6ytboi======'), Buffer.from('foobar'));
  assert.equal(base32Encode(KEY).length, 32);
  assert.throws(() => base32Decode('ABC1'));
});

test('verifyTotp : ±1 pas accepté, ±2 refusé, format strict', () => {
  const secret = base32Encode(KEY);
  const now = 1_111_111_111_000;
  const step = Math.floor(now / 30_000);
  assert.equal(verifyTotp(secret, totp(KEY, step), now), step);
  assert.equal(verifyTotp(secret, totp(KEY, step - 1), now), step - 1);
  assert.equal(verifyTotp(secret, totp(KEY, step + 1), now), step + 1);
  assert.equal(verifyTotp(secret, totp(KEY, step + 2), now), null);
  assert.equal(verifyTotp(secret, totp(KEY, step - 2), now), null);
  for (const bad of ['', '12345', '1234567', '12 456', 'abcdef']) assert.equal(verifyTotp(secret, bad, now), null);
});
