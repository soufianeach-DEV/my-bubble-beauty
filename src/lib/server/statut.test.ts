// Statut lisible d'un rendez-vous : même libellé partout, sans base de données.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rdvStatus } from './statut.ts';

const base = { status: 'confirmed', no_show: false, past: false, ended: false, paid_method: null, package: null, arrived_at: null };
const label = (o: Record<string, unknown>) => rdvStatus({ ...base, ...o } as never).label;

test('statut : à venir, arrivée, en cours, à encaisser, honoré et payé, absente, annulé', () => {
  assert.equal(label({}), 'À venir');
  assert.equal(label({ arrived_at: new Date() }), 'Arrivée');
  assert.equal(label({ past: true }), 'En cours');
  assert.equal(label({ past: true, ended: true }), 'À encaisser');
  assert.equal(label({ past: true, ended: true, paid_method: 'carte' }), 'Honoré · Payé');
  assert.equal(label({ past: true, package: 'Forfait 10 séances' }), 'Honoré · Payé', 'séance de forfait : rien à encaisser');
  assert.equal(label({ arrived_at: new Date(), paid_method: 'especes' }), 'Honoré · Payé', 'encaissée avant l’heure prévue');
  assert.equal(label({ package: 'Forfait' }), 'À venir', 'forfait pas encore commencé');
  assert.equal(label({ past: true, ended: true, no_show: true }), 'Absente');
  assert.equal(label({ status: 'cancelled', past: true, paid_method: 'carte' }), 'Annulé');
  assert.equal(label({ status: 'pending_payment' }), 'Paiement en cours');
});
