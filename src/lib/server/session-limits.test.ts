// Une seule source pour les durées de session : la lecture des sessions et la purge ne peuvent plus diverger.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SESSION_IDLE, SESSION_MAX, SESSION_REMEMBER, SESSION_REMEMBER_SECONDS } from './session-limits.mjs';

test("sessions : 30 min d'inactivité, 12 h au plus (ASVS 3.3.2 niveau 2)", () => {
  assert.equal(SESSION_IDLE, '30 minutes');
  assert.equal(SESSION_MAX, '12 hours');
});

test('« Se souvenir de moi » : 30 jours, même durée en base (intervalle) et dans le cookie (secondes)', () => {
  assert.equal(SESSION_REMEMBER, '30 days');
  assert.equal(SESSION_REMEMBER_SECONDS, 30 * 24 * 3600);
});

test('session.ts et db/purge.mjs importent session-limits.mjs, sans durée de session écrite en dur', () => {
  for (const f of ['./session.ts', '../../../db/purge.mjs']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.match(src, /^import \{[^}]*SESSION_IDLE[^}]*\} from '[./]*(src\/lib\/server\/)?session-limits\.mjs';$/m, f);
    assert.doesNotMatch(src, /interval '\d+ (minute|hour)s?'/, f);
  }
});
