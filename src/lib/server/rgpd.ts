// Droits de la cliente sur son compte (RGPD art. 15, 17, 20 et 9.2.a) : suppression douce de 30 jours, réactivation,
// effacement définitif, export de ses données et accord pour les données de santé. Les rendez-vous ne sont jamais effacés :
// ceux d'un compte effacé restent pour la comptabilité, sans lien vers la personne (user_id NULL, client_erased).
import type { AstroCookies } from 'astro';
import type { Sql } from 'postgres';
import type { Lang } from '../site.ts';
import { checkCurrent } from './accounts.ts';
import { sql } from './db.ts';
import { journal } from './journal.ts';
import { log } from './log.ts';
import { accountDeletedMail, accountErasedMail, sendMail } from './mail.ts';
import { closeSession, isAdminEmail } from './session.ts';
import { PASSWORD_PEPPER } from 'astro:env/server';
import { openText } from './totp.ts';
import { openHealth, readableProfile } from './profil.ts';
import { expireSession } from './stripe.ts';

export const GRACE_DAYS = 30;

type Cancelled = { id: number; was: string; stripe_session_id: string | null; due: boolean };

// Rendez-vous à venir annulés (motif account_deleted). L'acompte payé n'est pas rendu par le site : l'institut le rembourse
// hors ligne et le note dans l'agenda (« Marquer comme remboursé »). Les paiements en cours voient leur session Stripe fermée.
async function cancelFuture(tx: Sql, userId: number): Promise<Cancelled[]> {
  return tx<Cancelled[]>`
    WITH old AS (SELECT id, status FROM bookings WHERE user_id = ${userId} AND status IN ('pending_payment', 'confirmed') AND starts_at > now() FOR UPDATE)
    UPDATE bookings k SET status = 'cancelled', cancelled_at = now(), cancel_reason = 'account_deleted' FROM old WHERE k.id = old.id
    RETURNING k.id, old.status AS was, k.stripe_session_id, (k.stripe_payment_intent IS NOT NULL AND k.deposit_cents > k.refunded_cents) AS due`;
}

function afterCancel(rows: Cancelled[], actor: number | null, client: number | null) {
  for (const r of rows) {
    if (r.was === 'pending_payment' && r.stripe_session_id) expireSession(r.stripe_session_id).catch((e) => log('stripe_expire_failed', { session: r.stripe_session_id, error: String(e) }));
    journal('booking_cancelled', { actor, client, booking: r.id, details: { by: 'account_deleted', refund_due: r.due } });
  }
}

export type DeleteResult = 'ok' | 'wrong' | 'admin';

// La gérante et l'équipe ne suppriment pas leur compte elles-mêmes : l'admin leur retire d'abord le rôle
const staffAccount = async (user: { id: number; email: string }) =>
  isAdminEmail(user.email) || (await sql`SELECT 1 FROM users WHERE id = ${user.id} AND role IS NOT NULL`).length > 0;

// Suppression demandée par la cliente (mot de passe redemandé) : compte inutilisable sauf pour revenir dans les 30 jours,
// toutes ses sessions fermées, rendez-vous à venir annulés.
export async function deleteAccount(cookies: AstroCookies, user: { id: number; email: string }, password: string, ip: string): Promise<DeleteResult> {
  if (await staffAccount(user)) return 'admin';
  const u = await checkCurrent(user.id, password);
  if (!u) return 'wrong';
  const rows = await sql.begin(async (tx) => {
    await tx`SELECT id FROM users WHERE id = ${user.id} FOR UPDATE`;
    await tx`UPDATE users SET deleted_at = now(), updated_at = now() WHERE id = ${user.id} AND deleted_at IS NULL`;
    const cancelled = await cancelFuture(tx, user.id);
    await tx`DELETE FROM sessions WHERE user_id = ${user.id}`;
    return cancelled;
  });
  await closeSession(cookies);
  afterCancel(rows, user.id, user.id);
  journal('account_deleted', { actor: user.id, client: user.id, ip, details: { cancelled: rows.length, refund_due: rows.filter((r) => r.due).length } });
  sendMail(u.email, accountDeletedMail(u.locale, GRACE_DAYS, rows.length, rows.some((r) => r.due)));
  return 'ok';
}

// Retour dans les 30 jours : le compte redevient normal ; les rendez-vous annulés le restent
export async function reactivate(userId: number, ip: string): Promise<boolean> {
  const [r] = await sql`UPDATE users SET deleted_at = NULL, updated_at = now()
    WHERE id = ${userId} AND deleted_at > now() - make_interval(days => ${GRACE_DAYS}) RETURNING id`;
  if (r) journal('account_reactivated', { actor: userId, client: userId, ip });
  return !!r;
}

// Effacement : rendez-vous à venir annulés, rendez-vous gardés sans lien vers la personne, compte supprimé.
// Sessions, liens d'e-mail et notes partent avec la ligne ; le journal garde l'action sans le numéro de la cliente (SET NULL).
export async function eraseUser(clientId: number, actor: number | null, ip: string | null, why: 'self' | 'admin' | 'purge'): Promise<{ email: string; locale: Lang } | null> {
  const r = await sql.begin(async (tx) => {
    const [u] = await tx<{ email: string; locale: Lang; role: string | null }[]>`SELECT email, locale, role FROM users WHERE id = ${clientId} FOR UPDATE`;
    if (!u || isAdminEmail(u.email) || u.role) return null;
    const cancelled = await cancelFuture(tx, clientId);
    await tx`UPDATE bookings SET client_erased = true WHERE user_id = ${clientId}`;
    // Ligne de journal dans la même transaction, avant la suppression : client_id passe ensuite à NULL (SET NULL)
    const by = actor === clientId ? null : actor;
    // Adresses IP liées à la cliente retirées du journal : l'action reste, plus rien ne mène à elle
    await tx`UPDATE audit_log SET ip = NULL WHERE client_id = ${clientId} OR actor_id = ${clientId}`;
    await tx`INSERT INTO audit_log (action, actor_id, client_id, ip, details)
      VALUES ('account_erased', ${by}, ${clientId}, NULL, ${tx.json({ by: why, cancelled: cancelled.length })})`;
    await tx`DELETE FROM users WHERE id = ${clientId}`;
    return { u, cancelled };
  });
  if (!r) return null;
  log('account_erased', { by: why, actor });
  // La cliente n'existe plus : les lignes d'annulation ne la désignent pas
  afterCancel(r.cancelled, actor === clientId ? null : actor, null);
  return r.u;
}

// Effacement tout de suite par la cliente (depuis son compte ou la page de réactivation), mot de passe redemandé
export async function eraseNow(cookies: AstroCookies, user: { id: number; email: string }, password: string, ip: string): Promise<DeleteResult> {
  if (await staffAccount(user)) return 'admin';
  if (!(await checkCurrent(user.id, password))) return 'wrong';
  const gone = await eraseUser(user.id, user.id, ip, 'self');
  await closeSession(cookies);
  if (gone) sendMail(gone.email, accountErasedMail(gone.locale));
  return 'ok';
}

// Accord pour les données de santé (allergies, contre-indications) notées par l'institut ; retirable à tout moment
export async function setConsent(userId: number, give: boolean, ip: string) {
  const [r] = give
    ? await sql`UPDATE users SET health_consent_at = now() WHERE id = ${userId} AND health_consent_at IS NULL RETURNING id`
    // Accord retiré : les antécédents médicaux notés par l'institut sont effacés avec lui
    : await sql`UPDATE users SET health_consent_at = NULL, medical_history = NULL, health_profile = NULL WHERE id = ${userId} AND health_consent_at IS NOT NULL RETURNING id`;
  if (r) journal(give ? 'consent_given' : 'consent_withdrawn', { actor: userId, client: userId, ip });
}

// Accès et portabilité (art. 15 et 20) : tout ce que le site garde sur la cliente, notes de l'institut comprises
export async function exportData(userId: number, ip: string) {
  const [[account], bookings, sessions, events, linked, consents, loyalty, gifts] = await Promise.all([
    sql`SELECT email, name, phone, locale, created_at, email_verified_at, health_consent_at, notes AS institute_notes, birth_date::text, medical_history, care_profile, health_profile FROM users WHERE id = ${userId}`,
    sql`SELECT s.name_fr AS service, b.starts_at, b.ends_at, b.status, b.no_show, b.price_cents, b.discount_cents, b.deposit_cents, b.refunded_cents,
          p.code AS promo_code, b.created_at, b.cancelled_at, b.moved_at, b.zone, pr.name AS practitioner
        FROM bookings b JOIN services s ON s.id = b.service_id LEFT JOIN promo_codes p ON p.id = b.promo_code_id
          LEFT JOIN users pr ON pr.id = b.practitioner_id
        WHERE b.user_id = ${userId} ORDER BY b.starts_at`,
    sql`SELECT user_agent, created_at, last_seen_at FROM sessions WHERE user_id = ${userId} ORDER BY created_at`,
    // L'IP d'un essai sur son compte appartient à quelqu'un d'autre : seule la sienne (actions qu'elle a faites) est donnée
    sql`SELECT action, at, CASE WHEN actor_id = ${userId} THEN ip END AS ip FROM audit_log WHERE client_id = ${userId} ORDER BY at`,
    // Comptes Google ou Microsoft liés : identifiant du fournisseur et date du lien
    sql`SELECT provider, subject, created_at FROM user_identities WHERE user_id = ${userId} ORDER BY created_at`,
    // Consentements signés : texte exact, nom saisi, date et canal (le sien, donc rendu tel quel)
    sql`SELECT kind, version, signer_name, mention, specialist, channel, signed_at, ip, user_agent, text FROM consents WHERE user_id = ${userId} ORDER BY signed_at`,
    // Avantages de fidélité reçus, avec la date du rendez-vous qui les a portés
    sql`SELECT r.kind, r.percent, r.amount_cents, r.sessions, r.used_at, b.starts_at AS booking_starts_at
        FROM loyalty_rewards r LEFT JOIN bookings b ON b.id = r.booking_id WHERE r.user_id = ${userId} ORDER BY r.used_at`,
    // Bons cadeaux rattachés à la cliente : code masqué (4 derniers caractères), un export qui circule ne doit pas valoir un bon
    sql`SELECT '…' || right(g.code, 4) AS code_end, s.name_fr AS service, g.recipient, g.message, g.issued_on::text, g.expires_on::text,
          g.used_at, g.cancelled_at FROM gift_cards g JOIN services s ON s.id = g.service_id WHERE g.user_id = ${userId} ORDER BY g.created_at`,
  ]);
  journal('data_exported', { actor: userId, client: userId, ip });
  // Antécédents médicaux : déchiffrés pour la cliente elle-même
  if (account) account.medical_history = account.medical_history ? openText(PASSWORD_PEPPER, 'health', account.medical_history) : null;
  // Fiche de soin avec des libellés lisibles ; la partie santé déchiffrée pour la cliente elle-même
  if (account) {
    account.care_sheet = readableProfile(account.care_profile ?? {}, openHealth(account.health_profile));
    delete account.care_profile;
    delete account.health_profile;
  }
  return { exported_at: new Date().toISOString(), controller: 'My Bubble Beauty', account, linked_accounts: linked, bookings, consents, loyalty_rewards: loyalty, gift_cards: gifts, sessions, security_log: events };
}
