// Purge quotidienne (RGPD art. 5.1.e), selon les durées annoncées dans la page confidentialité ; les montants des réservations restent.
import { SESSION_IDLE, SESSION_REMEMBER } from '../src/lib/server/session-limits.mjs';

// Comptes à effacer : leurs rendez-vous restent, marqués client_erased (sinon l'agenda les prendrait pour des saisies de l'institut),
// et une ligne de journal par compte est écrite avant la suppression (client_id passe ensuite à NULL).
async function erase(tx, ids, why) {
  if (!ids.length) return 0;
  await tx`UPDATE bookings SET client_erased = true WHERE user_id = ANY(${ids}::bigint[])`;
  await tx`UPDATE audit_log SET ip = NULL WHERE client_id = ANY(${ids}::bigint[]) OR actor_id = ANY(${ids}::bigint[])`;
  await tx`INSERT INTO audit_log (action, client_id, details) SELECT 'account_erased', id, ${tx.json({ by: why })} FROM unnest(${ids}::bigint[]) id`;
  return (await tx`DELETE FROM users WHERE id = ANY(${ids}::bigint[])`).count;
}
const ids = (rows) => rows.map((r) => r.id);

export async function purge(sql, adminEmail) {
  const admin = adminEmail.trim().toLowerCase();
  return sql.begin(async (tx) => ({
    // Mêmes durées que session.ts (session-limits.mjs) : expires_at porte le maximum, last_seen_at l'inactivité
    sessions: (await tx`DELETE FROM sessions WHERE expires_at <= now() OR last_seen_at <= now() - (CASE WHEN remember THEN ${SESSION_REMEMBER} ELSE ${SESSION_IDLE} END)::interval`).count,
    tokens: (await tx`DELETE FROM email_tokens WHERE expires_at <= now() OR used_at IS NOT NULL`).count,
    unverified: await erase(tx, ids(await tx`SELECT id FROM users WHERE email_verified_at IS NULL AND created_at < now() - interval '7 days'`), 'unverified'),
    // Suppression demandée par la cliente : 30 jours pour revenir (rgpd.ts, GRACE_DAYS), puis effacement
    deleted: await erase(tx, ids(await tx`SELECT id FROM users WHERE deleted_at <= now() - interval '30 days' AND email <> ${admin}`), 'deleted'),
    // Le compte de la gérante n'est jamais effacé, même sans rendez-vous
    inactive: await erase(tx, ids(await tx`SELECT u.id FROM users u WHERE u.created_at < now() - interval '3 years' AND u.email <> ${admin}
      AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.user_id = u.id AND b.starts_at > now() - interval '3 years')`), 'inactive'),
    guests: (await tx`UPDATE bookings SET guest_name = NULL, guest_phone = NULL
      WHERE starts_at < now() - interval '3 years' AND (guest_name IS NOT NULL OR guest_phone IS NOT NULL)`).count,
    // Journal d'audit : 12 mois
    journal: (await tx`DELETE FROM audit_log WHERE at < now() - interval '12 months'`).count,
    // Mesure d'audience : 13 mois, comme annoncé dans la page confidentialité
    visits: (await tx`DELETE FROM site_visits WHERE day < (now() - interval '13 months')::date`).count,
  }));
}
