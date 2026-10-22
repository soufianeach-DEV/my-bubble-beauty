// Une page de compte oubliée en pré-rendu serait construite avec les vraies données, puis servie sans passer par le middleware.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const PAGES = new URL('../../pages/', import.meta.url);
// admin.astro et api.ts comptent aussi, pas seulement les dossiers admin/ et api/
const GUARDED = /^(admin|api)(\/|\.)|^\[folder\]\/(compte|reserver)/;

test('motif des routes gardées : fichiers et dossiers admin, api, compte et réserver', () => {
  for (const f of ['admin.astro', 'admin/code.astro', 'api.ts', 'api/stripe/webhook.ts', '[folder]/compte.astro', '[folder]/compte/connexion.astro', '[folder]/reserver.astro'])
    assert.match(f, GUARDED, f);
  for (const f of ['404.astro', 'index.astro', 'sitemap.xml.ts', 'administration.astro', '[folder]/index.astro', '[folder]/subPages/[slug].astro'])
    assert.doesNotMatch(f, GUARDED, f);
});

test('routes de compte, réservation, admin et API : export const prerender = false', () => {
  const files = readdirSync(PAGES, { recursive: true, encoding: 'utf8' })
    .map((f) => f.replaceAll('\\', '/'))
    .filter((f) => GUARDED.test(f) && /\.(astro|ts|js)$/.test(f));
  for (const f of files) assert.match(readFileSync(new URL(f, PAGES), 'utf8'), /^export const prerender = false;?\s*$/m, f);
});
