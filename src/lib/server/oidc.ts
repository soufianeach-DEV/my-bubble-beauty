// Connexion par Google ou Microsoft (OpenID Connect, code d'autorisation + PKCE) : fonctions pures, sans variable d'environnement.
// Le jeton d'identité vient directement du point « token » du fournisseur, en TLS et avec notre secret : OIDC Core 3.1.3.7 admet
// alors de ne pas vérifier sa signature. Émetteur, audience, expiration et nonce restent contrôlés.
import { createHash, timingSafeEqual } from 'node:crypto';

export type Provider = 'google' | 'microsoft';
export type Identity = { provider: Provider; subject: string; email: string; emailVerified: boolean; name: string | null };
export type Flow = { provider: Provider; state: string; verifier: string; nonce: string; lang: string; back: string; at: number };

// Comptes Microsoft personnels seulement (Outlook, Hotmail, Live) : leur adresse appartient au compte. Les comptes professionnels
// peuvent porter une adresse non vérifiée, on ne les accepte donc pas (point « consumers » + locataire fixe).
export const MS_CONSUMERS = '9188040d-6c67-4c5b-b112-36a304b66dad';
export const PROVIDERS: Record<Provider, { label: string; auth: string; token: string; issuers: string[] }> = {
  google: {
    label: 'Google',
    auth: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    issuers: ['https://accounts.google.com', 'accounts.google.com'],
  },
  microsoft: {
    label: 'Microsoft',
    auth: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize',
    token: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
    issuers: [`https://login.microsoftonline.com/${MS_CONSUMERS}/v2.0`],
  },
};
export const isProvider = (p: string | undefined): p is Provider => p === 'google' || p === 'microsoft';

// Aller-retour chez le fournisseur : 10 minutes au plus
export const FLOW_MAX_MS = 10 * 60 * 1000;
export const FLOW_COOKIE = '__Host-mb_oauth';

export const challenge = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');

export function authorizeUrl(f: Flow, clientId: string, redirectUri: string): string {
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state: f.state,
    nonce: f.nonce,
    code_challenge: challenge(f.verifier),
    code_challenge_method: 'S256',
    // Choix du compte à chaque fois : sur un ordinateur partagé, pas de connexion silencieuse au compte d'une autre personne
    prompt: 'select_account',
  });
  return `${PROVIDERS[f.provider].auth}?${q}`;
}

export const packFlow = (f: Flow) => Buffer.from(JSON.stringify(f)).toString('base64url');

export function unpackFlow(value: string | undefined, now = Date.now()): Flow | null {
  try {
    const f = JSON.parse(Buffer.from(value ?? '', 'base64url').toString()) as Flow;
    if (!isProvider(f.provider) || typeof f.state !== 'string' || typeof f.verifier !== 'string' || typeof f.nonce !== 'string') return null;
    if (typeof f.lang !== 'string' || typeof f.back !== 'string') return null;
    if (typeof f.at !== 'number' || now - f.at > FLOW_MAX_MS || f.at > now + 60_000) return null;
    return f;
  } catch {
    return null;
  }
}

// Comparaison à temps constant (state renvoyé par le fournisseur, nonce du jeton)
export function same(a: string | null | undefined, b: string): boolean {
  const x = Buffer.from(a ?? ''), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// null = jeton refusé. now en secondes, comme exp dans le jeton
export function readIdToken(idToken: string, f: Flow, clientId: string, now = Math.floor(Date.now() / 1000)): Identity | null {
  let c: Record<string, unknown>;
  try {
    c = JSON.parse(Buffer.from(idToken.split('.')[1] ?? '', 'base64url').toString());
  } catch {
    return null;
  }
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (!PROVIDERS[f.provider].issuers.includes(String(c.iss)) || !aud.includes(clientId)) return null;
  // Une minute de tolérance d'horloge
  if (typeof c.exp !== 'number' || c.exp < now - 60) return null;
  if (typeof c.nonce !== 'string' || !same(c.nonce, f.nonce)) return null;
  if (typeof c.sub !== 'string' || !c.sub || c.sub.length > 255) return null;
  const email = typeof c.email === 'string' ? c.email.trim().toLowerCase() : '';
  if (!email) return null;
  const emailVerified = f.provider === 'google' ? c.email_verified === true : c.tid === MS_CONSUMERS;
  const name = typeof c.name === 'string' && c.name.trim() ? c.name.trim().slice(0, 100) : null;
  return { provider: f.provider, subject: c.sub, email, emailVerified, name };
}
