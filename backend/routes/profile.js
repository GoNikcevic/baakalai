const { Router } = require('express');
const db = require('../db');
const { callClaude } = require('../api/claude');
const { fetchWebsiteText } = require('../lib/website-text');

const router = Router();

// GET /api/profile · Return current user's profile
router.get('/', async (req, res, next) => {
  try {
    const profile = await db.profiles.get(req.user.id);
    res.json({ profile: profile || null });
  } catch (err) {
    next(err);
  }
});

// POST /api/profile · Create or update profile
router.post('/', async (req, res, next) => {
  try {
    const data = {};
    const allowed = [
      'company', 'sector', 'website', 'team_size', 'description',
      'value_prop', 'social_proof', 'pain_points', 'objections',
      'persona_primary', 'persona_secondary', 'target_sectors',
      'target_size', 'target_zones', 'default_tone', 'default_formality',
      'avoid_words', 'signature_phrases',
      // Poste de l'utilisateur · seul critère ICP non déductible du CRM,
      // demandé à l'onboarding. Les critères déduits (icp_*) ne sont PAS
      // dans cette liste : ils sont calculés côté serveur par
      // lib/icp-signals.js et ne doivent jamais être posés par le client.
      'job_role',
    ];

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        data[key] = req.body[key];
      }
    }

    const profile = await db.profiles.upsert(req.user.id, data);
    res.json({ profile });
  } catch (err) {
    next(err);
  }
});

// POST /api/profile/auto-fill · Extract profile fields (+ product lines) from
// uploaded documents AND the company website via Claude, in one pass. Website
// is best-effort (fetchWebsiteText never throws) : ça ne bloque jamais
// l'analyse si le site est down, mal formé, ou juste absent du profil.
router.post('/auto-fill', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const sources = [];

    // List ALL documents first to distinguish "no docs" vs "docs exist but parsing failed"
    const allUserDocs = await db.documents.listByUser(userId);
    let docs = [];
    let docsParsingFailed = false;
    if (allUserDocs && allUserDocs.length > 0) {
      const parsedDocs = await db.documents.getParsedTextByUser(userId, 20);
      if (!parsedDocs || parsedDocs.length === 0) {
        docsParsingFailed = true;
      } else {
        // Prefer company-tagged docs, fallback to any doc with parsed text
        docs = parsedDocs.filter(d => d.doc_type === 'company');
        if (docs.length === 0) {
          // Fallback: use any doc that isn't explicitly a prospect list
          docs = parsedDocs.filter(d => d.doc_type !== 'prospects');
        }
      }
    }

    const profile = await db.profiles.get(userId);
    let websiteText = null;
    if (profile?.website) {
      websiteText = await fetchWebsiteText(profile.website);
    }

    if (docs.length === 0 && !websiteText) {
      if (docsParsingFailed) {
        const names = allUserDocs.map(d => d.original_name).join(', ');
        return res.status(400).json({
          error: `Vos documents (${names}) n'ont pas pu être analysés. Le parsing a échoué, essayez de re-uploader en PDF ou TXT.`,
        });
      }
      return res.status(400).json({
        error: 'Aucune source exploitable. Uploadez un document (présentation entreprise) ou renseignez votre site web.',
      });
    }

    if (docs.length > 0) {
      sources.push(...docs.map(d => d.original_name));
    }
    let sourceText = docs
      .map(d => `--- Document : ${d.original_name} ---\n${(d.parsed_text || '').slice(0, 3000)}`)
      .join('\n\n');
    if (websiteText) {
      sources.push(profile.website);
      sourceText += `${sourceText ? '\n\n' : ''}--- Site web : ${profile.website} ---\n${websiteText}`;
    }
    sourceText = sourceText.slice(0, 12000);

    const result = await callClaude(
      `Tu es un consultant senior en business development B2B avec 15 ans d'expérience en stratégie outbound. Tu analyses les documents et/ou le site web d'une entreprise pour construire le profil de prospection le plus percutant possible.

Ton approche :
1. ANALYSE EN PROFONDEUR les sources, ne te contente pas de résumer, COMPRENDS le business model, le positionnement, et les avantages compétitifs
2. IDENTIFIE les pain points des CLIENTS de cette entreprise (pas de l'entreprise elle-même), pourquoi un prospect aurait besoin de leurs services
3. FORMULE la proposition de valeur comme un pitch de 2 phrases qui donne envie d'en savoir plus, pas une description Wikipedia
4. ANTICIPE les objections qu'un prospect pourrait avoir (prix, alternatives, timing, changement de process)
5. DÉFINIS les personas avec leur titre exact, leurs responsabilités, et surtout leurs FRUSTRATIONS quotidiennes que l'entreprise peut résoudre
6. RECOMMANDE les secteurs et tailles d'entreprise où l'offre aura le plus d'impact, sois spécifique, pas générique
7. IDENTIFIE les produits/lignes de produits distincts de l'entreprise si les sources le permettent clairement (ex: une agence avec "Audit SEO" et "Gestion de campagnes Ads" sont 2 produits distincts) · NE JAMAIS inventer un produit qui ne ressort pas clairement des sources, un tableau vide est la bonne réponse si l'offre est unique ou pas assez détaillée pour distinguer plusieurs lignes

Retourne un JSON. Sois précis, actionnable, et opinionné, comme un consultant qui facture 500€/h :

{
  "company": "Nom exact de l'entreprise",
  "sector": "Secteur principal (ex: Biotech / Diagnostics, pas juste 'Santé')",
  "description": "Description business percutante (2-3 phrases, pas corporate)",
  "value_prop": "Proposition de valeur formulée comme un pitch de vente (2 phrases max, chiffrée si possible)",
  "social_proof": "Clients notables, partenariats, certifications, prix, tout ce qui crédibilise",
  "pain_points": "Les 3-4 frustrations principales des PROSPECTS cibles que l'entreprise résout",
  "objections": "Les 3-4 objections qu'un prospect pourrait avoir et comment les contrer",
  "persona_primary": "Titre exact + responsabilités + frustration #1 que l'entreprise résout",
  "persona_secondary": "Deuxième décideur/influenceur dans le cycle d'achat",
  "target_sectors": "Secteurs spécifiques où l'offre a le plus d'impact (séparés par virgules)",
  "target_size": "Taille d'entreprise idéale avec justification (ex: 'PME 50-500 car...')",
  "target_zones": "Zones géographiques prioritaires",
  "products": [{ "name": "Nom du produit/ligne", "description": "1-2 phrases sur ce produit précis" }]
}`,
      sourceText,
      4000
    );

    if (result.parsed) {
      const products = Array.isArray(result.parsed.products) ? result.parsed.products : [];
      const { products: _omit, ...profileFields } = result.parsed;
      res.json({ profile: profileFields, products, source: sources });
    } else {
      res.status(500).json({ error: 'Impossible d\'extraire les informations' });
    }
  } catch (err) {
    next(err);
  }
});

module.exports = router;
