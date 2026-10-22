// Connexion Postgres des routes à la demande : requêtes par gabarit paramétré uniquement, jamais de concaténation.
import postgres from 'postgres';
import { DATABASE_URL } from 'astro:env/server';

export const sql = postgres(DATABASE_URL, {
  max: 5,
  // Session à l'heure de Bruxelles : current_date, isodow et generate_series suivent le salon, pas l'UTC du serveur
  connection: { TimeZone: 'Europe/Brussels' },
  // bigint (identifiants, count) en nombre JS plutôt qu'en chaîne : les valeurs restent loin de 2^53
  types: { bigint: { to: 20, from: [20], serialize: (x: number) => String(x), parse: (x: string) => Number(x) } },
});
