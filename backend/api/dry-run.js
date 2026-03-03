/**
 * Dry-run responses for AI endpoints.
 * Returns realistic simulated data that exercises the full pipeline
 * without calling Claude API.
 *
 * Usage: POST /api/ai/analyze?dry_run=true
 */

const MOCK_USAGE = { input_tokens: 0, output_tokens: 0 };

// =============================================
// Generate Full Sequence (dry-run)
// =============================================

function generateSequence(params) {
  const { sector, position, channel, tone, formality, angle } = params;
  const isVous = (formality || 'Vous') !== 'Tu';
  const greeting = isVous ? 'Bonjour' : 'Salut';

  const emailSequence = [
    {
      step: 'E1',
      type: 'email',
      label: 'Email initial',
      timing: 'J+0',
      subType: angle || 'Douleur client',
      subject: `{{firstName}}, une question sur ${sector || 'votre activité'}`,
      subjectB: `{{companyName}} — ${position || 'dirigeant'} ?`,
      body: `${greeting} {{firstName}},\n\nJe me permets de vous contacter car je travaille avec des ${position || 'décideurs'} dans le secteur ${sector || 'de votre industrie'}.\n\nQuestion directe : quel est votre plus gros défi opérationnel en ce moment chez {{companyName}} ?\n\nNos clients dans votre secteur gagnent en moyenne 15h/semaine en optimisant trois processus clés.\n\nCurieux de savoir si c'est un sujet pour vous ?`,
      hypothesis: 'Hook sectoriel + question ouverte — teste si le ciblage précis augmente le taux de réponse',
    },
    {
      step: 'E2',
      type: 'email',
      label: 'Email valeur',
      timing: 'J+3',
      subType: 'Preuve par l\'exemple',
      subject: `Re: ${sector || 'votre activité'} — un cas concret`,
      subjectB: `{{firstName}}, un résultat qui parle`,
      body: `${greeting} {{firstName}},\n\nJe me permets de revenir avec un exemple concret.\n\nUne entreprise de ${sector || 'votre secteur'} (${params.size || '30 personnes'}, profil similaire à {{companyName}}) a réduit de 40% son temps de traitement en 3 mois.\n\nRésultat : 2 jours récupérés chaque mois pour du travail à valeur ajoutée.\n\nEst-ce que c'est un sujet chez {{companyName}} ?`,
      hypothesis: 'Case study sectoriel + résultat chiffré — teste la crédibilité par la preuve',
    },
    {
      step: 'E3',
      type: 'email',
      label: 'Email relance',
      timing: 'J+7',
      subType: 'Changement d\'angle',
      subject: `Autre approche, {{firstName}}`,
      subjectB: `{{firstName}}, une tendance dans ${sector || 'votre secteur'}`,
      body: `${greeting} {{firstName}},\n\nJe change d'approche. Plutôt que de parler d'optimisation, une question simple : qu'est-ce qui freine le plus la croissance de {{companyName}} en ce moment ?\n\nLes ${position || 'dirigeants'} que j'accompagne dans ${sector || 'votre secteur'} citent en général 3 freins récurrents.\n\nSi le sujet vous parle, je peux vous partager ce qu'ils ont fait pour les lever.`,
      hypothesis: 'Angle croissance au lieu d\'optimisation — teste si la projection positive performe mieux',
    },
    {
      step: 'E4',
      type: 'email',
      label: 'Email break-up',
      timing: 'J+12',
      subType: 'Dernier message',
      subject: `{{firstName}}, dernier message`,
      subjectB: `Pas le bon moment ?`,
      body: `${greeting} {{firstName}},\n\nJe ne veux pas encombrer votre boîte.\n\nSi un jour le sujet devient prioritaire, mon agenda est ouvert.\n\nBonne continuation !`,
      hypothesis: 'Break-up court et respectueux — teste le soft close',
    },
  ];

  const linkedinSequence = [
    {
      step: 'L1',
      type: 'linkedin',
      label: 'Note de connexion',
      timing: 'J+0',
      subType: 'Première prise de contact',
      subject: null,
      body: `{{firstName}}, votre parcours dans ${sector || 'votre secteur'} m'a interpellé. J'accompagne des ${position || 'professionnels'} sur la croissance commerciale — ravi d'échanger.`,
      bodyB: `{{firstName}}, votre expertise chez {{companyName}} m'intéresse. Je travaille avec des ${position || 'décideurs'} du secteur — connectons-nous !`,
      maxChars: 300,
      hypothesis: 'Compliment pro + intérêt commun vs mention entreprise directe',
    },
    {
      step: 'L2',
      type: 'linkedin',
      label: 'Message post-connexion',
      timing: 'J+3',
      subType: 'Après acceptation',
      subject: null,
      body: `Merci d'avoir accepté, {{firstName}} !\n\nComment gérez-vous votre développement commercial chez {{companyName}} actuellement ?\n\nJ'échange régulièrement avec des ${position || 'professionnels'} de ${sector || 'votre secteur'} sur le sujet.`,
      bodyB: `Ravi d'être connecté, {{firstName}} !\n\nQuel est le plus gros défi pour {{companyName}} en ce moment côté croissance ?\n\nJ'accompagne des entreprises de ${sector || 'votre secteur'} sur ces sujets.`,
      hypothesis: 'Question ouverte métier vs question sur les défis — teste l\'approche conversationnelle',
    },
  ];

  let sequence;
  if (channel === 'linkedin') {
    sequence = linkedinSequence;
  } else if (channel === 'multi') {
    sequence = [emailSequence[0], linkedinSequence[0], emailSequence[1], linkedinSequence[1], emailSequence[2], emailSequence[3]];
  } else {
    sequence = emailSequence;
  }

  const parsed = {
    sequence,
    strategy: `[DRY-RUN] Séquence ${channel} pour ${position || 'décideurs'} dans ${sector || 'le secteur cible'}. Approche progressive : hook personnalisé → preuve sociale → changement d'angle → soft close.`,
    hypotheses: [
      'Le ciblage sectoriel précis augmente la pertinence perçue',
      'L\'alternance des angles maintient l\'intérêt sur la durée',
      'Le CTA question ouverte génère plus de réponses que l\'appel à l\'action directif',
    ],
  };

  return {
    raw: JSON.stringify(parsed, null, 2),
    parsed,
    usage: MOCK_USAGE,
  };
}

// =============================================
// Generate Single Touchpoint (dry-run)
// =============================================

function generateTouchpoint(type, params) {
  const defaults = {
    emailInitial: {
      subject: `{{firstName}}, une question sur ${params.sector || 'votre activité'}`,
      subjectB: `{{companyName}} — on peut en parler ?`,
      body: `Bonjour {{firstName}},\n\nQuestion rapide : quel est votre plus gros défi chez {{companyName}} en ce moment ?\n\nJe travaille avec des ${params.position || 'professionnels'} de ${params.sector || 'votre secteur'} et un pattern revient souvent.\n\nCurieux de savoir si ça vous parle ?`,
      hypothesis: '[DRY-RUN] Hook sectoriel + question ouverte',
    },
    emailValue: {
      subject: `Re: ${params.sector || 'votre secteur'} — un résultat concret`,
      subjectB: `{{firstName}}, -40% en 3 mois`,
      body: `Bonjour {{firstName}},\n\nUn exemple concret : une entreprise similaire à {{companyName}} a réduit de 40% son temps de traitement.\n\nRésultat : 2 jours récupérés par mois.\n\nEst-ce un sujet pour vous ?`,
      hypothesis: '[DRY-RUN] Case study chiffré',
    },
    emailRelance: {
      subject: `Autre approche, {{firstName}}`,
      subjectB: `{{firstName}}, et si on voyait ça autrement ?`,
      body: `Bonjour {{firstName}},\n\nJe change d'angle. Qu'est-ce qui freine le plus la croissance de {{companyName}} ?\n\nLes ${params.position || 'dirigeants'} de ${params.sector || 'votre secteur'} citent 3 freins récurrents.\n\nJe peux vous les partager si ça vous intéresse.`,
      hypothesis: '[DRY-RUN] Changement d\'angle vers croissance',
    },
    emailBreakup: {
      subject: `{{firstName}}, dernier message`,
      subjectB: `Pas le bon moment ?`,
      body: `Bonjour {{firstName}},\n\nJe ne veux pas encombrer votre boîte.\n\nSi le sujet devient prioritaire, mon agenda est ouvert.\n\nBonne continuation !`,
      hypothesis: '[DRY-RUN] Soft close respectueux',
    },
    linkedinConnection: {
      body: `{{firstName}}, votre parcours dans ${params.sector || 'votre secteur'} m'a interpellé. Ravi d'échanger !`,
      bodyB: `{{firstName}}, votre expertise chez {{companyName}} m'intéresse — connectons-nous !`,
      charCount: 95,
      hypothesis: '[DRY-RUN] Compliment pro court',
    },
    linkedinMessage: {
      body: `Merci {{firstName}} !\n\nComment gérez-vous le développement commercial chez {{companyName}} ?\n\nJ'échange avec des ${params.position || 'pros'} de ${params.sector || 'votre secteur'} sur le sujet.`,
      bodyB: `Ravi d'être connecté, {{firstName}} !\n\nQuel est le plus gros défi pour {{companyName}} côté croissance ?`,
      hypothesis: '[DRY-RUN] Question ouverte post-connexion',
    },
    subjectLines: {
      subjects: [
        { step: 'E1', variantA: `{{firstName}}, une question`, variantB: `{{companyName}} — on en parle ?`, hypothesisA: 'Direct', hypothesisB: 'Curiosité' },
        { step: 'E2', variantA: `Re: un cas concret`, variantB: `{{firstName}}, -40% en 3 mois`, hypothesisA: 'Continuité', hypothesisB: 'Chiffre' },
      ],
    },
  };

  const mock = defaults[type] || defaults.emailInitial;

  return {
    raw: JSON.stringify(mock, null, 2),
    parsed: mock,
    usage: MOCK_USAGE,
  };
}

// =============================================
// Performance Analysis (dry-run)
// =============================================

function analyzeCampaign(campaignData) {
  const steps = (campaignData.sequence || []).map(tp => tp.step);
  const hasEmail = steps.some(s => s.startsWith('E'));
  const hasLinkedin = steps.some(s => s.startsWith('L'));

  const touchpointAnalysis = [];
  if (hasEmail) {
    touchpointAnalysis.push(
      { step: 'E1', score: 'bon', diagnosis: 'Objet personnalisé fonctionne bien. Hook sectoriel pertinent.', rootCause: null, action: 'keep', priority: 4 },
      { step: 'E2', score: 'bon', diagnosis: 'Le "Re:" booste l\'ouverture. Case study crédible.', rootCause: null, action: 'keep', priority: 3 },
      { step: 'E3', score: 'problème', diagnosis: 'Baisse significative d\'ouverture et réponse.', rootCause: 'Angle anxiogène "coût de l\'erreur" repousse les prospects', action: 'regenerate', priority: 1 },
      { step: 'E4', score: 'moyen', diagnosis: 'Correct pour un break-up mais peut être raccourci.', rootCause: 'Trop de phrases (4 au lieu de 3)', action: 'monitor', priority: 2 },
    );
  }
  if (hasLinkedin) {
    touchpointAnalysis.push(
      { step: 'L1', score: 'bon', diagnosis: `${campaignData.accept_rate_lk || 30}% d'acceptation au-dessus du benchmark.`, rootCause: null, action: 'keep', priority: 5 },
      { step: 'L2', score: 'moyen', diagnosis: 'Message post-connexion manque de spécificité.', rootCause: 'Preuve sociale trop générique', action: 'regenerate', priority: 2 },
    );
  }

  const parsed = {
    summary: `[DRY-RUN] La campagne "${campaignData.name}" montre des résultats ${(campaignData.reply_rate || 0) >= 5 ? 'encourageants' : 'à améliorer'}. E3 nécessite une régénération prioritaire (angle à changer). ${hasLinkedin ? 'L2 peut être amélioré.' : ''}`,
    overallScore: (campaignData.reply_rate || 0) >= 5 ? 'bon' : 'moyen',
    touchpointAnalysis,
    priorities: [
      { step: 'E3', priority: 1, issue: 'Angle anxiogène sous-performe', recommendation: 'Changer pour angle "gain de temps"', expectedImpact: '+2-3 pts réponse' },
      ...(hasLinkedin ? [{ step: 'L2', priority: 2, issue: 'Preuve sociale trop générique', recommendation: 'Passer en angle douleur client', expectedImpact: '+1.5 pts réponse' }] : []),
    ],
    regenerationInstructions: {
      stepsToRegenerate: hasLinkedin ? ['E3', 'L2'] : ['E3'],
      globalDirection: 'Remplacer les angles anxiogènes par des angles positifs (gain, opportunité)',
      perStep: {
        E3: 'Remplacer "coût de l\'erreur" par "gain de temps". Raccourcir. CTA question ouverte.',
        ...(hasLinkedin ? { L2: 'Remplacer preuve sociale générique par question directe sur le problème du prospect.' } : {}),
      },
    },
  };

  return {
    diagnostic: `## Résumé\n${parsed.summary}\n\n## Priorités\n${parsed.priorities.map(p => `${p.priority}. ${p.step} — ${p.issue} → ${p.recommendation} (${p.expectedImpact})`).join('\n')}`,
    parsed,
    usage: MOCK_USAGE,
  };
}

// =============================================
// Sequence Regeneration (dry-run)
// =============================================

function regenerateSequence(params) {
  const { clientParams } = params;
  const formality = clientParams?.formality || 'Vous';
  const greeting = formality === 'Tu' ? 'Salut' : 'Bonjour';

  const messages = [
    {
      step: 'E3',
      action: 'regenerated',
      variantA: {
        subject: '{{firstName}}, une idée pour gagner du temps',
        body: `${greeting} {{firstName}},\n\nQuestion rapide : combien de temps {{companyName}} passe sur le reporting chaque semaine ?\n\nNos clients en récupèrent 12h en moyenne. Curieux de savoir si c'est un sujet chez vous ?`,
        hypothesis: 'Angle positif "gain de temps" au lieu de "coût de l\'erreur" — moins anxiogène, plus actionnable',
      },
      variantB: {
        subject: '{{firstName}}, 12h/semaine récupérées',
        body: `${greeting} {{firstName}},\n\nUne question : si votre équipe récupérait 12h/semaine, qu'est-ce que {{companyName}} en ferait ?\n\nC'est ce que font nos clients dans le secteur ${clientParams?.sector || 'de votre industrie'}. Ça vous parle ?`,
        hypothesis: 'Chiffre concret dans l\'objet + question projection — teste si le bénéfice chiffré attire plus',
      },
      changes: 'Angle changé de "coût erreur" à "gain de temps". Message raccourci.',
      memoryUsed: [],
    },
  ];

  const parsed = {
    messages,
    summary: '[DRY-RUN] Régénération de E3 : remplacement angle anxiogène par gain de temps. 2 variantes A/B avec hypothèses distinctes.',
    hypotheses: [
      'L\'angle positif "gain" génère +2pts de réponse vs "coût"',
      'Le chiffre concret dans l\'objet augmente le taux d\'ouverture',
    ],
    expectedImpact: '+2-3 pts taux de réponse sur E3',
  };

  return {
    raw: JSON.stringify(parsed, null, 2),
    parsed,
    usage: MOCK_USAGE,
  };
}

// =============================================
// Memory Consolidation (dry-run)
// =============================================

function consolidateMemory(diagnostics, existingMemory) {
  const patterns = [
    {
      categorie: 'Corps',
      pattern: 'Angle gain de temps > angle coût erreur (+2pts réponse estimé)',
      donnees: 'Basé sur les diagnostics des campagnes analysées. L\'angle positif surperforme sur le segment DAF/Finance.',
      confiance: 'Faible',
      secteurs: ['Comptabilité & Finance'],
      cibles: ['DAF'],
      isNew: true,
      confirmsExisting: null,
    },
    {
      categorie: 'Objets',
      pattern: 'Prénom + question courte > prénom + bénéfice direct',
      donnees: 'Les objets avec question obtiennent +3% d\'ouverture vs les objets affirmatifs.',
      confiance: 'Faible',
      secteurs: [],
      cibles: [],
      isNew: true,
      confirmsExisting: null,
    },
  ];

  const parsed = {
    patterns,
    updatedPatterns: [],
    contradictions: [],
    summary: `[DRY-RUN] ${patterns.length} nouveaux patterns identifiés à partir de ${diagnostics.length} diagnostic(s). Confiance faible — nécessite plus de données.`,
  };

  return {
    raw: JSON.stringify(parsed, null, 2),
    parsed,
    usage: MOCK_USAGE,
  };
}

// =============================================
// Variable Chain Generator (dry-run)
// =============================================

function generateVariables(params) {
  const { sector, position } = params;

  const parsed = {
    reasoning: `[DRY-RUN] Pour le secteur ${sector || 'cible'}, les variables spécifiques permettent de démontrer une expertise métier. La chaîne base → enrichie → icebreaker crée une personnalisation que les concurrents ne peuvent pas reproduire.`,
    chain: [
      {
        key: 'industryMetric',
        label: 'Métrique clé du secteur',
        type: 'base',
        desc: `Donnée clé spécifique au secteur ${sector || 'cible'}`,
        source: { icon: 'magnifier', label: 'Site web, rapports sectoriels' },
        dependsOn: [],
        derivationHint: null,
        formula: null,
        examples: [
          { prospect: 'Entreprise A', value: '45 employés, 12 clients actifs' },
          { prospect: 'Entreprise B', value: '120 employés, 30 clients actifs' },
          { prospect: 'Entreprise C', value: '20 employés, 8 clients actifs' },
        ],
      },
      {
        key: 'painEstimate',
        label: 'Estimation de la douleur',
        type: 'enrichment',
        desc: 'Douleur probable déduite de la taille et du secteur',
        source: { icon: 'robot', label: 'IA — basé sur industryMetric + taille' },
        dependsOn: ['industryMetric'],
        derivationHint: `La taille de l'entreprise dans ${sector || 'ce secteur'} corrèle avec des problèmes spécifiques de scaling`,
        formula: null,
        examples: [
          { prospect: 'Entreprise A (45 emp)', value: 'Gestion manuelle des process, perte de temps estimée 15h/sem' },
          { prospect: 'Entreprise B (120 emp)', value: 'Coordination inter-équipes, coût estimé 25K€/an' },
          { prospect: 'Entreprise C (20 emp)', value: 'Dépendance au dirigeant, risque de goulot d\'étranglement' },
        ],
      },
      {
        key: 'sectorIcebreaker',
        label: 'Icebreaker sectoriel',
        type: 'derived',
        desc: 'Accroche finale combinant la métrique et la douleur estimée',
        source: { icon: 'brain', label: 'IA — combine industryMetric + painEstimate' },
        dependsOn: ['industryMetric', 'painEstimate'],
        derivationHint: null,
        formula: {
          inputs: ['industryMetric', 'painEstimate'],
          prompt: `Génère un icebreaker en 2 phrases qui mentionne la métrique du secteur et fait le lien avec la douleur estimée. Ton ${params.tone || 'pro décontracté'}.`,
        },
        examples: [
          { prospect: 'Entreprise A', value: 'Avec 45 personnes et 12 clients actifs, la gestion manuelle doit être un sacré casse-tête. Comment gérez-vous ça ?' },
          { prospect: 'Entreprise B', value: 'À 120 personnes, la coordination entre équipes coûte souvent plus qu\'on ne le pense. Un sujet chez vous ?' },
          { prospect: 'Entreprise C', value: 'Quand tout repose sur le dirigeant avec 20 personnes, chaque heure compte. C\'est votre quotidien ?' },
        ],
      },
    ],
  };

  return {
    raw: JSON.stringify(parsed, null, 2),
    parsed,
    usage: MOCK_USAGE,
  };
}

// =============================================
// Refinement Loop (dry-run)
// =============================================

function runRefinementLoop(campaignData, originalMessages, memory) {
  const analysis = analyzeCampaign(campaignData);
  const regeneration = regenerateSequence({
    diagnostic: analysis.diagnostic,
    originalMessages,
    memory,
    clientParams: {
      tone: campaignData.tone,
      formality: campaignData.formality,
      sector: campaignData.sector,
    },
  });

  return {
    analysis,
    regeneration,
    stepsRegenerated: analysis.parsed?.regenerationInstructions?.stepsToRegenerate || ['E3'],
    totalUsage: MOCK_USAGE,
  };
}

module.exports = {
  generateSequence,
  generateTouchpoint,
  analyzeCampaign,
  regenerateSequence,
  consolidateMemory,
  generateVariables,
  runRefinementLoop,
};
