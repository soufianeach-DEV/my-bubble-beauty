// Accueil de l'admin : la journée de la gérante (horaires, temps libre, fiches des clientes du jour), charge du mois et alertes.
// Lecture seule, uniquement ce que la base contient déjà : aucune donnée nouvelle n'est collectée ni déduite.
import { sql } from './db.ts';
import { isDay } from './pricing.ts';

// Bornes d'un jour de Bruxelles ('AAAA-MM-JJ'), changements d'heure compris (Postgres convertit)
const bounds = (day: string) => sql`
  SELECT ${day}::text::date AS day, ${day}::text::date::timestamp AT TIME ZONE 'Europe/Brussels' AS lo,
    (${day}::text::date + 1)::timestamp AT TIME ZONE 'Europe/Brussels' AS hi`;

// Plages d'ouverture du jour, fermetures qui le touchent, minutes encore libres
export async function dayFrame(day: string) {
  if (!isDay(day)) return { hours: [], closures: [], freeMin: 0 };
  const [hours, closures, freeMin] = await Promise.all([
    sql<{ opens: string; closes: string }[]>`
      SELECT to_char(opens, 'HH24:MI') AS opens, to_char(closes, 'HH24:MI') AS closes FROM opening_hours
      WHERE weekday = extract(isodow FROM ${day}::text::date) ORDER BY opens`,
    sql<{ starts_at: Date; ends_at: Date; reason: string }[]>`
      WITH d AS (${bounds(day)})
      SELECT c.starts_at, c.ends_at, c.reason FROM closures c, d WHERE c.starts_at < d.hi AND c.ends_at > d.lo ORDER BY c.starts_at`,
    freeMinutes(day),
  ]);
  return { hours, closures, freeMin };
}

// Ouverture − rendez-vous actifs − fermetures, à partir de maintenant pour le jour en cours (même découpage que slots.ts)
export async function freeMinutes(day: string): Promise<number> {
  if (!isDay(day)) return 0;
  const [r] = await sql<{ min: number }[]>`
    WITH d AS (${bounds(day)}),
    o AS (
      SELECT coalesce(range_agg(tstzrange((d.day + h.opens) AT TIME ZONE 'Europe/Brussels', (d.day + h.closes) AT TIME ZONE 'Europe/Brussels'))
        FILTER (WHERE h.id IS NOT NULL), '{}') AS r
      FROM d LEFT JOIN opening_hours h ON h.weekday = extract(isodow FROM d.day)
    ),
    b AS (
      SELECT coalesce(range_agg(r), '{}') AS r FROM (
        SELECT tstzrange(k.starts_at, k.ends_at) AS r FROM bookings k, d WHERE k.starts_at < d.hi AND k.ends_at > d.lo
          AND (k.status = 'confirmed' OR (k.status = 'pending_payment' AND k.created_at > now() - interval '35 minutes'))
        UNION ALL
        SELECT tstzrange(c.starts_at, c.ends_at) FROM closures c, d WHERE c.starts_at < d.hi AND c.ends_at > d.lo
      ) x
    )
    SELECT coalesce(sum(extract(epoch FROM upper(f) - lower(f))) / 60, 0)::int AS min
    FROM d, o, b, unnest((o.r - b.r) * tstzmultirange(tstzrange(greatest(now(), d.lo), d.hi))) f`;
  return r?.min ?? 0;
}

export type ClientCard = {
  id: number; name: string | null; email: string; phone: string | null; created_at: Date; notes: string; health_consent_at: Date | null;
  visits: number; no_shows: number; last_visit: Date | null; services: string[];
};

// Fiches des clientes avec compte qui viennent ce jour-là. Visite = rendez-vous confirmé avant ce jour, absences à part.
export function clientCards(day: string) {
  if (!isDay(day)) return Promise.resolve([] as ClientCard[]);
  return sql<ClientCard[]>`
    WITH d AS (${bounds(day)}),
    ids AS (
      SELECT DISTINCT k.user_id AS id FROM bookings k, d
      WHERE k.user_id IS NOT NULL AND k.starts_at >= d.lo AND k.starts_at < d.hi AND k.status IN ('confirmed', 'pending_payment')
    ),
    past AS (
      SELECT k.user_id, k.starts_at, k.no_show, s.name_fr FROM bookings k JOIN services s ON s.id = k.service_id, d
      WHERE k.user_id IN (SELECT id FROM ids) AND k.status = 'confirmed' AND k.starts_at < d.lo
    )
    SELECT u.id, u.name, u.email, u.phone, u.created_at, u.notes, u.health_consent_at,
      (SELECT count(*) FROM past p WHERE p.user_id = u.id AND NOT p.no_show)::int AS visits,
      (SELECT count(*) FROM past p WHERE p.user_id = u.id AND p.no_show)::int AS no_shows,
      (SELECT max(p.starts_at) FROM past p WHERE p.user_id = u.id AND NOT p.no_show) AS last_visit,
      array(SELECT p.name_fr FROM past p WHERE p.user_id = u.id AND NOT p.no_show GROUP BY p.name_fr ORDER BY max(p.starts_at) DESC LIMIT 5) AS services
    FROM users u WHERE u.id IN (SELECT id FROM ids) ORDER BY u.name`;
}

// Rendez-vous actifs par jour de Bruxelles, de from (inclus) à to (exclu), 62 jours au plus
export async function loadByDay(from: string, to: string): Promise<Record<string, number>> {
  if (!isDay(from) || !isDay(to)) return {};
  const rows = await sql<{ day: string; n: number }[]>`
    SELECT to_char((starts_at AT TIME ZONE 'Europe/Brussels')::date, 'YYYY-MM-DD') AS day, count(*)::int AS n FROM bookings
    WHERE status IN ('confirmed', 'pending_payment')
      AND starts_at >= ${from}::text::date::timestamp AT TIME ZONE 'Europe/Brussels'
      AND starts_at < least(${to}::text::date, ${from}::text::date + 62)::timestamp AT TIME ZONE 'Europe/Brussels'
    GROUP BY 1`;
  return Object.fromEntries(rows.map((r) => [r.day, r.n]));
}

type Row = { id: number; starts_at: Date; service: string; name: string | null; user_id: number | null };
const COLS = sql`b.id, b.starts_at, s.name_fr AS service, coalesce(u.name, b.guest_name) AS name, b.user_id`;
const FROM = sql`FROM bookings b JOIN services s ON s.id = b.service_id LEFT JOIN users u ON u.id = b.user_id`;

// Alertes du tableau de bord : seulement des faits présents en base, sur une fenêtre courte
export async function alerts(adminEmail: string) {
  const [pending, moved, cancelled, newClients, noDuration, closures] = await Promise.all([
    // Paiement en ligne commencé, pas encore confirmé (le créneau est tenu 35 min)
    sql<Row[]>`SELECT ${COLS} ${FROM} WHERE b.status = 'pending_payment' AND b.created_at > now() - interval '35 minutes' ORDER BY b.starts_at`,
    // Déplacés depuis 48 h, encore à venir
    sql<(Row & { moved_at: Date })[]>`
      SELECT ${COLS}, b.moved_at ${FROM} WHERE b.status = 'confirmed' AND b.moved_at > now() - interval '48 hours' AND b.starts_at > now() ORDER BY b.starts_at`,
    sql<(Row & { cancelled_at: Date; cancel_reason: string | null })[]>`
      SELECT ${COLS}, b.cancelled_at, b.cancel_reason ${FROM} WHERE b.status = 'cancelled' AND b.cancelled_at > now() - interval '48 hours' ORDER BY b.cancelled_at DESC`,
    // Inscrites depuis 7 jours, adresse confirmée, hors gérante, équipe et comptes supprimés
    sql<{ id: number; name: string | null; email: string; created_at: Date }[]>`
      SELECT id, name, email, created_at FROM users
      WHERE created_at > now() - interval '7 days' AND email_verified_at IS NOT NULL AND deleted_at IS NULL AND removed_at IS NULL AND role IS NULL AND email <> ${adminEmail.trim().toLowerCase()}
      ORDER BY created_at DESC`,
    // Sans durée, une prestation ne peut pas s'ouvrir à la réservation en ligne
    sql<{ id: number; name: string }[]>`SELECT id, name_fr AS name FROM services WHERE duration_min IS NULL AND retired_at IS NULL ORDER BY sort, id`,
    sql<{ starts_at: Date; ends_at: Date; reason: string }[]>`
      SELECT starts_at, ends_at, reason FROM closures WHERE ends_at > now() AND starts_at < now() + interval '30 days' ORDER BY starts_at`,
  ]);
  return { pending, moved, cancelled, newClients, noDuration, closures };
}
