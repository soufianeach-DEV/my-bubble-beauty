// Données communes du site et correspondance des URL entre les trois langues.
import fr from '../data/fr.json';
import nl from '../data/nl.json';
import en from '../data/en.json';

export type Lang = 'fr' | 'nl' | 'en';
export const LANGS: Lang[] = ['fr', 'nl', 'en'];
export const DATA = { fr, nl, en } as const;
export const t = (lang: Lang) => DATA[lang];

export const SITE = 'https://mybubble-beauty.com';
// Changer ce numéro quand main.js, motion-pref.js ou stats.js change (servis « immutable » un an).
export const JS_VERSION = '20261016';

// Mesure d'audience GoatCounter (sans cookie). Vide = désactivée.
// Mettre le code du site créé sur goatcounter.com, ex. 'mybubble' pour https://mybubble.goatcounter.com
export const GOATCOUNTER = '';
export const GOATCOUNTER_ENDPOINT = GOATCOUNTER ? `https://${GOATCOUNTER}.goatcounter.com/count` : '';

export const CONTACT = {
  phone: '+32484118395',
  phoneLabel: '0484.118.395',
  whatsapp: 'https://wa.me/32484118395',
  email: 'mybubblebeauty@gmail.com',
  street: 'Rue Paloke 146',
  postal: '1700',
  city: 'Dilbeek',
  maps: 'https://www.google.com/maps/search/?api=1&query=Rue%20Paloke%20146%2C%201700%20Dilbeek',
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
  if (key.startsWith('treatment:')) return `/${FOLDER[lang]}/subPages/${key.slice(10)}.html`;
  return `/${FOLDER[lang]}/${PAGES[key as keyof typeof PAGES][lang]}.html`;
}

export const alternates = (key: PageKey) =>
  LANGS.map((l) => ({ lang: l, hreflang: LANG_META[l].hreflang, href: SITE + pagePath(l, key) }));

// Libellés ajoutés en v2 (absents de la v1).
export const EXTRA: Record<Lang, { cgv: string }> = {
  fr: { cgv: 'Conditions générales' },
  nl: { cgv: 'Algemene voorwaarden' },
  en: { cgv: 'Terms and conditions' },
};
