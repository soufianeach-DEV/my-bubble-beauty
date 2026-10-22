// @ts-check
import { defineConfig, envField } from 'astro/config';
import node from '@astrojs/node';

// Pages du site pré-rendues ; seules les routes de compte, réservation et admin (prerender = false) passent par Node.
// server.mjs enrobe l'adaptateur : en-têtes, redirections, migrations et purge.
const secret = (more = {}) => envField.string({ context: 'server', access: 'secret', ...more });

export default defineConfig({
  site: 'https://mybubble-beauty.com',
  output: 'static',
  trailingSlash: 'ignore',
  // Port de server.mjs et de Render : hors allowedDomains (en local), Astro retombe sur localhost:10000 et accepte les formulaires
  server: { port: 10000 },
  // Formulaires et événements Stripe font quelques Ko : le défaut d'1 Gio saturerait l'instance de 512 Mo
  adapter: node({ mode: 'standalone', bodySizeLimit: 64 * 1024 }),
  security: {
    checkOrigin: true,
    // Render termine le TLS : sans cette liste, Astro voit http://localhost et refuse des POST légitimes
    allowedDomains: [
      { hostname: 'mybubble-beauty.com', protocol: 'https' },
      { hostname: 'my-bubble-beauty.onrender.com', protocol: 'https' },
    ],
  },
  env: {
    // Tout est lu à l'exécution : rien n'est figé dans dist/, le build n'exige aucune variable, une rotation ne demande pas de rebuild.
    // Jamais import.meta.env pour un secret (il serait inliné dans le build).
    schema: {
      DATABASE_URL: secret({ startsWith: 'postgres' }),
      SITE_URL: secret({ url: true }),
      ADMIN_EMAIL: secret(),
      ADMIN_TOTP_SECRET: secret({ length: 32 }),
      PASSWORD_PEPPER: secret({ min: 32 }),
      STRIPE_SECRET_KEY: secret({ optional: true, startsWith: 'sk_' }),
      STRIPE_WEBHOOK_SECRET: secret({ optional: true, startsWith: 'whsec_' }),
      RESEND_API_KEY: secret({ optional: true }),
      MAIL_FROM: secret({ optional: true }),
    },
  },
  build: {
    // /fr/index.html et /fr/subPages/hifu.html : les URL de la v1 restent identiques (référencement)
    format: 'preserve',
    // La CSP n'autorise que 'self' : jamais de <style> en ligne
    inlineStylesheets: 'never',
  },
});
