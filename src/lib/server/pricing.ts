// Montants d'une réservation, validité d'un code promo et dates à Bruxelles : fonctions pures, testées sans base ni site.ts.
import type { Lang } from '../site.ts';

// Minimum Stripe pour la carte comme pour Bancontact (0,50 €)
export const MIN_DEPOSIT = 50;

export type Promo = {
  kind: 'percent' | 'amount';
  value: number;
  starts_on: string | null; // 'AAAA-MM-JJ' (lu en ::text, jamais en Date JS)
  ends_on: string | null;
  max_uses: number | null;
  once_per_user: boolean;
  service_ids: (number | string)[] | null;
  active: boolean;
};
export type PromoProblem = 'unknown' | 'inactive' | 'not_started' | 'expired' | 'service' | 'exhausted' | 'used';

// Remise au centime plafonnée au prix ; acompte limité au prix final, supprimé sous le minimum Stripe (la réservation est alors confirmée sans paiement)
export function amounts(price: number, deposit: number, promo?: Pick<Promo, 'kind' | 'value'> | null) {
  const off = !promo ? 0 : promo.kind === 'percent' ? Math.round((price * promo.value) / 100) : promo.value;
  const discount = Math.min(price, off);
  const final = price - discount;
  const due = Math.min(deposit, final);
  return { price_cents: price, discount_cents: discount, final_cents: final, deposit_cents: due < MIN_DEPOSIT ? 0 : due };
}

// Dates du code = jour de la réservation à Bruxelles, ends_on inclus ; utilisations = réservations en attente ou confirmées qui le portent
export function promoProblem(p: Promo, c: { today: string; serviceId: number; uses: number; usesByUser: number }): PromoProblem | null {
  if (!p.active) return 'inactive';
  if (p.starts_on && c.today < p.starts_on) return 'not_started';
  if (p.ends_on && c.today > p.ends_on) return 'expired';
  if (p.service_ids && !p.service_ids.some((id) => Number(id) === c.serviceId)) return 'service';
  if (p.max_uses !== null && c.uses >= p.max_uses) return 'exhausted';
  if (p.once_per_user && c.usesByUser > 0) return 'used';
  return null;
}

// Jour civil à Bruxelles ('AAAA-MM-JJ'), jamais celui du fuseau du serveur
export const todayBrussels = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(now);

// Date saisie (formulaire, URL) : format strict et jour réel (pas de 30 février). Années 2000 à 2999 : Postgres refuse l'an 0 que JS accepte (500)
export function isDay(s: unknown): s is string {
  if (typeof s !== 'string' || !/^2\d{3}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// Même écriture que les tarifs du site : « 35 € », « 12,50 € » (point décimal en anglais)
export function euros(cents: number, lang: Lang = 'fr'): string {
  const s = (cents / 100).toFixed(2).replace(/\.00$/, '');
  return `${lang === 'en' ? s : s.replace('.', ',')} €`;
}
