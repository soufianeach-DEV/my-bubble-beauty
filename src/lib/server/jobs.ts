// Tâches de fond : rappels de la veille, recommandations après un blanchiment, demandes d'avis, copie des avis Google.
// Lancées toutes les 15 minutes dans le processus web (à la première requête) et par POST /api/taches (timer systemd du VPS).
// Verrou consultatif : deux passages simultanés (minuterie et timer, ou deux instances) n'envoient pas deux fois le même mail.
import { GOOGLE_REVIEW_URL } from 'astro:env/server';
import { refreshIfDue, sendReviewRequests } from './avis.ts';
import { sendAftercare, sendReminders } from './booking.ts';
import { sql } from './db.ts';
import { log } from './log.ts';

export type JobsResult = { ran: boolean; reminders: number; aftercare: number; reviewRequests: number; googleReviews: number | null };

let started = false;

export async function runJobs(): Promise<JobsResult> {
  const none: JobsResult = { ran: false, reminders: 0, aftercare: 0, reviewRequests: 0, googleReviews: null };
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
      };
    });
    if (r.reminders) log('reminders_sent', { count: r.reminders });
    if (r.aftercare) log('aftercare_sent', { count: r.aftercare });
    if (r.reviewRequests) log('review_requests_sent', { count: r.reviewRequests });
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
