// Durées des sessions (ASVS 3.3.2 niveau 2, pour toutes), en intervalles Postgres : seule source pour session.ts et la purge (db/purge.mjs).
export const SESSION_IDLE = '30 minutes';
export const SESSION_MAX = '12 hours';
