import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyWebhookSignature } from './stripe-signature.ts';

const SECRET = 'whsec_test_secret';
const body = '{"id":"evt_1","type":"checkout.session.completed"}';
const now = 1_800_000_000_000;
const t = now / 1000;
const sign = (payload: string, ts = t, secret = SECRET) => createHmac('sha256', secret).update(`${ts}.${payload}`).digest('hex');

test('signature valide, et l\'une des v1 suffit pendant une rotation', () => {
  assert.equal(verifyWebhookSignature(body, `t=${t},v1=${sign(body)}`, SECRET, now), true);
  assert.equal(verifyWebhookSignature(body, `t=${t},v1=${sign(body, t, 'whsec_ancien')},v1=${sign(body)},v0=abc`, SECRET, now), true);
  assert.equal(verifyWebhookSignature(body, ` t=${t} , v1=${sign(body)} `, SECRET, now), true);
});

test('corps modifié, mauvais secret ou seul v0 : refusé', () => {
  assert.equal(verifyWebhookSignature(body.replace('evt_1', 'evt_2'), `t=${t},v1=${sign(body)}`, SECRET, now), false);
  assert.equal(verifyWebhookSignature(body, `t=${t},v1=${sign(body, t, 'whsec_autre')}`, SECRET, now), false);
  assert.equal(verifyWebhookSignature(body, `t=${t},v0=${sign(body)}`, SECRET, now), false);
  assert.equal(verifyWebhookSignature(body, `t=${t},v1=${sign(body).slice(0, 40)}`, SECRET, now), false);
  assert.equal(verifyWebhookSignature(body, `t=${t},v1=zz`, SECRET, now), false);
});

test('tolérance de 300 s dans les deux sens', () => {
  assert.equal(verifyWebhookSignature(body, `t=${t - 300},v1=${sign(body, t - 300)}`, SECRET, now), true);
  assert.equal(verifyWebhookSignature(body, `t=${t - 301},v1=${sign(body, t - 301)}`, SECRET, now), false);
  assert.equal(verifyWebhookSignature(body, `t=${t + 301},v1=${sign(body, t + 301)}`, SECRET, now), false);
});

test('en-tête absent ou mal formé, secret vide', () => {
  for (const h of [null, undefined, '', 'v1=abc', `t=abc,v1=${sign(body)}`, `t=,v1=${sign(body)}`]) assert.equal(verifyWebhookSignature(body, h, SECRET, now), false, String(h));
  assert.equal(verifyWebhookSignature(body, `t=${t},v1=${sign(body, t, '')}`, '', now), false);
});
