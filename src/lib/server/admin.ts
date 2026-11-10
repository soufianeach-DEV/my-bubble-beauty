// Gestion de l'institut par l'admin : prestations, horaires, fermetures, codes promo, saisie et annulation de rendez-vous.
// Toute saisie passe par un schéma de admin-form.ts, toute requête est paramétrée, toute modification est journalisée avec l'admin.
import { t } from '../site.ts';
import { agendaForm, bulkServiceForm, deleteBookingForm, closureForm, hoursForm, idForm, newBookingForm, promoForm, serviceForm, toggleForm } from './admin-form.ts';
import { cancelByAdmin, createAdminBooking, deleteBooking, markRefundedManually, rescheduleByAdmin, setLate, setNoShow, setPayment } from './booking.ts';
import { giftClients } from './cadeaux.ts';
import { sql } from './db.ts';
import { journal } from './journal.ts';

export type Result = { ok: true; id: number; key?: string; day?: string } | { ok: false; error: string };

// Défense en profondeur : le middleware garde déjà /admin, chaque page relit le rôle et le code validé avant d'agir.
// staffId : pages de la gestionnaire (accueil, agenda, rendez-vous, clientes, prestations) ; adminId : tout le reste, refusé par défaut.
export const staffId = (l: App.Locals) => (l.user?.role && l.session?.mfaAt ? l.user.id : null);
export const adminId = (l: App.Locals) => ((l.user?.role === 'super' || l.user?.role === 'admin') && l.session?.mfaAt ? l.user.id : null);

// Corps au-delà de 64 Kio : la lecture lève, la page répond 413
export async function readForm(request: Request) {
  try {
    return await request.formData();
  } catch {
    return null;
  }
}

// Journal en base et sur stdout ; booking_id et client_id deviennent des colonnes filtrables de l'écran Journal
export const audit = (userId: number, action: string, { booking_id, client_id, ...data }: Record<string, unknown> = {}) =>
  journal('admin_action', { actor: userId, booking: (booking_id as number) ?? null, client: (client_id as number) ?? null, details: { action, ...data } });
const fields = (form: FormData) => Object.fromEntries(form);
const first = (e: { issues: { message: string }[] }): Result => ({ ok: false, error: e.issues[0]?.message ?? 'Saisie invalide.' });
const pgCode = (e: unknown) => (e as { code?: string })?.code;

// Catégories dans l'ordre et avec les libellés des filtres de la page Tarifs
export const CATEGORIES = t('fr').home.tarifs.filters.filter((f) => f.key !== 'all');
export const byCategory = <T extends { category: string }>(list: T[]) => CATEGORIES.map((c) => ({ ...c, items: list.filter((s) => s.category === c.key) }));

// Affichage à l'heure de Bruxelles, quel que soit le fuseau du serveur
const BXL = { timeZone: 'Europe/Brussels' } as const;
export const fmtTime = new Intl.DateTimeFormat('fr-BE', { ...BXL, hour: '2-digit', minute: '2-digit' }).format;
export const fmtDateTime = new Intl.DateTimeFormat('fr-BE', { ...BXL, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format;
const dayFormat = new Intl.DateTimeFormat('fr-BE', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
export const fmtDay = (day: string) => dayFormat.format(new Date(`${day}T12:00:00Z`));

// Prestations : jamais supprimées (les rendez-vous passés y renvoient), seulement retirées de la réservation en ligne
export type Service = { id: number; category: string; name_fr: string; name_nl: string; name_en: string; duration_min: number | null; buffer_min: number; price_cents: number; deposit_cents: number; active: boolean; sort: number };
export const listServices = () =>
  sql<Service[]>`SELECT id, category, name_fr, name_nl, name_en, duration_min, buffer_min, price_cents, deposit_cents, active, sort FROM services WHERE retired_at IS NULL ORDER BY sort, id`;
// Agenda, vue semaine : première ouverture et dernière fermeture de la semaine, en minutes depuis minuit (null si tout est fermé)
export async function openingSpan(): Promise<{ from: number; to: number } | null> {
  const [r] = await sql<{ from: number | null; to: number | null }[]>`
    SELECT (extract(epoch FROM min(opens)) / 60)::int AS "from", (extract(epoch FROM max(closes)) / 60)::int AS "to" FROM opening_hours`;
  return r.from === null || r.to === null ? null : { from: r.from, to: r.to };
}
// Page Prestations : avec le nombre de rendez-vous confirmés pris sur les 30 derniers jours (une seule requête)
export const listServicesWithStats = () =>
  sql<(Service & { booked_30d: number })[]>`SELECT s.id, s.category, s.name_fr, s.name_nl, s.name_en, s.duration_min, s.buffer_min, s.price_cents, s.deposit_cents, s.active, s.sort,
      (SELECT count(*)::int FROM bookings b WHERE b.service_id = s.id AND b.status = 'confirmed' AND b.created_at > now() - interval '30 days') AS booked_30d
    FROM services s WHERE s.retired_at IS NULL ORDER BY s.sort, s.id`;

export async function saveService(userId: number, form: FormData): Promise<Result> {
  const p = serviceForm.safeParse(fields(form));
  if (!p.success) return first(p.error);
  const s = p.data;
  const [r] = await sql`
    UPDATE services SET name_fr = ${s.name_fr}, name_nl = ${s.name_nl}, name_en = ${s.name_en}, duration_min = ${s.duration}, buffer_min = ${s.buffer},
      price_cents = ${s.price}, deposit_cents = 0, sort = ${s.sort}, active = ${s.active},
      -- Valeurs d'avant la mise à jour : une durée changée ici n'est plus reprise de la carte, une fermeture ici n'est plus rouverte au démarrage
      duration_manual = duration_manual OR duration_min IS DISTINCT FROM ${s.duration}, closed_by_admin = NOT ${s.active}
    WHERE id = ${s.id} RETURNING id`;
  if (!r) return { ok: false, error: 'Prestation introuvable.' };
  audit(userId, 'service_saved', { service_id: s.id, active: s.active, duration: s.duration, buffer: s.buffer, price: s.price });
  return { ok: true, id: s.id };
}

// Lot : la durée saisie va d'abord à toute la sélection, puis en ligne / hors ligne.
// Une prestation encore sans durée reste hors ligne (même règle que la contrainte en base) et est comptée à part.
export async function bulkServices(userId: number, form: FormData): Promise<{ ok: true; changed: number; skipped: number } | { ok: false; error: string }> {
  const p = bulkServiceForm.safeParse({ ids: form.getAll('ids'), bulk: form.get('bulk') ?? undefined, duration: form.get('duration') ?? '' });
  if (!p.success) return first(p.error) as { ok: false; error: string };
  const { ids, bulk: active, duration } = p.data;
  return sql.begin(async (tx) => {
    if (duration !== null) await tx`UPDATE services SET duration_min = ${duration}, duration_manual = true WHERE id = ANY(${ids}::bigint[])`;
    const done = await tx`UPDATE services SET active = ${active}, closed_by_admin = ${!active} WHERE id = ANY(${ids}::bigint[]) AND (${!active} OR duration_min IS NOT NULL) RETURNING id`;
    audit(userId, 'services_bulk', { count: ids.length, active, duration, changed: done.length });
    return { ok: true as const, changed: done.length, skipped: ids.length - done.length };
  });
}

// Horaires : plusieurs plages par jour, une plage inversée est refusée (aussi par la contrainte en base)
export const listHours = () =>
  sql<{ id: number; weekday: number; opens: string; closes: string }[]>`
    SELECT id, weekday, to_char(opens, 'HH24:MI') AS opens, to_char(closes, 'HH24:MI') AS closes FROM opening_hours ORDER BY weekday, opens`;

export async function addHours(userId: number, form: FormData): Promise<Result> {
  const p = hoursForm.safeParse(fields(form));
  if (!p.success) return first(p.error);
  const [r] = await sql`INSERT INTO opening_hours (weekday, opens, closes) VALUES (${p.data.weekday}, ${p.data.opens}, ${p.data.closes}) RETURNING id`;
  audit(userId, 'hours_added', { hours_id: r.id, ...p.data });
  return { ok: true, id: r.id };
}

export async function deleteHours(userId: number, form: FormData): Promise<Result> {
  const p = idForm.safeParse(fields(form));
  if (!p.success) return first(p.error);
  const [r] = await sql`DELETE FROM opening_hours WHERE id = ${p.data.id} RETURNING id`;
  if (!r) return { ok: false, error: 'Plage introuvable (déjà supprimée ?).' };
  audit(userId, 'hours_deleted', { hours_id: r.id });
  return { ok: true, id: r.id };
}

// Fermetures à venir ou en cours ; les passées ne servent plus au calcul des créneaux
// Rendez-vous déjà pris qui tombent dans une fermeture à venir : la fermeture ne les annule pas, l'admin les voit et prévient la cliente
export const closureConflicts = () =>
  sql<{ id: number; starts_at: Date; service: string; name: string | null; phone: string | null; user_id: number | null; reason: string }[]>`
    SELECT DISTINCT ON (b.id) b.id, b.starts_at, s.name_fr AS service, coalesce(u.name, b.guest_name) AS name, coalesce(u.phone, b.guest_phone) AS phone, b.user_id, c.reason
    FROM closures c JOIN bookings b ON b.starts_at < c.ends_at AND b.ends_at > c.starts_at AND b.status IN ('confirmed', 'pending_payment')
    JOIN services s ON s.id = b.service_id LEFT JOIN users u ON u.id = b.user_id
    WHERE c.ends_at > now() AND b.ends_at > now() ORDER BY b.id, c.starts_at`;

export const listClosures = () =>
  sql<{ id: number; starts_at: Date; ends_at: Date; reason: string }[]>`SELECT id, starts_at, ends_at, reason FROM closures WHERE ends_at > now() ORDER BY starts_at`;

export async function addClosure(userId: number, form: FormData): Promise<Result> {
  const p = closureForm.safeParse(fields(form));
  if (!p.success) return first(p.error);
  const c = p.data;
  try {
    // Heure locale convertie par Postgres (changements d'heure). Passée en text : un paramètre typé timestamp serait relu
    // par postgres.js avec new Date(), donc dans le fuseau du serveur Node
    const [r] = await sql`
      INSERT INTO closures (starts_at, ends_at, reason)
      VALUES (${c.starts}::text::timestamp AT TIME ZONE 'Europe/Brussels', ${c.ends}::text::timestamp AT TIME ZONE 'Europe/Brussels', ${c.reason}) RETURNING id`;
    audit(userId, 'closure_added', { closure_id: r.id, starts: c.starts, ends: c.ends });
    return { ok: true, id: r.id };
  } catch (e) {
    // Heure inexistante la nuit du passage à l'heure d'été : l'ordre peut s'inverser après conversion
    if (pgCode(e) === '23514') return { ok: false, error: 'La fin de la fermeture doit suivre son début.' };
    throw e;
  }
}

export async function deleteClosure(userId: number, form: FormData): Promise<Result> {
  const p = idForm.safeParse(fields(form));
  if (!p.success) return first(p.error);
  const [r] = await sql`DELETE FROM closures WHERE id = ${p.data.id} RETURNING id`;
  if (!r) return { ok: false, error: 'Fermeture introuvable (déjà supprimée ?).' };
  audit(userId, 'closure_deleted', { closure_id: r.id });
  return { ok: true, id: r.id };
}

// Codes promo : utilisations = réservations en attente ou confirmées qui le portent ; désactivés, jamais supprimés
export type PromoRow = { id: number; code: string; kind: 'percent' | 'amount'; value: number; starts_on: string | null; ends_on: string | null; max_uses: number | null; once_per_user: boolean; service_ids: number[] | null; active: boolean; uses: number };
export const listPromos = () =>
  sql<PromoRow[]>`
    SELECT p.id, p.code, p.kind, p.value, p.starts_on::text, p.ends_on::text, p.max_uses, p.once_per_user, p.service_ids, p.active,
      (SELECT count(*) FROM bookings b WHERE b.promo_code_id = p.id AND b.status IN ('pending_payment', 'confirmed')) AS uses
    FROM promo_codes p ORDER BY p.active DESC, p.code`;

export async function savePromo(userId: number, form: FormData): Promise<Result> {
  const p = promoForm.safeParse({ ...fields(form), services: form.getAll('services') });
  if (!p.success) return first(p.error);
  const { id, ...row } = p.data;
  try {
    const [r] = id
      ? await sql`UPDATE promo_codes SET ${sql(row)} WHERE id = ${id} RETURNING id`
      : await sql`INSERT INTO promo_codes ${sql(row)} RETURNING id`;
    if (!r) return { ok: false, error: 'Code introuvable.' };
    audit(userId, id ? 'promo_updated' : 'promo_created', { promo_id: r.id, code: row.code, active: row.active });
    return { ok: true, id: r.id };
  } catch (e) {
    if (pgCode(e) === '23505') return { ok: false, error: 'Ce code existe déjà.' };
    throw e;
  }
}

export async function togglePromo(userId: number, form: FormData): Promise<Result> {
  const p = toggleForm.safeParse(fields(form));
  if (!p.success) return first(p.error);
  const [r] = await sql`UPDATE promo_codes SET active = ${p.data.active} WHERE id = ${p.data.id} RETURNING id`;
  if (!r) return { ok: false, error: 'Code introuvable.' };
  audit(userId, p.data.active ? 'promo_enabled' : 'promo_disabled', { promo_id: r.id });
  return { ok: true, id: r.id };
}

// Agenda : annuler (remboursement au choix) ou relancer le remboursement d'un acompte resté chez l'institut
// Suppression d'un rendez-vous par l'admin : volontairement absente du journal (demande de la gérante) ; seule action dans ce cas
export async function deleteAction(form: FormData): Promise<Result> {
  const p = deleteBookingForm.safeParse(fields(form));
  if (!p.success) return first(p.error);
  return (await deleteBooking(p.data.id, p.data.notify)) ? { ok: true, id: p.data.id, key: 'supprime' } : { ok: false, error: 'Rendez-vous introuvable.' };
}

export async function agendaAction(userId: number, form: FormData): Promise<Result> {
  const p = agendaForm.safeParse(fields(form));
  if (!p.success) return first(p.error);
  const { action, id } = p.data;
  if (action === 'no_show' || action === 'show') {
    const b = await setNoShow(id, action === 'no_show');
    if (b === 'gift') return { ok: false, error: "Le bon cadeau de ce rendez-vous sert déjà à un autre rendez-vous : l'absence reste notée." };
    if (!b) return { ok: false, error: 'Seul un rendez-vous confirmé et passé peut être marqué.' };
    audit(userId, action === 'no_show' ? 'booking_no_show' : 'booking_attended', { booking_id: id, client_id: b.user_id });
    return { ok: true, id, key: action === 'no_show' ? 'absente' : 'venue' };
  }
  if (action === 'late' || action === 'on_time') {
    const b = await setLate(id, action === 'late' ? (p.data.late as number) : null);
    if (!b) return { ok: false, error: 'Seul un rendez-vous confirmé, passé et honoré peut porter un retard.' };
    audit(userId, action === 'late' ? 'booking_late' : 'booking_on_time', { booking_id: id, client_id: b.user_id, ...(action === 'late' ? { minutes: p.data.late } : {}) });
    return { ok: true, id, key: action === 'late' ? 'retard' : 'aheure' };
  }
  if (action === 'pay' || action === 'unpay') {
    const b = await setPayment(id, action === 'pay' ? p.data.method! : null, action === 'pay' ? (p.data.amount as number) : null);
    if (!b) return { ok: false, error: 'Seul un rendez-vous confirmé, passé et honoré peut être encaissé.' };
    audit(userId, action === 'pay' ? 'booking_paid' : 'booking_unpaid', { booking_id: id, client_id: b.user_id, ...(action === 'pay' ? { method: p.data.method, amount: p.data.amount } : {}) });
    return { ok: true, id, key: action === 'pay' ? 'encaisse' : 'nonencaisse' };
  }
  if (action === 'manual_refund') {
    const b = await markRefundedManually(id);
    if (!b) return { ok: false, error: 'Aucun acompte à rendre sur ce rendez-vous.' };
    audit(userId, 'booking_refund_manual', { booking_id: id, client_id: b.user_id, amount: b.amount });
    return { ok: true, id, key: 'rendu' };
  }
  if (action === 'move') {
    const r = await rescheduleByAdmin(id, p.data.day!, p.data.time!);
    if (r === 'not_found') return { ok: false, error: 'Seul un rendez-vous confirmé peut être déplacé.' };
    if (r === 'unavailable') return { ok: false, error: 'Ce créneau chevauche un autre rendez-vous ou un paiement en cours : choisissez une autre heure.' };
    audit(userId, 'booking_moved', { booking_id: id, day: p.data.day, time: p.data.time });
    return { ok: true, id, key: 'deplace', day: p.data.day! };
  }
  const refund = action === 'refund' || p.data.refund;
  // Rendez-vous jamais payé : son annulation par l'institut ne va pas au journal (demande de la gérante) ; la ligne du rendez-vous
  // reste en base, statut « annulé ». Un rendez-vous payé (acompte, Stripe) reste toujours tracé, pour la comptabilité.
  const [pay] = await sql<{ paid: boolean }[]>`SELECT stripe_payment_intent IS NOT NULL OR deposit_cents > 0 OR refunded_cents > 0 AS paid FROM bookings WHERE id = ${id}`;
  const r = await cancelByAdmin(id, refund);
  if (!r.ok) return { ok: false, error: 'Rendez-vous introuvable ou déjà terminé.' };
  if (pay?.paid || refund) audit(userId, action === 'refund' ? 'booking_refund' : 'booking_cancel', { booking_id: id, refund, refunded: r.refunded });
  return { ok: true, id, key: r.refunded ? 'rembourse' : refund ? 'echec' : 'annule' };
}

// Rendez-vous pris par téléphone ou WhatsApp, à l'heure de Bruxelles ; seul un chevauchement le refuse
export async function newBooking(userId: number, form: FormData): Promise<Result> {
  const p = newBookingForm.safeParse(fields(form));
  if (!p.success) return first(p.error);
  const b = p.data;
  const [{ at, open }] = await sql<{ at: Date; open: boolean }[]>`
    WITH t AS (SELECT (${b.day}::text::date + ${b.time}::time) AT TIME ZONE 'Europe/Brussels' AS at),
      len AS (SELECT make_interval(mins => coalesce(duration_min, 0) + buffer_min) AS l FROM services WHERE id = ${b.service})
    SELECT t.at,
      -- Dans une plage d'ouverture du jour et hors fermeture : sinon l'admin doit cocher « Ouvrir exceptionnellement »
      EXISTS (SELECT 1 FROM opening_hours h, len WHERE h.weekday = extract(isodow FROM ${b.day}::text::date)
        -- En intervalles : time + interval repasse par minuit (23:30 + 1 h = 00:30), le créneau paraissait alors ouvert
        AND ${b.time}::time >= h.opens AND ${b.time}::time::interval + len.l <= h.closes::interval)
      AND NOT EXISTS (SELECT 1 FROM closures c, len WHERE c.starts_at < t.at + len.l AND c.ends_at > t.at) AS open
    FROM t`;
  if (!open && !b.force) return { ok: false, error: "Ce créneau est en dehors des heures d'ouverture (jour fermé, hors plage ou fermeture). Cochez « Ouvrir exceptionnellement » pour l'enregistrer quand même." };
  // Cliente choisie dans la liste : même périmètre que les bons cadeaux (comptes actifs) ; une saisie inconnue est refusée
  let clientId: number | null = null;
  if (b.client) {
    const email = (/<([^<>]+)>\s*$/.exec(b.client)?.[1] ?? b.client).trim().toLowerCase();
    const c = (await giftClients()).find((x) => x.email === email);
    if (!c) return { ok: false, error: 'Cliente introuvable : choisissez-la dans la liste, ou videz le champ et indiquez un nom pour une personne sans compte.' };
    clientId = Number(c.id);
  }
  const r = await createAdminBooking({ serviceId: b.service, startsAt: at, guestName: b.name, guestPhone: b.phone || null, userId: clientId });
  if (!r.ok)
    return {
      ok: false,
      error: r.error === 'unavailable'
        ? 'Ce créneau chevauche un rendez-vous déjà pris ou un paiement en cours : choisissez une autre heure.'
        : 'Prestation introuvable ou sans durée : complétez sa durée dans Prestations.',
    };
  audit(userId, 'booking_created', { booking_id: r.id, client_id: clientId, exceptional: !open });
  return { ok: true, id: r.id, day: b.day };
}
