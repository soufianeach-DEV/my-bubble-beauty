import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { badEmail, inRange, isPwned, passwordProblem } from './password.ts';

test('longueur 12 à 128 caractères Unicode, sans règle de composition', () => {
  assert.equal(passwordProblem('a'.repeat(11)), 'short');
  assert.equal(passwordProblem('a'.repeat(12)), null);
  assert.equal(passwordProblem('a'.repeat(128)), null);
  assert.equal(passwordProblem('a'.repeat(129)), 'long');
  assert.equal(passwordProblem('🫧'.repeat(12)), null); // 24 unités UTF-16, 12 caractères
  assert.equal(passwordProblem('🫧'.repeat(11)), 'short');
  assert.equal(passwordProblem('tout en minuscules sans chiffre'), null);
});

test('réponse HIBP avec bourrage : seul un compte > 0 compte', () => {
  const body = 'AAA:3\r\nBBB:0\r\nCCC:12';
  assert.equal(inRange(body, 'AAA'), true);
  assert.equal(inRange(body, 'BBB'), false);
  assert.equal(inRange(body, 'CCC'), true);
  assert.equal(inRange(body, 'DDD'), false);
});

const fake = (body: string, status = 200, seen: string[] = []) =>
  (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push(String(url), new Headers(init?.headers).get('add-padding') ?? '');
    return new Response(body, { status });
  }) as typeof fetch;

test('isPwned sans réseau : préfixe de 5 caractères, Add-Padding, échec = on laisse passer', async () => {
  const sha = createHash('sha1').update('password123456').digest('hex').toUpperCase();
  const seen: string[] = [];
  assert.equal(await isPwned('password123456', fake(`${sha.slice(5)}:42\n`, 200, seen)), true);
  assert.deepEqual(seen, [`https://api.pwnedpasswords.com/range/${sha.slice(0, 5)}`, 'true']);
  assert.equal(await isPwned('password123456', fake(`${sha.slice(5)}:0\n`)), false);
  assert.equal(await isPwned('password123456', fake('', 503)), false);
  assert.equal(await isPwned('password123456', (async () => { throw new Error('réseau'); }) as typeof fetch), false);
});

test('adresse saisie : plus de 254 caractères ou caractère NUL refusés avant toute requête', () => {
  assert.equal(badEmail('cliente@example.com'), false);
  assert.equal(badEmail(`${'a'.repeat(242)}@example.com`), false); // 254 caractères
  assert.equal(badEmail(`${'a'.repeat(243)}@example.com`), true);
  assert.equal(badEmail('a'.repeat(60_000)), true);
  assert.equal(badEmail('a@b.c\0'), true);
  assert.equal(badEmail('\0'), true);
});
