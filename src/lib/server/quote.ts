// Devis du récapitulatif de réservation : mêmes contrôles et même lecture du code promo que createBooking, sans rien réserver ni verrouiller.
// Il n'engage aucun montant : le POST final repasse tout par createBooking.
import type { Lang } from '../site.ts';
import { MAX_UPCOMING } from './booking.ts';
import { sql } from './db.ts';
import { amounts, promoProblem, type Promo, type PromoProblem } from './pricing.ts';
import { blocked, hit } from './rate.ts';
import { isFree } from './slots.ts';

export type Quote = ReturnType<typeof amounts> & { name: string; duration_min: number; code: string | null };
export type QuoteResult = { ok: true; quote: Quote } | { ok: false; error: 'unavailable' | 'limit' | 'promo'; promo?: PromoProblem | 'blocked' };

// Sans aucun horaire saisi, aucun créneau ne peut exister : la page annonce l'ouverture prochaine plutôt qu'un agenda vide
export async function bookingOpen(): Promise<boolean> {
  const [{ open }] = await sql`SELECT EXISTS (SELECT 1 FROM opening_hours) AS open`;
  return open;
}

export async function quote(input: { userId: number; serviceId: number; startsAt: Date; promoCode?: string | null; lang: Lang }): Promise<QuoteResult> {
  const { userId, serviceId, startsAt, lang } = input;
  const code = input.promoCode?.trim().toUpperCase() || null;
  if (!Number.isInteger(serviceId) || Number.isNaN(startsAt.getTime())) return { ok: false, error: 'unavailable' };
  // Ses propres paiements en cours ne comptent pas : createBooking les expire avant de compter
  const [{ n }] = await sql`SELECT count(*) AS n FROM bookings WHERE user_id = ${userId} AND status = 'confirmed' AND starts_at > now()`;
  if (n >= MAX_UPCOMING) return { ok: false, error: 'limit' };
  const [s] = await sql`
    SELECT price_cents, deposit_cents, duration_min, CASE ${lang} WHEN 'nl' THEN name_nl WHEN 'en' THEN name_en ELSE name_fr END AS name
    FROM services WHERE id = ${serviceId} AND active`;
  if (!s || !(await isFree(sql, serviceId, startsAt, userId))) return { ok: false, error: 'unavailable' };
  let promo: Promo | null = null;
  if (code) {
    // Le devis est aussi un moyen de deviner un code : mêmes compteurs que la réservation
    if (blocked('promo', String(userId))) return { ok: false, error: 'promo', promo: 'blocked' };
    const [p] = /^[A-Z0-9-]{3,32}$/.test(code)
      ? await sql<(Promo & { id: number; today: string })[]>`SELECT id, kind, value, starts_on::text, ends_on::text, max_uses, once_per_user, service_ids, active, current_date::text AS today
          FROM promo_codes WHERE code = ${code}`
      : [];
    const [use] = p ? await sql`SELECT count(*) AS uses, count(*) FILTER (WHERE user_id = ${userId}) AS mine FROM bookings
          WHERE promo_code_id = ${p.id} AND status IN ('pending_payment', 'confirmed')` : [];
    const problem = p ? promoProblem(p, { today: p.today, serviceId, uses: use.uses, usesByUser: use.mine }) : 'unknown';
    if (problem) {
      hit('promo', String(userId));
      return { ok: false, error: 'promo', promo: problem };
    }
    promo = p;
  }
  return { ok: true, quote: { ...amounts(s.price_cents, s.deposit_cents, promo), name: s.name, duration_min: s.duration_min, code: promo && code } };
}
