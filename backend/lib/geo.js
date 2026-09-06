/**
 * Géographie des contacts — normalisation pays + fallback TLD email.
 *
 * Deux sources, par fiabilité décroissante :
 * 1. opportunities.country (rapatrié du CRM, migration 093) — libellé libre
 *    ("France", "FR", "united states") → normalisé en ISO-2 à la lecture.
 * 2. Le TLD de l'email (.fr → FR). Les TLD génériques (.com, .io…) ne disent
 *    rien : on retourne null plutôt que d'inventer — l'analytics affiche
 *    honnêtement la part « non déterminé ».
 *
 * L'affichage des noms de pays se fait côté frontend via Intl.DisplayNames
 * (aucune table de libellés à maintenir).
 */

// Libellés fréquents (FR + EN) → ISO-2. Volontairement court : couvre ce que
// les CRM de PME françaises contiennent réellement, pas les 249 codes ISO.
const COUNTRY_ALIASES = {
  'france': 'FR', 'fr': 'FR',
  'belgique': 'BE', 'belgium': 'BE', 'be': 'BE',
  'suisse': 'CH', 'switzerland': 'CH', 'ch': 'CH',
  'luxembourg': 'LU', 'lu': 'LU',
  'allemagne': 'DE', 'germany': 'DE', 'deutschland': 'DE', 'de': 'DE',
  'espagne': 'ES', 'spain': 'ES', 'españa': 'ES', 'es': 'ES',
  'italie': 'IT', 'italy': 'IT', 'italia': 'IT', 'it': 'IT',
  'pays-bas': 'NL', 'netherlands': 'NL', 'nederland': 'NL', 'nl': 'NL',
  'portugal': 'PT', 'pt': 'PT',
  'royaume-uni': 'GB', 'united kingdom': 'GB', 'uk': 'GB', 'gb': 'GB', 'angleterre': 'GB', 'england': 'GB',
  'irlande': 'IE', 'ireland': 'IE', 'ie': 'IE',
  'états-unis': 'US', 'etats-unis': 'US', 'united states': 'US', 'usa': 'US', 'us': 'US', 'united states of america': 'US',
  'canada': 'CA', 'ca': 'CA',
  'australie': 'AU', 'australia': 'AU', 'au': 'AU',
  'autriche': 'AT', 'austria': 'AT', 'at': 'AT',
  'danemark': 'DK', 'denmark': 'DK', 'dk': 'DK',
  'suède': 'SE', 'suede': 'SE', 'sweden': 'SE', 'se': 'SE',
  'norvège': 'NO', 'norvege': 'NO', 'norway': 'NO', 'no': 'NO',
  'finlande': 'FI', 'finland': 'FI', 'fi': 'FI',
  'pologne': 'PL', 'poland': 'PL', 'pl': 'PL',
  'maroc': 'MA', 'morocco': 'MA', 'ma': 'MA',
  'tunisie': 'TN', 'tunisia': 'TN', 'tn': 'TN',
  'algérie': 'DZ', 'algerie': 'DZ', 'algeria': 'DZ', 'dz': 'DZ',
  'sénégal': 'SN', 'senegal': 'SN', 'sn': 'SN',
  'côte d\'ivoire': 'CI', 'cote d\'ivoire': 'CI', 'ivory coast': 'CI', 'ci': 'CI',
};

// TLD nationaux → ISO-2. Aligné sur financial-health/detectAttempts, en plus large.
const TLD_COUNTRIES = {
  fr: 'FR', be: 'BE', ch: 'CH', lu: 'LU', de: 'DE', es: 'ES', it: 'IT',
  nl: 'NL', pt: 'PT', uk: 'GB', ie: 'IE', us: 'US', ca: 'CA', au: 'AU',
  at: 'AT', dk: 'DK', se: 'SE', no: 'NO', fi: 'FI', pl: 'PL',
  ma: 'MA', tn: 'TN', dz: 'DZ', sn: 'SN', ci: 'CI',
};

function stripAccents(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Libellé pays libre → ISO-2, ou null si inconnu/vide. */
function normalizeCountry(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const key = raw.trim().toLowerCase();
  if (!key) return null;
  if (COUNTRY_ALIASES[key]) return COUNTRY_ALIASES[key];
  const noAccents = stripAccents(key);
  if (COUNTRY_ALIASES[noAccents]) return COUNTRY_ALIASES[noAccents];
  // Code ISO-2 déjà propre ("FR", "de") — on fait confiance au format.
  if (/^[a-z]{2}$/.test(key)) return key.toUpperCase();
  return null;
}

/** Pays déduit du TLD de l'email, ou null (TLD générique = on ne sait pas). */
function countryFromEmailTld(email) {
  const domain = (email || '').split('@')[1] || '';
  const tld = domain.split('.').pop()?.toLowerCase();
  return TLD_COUNTRIES[tld] || null;
}

/**
 * Pays d'un contact : CRM d'abord, TLD email en secours.
 * Retourne { code, source: 'crm'|'email_tld' } ou null.
 */
function resolveCountry(opportunity) {
  const fromCrm = normalizeCountry(opportunity.country);
  if (fromCrm) return { code: fromCrm, source: 'crm' };
  const fromTld = countryFromEmailTld(opportunity.email);
  if (fromTld) return { code: fromTld, source: 'email_tld' };
  return null;
}

module.exports = { normalizeCountry, countryFromEmailTld, resolveCountry };
