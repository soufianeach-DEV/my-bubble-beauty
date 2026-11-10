export const prerender = false;
// Section « Avis des clientes » de l'Accueil (page pré-rendue) : avis Google copiés par la tâche planifiée. 204 s'il n'y en a pas.
import type { APIRoute } from 'astro';
import { GOOGLE_REVIEW_URL } from 'astro:env/server';
import { latestReviews } from '../../lib/server/avis.ts';
import { log } from '../../lib/server/log.ts';

export const GET: APIRoute = async () => {
  try {
    const view = await latestReviews();
    return view ? Response.json({ ...view, write: GOOGLE_REVIEW_URL ?? null }) : new Response(null, { status: 204 });
  } catch (e) {
    log('reviews_read_failed', { error: String(e) });
    return new Response(null, { status: 204 });
  }
};
