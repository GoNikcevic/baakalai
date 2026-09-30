/**
 * Moteur de découverte d'architecture CRM · lot 1 du plan
 * docs/plan-modele-comptes-et-decouverte-crm.md, migration 127.
 *
 * ── Le problème, qui n'est pas celui du modèle de données ───────────────────
 *
 * Les migrations 124 à 126 disent OÙ RANGER : une société, une affaire, une
 * personne. Elles ne disent pas COMMENT RECONNAÎTRE.
 *
 * Deux Salesforce au schéma rigoureusement identique peuvent être utilisés de
 * façon opposée. Un client peut être un Account avec `Type = Customer`, une
 * Opportunity gagnée, un `Contrat__c` maison, ou un pipeline Pipedrive que
 * quelqu'un a nommé « Clients ». baakalai code aujourd'hui `IsWon` -> client
 * en dur : vrai chez certains, faux chez d'autres, et rien ne dit chez qui.
 *
 * Aucune règle écrite en dur ne survit à ça. Ce module mesure l'usage réel,
 * puis en déduit qui joue quoi, tenant par tenant.
 *
 * ── Les cinq étapes, et pourquoi dans cet ordre ─────────────────────────────
 *
 * 1. INVENTAIRE D'USAGE, pas de schéma. Quels objets existent ET contiennent
 *    des données récentes. Un objet à zéro ligne depuis deux ans est du décor
 *    et ne doit peser dans aucune déduction.
 * 2. PROFILAGE de chaque champ : taux de remplissage, cardinalité, type,
 *    listes de choix. Un champ rempli à 3 % est du bruit ; une liste à quatre
 *    valeurs présente sur 90 % des lignes est un axe de cycle de vie.
 * 3. INFÉRENCE. Les règles d'abord, là où l'API affirme elle-même
 *    (`Account` EST la société chez Salesforce, ce n'est pas une opinion).
 *    Claude ensuite, et UNIQUEMENT sur le profil agrégé.
 * 4. RESTITUTION. Chaque déduction s'affiche avec sa confiance et sa preuve,
 *    corrigeable, et gelée dès qu'elle est corrigée.
 * 5. DÉRIVE. Deux mesures se comparent · un champ neuf qui se remplit, une
 *    distribution qui bascule, on le signale.
 *
 * ── RGPD, et ce n'est pas une précaution de forme ───────────────────────────
 *
 * L'échantillon d'enregistrements est lu, agrégé, puis JETÉ côté serveur. Ce
 * qui part à l'inférence ne contient que des noms de champs, des types, des
 * taux, des cardinalités et des libellés de listes de choix · c'est-à-dire du
 * schéma, jamais la donnée d'une personne réelle. C'est ce qui rend l'appel
 * légitime, et accessoirement ce qui divise son coût en jetons par cent.
 *
 * `buildInferencePayload` est le seul chemin vers le modèle, et il ne sait
 * construire que des agrégats : la garantie est structurelle, pas
 * conventionnelle.
 *
 * ── Ce lot tourne à vide, volontairement ────────────────────────────────────
 *
 * Personne ne LIT encore ces déductions. Les connecteurs se comportent comme
 * avant, `IsWon` -> client reste écrit en dur. Le moteur observe, se montre, et
 * on compare ce qu'il déduit à ce que le produit fait déjà. Basculer les jobs
 * sur le mapping résolu vient après, quand l'écart aura été regardé.
 */

const db = require('../db');
const logger = require('./logger');
const { safeParseClaudeJSON } = require('./utils/safe-json-parse');

/** CRM dont l'architecture est introspectable. Notion, Airtable et Folk
 *  n'exposent pas de schéma d'objets comparable : rien à découvrir. */
const WITH_ARCHITECTURE = ['salesforce', 'hubspot', 'pipedrive', 'odoo'];

/** Ce qu'un OBJET peut jouer dans le modèle baakalai. */
const OBJECT_ROLES = ['account', 'person', 'deal', 'activity', 'unknown'];

/** Ce qu'un CHAMP peut porter. */
const FIELD_ROLES = [
  'lifecycle', 'amount', 'currency', 'close_date', 'created_at',
  'owner', 'name', 'email', 'account_link', 'unknown',
];

const ALL_ROLES = [...new Set([...OBJECT_ROLES, ...FIELD_ROLES])];

/** Un objet vu pour la dernière fois il y a plus longtemps que ça est du
 *  décor : il ne pèse dans aucune déduction, et on le dit. */
const MOIS_AVANT_DECOR = 24;

/**
 * Ce que l'API affirme elle-même, et qu'il serait absurde de faire deviner.
 *
 * Ces objets ne sont pas une interprétation : chez Salesforce, `Account` EST
 * la société, c'est la documentation du produit. Demander à un modèle de le
 * confirmer, c'est payer pour moins sûr (même raisonnement que la couche de
 * règles de lib/crm-stage-mapper.js).
 *
 * Tout le reste, y compris le moindre objet maison, passe par l'inférence ou
 * reste 'unknown'.
 */
const OBJETS_CONNUS = {
  salesforce: { Account: 'account', Contact: 'person', Lead: 'person', Opportunity: 'deal', Task: 'activity', Event: 'activity' },
  hubspot: { companies: 'account', contacts: 'person', deals: 'deal' },
  pipedrive: { organizations: 'account', persons: 'person', deals: 'deal' },
  // Odoo ne sépare pas société et personne · `res.partner` est les deux, et
  // c'est `is_company` qui tranche ligne par ligne. Le déclarer 'account'
  // serait faux une fois sur deux : il reste donc à l'inférence, qui le dira.
  odoo: { 'crm.lead': 'deal' },
};

/**
 * Les champs que l'API nomme sans ambiguïté possible. Même principe.
 * Clé : `objet.champ` en minuscules, pour que la comparaison ne dépende pas de
 * la casse d'un CRM à l'autre.
 */
const CHAMPS_CONNUS = {
  salesforce: {
    'opportunity.amount': 'amount', 'opportunity.closedate': 'close_date',
    'opportunity.stagename': 'lifecycle', 'opportunity.ownerid': 'owner',
    'opportunity.accountid': 'account_link', 'opportunity.createddate': 'created_at',
    'opportunity.currencyisocode': 'currency',
    'contact.email': 'email', 'contact.accountid': 'account_link',
    'contact.ownerid': 'owner', 'contact.createddate': 'created_at', 'contact.name': 'name',
    'account.name': 'name', 'account.ownerid': 'owner', 'account.createddate': 'created_at',
  },
  hubspot: {
    'deals.amount': 'amount', 'deals.closedate': 'close_date',
    'deals.dealstage': 'lifecycle', 'deals.hubspot_owner_id': 'owner',
    'deals.createdate': 'created_at', 'deals.deal_currency_code': 'currency',
    'deals.dealname': 'name',
    'contacts.email': 'email', 'contacts.createdate': 'created_at',
    'contacts.hubspot_owner_id': 'owner',
    'companies.name': 'name', 'companies.createdate': 'created_at',
    'companies.hubspot_owner_id': 'owner',
  },
  pipedrive: {
    'deals.value': 'amount', 'deals.currency': 'currency', 'deals.stage_id': 'lifecycle',
    'deals.user_id': 'owner', 'deals.add_time': 'created_at', 'deals.org_id': 'account_link',
    'deals.close_time': 'close_date', 'deals.title': 'name',
    'persons.email': 'email', 'persons.org_id': 'account_link',
    'persons.owner_id': 'owner', 'persons.add_time': 'created_at', 'persons.name': 'name',
    'organizations.name': 'name', 'organizations.owner_id': 'owner', 'organizations.add_time': 'created_at',
  },
  odoo: {
    'crm.lead.expected_revenue': 'amount', 'crm.lead.stage_id': 'lifecycle',
    'crm.lead.user_id': 'owner', 'crm.lead.create_date': 'created_at',
    'crm.lead.date_closed': 'close_date', 'crm.lead.partner_id': 'account_link',
    'crm.lead.company_currency': 'currency', 'crm.lead.name': 'name',
    'res.partner.email': 'email', 'res.partner.create_date': 'created_at',
    'res.partner.parent_id': 'account_link', 'res.partner.user_id': 'owner',
    'res.partner.name': 'name',
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// 1 et 2 · Inventaire et profilage
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Lit une valeur quelle que soit la façon dont le CRM l'emballe.
 *
 * Les quatre ne s'accordent sur rien : Salesforce rend des scalaires, HubSpot
 * met tout à plat dans `properties`, Pipedrive emballe ses relations dans
 * `{ value, name }`, Odoo rend ses Many2one en `[id, libellé]`. Sans ce
 * démêlage, un champ parfaitement rempli se mesurerait à 0 % chez trois
 * providers sur quatre.
 */
function readValue(record, key) {
  if (!record) return null;
  const raw = record[key] !== undefined ? record[key] : record.properties?.[key];
  if (raw === undefined || raw === null || raw === '') return null;
  if (Array.isArray(raw)) {
    if (raw.length === 0) return null;
    // Many2one Odoo, ou liste d'emails Pipedrive.
    const first = raw[0];
    if (first && typeof first === 'object') return first.value ?? first.id ?? null;
    return raw.length > 1 ? raw[1] : first;
  }
  if (typeof raw === 'object') return raw.value ?? raw.id ?? raw.name ?? null;
  // Odoo rend `false` pour « vide », ce qui n'est pas la même chose qu'un
  // booléen faux mais qu'aucun de ses champs texte ne distingue.
  if (raw === false) return null;
  return raw;
}

const TYPES_DATE = /date|time/i;

/** Un profil de champ : ce qu'on peut dire de lui sans citer une seule valeur. */
function profileField(field, sample) {
  let remplis = 0;
  const distinctes = new Set();
  let derniereDate = null;

  for (const rec of sample) {
    const v = readValue(rec, field.key);
    if (v === null) continue;
    remplis++;
    // Plafonné : au delà, la cardinalité exacte n'apprend plus rien et le Set
    // grossirait autant que l'échantillon.
    if (distinctes.size < 50) distinctes.add(String(v).slice(0, 80));
    if (TYPES_DATE.test(field.type || '')) {
      const d = new Date(v);
      // Une date future est un champ de prévision, pas une trace d'usage · la
      // retenir ferait passer un objet mort pour un objet vivant.
      if (!isNaN(d.getTime()) && d <= new Date() && (!derniereDate || d > derniereDate)) derniereDate = d;
    }
  }

  return {
    key: field.key,
    label: field.name || field.key,
    type: field.type || null,
    custom: !!field.custom,
    referenceTo: field.referenceTo || null,
    fillRate: sample.length > 0 ? Math.round((remplis / sample.length) * 100) / 100 : 0,
    cardinality: distinctes.size,
    // Les LIBELLÉS d'une liste de choix sont du schéma, pas de la donnée : ils
    // décrivent ce que le CRM autorise, pas ce qu'une personne a saisi. C'est
    // ce qui permet de les montrer au modèle.
    options: (field.options || []).slice(0, 25).map(o => o.label).filter(Boolean),
    lastValueAt: derniereDate ? derniereDate.toISOString() : null,
  };
}

/** Les adaptateurs d'introspection, un par CRM. */
const ADAPTATEURS = {
  salesforce: {
    objets: (creds) => require('../api/salesforce').describeGlobal(creds.instanceUrl, creds.accessToken),
    champs: (creds, objet) => require('../api/salesforce').describeObject(creds.instanceUrl, creds.accessToken, objet),
    echantillon: (creds, objet, cles) =>
      require('../api/salesforce').sampleRecords(creds.instanceUrl, creds.accessToken, objet, cles),
  },
  hubspot: {
    objets: (creds) => require('../api/hubspot').listObjectSchemas(creds),
    champs: (creds, objet) => require('../api/hubspot').getObjectProperties(creds, objet),
    echantillon: (creds, objet, cles) => require('../api/hubspot').sampleRecords(creds, objet, cles),
  },
  pipedrive: {
    objets: () => require('../api/pipedrive').listObjectSchemas(),
    champs: (creds, objet) => require('../api/pipedrive').getObjectFields(creds, objet),
    echantillon: (creds, objet, cles) => require('../api/pipedrive').sampleRecords(creds, objet, cles),
  },
  odoo: {
    objets: () => require('../api/odoo').listObjectSchemas(),
    champs: (creds, objet) => require('../api/odoo').getObjectFields(creds, objet),
    echantillon: (creds, objet, cles) => require('../api/odoo').sampleRecords(creds, objet, cles),
  },
};

/** Les identifiants Odoo voyagent tantôt en objet, tantôt en JSON. */
function normaliserCreds(provider, creds) {
  if (provider !== 'odoo' || typeof creds !== 'string') return creds;
  try { return JSON.parse(creds); } catch { return null; }
}

/**
 * Mesure l'architecture d'un CRM.
 *
 * @returns {Promise<{provider, measuredAt, objects: Array, error}>}
 */
async function profileArchitecture(provider, creds, { maxObjects = 25, maxFields = 60 } = {}) {
  const profil = { provider, measuredAt: new Date().toISOString(), objects: [], error: null };
  const adapt = ADAPTATEURS[provider];
  const identifiants = normaliserCreds(provider, creds);
  if (!adapt || !identifiants) return profil;

  let objets = [];
  try {
    objets = await adapt.objets(identifiants);
  } catch (err) {
    profil.error = `inventaire : ${err.message}`;
    logger.warn('crm-architecture', `${provider} · inventaire refusé : ${err.message}`);
    return profil;
  }

  // Les objets connus d'abord, les objets maison ensuite, le reste après. Une
  // org Salesforce déclare des centaines d'objets et le plafond finirait
  // sinon par écarter Opportunity au profit d'un objet de configuration.
  const connus = OBJETS_CONNUS[provider] || {};
  objets.sort((a, b) => {
    const rang = (o) => (connus[o.name] ? 0 : (o.custom ? 1 : 2));
    return rang(a) - rang(b);
  });

  for (const objet of objets.slice(0, maxObjects)) {
    const vue = {
      name: objet.name,
      label: objet.label || objet.name,
      custom: !!objet.custom,
      sampled: 0,
      lastDataAt: null,
      stale: false,
      fields: [],
      error: null,
    };
    try {
      const champs = await adapt.champs(identifiants, objet.name);
      // Plafond par objet : au delà, on profile des champs de configuration et
      // la requête d'échantillon devient elle-même trop lourde.
      const retenus = champs.slice(0, maxFields);
      const cles = retenus.map(c => c.key);
      const echantillon = await adapt.echantillon(identifiants, objet.name, cles);
      vue.sampled = echantillon.length;
      vue.fields = retenus.map(c => profileField(c, echantillon));

      const dates = vue.fields.map(f => f.lastValueAt).filter(Boolean).sort();
      vue.lastDataAt = dates.length ? dates[dates.length - 1] : null;
      // « Du décor » : soit aucune ligne, soit plus rien de récent. Les deux se
      // traitent pareil, mais pas pour la même raison, d'où le champ `sampled`
      // qui reste lisible à côté.
      const limite = new Date();
      limite.setMonth(limite.getMonth() - MOIS_AVANT_DECOR);
      vue.stale = vue.sampled === 0 || (!!vue.lastDataAt && new Date(vue.lastDataAt) < limite);
    } catch (err) {
      // Un objet refusé (permissions, objet non interrogeable) ne doit pas
      // emporter l'inventaire : on le garde dans le profil avec son erreur,
      // parce qu'un objet qu'on n'a pas pu lire n'est pas un objet absent.
      vue.error = err.message;
    }
    profil.objects.push(vue);
  }

  return profil;
}

// ═══════════════════════════════════════════════════════════════════════════
// 3 · Inférence
// ═══════════════════════════════════════════════════════════════════════════

/** Ce que les règles tranchent seules. */
function deduireParRegle(provider, objectName, fieldKey) {
  if (!fieldKey) return OBJETS_CONNUS[provider]?.[objectName] || null;
  const table = CHAMPS_CONNUS[provider] || {};
  return table[`${objectName}.${fieldKey}`.toLowerCase()] || null;
}

/**
 * Ce qui part au modèle · et rien d'autre ne doit jamais y partir.
 *
 * Fonction unique et volontairement étroite : elle ne sait construire que des
 * agrégats. Tant qu'elle est le seul chemin vers Claude, la promesse RGPD de
 * l'en-tête est tenue par la structure du code et non par la vigilance de
 * celui qui le modifie.
 */
function buildInferencePayload(profil) {
  return profil.objects
    .filter(o => !o.error)
    .map(o => ({
      objet: o.name,
      libelle: o.label,
      maison: o.custom,
      lignes_echantillonnees: o.sampled,
      derniere_donnee: o.lastDataAt,
      inactif_depuis_2_ans: o.stale,
      champs: o.fields
        // Sous 5 % de remplissage, un champ est du bruit : le montrer au
        // modèle, c'est l'inviter à bâtir une déduction sur du vide.
        .filter(f => f.fillRate >= 0.05)
        .map(f => ({
          champ: f.key,
          libelle: f.label,
          type: f.type,
          maison: f.custom,
          taux_remplissage: f.fillRate,
          valeurs_distinctes: f.cardinality,
          pointe_vers: f.referenceTo,
          ...(f.options.length ? { choix: f.options } : {}),
        })),
    }));
}

/**
 * Demande à Claude ce qu'il reste à comprendre.
 *
 * Un seul appel pour toute l'architecture : les objets se comprennent les uns
 * par rapport aux autres. Un `Contrat__c` qui pointe vers `Account` et porte
 * un montant et deux dates n'est interprétable qu'en voyant qu'`Opportunity`
 * existe à côté et sert à autre chose.
 *
 * Best-effort : un échec laisse les déductions manquantes en 'unknown' plutôt
 * que d'inventer, et surtout plutôt que de faire tomber l'analyse.
 */
async function inferWithClaude(provider, profil) {
  const out = new Map();
  const charge = buildInferencePayload(profil);
  if (charge.length === 0) return out;

  const claude = require('../api/claude');
  const system = 'Tu analyses la structure d\'un CRM d\'entreprise. Réponds UNIQUEMENT en JSON valide.';
  const prompt = `Voici le profil d'usage RÉEL du CRM ${provider} d'une PME B2B. Ce ne sont que des agrégats : noms de champs, types, taux de remplissage, nombre de valeurs distinctes, et libellés des listes de choix. Aucune donnée d'un client réel.

${JSON.stringify(charge, null, 2)}

Dis, pour chaque objet et pour les champs qui comptent, ce qu'il JOUE dans ce modèle :

Rôles d'OBJET :
  account  · la société cliente ou prospecte
  person   · la personne physique, celle qui porte un email
  deal     · l'affaire, la vente, le contrat en cours
  activity · un évènement ou une tâche
  unknown  · vu, pas compris

Rôles de CHAMP :
  lifecycle    · l'axe qui dit où en est la relation ou l'affaire (étape, statut, type)
  amount       · le montant
  currency     · la devise du montant
  close_date   · la date de clôture, prévue ou constatée
  created_at   · la date de naissance de l'enregistrement dans le CRM
  owner        · le commercial responsable
  name         · le nom lisible
  email        · l'adresse email
  account_link · le lien vers la société
  unknown      · vu, pas compris

Règles :
- un objet INACTIF DEPUIS 2 ANS est du décor : réponds 'unknown' et dis-le dans la raison, même si son nom est évocateur
- un champ rempli sous 30 % ne peut pas porter le cycle de vie de quoi que ce soit
- une liste de choix à peu de valeurs, présente sur presque toutes les lignes, est un bon candidat 'lifecycle'
- un objet MAISON n'est jamais interprété seul : donne ton avis avec une confiance BASSE (sous 0.5), c'est l'utilisateur qui tranchera
- les intitulés peuvent être dans n'importe quelle langue, ou propres au métier de l'équipe
- confidence entre 0 et 1. Descends sous 0.6 dès que tu hésites : c'est ce qui dira à l'utilisateur quoi relire
- reason : une phrase courte, en français, qui s'appuie sur un CHIFFRE du profil. Une déduction qu'on ne peut pas justifier, personne ne la corrigera

Retourne :
{
  "deductions": [
    { "objet": "...", "champ": null, "role": "...", "confidence": 0.0, "reason": "..." }
  ]
}
champ vaut null quand la déduction porte sur l'objet lui-même.`;

  try {
    const brut = await claude.callClaude(system, prompt, 4000, 'crm_architecture_discovery');
    const parsed = safeParseClaudeJSON(brut, 'deductions');
    for (const row of parsed?.deductions || []) {
      if (!row?.objet || !ALL_ROLES.includes(row.role)) continue;
      const champ = row.champ ? String(row.champ) : null;
      const confiance = Number(row.confidence);
      out.set(`${row.objet}::${champ || ''}`, {
        role: row.role,
        // Une confiance absente ou illisible ne se lit pas comme une
        // certitude : on laisse le champ vide plutôt que de supposer.
        confidence: Number.isFinite(confiance) ? Math.min(1, Math.max(0, confiance)) : null,
        reasoning: typeof row.reason === 'string' ? row.reason.slice(0, 500) : null,
      });
    }
  } catch (err) {
    logger.warn('crm-architecture', `Inférence refusée (${provider}) : ${err.message}`);
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// 4 · Persistance et restitution
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Mesure, déduit, enregistre.
 *
 * @returns {Promise<{provider, objects, fields, custom, byRule, byAi, kept, drift, error}>}
 */
async function analyzeCrmArchitecture(userId, opts = {}) {
  const rapport = {
    provider: null, objects: 0, fields: 0, custom: 0,
    byRule: 0, byAi: 0, kept: 0, unknown: 0, drift: [], error: null,
  };
  try {
    let { provider, creds } = opts;
    if (!provider || !creds) {
      const { resolveCrmForUser } = require('./crm-token');
      ({ provider, creds } = await resolveCrmForUser(userId));
    }
    if (!provider || !WITH_ARCHITECTURE.includes(provider) || !creds) return rapport;
    rapport.provider = provider;

    const profil = await profileArchitecture(provider, creds);
    if (profil.error) rapport.error = profil.error;
    rapport.objects = profil.objects.length;
    rapport.fields = profil.objects.reduce((n, o) => n + o.fields.length, 0);
    rapport.custom = profil.objects.filter(o => o.custom).length;
    if (rapport.objects === 0) return rapport;

    // La dérive se calcule AVANT d'enregistrer la nouvelle mesure, sinon on
    // comparerait le profil à lui-même.
    rapport.drift = await detectDrift(userId, provider, profil);

    await db.query(
      `INSERT INTO crm_architecture_profiles
         (user_id, crm_provider, profile, objects_seen, fields_seen, custom_objects)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, provider, JSON.stringify(profil), rapport.objects, rapport.fields, rapport.custom]
    );

    // Ce que l'utilisateur a corrigé sort du périmètre AVANT l'appel au
    // modèle : inutile de payer pour une réponse qu'on jettera.
    const existant = await db.query(
      `SELECT object_name, field_name, source FROM crm_architecture_mappings
        WHERE user_id = $1 AND crm_provider = $2`,
      [userId, provider]
    );
    const gelees = new Set(
      existant.rows.filter(r => r.source === 'user')
        .map(r => `${r.object_name}::${r.field_name || ''}`)
    );

    // Tout ce qu'il y a à trancher : chaque objet, et chaque champ qui n'est
    // pas du bruit.
    const aTrancher = [];
    for (const objet of profil.objects) {
      if (objet.error) continue;
      aTrancher.push({ objet, champ: null });
      for (const champ of objet.fields) {
        if (champ.fillRate < 0.05) continue;
        aTrancher.push({ objet, champ });
      }
    }

    const parRegle = new Map();
    let resteAuModele = false;
    for (const item of aTrancher) {
      const cle = `${item.objet.name}::${item.champ?.key || ''}`;
      if (gelees.has(cle)) { rapport.kept++; continue; }
      const role = deduireParRegle(provider, item.objet.name, item.champ?.key);
      // Un objet inactif depuis deux ans ne prend pas de rôle, même si son nom
      // le désigne : c'est l'étape 1 du plan, l'inventaire est un inventaire
      // d'USAGE. Une règle appliquée sur du décor propagerait le décor.
      if (role && !(item.champ === null && item.objet.stale)) {
        parRegle.set(cle, role);
      } else {
        resteAuModele = true;
      }
    }

    const parModele = resteAuModele ? await inferWithClaude(provider, profil) : new Map();

    for (const item of aTrancher) {
      const cle = `${item.objet.name}::${item.champ?.key || ''}`;
      if (gelees.has(cle)) continue;

      const regle = parRegle.get(cle);
      const devine = parModele.get(cle);
      let ligne;
      if (regle) {
        ligne = { role: regle, source: 'rule', confidence: 1, reasoning: null };
        rapport.byRule++;
      } else if (devine) {
        ligne = { role: devine.role, source: 'ai', confidence: devine.confidence, reasoning: devine.reasoning };
        rapport.byAi++;
      } else {
        // 'unknown' est une réponse, pas un trou : l'écran le montre comme
        // « vu, pas compris » et l'utilisateur peut trancher. Ne rien écrire
        // le rendrait invisible, ce qui est exactement ce qu'on reproche au
        // produit d'avant.
        ligne = { role: 'unknown', source: 'rule', confidence: null, reasoning: null };
        rapport.unknown++;
      }

      await db.query(
        `INSERT INTO crm_architecture_mappings
           (user_id, crm_provider, object_name, object_label, field_name, field_label,
            is_custom, baakalai_role, source, confidence, reasoning, evidence)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (user_id, crm_provider, object_name, COALESCE(field_name, ''))
         DO UPDATE SET
           object_label = EXCLUDED.object_label,
           field_label = EXCLUDED.field_label,
           is_custom = EXCLUDED.is_custom,
           baakalai_role = EXCLUDED.baakalai_role,
           source = EXCLUDED.source,
           confidence = EXCLUDED.confidence,
           reasoning = EXCLUDED.reasoning,
           evidence = EXCLUDED.evidence,
           updated_at = now()`,
        [
          userId, provider, item.objet.name, item.objet.label,
          item.champ?.key || null, item.champ?.label || null,
          item.champ ? !!item.champ.custom : !!item.objet.custom,
          ligne.role, ligne.source, ligne.confidence, ligne.reasoning,
          JSON.stringify(item.champ
            ? { fillRate: item.champ.fillRate, cardinality: item.champ.cardinality, type: item.champ.type }
            : { sampled: item.objet.sampled, lastDataAt: item.objet.lastDataAt, stale: item.objet.stale }),
        ]
      );
    }

    logger.info('crm-architecture',
      `${provider} · ${rapport.objects} objet(s) dont ${rapport.custom} maison, ${rapport.fields} champ(s) profilé(s) · ` +
      `${rapport.byRule} par règle, ${rapport.byAi} déduit(s), ${rapport.unknown} non compris, ${rapport.kept} corrigé(s) à la main` +
      (rapport.drift.length ? ` · ${rapport.drift.length} dérive(s)` : ''));
  } catch (err) {
    rapport.error = rapport.error || err.message;
    logger.warn('crm-architecture', `Analyse échouée pour ${userId} : ${err.message}`);
  }
  return rapport;
}

// ═══════════════════════════════════════════════════════════════════════════
// 5 · Dérive
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Ce qui a changé depuis la dernière mesure.
 *
 * Trois signaux, et ils ne veulent pas dire la même chose : un objet qui
 * apparaît (l'équipe a installé quelque chose), un objet qui s'éteint (elle a
 * arrêté de s'en servir, et tout ce qu'on en déduisait est périmé), un champ
 * dont le remplissage bascule (il vient d'entrer ou de sortir du processus).
 *
 * On SIGNALE, on ne corrige rien. Une dérive détectée n'a pas à réécrire une
 * déduction toute seule : c'est à l'utilisateur de dire ce qu'elle veut dire.
 */
async function detectDrift(userId, provider, profilActuel) {
  const derives = [];
  try {
    const precedent = await db.query(
      `SELECT profile FROM crm_architecture_profiles
        WHERE user_id = $1 AND crm_provider = $2
        ORDER BY measured_at DESC LIMIT 1`,
      [userId, provider]
    );
    let avant = precedent.rows[0]?.profile;
    // Postgres rend le JSONB désérialisé, le miroir sqlite des tests rend la
    // chaîne. Sans ce démêlage, la dérive ne serait testable nulle part.
    if (typeof avant === 'string') {
      try { avant = JSON.parse(avant); } catch { avant = null; }
    }
    if (!avant) return derives;
    const parNom = new Map((avant.objects || []).map(o => [o.name, o]));

    for (const objet of profilActuel.objects) {
      const vieux = parNom.get(objet.name);
      if (!vieux) {
        derives.push({ type: 'objet_nouveau', object: objet.name, label: objet.label });
        continue;
      }
      if (!vieux.stale && objet.stale) {
        derives.push({ type: 'objet_eteint', object: objet.name, label: objet.label });
      }
      const champsAvant = new Map((vieux.fields || []).map(f => [f.key, f]));
      for (const champ of objet.fields) {
        const vieuxChamp = champsAvant.get(champ.key);
        if (!vieuxChamp) {
          if (champ.fillRate >= 0.3) {
            derives.push({ type: 'champ_nouveau', object: objet.name, field: champ.key, fillRate: champ.fillRate });
          }
          continue;
        }
        // 30 points d'écart · en dessous, c'est le bruit d'échantillonnage,
        // et signaler du bruit apprend à l'utilisateur à ignorer les signaux.
        if (Math.abs(champ.fillRate - vieuxChamp.fillRate) >= 0.3) {
          derives.push({
            type: 'remplissage_bascule', object: objet.name, field: champ.key,
            from: vieuxChamp.fillRate, to: champ.fillRate,
          });
        }
      }
    }
  } catch (err) {
    logger.warn('crm-architecture', `Détection de dérive échouée : ${err.message}`);
  }
  return derives;
}

// ═══════════════════════════════════════════════════════════════════════════
// Lecture et correction
// ═══════════════════════════════════════════════════════════════════════════

/** Le mapping résolu, tel que l'écran de lecture le montre. */
async function getArchitecture(userId, provider) {
  const res = await db.query(
    `SELECT id, object_name, object_label, field_name, field_label, is_custom,
            baakalai_role, source, confidence, reasoning, evidence, updated_at
       FROM crm_architecture_mappings
      WHERE user_id = $1 AND crm_provider = $2
      ORDER BY object_name, (field_name IS NOT NULL), field_name`,
    [userId, provider]
  );
  return res.rows;
}

/** La dernière mesure, pour montrer la preuve à côté de la conclusion. */
async function getLatestProfile(userId, provider) {
  const res = await db.query(
    `SELECT profile, objects_seen, fields_seen, custom_objects, measured_at
       FROM crm_architecture_profiles
      WHERE user_id = $1 AND crm_provider = $2
      ORDER BY measured_at DESC LIMIT 1`,
    [userId, provider]
  );
  return res.rows[0] || null;
}

/**
 * Une correction humaine. Elle passe la ligne en source='user', et plus aucune
 * passe automatique ne la réécrira · sans ça, la correction sauterait à
 * l'analyse suivante et l'utilisateur n'aurait aucun moyen de la faire tenir.
 */
async function setArchitectureRole(userId, mappingId, role) {
  if (!ALL_ROLES.includes(role)) return null;
  // L'identifiant EN DERNIER paramètre : le miroir sqlite des tests
  // reconstitue la ligne mise à jour en supposant que le dernier paramètre est
  // l'id (db/sqlite-adapter.js). Avec l'ordre inverse, la fonction rend null en
  // test alors qu'elle fonctionne en production, et la correction manuelle
  // n'est gardée par aucun test.
  const res = await db.query(
    `UPDATE crm_architecture_mappings
        SET baakalai_role = $1, source = 'user', confidence = 1,
            reasoning = NULL, updated_at = now()
      WHERE user_id = $2 AND id = $3
      RETURNING *`,
    [role, userId, mappingId]
  );
  return res.rows[0] || null;
}

module.exports = {
  WITH_ARCHITECTURE,
  OBJECT_ROLES,
  FIELD_ROLES,
  ALL_ROLES,
  profileArchitecture,
  buildInferencePayload,
  deduireParRegle,
  analyzeCrmArchitecture,
  detectDrift,
  getArchitecture,
  getLatestProfile,
  setArchitectureRole,
};
