// E-mails transactionnels (API Resend, sans SDK) dans les trois langues. Texte brut et HTML échappé ; liens construits depuis SITE_URL.
// Avant vérification de l'adresse, aucun champ saisi n'y figure : le salon ne sert pas de relais à un message écrit par un tiers.
import { MAIL_FROM, RESEND_API_KEY, SITE_URL } from 'astro:env/server';
import { CONTACT, FOLDER, type Lang } from '../site.ts';
import { log } from './log.ts';
import { euros } from './pricing.ts';

// unsubscribe : page de désinscription de ce type de mail (en pied de mail et dans l'en-tête List-Unsubscribe)
export type Mail = { kind: string; subject: string; text: string; html: string; unsubscribe?: string };
export type BookingMail = { service: string; starts_at: Date; price_cents: number; discount_cents: number; deposit_cents: number };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const accountUrl = (lang: Lang, path = '') => `${SITE_URL}/${FOLDER[lang]}/compte${path}`;
const ADDRESS = `${CONTACT.street}, ${CONTACT.postal} ${CONTACT.city}`;
const LOCALE: Record<Lang, string> = { fr: 'fr-BE', nl: 'nl-BE', en: 'en-GB' };
const when = (d: Date, lang: Lang) => new Intl.DateTimeFormat(LOCALE[lang], { timeZone: 'Europe/Brussels', dateStyle: 'full', timeStyle: 'short' }).format(d);

// Gabarit commun : fond crème, carte blanche de 600 px, logo, titre Georgia, corps Arial, bouton en tableau (VML pour Outlook),
// pied hors carte. Styles en ligne, aucune police web ni image de fond ; le mode sombre passe par les classes de la balise <style>.
const C = { bg: '#FCF9F7', card: '#FFFFFF', ink: '#4A3732', soft: '#786A65', line: '#E8D9D2', recap: '#F8F3F0', brand: '#8A5A50' };
const SERIF = "Georgia,'Times New Roman',serif";
const SANS = 'Arial,Helvetica,sans-serif';
const DARK = '.mb-bg{background:#1E1615!important}.mb-card{background:#2A201E!important}.mb-ink{color:#F3E6E1!important}.mb-soft{color:#D8C4BD!important}.mb-recap{background:#3A2C29!important}.mb-line{border-color:#4A3A36!important}.mb-link{color:#E8BFB5!important}';
// Le numéro du salon devient un lien tel: partout où il apparaît
const tel = (html: string) => html.split(esc(CONTACT.phoneLabel)).join(`<a href="tel:${CONTACT.phone}" class="mb-link" style="color:${C.brand};text-decoration:underline">${esc(CONTACT.phoneLabel)}</a>`);
const para = (l: string) => `<p class="mb-ink" style="margin:0 0 16px;font-family:${SANS};font-size:16px;line-height:1.6;color:${C.ink}">${tel(esc(l))}</p>`;
const button = ([label, url]: [string, string]) => `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px"><tr><td align="center" bgcolor="${C.brand}" style="border-radius:8px">
<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${esc(url)}" style="height:48px;v-text-anchor:middle;width:240px" arcsize="17%" stroke="f" fillcolor="${C.brand}"><w:anchorlock/><center style="color:#FFFFFF;font-family:Arial,sans-serif;font-size:16px;font-weight:bold">${esc(label)}</center></v:roundrect><![endif]-->
<!--[if !mso]><!--><a href="${esc(url)}" style="display:inline-block;min-width:240px;box-sizing:border-box;padding:14px 24px;background:${C.brand};border-radius:8px;font-family:${SANS};font-size:16px;font-weight:bold;line-height:20px;color:#FFFFFF;text-align:center;text-decoration:none">${esc(label)}</a><!--<![endif]-->
</td></tr></table>`;
const recapBlock = (rows: [string, string][]) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="mb-recap" style="background:${C.recap};border-radius:8px;margin:0 0 20px"><tr><td style="padding:20px 24px">${rows
  .map(([k, v], i) => `<p class="mb-soft" style="margin:${i ? '14px' : '0'} 0 2px;font-family:${SANS};font-size:12px;letter-spacing:1px;color:${C.soft}">${esc(k.toUpperCase())}</p><p class="mb-ink" style="margin:0;font-family:${SANS};font-size:16px;line-height:1.5;font-weight:bold;color:${C.ink}">${esc(v)}</p>`)
  .join('')}</td></tr></table>`;

// pre : texte d'aperçu affiché par la messagerie après l'objet (caché dans le corps).
// opts.title : titre de la carte (l'objet sinon) ; opts.recap : bloc récapitulatif, suivi des lignes opts.after
type Opts = { title?: string; recap?: [label: string, value: string][]; after?: (string | false)[] };
function build(kind: string, lang: Lang, subject: string, lines: (string | false)[], link: [label: string, url: string], unsub?: [label: string, url: string], pre?: string, opts: Opts = {}): Mail {
  const body = lines.filter((l): l is string => !!l);
  const after = (opts.after ?? []).filter((l): l is string => !!l);
  const title = opts.title ?? subject;
  const foot = `My Bubble Beauty - ${ADDRESS} - ${CONTACT.phoneLabel}`;
  const small = `font-family:${SANS};font-size:12px;line-height:1.6;color:${C.soft}`;
  return {
    kind,
    subject,
    text: [title, ...body, ...(opts.recap ?? []).map(([k, v]) => `${k}${lang === 'fr' ? ' : ' : ': '}${v}`), ...after, `${link[0]}\n${link[1]}`, foot, ...(unsub ? [`${unsub[0]}\n${unsub[1]}`] : [])].join('\n\n'),
    html: `<!doctype html><html lang="${lang}" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="x-apple-disable-message-reformatting"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${esc(subject)}</title>
<style>:root{color-scheme:light dark;supported-color-schemes:light dark}@media (max-width:620px){.mb-pad{padding:24px!important}}@media (prefers-color-scheme:dark){${DARK}}</style>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]--></head>
<body class="mb-bg" style="margin:0;padding:0;background:${C.bg};-webkit-text-size-adjust:100%">${pre ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${esc(pre)}</div>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="mb-bg" style="background:${C.bg}"><tr><td align="center" style="padding:32px 12px">
<!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="mb-card" style="max-width:600px;background:${C.card};border-radius:12px"><tr><td class="mb-pad" style="padding:40px">
<img src="${SITE_URL}/assets/img/logo-mail.png" width="180" height="127" alt="My Bubble Beauty" style="display:block;margin:0 auto;border:0;width:180px;max-width:100%;height:auto;font-family:${SERIF};font-size:24px;color:${C.brand};text-align:center">
<div class="mb-line" style="border-top:1px solid ${C.line};margin:24px 0 28px;line-height:0;font-size:0">&nbsp;</div>
<h1 class="mb-ink" style="margin:0 0 20px;font-family:${SERIF};font-size:26px;line-height:1.3;font-weight:normal;color:${C.ink}">${esc(title)}</h1>
${body.map(para).join('')}${opts.recap ? recapBlock(opts.recap) : ''}${after.map(para).join('')}${button(link)}
</td></tr></table>
<!--[if mso]></td></tr></table><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px"><tr><td class="mb-soft" style="padding:20px 24px 8px;text-align:center;${small}">My Bubble Beauty · ${esc(ADDRESS)}<br><a href="tel:${CONTACT.phone}" class="mb-soft" style="color:${C.soft};text-decoration:underline">${esc(CONTACT.phoneLabel)}</a>${unsub ? `<br><a href="${esc(unsub[1])}" class="mb-soft" style="color:${C.soft};text-decoration:underline">${esc(unsub[0])}</a>` : ''}</td></tr></table>
</td></tr></table></body></html>`,
    ...(unsub ? { unsubscribe: unsub[1] } : {}),
  };
}

// « Bonjour Sophie, » avec le premier mot du nom du compte ; « Bonjour, » sans nom
const HELLO: Record<Lang, string> = { fr: 'Bonjour', nl: 'Hallo', en: 'Hello' };
const hi = (lang: Lang, name?: string | null) => {
  const first = name?.trim().split(/\s+/)[0];
  return first ? `${HELLO[lang]} ${first},` : `${HELLO[lang]},`;
};

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
    rules: `Vous pouvez annuler gratuitement depuis votre compte jusqu'à 24 heures avant le rendez-vous. Ensuite, appelez-nous au ${CONTACT.phoneLabel}.`,
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
    reminderTitle: 'À demain pour votre moment de douceur',
    recap: ['Prestation', 'Date et heure', 'Adresse'],
    reviewTitle: 'Merci pour votre visite',
    reviewAgainTitle: 'Un petit mot de votre part ?',
    reminderIntro: "Nous vous rappelons votre rendez-vous chez My Bubble Beauty.",
    reminderLate: `Un empêchement ? Moins de 24 heures avant, appelez-nous au ${CONTACT.phoneLabel}.`,
    gift: ['Votre bon cadeau My Bubble Beauty', (to: string) => `Bonjour ${to},`, 'Un bon cadeau vous attend chez My Bubble Beauty.', 'Soin offert : ', 'Votre code : ', (d: string) => `Valable jusqu'au ${d} (12 mois).`, 'Message : ', 'Réservez en ligne et saisissez votre code dans le champ « Code promo ou bon cadeau ». Vous pouvez aussi nous appeler.', 'Réserver mon soin'],
    aftercare: ['Vos recommandations après le blanchiment des dents', 'Merci pour votre visite. Pour garder un résultat optimal le plus longtemps possible, voici nos recommandations.',
      "Pendant 3 à 4 heures après votre séance : ne mangez pas, buvez uniquement de l'eau, ne fumez pas, pas de bains de bouche colorés, ne vous brossez pas les dents.",
      'Pendant les 7 jours qui suivent :',
      ["l'eau et les boissons transparentes sont les seules boissons autorisées ;", 'le thé, le café, les tisanes, le sirop coloré, le vin, les sodas et les boissons acides sont déconseillés (ou à la paille) ;', 'évitez les aliments colorés comme les épices (curry, safran) ou les sauces (ketchup, andalouse…), mais aussi les fraises, betteraves, épinards ;', 'les pâtes à tartiner, la confiture et le chocolat sont également à éviter ;', "les fumeurs doivent effectuer un brossage de dents léger obligatoirement après chaque cigarette. Si vous êtes à l'extérieur, un bon rinçage suffira ;", 'pas de bains de bouche colorés ;', 'nous conseillons un dentifrice blanc (sans lignes de couleur), par exemple Sensodyne ou Elmex.'],
      'Revoir les recommandations'] as const,
    create: "Créer un compte",
    reviewPre: 'Votre avis sur Google aide d’autres personnes à nous découvrir.',
    reviewAgain: ['Deux minutes pour votre avis ?', 'Nous vous avons récemment proposé de donner votre avis sur votre visite chez My Bubble Beauty.', 'Si vous ne l’avez pas encore fait, cela prend deux minutes sur Google. Très bon ou moins bon, chaque avis sincère compte pour nous.', 'Si c’est déjà fait : merci beaucoup, et ignorez simplement ce message.', 'Si c’est déjà fait, merci et ignorez ce message.'],
    review: ['Comment s’est passé votre soin ?', 'Merci pour votre visite chez My Bubble Beauty.', 'Votre avis aide d’autres personnes à nous découvrir et nous aide à progresser. Si vous avez deux minutes, vous pouvez noter votre soin sur Google.', 'Qu’il soit très bon ou moins bon, chaque avis sincère compte pour nous.', 'Laisser un avis Google', 'Ne plus recevoir de demande d’avis'],
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
    rules: `U kunt tot 24 uur voor de afspraak gratis annuleren via uw account. Daarna belt u ons op ${CONTACT.phoneLabel}.`,
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
    reminderTitle: 'Tot morgen voor uw moment van ontspanning',
    recap: ['Behandeling', 'Datum en uur', 'Adres'],
    reviewTitle: 'Bedankt voor uw bezoek',
    reviewAgainTitle: 'Een woordje van u?',
    reminderIntro: "We herinneren u aan uw afspraak bij My Bubble Beauty.",
    reminderLate: `Verhinderd? Minder dan 24 uur op voorhand belt u ons op ${CONTACT.phoneLabel}.`,
    gift: ['Uw cadeaubon van My Bubble Beauty', (to: string) => `Hallo ${to},`, 'Er wacht een cadeaubon op u bij My Bubble Beauty.', 'Aangeboden behandeling: ', 'Uw code: ', (d: string) => `Geldig tot ${d} (12 maanden).`, 'Bericht: ', 'Reserveer online en vul uw code in bij « Promocode of cadeaubon ». U kunt ons ook bellen.', 'Mijn behandeling reserveren'],
    aftercare: ['Uw aanbevelingen na de tandenbleking', 'Dank u voor uw bezoek. Zo blijft het resultaat zo lang mogelijk optimaal:',
      'Gedurende 3 tot 4 uur na uw sessie: eet niet, drink alleen water, rook niet, geen gekleurd mondwater, poets uw tanden niet.',
      'Gedurende de 7 dagen daarna:',
      ['water en kleurloze dranken zijn de enige toegestane dranken;', 'thee, koffie, kruidenthee, gekleurde siroop, wijn, frisdrank en zure dranken worden afgeraden (of drink ze met een rietje);', 'vermijd gekleurde voeding zoals kruiden (curry, saffraan) of sauzen (ketchup, andalouse…), maar ook aardbeien, rode biet en spinazie;', "vermijd ook smeerpasta's, confituur en chocolade;", 'rokers poetsen na elke sigaret verplicht licht hun tanden. Bent u buitenshuis, dan volstaat goed spoelen;', 'geen gekleurd mondwater;', 'wij raden een witte tandpasta aan (zonder gekleurde strepen), bijvoorbeeld Sensodyne of Elmex.'],
      'De aanbevelingen herlezen'] as const,
    create: "Een account aanmaken",
    reviewPre: 'Uw review op Google helpt anderen om ons te ontdekken.',
    reviewAgain: ['Twee minuten voor uw review?', 'We vroegen u onlangs om een review over uw bezoek aan My Bubble Beauty.', 'Hebt u dat nog niet gedaan? Het kost twee minuten op Google. Heel goed of minder goed: elke eerlijke review telt voor ons.', 'Al gedaan? Hartelijk dank, dan mag u dit bericht negeren.', 'Al gedaan? Dank u, dan mag u dit bericht negeren.'],
    review: ['Hoe was uw behandeling?', 'Dank u voor uw bezoek aan My Bubble Beauty.', 'Uw review helpt anderen om ons te ontdekken en helpt ons om beter te worden. Hebt u twee minuten? Dan kunt u uw behandeling beoordelen op Google.', 'Of uw ervaring nu heel goed of minder goed was: elke eerlijke review telt voor ons.', 'Een Google-review schrijven', 'Geen vragen om een review meer ontvangen'],
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
    rules: `You can cancel free of charge from your account up to 24 hours before the appointment. After that, please call us on ${CONTACT.phoneLabel}.`,
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
    reminderTitle: 'See you tomorrow for your moment of calm',
    recap: ['Treatment', 'Date and time', 'Address'],
    reviewTitle: 'Thank you for your visit',
    reviewAgainTitle: 'A few words from you?',
    reminderIntro: "This is a reminder of your appointment at My Bubble Beauty.",
    reminderLate: `Can't make it? Less than 24 hours before, please call us on ${CONTACT.phoneLabel}.`,
    gift: ['Your My Bubble Beauty gift voucher', (to: string) => `Hello ${to},`, 'A gift voucher is waiting for you at My Bubble Beauty.', 'Treatment: ', 'Your code: ', (d: string) => `Valid until ${d} (12 months).`, 'Message: ', 'Book online and enter your code in the « Promo code or gift voucher » field. You can also call us.', 'Book my treatment'],
    aftercare: ['Your recommendations after teeth whitening', 'Thank you for your visit. To keep an optimal result for as long as possible, here are our recommendations.',
      'For 3 to 4 hours after your session: do not eat, drink only water, do not smoke, no coloured mouthwash, do not brush your teeth.',
      'For the 7 days after:',
      ['water and clear drinks are the only drinks allowed;', 'tea, coffee, herbal tea, coloured syrup, wine, soft drinks and acidic drinks are not recommended (or drink them through a straw);', 'avoid coloured foods such as spices (curry, saffron) or sauces (ketchup, andalouse…), as well as strawberries, beetroot and spinach;', 'spreads, jam and chocolate should also be avoided;', 'smokers must brush their teeth gently after every cigarette. If you are outside, a good rinse will do;', 'no coloured mouthwash;', 'we recommend a white toothpaste (without coloured stripes), for example Sensodyne or Elmex.'],
      'Read the recommendations again'] as const,
    create: "Create an account",
    reviewPre: 'Your Google review helps other people discover us.',
    reviewAgain: ['Two minutes for your review?', 'We recently asked you to share your thoughts on your visit to My Bubble Beauty.', 'If you have not done so yet, it takes two minutes on Google. Great or less so, every honest review matters to us.', 'Already done? Thank you very much, and please ignore this message.', 'Already done? Thank you, and please ignore this message.'],
    review: ['How was your treatment?', 'Thank you for visiting My Bubble Beauty.', 'Your review helps other people discover us and helps us improve. If you have two minutes, you can rate your treatment on Google.', 'Whether your experience was great or less so, every honest review matters to us.', 'Leave a Google review', 'Stop receiving review requests'],
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

export function bookingReminderMail(lang: Lang, b: BookingMail, name?: string | null): Mail {
  const t = T[lang];
  const [service, date, address] = t.recap;
  return build('booking_reminder', lang, t.reminder, [hi(lang, name), t.reminderIntro], [t.account, accountUrl(lang)], undefined, `${b.service} · ${when(b.starts_at, lang)}`,
    { title: t.reminderTitle, recap: [[service, b.service], [date, when(b.starts_at, lang)], [address, ADDRESS]], after: [t.reminderLate] });
}

// Après un rendez-vous de blanchiment dentaire : les recommandations de l'institut, sans rien de personnel
export function aftercareMail(lang: Lang): Mail {
  const [subject, intro, hours, days, list, label] = T[lang].aftercare;
  return build('aftercare_whitening', lang, subject, [T[lang].hello, intro, hours, days, ...list.map((l) => `• ${l}`)], [label, `${SITE_URL}/${FOLDER[lang]}/subPages/dents.html`]);
}

// Après tout rendez-vous honoré : la même demande à toutes les clientes, sans question préalable sur leur satisfaction
// (Google interdit de ne solliciter que les avis positifs). reviewUrl : lien « Demander des avis » copié depuis la fiche.
export function reviewRequestMail(lang: Lang, reviewUrl: string, unsubscribeUrl: string, name?: string | null): Mail {
  // Le remerciement passe dans le titre de la carte
  const [subject, , ask, honest, label, unsub] = T[lang].review;
  return build('review_request', lang, subject, [hi(lang, name), ask, honest], [label, reviewUrl], [unsub, unsubscribeUrl], T[lang].reviewPre, { title: T[lang].reviewTitle });
}

// Relance un jour plus tard. Le site ne sait pas si la cliente a déjà laissé son avis (Google ne donne pas son e-mail) : le texte le dit
export function reviewReminderMail(lang: Lang, reviewUrl: string, unsubscribeUrl: string, name?: string | null): Mail {
  const [subject, recall, ask, done, pre] = T[lang].reviewAgain;
  const [, , , , label, unsub] = T[lang].review;
  return build('review_reminder', lang, subject, [hi(lang, name), recall, ask, done], [label, reviewUrl], [unsub, unsubscribeUrl], pre, { title: T[lang].reviewAgainTitle });
}

// Bon cadeau : soin, code CADEAU-, validité et message de l'institut (saisi par l'équipe, jamais par un tiers)
export function giftMail(lang: Lang, g: { recipient: string; service: string; code: string; expires_on: string; message: string }): Mail {
  // Tuple mixte (textes et fonctions) : typé ici, le tableau T ne l'est pas élément par élément
  const [subject, hello, intro, service, code, valid, message, how, label] = T[lang].gift as unknown as [string, (to: string) => string, string, string, string, (d: string) => string, string, string, string];
  const day = new Intl.DateTimeFormat(LOCALE[lang], { timeZone: 'UTC', dateStyle: 'long' }).format(new Date(`${g.expires_on}T12:00:00Z`));
  return build('gift', lang, subject, [hello(g.recipient), intro, service + g.service, code + g.code, valid(day), !!g.message && message + g.message, how], [label, `${SITE_URL}/${FOLDER[lang]}/reserver`]);
}

// Envoi attendu, pour un écran qui doit dire si l'e-mail est parti (bon cadeau) : true seulement si Resend l'a accepté
export async function sendMailNow(to: string, mail: Mail): Promise<boolean> {
  if (!RESEND_API_KEY || !MAIL_FROM) {
    log('mail_unconfigured', { kind: mail.kind });
    return false;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: MAIL_FROM, to: [to], subject: mail.subject, text: mail.text, html: mail.html, ...(mail.unsubscribe ? { headers: { 'List-Unsubscribe': `<${mail.unsubscribe}>` } } : {}) }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    log('mail_sent', { kind: mail.kind });
    return true;
  } catch (e) {
    log('mail_failed', { kind: mail.kind, error: String(e) });
    return false;
  }
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
