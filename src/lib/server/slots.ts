// Créneaux libres : plages d'ouverture du jour moins rendez-vous actifs et fermetures (multirange), au pas de 15 min, de 2 h à 60 jours.
// Deux plages contiguës (9-12 et 12-18) se fondent : un soin à 11:45 reste proposé. Heures locales converties par Postgres (changements d'heure).
import type { Sql } from 'postgres';
import type { Lang } from '../site.ts';
import { sql } from './db.ts';
import { isDay } from './pricing.ts';

export type Slot = { at: Date; label: string };

// Même requête pour l'affichage (day) et pour le POST (at) : un début forgé (de nuit, hors grille, trop proche, prestation fermée) n'en sort pas.
// Les paiements en cours de la cliente (userId) ne l'occupent pas : createBooking les expire avant de réserver (retour d'un Checkout abandonné)
function free(q: Sql, serviceId: number, day: string | null, at: Date | null, userId: number | null) {
  return q<Slot[]>`
    WITH d AS (
      SELECT day, day::timestamp AT TIME ZONE 'Europe/Brussels' AS lo, (day + 1)::timestamp AT TIME ZONE 'Europe/Brussels' AS hi
      FROM (SELECT coalesce(${day}::text::date, (${at}::timestamptz AT TIME ZONE 'Europe/Brussels')::date) AS day) x
    ),
    s AS (SELECT make_interval(mins => duration_min) AS len FROM services WHERE id = ${serviceId} AND active),
    o AS (
      SELECT range_agg(tstzrange((d.day + h.opens) AT TIME ZONE 'Europe/Brussels', (d.day + h.closes) AT TIME ZONE 'Europe/Brussels')) AS r
      FROM d JOIN opening_hours h ON h.weekday = extract(isodow FROM d.day)
    ),
    b AS (
      SELECT coalesce(range_agg(r), '{}') AS r FROM (
        SELECT tstzrange(k.starts_at, k.ends_at) AS r FROM bookings k, d
        WHERE k.starts_at < d.hi AND k.ends_at > d.lo
          AND (k.status = 'confirmed' OR (k.status = 'pending_payment' AND k.created_at > now() - interval '35 minutes' AND k.user_id IS DISTINCT FROM ${userId}))
        UNION ALL
        SELECT tstzrange(c.starts_at, c.ends_at) FROM closures c, d WHERE c.starts_at < d.hi AND c.ends_at > d.lo
      ) busy
    )
    SELECT t AS at, to_char(t AT TIME ZONE 'Europe/Brussels', 'HH24:MI') AS label
    FROM d, s, o, b, generate_series(d.lo, d.hi - s.len, interval '15 minutes') t
    WHERE (o.r - b.r) @> tstzrange(t, t + s.len)
      AND t >= now() + interval '2 hours' AND t <= now() + interval '60 days'
      AND (${at}::timestamptz IS NULL OR t = ${at}::timestamptz)
    ORDER BY t`;
}

// Créneaux d'un jour ('AAAA-MM-JJ', heure de Bruxelles) ; label 'HH:MM' local (deux fois 02:xx le jour du passage à l'heure d'hiver, at les distingue)
export async function slots(serviceId: number, day: string, userId: number | null = null): Promise<Slot[]> {
  return Number.isInteger(serviceId) && isDay(day) ? free(sql, serviceId, day, null, userId) : [];
}

// Contrôle du début demandé au POST, dans la transaction de réservation (après expiration des paiements abandonnés)
export async function isFree(q: Sql, serviceId: number, at: Date, userId: number | null = null): Promise<boolean> {
  return !Number.isNaN(at.getTime()) && (await free(q, serviceId, null, at, userId)).length === 1;
}

// Étape 1 de la réservation : prestations ouvertes, dans la langue de la page
export function bookableServices(lang: Lang) {
  return sql<{ id: number; slug: string; category: string; name: string; duration_min: number; price_cents: number; deposit_cents: number }[]>`
    SELECT id, slug, category, CASE ${lang} WHEN 'nl' THEN name_nl WHEN 'en' THEN name_en ELSE name_fr END AS name, duration_min, price_cents, deposit_cents
    FROM services WHERE active ORDER BY sort, id`;
}
