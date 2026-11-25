// En-têtes de sécurité de server.mjs : le logo des mails est le seul fichier chargeable hors du site (CORP cross-origin).
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('CORP : cross-origin pour le logo des mails, same-origin partout ailleurs', async () => {
  const { securityHeaders } = await import('../../../db/securite.mjs');
  assert.equal(securityHeaders('/assets/img/logo-mail.png')['Cross-Origin-Resource-Policy'], 'cross-origin');
  for (const p of ['/assets/img/logo.png', '/assets/img/logo-mail.png.bak', '/assets/js/main.js', '/fr/index.html', '/admin', '/'])
    assert.equal(securityHeaders(p)['Cross-Origin-Resource-Policy'], 'same-origin', p);
  const logo = securityHeaders('/assets/img/logo-mail.png');
  const other = securityHeaders('/fr/index.html');
  for (const k of Object.keys(other)) if (k !== 'Cross-Origin-Resource-Policy') assert.equal(logo[k], other[k], `${k} inchangé`);
  assert.ok(other['Content-Security-Policy'].includes("frame-ancestors 'none'") && other['X-Frame-Options'] === 'DENY');
});
