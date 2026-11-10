export const prerender = false;
// Point d'entrée des tâches planifiées pour un timer systemd ou un cron : POST avec « Authorization: Bearer <TASKS_SECRET> ».
// Sans TASKS_SECRET configuré, ou avec un mauvais secret : 404, comme une route inexistante.
import type { APIRoute } from 'astro';
import { timingSafeEqual } from 'node:crypto';
import { TASKS_SECRET } from 'astro:env/server';
import { runJobs } from '../../lib/server/jobs.ts';
import { log } from '../../lib/server/log.ts';

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export const POST: APIRoute = async ({ request, locals }) => {
  const given = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
  if (!TASKS_SECRET || !same(given, TASKS_SECRET)) {
    if (TASKS_SECRET) log('tasks_denied', { ip: locals.ip });
    return new Response(null, { status: 404 });
  }
  return Response.json(await runJobs());
};
