export const prerender = false;
// Habillage de saison du site public : réglage de l'admin (auto, toujours, jamais) et dates (1er décembre → 6 janvier, Bruxelles).
// Lu par saison.js sur les pages publiques ; même réponse pour tout le monde, cache de 5 minutes.
import type { APIRoute } from 'astro';
import { seasonActive } from '../../lib/server/reglages.ts';

export const GET: APIRoute = async () =>
  Response.json({ on: await seasonActive() }, { headers: { 'Cache-Control': 'public, max-age=300' } });
