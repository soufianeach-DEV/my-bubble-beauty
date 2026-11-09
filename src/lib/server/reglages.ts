// Réglages de l'institut modifiables depuis l'admin, sans toucher au code : nom du spécialiste cité dans les consentements,
// règles de la carte de fidélité. Une ligne par clé dans la table settings ; toute modification passe au journal.
import { z } from 'astro/zod';
import { audit, type Result } from './admin.ts';
import { sql } from './db.ts';

export type Loyalty = { discount_after: number; discount_percent: number; free_after: number; free_label: string };
// Règles données par la gérante : -10 % après 5 séances, un Hydrafacial offert après 10, puis la carte repart à zéro
export const LOYALTY_DEFAULT: Loyalty = { discount_after: 5, discount_percent: 10, free_after: 10, free_label: 'Hydrafacial' };

const n = (min: number, max: number, msg: string) => z.coerce.number({ error: msg }).int(msg).min(min, msg).max(max, msg);
export const settingsForm = z.object({
  specialist_name: z.string({ error: 'Nom du spécialiste : 100 caractères au plus.' }).trim().max(100, 'Nom du spécialiste : 100 caractères au plus.').regex(/^\P{Cc}*$/u, 'Nom invalide.'),
  discount_after: n(1, 50, 'Remise : nombre de séances de 1 à 50.'),
  discount_percent: n(1, 100, 'Remise : pourcentage de 1 à 100.'),
  free_after: n(2, 100, 'Soin offert : nombre de séances de 2 à 100.'),
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
