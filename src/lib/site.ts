// Données communes du site et correspondance des URL entre les trois langues.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import fr from '../data/fr.json';
import nl from '../data/nl.json';
import en from '../data/en.json';

export type Lang = 'fr' | 'nl' | 'en';
export const LANGS: Lang[] = ['fr', 'nl', 'en'];
export const DATA = { fr, nl, en } as const;
export const t = (lang: Lang) => DATA[lang];

// Origine des URL absolues (canonical, hreflang, sitemap, robots.txt, JSON-LD, Open Graph).
// Lue au build pour les pages pré-rendues, à l'exécution pour les autres : le domaine suit SITE_URL, le domaine officiel sinon.
export const SITE = (process.env.SITE_URL || 'https://mybubble-beauty.com').replace(/\/+$/, '');
// Même établissement dans les trois langues : un seul identifiant pour Google
export const SALON_ID = `${SITE}/#salon`;
// Empreinte des scripts : servis « immutable » un an, ils changent d'URL dès que leur contenu change.
export const JS_VERSION = createHash('sha1').update(['main', 'motion-pref', 'stats', 'password', 'auth-swap', 'compte-a-rebours', 'admin-selection', 'imprimer', 'bon-cliente'].map((f) => readFileSync(`public/assets/js/${f}.js`, 'utf8')).join('\n')).digest('hex').slice(0, 8);

// Mesure d'audience GoatCounter (sans cookie). Vide = désactivée.
// Mettre le code du site créé sur goatcounter.com, ex. 'mybubble' pour https://mybubble.goatcounter.com
export const GOATCOUNTER = '';
export const GOATCOUNTER_ENDPOINT = GOATCOUNTER ? `https://${GOATCOUNTER}.goatcounter.com/count` : '';

export const CONTACT = {
  phone: '+32484118395',
  phoneLabel: '0484.118.395',
  whatsapp: 'https://wa.me/32484118395',
  email: 'mybubble9600@gmail.com',
  street: 'Palokestraat 146',
  postal: '1700',
  city: 'Dilbeek',
  maps: 'https://www.google.com/maps/search/?api=1&query=Palokestraat%20146%2C%201700%20Dilbeek',
  social: [
    { key: 'facebook', label: 'Facebook', href: 'https://www.facebook.com/my.bubblebeauty/' },
    { key: 'instagram', label: 'Instagram', href: 'https://www.instagram.com/my.bubblebeauty/' },
    { key: 'snapchat', label: 'Snapchat', href: 'https://www.snapchat.com/add/mybubblebeauty' },
  ],
};

export const LANG_META: Record<Lang, { code: string; name: string; hreflang: string; country: string }> = {
  fr: { code: 'FR', name: 'Français', hreflang: 'fr-BE', country: 'Belgique' },
  nl: { code: 'NL', name: 'Nederlands', hreflang: 'nl-BE', country: 'België' },
  en: { code: 'EN', name: 'English', hreflang: 'en', country: 'Belgium' },
};

// Dossier d'URL par langue : « eng » est conservé tel quel depuis la v1.
export const FOLDER: Record<Lang, string> = { fr: 'fr', nl: 'nl', en: 'eng' };
export const langOfFolder = (folder: string) => LANGS.find((l) => FOLDER[l] === folder)!;

// Pages fixes : clé -> nom de fichier dans chaque langue.
export const PAGES = {
  home: { fr: 'index', nl: 'index', en: 'index' },
  mentions: { fr: 'mentions-legales', nl: 'juridische-informatie', en: 'legal-notice' },
  privacy: { fr: 'confidentialite', nl: 'privacy', en: 'privacy' },
  cgv: { fr: 'conditions-generales', nl: 'algemene-voorwaarden', en: 'terms' },
} as const;
export type PageKey = keyof typeof PAGES | `treatment:${string}`;

export function pagePath(lang: Lang, key: PageKey): string {
  if (key.startsWith('treatment:') && hiddenTreatment(key.slice(10))) return `/${FOLDER[lang]}/index.html`;
  if (key.startsWith('treatment:')) return `/${FOLDER[lang]}/subPages/${key.slice(10)}.html`;
  return `/${FOLDER[lang]}/${PAGES[key as keyof typeof PAGES][lang]}.html`;
}

export const alternates = (key: PageKey) =>
  LANGS.map((l) => ({ lang: l, hreflang: LANG_META[l].hreflang, href: SITE + pagePath(l, key) }));

// Libellés ajoutés en v2 (absents de la v1).
export const EXTRA: Record<Lang, { cgv: string; cookies: string; hours: string; closed: string; days: string[]; toDark: string; toLight: string }> = {
  fr: { cgv: 'Conditions générales', cookies: 'Gérer les cookies', hours: 'Horaires', closed: 'Fermé', days: ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'], toDark: 'Passer en mode sombre', toLight: 'Passer en mode clair' },
  nl: { cgv: 'Algemene voorwaarden', cookies: 'Cookies beheren', hours: 'Openingsuren', closed: 'Gesloten', days: ['Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag', 'Zondag'], toDark: 'Donkere modus inschakelen', toLight: 'Lichte modus inschakelen' },
  en: { cgv: 'Terms and conditions', cookies: 'Manage cookies', hours: 'Opening hours', closed: 'Closed', days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'], toDark: 'Switch to dark mode', toLight: 'Switch to light mode' },
};

// Horaires d'ouverture, à remplir quand la cliente les donne (vide = rien n'est affiché).
// day : 1 = lundi … 7 = dimanche ; un jour absent est affiché « Fermé ». Exemple :
// { day: 1, open: '09:30', close: '18:30' }, { day: 6, open: '09:00', close: '16:00' }
// Horaires de la fiche Google de l'institut (06/11/2026) ; 1 = lundi … 7 = dimanche, un jour absent = fermé
export const HOURS: { day: number; open: string; close: string }[] = [
  { day: 1, open: '10:00', close: '15:00' }, { day: 1, open: '17:00', close: '19:00' },
  { day: 2, open: '10:00', close: '15:00' }, { day: 2, open: '17:00', close: '19:00' },
  { day: 3, open: '10:00', close: '11:00' }, { day: 3, open: '14:00', close: '18:00' },
  { day: 4, open: '10:00', close: '15:00' }, { day: 4, open: '17:00', close: '20:00' },
  { day: 5, open: '10:00', close: '15:00' },
];
const SCHEMA_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const openingHoursSchema = () =>
  HOURS.map((h) => ({ '@type': 'OpeningHoursSpecification', dayOfWeek: SCHEMA_DAYS[h.day - 1], opens: h.open, closes: h.close }));
export const hoursRows = (lang: Lang) =>
  EXTRA[lang].days.map((label, i) => {
    const slots = HOURS.filter((h) => h.day === i + 1).map((h) => `${h.open}–${h.close}`);
    return { label, value: slots.length ? slots.join(', ') : EXTRA[lang].closed };
  });

// Soins masqués temporairement (groupe « hidden » de la grille) : ni sous-page, ni lien, ni plan du site
export function hiddenTreatment(slug: string): boolean {
  return t('fr').home.tarifs.groups.some((g) => (g as { hidden?: boolean }).hidden && g.href === slug);
}
