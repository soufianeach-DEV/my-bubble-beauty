// Fiche de suivi des séances (admin et gestionnaire) : date de naissance, antécédents médicaux, puis une ligne par rendez-vous
// réalisé avec la date, le soin, la zone et la praticienne. Les antécédents sont des données de santé : chiffrés en base, notés
// seulement avec l'accord de la cliente (health_consent_at), jamais au journal ni dans un e-mail (le journal garde leur longueur).
import { ADMIN_EMAIL, PASSWORD_PEPPER } from 'astro:env/server';
import { z } from 'astro/zod';
import { audit, type Result } from './admin.ts';
import { sql } from './db.ts';
import { openText, sealText } from './totp.ts';

const HEALTH = 'health';
export const readHealth = (blob: Buffer | null) => (blob ? openText(PASSWORD_PEPPER, HEALTH, blob) : null);

export type Seance = { id: number; starts_at: Date; service: string; zone: string | null; practitioner_id: number | null; practitioner: string | null };

export async function suivi(clientId: number) {
  const [[u], seances, team] = await Promise.all([
    sql<{ birth_date: string | null; medical_history: Buffer | null; consent: boolean }[]>`
      SELECT birth_date::text, medical_history, health_consent_at IS NOT NULL AS consent FROM users WHERE id = ${clientId}`,
    // Séances réalisées : rendez-vous confirmés, terminés, sans absence ; numérotées dans l'ordre
    sql<Seance[]>`
      SELECT b.id, b.starts_at, s.name_fr AS service, b.zone, b.practitioner_id, coalesce(p.name, p.email) AS practitioner
      FROM bookings b JOIN services s ON s.id = b.service_id LEFT JOIN users p ON p.id = b.practitioner_id
      WHERE b.user_id = ${clientId} AND b.status = 'confirmed' AND b.ends_at < now() AND NOT b.no_show
      ORDER BY b.starts_at`,
    staffList(),
  ]);
  return { birthDate: u?.birth_date ?? null, history: u?.consent ? readHealth(u.medical_history) : null, consent: !!u?.consent, seances, team };
}

// Praticiennes proposées : la gérante et l'équipe active
export const staffList = () => sql<{ id: number; name: string }[]>`
  SELECT id, coalesce(name, email) AS name FROM users
  WHERE email_verified_at IS NOT NULL AND removed_at IS NULL AND blocked_at IS NULL
    AND (role IS NOT NULL OR email = ${ADMIN_EMAIL.trim().toLowerCase()})
  ORDER BY name`;

const id = z.coerce.number().int().min(1).max(2_000_000_000);
// Date de naissance : vraie date du calendrier, après 1900 et pas dans le futur
const birth = (v: string) => /^(19|20)\d{2}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v && v > '1900-01-01' && v <= new Date().toISOString().slice(0, 10);
export const suiviForm = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('health'), id,
    birth_date: z.string().trim().default('').refine((v) => v === '' || birth(v), 'Date de naissance invalide.'),
    medical_history: z.string().max(4000, 'Antécédents : 4000 caractères au plus.').default(''),
  }),
  z.object({
    action: z.literal('seance'), id, booking: id,
    zone: z.string().trim().max(100, 'Zone : 100 caractères au plus.').regex(/^\P{Cc}*$/u, 'Zone invalide.').default(''),
    practitioner: z.string().default('').refine((v) => v === '' || /^\d{1,10}$/.test(v), 'Praticienne invalide.'),
  }),
], { error: 'Action inconnue.' });

export async function suiviAction(actor: number, form: FormData): Promise<Result> {
  const p = suiviForm.safeParse(Object.fromEntries(form));
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? 'Saisie invalide.' };
  const f = p.data;
  if (f.action === 'health') {
    const text = f.medical_history.replace(/\r\n/g, '\n').trim();
    // Sans l'accord de la cliente, aucun antécédent n'est enregistré (la date de naissance n'est pas une donnée de santé)
    const [r] = await sql<{ consent: boolean }[]>`SELECT health_consent_at IS NOT NULL AS consent FROM users WHERE id = ${f.id} AND role IS NULL`;
    if (!r) return { ok: false, error: 'Cliente introuvable.' };
    if (text && !r.consent) return { ok: false, error: "Sans l'accord de la cliente pour ses données de santé, les antécédents ne peuvent pas être notés." };
    await sql`UPDATE users SET birth_date = ${f.birth_date || null}, medical_history = ${text ? sealText(PASSWORD_PEPPER, HEALTH, text) : null}, updated_at = now() WHERE id = ${f.id}`;
    audit(actor, 'client_health', { client_id: f.id, length: text.length, birth_date: f.birth_date !== '' });
    return { ok: true, id: f.id, key: 'sante' };
  }
  const practitioner = f.practitioner ? Number(f.practitioner) : null;
  if (practitioner && !(await staffList()).some((s) => s.id === practitioner)) return { ok: false, error: 'Praticienne invalide.' };
  const [b] = await sql`UPDATE bookings SET zone = ${f.zone || null}, practitioner_id = ${practitioner}
    WHERE id = ${f.booking} AND user_id = ${f.id} AND status = 'confirmed' AND ends_at < now() AND NOT no_show RETURNING id`;
  if (!b) return { ok: false, error: 'Séance introuvable.' };
  audit(actor, 'session_noted', { client_id: f.id, booking_id: f.booking });
  return { ok: true, id: f.booking, key: 'seance' };
}
