// Texte unique de l'accord pour les données de santé (art. 9 RGPD), affiché partout où la cliente le donne.
// Le texte accepté est gardé tel quel en base (users.health_consent_text) : changer ce texte ne réécrit pas les accords passés.
import type { Lang } from '../../lib/site';

export const HEALTH_CONSENT: Record<Lang, string> = {
  fr: "J'accepte que My Bubble Beauty note dans ma fiche les informations de santé utiles à mes soins (allergies, type de peau, contre-indications, antécédents médicaux). Je peux retirer cet accord à tout moment depuis mon compte.",
  nl: 'Ik aanvaard dat My Bubble Beauty gezondheidsinformatie die nuttig is voor mijn behandelingen (allergieën, huidtype, contra-indicaties, medische voorgeschiedenis) in mijn dossier noteert. Ik kan deze toestemming op elk moment intrekken via mijn account.',
  en: 'I agree that My Bubble Beauty may note health information useful for my treatments (allergies, skin type, contraindications, medical history) in my file. I can withdraw this consent at any time from my account.',
};

// Rappel affiché après l'accord, même liste que le texte accepté
export const HEALTH_CONSENT_ON: Record<Lang, (d: string) => string> = {
  fr: (d) => `Vous avez accepté le ${d} que l'institut note dans votre fiche les informations de santé utiles à vos soins (allergies, type de peau, contre-indications, antécédents médicaux).`,
  nl: (d) => `U hebt op ${d} aanvaard dat het instituut gezondheidsinformatie die nuttig is voor uw behandelingen (allergieën, huidtype, contra-indicaties, medische voorgeschiedenis) in uw dossier noteert.`,
  en: (d) => `On ${d}, you agreed that the salon may note health information useful for your treatments (allergies, skin type, contraindications, medical history) in your file.`,
};
