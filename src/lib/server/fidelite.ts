// Carte de fidélité. Une séance compte quand la cliente est venue (confirmé, terminé, sans absence) et que le montant réellement payé
// (prix - remise - remboursement) atteint le minimum réglé ; un soin réglé par bon cadeau ou portant un avantage ne compte pas.
// Règles réglables dans /admin/reglages (par défaut : séance d'au moins 50 €, -10 % une fois après 5 séances, HydraPure offerte après
// 10 séances et 500 € payés (réglable), puis la carte repart à zéro). L'avantage s'applique à la caisse en un clic et passe au journal.
import { z } from 'astro/zod';
import type { Result } from './admin.ts';
import { sql } from './db.ts';
import { journal } from './journal.ts';
import { readSettings, type Loyalty } from './reglages.ts';

export type LoyaltyCard = {
  rules: Loyalty; sessions: number; spentCents: number; discount: boolean; free: boolean; discountUsed: boolean;
  last: { kind: 'discount' | 'free'; used_at: Date } | null;
  // Rentabilité sur toute l'histoire de la cliente : avantages accordés rapportés au total payé
  lifetime: { spentCents: number; rewardsCents: number };
};

export async function loyaltyCard(userId: number): Promise<LoyaltyCard> {
  const { loyalty: rules } = await readSettings();
  const min = rules.min_euros * 100;
  const [c] = await sql<{ sessions: number; spent: number; discount_used: boolean; last_kind: 'discount' | 'free' | null; last_at: Date | null; life_spent: number; life_rewards: number }[]>`
    WITH start AS (SELECT coalesce(max(used_at), '-infinity'::timestamptz) AS at FROM loyalty_rewards WHERE user_id = ${userId} AND kind = 'free'),
    done AS (
      SELECT b.ends_at, coalesce(b.paid_cents, b.price_cents - b.discount_cents - b.refunded_cents) AS paid FROM bookings b
      WHERE b.user_id = ${userId} AND b.status = 'confirmed' AND b.ends_at < now() AND NOT b.no_show
        AND b.gift_card_id IS NULL AND NOT EXISTS (SELECT 1 FROM loyalty_rewards r WHERE r.booking_id = b.id))
    SELECT
      (SELECT count(*)::int FROM done, start WHERE done.ends_at > start.at AND done.paid >= ${min}) AS sessions,
      (SELECT coalesce(sum(paid), 0)::int FROM done, start WHERE done.ends_at > start.at AND done.paid >= ${min}) AS spent,
      EXISTS (SELECT 1 FROM loyalty_rewards r, start WHERE r.user_id = ${userId} AND r.kind = 'discount' AND r.used_at > start.at) AS discount_used,
      (SELECT kind FROM loyalty_rewards WHERE user_id = ${userId} ORDER BY used_at DESC LIMIT 1) AS last_kind,
      (SELECT max(used_at) FROM loyalty_rewards WHERE user_id = ${userId}) AS last_at,
      (SELECT coalesce(sum(greatest(paid, 0)), 0)::int FROM done) AS life_spent,
      (SELECT coalesce(sum(amount_cents), 0)::int FROM loyalty_rewards WHERE user_id = ${userId}) AS life_rewards`;
  return {
    rules, sessions: c.sessions, spentCents: c.spent, discountUsed: c.discount_used,
    discount: c.sessions >= rules.discount_after && !c.discount_used && !(c.sessions >= rules.free_after && c.spent >= rules.free_min_total * 100),
    free: c.sessions >= rules.free_after && c.spent >= rules.free_min_total * 100,
    last: c.last_kind && c.last_at ? { kind: c.last_kind, used_at: c.last_at } : null,
    lifetime: { spentCents: c.life_spent, rewardsCents: c.life_rewards },
  };
}

// Rendez-vous où appliquer l'avantage : confirmés, d'hier à l'avenir, sans remise ni avantage déjà portés
export const rewardableBookings = (userId: number) => sql<{ id: number; starts_at: Date; service: string; price_cents: number }[]>`
  SELECT b.id, b.starts_at, s.name_fr AS service, b.price_cents FROM bookings b JOIN services s ON s.id = b.service_id
  WHERE b.user_id = ${userId} AND b.status = 'confirmed' AND b.starts_at > now() - interval '1 day' AND b.discount_cents = 0
    AND NOT EXISTS (SELECT 1 FROM loyalty_rewards r WHERE r.booking_id = b.id)
  ORDER BY b.starts_at LIMIT 20`;

export const rewardForm = z.object({
  id: z.coerce.number().int().min(1).max(2_000_000_000),
  kind: z.enum(['discount', 'free'], { error: 'Avantage inconnu.' }),
  booking: z.coerce.number({ error: 'Choisissez le rendez-vous.' }).int().min(1, 'Choisissez le rendez-vous.').max(2_000_000_000, 'Choisissez le rendez-vous.'),
  confirm: z.literal('on', { error: 'Cochez la case pour confirmer.' }),
});

// Application à la caisse (admin ou gestionnaire), sous le verrou de la cliente : deux clics simultanés n'appliquent qu'un avantage
export async function applyReward(actor: number, form: FormData): Promise<Result> {
  const p = rewardForm.safeParse(Object.fromEntries(form));
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? 'Saisie invalide.' };
  const f = p.data;
  const r = await sql.begin(async (tx) => {
    const [u] = await tx`SELECT id FROM users WHERE id = ${f.id} AND role IS NULL FOR UPDATE`;
    if (!u) return { error: 'Cliente introuvable.' };
    const card = await loyaltyCard(f.id);
    if (f.kind === 'discount' ? !card.discount : !card.free) return { error: "Cet avantage n'est pas disponible pour cette cliente." };
    const [b] = await tx<{ price_cents: number }[]>`
      SELECT price_cents FROM bookings WHERE id = ${f.booking} AND user_id = ${f.id} AND status = 'confirmed'
        AND starts_at > now() - interval '1 day' AND discount_cents = 0 FOR UPDATE`;
    if (!b) return { error: 'Rendez-vous introuvable ou déjà remisé.' };
    // Soin offert plafonné au prix du soin de la carte (free_value) : choisir un rendez-vous plus cher n'offre pas plus
    const cap = f.kind === 'free' && card.rules.free_value > 0 ? card.rules.free_value * 100 : Infinity;
    const amount = Math.min(Math.round((b.price_cents * (f.kind === 'discount' ? card.rules.discount_percent : 100)) / 100), cap);
    const percent = f.kind === 'discount' ? card.rules.discount_percent : b.price_cents > 0 ? Math.max(1, Math.round((amount * 100) / b.price_cents)) : 100;
    await tx`UPDATE bookings SET discount_cents = ${amount} WHERE id = ${f.booking}`;
    await tx`INSERT INTO loyalty_rewards (user_id, kind, booking_id, percent, amount_cents, sessions, actor_id)
      VALUES (${f.id}, ${f.kind}, ${f.booking}, ${percent}, ${amount}, ${card.sessions}, ${actor})`;
    return { amount, sessions: card.sessions };
  });
  if ('error' in r) return { ok: false, error: r.error as string };
  journal('admin_action', { actor, client: f.id, booking: f.booking, details: { action: 'loyalty_applied', kind: f.kind, amount: r.amount, sessions: r.sessions } });
  return { ok: true, id: f.booking, key: f.kind === 'discount' ? 'fidelite-remise' : 'fidelite-offert' };
}
