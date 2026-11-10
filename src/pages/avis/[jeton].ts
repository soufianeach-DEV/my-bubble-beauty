export const prerender = false;
// Lien « Laisser un avis » des mails : note le clic du rendez-vous (jeton signé) puis renvoie vers la fiche Google.
// Jeton faux ou abîmé : redirection quand même (la cliente arrive sur Google), rien n'est noté.
import type { APIRoute } from 'astro';
import { GOOGLE_REVIEW_URL } from 'astro:env/server';
import { recordClick } from '../../lib/server/avis.ts';
import { log } from '../../lib/server/log.ts';

export const GET: APIRoute = async ({ params }) => {
  if (!GOOGLE_REVIEW_URL) return new Response(null, { status: 404 });
  try {
    await recordClick(params.jeton);
  } catch (e) {
    log('review_click_failed', { error: String(e) });
  }
  return new Response(null, { status: 302, headers: { Location: GOOGLE_REVIEW_URL, 'Referrer-Policy': 'no-referrer' } });
};
