// Journal de sécurité (stdout, lu dans les logs Render) : une ligne JSON par événement, un saut de ligne saisi ne fabrique pas de fausse ligne.
// Jamais de mot de passe, jeton, cookie ni URL de page à jeton : les clés de ce genre sont retirées par sécurité.
const SECRET_KEY = /pass|token|secret|cookie|authorization/i;

export function log(event: string, data: Record<string, unknown> = {}) {
  const safe = Object.fromEntries(Object.entries(data).filter(([k]) => !SECRET_KEY.test(k)));
  console.log(JSON.stringify({ t: new Date().toISOString(), event, ...safe }));
}
