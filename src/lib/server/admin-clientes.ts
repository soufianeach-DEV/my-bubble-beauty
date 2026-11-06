// Fiches clientes (admin) : liste et recherche, fiche avec historique et statistiques, notes, blocage, effacement ; écran du journal.
// Les pages relisent adminId() avant d'appeler ; toute action est journalisée avec l'admin et la cliente.
import { audit, type Result } from './admin.ts';
import { clientForm } from './admin-form.ts';
import { sql } from './db.ts';
import { eraseUser } from './rgpd.ts';
import { isAdminEmail, revokeAll } from './session.ts';

const PAGE = 50;
// Recherche par morceau de texte : % et _ saisis comptent comme des caractères, pas comme des jokers
const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export type ClientFilter = 'actives' | 'suppression' | 'bloquees' | 'toutes';
export type ClientRow = { id: number; name: string | null; email: string; phone: string | null; created_at: Date; deleted_at: Date | null; blocked_at: Date | null; done: number; upcoming: number; no_shows: number; last_at: Date | null };

// Comptes confirmés seulement ; la gérante n'est pas une cliente. Téléphone cherché sur ses seuls chiffres (0484 11 83 95 = 0484118395).
export async function listClients(q: string, filter: ClientFilter, page: number) {
  q = q.trim().slice(0, 100);
  const digits = q.replace(/\D/g, '');
  const rows = await sql<ClientRow[]>`
    SELECT u.id, u.name, u.email, u.phone, u.created_at, u.deleted_at, u.blocked_at,
      count(b.id) FILTER (WHERE b.status = 'confirmed' AND b.starts_at < now() AND NOT b.no_show)::int AS done,
      count(b.id) FILTER (WHERE b.status = 'confirmed' AND b.starts_at >= now())::int AS upcoming,
      count(b.id) FILTER (WHERE b.no_show)::int AS no_shows,
      max(b.starts_at) FILTER (WHERE b.status = 'confirmed' AND b.starts_at < now()) AS last_at
    FROM users u LEFT JOIN bookings b ON b.user_id = u.id
    WHERE u.email_verified_at IS NOT NULL
      AND (${q} = '' OR u.name ILIKE ${like(q)} OR u.email ILIKE ${like(q)}
        OR (${digits.length >= 3} AND regexp_replace(coalesce(u.phone, ''), '[^0-9]', '', 'g') LIKE ${like(digits)}))
      AND CASE ${filter} WHEN 'actives' THEN u.deleted_at IS NULL AND u.blocked_at IS NULL
        WHEN 'suppression' THEN u.deleted_at IS NOT NULL WHEN 'bloquees' THEN u.blocked_at IS NOT NULL ELSE true END
    GROUP BY u.id
    ORDER BY lower(coalesce(u.name, u.email)), u.id
    LIMIT ${PAGE + 1} OFFSET ${Math.max(0, page - 1) * PAGE}`;
  return { rows: rows.filter((r) => !isAdminEmail(r.email)).slice(0, PAGE), more: rows.length > PAGE };
}

export type ClientBooking = { id: number; starts_at: Date; ends_at: Date; service: string; status: string; no_show: boolean; past: boolean; cancel_reason: string | null; price_cents: number; discount_cents: number; deposit_cents: number; refunded_cents: number; paid: boolean; moved: boolean };

export async function clientDetail(id: number) {
  const [u] = await sql<{ id: number; name: string | null; email: string; phone: string | null; locale: string; created_at: Date; email_verified_at: Date | null; deleted_at: Date | null; blocked_at: Date | null; health_consent_at: Date | null; notes: string }[]>`
    SELECT id, name, email, phone, locale, created_at, email_verified_at, deleted_at, blocked_at, health_consent_at, notes FROM users WHERE id = ${id}`;
  if (!u || isAdminEmail(u.email)) return null;
  const [bookings, [stats], events] = await Promise.all([
    sql<ClientBooking[]>`
      SELECT b.id, b.starts_at, b.ends_at, s.name_fr AS service, b.status, b.no_show, b.starts_at < now() AS past, b.cancel_reason,
        b.price_cents, b.discount_cents, b.deposit_cents, b.refunded_cents, b.stripe_payment_intent IS NOT NULL AS paid, b.moved_at IS NOT NULL AS moved
      FROM bookings b JOIN services s ON s.id = b.service_id
      WHERE b.user_id = ${id} AND (b.status <> 'expired' OR b.stripe_payment_intent IS NOT NULL)
      ORDER BY b.starts_at DESC`,
    sql<{ done: number; no_shows: number; cancelled: number; spent_cents: number }[]>`
      SELECT count(*) FILTER (WHERE status = 'confirmed' AND starts_at < now() AND NOT no_show)::int AS done,
        count(*) FILTER (WHERE no_show)::int AS no_shows,
        count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
        coalesce(sum(price_cents - discount_cents) FILTER (WHERE status = 'confirmed' AND starts_at < now() AND NOT no_show), 0)::int AS spent_cents
      FROM bookings WHERE user_id = ${id}`,
    sql<{ action: string; at: Date; ip: string | null; details: Record<string, unknown> }[]>`
      SELECT action, at, ip, details FROM audit_log WHERE client_id = ${id} ORDER BY at DESC LIMIT 30`,
  ]);
  return { user: u, bookings, stats, events };
}

// Actions de la fiche ; l'effacement renvoie key 'efface' (la page repart vers la liste)
export async function clientAction(adminUser: number, form: FormData): Promise<Result> {
  const p = clientForm.safeParse(Object.fromEntries(form));
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? 'Saisie invalide.' };
  const f = p.data;
  const [u] = await sql<{ email: string }[]>`SELECT email FROM users WHERE id = ${f.id}`;
  if (!u || isAdminEmail(u.email)) return { ok: false, error: 'Cliente introuvable.' };
  if (f.action === 'notes') {
    await sql`UPDATE users SET notes = ${f.notes.replace(/\r\n/g, '\n')}, updated_at = now() WHERE id = ${f.id}`;
    // Le contenu des notes n'entre jamais au journal (données de santé possibles)
    audit(adminUser, 'client_notes', { client_id: f.id, length: f.notes.length });
    return { ok: true, id: f.id, key: 'notes' };
  }
  if (f.action === 'block' || f.action === 'unblock') {
    await sql`UPDATE users SET blocked_at = ${f.action === 'block' ? sql`now()` : null}, updated_at = now() WHERE id = ${f.id}`;
    // Bloquée : toutes ses sessions tombent tout de suite (readSession refuse aussi un compte bloqué)
    if (f.action === 'block') await revokeAll(f.id);
    audit(adminUser, f.action === 'block' ? 'client_blocked' : 'client_unblocked', { client_id: f.id });
    return { ok: true, id: f.id, key: f.action };
  }
  // Effacement à la demande de la cliente (téléphone, e-mail) : mêmes effets que depuis son compte
  const gone = await eraseUser(f.id, adminUser, null, 'admin');
  return gone ? { ok: true, id: f.id, key: 'efface' } : { ok: false, error: 'Cliente introuvable.' };
}

// Écran Journal : 100 lignes par page, filtres par action et par cliente
export async function journalList(action: string, clientId: number | null, page: number) {
  const rows = await sql<{ id: number; at: Date; action: string; actor: string | null; client_id: number | null; client: string | null; booking_id: number | null; ip: string | null; details: Record<string, unknown> }[]>`
    SELECT a.id, a.at, a.action, coalesce(ua.name, ua.email) AS actor, a.client_id, coalesce(uc.name, uc.email) AS client, a.booking_id, a.ip, a.details
    FROM audit_log a LEFT JOIN users ua ON ua.id = a.actor_id LEFT JOIN users uc ON uc.id = a.client_id
    WHERE (${action} = '' OR a.action = ${action}) AND (${clientId}::bigint IS NULL OR a.client_id = ${clientId})
    ORDER BY a.at DESC, a.id DESC
    LIMIT 101 OFFSET ${Math.max(0, page - 1) * 100}`;
  return { rows: rows.slice(0, 100), more: rows.length > 100 };
}
