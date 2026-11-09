// Consentements écrits de l'institut (documents de Souade, en français) : signés en ligne par la cliente depuis son compte,
// ou à l'institut sur tablette depuis la fiche. On garde le texte exact signé, sa version, son empreinte, le nom saisi,
// la mention « Lu et approuvé », le nom du spécialiste, la date, l'IP et l'appareil. Signature électronique simple (eIDAS, art. 25).
import { createHash } from 'node:crypto';
import { sql } from './db.ts';
import { journal } from './journal.ts';

export type ConsentKind = 'laser' | 'photo' | 'cavitation';
export type ConsentForm = { kind: ConsentKind; version: string; title: string; html: string; closing: string };

// Changer un texte = nouvelle version : les consentements déjà signés gardent le texte de leur version
const LASER = `<p>L'épilation définitive au laser est la méthode la plus efficace pour traiter les problèmes de pilosité de manière définitive, que ce soit dans un but esthétique ou thérapeutique (traitement des poils incarnés).</p>
<h2>Les types de poils traités par le laser</h2>
<p>L'efficacité du laser sera optimale sur une peau claire avec des poils foncés. Les poils dénués de mélanine (blancs, roux ou duvet blond).</p>
<h2>Nombre de séances d'épilation définitive au laser nécessaires</h2>
<p>Le nombre de séances nécessaires dépend de plusieurs facteurs et de la physiologie de chacun. Il faut prendre en considération le type de peau, la nature du poil, le sexe du patient, son âge et la zone à épiler. Certains dérèglements hormonaux sont à prendre en compte également.</p>
<p>Les poils suivent un cycle de vie de 4 à 18 mois.</p>
<p>Il est impératif d'attendre qu'une nouvelle génération de poils apparaisse pour faire la séance suivante. Le délai varie en fonction de la zone traitée, du phototype de peau et de la nature du poil. En moyenne, il faut prévoir une période de 6 à 8 semaines entre chaque séance.</p>
<h2>Recommandations pour l'épilation définitive au laser</h2>
<p>Voici les notions importantes à savoir avant de commencer un traitement au laser :</p>
<ul>
<li>L'exposition au soleil est proscrite pendant la durée du traitement. En effet le soleil active la mélanine de la peau qui est la cible pour le laser, ce qui pourrait provoquer une brûlure.</li>
<li>Pour les mêmes raisons, il est nécessaire d'arrêter l'application d'autobronzant.</li>
<li>Il est important de ne pas s'épiler à la cire (ou toute autre technique qui s'attaque au bulbe du poil comme : la pince à épiler, la crème dépilatoire, l'épilation au sucre…) le mois précédant la séance. Par contre, vous devrez raser la zone à traiter le jour même avant votre rendez-vous, sauf s'il s'agit du visage. Dans ce cas, les poils étant plus fins, ils seront plus facilement éradiqués par le laser.</li>
<li>Le poil doit mesurer maximum 1 mm car c'est lui qui sert de conducteur au laser.</li>
<li>Il est très important de mentionner la prise d'un traitement médicamenteux à votre assistante. Dans le cas de médicaments photosensibilisants, elle devra paramétrer le laser en fonction.</li>
<li>Il est important de ne pas avoir porté de vêtements neufs non lavés la semaine précédant le traitement car ils laissent de petits pigments sur la peau qui sont une cible pour le laser.</li>
<li>La peau doit être sèche et vierge de tout cosmétique.</li>
<li>La sensation du patient est un baromètre important afin de déterminer l'énergie optimale du laser et éviter ainsi les brûlures.</li>
<li>Une peau tatouée n'est pas une contre-indication à l'épilation au laser. Nous prenons simplement des précautions particulières (pose d'un sparadrap sur la zone tatouée) pour éviter toute brûlure.</li>
</ul>`;

const PHOTO = `<p>Le but de ce traitement est de réduire ou éliminer le poil non désiré, étant nécessaires de 5 à 10 séances pour obtenir un bon résultat, en fonction de la couleur de la peau et du poil, de la zone à traiter et de possibles facteurs génétiques et/ou hormonaux.</p>
<h2>Instructions à suivre avant le traitement</h2>
<ol>
<li>Ne pas s'exposer au soleil ni rayons UVA 1 mois avant le traitement. La peau doit être la plus claire possible. Il est aussi déconseillé de s'exposer au soleil après le traitement. Utilisez un protecteur solaire à facteur élevé si la zone à traiter est exposée au soleil.</li>
<li>La peau doit être bien hydratée. Évitez que votre peau soit sèche ou irritée en utilisant une crème faciale ou corporelle. N'utilisez pas de crèmes exfoliantes ou irritantes une semaine avant. N'utilisez pas non plus de crèmes, lotions ou lingettes auto-bronzantes.</li>
<li>N'épilez pas la zone à traiter avec de la cire, des pinces ou autre un mois avant et jusqu'à la fin du traitement. Vous pouvez raser ou couper aux ciseaux.</li>
<li>Faites-nous savoir si vous avez réalisé récemment des traitements à base d'isotrétinoïne (Roaccutane), peeling chimique, laser resurfacing ou si vous souffrez d'herpès simple sur la zone à traiter, ou en cas de maquillage permanent sur sourcils, lèvres, etc.</li>
</ol>
<h2>La sensation pendant le traitement</h2>
<p>La sensation pendant le traitement passe d'un léger fourmillement à une sensation de chaleur intense qui dure un moment même si certains patients ressentent de la douleur sur les zones présentant plus de poils. Les effets immédiats se traduisent habituellement par des rougeurs et un œdème périfolliculaire qui disparaissent au bout de quelques heures. Dans 5 à 10 % des cas, des petites brûlures peuvent se produire, qui guérissent en 1 à 2 semaines, pouvant laisser une hypo- ou hyperpigmentation résiduelle transitoire.</p>
<p>D'une séance à l'autre, il faut laisser passer 45 jours.</p>`;

const CAVITATION = `<p>La cavitation est une technique non invasive pour sculpter le corps qui permet de réduire le volume, la cellulite et les dépôts de graisse localisée au niveau de :</p>
<ul><li>Abdomen et côtés</li><li>Culotte de cheval et face interne des cuisses et genoux</li><li>Bras</li><li>Dos</li></ul>
<p>Le nombre de séances est variable selon le client et la zone à traiter, de 6 à 12 séances.</p>
<h2>Contre-indications</h2>
<ul><li>Allergiques à la céramique ou autres composants</li><li>Femmes enceintes ou en période d'allaitement.</li><li>Présence de néoplasies (tumeurs)</li><li>Maladie infecto-contagieuse</li><li>Maladie auto-immune</li><li>Prévenir si vous portez un implant métallique</li><li>Cholestérol</li><li>Si vous souffrez de phlébite (inflammation des veines)</li><li>Si vous portez un pacemaker ou électrode implanté</li><li>Graves problèmes de circulation ou d'hypertension</li><li>Infections de la peau</li><li>Applications sur enfants ou adolescents</li></ul>
<h2>Recommandations</h2>
<ul><li>Il convient d'avoir une alimentation équilibrée</li><li>Drainage lymphatique manuel ou pressothérapie</li><li>Il est très important de boire beaucoup d'eau pendant tout le traitement (de 1,5 à 2 litres par jour)</li></ul>`;

const ASKED = "J'ai lu et je comprends toute l'information présentée dans ce document. J'ai également eu l'opportunité de poser toutes les questions à {specialiste} et j'accepte de recevoir le traitement.";

export const FORMS: Record<ConsentKind, ConsentForm> = {
  laser: { kind: 'laser', version: '2026-11-09', title: 'Consentement épilation définitive au laser', html: LASER, closing: ASKED },
  photo: { kind: 'photo', version: '2026-11-09', title: 'Consentement éclairé photo-épilation', html: PHOTO, closing: ASKED },
  cavitation: { kind: 'cavitation', version: '2026-11-09', title: 'Consentement éclairé cavitation', html: CAVITATION,
    closing: "J'ai été informé sur ce traitement et ses contre-indications, je suis majeur, je signe et donne mon consentement." },
};
export const KINDS = Object.keys(FORMS) as ConsentKind[];
export const isKind = (k: unknown): k is ConsentKind => typeof k === 'string' && Object.hasOwn(FORMS, k);
export const MENTION = 'Lu et approuvé';

// Prestations de la carte qui exigent un consentement avant le premier rendez-vous. Photo-épilation et cavitation ne sont pas
// sur la carte : leurs consentements se signent à l'institut depuis la fiche.
export const consentFor = (slug: string): ConsentKind | null => (slug.startsWith('laser-') ? 'laser' : null);

// Nom du spécialiste réglé par l'admin (/admin/reglages) ; vide tant qu'il n'est pas saisi
export async function specialistName(): Promise<string> {
  const [r] = await sql<{ value: string }[]>`SELECT value #>> '{}' AS value FROM settings WHERE key = 'specialist_name'`;
  return r?.value ?? '';
}

// Texte exact soumis à la signature : celui qui est montré, gardé tel quel et haché
export const closingText = (f: ConsentForm, specialist: string) => f.closing.replace('{specialiste}', specialist || '(nom du spécialiste)');
export const signedText = (f: ConsentForm, specialist: string) => `${f.title}\n\n${f.html}\n\n${closingText(f, specialist)}`;

export type Consent = { id: number; kind: ConsentKind; version: string; signer_name: string; specialist: string; signed_at: Date; channel: 'online' | 'institut'; staff: string | null };

export const listConsents = (userId: number) => sql<Consent[]>`
  SELECT c.id, c.kind, c.version, c.signer_name, c.specialist, c.signed_at, c.channel, coalesce(s.name, s.email) AS staff
  FROM consents c LEFT JOIN users s ON s.id = c.staff_id WHERE c.user_id = ${userId} ORDER BY c.signed_at DESC`;

// Consentements à signer : prestations à venir (confirmées) qui en exigent un, pas encore signé pour ce type de soin
export async function pendingConsents(userId: number): Promise<ConsentKind[]> {
  const rows = await sql<{ slug: string }[]>`
    SELECT DISTINCT s.slug FROM bookings b JOIN services s ON s.id = b.service_id
    WHERE b.user_id = ${userId} AND b.status = 'confirmed' AND b.starts_at > now()`;
  const [signed] = await sql<{ kinds: ConsentKind[] }[]>`SELECT coalesce(array_agg(DISTINCT kind), '{}') AS kinds FROM consents WHERE user_id = ${userId}`;
  const need = new Set(rows.map((r) => consentFor(r.slug)).filter((k): k is ConsentKind => !!k));
  return [...need].filter((k) => !signed.kinds.includes(k));
}

export type SignInput = { userId: number; kind: ConsentKind; signerName: string; mention: string; ip: string; userAgent: string | null; staffId?: number | null };
export type SignResult = { ok: true; id: number } | { ok: false; error: 'mention' | 'name' | 'specialist' };

// Signature : le nom saisi et la mention « Lu et approuvé » recopiée sont exigés ; le texte signé est figé en base avec son empreinte.
// staffId : signature à l'institut (tablette), sinon en ligne depuis le compte de la cliente.
export async function signConsent(i: SignInput): Promise<SignResult> {
  const f = FORMS[i.kind];
  const name = i.signerName.trim().replace(/\s+/g, ' ');
  if (name.length < 3 || name.length > 100 || /\p{Cc}/u.test(name)) return { ok: false, error: 'name' };
  if (i.mention.trim().replace(/\s+/g, ' ').toLowerCase() !== MENTION.toLowerCase()) return { ok: false, error: 'mention' };
  const specialist = await specialistName();
  // Le texte cite le spécialiste à qui poser ses questions : sans nom réglé, rien n'est signé
  if (f.closing.includes('{specialiste}') && !specialist) return { ok: false, error: 'specialist' };
  const text = signedText(f, specialist);
  const channel = i.staffId ? 'institut' : 'online';
  const [r] = await sql<{ id: number }[]>`
    INSERT INTO consents (user_id, kind, version, text, text_sha256, signer_name, mention, specialist, channel, staff_id, ip, user_agent)
    VALUES (${i.userId}, ${f.kind}, ${f.version}, ${text}, ${createHash('sha256').update(text).digest('hex')}, ${name}, ${MENTION}, ${specialist},
      ${channel}, ${i.staffId ?? null}, ${i.ip.slice(0, 64)}, ${(i.userAgent ?? '').slice(0, 256)})
    RETURNING id`;
  // Ni le nom ni le texte au journal : le type, la version et le canal suffisent à retrouver la ligne
  journal('consent_signed', { actor: i.staffId ?? i.userId, client: i.userId, ip: i.ip, details: { kind: f.kind, version: f.version, channel } });
  return { ok: true, id: r.id };
}

// Lecture d'un consentement signé (fiche admin, impression) ; l'empreinte relue prouve que le texte n'a pas bougé depuis
export async function readConsent(userId: number, id: number) {
  const [c] = await sql<(Consent & { text: string; text_sha256: string; mention: string; ip: string | null; user_agent: string })[]>`
    SELECT c.id, c.kind, c.version, c.signer_name, c.specialist, c.signed_at, c.channel, coalesce(s.name, s.email) AS staff,
      c.text, c.text_sha256, c.mention, c.ip, c.user_agent
    FROM consents c LEFT JOIN users s ON s.id = c.staff_id WHERE c.id = ${id} AND c.user_id = ${userId}`;
  if (!c) return null;
  return { ...c, intact: createHash('sha256').update(c.text).digest('hex') === c.text_sha256 };
}
