import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'astro/zod';
import { EMAIL, NAME, PHONE, TOKEN, device, readForm, when } from './compte.ts';

test('champs : e-mail normalisé, nom sans saut de ligne, téléphone facultatif, jeton base64url', () => {
  assert.equal(EMAIL.parse('  Anne@Exemple.BE '), 'anne@exemple.be');
  assert.equal(EMAIL.safeParse('a'.repeat(250) + '@x.be').success, false);
  assert.equal(NAME.parse(' Anne Dupont '), 'Anne Dupont');
  assert.equal(NAME.safeParse('Anne\nFausse ligne').success, false);
  assert.equal(NAME.safeParse('  ').success, false);
  for (const ok of ['', '0484.118.395', '+32 484 11 83 95', '(02) 123 45 67']) assert.equal(PHONE.safeParse(ok).success, true, ok);
  for (const ko of ['abc', '12', '+32<script>', '1'.repeat(31)]) assert.equal(PHONE.safeParse(ko).success, false, ko);
  assert.equal(TOKEN.safeParse('A'.repeat(43)).success, true);
  assert.equal(TOKEN.safeParse('A'.repeat(42) + '=').success, false);
});

test('readForm : données validées, champs fautifs nommés, corps illisible refusé', async () => {
  const schema = z.object({ email: EMAIL, terms: z.literal('on') });
  const post = (body: string) => new Request('http://x/', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  assert.deepEqual((await readForm(post('email=A%40b.be&terms=on'), schema)).data, { email: 'a@b.be', terms: 'on' });
  const ko = await readForm(post('email=nope'), schema);
  assert.equal(ko.data, null);
  assert.deepEqual([...ko.bad].sort(), ['email', 'terms']);
  assert.equal((await readForm(new Request('http://x/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }), schema)).data, null);
});

test('dates à Bruxelles, y compris au passage à l’heure d’hiver', () => {
  assert.match(when(new Date('2026-10-25T00:30:00Z'), 'fr'), /02:30/);
  assert.match(when(new Date('2026-10-25T01:30:00Z'), 'fr'), /02:30/);
  assert.match(when(new Date('2026-12-31T23:30:00Z'), 'nl'), /2027/);
});

test('appareil : navigateur et système lisibles', () => {
  assert.equal(device('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 Edg/141.0'), 'Edge, Windows');
  assert.equal(device('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'), 'Safari, iPhone');
  assert.equal(device('Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36'), 'Chrome, Android');
  assert.equal(device('curl/8.0'), '');
});
