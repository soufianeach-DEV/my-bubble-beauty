export const prerender = false;
// En-tête des pages pré-rendues : initiales et équipe ou non, pour la personne connectée ; 204 sans session. Jamais en cache.
import type { APIRoute } from 'astro';
import { initialsOf } from '../../lib/site';

const NO_STORE = { 'Cache-Control': 'no-store' };
export const GET: APIRoute = ({ locals }) => {
  const u = locals.user;
  if (!u) return new Response(null, { status: 204, headers: NO_STORE });
  return Response.json({ initials: initialsOf(u.name, u.email), staff: !!u.role }, { headers: NO_STORE });
};
