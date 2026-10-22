import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, agendaForm, centsInput, closureForm, hoursForm, monday, newBookingForm, promoForm, serviceForm, toCents, totpForm } from './admin-form.ts';

const err = (r: { success: boolean; error?: { issues: { message: string }[] } }) => (r.success ? null : r.error!.issues[0].message);

test('montants saisis en euros : virgule ou point, au centime, sans flottant', () => {
  assert.equal(toCents('35'), 3500);
  assert.equal(toCents(' 12,50 '), 1250);
  assert.equal(toCents('12.5'), 1250);
  assert.equal(toCents('0,29'), 29);
  assert.equal(toCents('0'), 0);
  for (const bad of ['', '-5', '1,234', '12,', ',5', '1e3', '100000', '12 €', '0x10']) assert.equal(toCents(bad), null, bad);
  assert.equal(centsInput(3500), '35');
  assert.equal(centsInput(1250), '12,50');
  assert.equal(toCents(centsInput(29)), 29);
});

test('jours voisins et lundi, changements d\'heure et fin d\'année compris', () => {
  assert.equal(addDays('2026-10-24', 1), '2026-10-25');
  assert.equal(addDays('2026-10-25', 1), '2026-10-26');
  assert.equal(addDays('2027-03-28', -1), '2027-03-27');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(monday('2026-10-25'), '2026-10-19'); // dimanche
  assert.equal(monday('2026-10-19'), '2026-10-19');
});

test('prestation : durée exigée pour l\'ouvrir, montants convertis', () => {
  const base = { id: '7', name_fr: 'Soin', name_nl: 'Verzorging', name_en: 'Care', duration: '', price: '35', deposit: '0', sort: '0' };
  const off = serviceForm.safeParse(base);
  assert.ok(off.success);
  assert.deepEqual(off.data, { ...base, id: 7, duration: null, price: 3500, deposit: 0, sort: 0, active: false });
  assert.match(err(serviceForm.safeParse({ ...base, active: 'on' }))!, /durée/);
  assert.equal(serviceForm.safeParse({ ...base, duration: '45', active: 'on' }).data?.active, true);
  assert.match(err(serviceForm.safeParse({ ...base, price: '-1' }))!, /Prix/);
  assert.match(err(serviceForm.safeParse({ ...base, duration: '4' }))!, /Durée/);
  assert.match(err(serviceForm.safeParse({ ...base, name_fr: 'a\nb' }))!, /Nom français/);
  assert.match(err(serviceForm.safeParse({ ...base, id: '1 OR 1=1' }))!, /Identifiant/);
});

test('plages et fermetures : fin après début, journée entière par défaut', () => {
  assert.match(err(hoursForm.safeParse({ weekday: '1', opens: '18:00', closes: '09:00' }))!, /fermeture/);
  assert.deepEqual(hoursForm.safeParse({ weekday: '7', opens: '09:00', closes: '12:30:00' }).data, { weekday: 7, opens: '09:00', closes: '12:30' });
  assert.ok(!hoursForm.safeParse({ weekday: '8', opens: '09:00', closes: '12:00' }).success);
  assert.deepEqual(closureForm.safeParse({ start_day: '2026-12-24', end_day: '2026-12-31', reason: ' Congés ' }).data, { starts: '2026-12-24 00:00', ends: '2027-01-01 00:00', reason: 'Congés' });
  assert.deepEqual(closureForm.safeParse({ start_day: '2026-11-02', start_time: '12:00', end_day: '2026-11-02', end_time: '14:00' }).data?.ends, '2026-11-02 14:00');
  assert.match(err(closureForm.safeParse({ start_day: '2026-11-02', start_time: '14:00', end_day: '2026-11-02', end_time: '12:00' }))!, /fin/);
  assert.ok(!closureForm.safeParse({ start_day: '2026-02-30', end_day: '2026-03-01' }).success);
});

test('codes promo : format, bornes de la remise, dates, prestations ciblées', () => {
  const base = { code: ' noel-26 ', kind: 'percent', value: '20', services: [] };
  const ok = promoForm.safeParse(base);
  assert.deepEqual(ok.data, { id: null, code: 'NOEL-26', kind: 'percent', value: 20, starts_on: null, ends_on: null, max_uses: null, once_per_user: false, active: false, service_ids: null });
  assert.match(err(promoForm.safeParse({ ...base, value: '101' }))!, /Pourcentage/);
  assert.match(err(promoForm.safeParse({ ...base, value: '0' }))!, /Pourcentage/);
  assert.equal(promoForm.safeParse({ ...base, kind: 'amount', value: '7,5' }).data?.value, 750);
  assert.match(err(promoForm.safeParse({ ...base, kind: 'amount', value: '0' }))!, /Montant/);
  assert.match(err(promoForm.safeParse({ ...base, code: 'AB' }))!, /Code/);
  assert.match(err(promoForm.safeParse({ ...base, code: 'NOËL' }))!, /Code/);
  assert.match(err(promoForm.safeParse({ ...base, starts_on: '2026-12-31', ends_on: '2026-12-01' }))!, /fin/);
  assert.deepEqual(promoForm.safeParse({ ...base, services: ['3', '5', '3'], max_uses: '10', active: 'on', once_per_user: 'on' }).data?.service_ids, [3, 5]);
  assert.ok(!promoForm.safeParse({ ...base, services: ['x'] }).success);
  assert.ok(!promoForm.safeParse({ ...base, kind: 'gift' }).success);
});

test('agenda, saisie manuelle et code admin', () => {
  assert.deepEqual(agendaForm.safeParse({ action: 'cancel', id: '4', refund: 'on' }).data, { action: 'cancel', id: 4, refund: true });
  assert.ok(!agendaForm.safeParse({ action: 'delete', id: '4' }).success);
  const b = { service: '3', day: '2026-10-25', time: '02:30', name: ' Mme Dupont ', phone: '+32 484 11 83 95' };
  assert.deepEqual(newBookingForm.safeParse(b).data, { service: 3, day: '2026-10-25', time: '02:30', name: 'Mme Dupont', phone: '+32 484 11 83 95' });
  assert.equal(newBookingForm.safeParse({ ...b, phone: undefined }).data?.phone, '');
  assert.match(err(newBookingForm.safeParse({ ...b, phone: 'javascript:alert(1)' }))!, /Téléphone/);
  assert.match(err(newBookingForm.safeParse({ ...b, name: '' }))!, /Nom/);
  assert.match(err(newBookingForm.safeParse({ ...b, service: '' }))!, /prestation/);
  assert.equal(totpForm.safeParse({ code: '123 456' }).data?.code, '123456');
  assert.ok(!totpForm.safeParse({ code: '12345' }).success);
  assert.ok(!totpForm.safeParse({}).success);
});
