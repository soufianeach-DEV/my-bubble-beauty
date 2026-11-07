export const prerender = false;
// Départ vers Google ou Microsoft : state, nonce et vérificateur PKCE gardés 10 minutes dans un cookie HttpOnly, puis redirection.
// Lax : le cookie revient avec la redirection du fournisseur (navigation de premier niveau). Fournisseur non configuré = 404.
import type { APIRoute } from 'astro';
import { SITE_URL } from 'astro:env/server';
import { COOKIE } from '../../lib/server/cookie.ts';
import { beginFlow, enabledProviders } from '../../lib/server/oauth.ts';
import { FLOW_COOKIE, isProvider } from '../../lib/server/oidc.ts';
import { safeReturn } from '../../lib/server/redirect.ts';
import { FOLDER, LANGS, type Lang } from '../../lib/site.ts';

export const GET: APIRoute = ({ params, url, cookies, locals, redirect }) => {
  const p = params.provider;
  if (!isProvider(p) || !enabledProviders().includes(p)) return new Response(null, { status: 404 });
  const lang: Lang = LANGS.find((l) => l === url.searchParams.get('lang')) ?? 'fr';
  const back = safeReturn(url.searchParams.get('retour'), SITE_URL, `/${FOLDER[lang]}/compte`);
  if (locals.user) return redirect(back, 303);
  const { url: to, cookie } = beginFlow(p, lang, back);
  cookies.set(FLOW_COOKIE, cookie, { ...COOKIE, maxAge: 600 });
  return redirect(to, 303);
};
