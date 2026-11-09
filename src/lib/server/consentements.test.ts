// Sur une base jetable (TEST_DATABASE_URL=… npm test) : consentement laser demandé avant le rendez-vous, signé avec la mention,
// texte figé et vérifiable, cloisonné entre clientes, rien de personnel au journal, effacé avec le compte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const url = process.env.TEST_DATABASE_URL;
const ENV = { SITE_URL: 'https://test.local', ADMIN_EMAIL: 'gerante@test.local', ADMIN_TOTP_SECRET: 'JBSWY3DPEHPK3PXP', PASSWORD_PEPPER: 'poivre-de-test-32-caracteres-min!' };
Object.assign(process.env, ENV);
registerHooks({
  resolve: (spec, ctx, next) =>
    spec === 'astro:env/server'
      ? { url: 'data:text/javascript,export const { DATABASE_URL, SITE_URL, ADMIN_EMAIL, ADMIN_TOTP_SECRET, PASSWORD_PEPPER, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, RESEND_API_KEY, MAIL_FROM } = process.env;', shortCircuit: true }
      : next(spec, ctx),
  load: (u, ctx, next) => next(u, u.endsWith('.json') ? { ...ctx, importAttributes: { type: 'json' } } : ctx),
});

test('consentements sur une vraie base', { skip: !url && 'TEST_DATABASE_URL absente' }, async () => {
  process.env.DATABASE_URL = url;
  const { sql } = await import('./db.ts');
  const { migrate } = await import('../../../db/migrate.mjs');
  const cons = await import('./consentements.ts');
  const rgpd = await import('./rgpd.ts');
  const tag = `k${Date.now()}`;
  const mk = async (n: string) => (await sql`INSERT INTO users (email, password_hash, name, email_verified_at) VALUES (${`${tag}${n}@test.local`}, 'x', ${n}, now()) RETURNING id`)[0].id as number;
  try {
    await migrate(sql);
    const cl = await mk('cliente');
    const other = await mk('autre');
    const [laser] = await sql`INSERT INTO services (slug, category, name_fr, name_nl, name_en, duration_min, price_cents, active)
      VALUES (${`laser-${tag}`}, 'epilation', 'Laser test', 'Laser test', 'Laser test', 30, 4500, true) RETURNING id`;
    const soon = new Date(Date.now() + 40 * 86_400_000);
    await sql`INSERT INTO bookings (user_id, service_id, starts_at, ends_at, status, price_cents)
      VALUES (${cl}, ${laser.id}, ${soon}, ${new Date(soon.getTime() + 1_800_000)}, 'confirmed', 4500)`;
    assert.deepEqual(await cons.pendingConsents(cl), ['laser']);
    assert.deepEqual(await cons.pendingConsents(other), []);

    const sign = (mention: string, name = 'Cliente Test') => cons.signConsent({ userId: cl, kind: 'laser', signerName: name, mention, ip: '127.0.0.1', userAgent: 'test' });
    // Sans nom du spécialiste réglé, le texte serait incomplet : rien n'est signé
    await sql`UPDATE settings SET value = '""' WHERE key = 'specialist_name'`;
    assert.deepEqual(await sign('Lu et approuvé'), { ok: false, error: 'specialist' });
    await sql`INSERT INTO settings (key, value) VALUES ('specialist_name', '"Spécialiste Test"') ON CONFLICT (key) DO UPDATE SET value = excluded.value`;
    assert.deepEqual(await sign('lu'), { ok: false, error: 'mention' });
    assert.deepEqual(await sign('Lu et approuvé', 'X'), { ok: false, error: 'name' });
    const r = await sign(' lu  et APPROUVÉ ');
    assert.ok(r.ok);
    assert.deepEqual(await cons.pendingConsents(cl), []);

    const c = (await cons.readConsent(cl, (r as { id: number }).id))!;
    assert.ok(c.intact);
    assert.equal(c.mention, 'Lu et approuvé');
    assert.equal(c.channel, 'online');
    assert.ok(c.text.includes('poser toutes les questions à Spécialiste Test'));
    // Une autre cliente ne lit pas ce consentement
    assert.equal(await cons.readConsent(other, c.id), null);
    // Texte modifié en base après coup : l'empreinte le signale
    await sql`UPDATE consents SET text = text || ' ' WHERE id = ${c.id}`;
    assert.equal((await cons.readConsent(cl, c.id))!.intact, false);
    // Ni nom ni texte au journal
    const [j] = await sql`SELECT details FROM audit_log WHERE action = 'consent_signed' AND client_id = ${cl}`;
    assert.deepEqual(j.details, { kind: 'laser', version: cons.FORMS.laser.version, channel: 'online' });
    // Export de la cliente : son consentement y figure ; effacement : il part avec le compte
    assert.equal((await rgpd.exportData(cl, '127.0.0.1')).consents.length, 1);
    await rgpd.eraseUser(cl, cl, null, 'self');
    assert.equal((await sql`SELECT 1 FROM consents WHERE user_id = ${cl}`).length, 0);

    // Suivi des séances : antécédents refusés sans accord santé, chiffrés avec, effacés au retrait de l'accord ; zone d'une séance réalisée
    const sv = await import('./suivi.ts');
    const f = (o: Record<string, string>) => Object.entries(o).reduce((x, [k, v]) => (x.set(k, v), x), new FormData());
    const health = { action: 'health', id: String(other), birth_date: '1990-05-04', medical_history: 'Allergie au latex' };
    assert.equal((await sv.suiviAction(other, f(health))).ok, false);
    await rgpd.setConsent(other, true, '127.0.0.1');
    const saved = await sv.suiviAction(other, f(health));
    assert.ok(saved.ok, JSON.stringify(saved));
    const [row] = await sql`SELECT medical_history, birth_date::text FROM users WHERE id = ${other}`;
    assert.ok(!Buffer.from(row.medical_history).includes(Buffer.from('latex')));
    assert.equal((await sv.suivi(other)).history, 'Allergie au latex');
    const [h] = await sql`SELECT details FROM audit_log WHERE details->>'action' = 'client_health' AND client_id = ${other}`;
    assert.equal(JSON.stringify(h.details).includes('latex'), false);
    await rgpd.setConsent(other, false, '127.0.0.1');
    assert.equal((await sql`SELECT medical_history FROM users WHERE id = ${other}`)[0].medical_history, null);
    const past = new Date(Date.now() - 50 * 86_400_000);
    const [b] = await sql`INSERT INTO bookings (user_id, service_id, starts_at, ends_at, status, price_cents)
      VALUES (${other}, ${laser.id}, ${past}, ${new Date(past.getTime() + 1_800_000)}, 'confirmed', 4500) RETURNING id`;
    assert.ok((await sv.suiviAction(other, f({ action: 'seance', id: String(other), booking: String(b.id), zone: 'Aisselles', practitioner: '' }))).ok);
    assert.deepEqual((await sv.suivi(other)).seances.map((s) => s.zone), ['Aisselles']);
    // Une séance d'une autre cliente n'est pas modifiable par cette fiche
    assert.equal((await sv.suiviAction(other, f({ action: 'seance', id: String(cl), booking: String(b.id), zone: 'x', practitioner: '' }))).ok, false);

    // Blanchiment terminé : recommandations envoyées une seule fois ; une absence n'en reçoit pas
    const { sendAftercare } = await import('./booking.ts');
    const [wh] = await sql`INSERT INTO services (slug, category, name_fr, name_nl, name_en, duration_min, price_cents, active)
      VALUES (${`blanchiment-des-dents-${tag}`}, 'sourire', 'Blanchiment test', 'x', 'x', 60, 9000, true) RETURNING id`;
    const ended = new Date(Date.now() - 3_600_000 * 2);
    await sql`INSERT INTO bookings (user_id, service_id, starts_at, ends_at, status, price_cents, no_show) VALUES
      (${other}, ${wh.id}, ${ended}, ${new Date(ended.getTime() + 3_600_000)}, 'confirmed', 9000, false),
      (${other}, ${wh.id}, ${new Date(ended.getTime() - 3 * 3_600_000)}, ${new Date(ended.getTime() - 2 * 3_600_000)}, 'confirmed', 9000, true)`;
    const first = await sendAftercare();
    assert.ok(first >= 1);
    assert.equal((await sql`SELECT count(*)::int AS n FROM bookings WHERE service_id = ${wh.id} AND aftercare_sent_at IS NOT NULL`)[0].n, 1);
    assert.equal(await sendAftercare(), 0);

    // Compte désactivé ou supprimé par l'institut : son rendez-vous de demain reste, sans rappel
    const { sendReminders } = await import('./booking.ts');
    const gone = await mk('sansrappel');
    const tomorrow = new Date(Date.now() + 20 * 3_600_000 + 7 * 60_000);
    const [rb] = await sql`INSERT INTO bookings (user_id, service_id, starts_at, ends_at, status, price_cents, created_at)
      VALUES (${gone}, ${wh.id}, ${tomorrow}, ${new Date(tomorrow.getTime() + 3_600_000)}, 'confirmed', 9000, now() - interval '5 days') RETURNING id`;
    await sql`UPDATE users SET removed_at = now() WHERE id = ${gone}`;
    await sendReminders();
    assert.equal((await sql`SELECT reminder_sent_at FROM bookings WHERE id = ${rb.id}`)[0].reminder_sent_at, null);

    // Bon cadeau : code unique, valable pour son soin seulement, réservé puis rendu par une annulation, annulé pour de bon
    const gifts = await import('./cadeaux.ts');
    const made = await gifts.giftAction(other, f({ action: 'create', recipient: 'Maman', service: String(wh.id), duration_label: '60 min', message: 'Bon anniversaire' }));
    assert.ok(made.ok, JSON.stringify(made));
    const [gc] = await gifts.listGifts((made as { id: number }).id);
    assert.match(gc.code, gifts.GIFT_CODE);
    assert.equal(gc.state, 'valide');
    assert.ok(gc.expires_on > gc.issued_on);
    assert.deepEqual(await gifts.checkGift(sql, gc.code, laser.id), { problem: 'service' });
    assert.deepEqual(await gifts.checkGift(sql, 'CADEAU-AAAA-AAAA', wh.id), { problem: 'unknown' });
    assert.deepEqual(await gifts.checkGift(sql, gc.code, wh.id), { id: gc.id });
    const later = new Date(Date.now() + 60 * 86_400_000);
    const [gb] = await sql`INSERT INTO bookings (user_id, service_id, starts_at, ends_at, status, price_cents, discount_cents, gift_card_id)
      VALUES (${other}, ${wh.id}, ${later}, ${new Date(later.getTime() + 3_600_000)}, 'confirmed', 9000, 9000, ${gc.id}) RETURNING id`;
    assert.deepEqual(await gifts.checkGift(sql, gc.code, wh.id), { problem: 'used' });
    // Deux réservations actives sur le même bon : refusée par l'index unique, même si les contrôles se croisent
    await assert.rejects(sql`INSERT INTO bookings (user_id, service_id, starts_at, ends_at, status, price_cents, gift_card_id)
      VALUES (${other}, ${wh.id}, ${new Date(later.getTime() + 86_400_000)}, ${new Date(later.getTime() + 90_000_000)}, 'confirmed', 9000, ${gc.id})`, /bookings_gift_idx/);
    await sql`UPDATE bookings SET status = 'cancelled', cancelled_at = now() WHERE id = ${gb.id}`;
    assert.equal((await gifts.listGifts(gc.id))[0].state, 'valide');
    assert.ok((await gifts.giftAction(other, f({ action: 'cancel', id: String(gc.id), confirm: 'on' }))).ok);
    assert.deepEqual(await gifts.checkGift(sql, gc.code, wh.id), { problem: 'unknown' });
    await sql`UPDATE bookings SET gift_card_id = NULL WHERE gift_card_id = ${gc.id}`;
    await sql`DELETE FROM gift_cards WHERE id = ${gc.id}`;

    // Carte de fidélité (règles par défaut : séance à partir de 50 € payés, -10 % après 5, HydraPure après 10 séances et 1 000 € payés) :
    // absences, annulations, petits soins et soins réglés par bon cadeau ne comptent pas ; la remise vaut une fois par carte,
    // le soin offert remet la carte à zéro
    const fid = await import('./fidelite.ts');
    const fan = await mk('fidele');
    const visit = (daysAgo: number, extra: Partial<{ status: string; no_show: boolean; price: number; discount: number }> = {}) => {
      const at = new Date(Date.now() - daysAgo * 86_400_000 + 3 * 3_600_000);
      return sql`INSERT INTO bookings (user_id, service_id, starts_at, ends_at, status, price_cents, discount_cents, no_show)
        VALUES (${fan}, ${wh.id}, ${at}, ${new Date(at.getTime() + 3_600_000)}, ${extra.status ?? 'confirmed'}, ${extra.price ?? 9000}, ${extra.discount ?? 0},
          ${extra.no_show ?? false}) RETURNING id`;
    };
    for (let i = 1; i <= 5; i++) await visit(100 + i * 2);
    await visit(80, { no_show: true });
    await visit(79, { status: 'cancelled' });
    // Lèvre à 7,50 € ; soin à 60 € payé 45 € après code promo : sous le minimum, ne comptent pas
    await visit(78, { price: 750 });
    await visit(77, { price: 6000, discount: 1500 });
    let card = await fid.loyaltyCard(fan);
    assert.equal(card.spentCents, 45000);
    assert.deepEqual({ n: card.sessions, discount: card.discount, free: card.free }, { n: 5, discount: true, free: false });
    const soonish = new Date(Date.now() + 70 * 86_400_000);
    const [next] = await sql`INSERT INTO bookings (user_id, service_id, starts_at, ends_at, status, price_cents)
      VALUES (${fan}, ${wh.id}, ${soonish}, ${new Date(soonish.getTime() + 3_600_000)}, 'confirmed', 9000) RETURNING id`;
    const apply = (kind: string, booking: number) => fid.applyReward(other, f({ id: String(fan), kind, booking: String(booking), confirm: 'on' }));
    assert.equal((await apply('free', next.id)).ok, false);
    assert.ok((await apply('discount', next.id)).ok);
    assert.equal((await sql`SELECT discount_cents FROM bookings WHERE id = ${next.id}`)[0].discount_cents, 900);
    // Une seule remise par carte, même sur un autre rendez-vous
    const [next2] = await sql`INSERT INTO bookings (user_id, service_id, starts_at, ends_at, status, price_cents)
      VALUES (${fan}, ${wh.id}, ${new Date(soonish.getTime() + 86_400_000)}, ${new Date(soonish.getTime() + 90_000_000)}, 'confirmed', 9000) RETURNING id`;
    assert.equal((await apply('discount', next2.id)).ok, false);
    for (let i = 1; i <= 5; i++) await visit(60 - i * 2);
    // 10 séances mais 900 € payés : le soin offert attend 1 000 €
    card = await fid.loyaltyCard(fan);
    assert.deepEqual({ n: card.sessions, discount: card.discount, free: card.free }, { n: 10, discount: false, free: false });
    await visit(40);
    card = await fid.loyaltyCard(fan);
    assert.equal(card.free, false, '11 séances, 990 € : toujours sous les 1 000 €');
    await visit(38);
    card = await fid.loyaltyCard(fan);
    assert.deepEqual({ n: card.sessions, discount: card.discount, free: card.free }, { n: 12, discount: false, free: true });
    assert.ok(card.lifetime.rewardsCents === 900 && card.lifetime.spentCents > 0);
    assert.ok((await apply('free', next2.id)).ok);
    assert.equal((await sql`SELECT discount_cents FROM bookings WHERE id = ${next2.id}`)[0].discount_cents, 9000);
    card = await fid.loyaltyCard(fan);
    assert.deepEqual({ n: card.sessions, discount: card.discount, free: card.free }, { n: 0, discount: false, free: false });
    const [{ n: logged }] = await sql`SELECT count(*)::int AS n FROM audit_log WHERE client_id = ${fan} AND details->>'action' = 'loyalty_applied'`;
    assert.equal(logged, 2);
  } finally {
    await sql`DELETE FROM bookings WHERE service_id IN (SELECT id FROM services WHERE slug IN (${`laser-${tag}`}, ${`blanchiment-des-dents-${tag}`}))`;
    await sql`DELETE FROM services WHERE slug IN (${`laser-${tag}`}, ${`blanchiment-des-dents-${tag}`})`;
    await sql`DELETE FROM users WHERE email LIKE ${`${tag}%`}`;
    await sql`DELETE FROM settings WHERE key = 'specialist_name'`;
    await sql.end();
  }
});
