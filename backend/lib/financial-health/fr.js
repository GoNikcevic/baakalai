/**
 * Santé financière — France. Gratuit, sans clé.
 *
 * 1. Nom → SIREN via l'API Recherche d'entreprises (data.gouv) :
 *    https://recherche-entreprises.api.gouv.fr/docs
 *    etat_administratif 'C' = entreprise cessée (radiée).
 * 2. Procédures collectives via l'open data BODACC (Opendatasoft v2.1),
 *    dataset « annonces-commerciales », familleavis 'collective' :
 *    https://bodacc-datadila.opendatasoft.com
 *    Le champ `jugement` est une chaîne JSON ({ famille, nature, date, ... }),
 *    le SIREN est dans le champ multivalué `registre`.
 *
 * NB : contrairement à ce que laisse entendre la doc, la réponse search de
 * l'annuaire n'expose aucun indicateur de procédure collective — BODACC est
 * donc la seule source, et la source de vérité datée.
 */

const { nameMatches } = require('./name-match');

const ANNUAIRE_URL = 'https://recherche-entreprises.api.gouv.fr/search';
const BODACC_URL = 'https://bodacc-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/annonces-commerciales/records';

const COUNTRY = 'FR';
const TIMEOUT_MS = 10000;
const BODACC_LOOKBACK_MONTHS = 24;

/** API publique sans clé : toujours disponible. */
function available() {
  return true;
}

/** dd/mm/yyyy pour les details en français. */
function frDate(iso) {
  if (!iso) return null;
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return d && m && y ? `${d}/${m}/${y}` : null;
}

/** Classe une annonce BODACC d'après la nature du jugement. Null si non pertinente. */
function classifyJugement(record) {
  let jugement = {};
  try {
    jugement = JSON.parse(record.jugement || '{}');
  } catch { /* champ parfois absent ou mal formé — on retombe sur les libellés */ }

  const texte = `${jugement.famille || ''} ${jugement.nature || ''}`.toLowerCase();
  const date = frDate(jugement.date || record.dateparution);

  if (/liquidation|redressement/.test(texte)) {
    return {
      signal_type: 'insolvency_proceeding',
      detail: `${jugement.nature || 'Procédure collective'} — BODACC ${frDate(record.dateparution)}`,
      status: 'insolvency',
      nature: jugement.nature || null,
      date,
    };
  }
  if (/sauvegarde/.test(texte)) {
    return {
      signal_type: 'insolvency_safeguard',
      detail: `${jugement.nature || 'Procédure de sauvegarde'} — BODACC ${frDate(record.dateparution)}`,
      status: 'safeguard',
      nature: jugement.nature || null,
      date,
    };
  }
  // Avis de dépôt, état des créances, etc. : pas un signal en soi.
  return null;
}

/**
 * Recherche une société française et ses procédures collectives.
 * @param {string} companyName
 * @returns {Promise<{matched, registryId, status, signals, raw}>}
 */
async function lookup(companyName, opts = {}) {
  const params = new URLSearchParams({ q: companyName, per_page: '3' });
  const res = await fetch(`${ANNUAIRE_URL}?${params}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw Object.assign(
      new Error(`Recherche d'entreprises ${res.status}: ${body.slice(0, 200) || '(empty)'}`),
      { status: res.status }
    );
  }

  const data = await res.json();
  // Matching défensif : on ne garde que le premier résultat dont le nom
  // correspond vraiment (un faux SIREN = fausse alerte churn).
  const company = (data.results || []).find(r =>
    nameMatches(companyName, r.nom_complet) ||
    nameMatches(companyName, r.nom_raison_sociale)
  );
  if (!company) {
    return { matched: false, registryId: null, status: 'not_found', signals: [], raw: {} };
  }

  const signals = [];
  let status = 'active';

  if (company.etat_administratif === 'C') {
    status = 'dissolved';
    const quand = frDate(company.date_fermeture);
    signals.push({
      signal_type: 'company_dissolved',
      detail: `Entreprise cessée (radiée du registre)${quand ? ` — ${quand}` : ''}`,
    });
  }

  // BODACC : annonces de procédures collectives des 24 derniers mois.
  const since = new Date();
  since.setMonth(since.getMonth() - BODACC_LOOKBACK_MONTHS);
  const where = `familleavis="collective" AND registre="${company.siren}" AND dateparution>=date'${since.toISOString().slice(0, 10)}'`;
  const bodaccParams = new URLSearchParams({
    where,
    order_by: 'dateparution desc',
    limit: '20',
    select: 'registre,commercant,dateparution,tribunal,jugement,familleavis_lib',
  });
  const bodaccRes = await fetch(`${BODACC_URL}?${bodaccParams}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!bodaccRes.ok) {
    const body = await bodaccRes.text().catch(() => '');
    throw Object.assign(
      new Error(`BODACC ${bodaccRes.status}: ${body.slice(0, 200) || '(empty)'}`),
      { status: bodaccRes.status }
    );
  }

  const bodacc = await bodaccRes.json();
  const annonces = [];
  const seenTypes = new Set();
  for (const record of bodacc.results || []) {
    const classified = classifyJugement(record);
    if (!classified) continue;
    annonces.push({
      dateparution: record.dateparution,
      tribunal: record.tribunal || null,
      nature: classified.nature,
    });
    // Un signal par type, l'annonce la plus récente d'abord (tri desc).
    if (!seenTypes.has(classified.signal_type)) {
      seenTypes.add(classified.signal_type);
      signals.push({ signal_type: classified.signal_type, detail: classified.detail });
    }
    // insolvency > safeguard > dissolved.
    if (classified.status === 'insolvency') status = 'insolvency';
    else if (classified.status === 'safeguard' && status !== 'insolvency') status = 'safeguard';
  }

  return {
    matched: true,
    registryId: company.siren,
    status,
    signals,
    raw: {
      annuaire: {
        siren: company.siren,
        nom_complet: company.nom_complet,
        etat_administratif: company.etat_administratif,
        date_fermeture: company.date_fermeture || null,
      },
      bodacc: annonces,
    },
  };
}

module.exports = { COUNTRY, available, lookup };
