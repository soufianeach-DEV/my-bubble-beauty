import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RULES, blocked, clientIp, forget, hit, ipKey } from './rate.ts';

test("IP lue par la droite de X-Forwarded-For : la gauche forgée par le client est ignorée", () => {
  assert.equal(clientIp('6.6.6.6, 203.0.113.7'), '203.0.113.7');
  assert.equal(clientIp(' 203.0.113.7 '), '203.0.113.7');
  assert.equal(clientIp(null, '127.0.0.1'), '127.0.0.1');
  assert.equal(clientIp('', '127.0.0.1'), '127.0.0.1');
});

test('IPv6 regroupées par /64, IPv4 mappée rendue en IPv4', () => {
  assert.equal(ipKey('2001:db8:85a3:1234:5678:8a2e:370:7334'), '2001:db8:85a3:1234::/64');
  assert.equal(ipKey('2001:DB8:85A3:1234::1'), '2001:db8:85a3:1234::/64');
  assert.equal(ipKey('2001:db8::1'), '2001:db8:0:0::/64');
  assert.equal(ipKey('2001:0db8:0000:0001::abcd'), '2001:db8:0:1::/64');
  assert.equal(ipKey('fe80::1%eth0'), 'fe80:0:0:0::/64');
  assert.equal(ipKey('::ffff:192.0.2.1'), '192.0.2.1');
  assert.equal(ipKey('192.0.2.1'), '192.0.2.1');
  assert.equal(clientIp('1.1.1.1, 2a02:a03f:1:2:3:4:5:6'), '2a02:a03f:1:2::/64');
});

test('compteurs : échecs bloquent au maximum, fenêtre qui expire, remise à zéro par adresse', () => {
  const t0 = 1_000_000;
  const pair = 'gerante@example.com\n203.0.113.7';
  for (let i = 0; i < 5; i++) {
    assert.equal(blocked('loginPair', pair, t0), false);
    hit('loginPair', pair, t0);
  }
  assert.equal(blocked('loginPair', pair, t0), true);
  assert.equal(blocked('loginPair', 'gerante@example.com\n198.51.100.1', t0), false);
  assert.equal(blocked('loginPair', pair, t0 + 15 * 60_000), false);
  forget('loginPair', 'gerante@example.com');
  assert.equal(blocked('loginPair', pair, t0), false);

  for (let i = 0; i < 3; i++) assert.equal(hit('mailTo', 'x@example.com', t0), false);
  assert.equal(hit('mailTo', 'x@example.com', t0), true);
  forget('mailTo', 'x@example.co');
  assert.equal(blocked('mailTo', 'x@example.com', t0), true);
});

test("une rafale sur une règle n'efface les compteurs d'aucune autre, ni un verrou actif de la sienne", () => {
  const t0 = 5_000_000;
  for (let i = 0; i < 100; i++) hit('loginEmail', 'gerante@example.com', t0);
  for (let i = 0; i < 5; i++) hit('totp', '1', t0);
  for (let i = 0; i < 60_000; i++) hit('mailTo', `inventee${i}@example.com`, t0);
  assert.equal(blocked('loginEmail', 'gerante@example.com', t0), true);
  assert.equal(blocked('totp', '1', t0), true);

  const pair = 'gerante@example.com\n198.51.100.9';
  for (let i = 0; i < 5; i++) hit('loginPair', pair, t0);
  const last = 60_000;
  for (let i = 0; i <= last; i++) hit('loginPair', `x${i}@example.com\n198.51.100.9`, t0);
  assert.equal(blocked('loginPair', pair, t0), true);
  // Les plus anciens compteurs sous la limite ont fait la place ; le dernier est bien suivi
  for (let i = 0; i < 4; i++) hit('loginPair', `x${last}@example.com\n198.51.100.9`, t0);
  assert.equal(blocked('loginPair', `x${last}@example.com\n198.51.100.9`, t0), true);
});

test('règle pleine de verrous actifs : aucun verrou levé, le nouvel identifiant attend leur fin (mémoire bornée)', () => {
  const t1 = 9_000_000;
  for (let i = 0; i < RULES.totp.keys; i++) for (let j = 0; j < 5; j++) hit('totp', `u${i}`, t1);
  for (let j = 0; j < 10; j++) assert.equal(hit('totp', 'nouveau', t1), false);
  assert.equal(blocked('totp', 'nouveau', t1), false);
  for (let i = 0; i < RULES.totp.keys; i++) assert.equal(blocked('totp', `u${i}`, t1), true);
  const t2 = t1 + 15 * 60_000;
  for (let j = 0; j < 5; j++) hit('totp', 'nouveau', t2);
  assert.equal(blocked('totp', 'nouveau', t2), true);
  assert.equal(blocked('totp', 'u0', t2), false);
});

test('identifiant borné à 320 caractères dans hit, blocked et forget', () => {
  const t0 = 20_000_000;
  const huge = 'a'.repeat(60_000);
  for (let i = 0; i < 3; i++) assert.equal(hit('mailTo', `${huge}${i}`, t0), false);
  assert.equal(blocked('mailTo', 'a'.repeat(320), t0), true);
  assert.equal(hit('mailTo', 'a'.repeat(320) + 'autre', t0), true);
  forget('mailTo', huge);
  assert.equal(blocked('mailTo', 'a'.repeat(320), t0), false);
});
