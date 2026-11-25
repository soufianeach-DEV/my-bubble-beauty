export const prerender = false;
// Lien « Laisser mon avis » des mails : note le clic du rendez-vous (jeton signé) puis renvoie vers le formulaire d'avis du site
// pour ce rendez-vous, dans la langue de la cliente ; avis déjà déposé : la même page montre le merci et « Publier aussi sur Google ».
// Le jeton n'ouvre pas de session : sans connexion, le formulaire passe par la page de connexion et y revient.
// Jeton faux ou abîmé : l'espace cliente, rien n'est noté.
import type { APIRoute } from 'astro';
import { checkReviewToken, recordClick, reviewFormPath } from '../../lib/server/avis.ts';
import { log } from '../../lib/server/log.ts';

const go = (to: string) => new Response(null, { status: 302, headers: { Location: to, 'Referrer-Policy': 'no-referrer' } });

export const GET: APIRoute = async ({ params }) => {
  const id = checkReviewToken(params.jeton);
  if (!id) return go('/fr/compte');
  try {
    await recordClick(params.jeton);
    return go(await reviewFormPath(id));
  } catch (e) {
    log('review_click_failed', { error: String(e) });
    return go(`/fr/compte/avis?id=${id}`);
  }
};
