// npm run admin:totp : nouveau secret TOTP de l'admin (20 octets) et son URI otpauth://, à saisir à la main dans l'appli d'authentification.
// Le secret va dans ADMIN_TOTP_SECRET (variables de Render), jamais dans le dépôt.
import { randomBytes } from 'node:crypto';
import { base32Encode } from '../src/lib/server/totp.ts';

const secret = base32Encode(randomBytes(20));
const account = encodeURIComponent(process.env.ADMIN_EMAIL || 'admin');
console.log(`ADMIN_TOTP_SECRET=${secret}`);
console.log(`otpauth://totp/My%20Bubble:${account}?secret=${secret}&issuer=My%20Bubble&algorithm=SHA1&digits=6&period=30`);
