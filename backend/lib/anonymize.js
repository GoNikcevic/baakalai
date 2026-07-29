/**
 * Anonymisation des patterns mémoire.
 *
 * POURQUOI CE MODULE EXISTE
 * -------------------------
 * La migration 013 déclarait que les patterns sont « ANONYMIZED by convention
 * before insert ». Une convention n'est pas un mécanisme : en production, les
 * patterns contenaient des noms de clients en clair (LVMH, Qonto, Sanofi…) et
 * des noms de campagne. Comme la mémoire est destinée à un pool global partagé
 * entre tenants, cela signifiait exposer les prospects d'un client aux prompts
 * d'un autre.
 *
 * La rédaction est donc appliquée au point de passage obligé — db.memoryPatterns
 * create/update — et non laissée à la discipline des appelants.
 *
 * DEUX PASSES COMPLÉMENTAIRES
 * ---------------------------
 * 1. Motifs structurels (emails, URLs, domaines, téléphones). Fonctionne sans
 *    aucune connaissance du métier, donc toujours disponible.
 * 2. Lexique ancré : les entités réellement présentes en base (entreprises,
 *    contacts, campagnes). C'est la passe qui attrape « LVMH », qu'aucune regex
 *    ne peut deviner. Le lexique est global — le pool l'est aussi, et rédiger
 *    l'entité d'un tenant dans le pattern d'un autre est exactement le but.
 *
 * PUIS UNE GARDE
 * --------------
 * `detectResidual` cherche ce qui ressemble encore à un nom propre après
 * rédaction. Il ne bloque pas l'écriture : il interdit le partage global
 * (`shared`). Un faux positif coûte donc un pattern non partagé — jamais une
 * fuite. C'est le sens dans lequel on veut se tromper.
 */

const logger = require('./logger');

// ─────────────────────────────────────────────────────────────
// Passe 1 — motifs structurels
// ─────────────────────────────────────────────────────────────

// Ordre significatif : les emails avant les domaines, sinon le domaine d'un
// email serait rédigé séparément et laisserait la partie locale en clair.
const STRUCTURAL = [
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[EMAIL]'],
  [/https?:\/\/\S+/gi, '[URL]'],
  [/\b(?:www\.)[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/gi, '[URL]'],
  // Téléphones FR et internationaux. Exige au moins 9 chiffres pour ne pas
  // avaler les pourcentages et les tailles d'échantillon.
  [/\+?\d[\d\s.-]{8,}\d/g, '[TEL]'],
  // Domaines nus (acme.com). Liste de TLD volontairement restreinte : un
  // motif générique \.[a-z]{2,} transformerait « fin.Les » en domaine.
  [/\b[A-Za-z0-9-]{2,}\.(?:com|fr|io|ai|co|net|org|eu|de|uk|es|it|be|ch)\b/gi, '[DOMAINE]'],
];

// Mots que le lexique ne doit jamais rédiger, même si une entreprise porte ce
// nom : trop fréquents en français ou dans le vocabulaire métier. Sans cette
// garde, une société nommée « Formation » ferait disparaître le mot de tous
// les patterns.
const LEXICON_STOPWORDS = new Set([
  'formation', 'conseil', 'service', 'services', 'groupe', 'group', 'société',
  'societe', 'entreprise', 'agence', 'digital', 'tech', 'data', 'cloud', 'web',
  'france', 'paris', 'europe', 'international', 'solutions', 'solution',
  'partners', 'consulting', 'media', 'studio', 'labs', 'factory', 'group',
  'client', 'clients', 'contact', 'contacts', 'test', 'demo', 'imported',
  'new', 'open', 'lost', 'won', 'email', 'linkedin', 'crm',
]);

/** Échappe une chaîne pour insertion littérale dans une RegExp. */
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Variantes accentuées par lettre de base. Les patterns sont majoritairement
// rédigés par un LLM, qui laisse tomber ou déforme les accents : sans cela,
// « Dassault Systèmes » stocké en base ne reconnaît pas « Dassault Systemes »
// dans le texte — vérifié sur les données de production.
const ACCENT_CLASSES = {
  a: 'aàáâãäåāă', c: 'cçćč', e: 'eèéêëēĕėęě', i: 'iìíîïĩīĭ',
  n: 'nñńň', o: 'oòóôõöøōŏ', u: 'uùúûüũūŭ', y: 'yýÿ', s: 'sśš', z: 'zźżž',
};

/**
 * Construit un motif littéral tolérant aux accents.
 * « Systèmes » → « [sś š…]y[sś…]t[eèéêë…]m[eèéêë…][sś…] », insensible à la casse
 * via le drapeau `i`.
 */
function accentInsensitivePattern(term) {
  let out = '';
  for (const ch of term) {
    const base = ch.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
    const cls = ACCENT_CLASSES[base];
    if (cls) {
      out += `[${cls}]`;
    } else if (/\s/.test(ch)) {
      // Un espace en base peut être plusieurs espaces ou un insécable dans le texte.
      out += '\\s+';
    } else {
      out += escapeRegex(ch);
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// Passe 2 — lexique ancré
// ─────────────────────────────────────────────────────────────

/**
 * Construit un lexique à partir des entités connues.
 *
 * @param {{companies?: string[], contacts?: string[], campaigns?: string[]}} sources
 * @returns {{terms: Array<{re: RegExp, placeholder: string}>, size: number}}
 */
function buildLexicon(sources = {}) {
  const entries = [];

  // Les intitulés de poste ne sont PAS rédigés : une fois l'entreprise
  // masquée, « Dirigeant » ou « Head of Growth » n'identifie personne, et c'est
  // exactement l'information que la mémoire doit conserver (segmentation ICP).
  // On les verse en liste d'autorisation pour que la garde cesse de les
  // prendre pour des noms propres.
  const allow = new Set();
  for (const raw of sources.titles || []) {
    for (const word of String(raw || '').split(/[^\p{L}\p{N}]+/u)) {
      if (word.length >= 3) allow.add(word.toLowerCase());
    }
  }

  const add = (values, placeholder, minLength) => {
    for (const raw of values || []) {
      const term = String(raw || '').trim();
      if (term.length < minLength) continue;
      if (LEXICON_STOPWORDS.has(term.toLowerCase())) continue;
      // Un terme purement numérique ou sans lettre n'est pas une entité.
      if (!/[A-Za-zÀ-ÿ]/.test(term)) continue;
      entries.push({ term, placeholder });
    }
  };

  add(sources.companies, '[ENTREPRISE]', 3);
  add(sources.contacts, '[CONTACT]', 4);
  add(sources.campaigns, '[CAMPAGNE]', 4);

  // Les noms de famille isolés : « Dassault » doit tomber même quand le pattern
  // ne cite pas le prénom. On ne descend pas au prénom seul, trop générique.
  const surnames = new Set();
  for (const raw of sources.contacts || []) {
    const parts = String(raw || '').trim().split(/\s+/);
    if (parts.length < 2) continue;
    const last = parts[parts.length - 1];
    if (last.length >= 4 && !LEXICON_STOPWORDS.has(last.toLowerCase())) surnames.add(last);
  }
  add([...surnames], '[CONTACT]', 4);

  // Plus long d'abord : « Dassault Systèmes » doit être consommé avant
  // « Dassault », sinon il resterait « [CONTACT] Systèmes ».
  entries.sort((a, b) => b.term.length - a.term.length);

  const seen = new Set();
  const terms = [];
  for (const { term, placeholder } of entries) {
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push({
      // Bornes non-alphanumériques plutôt que \b : \b ne fonctionne pas
      // correctement autour des accents et des termes contenant un tiret.
      re: new RegExp(`(^|[^\\p{L}\\p{N}])(${accentInsensitivePattern(term)})(?=[^\\p{L}\\p{N}]|$)`, 'giu'),
      placeholder,
    });
  }

  return { terms, size: terms.length, allow };
}

const EMPTY_LEXICON = { terms: [], size: 0, allow: new Set() };

// ─────────────────────────────────────────────────────────────
// Rédaction
// ─────────────────────────────────────────────────────────────

/**
 * Rédige un texte libre.
 * @returns {{text: string, redacted: number}}
 */
function redactText(text, lexicon = EMPTY_LEXICON) {
  if (typeof text !== 'string' || text.length === 0) {
    return { text, redacted: 0 };
  }

  let out = text;
  let count = 0;

  for (const [re, placeholder] of STRUCTURAL) {
    out = out.replace(re, () => { count++; return placeholder; });
  }

  for (const { re, placeholder } of lexicon.terms) {
    out = out.replace(re, (_m, before) => { count++; return `${before}${placeholder}`; });
  }

  // Un pattern saturé de placeholders n'apprend plus rien : on préfère le
  // signaler que de laisser une phrase vide de sens polluer le pool.
  return { text: out, redacted: count };
}

/** Rédige récursivement les chaînes d'une valeur JSON. */
function redactJson(value, lexicon = EMPTY_LEXICON, depth = 0) {
  if (depth > 8) return value;
  if (typeof value === 'string') return redactText(value, lexicon).text;
  if (Array.isArray(value)) return value.map(v => redactJson(v, lexicon, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      // Les identifiants de tenant n'ont rien à faire dans un pool global :
      // ils ré-identifient le pattern même si le texte est propre.
      if (/^(user_?id|team_?id|owner_?id|contact_?id|opportunity_?id|email)$/i.test(k)) continue;
      out[k] = redactJson(v, lexicon, depth + 1);
    }
    return out;
  }
  return value;
}

// ─────────────────────────────────────────────────────────────
// Garde — détection de résidu
// ─────────────────────────────────────────────────────────────

// Vocabulaire métier et français courant qui commence légitimement par une
// majuscule au milieu d'une phrase. Sans cette liste, la garde signalerait
// « LinkedIn » ou « Haute » comme des entités.
const KNOWN_CAPITALIZED = new Set([
  'linkedin', 'crm', 'icp', 'b2b', 'b2c', 'saas', 'pme', 'eti', 'rdv', 'ca',
  'roi', 'kpi', 'cto', 'ceo', 'cmo', 'coo', 'cfo', 'vp', 'rh', 'it', 'seo',
  'haute', 'moyenne', 'faible', 'cible', 'corps', 'objets', 'timing', 'canal',
  'canaux', 'objection', 'séquence', 'sequence', 'secteur', 'pipeline',
  'montant', 'entreprise', 'contact', 'campagne', 'email', 'tel', 'url',
  'domaine', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi',
  'dimanche', 'janvier', 'février', 'fevrier', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'aout', 'septembre', 'octobre', 'novembre', 'décembre',
  'decembre', 'france', 'europe', 'claude', 'gmail', 'outlook', 'apollo',
  'lemlist', 'smartlead', 'pipedrive', 'hubspot', 'salesforce', 'odoo',
  'notion', 'airtable', 'folk', 'win', 'loss', 'copy', 're',
  // Vocabulaire métier en capitales : sans lui la règle « sigle » les traite
  // comme des entités et bloque le partage de patterns parfaitement propres.
  'cta', 'sdr', 'bdr', 'mrr', 'arr', 'acv', 'ltv', 'cac', 'nps', 'sla', 'rgpd',
  'api', 'url', 'smtp', 'dns', 'pdf', 'csv', 'faq', 'poc', 'mvp', 'ux', 'ui',
  'ab', 'kpis', 'rdvs', 'pmes', 'tpe', 'ia', 'llm', 'roas', 'cpl', 'cpc',
]);

/**
 * Cherche ce qui ressemble encore à un nom propre.
 *
 * Sert uniquement de garde sur le partage global. Volontairement sensible :
 * un faux positif coûte un pattern non partagé, un faux négatif coûte une fuite.
 *
 * @returns {string[]} tokens suspects (vide = texte considéré comme propre)
 */
function detectResidual(text, allow = null) {
  if (typeof text !== 'string' || !text) return [];

  const isKnown = t => KNOWN_CAPITALIZED.has(t) || (allow ? allow.has(t) : false);
  const suspects = new Set();

  // On neutralise nos propres placeholders : sans cela « [ENTREPRISE] » serait
  // lui-même signalé comme un sigle suspect.
  const stripped = text.replace(/\[[A-Z]+\]/g, ' ');

  // Un mot capitalisé n'est suspect qu'en MILIEU de phrase : en début de phrase
  // la majuscule est grammaticale, pas onomastique. La version précédente
  // signalait « Les », « Presence », « Contacter » — au point de bloquer le
  // partage de tout pattern, ce qui aurait vidé le pool de son intérêt.
  const tokenRe = /(\p{Lu}[\p{L}\p{N}&'’-]*)/gu;
  let m;
  while ((m = tokenRe.exec(stripped)) !== null) {
    const token = m[1];
    const start = m.index;

    if (token.length < 3) continue;
    if (isKnown(token.toLowerCase())) continue;

    // Contexte gauche : ce qui précède, espaces ignorés.
    const before = stripped.slice(0, start).replace(/\s+$/, '');
    const isSentenceStart = before === '' || /[.!?:;•\-—(«"' ]$/.test(before);
    if (isSentenceStart) continue;

    suspects.add(token);
  }

  // Les sigles restent suspects même en tête de phrase : « LVMH domine… »
  // n'a pas de majuscule grammaticale, c'est bien une entité.
  const acronyms = stripped.match(/\p{Lu}{3,}\p{N}*/gu) || [];
  for (const a of acronyms) {
    if (!isKnown(a.toLowerCase())) suspects.add(a);
  }

  return [...suspects];
}

// ─────────────────────────────────────────────────────────────
// API principale
// ─────────────────────────────────────────────────────────────

/**
 * Anonymise un pattern complet.
 *
 * @param {{pattern?: string, data?: any}} input
 * @param {object} lexicon
 * @returns {{pattern: string, data: any, redacted: number, residual: string[], safeToShare: boolean}}
 */
function anonymizePattern(input, lexicon = EMPTY_LEXICON) {
  const { text: pattern, redacted } = redactText(input.pattern || '', lexicon);

  let data = input.data;
  if (typeof data === 'string') {
    // `data` est stocké en JSONB mais les appelants passent souvent une chaîne
    // déjà sérialisée. On la rédige comme du JSON quand c'est possible, comme
    // du texte sinon, pour ne jamais laisser passer une chaîne non traitée.
    try {
      data = JSON.stringify(redactJson(JSON.parse(data), lexicon));
    } catch {
      data = redactText(data, lexicon).text;
    }
  } else if (data && typeof data === 'object') {
    data = redactJson(data, lexicon);
  }

  const residual = detectResidual(pattern, lexicon.allow);

  return {
    pattern,
    data,
    redacted,
    residual,
    // Le partage exige un lexique réellement chargé : sans lui, seule la passe
    // structurelle a tourné et « LVMH » passerait au travers.
    safeToShare: residual.length === 0 && lexicon.size > 0,
  };
}

// ─────────────────────────────────────────────────────────────
// Lexique en cache
// ─────────────────────────────────────────────────────────────

const LEXICON_TTL_MS = 15 * 60 * 1000;
let _cache = { lexicon: EMPTY_LEXICON, at: 0 };
let _inflight = null;

/**
 * Charge le lexique depuis la base, avec cache TTL.
 *
 * Ne remonte jamais d'exception : en cas d'échec on renvoie le lexique vide,
 * ce qui laisse tourner la passe structurelle et force `safeToShare` à false.
 * Une base indisponible ne doit ni bloquer une écriture, ni ouvrir le partage.
 *
 * @param {{query: Function}} db — injecté pour éviter un cycle de require
 */
async function loadLexicon(db, { force = false } = {}) {
  const now = Date.now();
  if (!force && _cache.lexicon.size > 0 && now - _cache.at < LEXICON_TTL_MS) {
    return _cache.lexicon;
  }
  if (_inflight) return _inflight;

  _inflight = (async () => {
    try {
      const [companies, contacts, campaigns, titles] = await Promise.all([
        db.query(`SELECT DISTINCT company AS v FROM opportunities WHERE nullif(trim(company),'') IS NOT NULL LIMIT 5000`),
        db.query(`SELECT DISTINCT name    AS v FROM opportunities WHERE nullif(trim(name),'')    IS NOT NULL LIMIT 5000`),
        db.query(`SELECT DISTINCT name    AS v FROM campaigns     WHERE nullif(trim(name),'')    IS NOT NULL LIMIT 2000`),
        db.query(`SELECT DISTINCT title   AS v FROM opportunities WHERE nullif(trim(title),'')   IS NOT NULL LIMIT 2000`),
      ]);
      const lexicon = buildLexicon({
        companies: companies.rows.map(r => r.v),
        contacts: contacts.rows.map(r => r.v),
        campaigns: campaigns.rows.map(r => r.v),
        titles: titles.rows.map(r => r.v),
      });
      _cache = { lexicon, at: Date.now() };
      logger.info('anonymize', `lexique charge: ${lexicon.size} termes`);
      return lexicon;
    } catch (err) {
      logger.warn('anonymize', `lexique indisponible, rédaction structurelle seule: ${err.message}`);
      return EMPTY_LEXICON;
    } finally {
      _inflight = null;
    }
  })();

  return _inflight;
}

/** Vide le cache — utilisé par les tests et les scripts de migration. */
function resetLexiconCache() {
  _cache = { lexicon: EMPTY_LEXICON, at: 0 };
  _inflight = null;
}

module.exports = {
  buildLexicon,
  redactText,
  redactJson,
  detectResidual,
  anonymizePattern,
  loadLexicon,
  resetLexiconCache,
  EMPTY_LEXICON,
  LEXICON_STOPWORDS,
  KNOWN_CAPITALIZED,
};
