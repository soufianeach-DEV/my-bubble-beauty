// Tableau de bord de l'admin : chiffres de l'activité sur une période, en lecture seule.
// Montants en centimes. « Réalisé » = rendez-vous confirmé, déjà terminé, cliente venue.
import { ADMIN_EMAIL } from 'astro:env/server';
import { sql } from './db.ts';

export const PERIODS = [7, 30, 90, 365] as const;
export type Period = (typeof PERIODS)[number];
export const toPeriod = (v: string | null): Period => ((PERIODS as readonly number[]).includes(Number(v)) ? (Number(v) as Period) : 30);

export type Kpis = {
  revenue: number; done: number; noShows: number; upcoming: number; upcomingRevenue: number;
  created: number; cancelled: number; newClients: number; visits: number; pageViews: number;
};

export async function metrics(days: Period) {
  // Montant encaissé au salon s'il est noté, sinon prix moins remise et remboursement
  const net = sql`coalesce(b.paid_cents, b.price_cents - b.discount_cents - b.refunded_cents)`;
  const admin = ADMIN_EMAIL.trim().toLowerCase();
  // Même calcul sur la période et sur la précédente (from et to en jours avant maintenant), pour afficher l'évolution
  const kpis = (fromDays: number, toDays: number) => {
    const from = sql`now() - make_interval(days => ${fromDays})`;
    const to = sql`now() - make_interval(days => ${toDays})`;
    return sql<Kpis[]>`
    SELECT
      coalesce(sum(${net}) FILTER (WHERE b.status = 'confirmed' AND NOT b.no_show AND b.starts_at >= ${from} AND b.ends_at < ${to}), 0)::int AS revenue,
      count(*) FILTER (WHERE b.status = 'confirmed' AND NOT b.no_show AND b.starts_at >= ${from} AND b.ends_at < ${to})::int AS done,
      count(*) FILTER (WHERE b.status = 'confirmed' AND b.no_show AND b.starts_at >= ${from} AND b.starts_at < ${to})::int AS "noShows",
      count(*) FILTER (WHERE b.status = 'confirmed' AND b.starts_at >= now())::int AS upcoming,
      coalesce(sum(${net}) FILTER (WHERE b.status = 'confirmed' AND b.starts_at >= now()), 0)::int AS "upcomingRevenue",
      count(*) FILTER (WHERE b.status IN ('confirmed', 'cancelled') AND b.created_at >= ${from} AND b.created_at < ${to})::int AS created,
      count(*) FILTER (WHERE b.status = 'cancelled' AND b.created_at >= ${from} AND b.created_at < ${to})::int AS cancelled,
      (SELECT count(*)::int FROM users u WHERE u.email_verified_at IS NOT NULL AND u.email <> ${admin} AND u.role IS NULL
         AND u.created_at >= ${from} AND u.created_at < ${to}) AS "newClients",
      -- Visites = visiteurs distincts de chaque jour, additionnés (l'empreinte change chaque jour, db/visits.mjs)
      (SELECT count(*)::int FROM site_visits v WHERE v.day > (${from})::date AND v.day <= (${to})::date) AS visits,
      (SELECT coalesce(sum(v.views), 0)::int FROM site_visits v WHERE v.day > (${from})::date AND v.day <= (${to})::date) AS "pageViews"
    FROM bookings b`;
  };
  const since = sql`now() - make_interval(days => ${days})`;
  const [[now], [before], top, months] = await Promise.all([
    kpis(days, 0),
    kpis(days * 2, days),
    sql<{ name: string; n: number; revenue: number }[]>`
      SELECT s.name_fr AS name, count(*)::int AS n, coalesce(sum(${net}), 0)::int AS revenue
      FROM bookings b JOIN services s ON s.id = b.service_id
      WHERE b.status = 'confirmed' AND NOT b.no_show AND b.starts_at >= ${since} AND b.ends_at < now()
      GROUP BY s.id, s.name_fr ORDER BY n DESC, revenue DESC LIMIT 8`,
    // 6 derniers mois civils, mois en cours compris (fuseau de la connexion : Bruxelles)
    sql<{ month: string; n: number; revenue: number; visits: number }[]>`
      SELECT to_char(m, 'YYYY-MM') AS month, count(b.id)::int AS n, coalesce(sum(${net}), 0)::int AS revenue,
        (SELECT count(*)::int FROM site_visits v WHERE v.day >= m::date AND v.day < (m + interval '1 month')::date) AS visits
      FROM generate_series(date_trunc('month', now()) - interval '5 months', date_trunc('month', now()), interval '1 month') m
      LEFT JOIN bookings b ON b.status = 'confirmed' AND NOT b.no_show AND b.ends_at < now()
        AND b.starts_at >= m AND b.starts_at < m + interval '1 month'
      GROUP BY m ORDER BY m`,
  ]);
  return { now, before, top, months };
}

// Variation en % par rapport à la période précédente ; null sans base de comparaison
export const delta = (cur: number, prev: number) => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null);
export const rate = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 100) : null);
