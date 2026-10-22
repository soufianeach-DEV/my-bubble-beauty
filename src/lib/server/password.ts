// Politique OWASP : 12 à 128 caractères, tous caractères permis, aucune règle de composition, refus des mots de passe connus (HIBP).
// Aussi la garde des adresses saisies, commune à la connexion, à l'inscription et à l'oubli.
import { createHash } from 'node:crypto';
import { log } from './log.ts';

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

// Adresse saisie inutilisable, refusée avant toute requête et toute clé de limite : une adresse valide fait au plus 254 caractères,
// et un caractère NUL ferait échouer Postgres (22021) au lieu d'un refus ordinaire
export const badEmail = (email: string) => email.length > 254 || email.includes('\0');

// Longueur en caractères Unicode : un emoji compte pour un
export function passwordProblem(password: string): 'short' | 'long' | null {
  const n = [...password].length;
  return n < PASSWORD_MIN ? 'short' : n > PASSWORD_MAX ? 'long' : null;
}

// Réponse « range » avec Add-Padding : les suffixes de bourrage portent un compte 0
export const inRange = (body: string, suffix: string) =>
  body.split('\n').some((line) => {
    const [s, n] = line.trim().split(':');
    return s === suffix && Number(n) > 0;
  });

// k-anonymat : seuls 5 caractères du SHA-1 quittent le serveur. HIBP muet en 2 s : on laisse passer et on le journalise.
export async function isPwned(password: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  const sha = createHash('sha1').update(password).digest('hex').toUpperCase();
  try {
    const res = await fetcher(`https://api.pwnedpasswords.com/range/${sha.slice(0, 5)}`, { headers: { 'Add-Padding': 'true' }, signal: AbortSignal.timeout(2000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return inRange(await res.text(), sha.slice(5));
  } catch (e) {
    log('hibp_unavailable', { error: String(e) });
    return false;
  }
}
