// Cookie de session : préfixe __Host- (Secure, Path=/, sans Domain), illisible en JS, sans date d'expiration (fermé avec le navigateur).
// Lax : envoyé au retour de Stripe Checkout, jamais sur un POST venu d'un autre site.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = '__Host-mb_session';
export const COOKIE = { httpOnly: true, secure: true, sameSite: 'lax', path: '/' } as const;

// Jetons de session et d'e-mail : 32 octets aléatoires, seul le SHA-256 est stocké en base
export const newToken = () => randomBytes(32).toString('base64url');
export const hashToken = (token: string) => createHash('sha256').update(token).digest();

// Cookie d'appareil (OWASP « device cookies ») : posé un an après une connexion réussie, il dispense cet appareil du verrou par e-mail
// qu'un tiers peut poser depuis plusieurs IP. Valeur = HMAC de l'adresse par le poivre (key) : rien en base, infalsifiable sans le poivre.
export const DEVICE_COOKIE = '__Host-mb_device';
export const DEVICE = { ...COOKIE, maxAge: 365 * 24 * 3600 } as const;
export const deviceToken = (key: string, email: string) => createHmac('sha256', key).update(email).digest('base64url');

// Comparaison à temps constant : le délai ne dit pas combien de caractères du cookie sont justes
export function isDevice(key: string, email: string, value: string | null | undefined): boolean {
  const want = Buffer.from(deviceToken(key, email));
  const got = Buffer.from(value ?? '');
  return got.length === want.length && timingSafeEqual(got, want);
}
