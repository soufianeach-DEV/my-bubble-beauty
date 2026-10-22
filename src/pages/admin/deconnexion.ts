export const prerender = false;
// Déconnexion de l'admin, en POST seulement (un GET répond 404) : session supprimée en base et cookie expiré
import type { APIRoute } from 'astro';
import { log } from '../../lib/server/log.ts';
import { closeSession } from '../../lib/server/session.ts';

export const POST: APIRoute = async ({ cookies, locals, redirect }) => {
  await closeSession(cookies);
  log('logout', { user_id: locals.user?.id ?? null });
  return redirect('/fr/index.html', 303);
};
