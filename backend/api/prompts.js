/* ═══════════════════════════════════════════════════════════════════════════
   BAKAL — Prompt System
   Master Prompt + 7 Sub-Prompts + Variable Generator + Refinement Prompts
   ═══════════════════════════════════════════════════════════════════════════ */

// =============================================
// Master Prompt — Full Sequence Generation
// =============================================

function masterPrompt(params) {
  const {
    companyName = '',
    sector = '',
    position = '',
    size = '',
    channel = 'email',
    angle = 'Douleur client',
    tone = 'Pro décontracté',
    formality = 'Vous',
    length = 'Standard',
    cta = 'Question ouverte',
    valueProp = '',
    painPoints = '',
    socialProof = '',
    touchpointCount = 4,
    personalizationLevel = 'Standard',
    zone = '',
    language = 'fr',
    avoidWords = '',
    signaturePhrases = '',
    objections = '',
    documentContext = '',
  } = params;

  const channelInstructions = {
    email: `Génère une séquence EMAIL uniquement avec ${touchpointCount} touchpoints (E1 à E${touchpointCount}).`,
    linkedin: 'Génère une séquence LINKEDIN uniquement : L1 (note de connexion, max 300 chars) + L2 (message post-connexion).',
    multi: `Génère une séquence MULTI-CANAL avec ${touchpointCount} touchpoints au total, combinant email et LinkedIn. Structure recommandée : E1 (email initial) → L1 (note connexion LinkedIn) → E2 (email valeur) → L2 (message LinkedIn) → E3 (email relance) → E4 (email break-up). Adapte selon le nombre de touchpoints demandé.`,
  };

  return `Tu es un copywriter expert en prospection B2B multicanal (Email + LinkedIn).
Tu génères des séquences de prospection complètes, personnalisées et prêtes à l'emploi.

## Paramètres de la campagne

### Client
- Entreprise : ${companyName || '(service du prestataire)'}
- Proposition de valeur : ${valueProp || 'À déduire du contexte'}
- Preuve sociale : ${socialProof || 'Aucune fournie'}
- Douleurs cibles : ${painPoints || 'À déduire du secteur'}

### Cible
- Secteur : ${sector}
- Poste décideur : ${position}
- Taille entreprise : ${size}
- Zone géographique : ${zone || 'France'}

### Style
- Ton : ${tone}
- Formalité : ${formality === 'Tu' ? 'Tutoiement' : 'Vouvoiement'}
- Longueur : ${length}
- Langue : ${language === 'fr' ? 'Français' : 'English'}

${avoidWords ? `### Contraintes de vocabulaire\n- Mots/expressions à éviter : ${avoidWords}\n` : ''}${signaturePhrases ? `### Vocabulaire maison\n- Expressions à privilégier : ${signaturePhrases}\n` : ''}${objections ? `### Objections fréquentes à anticiper\n${objections}\n` : ''}${documentContext ? `### Contexte business (extraits de documents)\n${documentContext.slice(0, 4000)}\n` : ''}### Séquence
- Canal : ${channel}
- ${channelInstructions[channel] || channelInstructions.email}
- Angle d'approche : ${angle}
- Type de CTA : ${cta}
- Niveau de personnalisation : ${personalizationLevel}

## Structure des touchpoints

Chaque touchpoint doit suivre un rôle précis dans la séquence :

### Email Initial (E1)
- Objectif : Capter l'attention, établir la pertinence
- Structure : Hook personnalisé → Problème identifié → CTA léger
- Longueur : ${length === 'Court' ? '3-4 phrases' : length === 'Long' ? '6-8 phrases' : '4-6 phrases'}

### Email Valeur (E2)
- Objectif : Apporter une preuve concrète (case study, chiffre, résultat)
- Structure : Rappel contextuel → Preuve → Résultat → CTA
- Longueur : ${length === 'Court' ? '4-5 phrases' : length === 'Long' ? '7-9 phrases' : '5-7 phrases'}

### Email Relance (E3)
- Objectif : Changer d'angle, relancer sans répéter
- Structure : Nouvelle perspective → Question ou stat → CTA
- Longueur : ${length === 'Court' ? '3-4 phrases' : length === 'Long' ? '5-7 phrases' : '4-5 phrases'}

### Email Break-up (E4)
- Objectif : Dernier message, soft close, laisser la porte ouverte
- Structure : Message court, pas culpabilisant → Bénéfice rappelé → Porte ouverte
- Longueur : 3-4 phrases MAX (même si "Long" demandé)

### Note de connexion LinkedIn (L1)
- Max 300 caractères ABSOLUS (contrainte plateforme)
- JAMAIS de pitch commercial
- Trouver un point commun ou complimenter un aspect pro

### Message LinkedIn post-connexion (L2)
- Conversationnel, comme un vrai message LinkedIn
- Pas de copier-coller d'email
- CTA : question ouverte liée au métier du prospect

## Règles impératives

1. **Variables Lemlist** : Utilise UNIQUEMENT ces variables, préservées telles quelles :
   - {{firstName}}, {{lastName}}, {{companyName}}, {{jobTitle}}
2. **Jamais** mentionner "IA", "automatisé", "robot", "logiciel d'envoi"
3. **Jamais** de jargon marketing inaccessible au prospect
4. **Chaque email** doit avoir une ligne d'objet (subject) unique et accrocheuse
5. **Les objets** : max 50 caractères, pas de majuscules abusives, pas de ponctuation excessive
6. **Le ton** doit être cohérent sur toute la séquence
7. **La séquence** doit raconter une histoire progressive, pas des messages isolés

## Lignes d'objet — Règles spécifiques
- Variante A : directe, orientée bénéfice
- Variante B : curiosité ou question
- Pas de mots spam : "gratuit", "offre", "urgent", "dernière chance"
- Inclure {{firstName}} ou {{companyName}} dans au moins 1 objet sur 2

## Format de sortie JSON

\`\`\`json
{
  "sequence": [
    {
      "step": "E1",
      "type": "email",
      "label": "Email initial",
      "timing": "J+0",
      "subType": "Description courte de l'angle",
      "subject": "Ligne d'objet variante A",
      "subjectB": "Ligne d'objet variante B",
      "body": "Corps du message avec {{variables}}",
      "bodyB": "Variante B du corps (optionnel, si l'angle est différent)"
    }
  ],
  "strategy": "Explication en 2-3 phrases de la stratégie globale de la séquence",
  "hypotheses": [
    "Hypothèse 1 : ...",
    "Hypothèse 2 : ..."
  ]
}
\`\`\``;
}

// =============================================
// Sub-Prompts — Specialized per touchpoint type
// =============================================

const subPrompts = {
  emailInitial: (params) => `Tu es un copywriter B2B expert. Rédige un EMAIL INITIAL de prospection.

Contexte :
- Cible : ${params.position} dans le secteur ${params.sector}
- Taille entreprise : ${params.size}
- Angle : ${params.angle || 'Douleur client'}
- Ton : ${params.tone || 'Pro décontracté'}
- Formalité : ${params.formality || 'Vous'}
- Proposition de valeur : ${params.valueProp || 'À déduire'}
- Douleurs : ${params.painPoints || 'À déduire du secteur'}

Objectif : Capter l'attention dès la première phrase. Le prospect doit sentir que ce message est écrit POUR LUI.

Structure :
1. Hook personnalisé (1 phrase qui montre qu'on connaît son contexte)
2. Problème identifié (1-2 phrases)
3. CTA léger : ${params.cta || 'Question ouverte'}

Contraintes :
- Variables : {{firstName}}, {{lastName}}, {{companyName}}, {{jobTitle}}
- Ne JAMAIS mentionner IA/automatisation
- ${params.length === 'Court' ? '3-4 phrases max' : '4-6 phrases'}
- Ligne d'objet : max 50 chars, 2 variantes (A: directe, B: curiosité)

Format JSON :
{
  "subject": "Objet variante A",
  "subjectB": "Objet variante B",
  "body": "Corps du message",
  "hypothesis": "Ce qu'on teste avec ce message"
}`,

  emailValue: (params) => `Tu es un copywriter B2B expert. Rédige un EMAIL VALEUR (follow-up avec preuve).

Contexte :
- Cible : ${params.position} dans le secteur ${params.sector}
- Ton : ${params.tone || 'Pro décontracté'} / ${params.formality || 'Vous'}
- Preuve sociale : ${params.socialProof || 'Invente un cas réaliste pour ce secteur'}

Objectif : Apporter une preuve CONCRÈTE que ça marche. Chiffres, cas client, résultat mesurable.

Structure :
1. Rappel contextuel (1 phrase, pas "suite à mon dernier email")
2. Case study ou stat (2-3 phrases)
3. Résultat concret (chiffré)
4. CTA : question ouverte liée à leur situation

Contraintes :
- Variables : {{firstName}}, {{companyName}}
- Si pas de preuve sociale fournie, invente un cas RÉALISTE et CRÉDIBLE pour le secteur
- ${params.length === 'Court' ? '4-5 phrases' : '5-7 phrases'}

Format JSON :
{
  "subject": "Objet variante A",
  "subjectB": "Objet variante B",
  "body": "Corps du message",
  "hypothesis": "Ce qu'on teste"
}`,

  emailRelance: (params) => `Tu es un copywriter B2B expert. Rédige un EMAIL RELANCE (angle différent).

Contexte :
- Cible : ${params.position} dans le secteur ${params.sector}
- Ton : ${params.tone || 'Pro décontracté'} / ${params.formality || 'Vous'}
- Angle précédent : ${params.previousAngle || 'Douleur client'}

Objectif : Relancer SANS répéter. Changer complètement d'angle tout en gardant le même bénéfice.

Angles alternatifs à considérer :
- Si E1 était "douleur" → essayer "gain/opportunité"
- Si E1 était "stat/chiffre" → essayer "question provocante"
- Si E1 était "case study" → essayer "tendance du marché"

Structure :
1. Accroche nouvelle perspective (1 phrase)
2. Question ou stat surprenante (1-2 phrases)
3. Lien avec leur situation (1 phrase)
4. CTA

Contraintes :
- Variables : {{firstName}}, {{companyName}}
- Pas de "Suite à mes précédents emails..."
- ${params.length === 'Court' ? '3-4 phrases' : '4-5 phrases'}

Format JSON :
{
  "subject": "Objet variante A",
  "subjectB": "Objet variante B",
  "body": "Corps du message",
  "hypothesis": "Ce qu'on teste avec ce nouvel angle"
}`,

  emailBreakup: (params) => `Tu es un copywriter B2B expert. Rédige un EMAIL BREAK-UP (dernier message).

Contexte :
- Cible : ${params.position} dans le secteur ${params.sector}
- Ton : ${params.tone || 'Pro décontracté'} / ${params.formality || 'Vous'}

Objectif : Dernier message. Court, respectueux, pas culpabilisant. Laisser la porte ouverte.

Règles ABSOLUES :
- 3-4 phrases MAXIMUM (même si "Long" demandé ailleurs)
- JAMAIS culpabilisant ("vous n'avez pas répondu...")
- JAMAIS agressif ("dernière chance...")
- Un seul bénéfice rappelé en une phrase
- Porte ouverte sans insistance

Structure :
1. Signal de départ (1 phrase simple)
2. Bénéfice rappelé (1 phrase)
3. Porte ouverte (1 phrase)

Contraintes :
- Variables : {{firstName}}
- Max 4 phrases. Vraiment.

Format JSON :
{
  "subject": "Objet variante A",
  "subjectB": "Objet variante B",
  "body": "Corps du message",
  "hypothesis": "Ce qu'on teste"
}`,

  linkedinConnection: (params) => `Tu es un expert LinkedIn B2B. Rédige une NOTE DE CONNEXION.

Contexte :
- Cible : ${params.position} dans le secteur ${params.sector}
- Ton : ${params.tone || 'Pro décontracté'}

Règles ABSOLUES :
- MAX 300 CARACTÈRES (contrainte LinkedIn, pas négociable)
- ZÉRO pitch commercial
- Trouver un point commun professionnel ou complimenter un aspect de leur parcours
- Donner envie d'accepter la connexion, pas de répondre

Structure :
1. Mention d'un intérêt commun ou compliment pro (1 phrase)
2. Raison légère de se connecter (1 phrase)

Contraintes :
- Variables : {{firstName}}
- Compte les caractères. MAX 300.

Format JSON :
{
  "body": "Note de connexion (max 300 chars)",
  "bodyB": "Variante B",
  "charCount": 123,
  "hypothesis": "Ce qu'on teste"
}`,

  linkedinMessage: (params) => `Tu es un expert LinkedIn B2B. Rédige un MESSAGE POST-CONNEXION.

Contexte :
- Cible : ${params.position} dans le secteur ${params.sector}
- Ton : ${params.tone || 'Pro décontracté'} / ${params.formality || 'Vous'}
- Proposition de valeur : ${params.valueProp || 'À déduire'}

Objectif : Premier vrai échange après connexion. Conversationnel, comme un vrai message LinkedIn.

Règles :
- PAS un email copié-collé dans LinkedIn
- Conversationnel, court
- Remercier pour la connexion
- Apporter de la valeur ou poser une question liée à leur métier
- CTA : question ouverte liée à leur quotidien professionnel

Contraintes :
- Variables : {{firstName}}, {{companyName}}
- 3-5 phrases max

Format JSON :
{
  "body": "Message post-connexion",
  "bodyB": "Variante B",
  "hypothesis": "Ce qu'on teste"
}`,

  subjectLines: (params) => `Tu es un expert en lignes d'objet email B2B.

Contexte :
- Cible : ${params.position} dans le secteur ${params.sector}
- Ton : ${params.tone || 'Pro décontracté'}
- Nombre d'emails dans la séquence : ${params.emailCount || 4}

Génère 2 variantes (A et B) de ligne d'objet pour chaque email de la séquence.

Règles :
- Max 50 caractères par objet
- Variante A : directe, orientée bénéfice
- Variante B : curiosité, question, ou pattern interrupt
- Inclure {{firstName}} ou {{companyName}} dans au moins 50% des objets
- Pas de mots spam : "gratuit", "offre", "urgent", "promo"
- Pas de MAJUSCULES abusives
- Pas de ponctuation excessive (!!!, ???)

Format JSON :
{
  "subjects": [
    {
      "step": "E1",
      "variantA": "Objet A pour E1",
      "variantB": "Objet B pour E1",
      "hypothesisA": "Pourquoi cette approche",
      "hypothesisB": "Pourquoi cette approche"
    }
  ]
}`,
};

// =============================================
// Performance Analysis Prompt (Enhanced)
// =============================================

function analysisPrompt(campaignData) {
  const { name, sector, position, channel, sequence, stats } = campaignData;

  const touchpointStats = (sequence || []).map(tp => {
    const s = tp.open_rate !== undefined || tp.reply_rate !== undefined
      ? `${tp.step}: open=${tp.open_rate || 'N/A'}%, reply=${tp.reply_rate || 'N/A'}%, stop=${tp.stop_rate || 'N/A'}%${tp.accept_rate !== undefined ? `, accept=${tp.accept_rate}%` : ''}`
      : `${tp.step}: pas de stats`;
    return s;
  }).join('\n');

  return `Tu es un expert en optimisation de campagnes de prospection B2B multicanal.
Tu analyses les performances avec rigueur et fournis des recommandations actionnables.

## Campagne analysée
- Nom : ${name || 'Non spécifié'}
- Secteur : ${sector || 'Non spécifié'}
- Cible : ${position || 'Non spécifié'}
- Canal : ${channel || 'email'}
- Nb prospects : ${stats?.nbProspects || campaignData.nb_prospects || 'N/A'}
- Durée : ${stats?.daysRunning || 'N/A'} jours

## Stats globales
- Taux d'ouverture moyen : ${stats?.openRate || campaignData.open_rate || 'N/A'}%
- Taux de réponse moyen : ${stats?.replyRate || campaignData.reply_rate || 'N/A'}%
- Taux d'acceptation LK : ${stats?.acceptRateLk || campaignData.accept_rate_lk || 'N/A'}%
- Taux de réponse LK : ${stats?.replyRateLk || campaignData.reply_rate_lk || 'N/A'}%
- Intéressés : ${stats?.interested || campaignData.interested || 0}
- RDV obtenus : ${stats?.meetings || campaignData.meetings || 0}

## Stats par touchpoint
${touchpointStats || 'Aucune stat par touchpoint disponible'}

## Benchmarks de référence
| Métrique | Bon | Moyen | Problème |
|----------|-----|-------|----------|
| Ouverture email | >50% | 30-50% | <30% |
| Réponse email | >5% | 2-5% | <2% |
| Acceptation LinkedIn | >30% | 15-30% | <15% |
| Réponse LinkedIn | >10% | 5-10% | <5% |

## Ta mission

Fournis un diagnostic structuré en JSON :

\`\`\`json
{
  "summary": "Résumé global en 2-3 phrases",
  "overallScore": "bon|moyen|problème",
  "touchpointAnalysis": [
    {
      "step": "E1",
      "score": "bon|moyen|problème",
      "diagnosis": "Ce qui va / ce qui ne va pas",
      "rootCause": "Cause probable du problème",
      "action": "regenerate|keep|monitor",
      "priority": 1
    }
  ],
  "priorities": [
    {
      "step": "E3",
      "priority": 1,
      "issue": "Description du problème",
      "recommendation": "Action recommandée",
      "expectedImpact": "+X pts estimés"
    }
  ],
  "regenerationInstructions": {
    "stepsToRegenerate": ["E3", "E4"],
    "globalDirection": "Direction générale pour la régénération",
    "perStep": {
      "E3": "Instructions spécifiques pour E3",
      "E4": "Instructions spécifiques pour E4"
    }
  }
}
\`\`\``;
}

// =============================================
// Regeneration Prompt (Enhanced)
// =============================================

function regenerationPrompt(params) {
  const {
    diagnostic,
    originalMessages,
    memory,
    clientParams = {},
    regenerationInstructions,
  } = params;

  const memorySection = memory && memory.length > 0
    ? `## Mémoire Cross-Campagne (patterns connus)
${memory.map(m => `- [${m.confidence || 'N/A'}] ${m.category}: ${m.pattern} — ${m.data || ''}`).join('\n')}`
    : '## Mémoire Cross-Campagne\nAucun pattern enregistré pour l\'instant.';

  const instructionsSection = regenerationInstructions
    ? `## Instructions de régénération du diagnostic
- Direction : ${regenerationInstructions.globalDirection || 'Améliorer les performances'}
- Steps à régénérer : ${(regenerationInstructions.stepsToRegenerate || []).join(', ')}
${Object.entries(regenerationInstructions.perStep || {}).map(([step, instr]) => `- ${step} : ${instr}`).join('\n')}`
    : '';

  return `Tu es un copywriter expert en prospection B2B.
Tu régénères des messages d'outreach en tenant compte du diagnostic de performance ET de la mémoire cross-campagne.

## Diagnostic
${typeof diagnostic === 'string' ? diagnostic : JSON.stringify(diagnostic, null, 2)}

${instructionsSection}

## Messages originaux
${JSON.stringify(originalMessages, null, 2)}

${memorySection}

## Paramètres du client
- Ton : ${clientParams.tone || 'Pro décontracté'}
- Formalité : ${clientParams.formality || 'Vous'}
- Longueur : ${clientParams.length || 'Standard'}
- Secteur : ${clientParams.sector || 'Non spécifié'}

## Règles impératives
1. Préserve les variables Lemlist : {{firstName}}, {{lastName}}, {{companyName}}, {{jobTitle}}
2. Ne mentionne JAMAIS "IA", "automatisé", "robot"
3. Notes de connexion LinkedIn : max 300 caractères
4. Emails de break-up : 3-4 lignes max, jamais culpabilisant
5. Génère TOUJOURS une variante A et B pour chaque message modifié
6. Chaque variante doit avoir une HYPOTHÈSE CLAIRE et TESTABLE
7. Intègre les patterns de la mémoire cross-campagne quand ils sont pertinents
8. Si un pattern haute confiance contredit le diagnostic, signale-le

## Format de sortie JSON

\`\`\`json
{
  "messages": [
    {
      "step": "E1",
      "action": "regenerated|kept|tweaked",
      "variantA": {
        "subject": "Nouvelle ligne d'objet A",
        "body": "Nouveau corps du message A",
        "hypothesis": "Ce qu'on teste avec cette variante"
      },
      "variantB": {
        "subject": "Nouvelle ligne d'objet B",
        "body": "Nouveau corps du message B",
        "hypothesis": "Ce qu'on teste avec cette variante"
      },
      "changes": "Résumé des modifications par rapport à l'original",
      "memoryUsed": ["Pattern X utilisé parce que..."]
    }
  ],
  "summary": "Résumé global des changements",
  "hypotheses": [
    "Hypothèse 1 : ...",
    "Hypothèse 2 : ..."
  ],
  "expectedImpact": "Impact estimé sur les métriques"
}
\`\`\``;
}

// =============================================
// Cross-Campaign Memory Consolidation (Enhanced)
// =============================================

function memoryConsolidationPrompt(diagnostics, existingMemory) {
  return `Tu es un analyste de données spécialisé en prospection B2B.
Tu consolides les diagnostics de campagnes pour extraire des patterns récurrents et actionnables.

## Diagnostics du mois
${JSON.stringify(diagnostics, null, 2)}

## Mémoire existante
${JSON.stringify(existingMemory, null, 2)}

## Niveaux de confiance
- **Haute** : pattern observé sur >200 prospects ou confirmé par 3+ campagnes
- **Moyenne** : observé sur 50-200 prospects ou confirmé par 2 campagnes
- **Faible** : observé sur <50 prospects ou 1 seule campagne

## Catégories de patterns
- **Objets** : ce qui marche/ne marche pas dans les lignes d'objet email
- **Corps** : patterns dans le contenu des messages (longueur, structure, CTA)
- **Timing** : meilleurs jours/heures, espacement optimal entre touchpoints
- **LinkedIn** : spécificités LinkedIn (notes, messages, taux d'acceptation)
- **Secteur** : ce qui fonctionne par industrie
- **Cible** : ce qui fonctionne par type de décideur (DAF, DRH, Dirigeant...)

## Ta mission
1. Analyse tous les diagnostics du mois
2. Identifie les patterns récurrents (positifs ET négatifs)
3. Compare avec la mémoire existante : confirmer, ajuster la confiance, ou ajouter
4. Si un pattern existant est contredit par de nouvelles données, signale-le

## Format de sortie JSON

\`\`\`json
{
  "patterns": [
    {
      "categorie": "Objets",
      "pattern": "Description courte du pattern",
      "donnees": "Explication détaillée avec données chiffrées",
      "confiance": "Haute|Moyenne|Faible",
      "secteurs": ["Secteur1"],
      "cibles": ["Cible1"],
      "isNew": true,
      "confirmsExisting": null
    }
  ],
  "updatedPatterns": [
    {
      "existingId": 123,
      "newConfidence": "Haute",
      "reason": "Confirmé par 2 nouvelles campagnes"
    }
  ],
  "contradictions": [
    {
      "existingPattern": "Description",
      "newEvidence": "Ce qui contredit",
      "recommendation": "Garder / Modifier / Supprimer"
    }
  ],
  "summary": "Résumé des découvertes du mois"
}
\`\`\``;
}

// =============================================
// Variable Chain Generator
// =============================================

function variableGeneratorPrompt(params) {
  const {
    sector = '',
    position = '',
    angle = '',
    valueProp = '',
    painPoints = '',
    channels = 'email',
  } = params;

  return `Tu es un expert en prospection B2B et en personnalisation de campagnes outbound.

## Contexte campagne
- Industrie : ${sector}
- Cible : ${position}
- Angle de campagne : ${angle}
- Proposition de valeur : ${valueProp || 'Non spécifiée'}
- Douleurs identifiées : ${painPoints || 'Non spécifiées'}
- Canaux : ${channels}

## Ta mission

Analyse ce contexte et propose une **chaîne de 2 à 4 variables personnalisées** qui vont au-delà des variables standard (firstName, companyName, jobTitle).

Pour chaque variable, fournis :

### 1. Variables de base (données brutes collectables)
- **Nom** : en camelCase, descriptif
- **Ce que c'est** : description en 1 ligne
- **Pourquoi elle compte** : en quoi cette donnée est stratégique pour CETTE industrie
- **Où la trouver** : source(s) concrète(s)
- **3 exemples** : pour des prospects réalistes du secteur

### 2. Variables enrichies (déduites par IA)
- **Nom** : en camelCase
- **Dépend de** : quelle(s) variable(s) base
- **Logique de dérivation** : comment l'IA déduit cette valeur
- **3 exemples** : montrant la déduction

### 3. Variable dérivée finale (icebreaker)
- **Nom** : en camelCase, finissant par "Icebreaker"
- **Dépend de** : les variables qu'elle combine
- **Prompt de combinaison** : instruction précise pour générer l'icebreaker
- **3 exemples** : montrant le résultat final

## Contraintes
- Les variables doivent être **spécifiques à l'industrie**
- L'icebreaker final doit **prouver une connaissance du métier**
- Chaque variable doit être **collectable ou calculable** en pratique
- Max 2 phrases pour l'icebreaker
- Préserver les variables Lemlist : {{firstName}}, {{lastName}}, {{companyName}}, {{jobTitle}}

## Format de réponse JSON

\`\`\`json
{
  "reasoning": "Explication en 2-3 phrases de POURQUOI ces variables sont stratégiques...",
  "chain": [
    {
      "key": "variableName",
      "label": "Nom lisible",
      "type": "base",
      "desc": "Description courte",
      "source": {
        "icon": "magnifier|robot|brain",
        "label": "Source de la donnée"
      },
      "dependsOn": [],
      "derivationHint": null,
      "formula": null,
      "examples": [
        { "prospect": "Nom du prospect", "value": "Valeur exemple" }
      ]
    }
  ]
}
\`\`\``;
}

// =============================================
// Icebreaker Execution Prompt (per-prospect)
// =============================================

function icebreakerExecutionPrompt(params) {
  const { variables, formulaPrompt, tone, formality } = params;

  return `Tu génères un icebreaker personnalisé pour un prospect dans le cadre d'une campagne de prospection B2B.

## Variables disponibles
${Object.entries(variables).map(([k, v]) => `- {{${k}}} = ${v}`).join('\n')}

## Instruction de combinaison
${formulaPrompt}

## Contraintes
- Maximum 2 phrases
- Ton : ${tone || 'Pro décontracté'}
- Formulation : ${formality || 'Vous'}
- L'icebreaker doit montrer une connaissance du MÉTIER, pas juste du prospect
- Ne pas mentionner l'IA, l'automatisation, ou que l'info a été "recherchée"
- Doit se lire comme une remarque naturelle d'un expert du secteur

Génère UNIQUEMENT l'icebreaker, rien d'autre.`;
}

module.exports = {
  masterPrompt,
  subPrompts,
  analysisPrompt,
  regenerationPrompt,
  memoryConsolidationPrompt,
  variableGeneratorPrompt,
  icebreakerExecutionPrompt,
};
