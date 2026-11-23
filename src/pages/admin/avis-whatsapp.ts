export const prerender = false;
// « Demander un avis » de l'agenda : note la demande puis ouvre WhatsApp (wa.me) avec le message prêt, dans un nouvel onglet.
// POST seulement ; aucun message n'est envoyé par le serveur.
import type { APIRoute } from 'astro';
import { GOOGLE_REVIEW_URL } from 'astro:env/server';
import { readForm, staffId } from '../../lib/server/admin.ts';
import { askReview } from '../../lib/server/avis-whatsapp.ts';

export const POST: APIRoute = async ({ locals, request, redirect }) => {
  const me = staffId(locals);
  if (!me) return new Response(null, { status: 404 });
  const form = await readForm(request);
  const id = Number(form?.get('id'));
  if (!Number.isSafeInteger(id) || id <= 0) return new Response('Rendez-vous inconnu.', { status: 400 });
  const r = await askReview(id, me, GOOGLE_REVIEW_URL);
  if (!r.ok) return new Response(r.error, { status: 409, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  return redirect(r.url, 303);
};
