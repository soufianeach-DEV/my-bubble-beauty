// Forfaits (Green Peel 3 ou 5 séances, Marine Peel, cures LED) : vente à l'institut, solde calculé, séance prise à la réservation, arrêt.
// Séance comptée = rendez-vous confirmé rattaché, non marqué absente (honoré ou à venir). Le site n'encaisse ni ne rembourse rien.
import type { Sql } from 'postgres';
import type { Lang } from '../site.ts';
import { audit, type Result } from './admin.ts';
import { sql } from './db.ts';

// Lignes forfait de la carte : nombre de séances et soin couvert. covers finit par « - » : toute prestation de cette famille,
// au choix de la gérante à la vente (les cures LED valent pour l'un des rituels lumière).
export const PACKAGE_LINES: Record<string, { sessions: number; covers: string }> = {
  'peeling-green-peel-3-seances': { sessions: 3, covers: 'peeling-green-peel' },
  'peeling-green-peel-5-seances': { sessions: 5, covers: 'peeling-green-peel' },
  'peeling-marine-peel-3-seances': { sessions: 3, covers: 'peeling-marine-peel' },
  'peeling-marine-peel-5-seances': { sessions: 5, covers: 'peeling-marine-peel' },
  'cures-led-cure-eclat': { sessions: 5, covers: 'lumiere-led-' },
  'cures-led-cure-beaute': { sessions: 10, covers: 'lumiere-led-' },
  'cures-led-cure-signature': { sessions: 10, covers: 'lumiere-led-' },
};
export const VALIDITY_MONTHS = 24;
export const coversSlug = (covers: string, slug: string) => (covers.endsWith('-') ? slug.startsWith(covers) : slug === covers);

export type PackageState = 'actif' | 'epuise' | 'expire' | 'arrete';
export const STATE_LABELS: Record<PackageState, string> = { actif: 'Actif', epuise: 'Épuisé', expire: 'Expiré', arrete: 'Arrêté' };
// Arrêt d'abord, puis échéance passée, puis plus aucune séance libre
export function packageState(p: { total: number; done: number; booked: number; expires_on: string; cancelled: boolean }, today: string): PackageState {
  if (p.cancelled) return 'arrete';
  if (p.expires_on < today) return 'expire';
  return p.done + p.booked >= p.total ? 'epuise' : 'actif';
}

export type PackageRow = { id: number; label: string; service: string; service_id: number; total: number; done: number; booked: number; left: number; price_cents: number;
  sold_at: Date; expires_on: string; cancelled_at: Date | null; cancel_reason: string; state: PackageState };

// Forfaits d'une cliente, les plus récents d'abord (fiche admin ; compte de la cliente dans sa langue, d'après la ligne de la carte)
export async function clientPackages(userId: number, lang: Lang = 'fr'): Promise<PackageRow[]> {
  const rows = await sql<(Omit<PackageRow, 'left' | 'state'> & { today: string })[]>`
    SELECT p.id, CASE ${lang} WHEN 'nl' THEN l.name_nl WHEN 'en' THEN l.name_en ELSE p.label END AS label, s.name_fr AS service, p.service_id, p.sessions_total AS total, p.price_cents, p.sold_at, p.expires_on::text, p.cancelled_at, p.cancel_reason,
      count(b.id) FILTER (WHERE b.starts_at < now())::int AS done, count(b.id) FILTER (WHERE b.starts_at >= now())::int AS booked,
      (now() AT TIME ZONE 'Europe/Brussels')::date::text AS today
    FROM packages p JOIN services s ON s.id = p.service_id JOIN services l ON l.id = p.line_id
    LEFT JOIN bookings b ON b.package_id = p.id AND b.status = 'confirmed' AND NOT b.no_show
    WHERE p.user_id = ${userId} GROUP BY p.id, s.name_fr, l.name_nl, l.name_en ORDER BY p.sold_at DESC, p.id DESC`;
  return rows.map(({ today, ...p }) => ({ ...p, left: Math.max(0, p.total - p.done - p.booked), state: packageState({ ...p, cancelled: !!p.cancelled_at }, today) }));
}

// Forfait actif de la cliente pour ce soin, valable le jour du rendez-vous : celui qui expire le premier. À appeler sous le verrou
// de la cliente (createBooking, createAdminBooking) pour qu'une même séance libre ne serve pas à deux réservations simultanées.
export async function packageFor(q: Sql, userId: number, serviceId: number, startsAt: Date): Promise<{ id: number; left: number } | null> {
  const [p] = await q<{ id: number; left: number }[]>`
    SELECT p.id, (p.sessions_total - count(b.id))::int AS left
    FROM packages p LEFT JOIN bookings b ON b.package_id = p.id AND b.status = 'confirmed' AND NOT b.no_show
    WHERE p.user_id = ${userId} AND p.service_id = ${serviceId} AND p.cancelled_at IS NULL
      AND p.expires_on >= (${startsAt}::timestamptz AT TIME ZONE 'Europe/Brussels')::date
    GROUP BY p.id HAVING p.sessions_total > count(b.id)
    ORDER BY p.expires_on, p.id LIMIT 1`;
  return p ?? null;
}

// Vente à la fiche : lignes forfait de la carte encore présentes, avec les soins qu'elles peuvent couvrir
export async function saleLines() {
  const all = await sql<{ id: number; slug: string; name_fr: string; price_cents: number; duration_min: number | null }[]>`
    SELECT id, slug, name_fr, price_cents, duration_min FROM services WHERE retired_at IS NULL ORDER BY sort, id`;
  return all.flatMap((l) => {
    const def = PACKAGE_LINES[l.slug];
    if (!def) return [];
    const covers = all.filter((s) => s.duration_min !== null && !PACKAGE_LINES[s.slug] && coversSlug(def.covers, s.slug));
    return covers.length ? [{ ...l, sessions: def.sessions, covers }] : [];
  });
}

const ID = /^[1-9]\d{0,9}$/;
const line1 = (v: unknown, max: number) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);

// Vente : ligne de la carte (prix repris), soin couvert choisi parmi ceux de la ligne ; échéance à 24 mois, jour de Bruxelles
export async function sellPackage(staff: number, userId: number, form: FormData): Promise<Result> {
  // Un seul menu sans script : « ligne-soin couvert »
  const [line = '', cover = ''] = String(form.get('offer') ?? '').split('-');
  if (!ID.test(line) || !ID.test(cover)) return { ok: false, error: 'Choisissez le forfait et le soin couvert.' };
  if (form.get('confirm') !== 'on') return { ok: false, error: 'Cochez la case pour confirmer.' };
  const l = (await saleLines()).find((x) => x.id === Number(line));
  const s = l?.covers.find((x) => x.id === Number(cover));
  if (!l || !s) return { ok: false, error: 'Forfait ou soin introuvable dans la carte.' };
  const [u] = await sql`SELECT id FROM users WHERE id = ${userId} AND role IS NULL AND removed_at IS NULL AND deleted_at IS NULL`;
  if (!u) return { ok: false, error: 'Cliente introuvable ou compte inactif.' };
  const [p] = await sql<{ id: number }[]>`
    INSERT INTO packages (user_id, service_id, line_id, label, sessions_total, price_cents, sold_by, expires_on)
    VALUES (${userId}, ${s.id}, ${l.id}, ${l.name_fr}, ${l.sessions}, ${l.price_cents}, ${staff},
      ((now() AT TIME ZONE 'Europe/Brussels')::date + make_interval(months => ${VALIDITY_MONTHS}))::date)
    RETURNING id`;
  audit(staff, 'package_sold', { client_id: userId, package_id: p.id, line_id: l.id, service_id: s.id, sessions: l.sessions, price: l.price_cents });
  return { ok: true, id: userId, key: 'forfait-vendu' };
}

// Arrêt à la demande de la cliente : plus aucune séance prise dessus. Les rendez-vous déjà réservés restent rattachés.
export async function stopPackage(staff: number, userId: number, form: FormData): Promise<Result> {
  const id = String(form.get('package') ?? '');
  if (!ID.test(id)) return { ok: false, error: 'Forfait introuvable.' };
  if (form.get('confirm') !== 'on') return { ok: false, error: 'Cochez la case pour confirmer.' };
  const reason = line1(form.get('reason'), 300);
  const [p] = await sql`UPDATE packages SET cancelled_at = now(), cancel_reason = ${reason}
    WHERE id = ${Number(id)} AND user_id = ${userId} AND cancelled_at IS NULL RETURNING id`;
  if (!p) return { ok: false, error: 'Forfait introuvable ou déjà arrêté.' };
  // Le motif reste en base, il n'entre pas au journal (texte libre)
  audit(staff, 'package_stopped', { client_id: userId, package_id: p.id });
  return { ok: true, id: userId, key: 'forfait-arrete' };
}

// Rendez-vous détaché de son forfait (agenda, fiche) : la séance est rendue et le rendez-vous repasse au prix de la carte
export async function unlinkPackage(bookingId: number): Promise<{ user_id: number | null; package_id: number } | null> {
  const [b] = await sql<{ user_id: number | null; package_id: number }[]>`
    WITH old AS (SELECT id, package_id FROM bookings WHERE id = ${bookingId} AND package_id IS NOT NULL FOR UPDATE)
    UPDATE bookings k SET package_id = NULL, price_cents = s.price_cents, discount_cents = 0
    FROM old, services s WHERE k.id = old.id AND s.id = k.service_id RETURNING k.user_id, old.package_id`;
  return b ?? null;
}
