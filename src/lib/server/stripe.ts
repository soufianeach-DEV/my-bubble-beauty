// API Stripe en REST (fetch, form-urlencoded), sans SDK. Toute URL de retour part de SITE_URL, jamais de l'en-tête Host.
import { SITE_URL, STRIPE_SECRET_KEY } from 'astro:env/server';
import { FOLDER, type Lang } from '../site.ts';

// Version figée : sans elle, celle du compte s'appliquerait. payment_method_types est refusé depuis cette version (allowed_payment_method_types le remplace).
// La destination du webhook doit être créée avec la même version et une charge « Snapshot ».
export const STRIPE_VERSION = '2026-09-30.endive';

export type CheckoutSession = {
  id: string;
  url: string | null;
  payment_status: 'paid' | 'unpaid' | 'no_payment_required';
  payment_intent: string | { id: string } | null;
  amount_total: number | null;
  currency: string | null;
  client_reference_id: string | null;
  metadata: Record<string, string> | null;
};

async function stripe<T>(method: 'GET' | 'POST', path: string, params?: Record<string, string>, idempotencyKey?: string): Promise<T> {
  if (!STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY absent');
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}`, 'Stripe-Version': STRIPE_VERSION, ...(idempotencyKey && { 'Idempotency-Key': idempotencyKey }) },
    body: params && new URLSearchParams(params),
    signal: AbortSignal.timeout(10_000),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`stripe ${res.status} ${body?.error?.code ?? body?.error?.type ?? ''}`.trim());
  return body as T;
}

// Acompte seul (le reste se règle au salon). Expire à +31 min : Stripe exige au moins 30 min après la création, la réservation tombe à 35.
export function createCheckoutSession(b: { bookingId: number; userId: number; serviceId: number; amount: number; label: string; lang: Lang }) {
  const folder = FOLDER[b.lang];
  return stripe<CheckoutSession>('POST', 'checkout/sessions', {
    mode: 'payment',
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'eur',
    'line_items[0][price_data][unit_amount]': String(b.amount),
    'line_items[0][price_data][product_data][name]': b.label.slice(0, 250),
    'allowed_payment_method_types[0]': 'card',
    'allowed_payment_method_types[1]': 'bancontact',
    submit_type: 'book',
    expires_at: String(Math.floor(Date.now() / 1000) + 31 * 60),
    success_url: `${SITE_URL}/${folder}/compte?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${SITE_URL}/${folder}/reserver?service=${b.serviceId}`,
    locale: b.lang,
    client_reference_id: String(b.userId),
    'metadata[booking_id]': String(b.bookingId),
  }, `checkout-${b.bookingId}`);
}

export const retrieveSession = (id: string) => stripe<CheckoutSession>('GET', `checkout/sessions/${encodeURIComponent(id)}`);

// Session abandonnée (réservation expirée ou annulée) : la cliente ne peut plus payer un créneau qui n'est plus le sien
export const expireSession = (id: string) => stripe<CheckoutSession>('POST', `checkout/sessions/${encodeURIComponent(id)}/expire`);

// Même clé pour une même réservation : un double clic ou un rejeu ne rembourse jamais deux fois
export const refund = (paymentIntent: string, amount: number, bookingId: number) =>
  stripe<{ id: string; status: string }>('POST', 'refunds', { payment_intent: paymentIntent, amount: String(amount) }, `refund-${bookingId}`);
