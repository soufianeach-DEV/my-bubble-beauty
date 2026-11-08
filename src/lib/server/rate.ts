// Limitation des tentatives (connexion, code admin, e-mails, codes promo) et IP réelle du client derrière le proxy de Render.
// shortcut: compteurs en mémoire d'une seule instance, remis à zéro à chaque redémarrage ; passer en Postgres si plusieurs instances.
import { BlockList, isIPv4, isIPv6 } from 'node:net';

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
  promoIp: { max: 30, ms: HOUR, keys: 10_000 }, // mêmes essais par IP : plusieurs comptes ne multiplient pas les essais depuis une connexion
  booking: { max: 4, ms: HOUR, keys: 10_000 }, // réservations créées par IP : plusieurs comptes ne bloquent pas l'agenda depuis une seule connexion
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

// Place pour un nouvel identifiant. Entrées périmées purgées au plus une fois par minute ; règle pleine : part une entrée périmée,
// sinon le compteur le plus bas (jamais le plus ancien : 99 essais sur un compte ne s'effacent pas sous une rafale d'adresses à 1 essai),
// jamais un verrou actif. Pleine de verrous, la règle ne suit plus de nouvel identifiant jusqu'à leur fin
// (chaque verrou a coûté `max` essais, les autres règles protègent encore) plutôt que de lever un verrou ou de grossir sans fin.
function room(rule: Rule, now: number): boolean {
  const m = counters[rule];
  const { max, keys } = RULES[rule];
  if (now >= (nextSweep[rule] ?? 0)) {
    nextSweep[rule] = now + MIN;
    for (const [k, c] of m) if (c.until <= now) m.delete(k);
  }
  if (m.size < keys) return true;
  let low: string | undefined;
  let lowN = max;
  for (const [k, c] of m) {
    if (c.until <= now) {
      low = k;
      break;
    }
    if (c.n < lowN) [low, lowN] = [k, c.n];
  }
  if (low !== undefined) m.delete(low);
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

// Codes promo : un code valable se trahit par la remise, donc les essais faux sont comptés par cliente et par IP.
// L'essai sur l'IP est réservé dès le contrôle, sans attente entre lecture et ajout : des requêtes parallèles de plusieurs comptes
// (que le verrou de la cliente ne sérialise pas) ne passent pas toutes sous la limite. Faux si un compteur est plein.
export function promoTry(userId: number, ip?: string): boolean {
  if (blocked('promo', String(userId)) || (ip && blocked('promoIp', ip))) return false;
  if (ip) hit('promoIp', ip);
  return true;
}
// Après promoTry : code accepté, l'essai réservé sur l'IP est rendu ; code refusé, compté aussi pour la cliente
export function promoDone(userId: number, ip: string | undefined, ok: boolean) {
  if (!ok) hit('promo', String(userId));
  else if (ip) {
    const c = live('promoIp', idKey(ip), Date.now());
    if (c && c.n > 0) c.n--;
  }
}

// Remise à zéro de id et de ses couples « id\n… » (forget('loginPair', email) vide toutes les IP de cette adresse)
export function forget(rule: Rule, id: string) {
  id = idKey(id);
  for (const k of counters[rule].keys()) if (k === id || k.startsWith(`${id}\n`)) counters[rule].delete(k);
}

// Adresses des relais internes (Render, Caddy local) : jamais celle d'un visiteur venu d'Internet
const INTERNAL = new BlockList();
for (const [net, bits] of [['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16], ['127.0.0.0', 8], ['169.254.0.0', 16], ['100.64.0.0', 10]] as const) INTERNAL.addSubnet(net, bits, 'ipv4');
for (const [net, bits] of [['::1', 128], ['fc00::', 7], ['fe80::', 10]] as const) INTERNAL.addSubnet(net, bits, 'ipv6');
const internal = (ip: string) => {
  const v4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)?.[1] ?? ip;
  return isIPv4(v4) ? INTERNAL.check(v4, 'ipv4') : isIPv6(ip) && INTERNAL.check(ip, 'ipv6');
};

// Render et Caddy ajoutent l'IP du client à droite de X-Forwarded-For. La gauche est écrite par le client, donc falsifiable ;
// Astro.clientAddress n'est jamais utilisé. On remonte depuis la droite en sautant les relais internes : si Render ajoute un saut privé
// après l'IP du client, tous les visiteurs ne partagent pas la même clé (un seul pourrait sinon verrouiller la connexion de tous).
export const PROXY_HOPS = 1;
export function clientIp(xff: string | null | undefined, fallback = 'inconnue'): string {
  const parts = (xff ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  let i = parts.length - PROXY_HOPS;
  while (i > 0 && internal(parts[i])) i--;
  return ipKey(parts[i] ?? fallback);
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
