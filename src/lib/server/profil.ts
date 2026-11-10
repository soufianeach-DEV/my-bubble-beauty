// Fiche de soin d'une cliente (admin et gestionnaire) : préférences de soin, zones et toucher (users.care_profile, pas des données de
// santé) ; allergies, type de peau et contre-indications (users.health_profile : données de santé, chiffrées, seulement avec l'accord
// de la cliente) ; notes libres (users.notes). Les alertes (zones à ne pas toucher, allergies, toucher limité) s'affichent en badge.
import { PASSWORD_PEPPER } from 'astro:env/server';
import { audit, type Result } from './admin.ts';
import { sql } from './db.ts';
import { openText, sealText } from './totp.ts';
import { journal } from './journal.ts';

const opts = <T extends Record<string, string>>(o: T) => o;
export const ALLERGIES = opts({ fruits_coque: 'Fruits à coque', parfum: 'Parfum', huiles: 'Huiles essentielles', latex: 'Latex', lanoline: 'Lanoline', conservateurs: 'Conservateurs', nickel: 'Nickel', autre: 'Autre' });
export const SKIN = opts({ sensible: 'Sensible', reactive: 'Réactive', seche: 'Sèche', grasse: 'Grasse', mixte: 'Mixte' });
export const HEAT = opts({ chaud: 'Aime la chaleur', neutre: 'Neutre', frais: 'Préfère le frais' });
export const COVER = opts({ couverte: 'Bien couverte', legere: 'Légère', indifferent: 'Indifférent' });
export const PRESSURE = opts({ douce: 'Douce', moyenne: 'Moyenne', ferme: 'Ferme' });
export const AMBIENCE = opts({ calme: 'Calme, sans parler', discuter: 'Aime discuter', musique: 'Musique' });
export const ZONES = opts({ visage: 'Visage', cou: 'Cou', cuir_chevelu: 'Cuir chevelu', mains: 'Mains', pieds: 'Pieds', ventre: 'Ventre', dos: 'Dos', jambes: 'Jambes', autre: 'Autre' });
export const TOUCH = opts({ aise: "À l'aise", limite: 'Préfère un toucher limité', prevenir: 'Prévenir avant chaque contact' });

export type Care = { heat?: string; cover?: string; pressure?: string; ambience?: string; scents?: string; zones?: string[]; zones_other?: string; touch?: string };
export type Health = { allergies?: string[]; allergies_other?: string; skin?: string[]; contra?: string };

const HEALTH = 'health-profile';
export const openHealth = (blob: Buffer | null): Health | null => {
  const t = blob ? openText(PASSWORD_PEPPER, HEALTH, blob) : null;
  return t ? (JSON.parse(t) as Health) : null;
};

export async function readProfile(userId: number) {
  const [u] = await sql<{ care_profile: Care; health_profile: Buffer | null; notes: string; consent: boolean; consent_at: Date | null; filled_at: Date | null; skipped_at: Date | null; client_note: string }[]>`
    SELECT care_profile, health_profile, notes, health_consent_at IS NOT NULL AS consent, health_consent_at AS consent_at,
      care_filled_at AS filled_at, care_skipped_at AS skipped_at, client_note FROM users WHERE id = ${userId}`;
  return {
    care: u?.care_profile ?? {}, health: u?.consent ? openHealth(u.health_profile) ?? {} : null, notes: u?.notes ?? '', consent: !!u?.consent,
    consentAt: u?.consent_at ?? null, filledAt: u?.filled_at ?? null, skippedAt: u?.skipped_at ?? null, clientNote: u?.client_note ?? '',
  };
}

// Une valeur parmi les clés connues, sinon rien ; plusieurs valeurs : seulement les clés connues ; texte : une ligne, longueur bornée
const one = (f: FormData, k: string, o: Record<string, string>) => { const v = String(f.get(k) ?? ''); return Object.hasOwn(o, v) ? v : undefined; };
const many = (f: FormData, k: string, o: Record<string, string>) => [...new Set(f.getAll(k).map(String))].filter((v) => Object.hasOwn(o, v));
const line = (f: FormData, k: string, max: number) => String(f.get(k) ?? '').replace(/\p{Cc}/gu, ' ').trim().slice(0, max) || undefined;
const block = (f: FormData, k: string, max: number) => String(f.get(k) ?? '').replace(/\r\n/g, '\n').trim().slice(0, max) || undefined;

// Lecture du formulaire de fiche (institut et cliente : mêmes champs, mêmes valeurs connues)
function parseCare(form: FormData): Care {
  return {
    heat: one(form, 'heat', HEAT), cover: one(form, 'cover', COVER), pressure: one(form, 'pressure', PRESSURE), ambience: one(form, 'ambience', AMBIENCE),
    scents: line(form, 'scents', 200), zones: many(form, 'zones', ZONES), zones_other: line(form, 'zones_other', 200), touch: one(form, 'touch', TOUCH),
  };
}
function parseHealth(form: FormData): { health: Health; hasHealth: boolean } {
  const health: Health = { allergies: many(form, 'allergies', ALLERGIES), allergies_other: line(form, 'allergies_other', 200), skin: many(form, 'skin', SKIN), contra: block(form, 'contra', 2000) };
  return { health, hasHealth: !!(health.allergies?.length || health.allergies_other || health.skin?.length || health.contra) };
}

// Fiche remplie par la cliente : l'accord santé se donne sur la même page (case séparée, art. 9 RGPD) ; sans accord, la partie santé
// est ignorée. Le mot pour l'institut va dans client_note, jamais dans les notes internes de l'équipe.
export async function saveOwnProfile(userId: number, form: FormData, ip: string): Promise<{ ok: boolean }> {
  const note = String(form.get('client_note') ?? '').replace(/\r\n/g, '\n').trim();
  if (note.length > 500) return { ok: false };
  const care = JSON.parse(JSON.stringify(parseCare(form)));
  const { health, hasHealth } = parseHealth(form);
  const give = form.get('health_consent') === 'on';
  return sql.begin(async (tx) => {
    const [u] = await tx<{ consent: boolean }[]>`SELECT health_consent_at IS NOT NULL AS consent FROM users WHERE id = ${userId} AND role IS NULL FOR UPDATE`;
    if (!u) return { ok: false };
    if (give && !u.consent) {
      await tx`UPDATE users SET health_consent_at = now() WHERE id = ${userId}`;
      journal('consent_given', { actor: userId, client: userId, ip });
    }
    const consent = u.consent || give;
    await tx`UPDATE users SET care_profile = ${tx.json(care)}, client_note = ${note}, care_filled_at = now(), care_skipped_at = NULL,
      health_profile = CASE WHEN ${consent} AND health_consent_at IS NOT NULL THEN ${hasHealth ? sealText(PASSWORD_PEPPER, HEALTH, JSON.stringify(health)) : null}::bytea ELSE health_profile END,
      updated_at = now() WHERE id = ${userId} AND role IS NULL`;
    // Rien du contenu au journal (données de santé possibles)
    journal('client_care_profile', { actor: userId, client: userId, details: { health: consent && hasHealth, zones: care.zones?.length ?? 0 } });
    return { ok: true };
  });
}

// « Plus tard » : la cliente n'est plus renvoyée vers sa fiche ; le rappel reste sur Mon compte
export const skipOwnProfile = (userId: number) => sql`UPDATE users SET care_skipped_at = now() WHERE id = ${userId} AND care_skipped_at IS NULL`;

export async function saveProfile(actor: number, clientId: number, form: FormData): Promise<Result> {
  const notes = String(form.get('notes') ?? '').replace(/\r\n/g, '\n');
  if (notes.length > 4000) return { ok: false, error: 'Notes : 4000 caractères au plus.' };
  const care = parseCare(form);
  const { health, hasHealth } = parseHealth(form);
  const [u] = await sql<{ consent: boolean }[]>`SELECT health_consent_at IS NOT NULL AS consent FROM users WHERE id = ${clientId} AND role IS NULL`;
  if (!u) return { ok: false, error: 'Cliente introuvable.' };
  if (hasHealth && !u.consent) return { ok: false, error: "Sans l'accord de la cliente pour ses données de santé, allergies, type de peau et contre-indications ne peuvent pas être notés." };
  const clean = JSON.parse(JSON.stringify(care));
  // Accord relu dans l'écriture même : un retrait d'accord entre la lecture et l'écriture ne laisse aucune donnée de santé
  await sql`UPDATE users SET care_profile = ${sql.json(clean)}, notes = ${notes},
    health_profile = CASE WHEN health_consent_at IS NOT NULL THEN ${hasHealth ? sealText(PASSWORD_PEPPER, HEALTH, JSON.stringify(health)) : null}::bytea END,
    updated_at = now() WHERE id = ${clientId} AND role IS NULL`;
  // Le contenu ne va jamais au journal (données de santé possibles) : seulement ce qui a été rempli
  audit(actor, 'client_profile', { client_id: clientId, notes_length: notes.length, health: hasHealth, zones: care.zones?.length ?? 0 });
  return { ok: true, id: clientId, key: 'notes' };
}

// Alertes à voir avant le soin : zones à ne pas toucher, allergies (avec accord santé), toucher limité
export function alertsOf(care: Care, health: Health | null): string[] {
  const out: string[] = [];
  const zones = [...(care.zones ?? []).filter((z) => z !== 'autre').map((z) => ZONES[z as keyof typeof ZONES]), care.zones_other].filter(Boolean);
  if (zones.length) out.push(`Ne pas toucher : ${zones.join(', ')}`);
  const allergies = [...(health?.allergies ?? []).filter((a) => a !== 'autre').map((a) => ALLERGIES[a as keyof typeof ALLERGIES]), health?.allergies_other].filter(Boolean);
  if (allergies.length) out.push(`Allergie : ${allergies.join(', ')}`);
  if (care.touch === 'limite' || care.touch === 'prevenir') out.push(TOUCH[care.touch]);
  return out;
}

export async function alertsFor(ids: number[]): Promise<Map<number, string[]>> {
  if (!ids.length) return new Map();
  const rows = await sql<{ id: number; care_profile: Care; health_profile: Buffer | null; consent: boolean }[]>`
    SELECT id, care_profile, health_profile, health_consent_at IS NOT NULL AS consent FROM users WHERE id = ANY(${ids}::bigint[])`;
  return new Map(rows.map((r) => [r.id, alertsOf(r.care_profile ?? {}, r.consent ? openHealth(r.health_profile) : null)]));
}

// Feuille du jour imprimée : badges d'alerte et contre-indications ; données de santé seulement avec l'accord de la cliente
export async function printNotesFor(ids: number[]): Promise<Map<number, { alerts: string[]; contra: string }>> {
  if (!ids.length) return new Map();
  const rows = await sql<{ id: number; care_profile: Care; health_profile: Buffer | null; consent: boolean }[]>`
    SELECT id, care_profile, health_profile, health_consent_at IS NOT NULL AS consent FROM users WHERE id = ANY(${ids}::bigint[])`;
  return new Map(rows.map((r) => {
    const health = r.consent ? openHealth(r.health_profile) : null;
    return [Number(r.id), { alerts: alertsOf(r.care_profile ?? {}, health), contra: health?.contra ?? '' }];
  }));
}

// Export RGPD : libellés lisibles
export function readableProfile(care: Care, health: Health | null) {
  const lbl = (o: Record<string, string>, v?: string) => (v ? o[v] ?? v : undefined);
  const lbls = (o: Record<string, string>, v?: string[]) => (v?.length ? v.map((x) => o[x] ?? x) : undefined);
  return {
    preferences: { chaleur: lbl(HEAT, care.heat), couverture: lbl(COVER, care.cover), pression: lbl(PRESSURE, care.pressure), ambiance: lbl(AMBIENCE, care.ambience), odeurs: care.scents },
    zones_et_toucher: { ne_pas_toucher: lbls(ZONES, care.zones), autre_zone: care.zones_other, toucher: lbl(TOUCH, care.touch) },
    sante: health ? { allergies: lbls(ALLERGIES, health.allergies), autre_allergie: health.allergies_other, type_de_peau: lbls(SKIN, health.skin), contre_indications: health.contra } : null,
  };
}
