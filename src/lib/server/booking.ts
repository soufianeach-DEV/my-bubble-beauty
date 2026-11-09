// Réservations : création (verrous, limites, montants relus en base), paiement de l'acompte, annulations, listes.
// Aucun montant ne vient du formulaire ; l'exclusion bookings_no_overlap (23P01) tranche les courses entre deux clientes.
import type { Sql } from 'postgres';
import { STRIPE_WEBHOOK_SECRET } from 'astro:env/server';
import type { Lang } from '../site.ts';
import { sql } from './db.ts';
import { journal } from './journal.ts';
import { log } from './log.ts';
import { bookingCancelledMail, bookingConfirmedMail, bookingMovedMail, bookingReminderMail, aftercareMail, sendMail } from './mail.ts';
import { amounts, isDay, promoProblem, type Promo, type PromoProblem } from './pricing.ts';
import { blocked, hit, promoDone, promoTry } from './rate.ts';
import { checkGift, GIFT_CODE } from './cadeaux.ts';
import { isFree } from './slots.ts';
import { createCheckoutSession, expireSession, refund, retrieveSession, type CheckoutSession } from './stripe.ts';
import { verifyWebhookSignature } from './stripe-signature.ts';

// Réservations futures par cliente : un seul compte ne bloque pas l'agenda (les saisies de l'admin ne comptent pas)
export const MAX_UPCOMING = 2;

const DEPOSIT_LABEL: Record<Lang, string> = { fr: 'Acompte', nl: 'Voorschot', en: 'Deposit' };
const isOverlap = (e: unknown) => (e as { code?: string })?.code === '23P01';
// Deux INSERT simultanés sur le même créneau s'attendent dans l'index d'exclusion : Postgres en abandonne un en 40P01 au lieu de 23P01
const isTaken = (e: unknown) => isOverlap(e) || (e as { code?: string })?.code === '40P01';

// Paiements abandonnés (> 35 min) et, pour une cliente, ses propres paiements en cours : ils ne bloquent plus l'exclusion.
// Seules les sessions encore ouvertes chez Stripe (< 30 min) sont à expirer ensuite.
async function expirePending(q: Sql, userId: number | null) {
  const rows = await q<{ open: string | null }[]>`
    UPDATE bookings SET status = 'expired'
    WHERE status = 'pending_payment' AND (created_at <= now() - interval '35 minutes' OR user_id = ${userId})
    RETURNING CASE WHEN created_at > now() - interval '30 minutes' THEN stripe_session_id END AS open`;
  return rows.map((r) => r.open).filter((id): id is string => !!id);
}

const expireAtStripe = (ids: string[]) => {
  for (const id of ids) expireSession(id).catch((e) => log('stripe_expire_failed', { session: id, error: String(e) }));
};

// E-mail dans la langue de la cliente (envoyé hors requête : webhook, annulation par l'admin) ; rien pour une invitée
function notify(bookingId: number, kind: 'confirmed' | 'cancelled' | 'moved' | 'reminder', refundCents = 0) {
  sql<{ email: string; locale: Lang; service: string; starts_at: Date; price_cents: number; discount_cents: number; deposit_cents: number }[]>`
    SELECT u.email, u.locale, CASE u.locale WHEN 'nl' THEN s.name_nl WHEN 'en' THEN s.name_en ELSE s.name_fr END AS service,
      b.starts_at, b.price_cents, b.discount_cents, b.deposit_cents
    FROM bookings b JOIN users u ON u.id = b.user_id JOIN services s ON s.id = b.service_id WHERE b.id = ${bookingId}`
    .then(([b]) => b && sendMail(b.email, kind === 'confirmed' ? bookingConfirmedMail(b.locale, b) : kind === 'moved' ? bookingMovedMail(b.locale, b) : kind === 'reminder' ? bookingReminderMail(b.locale, b) : bookingCancelledMail(b.locale, b, refundCents)))
    .catch((e) => log('mail_failed', { kind, booking_id: bookingId, error: String(e) }));
}

// refunded_cents n'est écrit qu'après l'accord de Stripe : un échec reste visible dans l'admin (payé, non remboursé)
// Ligne verrouillée pendant l'appel à Stripe : « remboursé hors site » attend la fin et voit l'acompte rendu ; un acompte déjà
// noté rendu hors site n'est jamais renvoyé par Stripe.
async function refundBooking(bookingId: number, paymentIntent: string, amount: number): Promise<boolean> {
  try {
    return await sql.begin(async (tx) => {
      const [b] = await tx`SELECT refunded_manually_at FROM bookings WHERE id = ${bookingId} FOR UPDATE`;
      if (!b || b.refunded_manually_at) {
        log('refund_skipped_manual', { booking_id: bookingId });
        return false;
      }
      await refund(paymentIntent, amount, bookingId);
      await tx`UPDATE bookings SET refunded_cents = ${amount} WHERE id = ${bookingId}`;
      log('refund_ok', { booking_id: bookingId, amount });
      return true;
    });
  } catch (e) {
    log('refund_failed', { booking_id: bookingId, amount, error: String(e) });
    return false;
  }
}

export type BookingError = 'unavailable' | 'limit' | 'promo' | 'payment' | 'busy';
export type BookingResult =
  | { ok: true; id: number; checkoutUrl: string | null }
  | { ok: false; error: BookingError; promo?: PromoProblem | 'blocked' };

// POST /reserver. checkoutUrl non nul : rediriger en 303 vers Stripe ; nul : réservation déjà confirmée (sans acompte).
export async function createBooking(input: { userId: number; serviceId: number; startsAt: Date; promoCode?: string | null; lang: Lang; ip?: string }): Promise<BookingResult> {
  const { userId, serviceId, startsAt, lang, ip } = input;
  const code = input.promoCode?.trim().toUpperCase() || null;
  if (!Number.isInteger(serviceId) || Number.isNaN(startsAt.getTime())) return { ok: false, error: 'unavailable' };
  // Chaque compte ne garde qu'un paiement en cours, mais plusieurs comptes depuis la même connexion pourraient tenir l'agenda 35 min chacun
  if (ip && blocked('booking', ip)) return { ok: false, error: 'busy' };
  let stale: string[] = [];
  let r;
  try {
    r = await sql.begin(async (tx) => {
      // Verrous toujours dans cet ordre (cliente, puis code promo) : deux réservations simultanées ne s'interbloquent pas
      // Compte supprimé ou bloqué entre-temps (course avec la suppression) : aucune ligne, aucune réservation
      const [me] = await tx`SELECT id FROM users WHERE id = ${userId} AND deleted_at IS NULL AND blocked_at IS NULL AND removed_at IS NULL FOR UPDATE`;
      if (!me) return { ok: false, error: 'unavailable' } as const;
      stale = await expirePending(tx, userId);
      const [{ n }] = await tx`SELECT count(*) AS n FROM bookings WHERE user_id = ${userId} AND status IN ('pending_payment', 'confirmed') AND starts_at > now()`;
      if (n >= MAX_UPCOMING) return { ok: false, error: 'limit' } as const;
      const [s] = await tx`
        SELECT price_cents, deposit_cents, duration_min + buffer_min AS busy_min, CASE ${lang} WHEN 'nl' THEN name_nl WHEN 'en' THEN name_en ELSE name_fr END AS name
        FROM services WHERE id = ${serviceId} AND active`;
      if (!s || !(await isFree(tx, serviceId, startsAt))) return { ok: false, error: 'unavailable' } as const;
      let promo: (Promo & { id: number }) | null = null;
      let gift: number | null = null;
      if (code) {
        // Lu sous le verrou de la cliente : en rafale, chaque essai voit les échecs comptés par le précédent.
        // Après les contrôles de plafond, de prestation et de créneau : un créneau pris ne consomme aucun essai sur l'IP
        if (!promoTry(userId, ip)) return { ok: false, error: 'promo', promo: 'blocked' } as const;
      }
      // Bon cadeau : même champ et mêmes compteurs que le code promo ; le soin du bon est offert
      if (code && GIFT_CODE.test(code)) {
        const g = await checkGift(tx, code, serviceId, true);
        promoDone(userId, ip, !('problem' in g));
        if ('problem' in g) return { ok: false, error: 'promo', promo: g.problem } as const;
        gift = g.id;
      } else if (code) {
        const [p] = /^[A-Z0-9-]{3,32}$/.test(code)
          ? await tx<(Promo & { id: number; today: string })[]>`SELECT id, kind, value, starts_on::text, ends_on::text, max_uses, once_per_user, service_ids, active, current_date::text AS today
              FROM promo_codes WHERE code = ${code} FOR UPDATE`
          : [];
        const [use] = p ? await tx`SELECT count(*) AS uses, count(*) FILTER (WHERE user_id = ${userId}) AS mine FROM bookings
              WHERE promo_code_id = ${p.id} AND status IN ('pending_payment', 'confirmed')` : [];
        const problem = p ? promoProblem(p, { today: p.today, serviceId, uses: use.uses, usesByUser: use.mine }) : 'unknown';
        if (problem) {
          promoDone(userId, ip, false);
          return { ok: false, error: 'promo', promo: problem } as const;
        }
        promoDone(userId, ip, true);
        promo = p;
      }
      const m = amounts(s.price_cents, s.deposit_cents, gift ? { kind: 'amount', value: s.price_cents } : promo);
      const [b] = await tx`
        INSERT INTO bookings (user_id, service_id, starts_at, ends_at, status, price_cents, discount_cents, deposit_cents, promo_code_id, gift_card_id)
        VALUES (${userId}, ${serviceId}, ${startsAt}, ${startsAt}::timestamptz + make_interval(mins => ${s.busy_min}::int),
          ${m.deposit_cents ? 'pending_payment' : 'confirmed'}, ${m.price_cents}, ${m.discount_cents}, ${m.deposit_cents}, ${promo?.id ?? null}, ${gift})
        RETURNING id`;
      return { ok: true, id: b.id as number, deposit: m.deposit_cents, label: `${DEPOSIT_LABEL[lang]} - ${s.name}` } as const;
    });
  } catch (e) {
    if (isTaken(e)) return { ok: false, error: 'unavailable' };
    // Même bon cadeau réservé au même instant par une autre réservation : l'index unique tranche
    if ((e as { constraint_name?: string })?.constraint_name === 'bookings_gift_idx') return { ok: false, error: 'promo', promo: 'used' };
    throw e;
  }
  expireAtStripe(stale);
  if (!r.ok) return r;
  if (ip) hit('booking', ip);
  journal('booking_created', { actor: userId, client: userId, booking: r.id, details: { deposit: r.deposit } });
  if (!r.deposit) {
    notify(r.id, 'confirmed');
    return { ok: true, id: r.id, checkoutUrl: null };
  }
  try {
    const session = await createCheckoutSession({ bookingId: r.id, userId, serviceId, amount: r.deposit, label: r.label, lang });
    await sql`UPDATE bookings SET stripe_session_id = ${session.id} WHERE id = ${r.id}`;
    return { ok: true, id: r.id, checkoutUrl: session.url };
  } catch (e) {
    // Sans session Stripe, le créneau ne reste pas bloqué 35 min
    await sql`UPDATE bookings SET status = 'expired' WHERE id = ${r.id} AND status = 'pending_payment'`;
    log('checkout_failed', { booking_id: r.id, error: String(e) });
    return { ok: false, error: 'payment' };
  }
}

export type PaymentOutcome = 'confirmed' | 'already' | 'refunded' | 'unpaid' | 'unknown';

// Paiement d'une réservation déjà expirée (remplacée par une autre de la cliente, ou payée tard) : les règles de createBooking valent
// encore au moment de confirmer, sinon payer deux sessions ouvertes dépasserait les 2 rendez-vous ou l'usage unique d'un code promo.
async function stillAllowed(tx: Sql, id: number, b: { user_id: number | null; service_id: number; promo_code_id: number | null; starts_at: Date }) {
  if (b.starts_at <= new Date()) return false;
  if (b.user_id) {
    const [active] = await tx`SELECT 1 FROM users WHERE id = ${b.user_id} AND deleted_at IS NULL AND blocked_at IS NULL AND removed_at IS NULL`;
    if (!active) return false;
    const [{ n }] = await tx`SELECT count(*) AS n FROM bookings WHERE user_id = ${b.user_id} AND id <> ${id} AND status IN ('pending_payment', 'confirmed') AND starts_at > now()`;
    if (n >= MAX_UPCOMING) return false;
  }
  if (b.promo_code_id) {
    // Même contrôle complet qu'à la création (actif, dates, prestations, quotas) : un code désactivé entre-temps ne passe plus
    const [p] = await tx<(Promo & { today: string })[]>`SELECT kind, value, starts_on::text, ends_on::text, max_uses, once_per_user, service_ids, active, current_date::text AS today
      FROM promo_codes WHERE id = ${b.promo_code_id} FOR UPDATE`;
    const [u] = await tx`SELECT count(*) AS uses, count(*) FILTER (WHERE user_id = ${b.user_id}) AS mine FROM bookings
      WHERE promo_code_id = ${b.promo_code_id} AND id <> ${id} AND status IN ('pending_payment', 'confirmed')`;
    if (!p || promoProblem(p, { today: p.today, serviceId: b.service_id, uses: u.uses, usesByUser: u.mine })) return false;
  }
  return true;
}

// Seule voie de confirmation d'un acompte (webhook et page de retour). Un paiement n'est jugé qu'une fois, par l'appel qui le rattache
// à la réservation : ensuite tout rejeu (relivraison, success_url rouverte) répond 'already' quel que soit le statut, même après une
// annulation où l'admin garde l'acompte ; l'état se lit dans la liste des réservations. Un paiement qui ne peut plus donner de rendez-vous
// (créneau repris après expiration, annulation pendant le paiement, montant inattendu) est remboursé ; un échec se relance depuis l'admin.
export async function confirmPayment(s: CheckoutSession): Promise<PaymentOutcome> {
  if (s.payment_status !== 'paid') return 'unpaid';
  const pi = typeof s.payment_intent === 'string' ? s.payment_intent : (s.payment_intent?.id ?? null);
  const [b] = await sql`SELECT id, deposit_cents, stripe_payment_intent FROM bookings WHERE stripe_session_id = ${s.id}`;
  if (!b || !pi) {
    log('stripe_unknown_session', { session: s.id });
    return 'unknown';
  }
  if (b.stripe_payment_intent === pi) return 'already';
  let row;
  if (s.amount_total === b.deposit_cents && s.currency === 'eur') {
    try {
      row = await sql.begin(async (tx) => {
        // Cliente verrouillée d'abord (même ordre que createBooking), puis réservation relue sous verrou : le statut jugé est celui modifié
        const [{ user_id }] = await tx`SELECT user_id FROM bookings WHERE id = ${b.id}`;
        if (user_id) await tx`SELECT id FROM users WHERE id = ${user_id} FOR UPDATE`;
        const [cur] = await tx`SELECT status, user_id, service_id, promo_code_id, starts_at FROM bookings WHERE id = ${b.id} FOR UPDATE`;
        if (cur.status === 'expired' && !(await stillAllowed(tx, b.id, cur))) return null;
        const [r] = await tx`UPDATE bookings SET status = 'confirmed', stripe_payment_intent = ${pi}
          WHERE id = ${b.id} AND status = ${cur.status} AND status IN ('pending_payment', 'expired') AND stripe_payment_intent IS NULL RETURNING id`;
        return r ?? null;
      });
    } catch (e) {
      if (!isOverlap(e)) throw e;
    }
  } else log('stripe_amount_mismatch', { booking_id: b.id, amount: s.amount_total, currency: s.currency });
  if (row) {
    log('booking_paid', { booking_id: b.id });
    notify(b.id, 'confirmed');
    return 'confirmed';
  }
  // Rattaché avant toute décision de remboursement : aucune ligne = l'autre appel (webhook ou page de retour) l'a déjà jugé
  const [mine] = await sql`UPDATE bookings SET stripe_payment_intent = ${pi} WHERE id = ${b.id} AND stripe_payment_intent IS NULL RETURNING status`;
  if (!mine) return 'already';
  const amount = s.amount_total ?? 0;
  log('payment_without_booking', { booking_id: b.id, status: mine.status });
  if (await refundBooking(b.id, pi, amount)) notify(b.id, 'cancelled', amount);
  return 'refunded';
}

// POST /api/stripe/webhook avec le corps BRUT (request.text() avant tout parsing) ; renvoie le code HTTP à répondre.
// Seul checkout.session.completed est écouté ; 500 fait relivrer l'événement par Stripe.
export async function stripeWebhook(raw: string, signature: string | null): Promise<number> {
  if (!STRIPE_WEBHOOK_SECRET || !verifyWebhookSignature(raw, signature, STRIPE_WEBHOOK_SECRET)) {
    log('stripe_bad_signature', {});
    return 400;
  }
  const event = JSON.parse(raw);
  log('stripe_event', { type: event.type, id: event.id, booking_id: event.data?.object?.metadata?.booking_id ?? null });
  if (event.type !== 'checkout.session.completed') return 200;
  try {
    await confirmPayment(event.data.object);
    return 200;
  } catch (e) {
    log('stripe_event_failed', { id: event.id, error: String(e) });
    return 500;
  }
}

// success_url (/{d}/compte?session_id=…) : l'instance gratuite dort parfois quand le webhook arrive, la page confirme elle-même.
// Seule action admise sur un GET : rejouable, elle ne fait que refléter l'état de Stripe, et seulement pour la cliente de la réservation.
export async function confirmReturn(userId: number, sessionId: unknown): Promise<PaymentOutcome | null> {
  if (typeof sessionId !== 'string' || !/^cs_[A-Za-z0-9_]{1,200}$/.test(sessionId)) return null;
  const [b] = await sql`SELECT id FROM bookings WHERE stripe_session_id = ${sessionId} AND user_id = ${userId}`;
  if (!b) return null;
  try {
    return await confirmPayment(await retrieveSession(sessionId));
  } catch (e) {
    log('stripe_return_failed', { booking_id: b.id, error: String(e) });
    return null;
  }
}

// Annulation par la cliente : 24 h avant au plus tard, garde atomique (un double clic n'annule ni ne rembourse deux fois)
export async function cancelByClient(userId: number, bookingId: number): Promise<{ ok: true; refunded: boolean } | { ok: false; error: 'too_late' | 'not_found' }> {
  const [b] = await sql`
    UPDATE bookings SET status = 'cancelled', cancelled_at = now(), cancel_reason = 'client'
    WHERE id = ${bookingId} AND user_id = ${userId} AND status = 'confirmed' AND starts_at >= now() + interval '24 hours'
    RETURNING id, deposit_cents, stripe_payment_intent`;
  if (!b) {
    const [later] = await sql`SELECT 1 FROM bookings WHERE id = ${bookingId} AND user_id = ${userId} AND status = 'confirmed' AND starts_at > now()`;
    log('booking_cancel_refused', { booking_id: bookingId, user_id: userId, too_late: !!later });
    return { ok: false, error: later ? 'too_late' : 'not_found' };
  }
  journal('booking_cancelled', { actor: userId, client: userId, booking: b.id, details: { by: 'client' } });
  const paid = b.stripe_payment_intent && b.deposit_cents > 0;
  const refunded = paid ? await refundBooking(b.id, b.stripe_payment_intent, b.deposit_cents) : false;
  notify(b.id, 'cancelled', paid ? b.deposit_cents : 0);
  return { ok: true, refunded };
}

// Annulation par l'admin, toujours possible ; remboursement au choix. Rappelée sur une réservation déjà annulée, ou expirée mais payée
// (paiement arrivé trop tard dont le remboursement automatique a échoué), elle relance le remboursement du reste dû, avec la même
// Idempotency-Key. Une réservation en attente de paiement voit sa session Stripe expirée.
export async function cancelByAdmin(bookingId: number, refundDeposit: boolean): Promise<{ ok: true; refunded: boolean } | { ok: false }> {
  const [b] = await sql`
    WITH old AS (SELECT id, status FROM bookings WHERE id = ${bookingId}
      AND (status IN ('pending_payment', 'confirmed', 'cancelled') OR (status = 'expired' AND stripe_payment_intent IS NOT NULL)) FOR UPDATE)
    UPDATE bookings k SET status = 'cancelled', cancelled_at = coalesce(k.cancelled_at, now()), cancel_reason = coalesce(k.cancel_reason, 'admin') FROM old WHERE k.id = old.id
    RETURNING k.id, old.status AS was, k.user_id, k.deposit_cents, k.refunded_cents, k.stripe_session_id, k.stripe_payment_intent`;
  if (!b) return { ok: false };
  if (b.was === 'pending_payment' && b.stripe_session_id) expireAtStripe([b.stripe_session_id]);
  const due = b.stripe_payment_intent ? b.deposit_cents - b.refunded_cents : 0;
  const refunded = refundDeposit && due > 0 ? await refundBooking(b.id, b.stripe_payment_intent, due) : false;
  log('booking_cancelled', { booking_id: b.id, by: 'admin', refund: refundDeposit });
  // Paiement tardif : la cliente n'a reçu aucun e-mail tant que le remboursement échouait
  if (b.was === 'pending_payment' || b.was === 'confirmed' || (b.was === 'expired' && refunded)) notify(b.id, 'cancelled', refundDeposit ? due : 0);
  return { ok: true, refunded };
}

// Saisie admin (téléphone, WhatsApp) : confirmée, sans acompte, hors horaires et délais, mais jamais sur un autre rendez-vous
export async function createAdminBooking(input: { serviceId: number; startsAt: Date; guestName: string; guestPhone?: string | null }): Promise<{ ok: true; id: number } | { ok: false; error: 'unavailable' | 'service' }> {
  if (Number.isNaN(input.startsAt.getTime())) return { ok: false, error: 'unavailable' };
  expireAtStripe(await expirePending(sql, null));
  try {
    const [b] = await sql`
      INSERT INTO bookings (guest_name, guest_phone, service_id, starts_at, ends_at, status, price_cents)
      SELECT ${input.guestName}, ${input.guestPhone || null}, id, ${input.startsAt}, ${input.startsAt}::timestamptz + make_interval(mins => duration_min + buffer_min), 'confirmed', price_cents
      FROM services WHERE id = ${input.serviceId} AND duration_min IS NOT NULL AND retired_at IS NULL
      RETURNING id`;
    if (!b) return { ok: false, error: 'service' };
    log('admin_booking', { booking_id: b.id });
    return { ok: true, id: b.id };
  } catch (e) {
    if (isTaken(e)) return { ok: false, error: 'unavailable' };
    throw e;
  }
}

// Compte de la cliente : toujours filtré par user_id (pas d'accès à la réservation d'une autre en changeant l'identifiant)
export function clientBookings(userId: number, lang: Lang) {
  return sql<{ id: number; service: string; starts_at: Date; ends_at: Date; status: 'pending_payment' | 'confirmed' | 'cancelled'; price_cents: number; discount_cents: number; deposit_cents: number; refunded_cents: number; upcoming: boolean; cancellable: boolean; no_show: boolean }[]>`
    SELECT b.id, CASE ${lang} WHEN 'nl' THEN s.name_nl WHEN 'en' THEN s.name_en ELSE s.name_fr END AS service, b.starts_at, b.ends_at, b.status,
      b.price_cents, b.discount_cents, b.deposit_cents, b.refunded_cents, b.starts_at > now() AS upcoming, b.no_show,
      -- Même délai pour annuler et pour déplacer : 24 h avant au plus tard
      b.status = 'confirmed' AND b.starts_at >= now() + interval '24 hours' AS cancellable
    FROM bookings b JOIN services s ON s.id = b.service_id
    WHERE b.user_id = ${userId}
      AND (b.status IN ('confirmed', 'cancelled') OR (b.status = 'pending_payment' AND b.created_at > now() - interval '35 minutes'))
    ORDER BY b.starts_at DESC`;
}

// Agenda admin : `days` jours à partir de `from` ('AAAA-MM-JJ', Bruxelles). paid = acompte encaissé ; paid et refunded_cents < deposit_cents
// sur une annulée = acompte gardé ou remboursement échoué, sur une expirée = paiement tardif non remboursé (à relancer par cancelByAdmin).
export function adminAgenda(from: string, days = 7) {
  if (!isDay(from)) return Promise.resolve([]);
  return sql<{ id: number; starts_at: Date; ends_at: Date; status: 'pending_payment' | 'confirmed' | 'cancelled' | 'expired'; service: string; name: string | null; phone: string | null; email: string | null; user_id: number | null; guest: boolean; erased: boolean; deleting: boolean; past: boolean; no_show: boolean; cancel_reason: string | null; refunded_manually: boolean; price_cents: number; discount_cents: number; deposit_cents: number; refunded_cents: number; paid: boolean; promo: string | null }[]>`
    SELECT b.id, b.starts_at, b.ends_at, b.status, s.name_fr AS service, coalesce(u.name, b.guest_name) AS name, coalesce(u.phone, b.guest_phone) AS phone,
      u.email, b.user_id, b.user_id IS NULL AND NOT b.client_erased AS guest, b.client_erased AS erased, u.deleted_at IS NOT NULL AS deleting,
      b.starts_at < now() AS past, b.no_show, b.cancel_reason, b.refunded_manually_at IS NOT NULL AS refunded_manually,
      b.price_cents, b.discount_cents, b.deposit_cents, b.refunded_cents, b.stripe_payment_intent IS NOT NULL AS paid, p.code AS promo
    FROM bookings b JOIN services s ON s.id = b.service_id LEFT JOIN users u ON u.id = b.user_id LEFT JOIN promo_codes p ON p.id = b.promo_code_id
    WHERE b.starts_at >= ${from}::text::date::timestamp AT TIME ZONE 'Europe/Brussels'
      AND b.starts_at < (${from}::text::date + ${Math.min(Math.max(Math.trunc(days) || 1, 1), 62)}::int)::timestamp AT TIME ZONE 'Europe/Brussels'
      AND (b.status IN ('confirmed', 'cancelled') OR (b.status = 'pending_payment' AND b.created_at > now() - interval '35 minutes')
        OR (b.status = 'expired' AND b.stripe_payment_intent IS NOT NULL))
    ORDER BY b.starts_at`;
}

const SERVICE_NAME = (lang: Lang) => sql`CASE ${lang} WHEN 'nl' THEN s.name_nl WHEN 'en' THEN s.name_en ELSE s.name_fr END`;

// Rendez-vous de la cliente qu'elle peut encore déplacer (confirmé, 24 h avant au plus tard) ; null sinon
export async function movableBooking(userId: number, bookingId: number, lang: Lang) {
  const [b] = await sql<{ id: number; service_id: number; service: string; starts_at: Date }[]>`
    SELECT b.id, b.service_id, ${SERVICE_NAME(lang)} AS service, b.starts_at
    FROM bookings b JOIN services s ON s.id = b.service_id
    WHERE b.id = ${bookingId} AND b.user_id = ${userId} AND b.status = 'confirmed' AND b.starts_at >= now() + interval '24 hours'`;
  return b ?? null;
}

// Déplacement par la cliente : même prestation, même acompte ; le nouveau créneau suit les règles en ligne (horaires, 2 h à 60 jours).
// Garde atomique : la ligne est relue sous verrou, l'exclusion bookings_no_overlap tranche toujours les courses.
export async function rescheduleByClient(userId: number, bookingId: number, startsAt: Date): Promise<'ok' | 'unavailable' | 'not_found'> {
  if (Number.isNaN(startsAt.getTime())) return 'unavailable';
  let r: 'ok' | 'unavailable' | 'not_found';
  try {
    r = await sql.begin(async (tx) => {
      const [me] = await tx`SELECT id FROM users WHERE id = ${userId} AND deleted_at IS NULL AND blocked_at IS NULL AND removed_at IS NULL FOR UPDATE`;
      if (!me) return 'not_found' as const;
      const [b] = await tx`SELECT id, service_id FROM bookings
        WHERE id = ${bookingId} AND user_id = ${userId} AND status = 'confirmed' AND starts_at >= now() + interval '24 hours' FOR UPDATE`;
      if (!b) return 'not_found' as const;
      if (!(await isFree(tx, b.service_id, startsAt, userId, b.id))) return 'unavailable' as const;
      await tx`UPDATE bookings k SET starts_at = ${startsAt}, ends_at = ${startsAt}::timestamptz + make_interval(mins => s.duration_min + s.buffer_min),
          moved_at = now(), reminder_sent_at = NULL
        FROM services s WHERE k.id = ${b.id} AND s.id = k.service_id`;
      return 'ok' as const;
    });
  } catch (e) {
    if (isTaken(e)) return 'unavailable';
    throw e;
  }
  if (r === 'ok') {
    journal('booking_moved', { actor: userId, client: userId, booking: bookingId, details: { by: 'client' } });
    notify(bookingId, 'moved');
  }
  return r;
}

// Déplacement par l'admin (jour et heure de Bruxelles) : hors horaires possible, jamais sur un autre rendez-vous
export async function rescheduleByAdmin(bookingId: number, day: string, time: string): Promise<'ok' | 'unavailable' | 'not_found'> {
  try {
    const [b] = await sql`
      UPDATE bookings k SET starts_at = (${day}::text::date + ${time}::time) AT TIME ZONE 'Europe/Brussels',
        ends_at = (${day}::text::date + ${time}::time) AT TIME ZONE 'Europe/Brussels' + make_interval(mins => coalesce(s.duration_min, 0) + s.buffer_min),
        moved_at = now(), reminder_sent_at = NULL
      FROM services s WHERE k.id = ${bookingId} AND s.id = k.service_id AND k.status = 'confirmed' AND s.duration_min IS NOT NULL
      RETURNING k.id, k.user_id`;
    if (!b) return 'not_found';
    if (b.user_id) notify(b.id, 'moved');
    return 'ok';
  } catch (e) {
    if (isTaken(e)) return 'unavailable';
    throw e;
  }
}

// Absence à un rendez-vous confirmé et passé (fiche cliente, agenda) ; renvoie la cliente concernée
export async function setNoShow(bookingId: number, noShow: boolean): Promise<{ user_id: number | null } | null> {
  const [b] = await sql<{ user_id: number | null }[]>`UPDATE bookings SET no_show = ${noShow}
    WHERE id = ${bookingId} AND status = 'confirmed' AND starts_at < now() RETURNING user_id`;
  return b ?? null;
}

// Acompte rendu hors du site (virement, espèces) : le reste dû passe à zéro, la date est gardée
export async function markRefundedManually(bookingId: number): Promise<{ amount: number; user_id: number | null } | null> {
  const [b] = await sql<{ amount: number; user_id: number | null }[]>`
    WITH old AS (SELECT id, deposit_cents - refunded_cents AS amount FROM bookings
      WHERE id = ${bookingId} AND stripe_payment_intent IS NOT NULL AND status IN ('cancelled', 'expired') AND refunded_cents < deposit_cents FOR UPDATE)
    UPDATE bookings k SET refunded_cents = k.deposit_cents, refunded_manually_at = now() FROM old WHERE k.id = old.id
    RETURNING old.amount, k.user_id`;
  return b ?? null;
}

// Rappel la veille (de 26 h à 2 h avant), une seule fois par rendez-vous : la ligne est réservée par l'UPDATE avant l'envoi.
// Seulement pour les réservations prises plus de 26 h à l'avance (la confirmation vient de partir pour les autres).
// Suppression définitive d'un rendez-vous, voulue par la gérante, quel que soit son statut : aucune ligne au journal ni au log serveur.
// Le créneau se libère ; un code promo ou un bon cadeau redevient utilisable (ils se comptent sur les rendez-vous restants) ;
// un avantage fidélité porté par ce rendez-vous est rendu à la carte. E-mail d'annulation à la cliente seulement si demandé.
export async function deleteBooking(id: number, notifyClient: boolean): Promise<boolean> {
  const [mail] = notifyClient
    ? await sql<{ email: string; locale: Lang; service: string; starts_at: Date; price_cents: number; discount_cents: number; deposit_cents: number; upcoming: boolean }[]>`
        SELECT u.email, u.locale, CASE u.locale WHEN 'nl' THEN s.name_nl WHEN 'en' THEN s.name_en ELSE s.name_fr END AS service,
          b.starts_at, b.price_cents, b.discount_cents, b.deposit_cents, b.starts_at > now() AND b.status = 'confirmed' AS upcoming
        FROM bookings b JOIN users u ON u.id = b.user_id JOIN services s ON s.id = b.service_id WHERE b.id = ${id}`
    : [];
  const gone = await sql.begin(async (tx) => {
    await tx`DELETE FROM loyalty_rewards WHERE booking_id = ${id}`;
    return (await tx`DELETE FROM bookings WHERE id = ${id} RETURNING id`).length > 0;
  });
  // Prévenir n'a de sens que pour un rendez-vous encore à venir
  if (gone && mail?.upcoming) sendMail(mail.email, bookingCancelledMail(mail.locale, mail, 0));
  return gone;
}

// Blanchiment dentaire terminé (et non marqué absente) : les recommandations de l'institut par e-mail, une seule fois.
// Fenêtre d'un jour : un rendez-vous ancien, saisi après coup, ne déclenche rien.
export async function sendAftercare(): Promise<number> {
  const rows = await sql<{ email: string; locale: Lang }[]>`
    UPDATE bookings b SET aftercare_sent_at = now() FROM users u, services s
    WHERE u.id = b.user_id AND s.id = b.service_id AND s.slug LIKE 'blanchiment-des-dents%'
      AND b.status = 'confirmed' AND NOT b.no_show AND b.aftercare_sent_at IS NULL
      AND u.blocked_at IS NULL AND u.removed_at IS NULL
      AND b.ends_at <= now() AND b.ends_at > now() - interval '1 day'
    RETURNING u.email, u.locale`;
  for (const r of rows) sendMail(r.email, aftercareMail(r.locale));
  return rows.length;
}

export async function sendReminders(): Promise<number> {
  const rows = await sql<{ id: number }[]>`
    UPDATE bookings SET reminder_sent_at = now()
    WHERE status = 'confirmed' AND user_id IS NOT NULL AND reminder_sent_at IS NULL
      -- Compte désactivé ou supprimé par l'institut : le rendez-vous reste à l'agenda, sans rappel
      AND user_id IN (SELECT id FROM users WHERE blocked_at IS NULL AND removed_at IS NULL)
      AND starts_at > now() + interval '2 hours' AND starts_at <= now() + interval '26 hours'
      AND created_at < starts_at - interval '26 hours'
    RETURNING id`;
  for (const r of rows) notify(r.id, 'reminder');
  return rows.length;
}
