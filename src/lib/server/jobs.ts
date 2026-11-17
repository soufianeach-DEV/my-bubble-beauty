// Tâches de fond : rappels de la veille, recommandations après un blanchiment, demandes d'avis, copie des avis Google, note Google.
// Lancées toutes les 15 minutes dans le processus web (à la première requête) et par POST /api/taches (timer systemd du VPS).
// Verrou consultatif : deux passages simultanés (minuterie et timer, ou deux instances) n'envoient pas deux fois le même mail.
import { GOOGLE_REVIEW_URL } from 'astro:env/server';
import { refreshIfDue, sendReviewRequests } from './avis.ts';
import { sendAftercare, sendReminders } from './booking.ts';
import { sql } from './db.ts';
import { log } from './log.ts';
import { sealLegacyNotes } from './profil.ts';
import { refreshRatingIfDue } from './note-google.ts';

export type JobsResult = { ran: boolean; reminders: number; aftercare: number; reviewRequests: number; googleReviews: number | null; googleRating: boolean | null; notesSealed: number };

let started = false;

export async function runJobs(): Promise<JobsResult> {
  const none: JobsResult = { ran: false, reminders: 0, aftercare: 0, reviewRequests: 0, googleReviews: null, googleRating: null, notesSealed: 0 };
  try {
    const r = await sql.begin(async (tx) => {
      const [{ ok }] = await tx`SELECT pg_try_advisory_xact_lock(hashtext('my-bubble-rappels')) AS ok`;
      if (!ok) return none;
      // Chaque tâche à part : une panne de Google n'empêche pas les rappels
      const safe = async <T>(name: string, f: () => Promise<T>, fallback: T) => f().catch((e) => (log('job_failed', { job: name, error: String(e) }), fallback));
      return {
        ran: true,
        reminders: await safe('reminders', () => sendReminders(), 0),
        aftercare: await safe('aftercare', () => sendAftercare(), 0),
        reviewRequests: await safe('review_requests', () => sendReviewRequests(GOOGLE_REVIEW_URL), 0),
        googleReviews: await safe('google_reviews', () => refreshIfDue(), null),
        // Note Google par l'API Places : une fois par nuit, seulement sans les avis Business Profile
        googleRating: await safe('google_rating', () => refreshRatingIfDue(), null),
        // Notes d'avant la migration 028 encore en clair : rechiffrées par lots (plus rien à faire ensuite)
        notesSealed: await safe('seal_notes', () => sealLegacyNotes(), 0),
      };
    });
    if (r.reminders) log('reminders_sent', { count: r.reminders });
    if (r.aftercare) log('aftercare_sent', { count: r.aftercare });
    if (r.reviewRequests) log('review_requests_sent', { count: r.reviewRequests });
    if (r.notesSealed) log('notes_sealed', { count: r.notesSealed });
    return r;
  } catch (e) {
    log('reminders_failed', { error: String(e) });
    return none;
  }
}

export function startJobs() {
  if (started) return;
  started = true;
  runJobs();
  setInterval(runJobs, 15 * 60 * 1000).unref();
}
