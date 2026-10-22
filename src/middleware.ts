// Garde des routes à la demande : refus par défaut, décidé sur le motif de route (/FR/compte ou /xx/compte ne contournent rien).
import { defineMiddleware } from 'astro:middleware';
import { COOKIE, SESSION_COOKIE } from './lib/server/cookie.ts';
import { log } from './lib/server/log.ts';
import { clientIp } from './lib/server/rate.ts';

const FOLDERS = new Set(['fr', 'nl', 'eng']);
// Seules routes à la demande ouvertes sans session
const PUBLIC = new Set([
  '/[folder]/compte/connexion',
  '/[folder]/compte/inscription',
  '/[folder]/compte/verification',
  '/[folder]/compte/mot-de-passe-oublie',
  '/[folder]/compte/nouveau-mot-de-passe',
  '/api/stripe/webhook',
]);
// Seules routes ouvertes à l'admin avant le code TOTP : le code lui-même, et la déconnexion pour en sortir
const BEFORE_CODE = new Set(['/admin/code', '/admin/deconnexion']);

export const onRequest = defineMiddleware(async (ctx, next) => {
  if (ctx.isPrerendered) return next();
  // Point d'images d'Astro injecté d'office, inutilisé ici : sharp relancé à chaque requête saturerait l'instance
  if (ctx.routePattern === '/_image') return new Response(null, { status: 404 });
  const folder = ctx.params.folder;
  // Corps vide : Astro sert la page 404 du site
  if (folder !== undefined && !FOLDERS.has(folder)) return new Response(null, { status: 404 });
  ctx.locals.ip = clientIp(ctx.request.headers.get('x-forwarded-for'));
  // Import différé : le build pré-rend les pages statiques à travers ce middleware sans aucune variable d'environnement
  const { readSession } = await import('./lib/server/session.ts');
  const token = ctx.cookies.get(SESSION_COOKIE)?.value;
  const found = token ? await readSession(token) : null;
  if (token && !found) ctx.cookies.delete(SESSION_COOKIE, COOKIE);
  ctx.locals.user = found?.user ?? null;
  ctx.locals.session = found?.session ?? null;

  const route = ctx.routePattern;
  if (PUBLIC.has(route)) return next();
  if (!found) return ctx.redirect(`/${folder ?? 'fr'}/compte/connexion?retour=${encodeURIComponent(ctx.url.pathname + ctx.url.search)}`);
  if ((route === '/admin' || route.startsWith('/admin/')) && !found.user.isAdmin) {
    log('admin_denied', { user_id: found.user.id, ip: ctx.locals.ip });
    return new Response(null, { status: 404 });
  }
  // Compte de la gérante compris (mot de passe, appareils) : sans le code, le seul mot de passe suffirait à les changer
  if (found.user.isAdmin && !found.session.mfaAt && !BEFORE_CODE.has(route)) return ctx.redirect('/admin/code');
  return next();
});
