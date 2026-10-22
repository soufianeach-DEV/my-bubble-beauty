// Authentification : argon2id poivré, vérification à temps constant, limites de tentatives, code TOTP de l'admin.
import { hash, verify } from '@node-rs/argon2';
import { ADMIN_TOTP_SECRET, PASSWORD_PEPPER } from 'astro:env/server';
import { deviceToken, isDevice } from './cookie.ts';
import { sql } from './db.ts';
import { log } from './log.ts';
import { badEmail, isPwned, passwordProblem } from './password.ts';
import { blocked, forget, hit } from './rate.ts';
import { verifyTotp } from './totp.ts';

// Défauts de @node-rs/argon2 = argon2id m=19456 t=2 p=1 (minimum OWASP). Le poivre vit hors de la base : le perdre invalide tous les mots de passe.
const opts = { secret: Buffer.from(PASSWORD_PEPPER) };
let dummy: Promise<string> | undefined;

export const hashPassword = (password: string) => hash(password, opts);

// Une adresse inconnue coûte le même calcul qu'une adresse connue (hash factice) : le délai ne trahit aucun compte
export async function verifyPassword(stored: string | null | undefined, password: string): Promise<boolean> {
  const ok = await verify(stored ?? (await (dummy ??= hash('compte-inexistant', opts))), password, opts).catch(() => false);
  return ok && !!stored;
}

// Nouveau mot de passe : à appeler avant de chercher l'adresse, pour qu'inscription libre ou prise répondent pareil et au même rythme
export async function newPasswordProblem(password: string): Promise<'short' | 'long' | 'pwned' | null> {
  return passwordProblem(password) ?? ((await isPwned(password)) ? 'pwned' : null);
}

export type LoginUser = { id: number; email: string; locale: 'fr' | 'nl' | 'en' };

// Valeur du cookie d'appareil pour cette adresse (posé par signIn après une connexion réussie)
export const deviceCookie = (email: string) => deviceToken(PASSWORD_PEPPER, email);

// Un seul échec visible de l'extérieur : identifiants faux, compte non vérifié ou limite atteinte. L'adresse saisie n'est pas journalisée.
// device : cookie d'appareil de la requête ; valide pour l'adresse, il dispense du verrou par e-mail, jamais des limites par couple et par IP.
export async function login(email: string, password: string, ip: string, device?: string | null): Promise<LoginUser | null> {
  if (hit('loginIp', ip)) {
    log('login_locked', { ip });
    return null;
  }
  email = email.trim().toLowerCase();
  if (badEmail(email)) {
    log('login_failed', { user_id: null, ip });
    return null;
  }
  const pair = `${email}\n${ip}`;
  // Essais comptés avant tout await : une rafale concurrente ne passe plus entre lecture et incrément. Un succès efface le couple.
  // Cookie d'appareil plafonné lui aussi : 10 essais sous ce cookie et il ne dispense plus du verrou par e-mail
  const trusted = isDevice(PASSWORD_PEPPER, email, device) && !hit('loginDevice', email);
  const overPair = hit('loginPair', pair), overEmail = hit('loginEmail', email);
  if (overPair || (!trusted && overEmail)) {
    log('login_locked', { ip });
    return null;
  }
  const [u] = await sql`SELECT id, email, locale, password_hash, email_verified_at FROM users WHERE email = ${email}`;
  const ok = await verifyPassword(u?.password_hash, password);
  if (!ok) {
    log('login_failed', { user_id: u?.id ?? null, ip });
    return null;
  }
  if (!u.email_verified_at) {
    log('login_unverified', { user_id: u.id, ip });
    return null;
  }
  forget('loginPair', pair);
  log('login_ok', { user_id: u.id, ip });
  return { id: u.id, email: u.email, locale: u.locale };
}

// Après une réinitialisation réussie : la propriétaire de l'adresse retrouve l'accès tout de suite
export function clearLoginLimits(email: string) {
  email = email.trim().toLowerCase();
  forget('loginPair', email);
  forget('loginEmail', email);
  forget('loginDevice', email);
}

// Code de l'appli d'authentification : ±1 pas, rejeu refusé (le pas doit dépasser le dernier accepté), essais limités comme la connexion
// ip : celle de la requête, pour remonter une attaque sur le second facteur (le login_ok de la session peut venir d'ailleurs)
export async function checkAdminCode(userId: number, code: string, ip: string): Promise<boolean> {
  const id = String(userId);
  if (blocked('totp', id)) {
    log('totp_locked', { user_id: userId, ip });
    return false;
  }
  const step = verifyTotp(ADMIN_TOTP_SECRET, code);
  const [row] = step === null ? [] : await sql`UPDATE users SET totp_last_step = ${step} WHERE id = ${userId} AND totp_last_step < ${step} RETURNING id`;
  if (!row) {
    hit('totp', id);
    log('totp_failed', { user_id: userId, ip });
    return false;
  }
  forget('totp', id);
  log('totp_ok', { user_id: userId, ip });
  return true;
}
