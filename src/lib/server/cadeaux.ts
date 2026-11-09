// Bons cadeaux : créés depuis l'admin pour un soin de la carte (Pour, Soin, Durée, Message), valables 12 mois (CGV).
// À la réservation, le code se saisit dans le champ du code promo : le soin est alors offert (prix ramené à 0 €).
// Le bon redevient utilisable si le rendez-vous est annulé ou manqué (absence) ; il est utilisé quand le rendez-vous a eu lieu, ou noté à la caisse.
// La gérante peut réattribuer un bon libre à un autre soin de la carte (« soin équivalent », à son jugement ; le prix est affiché, rien n'est bloqué).
import { randomInt } from 'node:crypto';
import type { Sql } from 'postgres';
import { z } from 'astro/zod';
import type { Result } from './admin.ts';
import { sql } from './db.ts';
import { journal } from './journal.ts';
import { giftMail, sendMailNow } from './mail.ts';
import { ADMIN_EMAIL } from 'astro:env/server';
import type { Lang } from '../site.ts';

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
  WHEN EXISTS (SELECT 1 FROM bookings b WHERE b.gift_card_id = g.id AND b.status IN ('pending_payment', 'confirmed') AND b.ends_at >= now() AND NOT b.no_show) THEN 'reserve'
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

export type Gift = { id: number; code: string; recipient: string; recipient_email: string | null; user_id: number | null; service: string; service_id: number; service_price_cents: number; duration_label: string; message: string; issued_on: string; expires_on: string; state: GiftState; booking_at: Date | null; created_by: string | null };

export function listGifts(id?: number) {
  return sql<Gift[]>`
    SELECT g.id, g.code, g.recipient, g.recipient_email, g.user_id, s.name_fr AS service, g.service_id, s.price_cents AS service_price_cents, g.duration_label, g.message, g.issued_on::text, g.expires_on::text,
      ${state(sql)} AS state, (SELECT max(b.starts_at) FROM bookings b WHERE b.gift_card_id = g.id AND b.status IN ('pending_payment', 'confirmed')) AS booking_at,
      coalesce(u.name, u.email) AS created_by
    FROM gift_cards g JOIN services s ON s.id = g.service_id LEFT JOIN users u ON u.id = g.created_by
    ${id ? sql`WHERE g.id = ${id}` : sql``}
    ORDER BY g.created_at DESC LIMIT 300`;
}

// Bons d'une cliente (fiche cliente)
export const clientGifts = (userId: number) => sql<{ id: number; code: string; service: string; expires_on: string; state: GiftState }[]>`
  SELECT g.id, g.code, s.name_fr AS service, g.expires_on::text, ${state(sql)} AS state
  FROM gift_cards g JOIN services s ON s.id = g.service_id WHERE g.user_id = ${userId} ORDER BY g.created_at DESC`;

// Clientes proposées dans « Pour » : même périmètre que l'onglet « Actives » de la liste Clientes (adresse confirmée, ni équipe,
// ni gérante, ni désactivée, supprimée ou en suppression). Proposition « Nom <e-mail> » ; l'e-mail désigne la cliente.
export function giftClients() {
  return sql<{ id: number; name: string | null; email: string }[]>`
    SELECT id, name, email FROM users WHERE email_verified_at IS NOT NULL AND role IS NULL AND email <> ${ADMIN_EMAIL.trim().toLowerCase()}
      AND blocked_at IS NULL AND removed_at IS NULL AND deleted_at IS NULL
    ORDER BY lower(coalesce(name, email)) LIMIT 2000`;
}
export const clientLabel = (c: { name: string | null; email: string }) => (c.name ? `${c.name} <${c.email}>` : c.email);

// Envoi du bon par e-mail, dans la langue de la cliente rattachée (français sinon). Échec dit tel quel : jamais de faux succès.
// Journal gift_sent sans le code ni l'adresse.
export async function sendGift(actor: number, giftId: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const [g] = await sql<{ recipient: string; recipient_email: string | null; code: string; expires_on: string; message: string; state: GiftState; locale: Lang | null; name_fr: string; name_nl: string; name_en: string }[]>`
    SELECT g.recipient, g.recipient_email, g.code, g.expires_on::text, g.message, ${state(sql)} AS state, u.locale, s.name_fr, s.name_nl, s.name_en
    FROM gift_cards g JOIN services s ON s.id = g.service_id LEFT JOIN users u ON u.id = g.user_id WHERE g.id = ${giftId}`;
  if (!g) return { ok: false, error: 'Bon introuvable.' };
  if (!g.recipient_email) return { ok: false, error: "Ce bon n'a pas d'adresse e-mail : ajoutez-la ou imprimez le bon." };
  if (g.state !== 'valide' && g.state !== 'reserve') return { ok: false, error: `Ce bon est ${STATE_LABELS[g.state].toLowerCase()} : il n'est pas envoyé.` };
  const lang: Lang = g.locale ?? 'fr';
  const service = { fr: g.name_fr, nl: g.name_nl, en: g.name_en }[lang].replace(/^[^,]+, /, '');
  const sent = await sendMailNow(g.recipient_email, giftMail(lang, { recipient: g.recipient, service, code: g.code, expires_on: g.expires_on, message: g.message }));
  audit(actor, 'gift_sent', { gift_id: giftId, ok: sent, lang });
  return sent ? { ok: true } : { ok: false, error: "L'e-mail n'a pas pu partir. Le bon est bien enregistré : réessayez plus tard ou imprimez-le." };
}

const line = (max: number, msg: string) => z.string({ error: msg }).trim().max(max, msg).regex(/^\P{Cc}*$/u, msg);
export const giftForm = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    // Cliente existante choisie dans la liste (« Nom <e-mail> » ou e-mail) ; vide pour une personne sans compte
    client: z.string().max(400).default(''),
    recipient: line(100, 'Pour : 100 caractères au plus.').default(''),
    send: z.literal('on').optional(),
    recipient_email: z.string({ error: 'Adresse e-mail invalide.' }).trim().toLowerCase().max(254, 'Adresse e-mail invalide.')
      .refine((v) => v === '' || z.email().safeParse(v).success, 'Adresse e-mail du bénéficiaire invalide.').default(''),
    service: z.coerce.number({ error: 'Choisissez le soin.' }).int().min(1, 'Choisissez le soin.').max(2_000_000_000, 'Choisissez le soin.'),
    duration_label: line(40, 'Durée : 40 caractères au plus.').default(''),
    message: z.string({ error: 'Message : 300 caractères au plus.' }).max(300, 'Message : 300 caractères au plus.').default('').transform((v) => v.replace(/\r\n/g, '\n').trim()),
  }),
  z.object({ action: z.literal('reassign'), id: z.coerce.number().int().min(1).max(2_000_000_000),
    service: z.coerce.number({ error: 'Choisissez le nouveau soin.' }).int().min(1, 'Choisissez le nouveau soin.').max(2_000_000_000, 'Choisissez le nouveau soin.'),
    confirm: z.literal('on', { error: 'Cochez la case pour confirmer.' }) }),
  z.object({ action: z.literal('send'), id: z.coerce.number().int().min(1).max(2_000_000_000) }),
  z.object({ action: z.enum(['used', 'cancel']), id: z.coerce.number().int().min(1).max(2_000_000_000), confirm: z.literal('on', { error: 'Cochez la case pour confirmer.' }) }),
], { error: 'Action inconnue.' });

export async function giftAction(actor: number, form: FormData): Promise<Result> {
  const p = giftForm.safeParse(Object.fromEntries(form));
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? 'Saisie invalide.' };
  const f = p.data;
  if (f.action === 'create') {
    const [s] = await sql`SELECT id FROM services WHERE id = ${f.service} AND retired_at IS NULL AND active`;
    if (!s) return { ok: false, error: 'Soin introuvable ou fermé à la réservation.' };
    // Cliente choisie : son nom et son e-mail remplissent ce qui est vide ; une saisie qui ne correspond à aucune cliente active est refusée
    let userId: number | null = null;
    let recipient = f.recipient;
    let recipientEmail = f.recipient_email;
    if (f.client.trim()) {
      const email = (/<([^<>]+)>\s*$/.exec(f.client)?.[1] ?? f.client).trim().toLowerCase();
      const c = (await giftClients()).find((x) => x.email === email);
      if (!c) return { ok: false, error: 'Cliente introuvable : choisissez-la dans la liste, ou videz le champ pour une personne sans compte.' };
      userId = c.id;
      recipient ||= c.name ?? '';
      recipientEmail ||= c.email;
    }
    if (!recipient) return { ok: false, error: 'Indiquez pour qui est le bon.' };
    // Un code ne doit jamais valoir à la fois bon cadeau et code promo ; nouvel essai en cas de collision
    for (let i = 0; i < 5; i++) {
      const code = newGiftCode();
      if ((await sql`SELECT 1 FROM promo_codes WHERE code = ${code}`).length) continue;
      const [g] = await sql<{ id: number }[]>`
        INSERT INTO gift_cards (code, recipient, recipient_email, user_id, service_id, duration_label, message, expires_on, created_by)
        VALUES (${code}, ${recipient}, ${recipientEmail || null}, ${userId}, ${f.service}, ${f.duration_label}, ${f.message}, (current_date + interval '12 months')::date, ${actor})
        ON CONFLICT (code) DO NOTHING RETURNING id`;
      if (!g) continue;
      audit(actor, 'gift_created', { gift_id: g.id, service_id: f.service, client_id: userId });
      // « Créer et envoyer » : le bon reste créé même si l'e-mail ne part pas, la page le dit
      if (!f.send) return { ok: true, id: g.id, key: 'create' };
      return { ok: true, id: g.id, key: (await sendGift(actor, g.id)).ok ? 'create-sent' : 'create-unsent' };
    }
    return { ok: false, error: 'Code impossible à créer, réessayez.' };
  }
  if (f.action === 'send') {
    const r = await sendGift(actor, f.id);
    return r.ok ? { ok: true, id: f.id, key: 'sent' } : r;
  }
  const [g] = await listGifts(f.id);
  if (!g) return { ok: false, error: 'Bon introuvable.' };
  if (f.action === 'reassign') {
    if (g.state !== 'valide') return { ok: false, error: `Seul un bon valable se réattribue ; celui-ci est ${STATE_LABELS[g.state].toLowerCase()}.` };
    if (f.service === g.service_id) return { ok: false, error: 'Choisissez un autre soin que le soin actuel.' };
    const [s] = await sql<{ price_cents: number }[]>`SELECT price_cents FROM services WHERE id = ${f.service} AND retired_at IS NULL AND active`;
    if (!s) return { ok: false, error: 'Soin introuvable ou fermé à la réservation.' };
    // Garde : le bon n'a pas été réservé entre la lecture et l'écriture
    const [u] = await sql`UPDATE gift_cards SET service_id = ${f.service} WHERE id = ${g.id} AND service_id = ${g.service_id} AND cancelled_at IS NULL AND used_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.gift_card_id = ${g.id} AND b.status IN ('pending_payment', 'confirmed') AND NOT b.no_show) RETURNING id`;
    if (!u) return { ok: false, error: 'Le bon vient de changer, rechargez la page.' };
    audit(actor, 'gift_reassigned', { gift_id: g.id, from_service_id: g.service_id, to_service_id: f.service, from_price_cents: g.service_price_cents, to_price_cents: s.price_cents });
    return { ok: true, id: g.id, key: s.price_cents > g.service_price_cents ? 'reassign-plus' : 'reassign' };
  }
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
