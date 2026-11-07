// E-mails transactionnels (API Resend, sans SDK) dans les trois langues. Texte brut et HTML échappé ; liens construits depuis SITE_URL.
// Avant vérification de l'adresse, aucun champ saisi n'y figure : le salon ne sert pas de relais à un message écrit par un tiers.
import { MAIL_FROM, RESEND_API_KEY, SITE_URL } from 'astro:env/server';
import { CONTACT, FOLDER, type Lang } from '../site.ts';
import { log } from './log.ts';
import { euros } from './pricing.ts';

export type Mail = { kind: string; subject: string; text: string; html: string };
export type BookingMail = { service: string; starts_at: Date; price_cents: number; discount_cents: number; deposit_cents: number };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const accountUrl = (lang: Lang, path = '') => `${SITE_URL}/${FOLDER[lang]}/compte${path}`;
const ADDRESS = `${CONTACT.street}, ${CONTACT.postal} ${CONTACT.city}`;
const LOCALE: Record<Lang, string> = { fr: 'fr-BE', nl: 'nl-BE', en: 'en-GB' };
const when = (d: Date, lang: Lang) => new Intl.DateTimeFormat(LOCALE[lang], { timeZone: 'Europe/Brussels', dateStyle: 'full', timeStyle: 'short' }).format(d);

function build(kind: string, lang: Lang, subject: string, lines: (string | false)[], link: [label: string, url: string]): Mail {
  const body = lines.filter((l): l is string => !!l);
  const foot = `My Bubble Beauty - ${ADDRESS} - ${CONTACT.phoneLabel}`;
  return {
    kind,
    subject,
    text: [...body, `${link[0]}\n${link[1]}`, foot].join('\n\n'),
    html: `<!doctype html><html lang="${lang}"><body style="font-family:Arial,sans-serif;color:#222;line-height:1.5">${body.map((l) => `<p>${esc(l)}</p>`).join('')}<p><a href="${esc(link[1])}">${esc(link[0])}</a></p><p style="color:#777;font-size:13px">${esc(foot)}</p></body></html>`,
  };
}

const T = {
  fr: {
    hello: 'Bonjour,',
    verify: ['Confirmez votre adresse e-mail', 'Pour activer votre compte My Bubble Beauty, ouvrez le lien ci-dessous puis saisissez votre mot de passe. Il est valable 24 heures.', "Si vous n'avez pas créé de compte, ignorez simplement cet e-mail.", 'Confirmer mon adresse'],
    exists: ['Vous avez déjà un compte', "Une inscription vient d'être demandée avec cette adresse, qui a déjà un compte chez My Bubble Beauty. Connectez-vous avec votre mot de passe habituel.", 'Mot de passe oublié ? Choisissez-en un nouveau avec le lien ci-dessous.', "Si ce n'était pas vous, ignorez cet e-mail : rien n'a changé.", 'Choisir un nouveau mot de passe'],
    reset: ['Choisissez un nouveau mot de passe', 'Vous avez demandé à changer de mot de passe. Le lien ci-dessous est valable 30 minutes et ne sert qu\'une fois.', "Si vous n'avez rien demandé, ignorez cet e-mail : votre mot de passe reste le même.", 'Choisir mon mot de passe'],
    login: ['Votre lien de connexion', "Voici votre lien pour vous connecter à votre compte My Bubble Beauty. Il est valable 15 minutes et ne sert qu'une fois.", "Si vous n'avez rien demandé, ignorez cet e-mail : personne ne peut se connecter sans ce lien.", 'Me connecter'],
    changed: ['Votre mot de passe a été modifié', "Le mot de passe de votre compte My Bubble Beauty vient d'être modifié.", `Si ce n'est pas vous, choisissez tout de suite un nouveau mot de passe avec le lien ci-dessous, puis appelez-nous au ${CONTACT.phoneLabel}.`, 'Choisir un nouveau mot de passe'],
    confirmed: 'Votre rendez-vous est confirmé',
    confirmedIntro: 'Votre rendez-vous chez My Bubble Beauty est confirmé.',
    service: 'Prestation : ', date: 'Date : ', price: 'Prix : ', discount: (d: string) => ` (remise de ${d} déduite)`,
    deposit: 'Acompte payé : ', rest: 'Reste à régler au salon : ', address: 'Adresse : ',
    rules: `Vous pouvez annuler gratuitement depuis votre compte jusqu'à 24 heures avant le rendez-vous ; l'acompte est alors remboursé. Ensuite, appelez-nous au ${CONTACT.phoneLabel}.`,
    cancelled: 'Votre rendez-vous est annulé',
    cancelledIntro: (w: string, s: string) => `Votre rendez-vous du ${w} (${s}) est annulé.`,
    refund: (x: string) => `L'acompte de ${x} vous sera remboursé. Le délai dépend de votre banque.`,
    again: 'Pour reprendre rendez-vous, passez par votre compte.',
    account: 'Voir mon compte',
    deleted: "Votre compte va être supprimé",
    deletedIntro: (d: number) => `Votre compte My Bubble Beauty est supprimé. Vous avez ${d} jours pour changer d'avis : reconnectez-vous avec votre adresse et votre mot de passe, puis choisissez « Réactiver mon compte ». Passé ce délai, il est effacé définitivement.`,
    deletedBookings: (n: number) => `${n} rendez-vous à venir ${n > 1 ? "ont été annulés" : "a été annulé"}.`,
    deletedRefund: `L'acompte payé vous sera remboursé par l'institut. Pour toute question, appelez-nous au ${CONTACT.phoneLabel}.`,
    erased: ["Votre compte est effacé", "Votre compte My Bubble Beauty et vos données personnelles sont effacés. Les rendez-vous passés restent dans notre comptabilité, sans votre nom.", "Vous pouvez créer un nouveau compte à tout moment."],
    moved: "Votre rendez-vous est déplacé",
    movedIntro: "Votre rendez-vous chez My Bubble Beauty a été déplacé. Voici la nouvelle date.",
    reminder: "Rappel : votre rendez-vous de demain",
    reminderIntro: "Nous vous rappelons votre rendez-vous chez My Bubble Beauty.",
    reminderLate: `Un empêchement ? Moins de 24 heures avant, appelez-nous au ${CONTACT.phoneLabel}.`,
    create: "Créer un compte",
  },
  nl: {
    hello: 'Hallo,',
    verify: ['Bevestig uw e-mailadres', 'Open de link hieronder en vul uw wachtwoord in om uw account bij My Bubble Beauty te activeren. De link is 24 uur geldig.', 'Hebt u geen account aangemaakt? Dan kunt u deze e-mail negeren.', 'Mijn adres bevestigen'],
    exists: ['U hebt al een account', 'Er werd net een registratie aangevraagd met dit adres, dat al een account heeft bij My Bubble Beauty. Log in met uw gewone wachtwoord.', 'Wachtwoord vergeten? Kies een nieuw wachtwoord via de link hieronder.', 'Was u dit niet? Negeer dan deze e-mail: er is niets gewijzigd.', 'Nieuw wachtwoord kiezen'],
    reset: ['Kies een nieuw wachtwoord', 'U hebt gevraagd om uw wachtwoord te wijzigen. De link hieronder is 30 minuten geldig en werkt maar één keer.', 'Hebt u niets gevraagd? Negeer dan deze e-mail: uw wachtwoord blijft hetzelfde.', 'Mijn wachtwoord kiezen'],
    login: ['Uw inloglink', 'Met de link hieronder logt u in op uw account bij My Bubble Beauty. Hij is 15 minuten geldig en werkt maar één keer.', 'Hebt u niets gevraagd? Negeer dan deze e-mail: zonder deze link kan niemand inloggen.', 'Inloggen'],
    changed: ['Uw wachtwoord is gewijzigd', 'Het wachtwoord van uw account bij My Bubble Beauty is net gewijzigd.', `Was u dit niet? Kies dan meteen een nieuw wachtwoord via de link hieronder en bel ons op ${CONTACT.phoneLabel}.`, 'Nieuw wachtwoord kiezen'],
    confirmed: 'Uw afspraak is bevestigd',
    confirmedIntro: 'Uw afspraak bij My Bubble Beauty is bevestigd.',
    service: 'Behandeling: ', date: 'Datum: ', price: 'Prijs: ', discount: (d: string) => ` (korting van ${d} afgetrokken)`,
    deposit: 'Betaald voorschot: ', rest: 'Te betalen in het salon: ', address: 'Adres: ',
    rules: `U kunt tot 24 uur voor de afspraak gratis annuleren via uw account; het voorschot wordt dan terugbetaald. Daarna belt u ons op ${CONTACT.phoneLabel}.`,
    cancelled: 'Uw afspraak is geannuleerd',
    cancelledIntro: (w: string, s: string) => `Uw afspraak van ${w} (${s}) is geannuleerd.`,
    refund: (x: string) => `Het voorschot van ${x} wordt u terugbetaald. De termijn hangt af van uw bank.`,
    again: 'Een nieuwe afspraak maakt u via uw account.',
    account: 'Mijn account bekijken',
    deleted: "Uw account wordt verwijderd",
    deletedIntro: (d: number) => `Uw account bij My Bubble Beauty is verwijderd. U hebt ${d} dagen om van gedachten te veranderen: log opnieuw in met uw adres en wachtwoord en kies « Mijn account heractiveren ». Daarna wordt het definitief gewist.`,
    deletedBookings: (n: number) => `${n} komende ${n > 1 ? "afspraken werden" : "afspraak werd"} geannuleerd.`,
    deletedRefund: `Het betaalde voorschot wordt u door het instituut terugbetaald. Vragen? Bel ons op ${CONTACT.phoneLabel}.`,
    erased: ["Uw account is gewist", "Uw account bij My Bubble Beauty en uw persoonsgegevens zijn gewist. Voorbije afspraken blijven in onze boekhouding, zonder uw naam.", "U kunt op elk moment een nieuw account aanmaken."],
    moved: "Uw afspraak is verplaatst",
    movedIntro: "Uw afspraak bij My Bubble Beauty werd verplaatst. Dit is de nieuwe datum.",
    reminder: "Herinnering: uw afspraak van morgen",
    reminderIntro: "We herinneren u aan uw afspraak bij My Bubble Beauty.",
    reminderLate: `Verhinderd? Minder dan 24 uur op voorhand belt u ons op ${CONTACT.phoneLabel}.`,
    create: "Een account aanmaken",
  },
  en: {
    hello: 'Hello,',
    verify: ['Confirm your email address', 'To activate your My Bubble Beauty account, open the link below and enter your password. The link is valid for 24 hours.', 'If you did not create an account, just ignore this email.', 'Confirm my address'],
    exists: ['You already have an account', 'Someone just asked to sign up with this address, which already has a My Bubble Beauty account. Log in with your usual password.', 'Forgot your password? Choose a new one with the link below.', "If this wasn't you, ignore this email: nothing has changed.", 'Choose a new password'],
    reset: ['Choose a new password', 'You asked to change your password. The link below is valid for 30 minutes and works only once.', "If you didn't ask for this, ignore this email: your password stays the same.", 'Choose my password'],
    login: ['Your login link', 'Here is your link to log in to your My Bubble Beauty account. It is valid for 15 minutes and works only once.', "If you didn't ask for this, ignore this email: nobody can log in without this link.", 'Log in'],
    changed: ['Your password has been changed', 'The password of your My Bubble Beauty account has just been changed.', `If this wasn't you, choose a new password right away with the link below, then call us on ${CONTACT.phoneLabel}.`, 'Choose a new password'],
    confirmed: 'Your appointment is confirmed',
    confirmedIntro: 'Your appointment at My Bubble Beauty is confirmed.',
    service: 'Treatment: ', date: 'Date: ', price: 'Price: ', discount: (d: string) => ` (${d} discount applied)`,
    deposit: 'Deposit paid: ', rest: 'To pay at the salon: ', address: 'Address: ',
    rules: `You can cancel free of charge from your account up to 24 hours before the appointment; the deposit is then refunded. After that, please call us on ${CONTACT.phoneLabel}.`,
    cancelled: 'Your appointment is cancelled',
    cancelledIntro: (w: string, s: string) => `Your appointment on ${w} (${s}) is cancelled.`,
    refund: (x: string) => `Your deposit of ${x} will be refunded. The time it takes depends on your bank.`,
    again: 'To book again, go to your account.',
    account: 'View my account',
    deleted: "Your account is being deleted",
    deletedIntro: (d: number) => `Your My Bubble Beauty account has been deleted. You have ${d} days to change your mind: log in again with your address and password, then choose “Reactivate my account”. After that, it is erased for good.`,
    deletedBookings: (n: number) => `${n} upcoming ${n > 1 ? "appointments have" : "appointment has"} been cancelled.`,
    deletedRefund: `The salon will refund the deposit you paid. Any questions? Call us on ${CONTACT.phoneLabel}.`,
    erased: ["Your account has been erased", "Your My Bubble Beauty account and your personal data have been erased. Past appointments stay in our accounts, without your name.", "You can create a new account at any time."],
    moved: "Your appointment has been moved",
    movedIntro: "Your appointment at My Bubble Beauty has been moved. Here is the new date.",
    reminder: "Reminder: your appointment tomorrow",
    reminderIntro: "This is a reminder of your appointment at My Bubble Beauty.",
    reminderLate: `Can't make it? Less than 24 hours before, please call us on ${CONTACT.phoneLabel}.`,
    create: "Create an account",
  },
} as const;

export function verifyMail(lang: Lang, token: string): Mail {
  const [subject, a, b, label] = T[lang].verify;
  return build('verify', lang, subject, [T[lang].hello, a, b], [label, accountUrl(lang, `/verification?token=${token}`)]);
}

// Inscription sur une adresse déjà prise (vérifiée ou non) : aucune route de renvoi, la propriétaire passe par « mot de passe oublié »
export function existsMail(lang: Lang): Mail {
  const [subject, a, b, c, label] = T[lang].exists;
  return build('exists', lang, subject, [T[lang].hello, a, b, c], [label, accountUrl(lang, '/mot-de-passe-oublie')]);
}

export function resetMail(lang: Lang, token: string): Mail {
  const [subject, a, b, label] = T[lang].reset;
  return build('reset', lang, subject, [T[lang].hello, a, b], [label, accountUrl(lang, `/nouveau-mot-de-passe?token=${token}`)]);
}

export function loginLinkMail(lang: Lang, token: string): Mail {
  const [subject, a, b, label] = T[lang].login;
  return build('login_link', lang, subject, [T[lang].hello, a, b], [label, accountUrl(lang, `/lien?token=${token}`)]);
}

export function passwordChangedMail(lang: Lang): Mail {
  const [subject, a, b, label] = T[lang].changed;
  return build('password_changed', lang, subject, [T[lang].hello, a, b], [label, accountUrl(lang, '/mot-de-passe-oublie')]);
}

export function bookingConfirmedMail(lang: Lang, b: BookingMail): Mail {
  const t = T[lang];
  const final = b.price_cents - b.discount_cents;
  return build('booking_confirmed', lang, t.confirmed, [
    t.hello,
    t.confirmedIntro,
    t.service + b.service,
    t.date + when(b.starts_at, lang),
    t.price + euros(final, lang) + (b.discount_cents ? t.discount(euros(b.discount_cents, lang)) : ''),
    b.deposit_cents > 0 && t.deposit + euros(b.deposit_cents, lang),
    b.deposit_cents > 0 && t.rest + euros(final - b.deposit_cents, lang),
    t.address + ADDRESS,
    t.rules,
  ], [t.account, accountUrl(lang)]);
}

// refund = montant dont le remboursement est demandé à Stripe (0 si rien n'est rendu)
export function bookingCancelledMail(lang: Lang, b: BookingMail, refund: number): Mail {
  const t = T[lang];
  return build('booking_cancelled', lang, t.cancelled, [t.hello, t.cancelledIntro(when(b.starts_at, lang), b.service), refund > 0 && t.refund(euros(refund, lang)), t.again], [t.account, accountUrl(lang)]);
}

// Suppression douce : délai pour revenir, rendez-vous annulés, acompte rendu hors du site
export function accountDeletedMail(lang: Lang, days: number, cancelled: number, refundDue: boolean): Mail {
  const t = T[lang];
  return build('account_deleted', lang, t.deleted, [t.hello, t.deletedIntro(days), cancelled > 0 && t.deletedBookings(cancelled), refundDue && t.deletedRefund], [t.account, accountUrl(lang, '/connexion')]);
}

export function accountErasedMail(lang: Lang): Mail {
  const [subject, a, b] = T[lang].erased;
  return build('account_erased', lang, subject, [T[lang].hello, a, b], [T[lang].create, accountUrl(lang, '/inscription')]);
}

export function bookingMovedMail(lang: Lang, b: BookingMail): Mail {
  const t = T[lang];
  return build('booking_moved', lang, t.moved, [t.hello, t.movedIntro, t.service + b.service, t.date + when(b.starts_at, lang), t.address + ADDRESS, t.rules], [t.account, accountUrl(lang)]);
}

export function bookingReminderMail(lang: Lang, b: BookingMail): Mail {
  const t = T[lang];
  return build('booking_reminder', lang, t.reminder, [t.hello, t.reminderIntro, t.service + b.service, t.date + when(b.starts_at, lang), t.address + ADDRESS, t.reminderLate], [t.account, accountUrl(lang)]);
}

// Envoi détaché : la réponse n'attend jamais Resend (une adresse connue ne répond pas plus lentement qu'une inconnue).
// Sans clé : console sous astro dev uniquement, sinon erreur journalisée ; le destinataire n'est jamais journalisé.
export function sendMail(to: string, mail: Mail): void {
  if (!RESEND_API_KEY || !MAIL_FROM) {
    // import.meta.env n'existe que sous Astro (absent des tests node:test)
    if (import.meta.env?.DEV) console.log(`[e-mail] ${to} — ${mail.subject}\n${mail.text}`);
    else log('mail_unconfigured', { kind: mail.kind });
    return;
  }
  fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: MAIL_FROM, to: [to], subject: mail.subject, text: mail.text, html: mail.html }),
    signal: AbortSignal.timeout(10_000),
  })
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      log('mail_sent', { kind: mail.kind });
    })
    .catch((e) => log('mail_failed', { kind: mail.kind, error: String(e) }));
}
