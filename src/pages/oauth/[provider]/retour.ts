export const prerender = false;
// Retour de Google ou Microsoft (adresse déclarée chez eux) : cookie relu puis effacé, state comparé, code échangé côté serveur.
// Tout échec renvoie vers la connexion avec un message unique ; annulation par la cliente = message distinct, sans alerte.
import type { APIRoute } from 'astro';
import { signInExternal } from '../../../lib/server/accounts.ts';
import { COOKIE } from '../../../lib/server/cookie.ts';
import { log } from '../../../lib/server/log.ts';
import { exchangeCode } from '../../../lib/server/oauth.ts';
import { FLOW_COOKIE, same, unpackFlow } from '../../../lib/server/oidc.ts';
import { FOLDER, LANGS, type Lang } from '../../../lib/site.ts';

export const GET: APIRoute = async ({ params, url, cookies, locals, request, redirect }) => {
  const f = unpackFlow(cookies.get(FLOW_COOKIE)?.value);
  cookies.delete(FLOW_COOKIE, COOKIE);
  const lang: Lang = LANGS.find((l) => l === f?.lang) ?? 'fr';
  const fail = (why: string) => redirect(`/${FOLDER[lang]}/compte/connexion?externe=${why}`, 303);
  if (!f || f.provider !== params.provider || !same(url.searchParams.get('state'), f.state)) {
    log('oauth_state_refused', { provider: params.provider ?? null, ip: locals.ip });
    return fail('echec');
  }
  // access_denied : la cliente a fermé ou refusé l'écran du fournisseur
  if (url.searchParams.get('error')) return fail(url.searchParams.get('error') === 'access_denied' ? 'annule' : 'echec');
  const code = url.searchParams.get('code');
  if (!code || code.length > 2048) return fail('echec');
  const who = await exchangeCode(f, code);
  const u = who && (await signInExternal(cookies, who, lang, locals.ip, request.headers.get('user-agent')));
  return u ? redirect(f.back, 303) : fail('echec');
};
