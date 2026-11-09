// Durées des sessions (ASVS 3.3.2 niveau 2, pour toutes), en intervalles Postgres : seule source pour session.ts et la purge (db/purge.mjs).
export const SESSION_IDLE = '30 minutes';
export const SESSION_MAX = '12 hours';
// « Se souvenir de moi » (case cochée à la connexion, clientes seulement) : 30 jours sans redemander le mot de passe.
// Écart assumé à ASVS 3.3.2 niveau 2, au choix de la cliente ; l'admin reste à 30 min / 12 h et au code TOTP.
export const SESSION_REMEMBER = '30 days';
export const SESSION_REMEMBER_SECONDS = 30 * 24 * 3600;
