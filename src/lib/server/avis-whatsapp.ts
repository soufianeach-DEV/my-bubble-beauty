// Demande d'avis Google par WhatsApp, depuis l'agenda admin : aucun envoi côté serveur.
// Le clic note la demande puis ouvre wa.me avec le message prêt ; Souade appuie elle-même sur Envoyer.
// Une seule demande par cliente (compte ou numéro), même si elle revient.
import { sql } from './db.ts';
import { journal } from './journal.ts';
import { ASK_EVERY } from './avis.ts';
import type { Lang } from '../site.ts';

// Numéro international sans « + » ni espaces ; même règle que wa_digits() en base (migration 030)
export function waDigits(phone: string | null | undefined): string | null {
  const d = (phone ?? '').replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('00')) return d.slice(2) || null;
  if (d.startsWith('0')) return `32${d.slice(1)}`;
  return d;
}

const firstName = (name: string | null | undefined) => name?.trim().split(/\s+/)[0] ?? '';

// Français : modèle de Souade mot pour mot (tutoiement, emojis, apostrophes typographiques), lien Google seul sur la dernière ligne
const FR = (n: string, url: string) => `Coucou ma chère${n ? ` ${n}` : ''} ❤️

J’espère que tu vas bien ! 🥰

Si tu as quelques petites minutes, cela me ferait énormément plaisir que tu puisses laisser un petit avis sur Google concernant ton expérience chez moi. Ton retour compte beaucoup pour moi et m’aide énormément à faire connaître mon travail.

Un grand merci pour ta confiance et ta gentillesse ! ❤️

À très bientôt 😘
${url}`;

// Néerlandais et anglais : mise en forme WhatsApp, *gras*, lien seul sur sa ligne pour rester cliquable
export function reviewMessage(lang: Lang, name: string | null | undefined, url: string): string {
  const n = firstName(name);
  if (lang === 'fr') return FR(n, url);
  const T = {
    nl: [`Hallo${n ? ` ${n}` : ''} 🌸`, 'Bedankt voor uw bezoek aan *My Bubble Beauty*. Het was een plezier om voor u te zorgen.',
      'Hebt u even tijd? Uw beoordeling op Google helpt ons echt om het instituut bekend te maken.', '*Laat een beoordeling achter* ✨', 'Tot binnenkort,'],
    en: [`Hello${n ? ` ${n}` : ''} 🌸`, 'Thank you for visiting *My Bubble Beauty*. It was a pleasure to take care of you.',
      'If you have a minute, a review on Google really helps us share the salon with others.', '*Leave a review* ✨', 'See you soon,'],
  }[lang];
  return `${T[0]}\n\n${T[1]}\n\n${T[2]}\n\n${T[3]}\n${url}\n\n${T[4]}\nSouade`;
}

export const waLink = (digits: string, text: string) => `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;

// Bouton visible : lien Google réglé, rendez-vous confirmé et passé, cliente venue, numéro connu
export type AskRow = { status: string; past: boolean; no_show: boolean; phone: string | null };
export const canAskReview = (r: AskRow, reviewUrl: string | undefined) =>
  !!reviewUrl && r.status === 'confirmed' && r.past && !r.no_show && !!waDigits(r.phone);

export type AskResult = { ok: true; url: string } | { ok: false; error: string };

// Note la demande (une seule par compte et par numéro) puis rend le lien wa.me
export async function askReview(bookingId: number, staffId: number, reviewUrl: string | undefined): Promise<AskResult> {
  if (!reviewUrl) return { ok: false, error: 'Lien Google des avis non réglé (GOOGLE_REVIEW_URL).' };
  const [b] = await sql<{ user_id: number | null; status: string; past: boolean; no_show: boolean; phone: string | null; name: string | null; locale: Lang | null; left_google: boolean; clicked: boolean; mailed: boolean }[]>`
    SELECT b.user_id, b.status, b.starts_at < now() AS past, b.no_show, coalesce(u.phone, b.guest_phone) AS phone,
      coalesce(u.name, b.guest_name) AS name, u.locale, u.google_review_at IS NOT NULL AS left_google,
      -- Même règle que le mail (avis.ts) : clic sur un lien d'avis, ou mail de demande de moins de 6 mois
      EXISTS (SELECT 1 FROM bookings c WHERE c.user_id = b.user_id AND c.review_clicked_at IS NOT NULL) AS clicked,
      EXISTS (SELECT 1 FROM bookings o WHERE o.user_id = b.user_id AND o.review_request_sent_at > now() - ${ASK_EVERY}::interval) AS mailed
    FROM bookings b LEFT JOIN users u ON u.id = b.user_id WHERE b.id = ${bookingId}`;
  if (!b || !canAskReview(b, reviewUrl)) return { ok: false, error: 'Avis demandable seulement après un rendez-vous confirmé et honoré, avec un numéro de téléphone.' };
  if (b.left_google) return { ok: false, error: 'La fiche indique que cette cliente a déjà laissé un avis Google.' };
  if (b.clicked) return { ok: false, error: 'Cette cliente a déjà ouvert le lien d’avis Google reçu par mail.' };
  if (b.mailed) return { ok: false, error: 'Avis déjà demandé par mail à cette cliente il y a moins de 6 mois.' };
  const digits = waDigits(b.phone)!;
  const rows = await sql`
    INSERT INTO review_asks (user_id, phone, booking_id, asked_by)
    SELECT ${b.user_id}, ${digits}, ${bookingId}, ${staffId}
    WHERE NOT EXISTS (SELECT 1 FROM review_asks WHERE phone = ${digits} OR (${b.user_id}::bigint IS NOT NULL AND user_id = ${b.user_id}))
    ON CONFLICT DO NOTHING RETURNING id`;
  if (!rows.length) return { ok: false, error: 'Avis déjà demandé à cette cliente.' };
  void journal('avis_demande', { actor: staffId, client: b.user_id, booking: bookingId, details: { canal: 'whatsapp' } });
  return { ok: true, url: waLink(digits, reviewMessage(b.locale ?? 'fr', b.name, reviewUrl)) };
}
