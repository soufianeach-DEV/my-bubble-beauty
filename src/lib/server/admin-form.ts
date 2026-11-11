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
    // Vide = aucun tampon
    buffer: optInt(0, 120, 'Temps tampon : nombre de minutes de 0 à 120.').transform((v) => v ?? 0),
    price: money('Prix : montant en euros, par exemple 35 ou 12,50.'),
    sort: int(0, 9999, 'Ordre : nombre entier de 0 à 9999.'),
    active: box,
  })
  // Même règle que la contrainte en base, avec un message lisible
  .refine((s) => !s.active || s.duration !== null, "Une prestation ne s'ouvre à la réservation qu'avec une durée : saisissez-la d'abord.");

// Prestations en lot : cases cochées (ids), en ligne ou hors ligne, durée facultative donnée d'abord à toute la sélection
export const bulkServiceForm = z.object({
  ids: z.array(id, { error: 'Cochez au moins une prestation.' }).min(1, 'Cochez au moins une prestation.').max(1000, 'Sélection trop longue.'),
  bulk: z.enum(['on', 'off'], { error: 'Choisissez « Mettre en ligne » ou « Mettre hors ligne ».' }).transform((v) => v === 'on'),
  duration: optInt(5, 600, 'Durée : nombre de minutes de 5 à 600.'),
});

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
    code: str('Code : 3 à 32 caractères, lettres, chiffres ou tirets.').toUpperCase().regex(/^[A-Z0-9-]{3,32}$/, 'Code : 3 à 32 caractères, lettres, chiffres ou tirets.')
      // Préfixe réservé : à la réservation, un code de la forme CADEAU-XXXX-XXXX est lu comme un bon cadeau
      .refine((v) => !v.startsWith('CADEAU-'), 'Les codes qui commencent par CADEAU- sont réservés aux bons cadeaux.'),
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

// Agenda et fiche cliente : day et time ne servent qu'au déplacement
export const agendaForm = z
  .object({
    action: z.enum(['cancel', 'refund', 'manual_refund', 'no_show', 'show', 'move', 'late', 'on_time', 'pay', 'unpay', 'unpackage', 'arrive', 'unarrive'], { error: 'Action inconnue.' }),
    method: z.enum(['especes', 'carte', 'payconiq', 'bon'], { error: 'Choisissez le mode de paiement.' }).optional(),
    amount: z.union([z.literal(''), money('Montant payé : 35 ou 12,50.')]).optional(),
    id,
    late: z.union([z.literal(''), z.coerce.number().int('Retard en minutes entières.').min(1, 'Retard de 1 à 240 minutes.').max(240, 'Retard de 1 à 240 minutes.')]).optional(),
    refund: box,
    day: optDay('Nouvelle date invalide.'),
    time: optTime('Nouvelle heure au format HH:MM.'),
  })
  .refine((a) => a.action !== 'move' || (a.day && a.time), "Pour déplacer, saisissez la nouvelle date et l'heure.")
  .refine((a) => a.action !== 'late' || typeof a.late === 'number', 'Indiquez le retard en minutes (1 à 240).')
  .refine((a) => a.action !== 'pay' || (a.method && typeof a.amount === 'number'), 'Indiquez le mode de paiement et le montant payé.');

// Suppression d'un rendez-vous (admin) : case « Je confirme » exigée, e-mail à la cliente seulement si coché
export const deleteBookingForm = z.object({ action: z.literal('delete'), id, notify: box, confirm: z.literal('on', { error: 'Cochez la case pour confirmer.' }) });

// Fiche cliente : notes (4000 caractères, plusieurs lignes permises), blocage, effacement confirmé par un mot tapé
// Actions sur un compte : la case « Je confirme » est exigée ici, pas seulement dans la page
const confirm = z.literal('on', { error: 'Cochez la case pour confirmer.' });
export const clientForm = z.discriminatedUnion('action', [
  z.object({ action: z.literal('notes'), id, notes: z.string({ error: 'Notes : 4000 caractères au plus.' }).max(4000, 'Notes : 4000 caractères au plus.').default('') }),
  z.object({ action: z.literal('block'), id, confirm }),
  z.object({ action: z.literal('unblock'), id, confirm }),
  z.object({ action: z.literal('restore'), id, confirm }),
  z.object({ action: z.literal('remove'), id, confirm }),
  z.object({ action: z.literal('unremove'), id, confirm }),
  z.object({ action: z.literal('erase'), id, confirm: z.literal('EFFACER', { error: 'Tapez EFFACER pour confirmer.' }) }),
], { error: 'Action inconnue.' });

// Rendez-vous pris par téléphone ou WhatsApp : nom exigé, téléphone facultatif
export const newBookingForm = z.object({
  service: int(1, 2_000_000_000, 'Choisissez une prestation.'),
  day: day('Date invalide.'),
  time: time('Heure au format HH:MM.'),
  // Cliente existante (« Nom <e-mail> » de la liste) ou, à défaut, nom libre pour une personne sans compte
  client: str('Cliente invalide.').max(400, 'Cliente invalide.').default(''),
  name: str('Nom : 100 caractères au plus.').max(100, 'Nom : 100 caractères au plus.').regex(/^\P{Cc}*$/u, 'Nom invalide.').default(''),
  phone: str('Téléphone : chiffres, espaces et + ( ) . / - seulement, 30 caractères au plus.')
    .max(30, 'Téléphone : 30 caractères au plus.')
    .regex(/^[0-9+()./ -]*$/, 'Téléphone : chiffres, espaces et + ( ) . / - seulement.')
    .default(''),
  // « Ouvrir exceptionnellement » : enregistre un rendez-vous un jour fermé ou hors des plages d'ouverture
  force: box,
}).refine((b) => b.client || b.name, { message: 'Choisissez une cliente ou indiquez le nom de la personne.' });

// Code de l'appli d'authentification ; les espaces affichés par certaines applis sont retirés
export const totpForm = z.object({ code: z.string({ error: 'Code à 6 chiffres.' }).transform((v) => v.replace(/\s/g, '')).pipe(z.string().regex(/^\d{6}$/, 'Code à 6 chiffres.')) });

// Équipe (/admin/utilisateurs) : rôle donné à un compte existant par son adresse, puis actions sur la ligne de la personne
const role = z.enum(['admin', 'gestionnaire'], { error: 'Choisissez Admin ou Gestionnaire.' });
const email = str('Adresse e-mail invalide.').toLowerCase().max(254, 'Adresse e-mail invalide.').email('Adresse e-mail invalide.');
export const staffForm = z.discriminatedUnion('action', [
  z.object({ action: z.literal('grant'), email, role, confirm }),
  z.object({ action: z.literal('role'), id, role, confirm }),
  // « Tous les comptes » : Aucun / Gestionnaire / Admin choisi sur la ligne du compte
  z.object({ action: z.literal('assign'), id, role: z.enum(['none', 'admin', 'gestionnaire'], { error: 'Choisissez un rôle.' }), confirm }),
  ...(['demote', 'block', 'unblock', 'remove', 'restore', 'reset_totp'] as const).map((a) => z.object({ action: z.literal(a), id, confirm })),
], { error: 'Action inconnue.' });
