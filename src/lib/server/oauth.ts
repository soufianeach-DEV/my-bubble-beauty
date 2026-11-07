// Connexion par Google ou Microsoft, côté variables d'environnement : fournisseurs actifs, départ, échange du code.
// Un fournisseur n'est proposé que si son identifiant ET son secret sont présents (Render ou .env).
import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, SITE_URL } from 'astro:env/server';
import { newToken } from './cookie.ts';
import { log } from './log.ts';
import { PROVIDERS, authorizeUrl, packFlow, readIdToken, type Flow, type Identity, type Provider } from './oidc.ts';

const CREDS: Record<Provider, [string | undefined, string | undefined]> = {
  google: [GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET],
  microsoft: [MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET],
};

export const enabledProviders = (): Provider[] => (['google', 'microsoft'] as const).filter((p) => CREDS[p][0] && CREDS[p][1]);
// Adresse de retour à déclarer telle quelle chez Google et chez Microsoft (une seule, sans langue)
export const redirectUri = (p: Provider) => `${SITE_URL}/oauth/${p}/retour`;

export function beginFlow(provider: Provider, lang: string, back: string): { url: string; cookie: string } {
  const f: Flow = { provider, state: newToken(), verifier: newToken(), nonce: newToken(), lang, back, at: Date.now() };
  return { url: authorizeUrl(f, CREDS[provider][0]!, redirectUri(provider)), cookie: packFlow(f) };
}

// Code contre jeton d'identité, de serveur à serveur (10 s au plus) ; null = échec, sans détail pour la cliente
export async function exchangeCode(f: Flow, code: string): Promise<Identity | null> {
  const [id, secret] = CREDS[f.provider];
  if (!id || !secret) return null;
  try {
    const r = await fetch(PROVIDERS[f.provider].token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri(f.provider), client_id: id, client_secret: secret, code_verifier: f.verifier }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await r.json().catch(() => ({}))) as { id_token?: string; error?: string };
    if (!r.ok || typeof body.id_token !== 'string') {
      log('oauth_token_failed', { provider: f.provider, status: r.status, error: body.error ?? null });
      return null;
    }
    const who = readIdToken(body.id_token, f, id);
    if (!who) log('oauth_id_token_refused', { provider: f.provider });
    return who;
  } catch (e) {
    log('oauth_token_failed', { provider: f.provider, error: String(e) });
    return null;
  }
}
