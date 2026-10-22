// Textes de la prise de rendez-vous (FR / NL / EN).
import type { Lang } from '../../lib/site';
import { euros, type PromoProblem } from '../../lib/server/pricing.ts';

type Texts = {
  locale: string;
  metaTitle: string;
  description: string;
  h1: string;
  step: (n: number) => string;
  chooseService: string;
  minutes: (n: number) => string;
  deposit: (cents: number) => string;
  noDeposit: string;
  chooseDay: string;
  change: string;
  day: string;
  showSlots: string;
  prevDay: string;
  nextDay: string;
  slotsOf: (day: string) => string;
  brussels: string;
  noSlot: string;
  soon: string;
  recap: string;
  service: string;
  date: string;
  time: string;
  duration: string;
  price: string;
  discount: (code: string) => string;
  final: string;
  depositNow: string;
  rest: string;
  none: string;
  code: string;
  apply: string;
  applied: (code: string) => string;
  cgv: [before: string, link: string, after: string];
  newTab: string;
  pay: (cents: number) => string;
  confirm: string;
  payNote: string;
  cancelRule: string;
  myBookings: string;
  otherTime: string;
  err: { unavailable: string; limit: (n: number) => string; payment: string; cgv: string; invalid: string; service: string; day: (last: string) => string };
  promo: Record<PromoProblem | 'blocked', string>;
};

export const RESERVER: Record<Lang, Texts> = {
  fr: {
    locale: 'fr-BE',
    metaTitle: 'Prendre rendez-vous — My Bubble Beauty',
    description: 'Réservez votre soin en ligne chez My Bubble Beauty à Dilbeek.',
    h1: 'Prendre rendez-vous',
    step: (n) => `Étape ${n} sur 3`,
    chooseService: 'Choisissez votre prestation',
    minutes: (n) => `${n} min`,
    deposit: (c) => `acompte ${euros(c, 'fr')}`,
    noDeposit: 'sans acompte',
    chooseDay: 'Choisissez un jour et une heure',
    change: 'Changer de prestation',
    day: 'Jour',
    showSlots: 'Voir les créneaux',
    prevDay: 'Jour précédent',
    nextDay: 'Jour suivant',
    slotsOf: (d) => `Créneaux libres le ${d}`,
    brussels: 'Heures de Bruxelles.',
    noSlot: 'Aucun créneau libre ce jour-là. Essayez un autre jour.',
    soon: 'Les réservations en ligne ouvrent bientôt. En attendant, appelez-nous au',
    recap: 'Vérifiez votre rendez-vous',
    service: 'Prestation',
    date: 'Date',
    time: 'Heure',
    duration: 'Durée',
    price: 'Prix',
    discount: (code) => `Remise (${code})`,
    final: 'Prix après remise',
    depositNow: 'Acompte à payer maintenant',
    rest: 'À régler au salon',
    none: 'Aucun',
    code: 'Code promo (facultatif)',
    apply: 'Appliquer',
    applied: (code) => `Le code ${code} est appliqué.`,
    cgv: ["J'accepte les ", 'conditions générales', '.'],
    newTab: '(nouvel onglet)',
    pay: (c) => `Réserver et payer l'acompte (${euros(c, 'fr')})`,
    confirm: 'Confirmer la réservation',
    payNote: "L'acompte se paie sur la page sécurisée de Stripe, par Bancontact ou par carte.",
    cancelRule: "Annulation gratuite depuis votre compte jusqu'à 24 heures avant le rendez-vous.",
    myBookings: 'Voir mes rendez-vous',
    otherTime: 'Choisir un autre créneau',
    err: {
      unavailable: "Ce créneau n'est plus libre. Choisissez-en un autre.",
      limit: (n) => `Vous avez déjà ${n} rendez-vous à venir. Vous pourrez en prendre un autre après l'un d'eux, ou appelez-nous.`,
      payment: 'Le paiement en ligne est indisponible pour le moment. Réessayez dans quelques minutes ou appelez-nous.',
      cgv: 'Cochez la case pour accepter les conditions générales.',
      invalid: "Votre demande n'a pas pu être lue. Recommencez par le choix de la prestation.",
      service: "Cette prestation ne se réserve pas en ligne. Choisissez-en une dans la liste.",
      day: (last) => `Choisissez un jour entre aujourd'hui et le ${last}.`,
    },
    promo: {
      unknown: "Ce code promo n'existe pas.",
      inactive: "Ce code promo n'existe pas.",
      not_started: "Ce code promo n'est pas encore valable.",
      expired: 'Ce code promo a expiré.',
      service: "Ce code promo ne s'applique pas à cette prestation.",
      exhausted: "Ce code promo n'est plus disponible.",
      used: 'Vous avez déjà utilisé ce code promo.',
      blocked: 'Trop de codes essayés. Réessayez dans une heure.',
    },
  },
  nl: {
    locale: 'nl-BE',
    metaTitle: 'Afspraak maken — My Bubble Beauty',
    description: 'Boek uw behandeling online bij My Bubble Beauty in Dilbeek.',
    h1: 'Afspraak maken',
    step: (n) => `Stap ${n} van 3`,
    chooseService: 'Kies uw behandeling',
    minutes: (n) => `${n} min`,
    deposit: (c) => `voorschot ${euros(c, 'nl')}`,
    noDeposit: 'zonder voorschot',
    chooseDay: 'Kies een dag en een uur',
    change: 'Andere behandeling kiezen',
    day: 'Dag',
    showSlots: 'Toon de tijdstippen',
    prevDay: 'Vorige dag',
    nextDay: 'Volgende dag',
    slotsOf: (d) => `Vrije tijdstippen op ${d}`,
    brussels: 'Uren in Brusselse tijd.',
    noSlot: 'Geen vrij tijdstip op die dag. Probeer een andere dag.',
    soon: 'Online reserveren kan binnenkort. Bel ons intussen op',
    recap: 'Controleer uw afspraak',
    service: 'Behandeling',
    date: 'Datum',
    time: 'Uur',
    duration: 'Duur',
    price: 'Prijs',
    discount: (code) => `Korting (${code})`,
    final: 'Prijs na korting',
    depositNow: 'Nu te betalen voorschot',
    rest: 'Te betalen in het salon',
    none: 'Geen',
    code: 'Promotiecode (optioneel)',
    apply: 'Toepassen',
    applied: (code) => `De code ${code} is toegepast.`,
    cgv: ['Ik ga akkoord met de ', 'algemene voorwaarden', '.'],
    newTab: '(nieuw tabblad)',
    pay: (c) => `Reserveren en voorschot betalen (${euros(c, 'nl')})`,
    confirm: 'Reservering bevestigen',
    payNote: 'U betaalt het voorschot op de beveiligde pagina van Stripe, met Bancontact of met een kaart.',
    cancelRule: 'Gratis annuleren via uw account tot 24 uur voor de afspraak.',
    myBookings: 'Mijn afspraken bekijken',
    otherTime: 'Ander tijdstip kiezen',
    err: {
      unavailable: 'Dit tijdstip is niet meer vrij. Kies een ander tijdstip.',
      limit: (n) => `U hebt al ${n} geplande afspraken. U kunt een nieuwe maken na een ervan, of bel ons.`,
      payment: 'Online betalen is momenteel niet mogelijk. Probeer het over enkele minuten opnieuw of bel ons.',
      cgv: 'Vink het vakje aan om akkoord te gaan met de algemene voorwaarden.',
      invalid: 'Uw aanvraag kon niet gelezen worden. Begin opnieuw bij de keuze van de behandeling.',
      service: 'Deze behandeling kan niet online geboekt worden. Kies er een uit de lijst.',
      day: (last) => `Kies een dag tussen vandaag en ${last}.`,
    },
    promo: {
      unknown: 'Deze promotiecode bestaat niet.',
      inactive: 'Deze promotiecode bestaat niet.',
      not_started: 'Deze promotiecode is nog niet geldig.',
      expired: 'Deze promotiecode is verlopen.',
      service: 'Deze promotiecode geldt niet voor deze behandeling.',
      exhausted: 'Deze promotiecode is niet meer beschikbaar.',
      used: 'U hebt deze promotiecode al gebruikt.',
      blocked: 'Te veel codes geprobeerd. Probeer het over een uur opnieuw.',
    },
  },
  en: {
    locale: 'en-GB',
    metaTitle: 'Book an appointment — My Bubble Beauty',
    description: 'Book your treatment online at My Bubble Beauty in Dilbeek.',
    h1: 'Book an appointment',
    step: (n) => `Step ${n} of 3`,
    chooseService: 'Choose your treatment',
    minutes: (n) => `${n} min`,
    deposit: (c) => `deposit ${euros(c, 'en')}`,
    noDeposit: 'no deposit',
    chooseDay: 'Choose a day and a time',
    change: 'Choose another treatment',
    day: 'Day',
    showSlots: 'Show times',
    prevDay: 'Previous day',
    nextDay: 'Next day',
    slotsOf: (d) => `Free times on ${d}`,
    brussels: 'Brussels time.',
    noSlot: 'No free time on that day. Try another day.',
    soon: 'Online booking opens soon. In the meantime, call us on',
    recap: 'Check your appointment',
    service: 'Treatment',
    date: 'Date',
    time: 'Time',
    duration: 'Duration',
    price: 'Price',
    discount: (code) => `Discount (${code})`,
    final: 'Price after discount',
    depositNow: 'Deposit to pay now',
    rest: 'To pay at the salon',
    none: 'None',
    code: 'Promo code (optional)',
    apply: 'Apply',
    applied: (code) => `Code ${code} applied.`,
    cgv: ['I accept the ', 'terms and conditions', '.'],
    newTab: '(new tab)',
    // « €35 » sur ce bouton seulement, comme demandé ; le reste de la page garde l'écriture des tarifs du site
    pay: (c) => `Book and pay the deposit (€${euros(c, 'en').replace(/\s€$/, '')})`,
    confirm: 'Confirm the booking',
    payNote: "You pay the deposit on Stripe's secure page, by Bancontact or card.",
    cancelRule: 'Free cancellation from your account up to 24 hours before the appointment.',
    myBookings: 'See my appointments',
    otherTime: 'Choose another time',
    err: {
      unavailable: 'This time is no longer free. Please choose another one.',
      limit: (n) => `You already have ${n} upcoming appointments. You can book another one after one of them, or call us.`,
      payment: 'Online payment is unavailable right now. Please try again in a few minutes or call us.',
      cgv: 'Tick the box to accept the terms and conditions.',
      invalid: 'Your request could not be read. Please start again from the choice of treatment.',
      service: 'This treatment cannot be booked online. Please choose one from the list.',
      day: (last) => `Choose a day between today and ${last}.`,
    },
    promo: {
      unknown: 'This promo code does not exist.',
      inactive: 'This promo code does not exist.',
      not_started: 'This promo code is not valid yet.',
      expired: 'This promo code has expired.',
      service: 'This promo code does not apply to this treatment.',
      exhausted: 'This promo code is no longer available.',
      used: 'You have already used this promo code.',
      blocked: 'Too many codes tried. Please try again in an hour.',
    },
  },
};
