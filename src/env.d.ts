/// <reference types="astro/client" />

// Posés par src/middleware.ts sur chaque route à la demande ; chaque page relit user avant d'agir
declare namespace App {
  interface Locals {
    user: import('./lib/server/session.ts').SessionUser | null;
    session: import('./lib/server/session.ts').SessionInfo | null;
    // IP réelle (X-Forwarded-For lu par la droite, IPv6 en /64) pour les limites de tentatives
    ip: string;
  }
}
