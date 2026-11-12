export const prerender = false;
// Sonde de santé (healthCheckPath de Render, surveillance externe) : le site répond ET la base répond.
// 200 « ok » ou 503 « indisponible », sans détail : rien sur la version, la base ni l'erreur. L'erreur va au journal.
// Chaque appel touche la base : Supabase gratuit ne se met plus en pause tant qu'une sonde passe.
import type { APIRoute } from 'astro';
import { sql } from '../../lib/server/db.ts';
import { log } from '../../lib/server/log.ts';

const reply = (status: number, body: string) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });

// shortcut: délai de 5 s codé ici ; une base qui répond plus lentement compte comme en panne
const within = <T>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, no) => setTimeout(() => no(new Error('délai dépassé')), ms).unref())]);

export const GET: APIRoute = async () => {
  try {
    await within(sql`SELECT 1`, 5000);
    return reply(200, 'ok');
  } catch (e) {
    log('health_failed', { error: String(e) });
    return reply(503, 'indisponible');
  }
};
// Certaines sondes (UptimeRobot) envoient HEAD par défaut
export const HEAD = GET;
