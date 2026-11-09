// Réglages de l'institut modifiables depuis l'admin, sans toucher au code : nom du spécialiste cité dans les consentements,
// règles de la carte de fidélité. Une ligne par clé dans la table settings ; toute modification passe au journal.
import { z } from 'astro/zod';
import { audit, type Result } from './admin.ts';
import { sql } from './db.ts';

// Montants en euros entiers. min_euros : prix payé minimum pour qu'une séance compte ; free_min_total : total payé sur la carte exigé
// pour le soin offert ; free_value : prix du soin offert, pour mesurer la rentabilité.
export type Loyalty = { discount_after: number; discount_percent: number; free_after: number; free_label: string; min_euros: number; free_min_total: number; free_value: number };
// Règles données par la gérante : -10 % après 5 séances d'au moins 50 €, une HydraPure (120 €) offerte après 10 séances et 1 000 € payés,
// puis la carte repart à zéro
export const LOYALTY_DEFAULT: Loyalty = { discount_after: 5, discount_percent: 10, free_after: 10, free_label: 'HydraPure', min_euros: 50, free_min_total: 500, free_value: 120 };

const n = (min: number, max: number, msg: string) => z.coerce.number({ error: msg }).int(msg).min(min, msg).max(max, msg);
export const settingsForm = z.object({
  specialist_name: z.string({ error: 'Nom du spécialiste : 100 caractères au plus.' }).trim().max(100, 'Nom du spécialiste : 100 caractères au plus.').regex(/^\P{Cc}*$/u, 'Nom invalide.'),
  discount_after: n(1, 50, 'Remise : nombre de séances de 1 à 50.'),
  discount_percent: n(1, 100, 'Remise : pourcentage de 1 à 100.'),
  free_after: n(2, 100, 'Soin offert : nombre de séances de 2 à 100.'),
  min_euros: n(0, 1000, 'Montant minimum par séance : de 0 à 1 000 €.'),
  free_min_total: n(0, 100000, 'Total payé exigé : de 0 à 100 000 €.'),
  free_value: n(0, 10000, 'Prix du soin offert : de 0 à 10 000 €.'),
  free_label: z.string({ error: 'Soin offert : 60 caractères au plus.' }).trim().min(1, 'Indiquez le soin offert.').max(60, 'Soin offert : 60 caractères au plus.').regex(/^\P{Cc}*$/u, 'Nom invalide.'),
}).refine((f) => f.free_after > f.discount_after, { message: 'Le soin offert doit venir après la remise (plus de séances).' });

export async function readSettings(): Promise<{ specialist_name: string; loyalty: Loyalty }> {
  const rows = await sql<{ key: string; value: unknown }[]>`SELECT key, value FROM settings WHERE key IN ('specialist_name', 'loyalty')`;
  const get = (k: string) => rows.find((r) => r.key === k)?.value;
  return { specialist_name: (get('specialist_name') as string) ?? '', loyalty: { ...LOYALTY_DEFAULT, ...((get('loyalty') as Partial<Loyalty>) ?? {}) } };
}

export async function saveSettings(actor: number, form: FormData): Promise<Result> {
  const p = settingsForm.safeParse(Object.fromEntries(form));
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? 'Saisie invalide.' };
  const { specialist_name, ...loyalty } = p.data;
  await sql.begin(async (tx) => {
    for (const [key, value] of [['specialist_name', specialist_name], ['loyalty', loyalty]] as const)
      await tx`INSERT INTO settings (key, value, updated_by) VALUES (${key}, ${tx.json(value as never)}, ${actor})
        ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now(), updated_by = excluded.updated_by`;
  });
  audit(actor, 'settings_saved', { loyalty, specialist: specialist_name !== '' });
  return { ok: true, id: actor };
}
