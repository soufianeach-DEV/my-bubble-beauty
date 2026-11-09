// Sur une base jetable (TEST_DATABASE_URL=… npm test) : la réservation suit les tarifs du site quand ils changent.
// Tout se passe dans une transaction annulée : les autres fichiers de test, lancés en parallèle sur la même base, ne voient rien.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import postgres from 'postgres';

const url = process.env.TEST_DATABASE_URL;

test('durées de la carte : formats lus, toutes les lignes réelles de la grille', async () => {
  const { parseDuration, serviceSeed } = await import('../../../db/migrate.mjs');
  const cases: [string | undefined, number | null][] = [['30 min', 30], ['45 min', 45], ['30 à 45 min', 45], ['60 à 75 min', 75], ['5 × 20 min', 20], ['10 × 30 min', 30],
    ['1 h 30', 90], ['1 h', 60], ['2h', 120], ["45'", 45], ['', null], [undefined, null], ['sur devis', null], ['0 min', null]];
  for (const [t, n] of cases) assert.equal(parseDuration(t), n, String(t));
  // Grille réelle (fr.json) : toute durée écrite se lit, aucune n'est inventée là où il n'y en a pas
  const { default: fr } = await import('../../data/fr.json', { with: { type: 'json' } });
  const lines = fr.home.tarifs.groups.flatMap((g: { hidden?: boolean; items: { duration?: string }[] }) => (g.hidden ? [] : g.items));
  for (const it of lines) if (it.duration) assert.ok(parseDuration(it.duration)! > 0, `illisible : ${it.duration}`);
  const seed = await serviceSeed();
  assert.equal(seed.length, lines.length);
  // Deux lignes de même nom dans un groupe donneraient le même slug : l'insertion échouerait et le site ne démarrerait plus
  assert.equal(new Set(seed.map((s: { slug: string }) => s.slug)).size, seed.length, 'slugs uniques');
  assert.equal(seed.filter((s: { duration_min: number | null }) => s.duration_min !== null).length, lines.filter((it: { duration?: string }) => it.duration).length);
  assert.ok(seed.every((s: { active: boolean; duration_min: number | null }) => s.active === (s.duration_min !== null)), 'en ligne si et seulement si la carte donne une durée');
});

test('synchro des prestations avec les tarifs du site', { skip: !url && 'TEST_DATABASE_URL absente' }, async () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  const { migrate, syncServices } = await import('../../../db/migrate.mjs');
  const tag = `zz${Date.now()}`;
  const row = (slug: string, price: number) => ({ slug, category: 'visage', name_fr: `${slug} fr`, name_nl: `${slug} nl`, name_en: `${slug} en`, price_cents: price, active: false, sort: 0 });
  try {
    await migrate(sql);
    await sql.begin(async (tx) => {
      // Prestation que la gérante a réglée et ouverte, et une autre retirée du site depuis
      await tx`INSERT INTO services (slug, category, name_fr, name_nl, name_en, duration_min, deposit_cents, price_cents, active)
        VALUES (${`${tag}-garde`}, 'regard', 'ancien', 'ancien', 'ancien', 45, 1000, 1500, true), (${`${tag}-retire`}, 'visage', 'x', 'x', 'x', 30, 0, 900, true),
          (${`${tag}-vide`}, 'visage', 'y', 'y', 'y', NULL, 0, 3500, false), (${`${tag}-bon`}, 'visage', 'z', 'z', 'z', 60, 0, 6000, true)`;
      // Un bon cadeau seul renvoie à « bon » : la clé étrangère bloquerait l'effacement et le démarrage
      const [g] = await tx`SELECT id FROM services WHERE slug = ${`${tag}-bon`}`;
      await tx`INSERT INTO gift_cards (code, recipient, service_id, expires_on) VALUES (${`CADEAU-${tag.slice(-4)}-TEST`}, 'Test', ${g.id}, current_date + 30)`;
      // Un rendez-vous renvoie à la prestation retirée ; « vide » n'a rien
      const [r] = await tx`SELECT id FROM services WHERE slug = ${`${tag}-retire`}`;
      await tx`INSERT INTO bookings (guest_name, service_id, starts_at, ends_at, status, price_cents)
        VALUES ('Test', ${r.id}, now() - interval '400 days', now() - interval '400 days' + interval '30 minutes', 'confirmed', 900)`;
      await syncServices(tx, [row(`${tag}-garde`, 2000), row(`${tag}-neuf`, 3000)]);
      const s = Object.fromEntries((await tx`SELECT slug, category, name_fr, duration_min, deposit_cents, price_cents, active, retired_at IS NOT NULL AS retired FROM services WHERE slug LIKE ${`${tag}-%`}`).map((r) => [r.slug.slice(tag.length + 1), r]));
      // Nom, catégorie et prix suivent le site ; durée, acompte et ouverture restent ceux de la gérante
      assert.deepEqual({ ...s.garde }, { slug: `${tag}-garde`, category: 'visage', name_fr: `${tag}-garde fr`, duration_min: 45, deposit_cents: 1000, price_cents: 2000, active: true, retired: false });
      assert.equal(s.neuf.active, false, 'une nouvelle prestation arrive fermée');
      assert.equal(s.retire.active, false, 'une prestation retirée du site sort de la réservation');
      assert.equal(s.retire.price_cents, 900, 'gardée telle quelle : un rendez-vous y renvoie');
      assert.equal(s.retire.retired, true, "masquée dans l'admin");
      assert.equal(s.vide, undefined, 'retirée sans rendez-vous ni code promo : effacée');
      assert.equal(s.bon.retired, true, 'un bon cadeau y renvoie : gardée et masquée');
      // Revenue sur la carte : plus masquée
      await syncServices(tx, [row(`${tag}-garde`, 2000), row(`${tag}-retire`, 900)]);
      assert.equal((await tx`SELECT retired_at FROM services WHERE slug = ${`${tag}-retire`}`)[0].retired_at, null);
      // Durée de la carte : posée et ouverte ; durée manuelle gardée ; prestation fermée exprès laissée fermée
      await tx`UPDATE services SET duration_min = 50, duration_manual = true WHERE slug = ${`${tag}-garde`}`;
      await tx`INSERT INTO services (slug, category, name_fr, name_nl, name_en, price_cents, active, closed_by_admin) VALUES (${`${tag}-ferme`}, 'visage', 'f', 'f', 'f', 1000, false, true)`;
      await syncServices(tx, [{ ...row(`${tag}-garde`, 2000), duration_min: 30 }, { ...row(`${tag}-neuf`, 3000), duration_min: 45 }, { ...row(`${tag}-ferme`, 1000), duration_min: 20 }]);
      const t = Object.fromEntries((await tx`SELECT slug, duration_min, active FROM services WHERE slug LIKE ${`${tag}-%`}`).map((r) => [r.slug.slice(tag.length + 1), { d: r.duration_min, a: r.active }]));
      assert.deepEqual(t.neuf, { d: 45, a: true }, 'durée de la carte posée, prestation ouverte');
      assert.deepEqual(t.garde, { d: 50, a: true }, 'durée réglée à la main gardée');
      assert.deepEqual(t.ferme, { d: 20, a: false }, 'fermée exprès : reste fermée');
      throw new Error('annuler');
    }).catch((e) => { if (e.message !== 'annuler') throw e; });
  } finally {
    await sql.end();
  }
});
