// Note Google de l'Accueil, affichée tant que les vrais avis (API Business Profile) ne sont pas branchés : note moyenne et
// nombre d'avis, rien d'autre. Saisie par la gérante dans Réglages, ou relue chaque nuit par l'API Places si GOOGLE_PLACES_KEY
// et GOOGLE_PLACE_ID sont posés. Aucun texte d'avis n'est lu ni gardé. Aucun balisage aggregateRating : Google interdit
// qu'un commerce balise la note de sa propre fiche.
import { GOOGLE_PLACE_ID, GOOGLE_PLACES_KEY } from 'astro:env/server';
import { googleConfigured } from './avis.ts';
import { sql } from './db.ts';
import { log } from './log.ts';
import { saveRating } from './reglages.ts';

export const placesConfigured = () => !!(GOOGLE_PLACES_KEY && GOOGLE_PLACE_ID);

export const validRating = (rating: unknown, count: unknown): rating is number =>
  typeof rating === 'number' && rating >= 1 && rating <= 5 && Number.isSafeInteger(count) && (count as number) >= 0;

// Place Details (New), deux champs seulement (le masque fixe aussi le prix de l'appel). Un essai par jour, réussi ou non :
// une panne de Google ne déclenche pas un appel facturé toutes les 15 minutes. Erreur : la note enregistrée reste en place.
export async function refreshRating(fetchFn: typeof fetch = fetch): Promise<boolean | null> {
  if (!placesConfigured() || googleConfigured()) return null;
  await saveRating(sql, { checked_at: new Date().toISOString() });
  try {
    const res = await fetchFn(`https://places.googleapis.com/v1/places/${encodeURIComponent(GOOGLE_PLACE_ID!)}`, {
      headers: { 'X-Goog-Api-Key': GOOGLE_PLACES_KEY!, 'X-Goog-FieldMask': 'rating,userRatingCount' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`places HTTP ${res.status}`);
    const { rating, userRatingCount } = (await res.json()) as { rating?: unknown; userRatingCount?: unknown };
    if (!validRating(rating, userRatingCount)) throw new Error('réponse sans note valable');
    await saveRating(sql, { rating: Math.round(rating * 10) / 10, count: userRatingCount as number, source: 'places', updated_at: new Date().toISOString() });
    log('google_rating_synced', { rating, count: userRatingCount });
    return true;
  } catch (e) {
    log('google_rating_failed', { error: String(e) });
    return false;
  }
}

// Une fois par jour, au premier passage des tâches après minuit à Bruxelles (elles tournent toutes les 15 minutes)
export async function refreshRatingIfDue(fetchFn: typeof fetch = fetch): Promise<boolean | null> {
  if (!placesConfigured() || googleConfigured()) return null;
  const [due] = await sql<{ due: boolean }[]>`
    SELECT coalesce((SELECT (value->>'checked_at')::timestamptz < date_trunc('day', now() AT TIME ZONE 'Europe/Brussels') AT TIME ZONE 'Europe/Brussels'
      FROM settings WHERE key = 'google_rating'), true) AS due`;
  return due.due ? refreshRating(fetchFn) : null;
}
