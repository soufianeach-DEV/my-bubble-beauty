// Habillage d'hiver : période et accueil d'hiver, partagés par l'application (reglages.ts) et le serveur (server.mjs).
// auto = du 1er décembre au 6 janvier, heure de Bruxelles ; on / off = choix de l'admin.
export function seasonOn(mode, now = new Date()) {
  if (mode !== 'auto') return mode === 'on';
  const [m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', month: '2-digit', day: '2-digit' }).format(now).split('-').map(Number);
  return m === 12 || (m === 1 && d <= 6);
}
export const seasonMode = (value) => (value === 'on' || value === 'off' ? value : 'auto');

// Accueil pré-rendu en deux versions : /fr/index.html (image habituelle) et /fr/accueil-hiver.html (image d'hiver, même canonical).
// Le serveur sert la seconde à l'adresse de la première pendant la saison ; l'adresse d'hiver n'est jamais servie telle quelle.
const HOME = /^\/(fr|nl|eng)\/index\.html$/;
const WINTER = /^\/(fr|nl|eng)\/accueil-hiver\.html$/;
// Chemin à servir à la place de l'accueil (saison active), sinon null
export const winterHome = (path, on) => (on && HOME.test(path) ? path.replace(/index\.html$/, 'accueil-hiver.html') : null);
// Adresse d'hiver demandée directement : renvoi vers l'accueil de la langue
export const winterDirect = (path) => (WINTER.test(path) ? path.replace(/accueil-hiver\.html$/, 'index.html') : null);
