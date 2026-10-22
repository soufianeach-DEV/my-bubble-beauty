// TOTP RFC 6238 (HMAC-SHA1, 6 chiffres, pas de 30 s) avec node:crypto seul : second facteur de l'admin.
import { createHmac, timingSafeEqual } from 'node:crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) out += B32[(value >>> (bits -= 5)) & 31];
  }
  return bits > 0 ? out + B32[(value << (5 - bits)) & 31] : out;
}

export function base32Decode(text: string): Buffer {
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const c of text.toUpperCase().replace(/[\s=]/g, '')) {
    const i = B32.indexOf(c);
    if (i < 0) throw new Error('base32 invalide');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) out.push((value >>> (bits -= 8)) & 255);
  }
  return Buffer.from(out);
}

export function totp(key: Buffer, step: number, digits = 6): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', key).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 10 ** digits).padStart(digits, '0');
}

// Pas accepté (à comparer à users.totp_last_step contre le rejeu) ou null ; ±1 pas pour l'horloge du téléphone
export function verifyTotp(secret: string, code: string, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const key = base32Decode(secret);
  const step = Math.floor(now / 30_000);
  for (const s of [step, step - 1, step + 1]) if (timingSafeEqual(Buffer.from(totp(key, s)), Buffer.from(code))) return s;
  return null;
}
