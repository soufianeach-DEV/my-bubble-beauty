// Vue semaine de l'Agenda : placement des rendez-vous dans une grille de lignes de 5 minutes (classes de agenda-grille.css).
// Module pur, testé sans base. Minutes depuis minuit, heure de Bruxelles.
export type Span = { start: number; end: number };
export type Placed = { row: number; rows: number; lane: number; lanes: number };

// Bornes de la grille : ouverture la plus tôt et fermeture la plus tard, élargies aux rendez-vous, arrondies à l'heure, 16 h au plus
export function gridBounds(open: { from: number; to: number } | null, items: Span[]): { lo: number; hi: number } {
  let lo = Math.min(open?.from ?? 540, ...items.map((i) => i.start));
  let hi = Math.max(open?.to ?? 1080, ...items.map((i) => i.end));
  lo = Math.floor(lo / 60) * 60;
  hi = Math.min(Math.ceil(hi / 60) * 60, 1440);
  if (hi - lo > 960) lo = hi - 960;
  return { lo, hi };
}

// Ligne de début, nombre de lignes, couloir sur le nombre de couloirs du groupe de rendez-vous qui se chevauchent (4 au plus).
// Résultat dans l'ordre des entrées.
export function placeSpans(items: Span[], lo: number, hi: number): Placed[] {
  const nRows = (hi - lo) / 5;
  const out: Placed[] = new Array(items.length);
  const order = items.map((_, i) => i).sort((a, b) => items[a].start - items[b].start);
  let group: { i: number; lane: number }[] = [];
  let groupEnd = -1;
  const flush = () => {
    const lanes = Math.min(Math.max(0, ...group.map((g) => g.lane)) + 1, 4);
    for (const { i, lane } of group) {
      const s = Math.max(items[i].start, lo), e = Math.min(items[i].end, hi);
      const row = Math.min(Math.max(Math.floor((s - lo) / 5) + 1, 1), nRows);
      const rows = Math.min(Math.max(Math.ceil((e - s) / 5), 1), nRows - row + 1, 144);
      out[i] = { row, rows, lane: (lane % lanes) + 1, lanes };
    }
    group = [];
  };
  for (const i of order) {
    if (group.length && items[i].start >= groupEnd) { flush(); groupEnd = -1; }
    // Premier couloir libre à l'heure de début
    const busy = new Set(group.filter((g) => items[g.i].end > items[i].start).map((g) => g.lane));
    let lane = 0;
    while (busy.has(lane)) lane++;
    group.push({ i, lane });
    groupEnd = Math.max(groupEnd, items[i].end);
  }
  if (group.length) flush();
  return out;
}
