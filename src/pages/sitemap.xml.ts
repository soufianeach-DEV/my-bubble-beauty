// Sitemap généré depuis les mêmes données que les pages : il ne peut pas se désynchroniser.
import type { APIRoute } from 'astro';
import { LANGS, PAGES, SITE, t, pagePath, alternates, type PageKey } from '../lib/site';

export const GET: APIRoute = () => {
  const keys: PageKey[] = [
    ...(Object.keys(PAGES) as (keyof typeof PAGES)[]),
    ...Object.keys(t('fr').treatments).map((s) => `treatment:${s}` as const),
  ];
  const link = (hreflang: string, href: string) => `<xhtml:link rel="alternate" hreflang="${hreflang}" href="${href}"/>`;
  const urls: string[] = [];
  for (const key of keys) {
    let alts = alternates(key).map((a) => link(a.hreflang, a.href)).join('');
    // Accueils : la page de choix de langue est la cible x-default, comme dans leur HTML
    if (key === 'home') {
      alts += link('x-default', `${SITE}/`);
      urls.push(`  <url><loc>${SITE}/</loc>${alts}</url>`);
    }
    for (const l of LANGS) urls.push(`  <url><loc>${SITE}${pagePath(l, key)}</loc>${alts}</url>`);
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
