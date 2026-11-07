// robots.txt généré au build : l'adresse du sitemap suit SITE (SITE_URL), comme les canonical.
import type { APIRoute } from 'astro';
import { SITE } from '../lib/site';

export const GET: APIRoute = () =>
  new Response(
    [
      'User-agent: *',
      'Allow: /',
      '# Compte et réservation restent explorables : Google doit pouvoir y lire leur noindex',
      'Disallow: /admin',
      'Disallow: /api/',
      '',
      `Sitemap: ${SITE}/sitemap.xml`,
      '',
    ].join('\n'),
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  );
