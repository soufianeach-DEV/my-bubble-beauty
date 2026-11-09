// Journal d'audit : une ligne en base (table audit_log, 12 mois) et la même sur stdout. Jamais de mot de passe ni de jeton.
// L'écriture ne fait jamais échouer l'action journalisée : un échec est seulement signalé sur stdout.
import { sql } from './db.ts';
import { log } from './log.ts';

const SECRET_KEY = /pass|token|secret|cookie|authorization/i;

export type Entry = { actor?: number | null; client?: number | null; booking?: number | null; ip?: string | null; details?: Record<string, unknown> };

export function journal(action: string, e: Entry = {}): Promise<void> {
  const details = Object.fromEntries(Object.entries(e.details ?? {}).filter(([k]) => !SECRET_KEY.test(k)));
  log(action, { user_id: e.actor ?? null, client_id: e.client ?? null, booking_id: e.booking ?? null, ip: e.ip ?? null, ...details });
  return sql`
    INSERT INTO audit_log (action, actor_id, client_id, booking_id, ip, details)
    VALUES (${action}, ${e.actor ?? null}, ${e.client ?? null}, ${e.booking ?? null}, ${e.ip?.slice(0, 64) ?? null}, ${sql.json(details as never)})`
    .then(() => undefined, (err) => log('journal_failed', { action, error: String(err) }));
}

// Libellés de l'écran Journal ; une action absente s'affiche telle quelle
export const ACTION_LABELS: Record<string, string> = {
  client_care_profile: 'Fiche de soin remplie par la cliente',
  login_ok: 'Connexion',
  login_failed: 'Connexion refusée',
  login_blocked: "Connexion d'un compte bloqué",
  register: 'Inscription',
  email_verified: 'Adresse confirmée',
  password_reset: 'Mot de passe réinitialisé',
  password_changed: 'Mot de passe changé',
  sessions_revoked: 'Autres appareils déconnectés',
  profile_updated: 'Coordonnées modifiées',
  consent_given: 'Accord données de santé donné',
  consent_withdrawn: 'Accord données de santé retiré',
  data_exported: 'Export des données',
  account_deleted: 'Compte supprimé (30 jours)',
  account_reactivated: 'Compte réactivé',
  account_erased: 'Compte effacé définitivement',
  booking_created: 'Rendez-vous réservé',
  booking_cancelled: 'Rendez-vous annulé',
  booking_moved: 'Rendez-vous déplacé',
  totp_ok: 'Code admin accepté',
  totp_failed: 'Code admin refusé',
  totp_trusted: 'Code admin évité (appareil de confiance)',
  totp_forgotten: 'Appareil de confiance oublié',
  admin_denied: 'Accès admin refusé',
  admin_action: "Action de l'admin",
};
