// Parcours de compte : inscription, vérification, connexion, mot de passe oublié ou changé, sessions, profil, code de l'admin.
// Les pages valident d'abord les champs (Zod : e-mail ≤ 254, nom ≤ 100, téléphone ≤ 30) ; ici, les règles de sécurité.
import type { AstroCookies } from 'astro';
import type { Lang } from '../site.ts';
import { checkAdminCode, clearLoginLimits, deviceCookie, hashPassword, login, newPasswordProblem, verifyPassword, type LoginUser } from './auth.ts';
import { DEVICE, DEVICE_COOKIE, hashToken, newToken } from './cookie.ts';
import { sql } from './db.ts';
import { log } from './log.ts';
import { existsMail, passwordChangedMail, resetMail, sendMail, verifyMail, type Mail } from './mail.ts';
import { badEmail } from './password.ts';
import { blocked, hit } from './rate.ts';
import { isAdminEmail, openSession, revokeOthers, type SessionUser } from './session.ts';

export type PasswordProblem = 'short' | 'long' | 'pwned';

// Inscription et oubli écrivent à une adresse saisie : 3 e-mails par heure et par adresse, 20 par IP, puis silence derrière la même réponse.
// L'IP est comptée d'abord : au-delà de son quota, elle ne crée plus de compteur par adresse inventée.
const mailAllowed = (email: string, ip: string) => !hit('mailIp', ip) && !hit('mailTo', email);

// Jeton d'e-mail créé puis envoyé sans être attendu : la réponse ne trahit pas l'existence du compte
function mailWithToken(userId: number, email: string, purpose: 'verify' | 'reset', minutes: number, mail: (token: string) => Mail) {
  const token = newToken();
  sql`INSERT INTO email_tokens (token_hash, user_id, purpose, expires_at) VALUES (${hashToken(token)}, ${userId}, ${purpose}, now() + make_interval(mins => ${minutes}::int))`
    .then(() => sendMail(email, mail(token)))
    .catch((e) => log('mail_failed', { kind: purpose, user_id: userId, error: String(e) }));
}

// null = réponse générique « si l'adresse est valide, un e-mail vient de partir », que l'adresse soit libre ou prise.
// Politique, HIBP et hash passent avant toute recherche : même message et même durée dans les deux cas.
export async function register(input: { email: string; password: string; name?: string | null; phone?: string | null; locale: Lang; ip: string }): Promise<PasswordProblem | null> {
  const email = input.email.trim().toLowerCase();
  // Adresse impossible : aucune ne peut exister, la réponse générique ne trahit rien
  if (badEmail(email)) return null;
  const problem = await newPasswordProblem(input.password);
  if (problem) return problem;
  const hash = await hashPassword(input.password);
  if (!mailAllowed(email, input.ip)) {
    log('register_mail_limited', { ip: input.ip });
    return null;
  }
  const [u] = await sql`
    INSERT INTO users (email, password_hash, name, phone, locale) VALUES (${email}, ${hash}, ${input.name || null}, ${input.phone || null}, ${input.locale})
    ON CONFLICT (email) DO NOTHING RETURNING id`;
  if (u) {
    log('register', { user_id: u.id, ip: input.ip });
    mailWithToken(u.id, email, 'verify', 24 * 60, (t) => verifyMail(input.locale, t));
  } else {
    log('register_existing', { ip: input.ip });
    sendMail(email, existsMail(input.locale));
  }
  return null;
}

// POST de /compte/verification (jeton caché + mot de passe) : le mot de passe prouve que la personne qui clique est celle qui
// s'est inscrite (compte pré-créé par un tiers). Un mauvais mot de passe laisse le jeton utilisable. Ouvre la session.
export async function verifyEmail(cookies: AstroCookies, token: string, password: string, ip: string, userAgent: string | null): Promise<LoginUser | null> {
  if (hit('loginIp', ip)) {
    log('verify_locked', { ip });
    return null;
  }
  const [u] = await sql`
    SELECT u.id, u.email, u.locale, u.password_hash FROM email_tokens t JOIN users u ON u.id = t.user_id
    WHERE t.token_hash = ${hashToken(token)} AND t.purpose = 'verify' AND t.used_at IS NULL AND t.expires_at > now()`;
  if (!(await verifyPassword(u?.password_hash, password)) || blocked('loginEmail', u.email)) {
    if (u) hit('loginEmail', u.email);
    log('verify_failed', { user_id: u?.id ?? null, ip });
    return null;
  }
  const [used] = await sql`UPDATE email_tokens SET used_at = now() WHERE token_hash = ${hashToken(token)} AND used_at IS NULL RETURNING user_id`;
  if (!used) return null;
  await sql`UPDATE users SET email_verified_at = coalesce(email_verified_at, now()), updated_at = now() WHERE id = ${u.id}`;
  log('email_verified', { user_id: u.id });
  await openSession(cookies, u.id, userAgent);
  return { id: u.id, email: u.email, locale: u.locale };
}

// Connexion : message unique en cas d'échec (null). mfaRequired : rediriger vers /admin/code, la session n'ouvre pas /admin sans le code.
// Lit puis pose le cookie d'appareil : la page de connexion n'a rien d'autre à faire.
export async function signIn(cookies: AstroCookies, email: string, password: string, ip: string, userAgent: string | null): Promise<(LoginUser & { mfaRequired: boolean }) | null> {
  const u = await login(email, password, ip, cookies.get(DEVICE_COOKIE)?.value);
  if (!u) return null;
  await openSession(cookies, u.id, userAgent);
  cookies.set(DEVICE_COOKIE, deviceCookie(u.email), DEVICE);
  return { ...u, mfaRequired: isAdminEmail(u.email) };
}

// Code de l'appli d'authentification (anti-rejeu par totp_last_step) ; la session est tournée et porte mfa_at
export async function verifyAdminTotp(cookies: AstroCookies, user: SessionUser, code: string, userAgent: string | null): Promise<boolean> {
  if (!user.isAdmin || !(await checkAdminCode(user.id, code.trim()))) return false;
  await openSession(cookies, user.id, userAgent, true);
  return true;
}

// Mot de passe oublié : rien n'est dit sur l'existence du compte. Un compte non vérifié peut aussi s'en servir (la réinitialisation le vérifie).
export async function requestReset(email: string, lang: Lang, ip: string): Promise<void> {
  email = email.trim().toLowerCase();
  if (badEmail(email)) return;
  if (!mailAllowed(email, ip)) {
    log('reset_mail_limited', { ip });
    return;
  }
  const [u] = await sql`SELECT id FROM users WHERE email = ${email}`;
  log('reset_requested', { user_id: u?.id ?? null, ip });
  if (u) mailWithToken(u.id, email, 'reset', 30, (t) => resetMail(lang, t));
}

// Jeton de 30 min à usage unique ; succès = adresse vérifiée, toutes les sessions et tous les liens en cours révoqués, compteurs remis à zéro.
// Pas de connexion automatique : la page renvoie vers la connexion.
export async function resetPassword(token: string, password: string): Promise<'ok' | 'invalid' | PasswordProblem> {
  const [t] = await sql`SELECT 1 FROM email_tokens WHERE token_hash = ${hashToken(token)} AND purpose = 'reset' AND used_at IS NULL AND expires_at > now()`;
  if (!t) return 'invalid';
  const problem = await newPasswordProblem(password);
  if (problem) return problem;
  const hash = await hashPassword(password);
  const u = await sql.begin(async (tx) => {
    const [used] = await tx`UPDATE email_tokens SET used_at = now()
      WHERE token_hash = ${hashToken(token)} AND purpose = 'reset' AND used_at IS NULL AND expires_at > now() RETURNING user_id`;
    if (!used) return null;
    await tx`UPDATE email_tokens SET used_at = now() WHERE user_id = ${used.user_id} AND used_at IS NULL`;
    await tx`DELETE FROM sessions WHERE user_id = ${used.user_id}`;
    const [row] = await tx<{ id: number; email: string; locale: Lang }[]>`
      UPDATE users SET password_hash = ${hash}, email_verified_at = coalesce(email_verified_at, now()), updated_at = now()
      WHERE id = ${used.user_id} RETURNING id, email, locale`;
    return row;
  });
  if (!u) return 'invalid';
  clearLoginLimits(u.email);
  log('password_reset', { user_id: u.id });
  sendMail(u.email, passwordChangedMail(u.locale));
  return 'ok';
}

// Mot de passe actuel redemandé, essais comptés comme la connexion (100 par heure et par compte)
async function checkCurrent(userId: number, password: string) {
  const [u] = await sql<{ email: string; locale: Lang; password_hash: string }[]>`SELECT email, locale, password_hash FROM users WHERE id = ${userId}`;
  if (u && !blocked('loginEmail', u.email) && (await verifyPassword(u.password_hash, password))) return u;
  if (u) hit('loginEmail', u.email);
  log('password_check_failed', { user_id: userId });
  return null;
}

// Changement depuis le compte : les autres appareils sont déconnectés, un avis part par e-mail. keep = Astro.locals.session.hash
export async function changePassword(userId: number, current: string, next: string, keep: Buffer): Promise<'ok' | 'wrong' | PasswordProblem> {
  const u = await checkCurrent(userId, current);
  if (!u) return 'wrong';
  const problem = await newPasswordProblem(next);
  if (problem) return problem;
  await sql`UPDATE users SET password_hash = ${await hashPassword(next)}, updated_at = now() WHERE id = ${userId}`;
  await revokeOthers(userId, keep);
  log('password_changed', { user_id: userId });
  sendMail(u.email, passwordChangedMail(u.locale));
  return 'ok';
}

// « Déconnecter les autres appareils » (ASVS 3.3.4), après mot de passe redemandé
export async function signOutOthers(userId: number, password: string, keep: Buffer): Promise<boolean> {
  if (!(await checkCurrent(userId, password))) return false;
  await revokeOthers(userId, keep);
  log('sessions_revoked', { user_id: userId });
  return true;
}

// Nom et téléphone seulement : l'e-mail est figé (le rôle admin en dépend), un changement se demande par e-mail
export async function updateProfile(userId: number, p: { name: string | null; phone: string | null }): Promise<void> {
  await sql`UPDATE users SET name = ${p.name || null}, phone = ${p.phone || null}, updated_at = now() WHERE id = ${userId}`;
  log('profile_updated', { user_id: userId });
}
