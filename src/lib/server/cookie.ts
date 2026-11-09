// Cookie de session : préfixe __Host- (Secure, Path=/, sans Domain), illisible en JS, sans date d'expiration (fermé avec le navigateur).
// Lax : envoyé au retour de Stripe Checkout, jamais sur un POST venu d'un autre site.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = '__Host-mb_session';
export const COOKIE = { httpOnly: true, secure: true, sameSite: 'lax', path: '/' } as const;

// « Se souvenir de moi » : cookie persistant (Max-Age), même durée que la session en base ; sinon cookie de session
export const sessionCookie = (remember: boolean, rememberSeconds: number) => (remember ? { ...COOKIE, maxAge: rememberSeconds } : COOKIE);

// Jetons de session et d'e-mail : 32 octets aléatoires, seul le SHA-256 est stocké en base
export const newToken = () => randomBytes(32).toString('base64url');
export const hashToken = (token: string) => createHash('sha256').update(token).digest();

// Cookie d'appareil (OWASP « device cookies ») : posé un an après une connexion réussie, il dispense cet appareil du verrou par e-mail
// qu'un tiers peut poser depuis plusieurs IP. Valeur = HMAC de l'adresse par le poivre (key) : rien en base, infalsifiable sans le poivre.
export const DEVICE_COOKIE = '__Host-mb_device';
export const DEVICE = { ...COOKIE, maxAge: 365 * 24 * 3600 } as const;
export const deviceToken = (key: string, email: string) => createHmac('sha256', key).update(email).digest('base64url');

// Comparaison à temps constant : le délai ne dit pas combien de caractères du cookie sont justes
const same = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
export const isDevice = (key: string, email: string, value: string | null | undefined) => same(value ?? '', deviceToken(key, email));

// Appareil de confiance de l'équipe : après un code TOTP juste, ce navigateur ne le redemande plus pendant 30 jours.
// Valeur = « échéance.HMAC(compte, échéance, état du TOTP) » : l'échéance est relue côté serveur, et un changement de rôle,
// un nouveau secret TOTP ou un autre poivre rend tous les cookies déjà posés invalides. Rien en base.
export const MFA_COOKIE = '__Host-mb_mfa';
export const MFA_DAYS = 30;
export const MFA = { ...COOKIE, maxAge: MFA_DAYS * 24 * 3600 } as const;
const mfaMac = (key: string, who: string, until: number) => createHmac('sha256', key).update(`mfa\n${who}\n${until}`).digest('base64url');
export const mfaToken = (key: string, who: string, now = Date.now()) => {
  const until = Math.floor(now / 1000) + MFA.maxAge;
  return `${until}.${mfaMac(key, who, until)}`;
};
export function isMfaDevice(key: string, who: string, value: string | null | undefined, now = Date.now()): boolean {
  const m = /^(\d{10})\.([A-Za-z0-9_-]{43})$/.exec(value ?? '');
  return !!m && Number(m[1]) > now / 1000 && same(m[2], mfaMac(key, who, Number(m[1])));
}
