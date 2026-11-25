// Avis déposé sur le site depuis l'espace cliente : un par rendez-vous confirmé, passé et honoré, relu par identifiant ET cliente connectée.
// La page de merci propose ensuite de le publier sur Google, à toutes les clientes quelle que soit la note (pas de tri des avis).
import { sql } from './db.ts';
import { journal } from './journal.ts';
import type { Lang } from '../site.ts';

export type SiteReview = { rating: number; comment: string };
export type ReviewableBooking = { id: number; service: string; starts_at: Date; review: SiteReview | null };

// Rendez-vous de cette cliente, honoré ; null pour celui d'une autre, à venir, annulé ou manqué
export async function reviewableBooking(userId: number, bookingId: number, lang: Lang): Promise<ReviewableBooking | null> {
  const [b] = await sql<{ id: number; service: string; starts_at: Date; rating: number | null; comment: string | null }[]>`
    SELECT b.id, CASE ${lang} WHEN 'nl' THEN s.name_nl WHEN 'en' THEN s.name_en ELSE s.name_fr END AS service, b.starts_at, r.rating, r.comment
    FROM bookings b JOIN services s ON s.id = b.service_id LEFT JOIN site_reviews r ON r.booking_id = b.id
    WHERE b.id = ${bookingId} AND b.user_id = ${userId} AND b.status = 'confirmed' AND b.starts_at < now() AND NOT b.no_show`;
  if (!b) return null;
  return { id: b.id, service: b.service, starts_at: b.starts_at, review: b.rating === null ? null : { rating: b.rating, comment: b.comment ?? '' } };
}

// Admin « Avis du site » : lecture seule, plus récents d'abord, 50 par page ; seen = déjà vu par l'équipe avant cet affichage
export type AdminSiteReview = { id: number; created_at: Date; rating: number; comment: string; client_id: number; client: string | null; service: string; starts_at: Date; seen: boolean };
export async function adminSiteReviews(page: number): Promise<{ rows: AdminSiteReview[]; more: boolean }> {
  const rows = await sql<AdminSiteReview[]>`
    SELECT r.id, r.created_at, r.rating, r.comment, r.user_id AS client_id, coalesce(nullif(u.name, ''), u.email) AS client,
      s.name_fr AS service, b.starts_at, r.seen_at IS NOT NULL AS seen
    FROM site_reviews r JOIN users u ON u.id = r.user_id JOIN bookings b ON b.id = r.booking_id JOIN services s ON s.id = b.service_id
    ORDER BY r.created_at DESC, r.id DESC LIMIT 51 OFFSET ${(page - 1) * 50}`;
  return { rows: rows.slice(0, 50), more: rows.length > 50 };
}
export async function unseenSiteReviews(): Promise<number> {
  const [r] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM site_reviews WHERE seen_at IS NULL`;
  return r.n;
}
// Jusqu'au plus récent affiché : un avis arrivé pendant l'affichage reste « nouveau »
export async function markSiteReviewsSeen(upToId: number): Promise<void> {
  await sql`UPDATE site_reviews SET seen_at = now() WHERE seen_at IS NULL AND id <= ${upToId}`;
}

// false : rendez-vous non éligible ou avis déjà déposé
export async function saveSiteReview(userId: number, bookingId: number, rating: number, comment: string): Promise<boolean> {
  const rows = await sql`
    INSERT INTO site_reviews (user_id, booking_id, rating, comment)
    SELECT ${userId}, b.id, ${rating}, ${comment} FROM bookings b
    WHERE b.id = ${bookingId} AND b.user_id = ${userId} AND b.status = 'confirmed' AND b.starts_at < now() AND NOT b.no_show
    ON CONFLICT (booking_id) DO NOTHING RETURNING id`;
  if (rows.length) void journal('avis_site', { actor: userId, client: userId, booking: bookingId, details: { note: rating } });
  return rows.length > 0;
}
