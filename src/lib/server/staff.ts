// Équipe de l'institut : rôles admin et gestionnaire donnés à des comptes confirmés, second facteur propre à chaque personne,
// désactivation et suppression par l'admin. La gérante (ADMIN_EMAIL) est super-admin : ni rétrogradée, ni désactivée, ni supprimée.
// Les pages relisent adminId() avant d'appeler staffAction ; toute action est journalisée avec l'auteur et le compte visé.
import { ADMIN_EMAIL, ADMIN_TOTP_SECRET, PASSWORD_PEPPER } from 'astro:env/server';
import { audit, type Result } from './admin.ts';
import { staffForm } from './admin-form.ts';
import { sql } from './db.ts';
import { isAdminEmail, revokeAll, type Role } from './session.ts';
import { newTotpSecret, openSecret, sealSecret } from './totp.ts';

// Délai pour enregistrer l'application d'authentification après le rôle donné (ou relancé par l'admin)
export const ENROL_DAYS = 7;
export const ROLE_LABELS: Record<Role, string> = { super: 'Super-admin', admin: 'Admin', gestionnaire: 'Gestionnaire' };
const ISSUER = 'My Bubble Beauty';

// relogin : session ouverte avant le rôle ; la clé ne s'affiche qu'après une connexion par mot de passe faite depuis
export type TotpState = { kind: 'ready'; secret: string } | { kind: 'enrol'; secret: string; until: Date; uri: string } | { kind: 'expired' } | { kind: 'relogin' };

// Second facteur de la personne connectée. enrol : secret encore jamais validé, affiché sur /admin/code pendant 7 jours.
// Le secret de la gérante reste ADMIN_TOTP_SECRET ; celui de l'équipe est en base, chiffré.
export async function totpState(user: { id: number; email: string; role: Role | null }, sessionAt: Date): Promise<TotpState | null> {
  if (!user.role) return null;
  if (user.role === 'super') return { kind: 'ready', secret: ADMIN_TOTP_SECRET };
  const [u] = await sql<{ totp_secret: Buffer | null; confirmed: boolean; open: boolean; until: Date; fresh: boolean }[]>`
    SELECT totp_secret, totp_confirmed_at IS NOT NULL AS confirmed, ${sessionAt}::timestamptz > role_at AS fresh, role_at > now() - make_interval(days => ${ENROL_DAYS}) AS open,
      role_at + make_interval(days => ${ENROL_DAYS}) AS until
    FROM users WHERE id = ${user.id} AND role IS NOT NULL`;
  if (!u) return null;
  const known = u.totp_secret && openSecret(PASSWORD_PEPPER, u.totp_secret);
  if (u.confirmed) return known ? { kind: 'ready', secret: known } : { kind: 'expired' };
  if (!u.open) return { kind: 'expired' };
  if (!u.fresh) return { kind: 'relogin' };
  let secret = known;
  if (!secret) {
    secret = newTotpSecret();
    // Deux onglets à la fois : seul le premier secret écrit reste (comparaison avec la valeur lue), l'autre page relit
    const [w] = await sql`UPDATE users SET totp_secret = ${sealSecret(PASSWORD_PEPPER, secret)}
      WHERE id = ${user.id} AND totp_confirmed_at IS NULL AND totp_secret IS NOT DISTINCT FROM ${u.totp_secret} RETURNING id`;
    if (!w) return totpState(user, sessionAt);
  }
  const label = encodeURIComponent(`${ISSUER}:${user.email}`);
  return { kind: 'enrol', secret, until: u.until, uri: `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(ISSUER)}` };
}

// Premier code juste : le secret devient celui de la personne
export const confirmTotp = (userId: number) => sql`UPDATE users SET totp_confirmed_at = now() WHERE id = ${userId} AND totp_confirmed_at IS NULL`;

export type StaffRow = { id: number; name: string | null; email: string; role: Role; role_at: Date | null; blocked_at: Date | null; removed_at: Date | null; totp_confirmed_at: Date | null; enrol_until: Date | null; last_login: Date | null };

// La gérante d'abord, puis l'équipe active, puis les comptes désactivés ou supprimés
export function listStaff() {
  const admin = ADMIN_EMAIL.trim().toLowerCase();
  return sql<StaffRow[]>`
    SELECT id, name, email, CASE WHEN email = ${admin} THEN 'super' ELSE role END AS role, role_at, blocked_at, removed_at, totp_confirmed_at,
      CASE WHEN role_at > now() - make_interval(days => ${ENROL_DAYS}) THEN role_at + make_interval(days => ${ENROL_DAYS}) END AS enrol_until,
      (SELECT max(at) FROM audit_log a WHERE a.actor_id = users.id AND a.action = 'login_ok') AS last_login
    FROM users
    WHERE email_verified_at IS NOT NULL AND (role IS NOT NULL OR email = ${admin})
    ORDER BY email = ${admin} DESC, (blocked_at IS NOT NULL OR removed_at IS NOT NULL), lower(coalesce(name, email)), id`;
}

const err = (error: string): Result => ({ ok: false, error });
const label = (r: 'admin' | 'gestionnaire') => ROLE_LABELS[r].toLowerCase();

export async function staffAction(actor: number, form: FormData): Promise<Result> {
  const p = staffForm.safeParse(Object.fromEntries(form));
  if (!p.success) return err(p.error.issues[0]?.message ?? 'Saisie invalide.');
  const f = p.data;

  if (f.action === 'grant') {
    const [u] = await sql<{ id: number; email: string; role: 'admin' | 'gestionnaire' | null; verified: boolean; off: boolean }[]>`
      SELECT id, email, role, email_verified_at IS NOT NULL AS verified, blocked_at IS NOT NULL OR removed_at IS NOT NULL OR deleted_at IS NOT NULL AS off
      FROM users WHERE email = ${f.email}`;
    if (!u) return err("Aucun compte avec cette adresse. La personne crée d'abord son compte sur le site, puis confirme son adresse.");
    if (isAdminEmail(u.email)) return err('Cette adresse est celle de la gérante : elle a déjà tous les droits.');
    if (u.id === actor) return err('Vous ne pouvez pas changer votre propre rôle.');
    if (!u.verified) return err("Ce compte n'a pas encore confirmé son adresse e-mail.");
    if (u.off) return err('Ce compte est désactivé, supprimé ou en suppression : réactivez-le avant de lui donner un rôle.');
    if (u.role === f.role) return err(`Ce compte est déjà ${label(f.role)}.`);
    if (u.role) await sql`UPDATE users SET role = ${f.role}, updated_at = now() WHERE id = ${u.id}`;
    // Nouveau dans l'équipe : 7 jours pour enregistrer son application d'authentification
    else await sql`UPDATE users SET role = ${f.role}, role_at = now(), totp_secret = NULL, totp_confirmed_at = NULL, totp_last_step = 0, updated_at = now() WHERE id = ${u.id}`;
    // Sessions ouvertes avant le rôle fermées : un cookie de cliente volé ne voit ni la clé ni l'administration
    await revokeAll(u.id);
    audit(actor, u.role ? 'staff_role_changed' : 'staff_role_given', { client_id: u.id, role: f.role, before: u.role });
    return { ok: true, id: u.id, key: 'grant' };
  }

  // Actions sur une ligne de l'équipe : jamais sur soi-même ni sur la gérante
  if (f.id === actor) return err('Vous ne pouvez pas agir sur votre propre compte.');
  const [u] = await sql<{ id: number; email: string; role: 'admin' | 'gestionnaire' | null }[]>`SELECT id, email, role FROM users WHERE id = ${f.id}`;
  if (u && isAdminEmail(u.email)) return err('Le compte de la gérante ne peut pas être modifié.');
  if (!u?.role) return err("Ce compte ne fait pas partie de l'équipe.");

  switch (f.action) {
    case 'role':
      if (u.role === f.role) return err(`Ce compte est déjà ${label(f.role)}.`);
      await sql`UPDATE users SET role = ${f.role}, updated_at = now() WHERE id = ${u.id}`;
      await revokeAll(u.id);
      audit(actor, 'staff_role_changed', { client_id: u.id, role: f.role, before: u.role });
      break;
    case 'demote':
      // Redevient une cliente : rôle et second facteur retirés ; ses sessions tombent (elles portaient le code admin)
      await sql`UPDATE users SET role = NULL, role_at = NULL, totp_secret = NULL, totp_confirmed_at = NULL, updated_at = now() WHERE id = ${u.id}`;
      await revokeAll(u.id);
      audit(actor, 'staff_role_removed', { client_id: u.id, before: u.role });
      break;
    case 'block':
    case 'unblock':
      await setBlocked(actor, u.id, f.action === 'block');
      break;
    case 'remove':
    case 'restore':
      await setRemoved(actor, u.id, f.action === 'remove');
      break;
    case 'reset_totp':
      // Téléphone perdu ou délai dépassé : nouveau secret à enregistrer dans les 7 jours, sessions fermées
      await sql`UPDATE users SET role_at = now(), totp_secret = NULL, totp_confirmed_at = NULL, totp_last_step = 0, updated_at = now() WHERE id = ${u.id}`;
      await revokeAll(u.id);
      audit(actor, 'staff_totp_reset', { client_id: u.id });
      break;
  }
  return { ok: true, id: u.id, key: f.action };
}

// Désactiver : plus de connexion (readSession et login lisent blocked_at), sessions fermées tout de suite ; réactivable
export async function setBlocked(actor: number, id: number, on: boolean) {
  await sql`UPDATE users SET blocked_at = ${on ? sql`now()` : null}, updated_at = now() WHERE id = ${id}`;
  if (on) await revokeAll(id);
  audit(actor, on ? 'account_disabled' : 'account_enabled', { client_id: id });
}

// Supprimer (suppression douce) : compte masqué des listes, connexion refusée, sessions fermées. Adresse gardée (restauration sans
// conflit d'unicité) ; rendez-vous, notes et journal restent. La purge des 30 jours ne s'applique pas : seule l'admin restaure.
export async function setRemoved(actor: number, id: number, on: boolean) {
  await sql`UPDATE users SET removed_at = ${on ? sql`now()` : null}, updated_at = now() WHERE id = ${id}`;
  if (on) await revokeAll(id);
  audit(actor, on ? 'account_removed' : 'account_restored', { client_id: id });
}
