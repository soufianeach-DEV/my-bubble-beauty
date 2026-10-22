// Espace cliente : champs validés côté serveur, lecture des formulaires, dates à Bruxelles et libellé des appareils connectés.
// Sans site.ts ni JSON : testable avec node:test.
import { z } from 'astro/zod';
import type { Lang } from '../site.ts';

// Caractères de contrôle refusés : un saut de ligne saisi n'a rien à faire dans un nom
export const EMAIL = z.string().trim().toLowerCase().max(254).email();
export const NAME = z.string().trim().min(1).max(100).regex(/^\P{Cc}+$/u);
// Facultatif : vide ou un numéro (chiffres, espaces, + . / ( ) -)
export const PHONE = z.string().trim().regex(/^(\+?[0-9(][0-9 ./()-]{5,28})?$/);
// La longueur réelle (12 à 128 caractères Unicode) est jugée par le socle, qui renvoie 'short' ou 'long' ; ici seulement un plafond
export const PASSWORD = z.string().min(1).max(1024);
// Jeton d'e-mail : 32 octets en base64url
export const TOKEN = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

// Corps illisible (plus de 64 Kio, mauvais format) ou champ refusé : data null, les noms des champs fautifs pour aria-invalid
// et les valeurs brutes pour remplir à nouveau le formulaire (jamais un mot de passe)
export async function readForm<S extends z.ZodType>(request: Request, schema: S): Promise<{ data: z.infer<S> | null; bad: Set<string>; raw: Record<string, string> }> {
  let raw: Record<string, string>;
  try {
    raw = Object.fromEntries([...(await request.formData())].map(([k, v]) => [k, typeof v === 'string' ? v : '']));
  } catch {
    return { data: null, bad: new Set(), raw: {} };
  }
  const r = schema.safeParse(raw);
  return r.success ? { data: r.data, bad: new Set(), raw } : { data: null, bad: new Set(r.error.issues.map((i) => String(i.path[0]))), raw };
}

const LOCALE: Record<Lang, string> = { fr: 'fr-BE', nl: 'nl-BE', en: 'en-GB' };
// Toujours l'heure de Bruxelles, quel que soit le fuseau du serveur
export const when = (d: Date, lang: Lang, dateStyle: 'full' | 'medium' = 'full') =>
  new Intl.DateTimeFormat(LOCALE[lang], { timeZone: 'Europe/Brussels', dateStyle, timeStyle: 'short' }).format(d);

// Liste des sessions : navigateur et système plutôt que le user-agent brut ; '' si rien n'est reconnu
const BROWSERS: [RegExp, string][] = [[/Edg\//, 'Edge'], [/OPR\//, 'Opera'], [/Firefox\//, 'Firefox'], [/Chrome\//, 'Chrome'], [/Safari\//, 'Safari']];
const SYSTEMS: [RegExp, string][] = [[/iPhone/, 'iPhone'], [/iPad/, 'iPad'], [/Android/, 'Android'], [/Windows/, 'Windows'], [/Mac OS X/, 'Mac'], [/Linux/, 'Linux']];
export function device(ua: string): string {
  const pick = (list: [RegExp, string][]) => list.find(([re]) => re.test(ua))?.[1];
  return [pick(BROWSERS), pick(SYSTEMS)].filter(Boolean).join(', ');
}
