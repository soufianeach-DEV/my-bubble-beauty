// Avis Google : mail de demande après la prestation, désinscription, et copie des avis de la fiche pour la section de l'Accueil.
// Source des avis : API Business Profile (accès propriétaire, tous les avis). L'API Places n'est pas utilisée : ses règles
// interdisent de garder une copie des avis, et elle n'en rend que 5 choisis par Google.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { GBP_CLIENT_ID, GBP_CLIENT_SECRET, GBP_LOCATION, GBP_REFRESH_TOKEN, PASSWORD_PEPPER, SITE_URL } from 'astro:env/server';
import { FOLDER, type Lang } from '../site.ts';
import { deliver, type Sender } from './booking.ts';
import { sql } from './db.ts';
import { log } from './log.ts';
import { reviewReminderMail, reviewRequestMail, sendMailNow } from './mail.ts';

// Lien de désinscription sans connexion : HMAC de l'identifiant (clé dérivée du poivre, propre à cet usage)
const sign = (userId: number) => createHmac('sha256', PASSWORD_PEPPER).update(`avis-desinscription:${userId}`).digest('base64url').slice(0, 32);
export const unsubscribeUrl = (lang: Lang, userId: number) => `${SITE_URL}/${FOLDER[lang]}/compte/avis-desinscription?u=${userId}&s=${sign(userId)}`;

export function checkUnsubscribe(u: string | null, s: string | null): number | null {
  const id = Number(u);
  if (!Number.isSafeInteger(id) || id <= 0 || !s) return null;
  const want = Buffer.from(sign(id));
  const got = Buffer.from(s);
  return got.length === want.length && timingSafeEqual(got, want) ? id : null;
}

// Lien « Laisser un avis » du mail : passe par /avis/<jeton> (un jeton signé par rendez-vous) qui note le clic puis renvoie vers
// Google. Un clic évite la relance. Limite : un antivirus de messagerie qui ouvre les liens compte comme un clic.
const signClick = (bookingId: number) => createHmac('sha256', PASSWORD_PEPPER).update(`avis-clic:${bookingId}`).digest('base64url').slice(0, 22);
export const reviewToken = (bookingId: number) => `${bookingId}.${signClick(bookingId)}`;
export const clickUrl = (bookingId: number) => `${SITE_URL}/avis/${reviewToken(bookingId)}`;

export function checkReviewToken(token: string | undefined): number | null {
  const m = /^(\d{1,15})\.([A-Za-z0-9_-]{22})$/.exec(token ?? '');
  if (!m) return null;
  const id = Number(m[1]);
  const want = Buffer.from(signClick(id));
  return timingSafeEqual(Buffer.from(m[2]), want) ? id : null;
}

// Premier clic seulement ; true si le jeton est valable
export async function recordClick(token: string | undefined): Promise<boolean> {
  const id = checkReviewToken(token);
  if (!id) return false;
  await sql`UPDATE bookings SET review_clicked_at = now() WHERE id = ${id} AND review_clicked_at IS NULL`;
  return true;
}

export async function optOutReviews(userId: number): Promise<void> {
  await sql`UPDATE users SET review_mail_optout_at = now() WHERE id = ${userId} AND review_mail_optout_at IS NULL`;
  log('review_mail_optout', { user_id: userId });
}

// Rendez-vous honoré (confirmé, non absente) : demande 24 h après la fin, relance 48 h après si la demande est partie.
// Toutes les clientes reçoivent le même mail, sans filtre sur la satisfaction (Google interdit de ne solliciter que les avis positifs).
// Désinscription : coupe la demande et la relance. Plusieurs rendez-vous à moins de 24 h d'écart : un seul mail (et une relance).
// Pas de relance si la cliente a cliqué sur le lien du mail, ou si un avis à son nom a été trouvé (matchReviews).
export async function sendReviewRequests(reviewUrl: string | undefined, send: Sender = sendMailNow): Promise<number> {
  if (!reviewUrl) return 0;
  type Row = { id: number; user_id: number; email: string; locale: Lang; name: string | null };
  const first = await sql<Row[]>`
    SELECT DISTINCT ON (b.user_id) b.id, b.user_id, u.email, u.locale, u.name
    FROM bookings b JOIN users u ON u.id = b.user_id
    WHERE b.status = 'confirmed' AND NOT b.no_show AND b.review_request_sent_at IS NULL
      AND u.blocked_at IS NULL AND u.removed_at IS NULL AND u.deleted_at IS NULL AND u.review_mail_optout_at IS NULL
      AND b.ends_at <= now() - interval '24 hours' AND b.ends_at > now() - interval '48 hours'
      AND NOT EXISTS (SELECT 1 FROM bookings o WHERE o.user_id = b.user_id AND o.id <> b.id AND o.review_request_sent_at IS NOT NULL
        AND o.ends_at > b.ends_at - interval '24 hours' AND o.ends_at < b.ends_at + interval '24 hours')
    ORDER BY b.user_id, b.ends_at DESC`;
  const again = await sql<Row[]>`
    SELECT b.id, b.user_id, u.email, u.locale, u.name
    FROM bookings b JOIN users u ON u.id = b.user_id
    WHERE b.status = 'confirmed' AND NOT b.no_show AND b.review_reminder_sent_at IS NULL
      AND b.review_request_sent_at <= now() - interval '20 hours' AND b.review_clicked_at IS NULL AND b.review_found_at IS NULL
      AND u.blocked_at IS NULL AND u.removed_at IS NULL AND u.deleted_at IS NULL AND u.review_mail_optout_at IS NULL
      AND b.ends_at <= now() - interval '48 hours' AND b.ends_at > now() - interval '5 days'`;
  return (await deliver(first.map((r) => ({ id: r.id, email: r.email, mail: reviewRequestMail(r.locale, clickUrl(r.id), unsubscribeUrl(r.locale, r.user_id), r.name) })), 'review_request_sent_at', send))
    + (await deliver(again.map((r) => ({ id: r.id, email: r.email, mail: reviewReminderMail(r.locale, clickUrl(r.id), unsubscribeUrl(r.locale, r.user_id), r.name) })), 'review_reminder_sent_at', send));
}

type GbpReview = { reviewId: string; reviewer?: { displayName?: string; isAnonymous?: boolean }; starRating?: string; comment?: string; createTime: string; updateTime: string };
type GbpPage = { reviews?: GbpReview[]; averageRating?: number; totalReviewCount?: number; nextPageToken?: string };
const STARS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
// Google ajoute la traduction automatique au texte d'origine : seul l'original est gardé
const original = (c = '') => c.split('\n\n(Translated by Google)')[0].replace(/^\(Original\)\n/, '').trim();

export const googleConfigured = () => !!(GBP_CLIENT_ID && GBP_CLIENT_SECRET && GBP_REFRESH_TOKEN && GBP_LOCATION);

// Recopie tous les avis de la fiche (50 par page, 20 pages au plus) puis efface ceux que Google ne rend plus.
// Rien n'est touché en cas d'erreur : la section garde les avis du dernier rafraîchissement réussi.
export async function refreshGoogleReviews(fetchFn: typeof fetch = fetch): Promise<number | null> {
  if (!googleConfigured()) return null;
  try {
    const tok = await fetchFn('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id: GBP_CLIENT_ID!, client_secret: GBP_CLIENT_SECRET!, refresh_token: GBP_REFRESH_TOKEN! }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!tok.ok) throw new Error(`token HTTP ${tok.status}`);
    const { access_token } = (await tok.json()) as { access_token: string };
    const all: GbpReview[] = [];
    let meta: GbpPage = {};
    let pageToken = '';
    for (let i = 0; i < 20; i++) {
      const q = new URLSearchParams({ pageSize: '50', orderBy: 'updateTime desc', ...(pageToken ? { pageToken } : {}) });
      const res = await fetchFn(`https://mybusiness.googleapis.com/v4/${GBP_LOCATION}/reviews?${q}`, { headers: { Authorization: `Bearer ${access_token}` }, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`reviews HTTP ${res.status}`);
      const page = (await res.json()) as GbpPage;
      if (i === 0) meta = page;
      all.push(...(page.reviews ?? []));
      if (!page.nextPageToken) break;
      pageToken = page.nextPageToken;
    }
    const rows = all.filter((r) => STARS[r.starRating ?? '']).map((r) => ({
      review_id: r.reviewId,
      author: (r.reviewer?.isAnonymous ? '' : r.reviewer?.displayName?.trim()) || 'Google',
      rating: STARS[r.starRating!],
      comment: original(r.comment),
      created_at: new Date(r.createTime),
      updated_at: new Date(r.updateTime),
    }));
    await sql.begin(async (tx) => {
      if (rows.length) await tx`INSERT INTO google_reviews ${tx(rows)} ON CONFLICT (review_id) DO UPDATE SET author = excluded.author, rating = excluded.rating,
        comment = excluded.comment, created_at = excluded.created_at, updated_at = excluded.updated_at, fetched_at = now()`;
      await tx`DELETE FROM google_reviews WHERE NOT (review_id = ANY(${rows.map((r) => r.review_id)}::text[]))`;
      const value = { average: meta.averageRating ?? null, total: meta.totalReviewCount ?? rows.length, synced_at: new Date().toISOString() };
      await tx`INSERT INTO settings (key, value) VALUES ('google_reviews', ${tx.json(value)}) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now()`;
    });
    const found = await matchReviews();
    log('google_reviews_synced', { count: rows.length, matched: found });
    return rows.length;
  } catch (e) {
    log('google_reviews_failed', { error: String(e) });
    return null;
  }
}

// Nom comparé sans accents, casse ni ponctuation, mots dans n'importe quel ordre. Prénom et nom exigés des deux côtés :
// « Sarah », « Sarah B. » ou un avis anonyme ne correspondent à rien.
const words = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().split(/[^\p{L}]+/u).filter(Boolean).sort();
export function sameName(clientName: string | null, author: string): boolean {
  const a = words(author);
  const c = words(clientName ?? '');
  return a.length >= 2 && a.every((w) => w.length >= 2) && a.join(' ') === c.join(' ');
}

// Avis publié après un rendez-vous dont la demande est partie (30 derniers jours) : rattaché au rendez-vous si le nom affiché
// correspond à une seule cliente de toute la base. Homonymes ou plusieurs rendez-vous possibles : rien n'est marqué.
export async function matchReviews(): Promise<number> {
  const [reviews, users, bookings] = await Promise.all([
    sql<{ review_id: string; author: string; created_at: Date }[]>`
      SELECT review_id, author, created_at FROM google_reviews r WHERE created_at > now() - interval '35 days'
        AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.review_found_id = r.review_id)`,
    sql<{ id: number; name: string | null }[]>`SELECT id, name FROM users WHERE name IS NOT NULL`,
    sql<{ id: number; user_id: number; ends_at: Date }[]>`
      SELECT id, user_id, ends_at FROM bookings WHERE review_request_sent_at IS NOT NULL AND review_found_at IS NULL
        AND ends_at > now() - interval '30 days' ORDER BY ends_at DESC`,
  ]);
  let found = 0;
  for (const r of reviews) {
    const who = users.filter((u) => sameName(u.name, r.author));
    if (who.length !== 1) continue;
    const b = bookings.find((x) => x.user_id === who[0].id && x.ends_at < r.created_at);
    if (!b) continue;
    const done = await sql`UPDATE bookings SET review_found_at = ${r.created_at}, review_found_id = ${r.review_id} WHERE id = ${b.id} AND review_found_at IS NULL`;
    if (done.count) {
      found++;
      bookings.splice(bookings.indexOf(b), 1);
    }
  }
  return found;
}

// Rafraîchi au plus toutes les 2 heures, quel que soit le nombre d'appels (minuterie interne et timer du VPS)
export async function refreshIfDue(fetchFn: typeof fetch = fetch): Promise<number | null> {
  if (!googleConfigured()) return null;
  const [due] = await sql<{ due: boolean }[]>`
    SELECT coalesce((SELECT (value->>'synced_at')::timestamptz < now() - interval '2 hours' FROM settings WHERE key = 'google_reviews'), true) AS due`;
  return due.due ? refreshGoogleReviews(fetchFn) : null;
}

export type ReviewsView = { average: number | null; total: number; reviews: { author: string; rating: number; text: string; date: string }[] };

// Section de l'Accueil : les 6 avis les plus récents qui ont un texte, toutes notes confondues (aucun tri des avis négatifs)
export async function latestReviews(): Promise<ReviewsView | null> {
  const [meta] = await sql<{ value: { average: number | null; total: number } }[]>`SELECT value FROM settings WHERE key = 'google_reviews'`;
  if (!meta) return null;
  const rows = await sql<{ author: string; rating: number; comment: string; created_at: Date }[]>`
    SELECT author, rating, comment, created_at FROM google_reviews WHERE comment <> '' ORDER BY created_at DESC LIMIT 6`;
  if (!rows.length) return null;
  return { average: meta.value.average, total: meta.value.total, reviews: rows.map((r) => ({ author: r.author, rating: r.rating, text: r.comment, date: r.created_at.toISOString() })) };
}
