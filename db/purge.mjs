// Purge quotidienne (RGPD art. 5.1.e), selon les durées annoncées dans la page confidentialité ; les montants des réservations restent.
import { SESSION_IDLE } from '../src/lib/server/session-limits.mjs';

export async function purge(sql, adminEmail) {
  return sql.begin(async (tx) => ({
    // Mêmes durées que session.ts (session-limits.mjs) : expires_at porte le maximum, last_seen_at l'inactivité
    sessions: (await tx`DELETE FROM sessions WHERE expires_at <= now() OR last_seen_at <= now() - ${SESSION_IDLE}::interval`).count,
    tokens: (await tx`DELETE FROM email_tokens WHERE expires_at <= now() OR used_at IS NOT NULL`).count,
    unverified: (await tx`DELETE FROM users WHERE email_verified_at IS NULL AND created_at < now() - interval '7 days'`).count,
    // Le compte de la gérante n'est jamais effacé, même sans rendez-vous
    inactive: (await tx`DELETE FROM users u WHERE u.created_at < now() - interval '3 years' AND u.email <> ${adminEmail.trim().toLowerCase()}
      AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.user_id = u.id AND b.starts_at > now() - interval '3 years')`).count,
    guests: (await tx`UPDATE bookings SET guest_name = NULL, guest_phone = NULL
      WHERE starts_at < now() - interval '3 years' AND (guest_name IS NOT NULL OR guest_phone IS NOT NULL)`).count,
  }));
}
