// Retour après connexion : un chemin du site uniquement. « commence par / » ne suffit pas (/\evil, /<TAB>/evil, //evil).
export function safeReturn(raw: unknown, siteUrl: string, fallback = '/'): string {
  if (typeof raw !== 'string' || raw === '') return fallback;
  try {
    const u = new URL(raw, siteUrl);
    // Un chemin qui commence par // serait relu par le navigateur comme un autre domaine
    if (u.origin !== new URL(siteUrl).origin || u.pathname.startsWith('//')) return fallback;
    return u.pathname + u.search;
  } catch {
    return fallback;
  }
}
