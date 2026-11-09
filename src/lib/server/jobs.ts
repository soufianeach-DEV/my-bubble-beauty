// Tâches de fond dans le processus web : rappels de la veille et recommandations après un blanchiment, toutes les 15 minutes. Lancées une fois, à la première requête.
// Verrou consultatif : deux instances (déploiement qui chevauche l'ancien) n'envoient pas deux fois le même lot.
import { sendAftercare, sendReminders } from './booking.ts';
import { sql } from './db.ts';
import { log } from './log.ts';

let started = false;

async function remind() {
  try {
    const sent = await sql.begin(async (tx) => {
      const [{ ok }] = await tx`SELECT pg_try_advisory_xact_lock(hashtext('my-bubble-rappels')) AS ok`;
      return ok ? [await sendReminders(), await sendAftercare()] : [0, 0];
    });
    if (sent[0]) log('reminders_sent', { count: sent[0] });
    if (sent[1]) log('aftercare_sent', { count: sent[1] });
  } catch (e) {
    log('reminders_failed', { error: String(e) });
  }
}

export function startJobs() {
  if (started) return;
  started = true;
  remind();
  setInterval(remind, 15 * 60 * 1000).unref();
}
