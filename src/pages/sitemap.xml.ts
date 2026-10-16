// Sitemap généré depuis les mêmes données que les pages : il ne peut pas se désynchroniser.
import type { APIRoute } from 'astro';
import { LANGS, PAGES, SITE, t, pagePath, alternates, type PageKey } from '../lib/site';

export const GET: APIRoute = () => {
  const today = new Date().toISOString().slice(0, 10);
  const keys: PageKey[] = [
    ...(Object.keys(PAGES) as (keyof typeof PAGES)[]),
    ...Object.keys(t('fr').treatments).map((s) => `treatment:${s}` as const),
  ];
  const urls = [`  <url><loc>${SITE}/</loc><lastmod>${today}</lastmod></url>`];
  for (const key of keys) {
    const alts = alternates(key)
      .map((a) => `<xhtml:link rel="alternate" hreflang="${a.hreflang}" href="${a.href}"/>`)
      .join('');
    for (const l of LANGS) urls.push(`  <url><loc>${SITE}${pagePath(l, key)}</loc><lastmod>${today}</lastmod>${alts}</url>`);
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
