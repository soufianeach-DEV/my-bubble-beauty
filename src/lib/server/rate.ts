// Limitation des tentatives (connexion, code admin, e-mails, codes promo) et IP réelle du client derrière le proxy de Render.
// shortcut: compteurs en mémoire d'une seule instance, remis à zéro à chaque redémarrage ; passer en Postgres si plusieurs instances.
import { isIPv4, isIPv6 } from 'node:net';

const MIN = 60_000;
const HOUR = 60 * MIN;
// keys : plafond d'entrées de la règle, pour borner la mémoire de l'instance de 512 Mo
export const RULES = {
  loginPair: { max: 5, ms: 15 * MIN, keys: 10_000 }, // essais par couple (e-mail, IP), effacés au succès : depuis sa propre IP, un tiers ne verrouille pas la gérante
  loginEmail: { max: 100, ms: HOUR, keys: 10_000 }, // essais par e-mail, toutes IP confondues (ASVS 2.2.1) ; un appareil déjà connecté (cookie d'appareil) n'y est pas soumis
  loginIp: { max: 30, ms: 15 * MIN, keys: 10_000 }, // tentatives de connexion par IP
  totp: { max: 5, ms: 15 * MIN, keys: 100 }, // codes admin faux, par compte (un seul admin)
  mailTo: { max: 3, ms: HOUR, keys: 10_000 }, // e-mails d'inscription ou d'oubli par adresse destinataire
  mailIp: { max: 20, ms: HOUR, keys: 10_000 }, // mêmes e-mails par IP
  promo: { max: 10, ms: HOUR, keys: 10_000 }, // codes promo invalides par cliente
  loginDevice: { max: 10, ms: 15 * MIN, keys: 10_000 }, // essais sous cookie d'appareil, par e-mail : au-delà, le cookie ne dispense plus de loginEmail
} as const;
export type Rule = keyof typeof RULES;
type Counter = { n: number; until: number };

// Une Map par règle : une rafale sur l'une (adresses inventées en masse) n'efface jamais les compteurs d'une autre
const counters = Object.fromEntries(Object.keys(RULES).map((r) => [r, new Map<string, Counter>()])) as Record<Rule, Map<string, Counter>>;
const nextSweep: Partial<Record<Rule, number>> = {};
// E-mail (254 au plus), saut de ligne et IP (64) y tiennent : une adresse géante ne retient pas de mémoire
const ID_MAX = 320;
// slice() et trim() gardent la chaîne d'origine en vie (V8) : copie pour que la clé ne retienne que ses 320 caractères
const idKey = (id: string) => Buffer.from(id.slice(0, ID_MAX)).toString();

// Place pour un nouvel identifiant. Entrées périmées purgées au plus une fois par minute ; règle pleine : partent les entrées périmées
// ou encore sous la limite, jamais un verrou actif. Pleine de verrous, la règle ne suit plus de nouvel identifiant jusqu'à leur fin
// (chaque verrou a coûté `max` essais, les autres règles protègent encore) plutôt que de lever un verrou ou de grossir sans fin.
function room(rule: Rule, now: number): boolean {
  const m = counters[rule];
  const { max, keys } = RULES[rule];
  if (now >= (nextSweep[rule] ?? 0)) {
    nextSweep[rule] = now + MIN;
    for (const [k, c] of m) if (c.until <= now) m.delete(k);
  }
  for (const [k, c] of m) {
    if (m.size < keys) break;
    if (c.until <= now || c.n < max) m.delete(k);
  }
  return m.size < keys;
}

const live = (rule: Rule, id: string, now: number) => {
  const c = counters[rule].get(id);
  return c && c.until > now ? c : undefined;
};

// Ajoute un essai ; vrai si la limite est désormais dépassée
export function hit(rule: Rule, id: string, now = Date.now()): boolean {
  id = idKey(id);
  let c = live(rule, id, now);
  if (!c) {
    if (!room(rule, now)) return false;
    c = { n: 0, until: now + RULES[rule].ms };
    counters[rule].set(id, c);
  }
  c.n++;
  return c.n > RULES[rule].max;
}

// Limite atteinte, sans compter d'essai (pour ne compter que les échecs)
export const blocked = (rule: Rule, id: string, now = Date.now()) => (live(rule, idKey(id), now)?.n ?? 0) >= RULES[rule].max;

// Remise à zéro de id et de ses couples « id\n… » (forget('loginPair', email) vide toutes les IP de cette adresse)
export function forget(rule: Rule, id: string) {
  id = idKey(id);
  for (const k of counters[rule].keys()) if (k === id || k.startsWith(`${id}\n`)) counters[rule].delete(k);
}

// shortcut: Render ajoute l'IP du client à droite de X-Forwarded-For (1 proxy supposé) ; mesurer la position au premier déploiement avec un en-tête forgé.
// La gauche est écrite par le client, donc falsifiable ; Astro.clientAddress n'est jamais utilisé.
export const PROXY_HOPS = 1;
export function clientIp(xff: string | null | undefined, fallback = 'inconnue'): string {
  const parts = (xff ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const ip = parts[parts.length - PROXY_HOPS] ?? fallback;
  return ipKey(ip);
}

// IPv6 regroupées par /64 : un seul abonné dispose souvent d'un /64 entier
export function ipKey(ip: string): string {
  const v6 = ip.replace(/%.*$/, '');
  if (isIPv4(ip) || !isIPv6(v6)) return ip.slice(0, 64);
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(v6);
  if (mapped) return mapped[1];
  const [head, tail] = v6.toLowerCase().split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = tail === undefined ? h : [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t];
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}
