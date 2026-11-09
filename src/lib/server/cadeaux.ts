// Bons cadeaux : créés depuis l'admin pour un soin de la carte (Pour, Soin, Durée, Message), valables 12 mois (CGV).
// À la réservation, le code se saisit dans le champ du code promo : le soin est alors offert (prix ramené à 0 €).
// Le bon redevient utilisable si le rendez-vous est annulé ; il est utilisé quand le rendez-vous a eu lieu, ou noté à la caisse.
import { randomInt } from 'node:crypto';
import type { Sql } from 'postgres';
import { z } from 'astro/zod';
import type { Result } from './admin.ts';
import { sql } from './db.ts';
import { journal } from './journal.ts';

// Même ligne de journal que audit() d'admin.ts, sans l'importer : booking.ts lit ce module, et admin.ts lit booking.ts
const audit = (actor: number, action: string, details: Record<string, unknown>) => journal('admin_action', { actor, details: { action, ...details } });
import type { PromoProblem } from './pricing.ts';

export const GIFT_CODE = /^CADEAU-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
// Sans 0/O ni 1/I : le code se recopie depuis un papier sans erreur
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const newGiftCode = () => {
  const part = () => Array.from({ length: 4 }, () => ALPHA[randomInt(ALPHA.length)]).join('');
  return `CADEAU-${part()}-${part()}`;
};

export type GiftState = 'valide' | 'reserve' | 'utilise' | 'expire' | 'annule';
export const STATE_LABELS: Record<GiftState, string> = { valide: 'Valable', reserve: 'Réservé', utilise: 'Utilisé', expire: 'Expiré', annule: 'Annulé' };

// État calculé : un rendez-vous terminé (présente) vaut utilisation, un rendez-vous à venir le réserve
const state = (tx: Sql) => tx`CASE
  WHEN g.cancelled_at IS NOT NULL THEN 'annule'
  WHEN g.used_at IS NOT NULL OR EXISTS (SELECT 1 FROM bookings b WHERE b.gift_card_id = g.id AND b.status = 'confirmed' AND b.ends_at < now() AND NOT b.no_show) THEN 'utilise'
  WHEN EXISTS (SELECT 1 FROM bookings b WHERE b.gift_card_id = g.id AND b.status IN ('pending_payment', 'confirmed') AND b.ends_at >= now()) THEN 'reserve'
  WHEN g.expires_on < current_date THEN 'expire'
  ELSE 'valide' END`;

// Contrôle à la réservation, sous le verrou de la cliente (createBooking) ou en lecture (devis). Mêmes réponses qu'un code promo.
export async function checkGift(tx: Sql, code: string, serviceId: number, lock = false): Promise<{ id: number } | { problem: PromoProblem }> {
  // Verrou d'abord, état ensuite dans une nouvelle requête : elle voit les réservations validées pendant l'attente du verrou
  // (une sous-requête de la requête qui verrouille garderait l'instantané d'avant). L'index unique bookings_gift_idx fait le reste.
  if (lock) await tx`SELECT id FROM gift_cards WHERE code = ${code} FOR UPDATE`;
  const [g] = await tx<{ id: number; service_id: number; state: GiftState }[]>`
    SELECT g.id, g.service_id, ${state(tx)} AS state FROM gift_cards g WHERE g.code = ${code}`;
  if (!g || g.state === 'annule') return { problem: 'unknown' };
  if (g.state === 'expire') return { problem: 'expired' };
  if (g.state !== 'valide') return { problem: 'used' };
  if (g.service_id !== serviceId) return { problem: 'service' };
  return { id: g.id };
}

export type Gift = { id: number; code: string; recipient: string; recipient_email: string | null; service: string; service_id: number; duration_label: string; message: string; issued_on: string; expires_on: string; state: GiftState; booking_at: Date | null; created_by: string | null };

export function listGifts(id?: number) {
  return sql<Gift[]>`
    SELECT g.id, g.code, g.recipient, g.recipient_email, s.name_fr AS service, g.service_id, g.duration_label, g.message, g.issued_on::text, g.expires_on::text,
      ${state(sql)} AS state, (SELECT max(b.starts_at) FROM bookings b WHERE b.gift_card_id = g.id AND b.status IN ('pending_payment', 'confirmed')) AS booking_at,
      coalesce(u.name, u.email) AS created_by
    FROM gift_cards g JOIN services s ON s.id = g.service_id LEFT JOIN users u ON u.id = g.created_by
    ${id ? sql`WHERE g.id = ${id}` : sql``}
    ORDER BY g.created_at DESC LIMIT 300`;
}

const line = (max: number, msg: string) => z.string({ error: msg }).trim().max(max, msg).regex(/^\P{Cc}*$/u, msg);
export const giftForm = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    recipient: line(100, 'Pour : 100 caractères au plus.').min(1, 'Indiquez pour qui est le bon.'),
    recipient_email: z.string({ error: 'Adresse e-mail invalide.' }).trim().toLowerCase().max(254, 'Adresse e-mail invalide.')
      .refine((v) => v === '' || z.email().safeParse(v).success, 'Adresse e-mail du bénéficiaire invalide.').default(''),
    service: z.coerce.number({ error: 'Choisissez le soin.' }).int().min(1, 'Choisissez le soin.'),
    duration_label: line(40, 'Durée : 40 caractères au plus.').default(''),
    message: z.string({ error: 'Message : 300 caractères au plus.' }).max(300, 'Message : 300 caractères au plus.').default('').transform((v) => v.replace(/\r\n/g, '\n').trim()),
  }),
  z.object({ action: z.enum(['used', 'cancel']), id: z.coerce.number().int().min(1), confirm: z.literal('on', { error: 'Cochez la case pour confirmer.' }) }),
], { error: 'Action inconnue.' });

export async function giftAction(actor: number, form: FormData): Promise<Result> {
  const p = giftForm.safeParse(Object.fromEntries(form));
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? 'Saisie invalide.' };
  const f = p.data;
  if (f.action === 'create') {
    const [s] = await sql`SELECT id FROM services WHERE id = ${f.service} AND retired_at IS NULL`;
    if (!s) return { ok: false, error: 'Soin introuvable.' };
    // Un code ne doit jamais valoir à la fois bon cadeau et code promo ; nouvel essai en cas de collision
    for (let i = 0; i < 5; i++) {
      const code = newGiftCode();
      if ((await sql`SELECT 1 FROM promo_codes WHERE code = ${code}`).length) continue;
      const [g] = await sql<{ id: number }[]>`
        INSERT INTO gift_cards (code, recipient, recipient_email, service_id, duration_label, message, expires_on, created_by)
        VALUES (${code}, ${f.recipient}, ${f.recipient_email || null}, ${f.service}, ${f.duration_label}, ${f.message}, (current_date + interval '12 months')::date, ${actor})
        ON CONFLICT (code) DO NOTHING RETURNING id`;
      if (!g) continue;
      audit(actor, 'gift_created', { gift_id: g.id, service_id: f.service });
      return { ok: true, id: g.id, key: 'create' };
    }
    return { ok: false, error: 'Code impossible à créer, réessayez.' };
  }
  const [g] = await listGifts(f.id);
  if (!g) return { ok: false, error: 'Bon introuvable.' };
  if (f.action === 'used') {
    if (g.state !== 'valide' && g.state !== 'reserve') return { ok: false, error: `Ce bon est ${STATE_LABELS[g.state].toLowerCase()}.` };
    await sql`UPDATE gift_cards SET used_at = now() WHERE id = ${g.id} AND used_at IS NULL`;
  } else {
    if (g.state === 'utilise' || g.state === 'annule') return { ok: false, error: `Ce bon est ${STATE_LABELS[g.state].toLowerCase()}.` };
    await sql`UPDATE gift_cards SET cancelled_at = now() WHERE id = ${g.id} AND cancelled_at IS NULL`;
  }
  audit(actor, f.action === 'used' ? 'gift_used' : 'gift_cancelled', { gift_id: g.id });
  return { ok: true, id: g.id, key: f.action };
}
