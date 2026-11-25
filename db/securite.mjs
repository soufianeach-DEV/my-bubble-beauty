// En-têtes de sécurité posés par server.mjs sur toutes les réponses.
// CSP du site ; form-action autorise la redirection 303 vers Stripe Checkout après le formulaire de réservation
const SECURITY = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https://*.goatcounter.com; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self' https://checkout.stripe.com; frame-ancestors 'none'; upgrade-insecure-requests",
  // Sans includeSubDomains : mail. (CNAME OVH, inventaire DNS du 22/10/2026) n'a pas de certificat à son nom, le navigateur le bloquerait un an
  'Strict-Transport-Security': 'max-age=31536000',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
};

// Images chargées hors du site : le logo des mails, affiché par les webmails qui chargent l'image depuis le navigateur
// (sans relais côté serveur). Seule exception à same-origin ; tout autre fichier reste réservé au site.
const CROSS_ORIGIN = new Set(['/assets/img/logo-mail.png']);

export function securityHeaders(path) {
  return CROSS_ORIGIN.has(path) ? { ...SECURITY, 'Cross-Origin-Resource-Policy': 'cross-origin' } : SECURITY;
}
