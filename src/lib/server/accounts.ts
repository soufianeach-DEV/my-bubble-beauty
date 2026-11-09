// Parcours de compte : inscription, vérification, connexion, mot de passe oublié ou changé, sessions, profil, code de l'admin.
// Les pages valident d'abord les champs (Zod : e-mail ≤ 254, nom ≤ 100, téléphone ≤ 30) ; ici, les règles de sécurité.
import type { AstroCookies } from 'astro';
import type { Lang } from '../site.ts';
import { checkAdminCode, clearLoginLimits, deviceCookie, hashPassword, login, newPasswordProblem, verifyPassword, type LoginUser } from './auth.ts';
import { DEVICE, DEVICE_COOKIE, hashToken, newToken } from './cookie.ts';
import { sql } from './db.ts';
import { journal } from './journal.ts';
import { log } from './log.ts';
import { existsMail, loginLinkMail, passwordChangedMail, resetMail, sendMail, verifyMail, type Mail } from './mail.ts';
import type { Identity } from './oidc.ts';
import { badEmail } from './password.ts';
import { blocked, hit } from './rate.ts';
import { isAdminEmail, openSession, revokeOthers, type SessionUser } from './session.ts';
import { confirmTotp, totpState } from './staff.ts';

export type PasswordProblem = 'short' | 'long' | 'pwned';

// Inscription et oubli écrivent à une adresse saisie : 3 e-mails par heure et par adresse, 20 par IP, puis silence derrière la même réponse.
// L'IP est comptée d'abord : au-delà de son quota, elle ne crée plus de compteur par adresse inventée.
const mailAllowed = (email: string, ip: string) => !hit('mailIp', ip) && !hit('mailTo', email);

// Jeton d'e-mail créé puis envoyé sans être attendu : la réponse ne trahit pas l'existence du compte
function mailWithToken(userId: number, email: string, purpose: 'verify' | 'reset' | 'login', minutes: number, mail: (token: string) => Mail) {
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
    journal('register', { actor: u.id, client: u.id, ip: input.ip });
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
  journal('email_verified', { actor: u.id, client: u.id, ip });
  await openSession(cookies, u.id, userAgent);
  return { id: u.id, email: u.email, locale: u.locale };
}

// Connexion : message unique en cas d'échec (null). mfaRequired : rediriger vers /admin/code, la session n'ouvre pas /admin sans le code.
// Lit puis pose le cookie d'appareil : la page de connexion n'a rien d'autre à faire.
// remember (« Se souvenir de moi ») ignoré pour l'équipe : sa session reste courte et le code TOTP la remplace de toute façon.
export async function signIn(cookies: AstroCookies, email: string, password: string, ip: string, userAgent: string | null, remember = false): Promise<(LoginUser & { mfaRequired: boolean }) | null> {
  const u = await login(email, password, ip, cookies.get(DEVICE_COOKIE)?.value);
  if (!u) return null;
  const [r] = await sql<{ role: string | null }[]>`SELECT role FROM users WHERE id = ${u.id}`;
  const admin = isAdminEmail(u.email) || !!r?.role;
  await openSession(cookies, u.id, userAgent, false, remember && !admin);
  cookies.set(DEVICE_COOKIE, deviceCookie(u.email), DEVICE);
  return { ...u, mfaRequired: admin };
}

// Code de l'appli d'authentification (anti-rejeu par totp_last_step) ; la session est tournée et porte mfa_at.
// Premier code d'une personne de l'équipe : il valide aussi le secret affiché pendant l'enregistrement.
export async function verifyAdminTotp(cookies: AstroCookies, user: SessionUser, code: string, userAgent: string | null, ip: string): Promise<boolean> {
  const state = await totpState(user);
  if (!state || state.kind === 'expired' || !(await checkAdminCode(user.id, state.secret, code.trim(), ip))) return false;
  if (state.kind === 'enrol') await confirmTotp(user.id);
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
  const [u] = await sql`SELECT id FROM users WHERE email = ${email} AND removed_at IS NULL`;
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
  journal('password_reset', { actor: u.id, client: u.id });
  sendMail(u.email, passwordChangedMail(u.locale));
  return 'ok';
}

// Mot de passe actuel redemandé, essais comptés comme la connexion (100 par heure et par compte)
export async function checkCurrent(userId: number, password: string) {
  const [u] = await sql<{ email: string; locale: Lang; password_hash: string }[]>`SELECT email, locale, password_hash FROM users WHERE id = ${userId}`;
  // Essai compté avant l'await : une rafale concurrente ne passe plus entre lecture et incrément
  if (!u || hit('loginEmail', u.email) || !(await verifyPassword(u.password_hash, password))) {
    log('password_check_failed', { user_id: userId });
    return null;
  }
  return u;
}

// Changement depuis le compte : les autres appareils sont déconnectés, un avis part par e-mail. keep = Astro.locals.session.hash
export async function changePassword(userId: number, current: string, next: string, keep: Buffer): Promise<'ok' | 'wrong' | PasswordProblem> {
  const u = await checkCurrent(userId, current);
  if (!u) return 'wrong';
  const problem = await newPasswordProblem(next);
  if (problem) return problem;
  await sql`UPDATE users SET password_hash = ${await hashPassword(next)}, updated_at = now() WHERE id = ${userId}`;
  await revokeOthers(userId, keep);
  journal('password_changed', { actor: userId, client: userId });
  sendMail(u.email, passwordChangedMail(u.locale));
  return 'ok';
}

// « Déconnecter les autres appareils » (ASVS 3.3.4), après mot de passe redemandé
export async function signOutOthers(userId: number, password: string, keep: Buffer): Promise<boolean> {
  if (!(await checkCurrent(userId, password))) return false;
  await revokeOthers(userId, keep);
  journal('sessions_revoked', { actor: userId, client: userId });
  return true;
}

// Nom et téléphone seulement : l'e-mail est figé (le rôle admin en dépend), un changement se demande par e-mail
export async function updateProfile(userId: number, p: { name: string | null; phone: string | null }): Promise<void> {
  await sql`UPDATE users SET name = ${p.name || null}, phone = ${p.phone || null}, updated_at = now() WHERE id = ${userId}`;
  journal('profile_updated', { actor: userId, client: userId });
}

// --- Connexion sans mot de passe : Google, Microsoft, lien par e-mail ---------------------------------------------------------
// Jamais pour la gérante : son compte exige mot de passe + code de l'appli d'authentification.

type Tx = Parameters<Parameters<typeof sql.begin>[0]>[0];

// Compte créé avec cette adresse mais jamais confirmé : quelqu'un d'autre a pu en choisir le mot de passe. La personne qui vient de
// prouver l'adresse prend le compte : mot de passe remplacé par un aléatoire (« mot de passe oublié » en donne un), sessions et liens tombent.
async function claimUnverified(tx: Tx, userId: number) {
  const fresh = await hashPassword(newToken());
  await tx`UPDATE users SET password_hash = ${fresh}, email_verified_at = now(), updated_at = now() WHERE id = ${userId}`;
  await tx`DELETE FROM sessions WHERE user_id = ${userId}`;
  await tx`UPDATE email_tokens SET used_at = now() WHERE user_id = ${userId} AND used_at IS NULL`;
}

// Dernières vérifications puis session : bloqué, supprimé par l'admin ou depuis plus de 30 jours = même échec que les autres.
// Un compte en suppression (moins de 30 jours) ouvre la session : le middleware l'envoie vers « Réactiver ».
async function finishSignIn(cookies: AstroCookies, userId: number, via: string, ip: string, userAgent: string | null): Promise<LoginUser | null> {
  const [u] = await sql<{ id: number; email: string; locale: Lang; blocked: boolean; gone: boolean }[]>`
    SELECT id, email, locale, blocked_at IS NOT NULL AS blocked, (deleted_at IS NOT NULL AND deleted_at <= now() - interval '30 days') OR removed_at IS NOT NULL AS gone
    FROM users WHERE id = ${userId}`;
  if (!u || u.gone || isAdminEmail(u.email)) return null;
  if (u.blocked) {
    journal('login_blocked', { client: u.id, ip, details: { via } });
    return null;
  }
  journal('login_ok', { actor: u.id, client: u.id, ip, details: { via } });
  await openSession(cookies, u.id, userAgent);
  return { id: u.id, email: u.email, locale: u.locale };
}

// Retour de Google ou Microsoft. Ordre : identité déjà liée ; sinon compte de même adresse (adresse garantie par le fournisseur
// seulement) ; sinon nouveau compte, adresse tenue pour vérifiée. Le lien (fournisseur, sujet) ne dépend plus ensuite de l'adresse.
export async function signInExternal(cookies: AstroCookies, who: Identity, lang: Lang, ip: string, userAgent: string | null): Promise<LoginUser | null> {
  if (hit('loginIp', ip)) {
    log('login_locked', { ip });
    return null;
  }
  if (isAdminEmail(who.email)) {
    log('oauth_admin_refused', { provider: who.provider, ip });
    return null;
  }
  const userId = await sql.begin(async (tx) => {
    const [linked] = await tx<{ user_id: number }[]>`SELECT user_id FROM user_identities WHERE provider = ${who.provider} AND subject = ${who.subject}`;
    if (linked) return linked.user_id;
    if (!who.emailVerified || badEmail(who.email)) {
      log('oauth_email_unverified', { provider: who.provider, ip });
      return null;
    }
    const [u] = await tx<{ id: number; verified: boolean }[]>`SELECT id, email_verified_at IS NOT NULL AS verified FROM users WHERE email = ${who.email} FOR UPDATE`;
    let id = u?.id;
    if (u && !u.verified) await claimUnverified(tx, u.id);
    if (!u) {
      const [n] = await tx<{ id: number }[]>`
        INSERT INTO users (email, password_hash, name, locale, email_verified_at)
        VALUES (${who.email}, ${await hashPassword(newToken())}, ${who.name}, ${lang}, now()) RETURNING id`;
      id = n.id;
      journal('register', { actor: id, client: id, ip, details: { via: who.provider } });
    }
    await tx`INSERT INTO user_identities (provider, subject, user_id) VALUES (${who.provider}, ${who.subject}, ${id!}) ON CONFLICT DO NOTHING`;
    return id!;
  });
  if (!userId) return null;
  return finishSignIn(cookies, userId, who.provider, ip, userAgent);
}

// « Recevoir un lien de connexion » : rien n'est dit sur l'existence du compte, mêmes limites d'envoi que l'inscription.
// Lien de 15 minutes à usage unique ; aucun pour la gérante.
export async function requestLoginLink(email: string, lang: Lang, ip: string): Promise<void> {
  email = email.trim().toLowerCase();
  if (badEmail(email) || isAdminEmail(email)) return;
  if (!mailAllowed(email, ip)) {
    log('login_link_limited', { ip });
    return;
  }
  const [u] = await sql<{ id: number }[]>`SELECT id FROM users WHERE email = ${email} AND blocked_at IS NULL AND removed_at IS NULL`;
  log('login_link_requested', { user_id: u?.id ?? null, ip });
  if (u) mailWithToken(u.id, email, 'login', 15, (t) => loginLinkMail(lang, t));
}

// POST de /compte/lien : le jeton est consommé ici, jamais par un simple GET (les antivirus de messagerie ouvrent les liens)
export async function signInWithLink(cookies: AstroCookies, token: string, ip: string, userAgent: string | null): Promise<LoginUser | null> {
  if (hit('loginIp', ip)) {
    log('login_locked', { ip });
    return null;
  }
  const userId = await sql.begin(async (tx) => {
    const [t] = await tx<{ user_id: number }[]>`UPDATE email_tokens SET used_at = now()
      WHERE token_hash = ${hashToken(token)} AND purpose = 'login' AND used_at IS NULL AND expires_at > now() RETURNING user_id`;
    if (!t) return null;
    const [u] = await tx<{ verified: boolean }[]>`SELECT email_verified_at IS NOT NULL AS verified FROM users WHERE id = ${t.user_id} FOR UPDATE`;
    if (u && !u.verified) await claimUnverified(tx, t.user_id);
    return t.user_id;
  });
  if (!userId) {
    log('login_link_invalid', { ip });
    return null;
  }
  return finishSignIn(cookies, userId, 'lien', ip, userAgent);
}
