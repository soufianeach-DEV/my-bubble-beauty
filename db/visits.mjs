// Mesure d'audience maison, sans cookie ni service tiers : un visiteur = une empreinte par jour.
// Empreinte = SHA-256(sel du jour + IP + navigateur), tronquée. Le sel est tiré au hasard, gardé en mémoire seulement et changé
// chaque jour : l'IP n'est jamais écrite et une empreinte ne peut plus être reliée à personne une fois le sel jeté.
// shortcut: un redémarrage du serveur tire un nouveau sel, la même personne peut alors compter deux fois ce jour-là ; acceptable pour un ordre de grandeur.
import { createHash, randomBytes } from 'node:crypto';

const BOT = /bot|crawl|spider|slurp|preview|monitor|curl|wget|python|java\/|go-http|headless|lighthouse|render\/|uptime|facebookexternalhit|whatsapp/i;
// Pages publiques seulement : ni compte, ni réservation, ni admin, ni fichiers
const PAGE = /^\/(index\.html)?$|^\/(fr|nl|eng)\/[^?]*\.html$/;

let salt = { day: '', key: randomBytes(32) };
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(new Date());

// Même lecture que clientIp() de src/lib/server/rate.ts : l'IP ajoutée par Render est la dernière de X-Forwarded-For (1 proxy)
const clientIp = (req) => (req.headers['x-forwarded-for'] ?? '').split(',').map((s) => s.trim()).filter(Boolean).at(-1) ?? req.socket.remoteAddress ?? '';

export function isCountable(req, path, status) {
  // 304 aussi : le HTML est revalidé par ETag, une personne qui revient avec la page en cache reçoit 304
  if (req.method !== 'GET' || (status !== 200 && status !== 304) || !PAGE.test(path)) return false;
  const ua = req.headers['user-agent'] ?? '';
  // Préchargements du navigateur et robots : pas une visite
  if (!ua || BOT.test(ua) || req.headers['sec-purpose'] || req.headers.purpose === 'prefetch') return false;
  // Refus du visiteur : case de la page confidentialité (cookie mb_nostats) ou signal Global Privacy Control du navigateur
  if (req.headers['sec-gpc'] === '1' || /(?:^|;\s*)mb_nostats=1(?:;|$)/.test(req.headers.cookie ?? '')) return false;
  return true;
}

export function visitorKey(req) {
  const day = today();
  if (salt.day !== day) salt = { day, key: randomBytes(32) };
  const id = createHash('sha256').update(salt.key).update(clientIp(req)).update(req.headers['user-agent'] ?? '').digest().subarray(0, 16);
  return { day, id };
}

// Appelé après la réponse : une erreur de base ne gêne jamais la page
export function recordVisit(sql, req, log) {
  const { day, id } = visitorKey(req);
  sql`INSERT INTO site_visits (day, visitor) VALUES (${day}, ${id})
      ON CONFLICT (day, visitor) DO UPDATE SET views = site_visits.views + 1`.catch((e) => log('visit_failed', { error: String(e) }));
}
