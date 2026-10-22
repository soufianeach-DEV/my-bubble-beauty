import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeReturn } from './redirect.ts';

const SITE = 'https://mybubble-beauty.com';

test('retour accepté : chemin du site, requête conservée', () => {
  assert.equal(safeReturn('/fr/reserver?service=12', SITE), '/fr/reserver?service=12');
  assert.equal(safeReturn('/admin', SITE), '/admin');
  assert.equal(safeReturn(`${SITE}/nl/compte`, SITE), '/nl/compte');
});

test('retour refusé : autre domaine sous toutes ses formes', () => {
  for (const evil of ['//evil.example', '/\\evil.example', '/\t/evil.example', '/\n/evil.example', '\\\\evil.example', 'https://evil.example/fr', 'http://mybubble-beauty.com/fr', 'javascript:alert(1)', `${SITE}//evil.example/x`, '///evil.example'])
    assert.equal(safeReturn(evil, SITE), '/', JSON.stringify(evil));
});

test('valeur absente ou invalide : repli', () => {
  assert.equal(safeReturn(undefined, SITE, '/fr/compte'), '/fr/compte');
  assert.equal(safeReturn('', SITE), '/');
  assert.equal(safeReturn(['/fr'], SITE), '/');
});
