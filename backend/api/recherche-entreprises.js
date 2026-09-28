/**
 * Recherche d'entreprises · API publique de la DINUM (données INSEE + RNE).
 * Docs : https://recherche-entreprises.api.gouv.fr/docs/
 *
 * Aucune clé d'API, aucun quota facturé : c'est la seule source de prospects
 * du produit qui ne dépend pas d'un abonnement tiers (Apollo, Lemlist).
 *
 * Deux pièges de l'API, tous les deux traités ici :
 *  1. `q` cherche dans la DÉNOMINATION de l'entreprise, pas dans son activité.
 *     Le ciblage sectoriel passe donc par `activite_principale` (codes NAF).
 *  2. Les filtres géographiques (`departement`, `region`) matchent n'importe
 *     quel ÉTABLISSEMENT, pas le siège. Une société basée à Lyon avec un bureau
 *     à Paris remonte sur `departement=75`. On refiltre sur le siège côté client
 *     quand `siegeOnly` est actif (défaut).
 */

const BASE_URL = 'https://recherche-entreprises.api.gouv.fr/search';

// L'API plafonne à 25 résultats par page et tolère ~7 requêtes/seconde.
const PER_PAGE = 25;
const PAGE_DELAY_MS = 200;

/**
 * Tranches d'effectif salarié INSEE.
 * Le code est une chaîne, jamais un nombre : "02" et "2" ne sont pas
 * interchangeables côté API.
 */
const TRANCHE_LABELS = {
  '00': '0 salarié',
  '01': '1 à 2 salariés',
  '02': '3 à 5 salariés',
  '03': '6 à 9 salariés',
  '11': '10 à 19 salariés',
  '12': '20 à 49 salariés',
  '21': '50 à 99 salariés',
  '22': '100 à 199 salariés',
  '31': '200 à 249 salariés',
  '32': '250 à 499 salariés',
  '41': '500 à 999 salariés',
  '42': '1 000 à 1 999 salariés',
  '51': '2 000 à 4 999 salariés',
  '52': '5 000 à 9 999 salariés',
  '53': '10 000 salariés et plus',
};

/** Effectif médian d'une tranche, pour renseigner `companySize`. */
const TRANCHE_MIDPOINT = {
  '00': 0, '01': 2, '02': 4, '03': 8, '11': 15, '12': 35, '21': 75, '22': 150,
  '31': 225, '32': 375, '41': 750, '42': 1500, '51': 3500, '52': 7500, '53': 10000,
};

/** Fourchettes exposées par l'UI, vers les tranches INSEE correspondantes. */
const SIZE_TO_TRANCHES = {
  '1-10': ['01', '02', '03'],
  '11-50': ['11', '12'],
  '51-200': ['21', '22'],
  '201-500': ['31', '32'],
  '501-1000': ['41'],
  '1001+': ['42', '51', '52', '53'],
};

/** Tranches couvrant l'ICP baakalai (5 à 200 personnes). */
const ICP_TRANCHES = ['02', '03', '11', '12', '21', '22'];

/**
 * Presets sectoriels B2B, vers codes NAF.
 * Volontairement courts : mieux vaut peu de codes bien choisis qu'une
 * taxonomie exhaustive qui noie la cible dans du B2C.
 */
const SECTOR_PRESETS = {
  conseil: { label: 'Conseil et gestion', naf: ['70.22Z', '70.21Z'] },
  informatique: { label: 'Services informatiques', naf: ['62.02A', '62.02B', '62.01Z', '62.09Z', '63.11Z'] },
  logiciel: { label: 'Édition de logiciels', naf: ['58.29A', '58.29B', '58.29C'] },
  ingenierie: { label: 'Ingénierie et études techniques', naf: ['71.12B', '71.12A', '71.20B'] },
  marketing: { label: 'Communication et marketing', naf: ['73.11Z', '73.12Z', '70.21Z'] },
  recrutement: { label: 'Recrutement et travail temporaire', naf: ['78.10Z', '78.20Z', '78.30Z'] },
  comptabilite: { label: 'Comptabilité et audit', naf: ['69.20Z'] },
  juridique: { label: 'Activités juridiques', naf: ['69.10Z'] },
  formation: { label: 'Formation professionnelle', naf: ['85.59A', '85.59B'] },
  grossiste: { label: 'Commerce de gros (B2B)', naf: ['46.69A', '46.69B', '46.51Z', '46.52Z', '46.90Z'] },
  logistique: { label: 'Transport et logistique', naf: ['52.29A', '52.29B', '49.41A'] },
  btp: { label: 'BTP et travaux', naf: ['41.20A', '41.20B', '43.99C'] },
};

/** Codes régions INSEE, pour accepter un nom de région en critère. */
const REGION_CODES = {
  'ile-de-france': '11', 'idf': '11', 'paris region': '11',
  'centre-val de loire': '24',
  'bourgogne-franche-comte': '27',
  normandie: '28',
  'hauts-de-france': '32',
  'grand est': '44',
  'pays de la loire': '52',
  bretagne: '53',
  'nouvelle-aquitaine': '75',
  occitanie: '76',
  'auvergne-rhone-alpes': '84',
  "provence-alpes-cote d'azur": '93', paca: '93',
  corse: '94',
};

/** Qualités de dirigeant qui ne sont pas des interlocuteurs commerciaux. */
const EXCLUDED_QUALITIES = [
  'commissaire aux comptes',
  'liquidateur',
  'administrateur judiciaire',
  'mandataire',
];

/** Retire les accents et met en minuscules, pour comparer des libellés saisis à la main. */
function normalize(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/** Particules qui restent en minuscules dans un nom propre français. */
const LOWERCASE_PARTICLES = new Set([
  'de', 'du', 'des', 'le', 'la', 'les', 'sur', 'sous', 'en', 'et', 'aux', 'au', 'lès',
]);

/**
 * "JEAN-PIERRE" devient "Jean-Pierre", "ASNIERES-SUR-SEINE" devient
 * "Asnieres-sur-Seine" : le RNE renvoie tout en majuscules et sans accents.
 * Les accents perdus ne sont pas récupérables, mais les particules, si : ce
 * texte part dans des emails lus par un prospect.
 */
function toTitleCase(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/(^|[\s\-'.(])([a-zà-ÿ]+)/g, (match, sep, word) => {
      // Un point ne sépare une initiale ("D.L. Développement") que si ce qui
      // suit fait une lettre : sinon on abîme les noms de domaine (altrnativ.com).
      if (sep === '.' && word.length > 1) return match;
      if (sep !== '' && LOWERCASE_PARTICLES.has(word)) return sep + word;
      return sep + word.charAt(0).toUpperCase() + word.slice(1);
    })
    .trim();
}

/**
 * Le RNE empile tous les prénoms d'état civil ("FRANCOIS CLEMENT OLIVIER HUGO").
 * On ne garde que le premier : « Bonjour Francois Clement Olivier Hugo » dans un
 * cold email est une signature de base achetée.
 */
function firstGivenName(prenoms) {
  const first = String(prenoms || '').trim().split(/[\s,]+/)[0];
  return toTitleCase(first);
}

/** Mots trop courants pour identifier un secteur à eux seuls. */
const LABEL_STOPWORDS = new Set(['et', 'de', 'du', 'des', 'la', 'le', 'les', 'en', 'aux']);

/**
 * Rapproche un libellé saisi à la main d'un preset sectoriel.
 *
 * Volontairement strict : un simple `includes` faisait résoudre « B2B » en
 * commerce de gros, parce que le libellé du preset contient « (B2B) ». Une
 * liste de prospects hors cible sans avertissement coûte plus cher qu'un
 * critère déclaré non reconnu, donc on n'accepte que l'égalité du libellé ou
 * un mot plein de ce libellé.
 */
function matchPresetByLabel(key) {
  if (key.length < 4) return null;

  for (const [presetKey, preset] of Object.entries(SECTOR_PRESETS)) {
    const label = normalize(preset.label.replace(/\(.*?\)/g, ' '));
    if (label === key) return presetKey;

    const words = label.split(/[^a-z0-9]+/).filter(w => w && !LABEL_STOPWORDS.has(w));
    if (words.includes(key)) return presetKey;
  }

  return null;
}

/**
 * Résout des critères sectoriels en codes NAF.
 * Accepte trois formes, dans cet ordre de priorité : un code NAF brut
 * ("70.22Z"), une clé de preset ("conseil"), un libellé approchant
 * ("services informatiques"). Ce qui ne résout rien est signalé à l'appelant
 * plutôt que silencieusement ignoré.
 */
function resolveNafCodes(sectors) {
  const codes = new Set();
  const unresolved = [];

  for (const raw of sectors || []) {
    const value = String(raw || '').trim();
    if (!value) continue;

    // Code NAF brut, avec ou sans point : 70.22Z, 7022Z
    const nafMatch = value.toUpperCase().match(/^(\d{2})\.?(\d{2})([A-Z])?$/);
    if (nafMatch) {
      const [, div, grp, sub] = nafMatch;
      codes.add(`${div}.${grp}${sub || ''}`);
      continue;
    }

    const key = normalize(value);
    if (SECTOR_PRESETS[key]) {
      SECTOR_PRESETS[key].naf.forEach(c => codes.add(c));
      continue;
    }

    const preset = matchPresetByLabel(key);
    if (preset) {
      SECTOR_PRESETS[preset].naf.forEach(c => codes.add(c));
      continue;
    }

    unresolved.push(value);
  }

  return { nafCodes: [...codes], unresolved };
}

/**
 * Résout des critères de localisation en départements et régions INSEE.
 * Accepte un code département ("75", "2A"), un nom de région, ou "France"
 * (aucun filtre). Un nom de ville n'est pas résolu ici : l'API ne filtre pas
 * sur la commune, on le renvoie en `unresolved`.
 */
function resolveLocations(locations) {
  const departements = new Set();
  const regions = new Set();
  const unresolved = [];

  for (const raw of locations || []) {
    const value = String(raw || '').trim();
    if (!value) continue;

    const key = normalize(value);
    if (key === 'france' || key === 'toute la france') continue;

    if (/^(\d{2}|2[ab]|97\d)$/i.test(value)) {
      departements.add(value.toUpperCase());
      continue;
    }

    if (REGION_CODES[key]) {
      regions.add(REGION_CODES[key]);
      continue;
    }

    const region = Object.keys(REGION_CODES).find(name => name.includes(key) || key.includes(name));
    if (region) {
      regions.add(REGION_CODES[region]);
      continue;
    }

    unresolved.push(value);
  }

  return { departements: [...departements], regions: [...regions], unresolved };
}

/** Traduit les fourchettes d'effectif de l'UI en tranches INSEE. */
function resolveTranches(companySizes) {
  const tranches = new Set();
  for (const raw of companySizes || []) {
    const value = String(raw || '').trim();
    if (!value) continue;
    if (TRANCHE_LABELS[value]) { tranches.add(value); continue; }
    const mapped = SIZE_TO_TRANCHES[value];
    if (mapped) mapped.forEach(t => tranches.add(t));
  }
  return [...tranches];
}

async function fetchPage(params, page) {
  const query = new URLSearchParams({ ...params, page: String(page), per_page: String(PER_PAGE) });
  const res = await fetch(`${BASE_URL}?${query}`, { headers: { Accept: 'application/json' } });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw Object.assign(
      new Error(`Recherche d'entreprises ${res.status}: ${body.slice(0, 200) || '(vide)'}`),
      { status: res.status, code: 'RECHERCHE_ENTREPRISES_ERROR' }
    );
  }

  return res.json();
}

/**
 * Cherche des entreprises françaises selon les critères ICP.
 *
 * @param {object} criteria
 * @param {string[]} [criteria.sectors] codes NAF, presets ou libellés
 * @param {string[]} [criteria.locations] départements ou régions
 * @param {string[]} [criteria.companySizes] fourchettes UI ou tranches INSEE
 * @param {number} [criteria.minYearsOld=3] ancienneté minimale, en années
 * @param {boolean} [criteria.siegeOnly=true] n'accepter que les sièges dans la zone
 * @param {boolean} [criteria.pmeOnly=true] écarter les ETI et grandes entreprises
 * @param {boolean} [criteria.requireDirigeant=true] écarter les sociétés sans dirigeant nommé
 * @param {string} [criteria.nameQuery] recherche sur la dénomination sociale
 * @param {number} [criteria.limit=25] nombre d'entreprises visées
 * @returns {{ companies, totalResults, diagnostics }}
 */
async function searchCompanies(criteria = {}) {
  const {
    sectors = [],
    locations = [],
    companySizes = [],
    minYearsOld = 3,
    siegeOnly = true,
    pmeOnly = true,
    requireDirigeant = true,
    limit = 25,
    nameQuery = '',
  } = criteria;

  const { nafCodes, unresolved: unresolvedSectors } = resolveNafCodes(sectors);
  const { departements, regions, unresolved: unresolvedLocations } = resolveLocations(locations);
  const tranches = resolveTranches(companySizes);

  const params = {};
  if (nameQuery) params.q = nameQuery;
  if (nafCodes.length) params.activite_principale = nafCodes.join(',');
  if (departements.length) params.departement = departements.join(',');
  if (regions.length) params.region = regions.join(',');
  params.tranche_effectif_salarie = (tranches.length ? tranches : ICP_TRANCHES).join(',');
  params.etat_administratif = 'A';

  // L'API exige au moins un critère : sans secteur ni zone, on ne devine pas.
  if (!params.q && !params.activite_principale && !params.departement && !params.region) {
    throw Object.assign(
      new Error("Précise au moins un secteur (code NAF ou preset) ou une zone géographique."),
      { status: 400, code: 'CRITERIA_TOO_BROAD' }
    );
  }

  const cutoffYear = new Date().getFullYear() - minYearsOld;
  const kept = [];
  const rejected = { tooYoung: 0, outOfZone: 0, notPme: 0, noDirigeant: 0 };
  let totalResults = 0;
  let page = 1;
  let totalPages = 1;

  // On sur-échantillonne largement : siège hors zone, ETI et holdings sans
  // dirigeant nommé sont écartés après coup, et le rendement mesuré tourne
  // autour d'une entreprise retenue sur huit remontées par l'API.
  // Le plafond de pages borne la requête à une dizaine de secondes ; quand il
  // mord, `reachedPageCap` le dit plutôt que de rendre une liste courte sans
  // expliquer pourquoi.
  const maxPages = Math.min(Math.ceil((limit * 8) / PER_PAGE) + 2, 24);

  while (kept.length < limit && page <= totalPages && page <= maxPages) {
    const data = await fetchPage(params, page);
    totalResults = data.total_results || 0;
    totalPages = data.total_pages || 1;

    for (const company of data.results || []) {
      const siege = company.siege || {};

      if (pmeOnly && company.categorie_entreprise && company.categorie_entreprise !== 'PME') {
        rejected.notPme += 1;
        continue;
      }

      if (siegeOnly && (departements.length || regions.length)) {
        const inDept = departements.length && departements.includes(String(siege.departement || '').toUpperCase());
        const inRegion = regions.length && regions.includes(String(siege.region || ''));
        if (!inDept && !inRegion) {
          rejected.outOfZone += 1;
          continue;
        }
      }

      const createdYear = parseInt(String(company.date_creation || '').slice(0, 4), 10);
      if (minYearsOld > 0 && (!createdYear || createdYear > cutoffYear)) {
        rejected.tooYoung += 1;
        continue;
      }

      // Une PME sur trois a une holding pour présidente : aucun nom exploitable.
      // On l'écarte ici pour que `limit` corresponde à des contacts réels.
      if (requireDirigeant && !(company.dirigeants || []).some(isUsableDirigeant)) {
        rejected.noDirigeant += 1;
        continue;
      }

      kept.push(company);
      if (kept.length >= limit) break;
    }

    page += 1;
    if (page <= totalPages && page <= maxPages && kept.length < limit) {
      await new Promise(r => setTimeout(r, PAGE_DELAY_MS));
    }
  }

  return {
    companies: kept,
    totalResults,
    diagnostics: {
      nafCodes,
      departements,
      regions,
      tranches: tranches.length ? tranches : ICP_TRANCHES,
      minYearsOld,
      pagesFetched: page - 1,
      reachedPageCap: kept.length < limit && page > maxPages,
      unresolvedSectors,
      unresolvedLocations,
      rejected,
    },
  };
}

/** Un dirigeant exploitable : une personne physique nommée, hors mandats de contrôle. */
function isUsableDirigeant(dirigeant) {
  if (!dirigeant || dirigeant.type_dirigeant !== 'personne physique') return false;
  if (!dirigeant.nom) return false;
  const quality = normalize(dirigeant.qualite);
  return !EXCLUDED_QUALITIES.some(excluded => quality.includes(excluded));
}

/**
 * Transforme les entreprises en contacts au format baakalai, à partir de leurs
 * dirigeants déclarés au RNE.
 *
 * `email` est toujours null : le registre publie des noms, pas des adresses.
 * La révélation d'email reste l'étape payante, déclenchée après sélection.
 *
 * @param {object[]} companies résultats de searchCompanies
 * @param {object} [options]
 * @param {number} [options.maxPerCompany=1] dirigeants retenus par entreprise.
 *   Un seul par défaut : contacter le président ET le DG d'une boîte de 15
 *   personnes dans la même séquence est le meilleur moyen de se faire griller.
 * @returns {object[]} contacts
 */
function companiesToContacts(companies, options = {}) {
  const { maxPerCompany = 1 } = options;
  const contacts = [];

  for (const company of companies || []) {
    const siege = company.siege || {};
    const usable = (company.dirigeants || []).filter(isUsableDirigeant).slice(0, maxPerCompany);
    const tranche = company.tranche_effectif_salarie;
    const companyName = toTitleCase(company.nom_complet || company.nom_raison_sociale || '');

    usable.forEach((dirigeant, index) => {
      const firstName = firstGivenName(dirigeant.prenoms);
      const lastName = toTitleCase(dirigeant.nom || '');

      contacts.push({
        id: `sirene:${company.siren}:${index}`,
        firstName,
        lastName,
        name: `${firstName} ${lastName}`.trim(),
        email: null,
        phone: null,
        title: dirigeant.qualite || '',
        company: companyName,
        companySize: TRANCHE_MIDPOINT[tranche] ?? null,
        companySizeLabel: TRANCHE_LABELS[tranche] || null,
        sector: company.activite_principale || '',
        location: toTitleCase(siege.libelle_commune || ''),
        linkedinUrl: null,
        source: 'sirene',
        siren: company.siren,
        crmCreatedAt: company.date_creation || null,
      });
    });
  }

  return contacts;
}

module.exports = {
  searchCompanies,
  companiesToContacts,
  resolveNafCodes,
  resolveLocations,
  resolveTranches,
  isUsableDirigeant,
  toTitleCase,
  firstGivenName,
  SECTOR_PRESETS,
  SIZE_TO_TRANCHES,
  ICP_TRANCHES,
  TRANCHE_LABELS,
};
