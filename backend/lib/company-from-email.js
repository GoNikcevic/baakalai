/**
 * Deviner une entreprise à partir d'une adresse email · déterministe, hors ligne.
 *
 * Le panneau de correction de l'onglet Qualité des données proposait 169 champs
 * vides à remplir à la main. La réponse était pourtant dans la donnée : un
 * contact dont l'adresse est laura@acme-industries.fr travaille chez Acme
 * Industries. Ce module fait cette déduction, et rien d'autre : aucun appel
 * réseau, aucun modèle, aucune facture. La proposition est toujours modifiable
 * avant d'être écrite, jamais appliquée sans qu'un humain la valide.
 *
 * Deux qualités de proposition, que l'interface distingue :
 *
 *   'crm'    · un autre contact du même CRM porte déjà ce domaine ET une
 *              entreprise renseignée. On reprend SON orthographe, à l'identique.
 *              C'est la meilleure source : elle évite de créer « Acme »,
 *              « ACME » et « Acme SAS » à côté d'une valeur qui existe déjà,
 *              c'est-à-dire d'alimenter le détecteur de doublons du même écran.
 *   'domain' · personne ne connaît ce domaine, le nom est dérivé du domaine
 *              lui-même. Correct la plupart du temps, approximatif sur les
 *              sigles (bnp.fr donne « Bnp »), donc à relire.
 *
 * Aucune proposition n'est faite sur une messagerie grand public : gmail.com ne
 * dit rien de l'employeur, et « Gmail » comme entreprise serait pire que vide.
 */

// Messageries grand public et adresses jetables · un domaine d'ici ne désigne
// jamais un employeur. Liste volontairement large côté FR : c'est le marché.
const PERSONAL_EMAIL_DOMAINS = new Set([
  // Mondiaux
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.fr', 'yahoo.co.uk', 'yahoo.es',
  'yahoo.it', 'yahoo.de', 'ymail.com', 'rocketmail.com',
  'hotmail.com', 'hotmail.fr', 'hotmail.co.uk', 'hotmail.es', 'hotmail.it', 'hotmail.de',
  'outlook.com', 'outlook.fr', 'live.com', 'live.fr', 'live.co.uk', 'msn.com', 'passport.com',
  'aol.com', 'icloud.com', 'me.com', 'mac.com',
  'gmx.com', 'gmx.net', 'gmx.de', 'gmx.fr', 'web.de', 't-online.de',
  'protonmail.com', 'protonmail.ch', 'proton.me', 'pm.me',
  'zoho.com', 'fastmail.com', 'hushmail.com', 'tutanota.com', 'mailfence.com', 'hey.com',
  'yandex.com', 'yandex.ru', 'mail.ru', 'qq.com', '163.com', '126.com', 'naver.com',
  // France
  'free.fr', 'orange.fr', 'wanadoo.fr', 'sfr.fr', 'neuf.fr', 'laposte.net', 'bbox.fr',
  'numericable.fr', 'numericable.com', 'club-internet.fr', 'aliceadsl.fr', 'voila.fr',
  'cegetel.net', 'dartybox.com', 'orange.com', 'bouyguestelecom.fr',
  // Jetables
  'mailinator.com', 'yopmail.com', 'yopmail.fr', 'guerrillamail.com', '10minutemail.com',
  'tempmail.com', 'temp-mail.org', 'throwaway.email', 'maildrop.cc', 'getnada.com',
  'trashmail.com', 'trashmail.fr', 'jetable.org', 'mail-temporaire.fr', 'sharklasers.com',
  'example.com', 'example.org', 'test.com', 'localhost',
]);

// Suffixes à deux étiquettes · sans eux, acme.co.uk donnerait « Co » au lieu
// d'« Acme ». Les plus courants suffisent, la liste publique complète (PSL)
// pèserait plus lourd que le service rendu ici.
const TWO_LABEL_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'ltd.uk', 'plc.uk',
  'com.au', 'net.au', 'org.au', 'com.br', 'com.mx', 'com.ar', 'com.co',
  'co.jp', 'or.jp', 'ne.jp', 'co.nz', 'co.za', 'co.in', 'com.tr', 'com.cn',
  'com.sg', 'com.hk', 'com.my', 'com.pl', 'com.pt', 'com.es', 'com.ua',
]);

// Étiquettes techniques qu'on rencontre en tête d'un domaine d'envoi et qui ne
// font pas partie du nom de l'entreprise.
const TECHNICAL_LABELS = new Set(['mail', 'email', 'smtp', 'mx', 'www', 'contact', 'corp', 'group']);

// Mots qui perdent leur sens en capitale initiale au milieu d'un nom.
const LOWERCASE_PARTICLES = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'et', 'and', 'of', 'the']);

/** Domaine d'une adresse, en minuscules · null si l'adresse n'en porte pas. */
function domainOf(email) {
  if (!email || typeof email !== 'string') return null;
  const at = email.lastIndexOf('@');
  if (at < 1 || at === email.length - 1) return null;
  const domain = email.slice(at + 1).toLowerCase().trim();
  return domain.includes('.') && !domain.endsWith('.') ? domain : null;
}

/** Une messagerie personnelle ou jetable ne désigne aucun employeur. */
function isPersonalDomain(domain) {
  return !domain || PERSONAL_EMAIL_DOMAINS.has(domain);
}

/**
 * Étiquette enregistrable d'un domaine · « acme » pour mail.acme.co.uk.
 */
function registrableLabel(domain) {
  const labels = domain.split('.').filter(Boolean);
  if (labels.length < 2) return null;

  const lastTwo = labels.slice(-2).join('.');
  const suffixLabels = TWO_LABEL_SUFFIXES.has(lastTwo) ? 2 : 1;
  const nameLabels = labels.slice(0, labels.length - suffixLabels);
  if (nameLabels.length === 0) return null;

  // Le nom est la dernière étiquette avant le suffixe, sauf si elle est
  // technique · mail.acme.com doit donner « acme », pas « mail ».
  const meaningful = nameLabels.filter(l => !TECHNICAL_LABELS.has(l));
  const pool = meaningful.length > 0 ? meaningful : nameLabels;
  return pool[pool.length - 1];
}

/** « acme-industries » devient « Acme Industries ». */
function humanizeLabel(label) {
  const words = label.split(/[-_]+/).filter(Boolean);
  if (words.length === 0) return null;
  return words
    .map((w, i) => {
      if (i > 0 && LOWERCASE_PARTICLES.has(w)) return w;
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(' ');
}

/**
 * Nom d'entreprise dérivé d'une adresse, sans connaissance du CRM.
 * @returns {string|null} null si l'adresse ne dit rien d'exploitable
 */
function companyFromEmail(email) {
  const domain = domainOf(email);
  if (isPersonalDomain(domain)) return null;
  const label = registrableLabel(domain);
  if (!label || label.length < 2) return null;
  return humanizeLabel(label);
}

/**
 * Domaine → orthographe déjà employée dans le CRM de l'utilisateur.
 *
 * Construite sur les contacts qui ont À LA FOIS une adresse professionnelle et
 * une entreprise renseignée. Quand plusieurs orthographes coexistent pour un
 * même domaine, la plus fréquente gagne ; à égalité, la plus longue, parce
 * qu'elle porte en général la forme juridique (« Acme SAS » plutôt qu'« Acme »).
 *
 * @param {{ email: string, company: string }[]} rows
 * @returns {Map<string, string>}
 */
function buildDomainCompanyMap(rows) {
  const counts = new Map(); // domaine → Map(orthographe → occurrences)
  for (const row of rows || []) {
    const domain = domainOf(row.email);
    const company = (row.company || '').trim();
    if (!company || isPersonalDomain(domain)) continue;
    if (!counts.has(domain)) counts.set(domain, new Map());
    const spellings = counts.get(domain);
    spellings.set(company, (spellings.get(company) || 0) + 1);
  }

  const map = new Map();
  for (const [domain, spellings] of counts) {
    let best = null;
    let bestCount = 0;
    for (const [company, count] of spellings) {
      if (count > bestCount || (count === bestCount && best && company.length > best.length)) {
        best = company;
        bestCount = count;
      }
    }
    if (best) map.set(domain, best);
  }
  return map;
}

/**
 * Proposition d'entreprise pour un contact, la meilleure source d'abord.
 * @returns {{ value: string, source: 'crm'|'domain' }|null}
 */
function suggestCompany(email, domainMap) {
  const domain = domainOf(email);
  if (isPersonalDomain(domain)) return null;

  const known = domainMap?.get(domain);
  if (known) return { value: known, source: 'crm' };

  const derived = companyFromEmail(email);
  return derived ? { value: derived, source: 'domain' } : null;
}

/**
 * Proposition de nom pour un contact qui n'en a pas, dérivée de la partie
 * locale de son adresse · « laura.jacquet@… » donne « Laura Jacquet ».
 * Ne propose rien sur une partie locale non nominative (info, contact,
 * commercial, une suite de chiffres), qui ferait un faux nom de personne.
 * @returns {{ value: string, source: 'domain' }|null}
 */
const NON_NOMINATIVE_LOCALPARTS = new Set([
  'contact', 'info', 'infos', 'hello', 'bonjour', 'sales', 'commercial', 'support',
  'admin', 'webmaster', 'noreply', 'no-reply', 'ne-pas-repondre', 'service', 'accueil',
  'compta', 'comptabilite', 'facturation', 'billing', 'rh', 'hr', 'recrutement', 'jobs',
  'marketing', 'direction', 'office', 'team', 'equipe', 'newsletter',
]);

function suggestName(email) {
  if (!email || typeof email !== 'string') return null;
  const at = email.lastIndexOf('@');
  if (at < 1) return null;
  const local = email.slice(0, at).toLowerCase().trim();
  if (!local || NON_NOMINATIVE_LOCALPARTS.has(local)) return null;
  if (!/[a-z]/.test(local)) return null;

  // Un nom de personne s'écrit prenom.nom, prenom_nom ou prenom-nom. Sans
  // séparateur, « jdupont » ou « laura » ne se découpe pas de façon fiable :
  // on ne propose alors rien plutôt qu'un nom inventé.
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length < 2) return null;
  if (parts.some(p => NON_NOMINATIVE_LOCALPARTS.has(p))) return null;
  // Les chiffres de désambiguïsation (jean.dupont2) ne font pas partie du nom.
  const cleaned = parts.map(p => p.replace(/\d+$/, '')).filter(p => p.length > 1);
  if (cleaned.length < 2) return null;

  const value = cleaned.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
  return { value, source: 'domain' };
}

module.exports = {
  domainOf,
  isPersonalDomain,
  companyFromEmail,
  buildDomainCompanyMap,
  suggestCompany,
  suggestName,
  PERSONAL_EMAIL_DOMAINS,
};
