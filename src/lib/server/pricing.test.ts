import { test } from 'node:test';
import assert from 'node:assert/strict';
import { amounts, euros, isDay, promoProblem, todayBrussels, type Promo } from './pricing.ts';

test('remise au centime, plafonnée au prix', () => {
  assert.deepEqual(amounts(5000, 0), { price_cents: 5000, discount_cents: 0, final_cents: 5000, deposit_cents: 0 });
  assert.equal(amounts(1250, 0, { kind: 'percent', value: 15 }).discount_cents, 188); // 187,5 arrondi
  assert.equal(amounts(999, 0, { kind: 'percent', value: 33 }).final_cents, 669);
  assert.equal(amounts(5000, 0, { kind: 'percent', value: 100 }).final_cents, 0);
  assert.deepEqual(amounts(3000, 1000, { kind: 'amount', value: 5000 }), { price_cents: 3000, discount_cents: 3000, final_cents: 0, deposit_cents: 0 });
});

test('acompte limité au prix final, supprimé sous 0,50 €', () => {
  assert.equal(amounts(5000, 2000).deposit_cents, 2000);
  assert.equal(amounts(5000, 2000, { kind: 'amount', value: 4000 }).deposit_cents, 1000);
  assert.equal(amounts(5000, 2000, { kind: 'amount', value: 4951 }).deposit_cents, 0); // 0,49 €
  assert.equal(amounts(5000, 2000, { kind: 'amount', value: 4950 }).deposit_cents, 50);
  assert.equal(amounts(5000, 49).deposit_cents, 0);
});

const promo = (p: Partial<Promo> = {}): Promo => ({ kind: 'percent', value: 10, starts_on: null, ends_on: null, max_uses: null, once_per_user: false, service_ids: null, active: true, ...p });
const ctx = { today: '2026-11-10', serviceId: 7, uses: 0, usesByUser: 0 };

test('code promo : dates du jour de réservation, ends_on inclus', () => {
  assert.equal(promoProblem(promo(), ctx), null);
  assert.equal(promoProblem(promo({ active: false }), ctx), 'inactive');
  assert.equal(promoProblem(promo({ starts_on: '2026-11-11' }), ctx), 'not_started');
  assert.equal(promoProblem(promo({ starts_on: '2026-11-10', ends_on: '2026-11-10' }), ctx), null);
  assert.equal(promoProblem(promo({ ends_on: '2026-11-09' }), ctx), 'expired');
});

test('code promo : prestations ciblées, max_uses, once_per_user', () => {
  assert.equal(promoProblem(promo({ service_ids: [3, 7] }), ctx), null);
  assert.equal(promoProblem(promo({ service_ids: ['7'] }), ctx), null); // bigint[] lu en chaînes
  assert.equal(promoProblem(promo({ service_ids: [3] }), ctx), 'service');
  assert.equal(promoProblem(promo({ max_uses: 2 }), { ...ctx, uses: 1 }), null);
  assert.equal(promoProblem(promo({ max_uses: 2 }), { ...ctx, uses: 2 }), 'exhausted');
  assert.equal(promoProblem(promo({ once_per_user: true }), { ...ctx, uses: 5 }), null);
  assert.equal(promoProblem(promo({ once_per_user: true }), { ...ctx, usesByUser: 1 }), 'used');
});

test('jour à Bruxelles, pas en UTC', () => {
  assert.equal(todayBrussels(new Date('2026-12-31T23:30:00Z')), '2027-01-01');
  assert.equal(todayBrussels(new Date('2026-07-15T21:59:00Z')), '2026-07-15');
  assert.equal(todayBrussels(new Date('2026-07-15T22:00:00Z')), '2026-07-16'); // UTC+2 en été
});

test('date saisie stricte', () => {
  assert.equal(isDay('2026-10-25'), true);
  assert.equal(isDay('2028-02-29'), true);
  for (const bad of ['2026-02-30', '2026-13-01', '2026-1-05', '26-10-25', '2026-10-25T00:00', '', null, 20261025]) assert.equal(isDay(bad), false, String(bad));
});

test('montants affichés comme les tarifs du site', () => {
  assert.equal(euros(3500), '35 €');
  assert.equal(euros(1250), '12,50 €');
  assert.equal(euros(1250, 'nl'), '12,50 €');
  assert.equal(euros(1250, 'en'), '12.50 €');
  assert.equal(euros(5), '0,05 €');
});
