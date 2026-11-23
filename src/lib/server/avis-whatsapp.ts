// Demande d'avis Google par WhatsApp, depuis l'agenda admin : aucun envoi côté serveur.
// Le clic note la demande puis ouvre wa.me avec le message prêt ; Souade appuie elle-même sur Envoyer.
// Une seule demande par cliente (compte ou numéro), même si elle revient.
import { sql } from './db.ts';
import { journal } from './journal.ts';
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

// Mise en forme WhatsApp : *gras*, sauts de ligne, lien seul sur sa ligne pour rester cliquable
export function reviewMessage(lang: Lang, name: string | null | undefined, url: string): string {
  const n = firstName(name);
  const T = {
    fr: [`Bonjour${n ? ` ${n}` : ''} 🌸`, 'Merci pour votre visite chez *My Bubble Beauty*. Ce fut un plaisir de prendre soin de vous.',
      'Si vous avez une minute, votre avis sur Google nous aide vraiment à faire connaître l’institut.', '*Laisser un avis* ✨', 'À très bientôt,'],
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
  const [b] = await sql<{ user_id: number | null; status: string; past: boolean; no_show: boolean; phone: string | null; name: string | null; locale: Lang | null }[]>`
    SELECT b.user_id, b.status, b.starts_at < now() AS past, b.no_show, coalesce(u.phone, b.guest_phone) AS phone,
      coalesce(u.name, b.guest_name) AS name, u.locale
    FROM bookings b LEFT JOIN users u ON u.id = b.user_id WHERE b.id = ${bookingId}`;
  if (!b || !canAskReview(b, reviewUrl)) return { ok: false, error: 'Avis demandable seulement après un rendez-vous confirmé et honoré, avec un numéro de téléphone.' };
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
