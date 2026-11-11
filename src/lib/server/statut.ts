// Statut lisible d'un rendez-vous, le même à l'Accueil, dans l'Agenda et sur la fiche cliente.
// Calculé depuis les colonnes de bookings : rien n'est stocké en plus. Une séance de forfait est déjà payée (à la vente du forfait).
export type RdvLike = {
  status: string; no_show: boolean; past: boolean; ended?: boolean;
  paid_method: string | null; package: unknown; arrived_at?: Date | null;
};
export type Tone = 'ok' | 'wait' | 'alert' | 'off' | 'due' | 'soon';

export function rdvStatus(r: RdvLike): { label: string; tone: Tone } {
  if (r.status === 'cancelled') return { label: 'Annulé', tone: 'off' };
  if (r.status === 'expired') return { label: 'Expiré', tone: 'off' };
  if (r.status === 'pending_payment') return { label: 'Paiement en cours', tone: 'wait' };
  if (r.no_show) return { label: 'Absente', tone: 'alert' };
  const begun = r.past || !!r.arrived_at;
  if (begun && (r.paid_method || r.package)) return { label: 'Honoré · Payé', tone: 'ok' };
  if (r.ended) return { label: 'À encaisser', tone: 'due' };
  if (r.past) return { label: 'En cours', tone: 'wait' };
  if (r.arrived_at) return { label: 'Arrivée', tone: 'wait' };
  return { label: 'À venir', tone: 'soon' };
}
