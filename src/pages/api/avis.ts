export const prerender = false;
// Section « Avis des clientes » de l'Accueil (page pré-rendue) : avis Google copiés par la tâche planifiée. 204 s'il n'y en a pas.
// Tant que l'API Business Profile n'est pas branchée : la note Google seule (note et nombre d'avis), dans « note ».
import type { APIRoute } from 'astro';
import { GOOGLE_REVIEW_URL } from 'astro:env/server';
import { googleConfigured, latestReviews } from '../../lib/server/avis.ts';
import { log } from '../../lib/server/log.ts';
import { readRating } from '../../lib/server/reglages.ts';
import { CONTACT } from '../../lib/site.ts';

export const GET: APIRoute = async () => {
  try {
    if (!googleConfigured()) {
      const { rating, count } = await readRating();
      return Response.json({ note: { rating, count, url: GOOGLE_REVIEW_URL ?? CONTACT.maps } });
    }
    const view = await latestReviews();
    return view ? Response.json({ ...view, write: GOOGLE_REVIEW_URL ?? null }) : new Response(null, { status: 204 });
  } catch (e) {
    log('reviews_read_failed', { error: String(e) });
    return new Response(null, { status: 204 });
  }
};
