// Saisies de l'admin : schémas Zod (seule porte d'entrée des formulaires) et montants en euros. Module pur, testé sans base.
import { z } from 'astro/zod';
import { isDay } from './pricing.ts';

// « 35 », « 12,50 » ou « 12.5 » en centimes, sans flottant : 0,29 € donne bien 29 centimes
export function toCents(s: string): number | null {
  const m = /^(\d{1,5})(?:[.,](\d{1,2}))?$/.exec(s.trim());
  return m ? Number(m[1]) * 100 + Number((m[2] ?? '0').padEnd(2, '0')) : null;
}

// Montant tel qu'on le saisit : « 35 », « 12,50 »
export const centsInput = (c: number) => (c / 100).toFixed(2).replace(/\.00$/, '').replace('.', ',');

// Jour civil voisin ('AAAA-MM-JJ') : calcul de calendrier pur, midi UTC ne tombe jamais sur un changement d'heure
export function addDays(day: string, n: number) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const monday = (day: string) => addDays(day, -((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7));

// Champs : un message français par champ, y compris quand la valeur manque ou n'est pas du texte (fichier forgé)
const str = (msg: string) => z.string({ error: msg }).trim();
const between = (v: string, min: number, max: number) => /^\d{1,10}$/.test(v) && +v >= min && +v <= max;
const int = (min: number, max: number, msg: string) => str(msg).refine((v) => between(v, min, max), msg).transform(Number);
const optInt = (min: number, max: number, msg: string) =>
  str(msg).default('').refine((v) => v === '' || between(v, min, max), msg).transform((v) => (v === '' ? null : Number(v)));
// Une seule ligne, sans caractère de contrôle
const text = (max: number, msg: string) => str(msg).min(1, msg).max(max, msg).regex(/^\P{Cc}*$/u, msg);
const money = (msg: string) => str(msg).refine((v) => toCents(v) !== null, msg).transform((v) => toCents(v) as number);
const day = (msg: string) => str(msg).refine(isDay, msg);
const optDay = (msg: string) => str(msg).default('').refine((v) => v === '' || isDay(v), msg).transform((v) => v || null);
const TIME = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const time = (msg: string) => str(msg).regex(TIME, msg).transform((v) => v.slice(0, 5));
const optTime = (msg: string) => str(msg).default('').refine((v) => v === '' || TIME.test(v), msg).transform((v) => v.slice(0, 5) || null);
// Case à cocher : présente = cochée
const box = z.unknown().optional().transform((v) => v !== undefined && v !== null);
const id = int(1, 2_000_000_000, 'Identifiant invalide.');

export const idForm = z.object({ id });
export const toggleForm = z.object({ id, active: box });

export const serviceForm = z
  .object({
    id,
    name_fr: text(200, 'Nom français : 1 à 200 caractères.'),
    name_nl: text(200, 'Nom néerlandais : 1 à 200 caractères.'),
    name_en: text(200, 'Nom anglais : 1 à 200 caractères.'),
    duration: optInt(5, 600, 'Durée : nombre de minutes de 5 à 600.'),
    price: money('Prix : montant en euros, par exemple 35 ou 12,50.'),
    deposit: money('Acompte : montant en euros, 0 pour aucun.'),
    sort: int(0, 9999, 'Ordre : nombre entier de 0 à 9999.'),
    active: box,
  })
  // Même règle que la contrainte en base, avec un message lisible
  .refine((s) => !s.active || s.duration !== null, "Une prestation ne s'ouvre à la réservation qu'avec une durée : saisissez-la d'abord.");

export const hoursForm = z
  .object({
    weekday: int(1, 7, 'Jour de la semaine invalide.'),
    opens: time('Ouverture : heure au format HH:MM.'),
    closes: time('Fermeture : heure au format HH:MM.'),
  })
  .refine((h) => h.opens < h.closes, "L'heure de fermeture doit suivre l'heure d'ouverture.");

// Heures de Bruxelles ; heure vide = journée entière (début à 00:00, fin à minuit du jour de fin)
export const closureForm = z
  .object({
    start_day: day('Début : date invalide.'),
    start_time: optTime('Début : heure au format HH:MM.'),
    end_day: day('Fin : date invalide.'),
    end_time: optTime('Fin : heure au format HH:MM.'),
    reason: str('Motif : 200 caractères au plus.').max(200, 'Motif : 200 caractères au plus.').regex(/^\P{Cc}*$/u, 'Motif : une seule ligne.').default(''),
  })
  .transform((c) => ({
    starts: `${c.start_day} ${c.start_time ?? '00:00'}`,
    ends: c.end_time ? `${c.end_day} ${c.end_time}` : `${addDays(c.end_day, 1)} 00:00`,
    reason: c.reason,
  }))
  .refine((c) => c.starts < c.ends, 'La fin de la fermeture doit suivre son début.');

// Dates du code = jour de la réservation (ends_on inclus) ; aucune prestation cochée = toutes
export const promoForm = z
  .object({
    id: optInt(1, 2_000_000_000, 'Identifiant invalide.'),
    code: str('Code : 3 à 32 caractères, lettres, chiffres ou tirets.').toUpperCase().regex(/^[A-Z0-9-]{3,32}$/, 'Code : 3 à 32 caractères, lettres, chiffres ou tirets.'),
    kind: z.enum(['percent', 'amount'], { error: 'Type de remise invalide.' }),
    value: str('Valeur de la remise manquante.'),
    starts_on: optDay('Début : date invalide.'),
    ends_on: optDay('Fin : date invalide.'),
    max_uses: optInt(1, 100_000, 'Utilisations maximum : nombre entier de 1 à 100 000, ou vide.'),
    once_per_user: box,
    active: box,
    services: z.array(id, { error: 'Prestations invalides.' }).max(500, 'Prestations invalides.'),
  })
  .refine((p) => (p.kind === 'percent' ? between(p.value, 1, 100) : !!toCents(p.value)), {
    error: (i) => ((i.input as { kind: string }).kind === 'percent' ? 'Pourcentage : nombre entier de 1 à 100.' : 'Montant : en euros, plus de 0, par exemple 5 ou 7,50.'),
  })
  .refine((p) => !p.starts_on || !p.ends_on || p.starts_on <= p.ends_on, 'La date de fin doit suivre la date de début.')
  .transform(({ services, value, ...p }) => ({
    ...p,
    value: p.kind === 'percent' ? Number(value) : (toCents(value) as number),
    service_ids: services.length ? [...new Set(services)] : null,
  }));

export const agendaForm = z.object({
  action: z.enum(['cancel', 'refund'], { error: 'Action inconnue.' }),
  id,
  refund: box,
});

// Rendez-vous pris par téléphone ou WhatsApp : nom exigé, téléphone facultatif
export const newBookingForm = z.object({
  service: int(1, 2_000_000_000, 'Choisissez une prestation.'),
  day: day('Date invalide.'),
  time: time('Heure au format HH:MM.'),
  name: text(100, 'Nom : 1 à 100 caractères.'),
  phone: str('Téléphone : chiffres, espaces et + ( ) . / - seulement, 30 caractères au plus.')
    .max(30, 'Téléphone : 30 caractères au plus.')
    .regex(/^[0-9+()./ -]*$/, 'Téléphone : chiffres, espaces et + ( ) . / - seulement.')
    .default(''),
});

// Code de l'appli d'authentification ; les espaces affichés par certaines applis sont retirés
export const totpForm = z.object({ code: z.string({ error: 'Code à 6 chiffres.' }).transform((v) => v.replace(/\s/g, '')).pipe(z.string().regex(/^\d{6}$/, 'Code à 6 chiffres.')) });
