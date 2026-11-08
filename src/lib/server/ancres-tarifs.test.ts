// Liens « Voir les tarifs » et liens internes vers un groupe de tarifs : chaque #tarif-… doit viser un groupe qui existe,
// dans chaque langue. Un groupe renommé ou retiré (ex. « soin-visage ») cassait le lien sans que rien ne le signale.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

for (const lang of ['fr', 'nl', 'en']) {
  test(`ancres #tarif-… existantes (${lang})`, () => {
    const d = JSON.parse(readFileSync(new URL(`../../data/${lang}.json`, import.meta.url), 'utf8'));
    const ids = new Set([...d.home.tarifs.groups, ...d.home.tarifs.formulas].map((g: { id: string }) => `tarif-${g.id}`));
    const hrefs = [...JSON.stringify(d).matchAll(/#(tarif-[a-z0-9-]+)/g)].map((m) => m[1]);
    assert.ok(hrefs.length >= 6, 'les cartes de l’accueil visent bien des groupes de tarifs');
    assert.deepEqual(hrefs.filter((h) => !ids.has(h)), [], 'ancre vers un groupe de tarifs qui n’existe pas');
  });
}
