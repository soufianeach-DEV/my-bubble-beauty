// Événements Stripe : corps BRUT lu avant tout parsing, car la signature porte sur les octets reçus. POST seulement.
import type { APIRoute } from 'astro';
import { stripeWebhook } from '../../../lib/server/booking.ts';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  let raw: string;
  // Au-delà de 64 Kio (bodySizeLimit), la lecture échoue
  try {
    raw = await request.text();
  } catch {
    return new Response(null, { status: 413 });
  }
  return new Response(null, { status: await stripeWebhook(raw, request.headers.get('stripe-signature')) });
};

export const ALL: APIRoute = () => new Response(null, { status: 405, headers: { Allow: 'POST' } });
