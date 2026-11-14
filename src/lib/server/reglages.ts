// Réglages de l'institut modifiables depuis l'admin, sans toucher au code : nom du spécialiste cité dans les consentements,
// règles de la carte de fidélité, note Google de l'Accueil, habillage de saison du site public. Une ligne par clé dans la table settings ; toute modification passe au journal.
import { z } from 'astro/zod';
import { audit, type Result } from './admin.ts';
import { sql } from './db.ts';

// Montants en euros entiers. min_euros : prix payé minimum pour qu'une séance compte ; free_min_total : total payé sur la carte exigé
// pour le soin offert ; free_value : prix du soin offert, pour mesurer la rentabilité.
export type Loyalty = { discount_after: number; discount_percent: number; free_after: number; free_label: string; min_euros: number; free_min_total: number; free_value: number };
// Règles données par la gérante : -10 % après 5 séances d'au moins 50 €, une HydraPure (120 €) offerte après 10 séances et 1 000 € payés,
// puis la carte repart à zéro
export const LOYALTY_DEFAULT: Loyalty = { discount_after: 5, discount_percent: 10, free_after: 10, free_label: 'HydraPure', min_euros: 50, free_min_total: 500, free_value: 120 };

// Habillage de saison du site public (neige, givre, bandeau des fêtes) : auto = du 1er décembre au 6 janvier, heure de Bruxelles
import { seasonMode, seasonOn, type Season } from '../../../db/saison.mjs';
export { seasonOn, type Season };
export const SEASON_LABELS: Record<Season, string> = { auto: 'Automatique : du 1er décembre au 6 janvier', on: 'Toujours (dès maintenant)', off: 'Jamais' };

const n = (min: number, max: number, msg: string) => z.coerce.number({ error: msg }).int(msg).min(min, msg).max(max, msg);
export const settingsForm = z.object({
  specialist_name: z.string({ error: 'Nom du spécialiste : 100 caractères au plus.' }).trim().max(100, 'Nom du spécialiste : 100 caractères au plus.').regex(/^\P{Cc}*$/u, 'Nom invalide.'),
  discount_after: n(1, 50, 'Remise : nombre de séances de 1 à 50.'),
  discount_percent: n(1, 100, 'Remise : pourcentage de 1 à 100.'),
  free_after: n(2, 100, 'Soin offert : nombre de séances de 2 à 100.'),
  min_euros: n(0, 1000, 'Montant minimum par séance : de 0 à 1 000 €.'),
  free_min_total: n(0, 100000, 'Total payé exigé : de 0 à 100 000 €.'),
  free_value: n(0, 10000, 'Prix du soin offert : de 0 à 10 000 €.'),
  // Note saisie « 4,6 » ou « 4.6 »
  google_rating: z.preprocess((x) => String(x ?? '').replace(',', '.'), z.coerce.number({ error: 'Note Google : de 1 à 5.' }).min(1, 'Note Google : de 1 à 5.').max(5, 'Note Google : de 1 à 5.')),
  google_count: n(0, 100000, 'Nombre d’avis Google : de 0 à 100 000.'),
  season: z.enum(['auto', 'on', 'off'], { error: 'Habillage de saison : choix inconnu.' }).default('auto'),
  free_label: z.string({ error: 'Soin offert : 60 caractères au plus.' }).trim().min(1, 'Indiquez le soin offert.').max(60, 'Soin offert : 60 caractères au plus.').regex(/^\P{Cc}*$/u, 'Nom invalide.'),
}).refine((f) => f.free_after > f.discount_after, { message: 'Le soin offert doit venir après la remise (plus de séances).' });

export async function readSettings(): Promise<{ specialist_name: string; loyalty: Loyalty; season: Season }> {
  const rows = await sql<{ key: string; value: unknown }[]>`SELECT key, value FROM settings WHERE key IN ('specialist_name', 'loyalty', 'season')`;
  const get = (k: string) => rows.find((r) => r.key === k)?.value;
  return { specialist_name: (get('specialist_name') as string) ?? '', loyalty: { ...LOYALTY_DEFAULT, ...((get('loyalty') as Partial<Loyalty>) ?? {}) },
    season: seasonMode(get('season')) };
}

// Lu à chaque visite du site public (/api/saison) : une minute de cache en mémoire suffit
let seasonCache: { mode: Season; at: number } | null = null;
export async function seasonActive(now = new Date()): Promise<boolean> {
  if (!seasonCache || now.getTime() - seasonCache.at > 60_000) {
    const [r] = await sql<{ value: unknown }[]>`SELECT value FROM settings WHERE key = 'season'`;
    seasonCache = { mode: seasonMode(r?.value), at: now.getTime() };
  }
  return seasonOn(seasonCache.mode, now);
}

export async function saveSettings(actor: number, form: FormData): Promise<Result> {
  const p = settingsForm.safeParse(Object.fromEntries(form));
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? 'Saisie invalide.' };
  const { specialist_name, google_rating, google_count, season, ...loyalty } = p.data;
  // Formulaire unique : la note n'est réécrite que si elle a changé (sinon un enregistrement de la carte la marquerait « saisie »)
  const cur = await readRating();
  const rating = Math.round(google_rating * 10) / 10;
  const ratingChanged = rating !== cur.rating || google_count !== cur.count;
  await sql.begin(async (tx) => {
    for (const [key, value] of [['specialist_name', specialist_name], ['loyalty', loyalty], ['season', season]] as const)
      await tx`INSERT INTO settings (key, value, updated_by) VALUES (${key}, ${tx.json(value as never)}, ${actor})
        ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now(), updated_by = excluded.updated_by`;
    if (ratingChanged) await saveRating(tx as unknown as typeof sql, { rating, count: google_count, source: 'admin', updated_at: new Date().toISOString() }, actor);
  });
  seasonCache = null;
  audit(actor, 'settings_saved', { loyalty, specialist: specialist_name !== '', season, ...(ratingChanged ? { google_rating: rating, google_count } : {}) });
  return { ok: true, id: actor };
}

// Note Google de l'Accueil (tant que les avis Business Profile ne sont pas branchés) : saisie ici, ou relue chaque nuit par
// l'API Places (note-google.ts). Aucune variable d'environnement ici : ce module est importé par beaucoup d'autres.
// Valeurs de la fiche relevées le 14/11/2026, tant que rien n'est enregistré
export const RATING_DEFAULT = { rating: 4.6, count: 42 };
export type GoogleRating = { rating: number; count: number; source: 'defaut' | 'admin' | 'places'; updated_at: string | null; checked_at?: string };

export async function readRating(): Promise<GoogleRating> {
  const [row] = await sql<{ value: Partial<GoogleRating> }[]>`SELECT value FROM settings WHERE key = 'google_rating'`;
  const v = row?.value;
  return v && typeof v.rating === 'number' && typeof v.count === 'number'
    ? { rating: v.rating, count: v.count, source: v.source ?? 'admin', updated_at: v.updated_at ?? null, checked_at: v.checked_at }
    : { ...RATING_DEFAULT, source: 'defaut', updated_at: null };
}

// Fusion jsonb : la saisie de la gérante garde la date du dernier passage de la tâche, et inversement
export async function saveRating(tx: typeof sql, value: Partial<GoogleRating>, actor: number | null = null) {
  await tx`INSERT INTO settings (key, value, updated_by) VALUES ('google_rating', ${tx.json(value as never)}, ${actor})
    ON CONFLICT (key) DO UPDATE SET value = settings.value || excluded.value, updated_at = now(), updated_by = excluded.updated_by`;
}
