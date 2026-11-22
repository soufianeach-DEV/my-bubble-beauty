// Parcours de réservation public : retour au récapitulatif après l'inscription (e-mail d'activation compris) et présélection
// de la prestation depuis les tarifs (même slug que la synchro des prestations). Sans base de données.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { safeReturn } from './redirect.ts';

const SITE = 'https://test.local';
Object.assign(process.env, { SITE_URL: SITE, MAIL_FROM: 'test@test.local', DATABASE_URL: 'postgres://inutilisee@127.0.0.1:1/x' });
registerHooks({
  resolve: (spec, ctx, next) =>
    spec === 'astro:env/server' ? { url: 'data:text/javascript,export const { SITE_URL, MAIL_FROM, RESEND_API_KEY } = process.env;', shortCircuit: true } : next(spec, ctx),
  load: (u, ctx, next) => next(u, u.endsWith('.json') ? { ...ctx, importAttributes: { type: 'json' } } : ctx),
});

const RECAP = `/fr/reserver?service=12&debut=${encodeURIComponent('2026-11-20T09:30:00.000Z')}`;

test('retour vers le récapitulatif : gardé tel quel, jamais vers un autre site', () => {
  assert.equal(safeReturn(RECAP, SITE), RECAP);
  assert.equal(safeReturn(decodeURIComponent(encodeURIComponent(RECAP)), SITE), RECAP, 'aller-retour par ?retour=');
  for (const bad of ['//evil.test/fr/reserver', 'https://evil.test/fr/reserver?service=1']) assert.equal(safeReturn(bad, SITE, '/x'), '/x');
});

test("e-mail d'activation : le lien ramène au récapitulatif, sans retour il reste inchangé", async () => {
  const { verifyMail } = await import('./mail.ts');
  for (const lang of ['fr', 'nl', 'en'] as const) {
    const m = verifyMail(lang, 'jeton', RECAP);
    const link = /https:\/\/test\.local\/\w+\/compte\/verification\?token=jeton&retour=\S+/.exec(m.text)?.[0];
    assert.ok(link, `lien avec retour (${lang})`);
    assert.equal(new URL(link).searchParams.get('retour'), RECAP);
    assert.ok(!verifyMail(lang, 'jeton').text.includes('retour='));
  }
});

test('présélection : chaque ligne des tarifs vise une prestation de la synchro (même slug)', async () => {
  const { itemSlug } = await import('../../../db/slug.mjs');
  const { serviceSeed } = await import('../../../db/migrate.mjs');
  const { default: fr } = await import('../../data/fr.json', { with: { type: 'json' } });
  const seed = new Set((await serviceSeed()).map((s: { slug: string }) => s.slug));
  // Prestations, plus les formules réservables (Future Mariée) : leur bouton vise aussi ?soin=slug
  const groups = [...fr.home.tarifs.groups.filter((g: { hidden?: boolean }) => !g.hidden), ...fr.home.tarifs.formulas.filter((f: { book?: boolean }) => f.book)];
  let n = 0;
  for (const g of groups) for (const it of g.items) { assert.ok(seed.has(itemSlug(g, it)), `${g.id} / ${it.name}`); n++; }
  assert.equal(n, seed.size);
});

test('mail à la gérante : objet daté (heure de Bruxelles), e-mail de la cliente, lien vers l\'admin', async () => {
  const { bookingAdminMail } = await import('./mail.ts');
  const b = { service: 'Visage, Hydrafacial', starts_at: new Date('2026-11-20T09:30:00.000Z'), price_cents: 9000, discount_cents: 1000, deposit_cents: 2000, email: 'cliente@test.local' };
  const m = bookingAdminMail(b);
  assert.equal(m.subject, 'Nouvelle réservation : Visage, Hydrafacial le vendredi 20 novembre 2026 à 10:30');
  for (const part of [m.text, m.html]) {
    assert.ok(part.includes('cliente@test.local'), 'e-mail de la cliente');
    assert.ok(part.includes(`${SITE}/admin`), "lien vers l'admin");
  }
  assert.ok(!m.text.includes('Cliente :'), 'pas de nom sans nom renseigné');
  assert.ok(bookingAdminMail({ ...b, name: 'Amina' }).text.includes('Cliente : Amina'));
  assert.match(m.text, /Acompte : 20\s€ payé en ligne, reste 60\s€/);
  assert.ok(!bookingAdminMail({ ...b, deposit_cents: 0 }).text.includes('Acompte'), 'sans acompte : pas de ligne');
});
