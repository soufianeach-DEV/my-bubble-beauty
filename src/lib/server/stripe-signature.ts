// Signature des webhooks Stripe : HMAC-SHA256 de « t.corps brut ». Pendant une rotation du secret l'en-tête porte plusieurs v1 ; v0 (mode test) est ignoré.
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyWebhookSignature(raw: string, header: string | null | undefined, secret: string, now = Date.now(), tolerance = 300): boolean {
  if (!header || !secret) return false;
  let t = NaN;
  const sigs: string[] = [];
  for (const part of header.split(',')) {
    const i = part.indexOf('=');
    const [k, v] = [part.slice(0, i).trim(), part.slice(i + 1).trim()];
    if (k === 't') t = Number(v);
    else if (k === 'v1') sigs.push(v);
  }
  // Un événement capturé puis rejoué plus de 5 minutes après est refusé
  if (!Number.isInteger(t) || Math.abs(now / 1000 - t) > tolerance) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${raw}`).digest();
  return sigs.some((s) => {
    const got = Buffer.from(s, 'hex');
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}
