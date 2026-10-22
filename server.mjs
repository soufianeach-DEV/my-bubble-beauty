// Serveur de production (Render) : l'adaptateur Astro sert les pages, ce fichier ajoute en-têtes, redirections, migrations et purge.
// Les réglages Headers/Redirects de Render ne valent que pour les sites statiques. En local : node --env-file=.env server.mjs
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { migrate } from './db/migrate.mjs';
import { purge } from './db/purge.mjs';

// site.ts lit public/ en chemin relatif : le serveur travaille dans son propre dossier, d'où qu'on le lance
process.chdir(fileURLToPath(new URL('.', import.meta.url)));

const log = (event, data = {}) => console.log(JSON.stringify({ t: new Date().toISOString(), event, ...data }));

// Mieux vaut refuser de démarrer que servir des pages de compte à moitié configurées
const missing = ['DATABASE_URL', 'SITE_URL', 'ADMIN_EMAIL', 'ADMIN_TOTP_SECRET', 'PASSWORD_PEPPER'].filter((k) => !process.env[k]);
if (missing.length || process.env.SITE_URL?.endsWith('/')) {
  log('config_invalid', { missing, siteUrlTrailingSlash: !!process.env.SITE_URL?.endsWith('/') });
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { max: 1, idle_timeout: 60, onnotice: () => {}, connection: { TimeZone: 'Europe/Brussels' } });
log('migrations', { applied: await migrate(sql) });

// Import dynamique : un import statique serait évalué avant cette ligne et Astro lancerait son propre serveur
process.env.ASTRO_NODE_AUTOSTART = 'disabled';
const { handler } = await import('./dist/server/entry.mjs');

// CSP du site ; form-action autorise la redirection 303 vers Stripe Checkout après le formulaire de réservation
const SECURITY = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https://*.goatcounter.com; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self' https://checkout.stripe.com; frame-ancestors 'none'; upgrade-insecure-requests",
  // Sans includeSubDomains : les autres sous-domaines du nom ne sont pas garantis en HTTPS
  'Strict-Transport-Security': 'max-age=31536000',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
};

// Fichiers statiques (ils portent un ETag) : JS versionné par ?v= et polices un an, images 30 jours, HTML revalidé.
// /_astro/ (CSS haché) est déjà réglé « immutable » par l'adaptateur.
function staticCache(path) {
  if (path.startsWith('/_astro/')) return null;
  if (path.startsWith('/assets/js/') || path.startsWith('/assets/fonts/')) return 'public, max-age=31536000, immutable';
  if (path.startsWith('/assets/img/')) return 'public, max-age=2592000';
  return 'no-cache';
}

// Anciennes pages légales à la racine (v1) -> versions FR
const REDIRECTS = new Map([
  ['/mentions-legales.html', '/fr/mentions-legales.html'],
  ['/confidentialite.html', '/fr/confidentialite.html'],
]);

const server = http.createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  const writeHead = res.writeHead;
  res.writeHead = function (status, ...rest) {
    for (const [k, v] of Object.entries(SECURITY)) this.setHeader(k, v);
    if (this.hasHeader('etag')) {
      const cc = staticCache(path);
      if (cc) this.setHeader('Cache-Control', cc);
    } else {
      // Réponse calculée (compte, réservation, admin, erreurs) : jamais en cache, même si la page a posé le sien (writeHead l'emporte sur setHeader)
      const given = rest.find((r) => r && typeof r === 'object' && !Array.isArray(r));
      if (given) for (const k of Object.keys(given)) if (k.toLowerCase() === 'cache-control') delete given[k];
      this.setHeader('Cache-Control', 'no-store');
    }
    return writeHead.call(this, status, ...rest);
  };
  // /fr, /nl, /eng -> accueil de la langue (URL d'origine conservées)
  const home = /^\/(fr|nl|eng)\/?$/.exec(path);
  const to = home ? `/${home[1]}/index.html` : REDIRECTS.get(path);
  if (to) {
    res.writeHead(301, { Location: to });
    return res.end();
  }
  handler(req, res);
});
server.listen(Number(process.env.PORT) || 10000, () => log('listening', { port: server.address().port }));

const runPurge = () => purge(sql, process.env.ADMIN_EMAIL).then((counts) => log('purge', counts), (e) => log('purge_failed', { error: String(e) }));
runPurge();
setInterval(runPurge, 24 * 3600 * 1000).unref();
