// Sessions serveur (ASVS 3.3.2 niveau 2 pour toutes) : inactivité et durée maximale fixées dans session-limits.mjs, que la purge relit.
import type { AstroCookies } from 'astro';
import { ADMIN_EMAIL } from 'astro:env/server';
import { COOKIE, SESSION_COOKIE, hashToken, newToken } from './cookie.ts';
import { sql } from './db.ts';
import { SESSION_IDLE, SESSION_MAX } from './session-limits.mjs';

export type SessionUser = { id: number; email: string; name: string | null; phone: string | null; locale: 'fr' | 'nl' | 'en'; isAdmin: boolean };
export type SessionInfo = { hash: Buffer; mfaAt: Date | null; createdAt: Date };

// L'admin se décide côté serveur : e-mail vérifié égal à ADMIN_EMAIL, jamais un champ de formulaire
export const isAdminEmail = (email: string) => email === ADMIN_EMAIL.trim().toLowerCase();

// Lit la session du cookie et prolonge l'inactivité ; null si inconnue ou expirée
export async function readSession(token: string): Promise<{ user: SessionUser; session: SessionInfo } | null> {
  const [r] = await sql`
    UPDATE sessions s SET last_seen_at = now() FROM users u
    WHERE s.token_hash = ${hashToken(token)} AND u.id = s.user_id
      AND s.expires_at > now() AND s.last_seen_at > now() - ${SESSION_IDLE}::interval
    RETURNING s.token_hash, s.mfa_at, s.created_at, u.id, u.email, u.name, u.phone, u.locale, u.email_verified_at`;
  if (!r) return null;
  const isAdmin = r.email_verified_at !== null && isAdminEmail(r.email);
  return {
    user: { id: r.id, email: r.email, name: r.name, phone: r.phone, locale: r.locale, isAdmin },
    session: { hash: r.token_hash, mfaAt: r.mfa_at, createdAt: r.created_at },
  };
}

// Nouvelle session à chaque connexion et à la validation du code admin (mfa) : l'ancien jeton est détruit, pas de fixation
export async function openSession(cookies: AstroCookies, userId: number, userAgent: string | null, mfa = false) {
  await closeSession(cookies);
  const token = newToken();
  await sql`
    INSERT INTO sessions (token_hash, user_id, user_agent, mfa_at, expires_at)
    VALUES (${hashToken(token)}, ${userId}, ${(userAgent ?? '').slice(0, 256)}, CASE WHEN ${mfa} THEN now() END, now() + ${SESSION_MAX}::interval)`;
  cookies.set(SESSION_COOKIE, token, COOKIE);
}

// Déconnexion (POST uniquement) : ligne supprimée et cookie expiré
export async function closeSession(cookies: AstroCookies) {
  const token = cookies.get(SESSION_COOKIE)?.value;
  if (token) await sql`DELETE FROM sessions WHERE token_hash = ${hashToken(token)}`;
  cookies.delete(SESSION_COOKIE, COOKIE);
}

// « Déconnecter les autres appareils » (après mot de passe redemandé) et changement de mot de passe
export async function revokeOthers(userId: number, keep: Buffer) {
  await sql`DELETE FROM sessions WHERE user_id = ${userId} AND token_hash <> ${keep}`;
}

// Réinitialisation du mot de passe : toutes les sessions tombent
export async function revokeAll(userId: number) {
  await sql`DELETE FROM sessions WHERE user_id = ${userId}`;
}

export async function listSessions(userId: number, current: Buffer) {
  return sql<{ user_agent: string; created_at: Date; last_seen_at: Date; current: boolean }[]>`
    SELECT user_agent, created_at, last_seen_at, token_hash = ${current} AS current FROM sessions
    WHERE user_id = ${userId} AND expires_at > now() AND last_seen_at > now() - ${SESSION_IDLE}::interval
    ORDER BY last_seen_at DESC`;
}
