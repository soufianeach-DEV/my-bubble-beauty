// Sur une base jetable (TEST_DATABASE_URL=… npm test) : la réservation suit les tarifs du site quand ils changent.
// Tout se passe dans une transaction annulée : les autres fichiers de test, lancés en parallèle sur la même base, ne voient rien.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import postgres from 'postgres';

const url = process.env.TEST_DATABASE_URL;

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
          (${`${tag}-vide`}, 'visage', 'y', 'y', 'y', NULL, 0, 3500, false)`;
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
      // Revenue sur la carte : plus masquée
      await syncServices(tx, [row(`${tag}-garde`, 2000), row(`${tag}-retire`, 900)]);
      assert.equal((await tx`SELECT retired_at FROM services WHERE slug = ${`${tag}-retire`}`)[0].retired_at, null);
      throw new Error('annuler');
    }).catch((e) => { if (e.message !== 'annuler') throw e; });
  } finally {
    await sql.end();
  }
});
