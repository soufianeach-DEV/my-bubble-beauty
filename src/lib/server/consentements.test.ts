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
    const exp = await rgpd.exportData(cl, '127.0.0.1');
    assert.equal(exp.consents.length, 1);
    assert.ok('ip' in exp.consents[0] && 'user_agent' in exp.consents[0], "IP et appareil de la signature dans l'export");
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
    assert.equal(await sendAftercare(async () => false), 0, 'refus de Resend : rien de marqué');
    const first = await sendAftercare(async () => true);
    assert.ok(first >= 1);
    assert.equal((await sql`SELECT count(*)::int AS n FROM bookings WHERE service_id = ${wh.id} AND aftercare_sent_at IS NOT NULL`)[0].n, 1);
    assert.equal(await sendAftercare(async () => true), 0);

    // Compte désactivé ou supprimé par l'institut : son rendez-vous de demain reste, sans rappel
    const { sendReminders } = await import('./booking.ts');
    const gone = await mk('sansrappel');
    const tomorrow = new Date(Date.now() + 20 * 3_600_000 + 7 * 60_000);
    const [rb] = await sql`INSERT INTO bookings (user_id, service_id, starts_at, ends_at, status, price_cents, created_at)
      VALUES (${gone}, ${wh.id}, ${tomorrow}, ${new Date(tomorrow.getTime() + 3_600_000)}, 'confirmed', 9000, now() - interval '5 days') RETURNING id`;
    await sql`UPDATE users SET removed_at = now() WHERE id = ${gone}`;
    await sendReminders(async () => true);
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
    // Absence au rendez-vous du bon : le bon redevient utilisable, et la gérante peut le réattribuer à un autre soin
    const missed = new Date(Date.now() - 20 * 86_400_000 + 3 * 3_600_000);
    const [ab] = await sql`INSERT INTO bookings (user_id, service_id, starts_at, ends_at, status, price_cents, discount_cents, gift_card_id, no_show)
      VALUES (${other}, ${wh.id}, ${missed}, ${new Date(missed.getTime() + 3_600_000)}, 'confirmed', 9000, 9000, ${gc.id}, true) RETURNING id`;
    assert.equal((await gifts.listGifts(gc.id))[0].state, 'valide');
    const re = (service: number) => gifts.giftAction(other, f({ action: 'reassign', id: String(gc.id), service: String(service), confirm: 'on' }));
    assert.deepEqual(await re(laser.id), { ok: true, id: gc.id, key: 'reassign' }, 'soin moins cher : réattribué');
    assert.deepEqual(await gifts.checkGift(sql, gc.code, wh.id), { problem: 'service' });
    assert.deepEqual(await gifts.checkGift(sql, gc.code, laser.id), { id: gc.id });
    const [{ details: moved }] = await sql`SELECT details FROM audit_log WHERE details->>'action' = 'gift_reassigned' AND (details->>'gift_id')::bigint = ${gc.id}`;
    assert.deepEqual({ from: moved.from_service_id, to: moved.to_service_id }, { from: wh.id, to: laser.id });
    assert.equal((await re(wh.id) as { key?: string }).key, 'reassign-plus', 'soin plus cher : signalé, pas refusé');
    // Nouveau rendez-vous avec le bon : l'index ne compte plus l'absence ; retirer l'absence est alors refusé proprement
    const [nb] = await sql`INSERT INTO bookings (user_id, service_id, starts_at, ends_at, status, price_cents, discount_cents, gift_card_id)
      VALUES (${other}, ${wh.id}, ${new Date(later.getTime() + 2 * 86_400_000)}, ${new Date(later.getTime() + 2 * 86_400_000 + 3_600_000)}, 'confirmed', 9000, 9000, ${gc.id}) RETURNING id`;
    assert.equal((await re(laser.id)).ok, false, 'bon réservé : plus de réattribution');
    const { setNoShow } = await import('./booking.ts');
    assert.equal(await setNoShow(ab.id, false), 'gift');
    await sql`UPDATE bookings SET status = 'cancelled', cancelled_at = now() WHERE id IN (${ab.id}, ${nb.id})`;
    assert.ok((await gifts.giftAction(other, f({ action: 'cancel', id: String(gc.id), confirm: 'on' }))).ok);
    assert.deepEqual(await gifts.checkGift(sql, gc.code, wh.id), { problem: 'unknown' });
    await sql`UPDATE bookings SET gift_card_id = NULL WHERE gift_card_id = ${gc.id}`;
    await sql`DELETE FROM gift_cards WHERE id = ${gc.id}`;

    // Bon pour une cliente existante : nom et e-mail repris, rattaché à sa fiche ; envoi sans Resend = échec dit, bon gardé, journal sans code
    const fille = await mk('bonfille');
    const forClient = await gifts.giftAction(other, f({ action: 'create', client: `bonfille <${tag}bonfille@test.local>`, service: String(wh.id), send: 'on' }));
    assert.ok(forClient.ok && forClient.key === 'create-unsent', JSON.stringify(forClient));
    const [bc] = await gifts.listGifts((forClient as { id: number }).id);
    assert.deepEqual({ who: bc.recipient, mail: bc.recipient_email, user: bc.user_id }, { who: 'bonfille', mail: `${tag}bonfille@test.local`, user: fille });
    assert.deepEqual((await gifts.clientGifts(fille)).map((x) => x.id), [bc.id]);
    const exGift = await rgpd.exportData(fille, '127.0.0.1');
    assert.equal(exGift.gift_cards.length, 1);
    assert.ok(exGift.gift_cards[0].code_end === `…${bc.code.slice(-4)}` && !JSON.stringify(exGift).includes(bc.code), 'export : code masqué');
    const sent = await gifts.giftAction(other, f({ action: 'send', id: String(bc.id) }));
    assert.equal(sent.ok, false);
    assert.match((sent as { error: string }).error, /n'a pas pu partir/);
    // audit() écrit le journal sans être attendu : on laisse jusqu'à 2 s à la seconde ligne (le test échouait une fois sur deux)
    let logs = await sql`SELECT details FROM audit_log WHERE details->>'action' = 'gift_sent' AND (details->>'gift_id')::bigint = ${bc.id}`;
    for (let i = 0; i < 20 && logs.length < 2; i++) {
      await new Promise((r) => setTimeout(r, 100));
      logs = await sql`SELECT details FROM audit_log WHERE details->>'action' = 'gift_sent' AND (details->>'gift_id')::bigint = ${bc.id}`;
    }
    assert.equal(logs.length, 2);
    assert.ok(logs.every((l) => l.details.ok === false && !JSON.stringify(l.details).includes(bc.code)), 'journal sans le code');
    assert.equal((await gifts.giftAction(other, f({ action: 'create', client: 'inconnue@nulle.part', service: String(wh.id) }))).ok, false, 'cliente inconnue refusée');
    const noMail = await gifts.giftAction(other, f({ action: 'create', recipient: 'Sans adresse', service: String(wh.id) }));
    assert.match((await gifts.giftAction(other, f({ action: 'send', id: String((noMail as { id: number }).id) })) as { error: string }).error, /pas d'adresse/);
    await sql`DELETE FROM gift_cards WHERE id IN (${bc.id}, ${(noMail as { id: number }).id})`;

    // Fiche remplie par la cliente : sans accord, la santé est ignorée ; avec la case cochée, accord daté et santé chiffrée ;
    // son mot va dans client_note, jamais dans les notes internes
    const profilMod = await import('./profil.ts');
    const fc = await mk('fichecl');
    const own = (o: Record<string, string | string[]>) => { const x = new FormData(); for (const [k, v] of Object.entries(o)) for (const w of [v].flat()) x.append(k, w); return profilMod.saveOwnProfile(fc, x, '127.0.0.1'); };
    assert.ok((await own({ heat: 'chaud', zones: ['dos', 'pieds'], allergies: 'latex', client_note: 'Merci !' })).ok);
    let mine = await profilMod.readProfile(fc);
    assert.deepEqual({ heat: mine.care.heat, zones: mine.care.zones, consent: mine.consent, health: mine.health, note: mine.clientNote, notes: mine.notes, filled: !!mine.filledAt },
      { heat: 'chaud', zones: ['dos', 'pieds'], consent: false, health: null, note: 'Merci !', notes: '', filled: true });
    assert.ok((await own({ heat: 'frais', health_consent: 'on', allergies: 'latex', skin: 'sensible' })).ok);
    mine = await profilMod.readProfile(fc);
    assert.ok(mine.consent && !!mine.consentAt);
    assert.deepEqual(mine.health?.allergies, ['latex']);
    assert.equal((await own({ client_note: 'x'.repeat(501) })).ok, false, 'mot trop long refusé');
    await profilMod.skipOwnProfile(fc);
    assert.ok(!!(await profilMod.readProfile(fc)).skippedAt);

    // Carte de fidélité (règles par défaut : séance à partir de 50 € payés, -10 % après 5, HydraPure après 10 séances et 1 000 € payés) :
    // absences, annulations, petits soins et soins réglés par bon cadeau ne comptent pas ; la remise vaut une fois par carte,
    // le soin offert remet la carte à zéro
    const fid = await import('./fidelite.ts');
    // Règles figées pour ce test (le défaut du site peut changer) : soin offert à 1 000 €
    await sql`INSERT INTO settings (key, value) VALUES ('loyalty', ${sql.json({ discount_after: 5, discount_percent: 10, free_after: 10, free_label: 'HydraPure', min_euros: 50, free_min_total: 1000, free_value: 120 })}) ON CONFLICT (key) DO UPDATE SET value = excluded.value`;
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

    // Suppression d'un rendez-vous par l'admin : la ligne disparaît, son avantage fidélité est rendu, rien n'est écrit au journal
    const { deleteAction } = await import('./admin.ts');
    const before = (await sql`SELECT count(*)::int AS n FROM audit_log`)[0].n;
    assert.equal((await deleteAction(f({ action: 'delete', id: String(next2.id) }))).ok, false, 'case « Je confirme » exigée');
    assert.ok((await deleteAction(f({ action: 'delete', id: String(next2.id), confirm: 'on' }))).ok);
    assert.equal((await sql`SELECT 1 FROM bookings WHERE id = ${next2.id}`).length, 0);
    assert.equal((await sql`SELECT 1 FROM loyalty_rewards WHERE booking_id = ${next2.id} OR (user_id = ${fan} AND kind = 'free')`).length, 0);
    assert.equal((await fid.loyaltyCard(fan)).free, true, 'le soin offert redevient disponible');
    // Le journal ne bouge pas (attente : les lignes du journal partent en tâche détachée)
    await new Promise((r) => setTimeout(r, 200));
    assert.equal((await sql`SELECT count(*)::int AS n FROM audit_log`)[0].n, before);
    assert.equal((await deleteAction(f({ action: 'delete', id: String(next2.id), confirm: 'on' }))).ok, false);

    // Soin offert sur un rendez-vous à 200 € : plafonné au prix de l'HydraPure (120 €) ; annulé, l'avantage est rendu
    const [big] = await sql`INSERT INTO bookings (user_id, service_id, starts_at, ends_at, status, price_cents)
      VALUES (${fan}, ${wh.id}, ${new Date(soonish.getTime() + 3 * 86_400_000)}, ${new Date(soonish.getTime() + 3 * 86_400_000 + 3_600_000)}, 'confirmed', 20000) RETURNING id`;
    assert.ok((await apply('free', big.id)).ok);
    assert.deepEqual({ ...(await sql`SELECT amount_cents, percent FROM loyalty_rewards WHERE booking_id = ${big.id}`)[0] }, { amount_cents: 12000, percent: 60 });
    const { cancelByAdmin } = await import('./booking.ts');
    assert.ok((await cancelByAdmin(big.id, false)).ok);
    assert.equal((await sql`SELECT 1 FROM loyalty_rewards WHERE booking_id = ${big.id}`).length, 0);
    assert.equal((await fid.loyaltyCard(fan)).free, true, 'rendez-vous annulé : le soin offert redevient disponible');
    const out = await rgpd.exportData(fan, '127.0.0.1');
    assert.deepEqual(out.loyalty_rewards.map((r) => r.kind), ['discount'], "l'export liste l'avantage encore porté");
    assert.ok('zone' in out.bookings[0] && 'practitioner' in out.bookings[0]);

    // Fiche de soin : préférences sans accord santé ; allergies refusées sans accord, chiffrées avec ; alertes ; export lisible
    const prof = await import('./profil.ts');
    const sheet = await mk('fiche');
    const fd = (o: Record<string, string | string[]>) => Object.entries(o).reduce((x, [k, v]) => ((Array.isArray(v) ? v : [v]).forEach((y) => x.append(k, y)), x), new FormData());
    const base = { heat: 'frais', cover: 'couverte', touch: 'prevenir', zones: ['ventre', 'pieds', 'inconnue'], notes: 'Ancienne note gardée.' };
    assert.equal((await prof.saveProfile(other, sheet, fd({ ...base, allergies: ['latex'] }))).ok, false);
    assert.ok((await prof.saveProfile(other, sheet, fd(base))).ok);
    let read = await prof.readProfile(sheet);
    assert.deepEqual(read.care.zones, ['ventre', 'pieds']);
    assert.equal(read.notes, 'Ancienne note gardée.');
    await rgpd.setConsent(sheet, true, '127.0.0.1');
    assert.ok((await prof.saveProfile(other, sheet, fd({ ...base, allergies: ['latex', 'autre'], allergies_other: 'Cire au miel', skin: ['sensible'] }))).ok);
    const [raw] = await sql`SELECT health_profile FROM users WHERE id = ${sheet}`;
    assert.ok(!Buffer.from(raw.health_profile).includes(Buffer.from('latex')));
    const alerts = (await prof.alertsFor([sheet])).get(sheet);
    assert.deepEqual(alerts, ['Ne pas toucher : Ventre, Pieds', 'Allergie : Latex, Cire au miel', 'Prévenir avant chaque contact']);
    // Feuille du jour imprimée : mêmes alertes, contre-indications avec l'accord seulement (vérifié plus bas après retrait)
    assert.ok((await prof.saveProfile(other, sheet, fd({ ...base, allergies: ['latex', 'autre'], allergies_other: 'Cire au miel', skin: ['sensible'], contra: 'Rétinoïdes' }))).ok);
    assert.deepEqual((await prof.printNotesFor([sheet])).get(Number(sheet)), { alerts, contra: 'Rétinoïdes' });
    const ex = await rgpd.exportData(sheet, '127.0.0.1');
    assert.deepEqual(ex.account.care_sheet.sante.allergies, ['Latex', 'Autre']);
    assert.equal(ex.account.care_sheet.zones_et_toucher.toucher, 'Prévenir avant chaque contact');
    // Accord retiré : la partie santé est effacée, les préférences restent
    await rgpd.setConsent(sheet, false, '127.0.0.1');
    read = await prof.readProfile(sheet);
    assert.equal(read.health, null);
    assert.equal((await sql`SELECT health_profile FROM users WHERE id = ${sheet}`)[0].health_profile, null);
    assert.equal(read.care.touch, 'prevenir');
    assert.deepEqual((await prof.printNotesFor([sheet])).get(Number(sheet)), { alerts: ['Ne pas toucher : Ventre, Pieds', 'Prévenir avant chaque contact'], contra: '' }, 'sans accord : ni allergies ni contre-indications sur la feuille');
  } finally {
    await sql`DELETE FROM bookings WHERE service_id IN (SELECT id FROM services WHERE slug IN (${`laser-${tag}`}, ${`blanchiment-des-dents-${tag}`}))`;
    await sql`DELETE FROM services WHERE slug IN (${`laser-${tag}`}, ${`blanchiment-des-dents-${tag}`})`;
    await sql`DELETE FROM users WHERE email LIKE ${`${tag}%`}`;
    await sql`DELETE FROM settings WHERE key IN ('specialist_name', 'loyalty')`;
    await sql.end();
  }
});
