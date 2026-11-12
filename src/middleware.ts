// Garde des routes à la demande : refus par défaut, décidé sur le motif de route (/FR/compte ou /xx/compte ne contournent rien).
import { defineMiddleware } from 'astro:middleware';
import { COOKIE, HINT, HINT_COOKIE, SESSION_COOKIE } from './lib/server/cookie.ts';
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
  '/[folder]/compte/lien',
  // Lien de désinscription des demandes d'avis : signé, sans session
  '/[folder]/compte/avis-desinscription',
  '/oauth/[provider]',
  '/oauth/[provider]/retour',
  '/api/stripe/webhook',
  // Qui est connecté, pour l'en-tête des pages pré-rendues : 204 sans session
  '/api/moi',
  // Avis Google de l'Accueil, et tâches planifiées (protégées par TASKS_SECRET)
  '/api/avis',
  // Lien suivi « Laisser un avis » des mails (jeton signé)
  '/avis/[jeton]',
  '/api/taches',
  // Sonde de santé (Render, surveillance externe) : « ok » ou « indisponible », rien d'autre
  '/api/sante',
]);
// Seules routes ouvertes à l'équipe (admin, gestionnaire) avant le code TOTP : le code lui-même, et la déconnexion pour en sortir
const BEFORE_CODE = new Set(['/admin/code', '/admin/deconnexion']);
// Compte en suppression (30 jours) : réactiver, effacer tout de suite ou se déconnecter, rien d'autre
const REACTIVATE = '/[folder]/compte/reactiver';

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
  // Rappels de la veille : lancés à la première requête servie (l'instance gratuite dort sans trafic)
  (await import('./lib/server/jobs.ts')).startJobs();
  const token = ctx.cookies.get(SESSION_COOKIE)?.value;
  const found = token ? await readSession(token) : null;
  if (token && !found) ctx.cookies.delete(SESSION_COOKIE, COOKIE);
  // Témoin de l'en-tête aligné sur la session réelle à chaque page à la demande
  const hinted = ctx.cookies.get(HINT_COOKIE)?.value === '1';
  if (found && !hinted) ctx.cookies.set(HINT_COOKIE, '1', HINT);
  else if (!found && hinted) ctx.cookies.delete(HINT_COOKIE, HINT);
  ctx.locals.user = found?.user ?? null;
  ctx.locals.session = found?.session ?? null;

  const route = ctx.routePattern;
  if (PUBLIC.has(route)) return next();
  if (!found) return ctx.redirect(`/${folder ?? 'fr'}/compte/connexion?retour=${encodeURIComponent(ctx.url.pathname + ctx.url.search)}`);
  if (found.user.deletedAt && route !== REACTIVATE) return ctx.redirect(`/${folder ?? 'fr'}/compte/reactiver`);
  if (!found.user.deletedAt && route === REACTIVATE) return ctx.redirect(`/${folder ?? 'fr'}/compte`);
  if ((route === '/admin' || route.startsWith('/admin/')) && !found.user.role) {
    log('admin_denied', { user_id: found.user.id, ip: ctx.locals.ip });
    return new Response(null, { status: 404 });
  }
  // Compte de la gérante compris (mot de passe, appareils) : sans le code, le seul mot de passe suffirait à les changer
  if (found.user.role && !found.session.mfaAt && !BEFORE_CODE.has(route)) return ctx.redirect('/admin/code');
  return next();
});
