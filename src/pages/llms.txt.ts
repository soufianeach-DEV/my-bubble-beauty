// llms.txt généré au build, comme robots.txt : les adresses suivent SITE, les faits viennent de site.ts et fr.json.
// Plasma et dents sont exclus tant que leur cadre légal n'est pas vérifié.
import type { APIRoute } from 'astro';
import { SITE, CONTACT, FOLDER, hoursRows, pagePath, t } from '../lib/site';

const EXCLUS = ['plasma', 'dents'];

export const GET: APIRoute = () => {
  const d = t('fr');
  const soins = Object.entries(d.treatments)
    .filter(([slug]) => !EXCLUS.includes(slug))
    .map(([slug, s]) => `- [${s.title}](${SITE}${pagePath('fr', `treatment:${slug}`)}): ${s.description}`);
  return new Response(
    [
      '# My Bubble Beauty',
      '',
      `> Institut de beauté et de bien-être à Dilbeek (${CONTACT.street}, ${CONTACT.postal} ${CONTACT.city}, Belgique), aux portes d'Anderlecht, de Molenbeek-Saint-Jean et de Berchem-Sainte-Agathe. Une seule adresse.`,
      '',
      `Téléphone : ${CONTACT.phoneLabel}. E-mail : ${CONTACT.email}. Réservation en ligne : ${SITE}/${FOLDER.fr}/reserver`,
      '',
      `Horaires : ${hoursRows('fr').map((r) => `${r.label} ${r.value}`).join(' ; ')}.`,
      '',
      '## Pages principales',
      `- [Accueil (FR)](${SITE}${pagePath('fr', 'home')}): soins, tarifs, questions fréquentes et contact`,
      `- [Startpagina (NL)](${SITE}${pagePath('nl', 'home')})`,
      `- [Home (EN)](${SITE}${pagePath('en', 'home')})`,
      '',
      '## Soins',
      ...soins,
      '',
    ].join('\n'),
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  );
};
