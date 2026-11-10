import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gridBounds, placeSpans } from './agenda-grille.ts';

test('agenda semaine : bornes de la grille', () => {
  assert.deepEqual(gridBounds({ from: 570, to: 1110 }, []), { lo: 540, hi: 1140 }, '09:30–18:30 arrondi à 09:00–19:00');
  assert.deepEqual(gridBounds({ from: 570, to: 1110 }, [{ start: 450, end: 480 }]), { lo: 420, hi: 1140 }, 'rendez-vous à 07:30 hors horaires');
  assert.deepEqual(gridBounds(null, [{ start: 0, end: 1440 }]), { lo: 480, hi: 1440 }, '16 h au plus');
});

test('agenda semaine : hauteur selon la durée, chevauchements côte à côte', () => {
  // 09:00–10:00 seul ; 10:00–11:30 et 10:30–11:00 se chevauchent ; 11:30 repart sur un seul couloir
  const p = placeSpans([{ start: 600, end: 690 }, { start: 540, end: 600 }, { start: 630, end: 660 }, { start: 690, end: 720 }], 540, 1140);
  assert.deepEqual(p[1], { row: 1, rows: 12, lane: 1, lanes: 1 });
  assert.deepEqual(p[0], { row: 13, rows: 18, lane: 1, lanes: 2 });
  assert.deepEqual(p[2], { row: 19, rows: 6, lane: 2, lanes: 2 });
  assert.deepEqual(p[3], { row: 31, rows: 6, lane: 1, lanes: 1 });
  // Couloir libéré réutilisé : A 10–12, B 10–10:30, C 10:30–11 → C reprend le couloir de B
  const q = placeSpans([{ start: 600, end: 720 }, { start: 600, end: 630 }, { start: 630, end: 660 }], 540, 1140);
  assert.deepEqual(q.map((x) => [x.lane, x.lanes]), [[1, 2], [2, 2], [2, 2]]);
  // Au-delà de la grille : bloc tronqué, jamais hors des lignes
  assert.deepEqual(placeSpans([{ start: 1100, end: 1300 }], 540, 1140)[0], { row: 113, rows: 8, lane: 1, lanes: 1 });
});
