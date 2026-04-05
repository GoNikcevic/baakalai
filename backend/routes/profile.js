const { Router } = require('express');
const db = require('../db');
const { callClaude } = require('../api/claude');

const router = Router();

// GET /api/profile — Return current user's profile
router.get('/', async (req, res, next) => {
  try {
    const profile = await db.profiles.get(req.user.id);
    res.json({ profile: profile || null });
  } catch (err) {
    next(err);
  }
});

// POST /api/profile — Create or update profile
router.post('/', async (req, res, next) => {
  try {
    const data = {};
    const allowed = [
      'company', 'sector', 'website', 'team_size', 'description',
      'value_prop', 'social_proof', 'pain_points', 'objections',
      'persona_primary', 'persona_secondary', 'target_sectors',
      'target_size', 'target_zones', 'default_tone', 'default_formality',
      'avoid_words', 'signature_phrases',
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

// POST /api/profile/auto-fill — Extract profile fields from uploaded documents via Claude
router.post('/auto-fill', async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Get parsed text from uploaded documents
    const docs = await db.documents.getParsedTextByUser(userId, 10);
    if (!docs || docs.length === 0) {
      return res.status(400).json({ error: 'Aucun document uploadé' });
    }

    const docText = docs
      .map(d => `--- ${d.original_name} ---\n${(d.parsed_text || '').slice(0, 3000)}`)
      .join('\n\n')
      .slice(0, 10000);

    const result = await callClaude(
      `Tu es un consultant senior en business development B2B avec 15 ans d'expérience en stratégie outbound. Tu analyses les documents d'une entreprise pour construire le profil de prospection le plus percutant possible.

Ton approche :
1. ANALYSE EN PROFONDEUR les documents — ne te contente pas de résumer, COMPRENDS le business model, le positionnement, et les avantages compétitifs
2. IDENTIFIE les pain points des CLIENTS de cette entreprise (pas de l'entreprise elle-même) — pourquoi un prospect aurait besoin de leurs services
3. FORMULE la proposition de valeur comme un pitch de 2 phrases qui donne envie d'en savoir plus — pas une description Wikipedia
4. ANTICIPE les objections qu'un prospect pourrait avoir (prix, alternatives, timing, changement de process)
5. DÉFINIS les personas avec leur titre exact, leurs responsabilités, et surtout leurs FRUSTRATIONS quotidiennes que l'entreprise peut résoudre
6. RECOMMANDE les secteurs et tailles d'entreprise où l'offre aura le plus d'impact — sois spécifique, pas générique

Retourne un JSON. Sois précis, actionnable, et opinionné — comme un consultant qui facture 500€/h :

{
  "company": "Nom exact de l'entreprise",
  "sector": "Secteur principal (ex: Biotech / Diagnostics, pas juste 'Santé')",
  "description": "Description business percutante (2-3 phrases, pas corporate)",
  "value_prop": "Proposition de valeur formulée comme un pitch de vente (2 phrases max, chiffrée si possible)",
  "social_proof": "Clients notables, partenariats, certifications, prix — tout ce qui crédibilise",
  "pain_points": "Les 3-4 frustrations principales des PROSPECTS cibles que l'entreprise résout",
  "objections": "Les 3-4 objections qu'un prospect pourrait avoir et comment les contrer",
  "persona_primary": "Titre exact + responsabilités + frustration #1 que l'entreprise résout",
  "persona_secondary": "Deuxième décideur/influenceur dans le cycle d'achat",
  "target_sectors": "Secteurs spécifiques où l'offre a le plus d'impact (séparés par virgules)",
  "target_size": "Taille d'entreprise idéale avec justification (ex: 'PME 50-500 car...')",
  "target_zones": "Zones géographiques prioritaires"
}`,
      docText,
      4000
    );

    if (result.parsed) {
      res.json({ profile: result.parsed, source: docs.map(d => d.original_name) });
    } else {
      res.status(500).json({ error: 'Impossible d\'extraire les informations' });
    }
  } catch (err) {
    next(err);
  }
});

module.exports = router;
