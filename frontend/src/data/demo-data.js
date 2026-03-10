export const DEMO_DATA = {
  projects: {
    'formapro': {
      id: 'formapro',
      name: 'FormaPro Consulting',
      client: 'FormaPro Consulting',
      description: 'Prospection multi-cible pour cabinet de formation professionnelle',
      color: 'var(--blue)',
      createdDate: '20 jan. 2026',
      campaignIds: ['daf-idf', 'dirigeants-formation', 'drh-lyon'],
      files: [
        { id: 'f1', name: 'brief-formapro.pdf', type: 'application/pdf', size: 245000, uploadedAt: '2026-01-20T10:30:00Z', category: 'brief' },
        { id: 'f2', name: 'personas-cibles.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 89000, uploadedAt: '2026-01-21T14:15:00Z', category: 'persona' },
        { id: 'f3', name: 'ton-de-voix.md', type: 'text/markdown', size: 12400, uploadedAt: '2026-01-22T09:00:00Z', category: 'guidelines' }
      ]
    },
    'techvision': {
      id: 'techvision',
      name: 'TechVision SaaS',
      client: 'TechVision',
      description: 'Lancement produit SaaS — acquisition early adopters B2B',
      color: 'var(--purple)',
      createdDate: '5 fév. 2026',
      campaignIds: [],
      files: []
    }
  },
  campaigns: {
    'daf-idf': {
      id: 'daf-idf',
      name: 'DAF Île-de-France',
      client: 'FormaPro Consulting',
      projectId: 'formapro',
      status: 'active',
      channel: 'email',
      channelLabel: '✉️ Email',
      channelColor: 'var(--blue)',
      sector: 'Comptabilité & Finance',
      sectorShort: 'Comptabilité',
      position: 'DAF',
      size: '11-50 sal.',
      angle: 'Douleur client',
      zone: 'Île-de-France',
      tone: 'Pro décontracté',
      formality: 'Vous',
      length: 'Court (3 phrases)',
      cta: 'Question ouverte',
      volume: { sent: 250, planned: 300 },
      iteration: 4,
      startDate: '27 jan.',
      lemlistRef: 'campaign_daf_idf_v4',
      nextAction: { type: 'testing', text: 'Test A/B v4 en cours — Résultat attendu le 23 fév.' },
      kpis: { contacts: 250, openRate: 68, replyRate: 9.2, interested: 6, meetings: 3 },
      sequence: [
        { id: 'E1', type: 'email', label: 'Email initial', timing: 'J+0', subType: 'Angle douleur client', subject: '{{firstName}}, une question sur votre gestion financière', body: "Bonjour {{firstName}}, combien d'heures par semaine votre équipe passe-t-elle sur des tâches qui pourraient être automatisées ? Chez {{companyName}}, les cabinets comme le vôtre gagnent en moyenne 12h/semaine...", stats: { open: 68, reply: 4.2, stop: 0.4 } },
        { id: 'E2', type: 'email', label: 'Email valeur', timing: 'J+3', subType: 'Case study', subject: 'Re: gestion financière — un cas concret', body: "{{firstName}}, je me permets de revenir avec un exemple concret. Le cabinet Nexia Conseil (35 personnes, secteur similaire) a réduit de 40% le temps de reporting...", stats: { open: 72, reply: 3.1, stop: 0.8 } },
        { id: 'E3', type: 'email', label: 'Email relance', timing: 'J+7', subType: 'Angle différent', subject: 'Autre approche, {{firstName}}', body: "{{firstName}}, je change d'approche. Plutôt que de parler d'automatisation, une question simple : quel est le coût réel d'une erreur de saisie dans un bilan chez {{companyName}} ?...", stats: { open: 55, reply: 1.4, stop: 0 } },
        { id: 'E4', type: 'email', label: 'Email break-up', timing: 'J+12', subType: 'Soft close', subject: 'Dernière tentative, {{firstName}}', body: "{{firstName}}, je ne veux pas encombrer votre boîte. Si ce n'est pas le bon moment, pas de souci — je ne reviendrai pas. Juste un dernier mot : si un jour 12h/semaine récupérées...", stats: { open: 48, reply: 0.5, stop: 0 } }
      ],
      diagnostics: [
        { step: 'E1', level: 'success', title: '✅ E1 — Performant', text: "L'objet personnalisé avec {{firstName}} et la question directe fonctionnent très bien. Taux d'ouverture de 68% au-dessus du benchmark (50%). Le CTA question ouverte génère un bon taux de réponse (4.2%)." },
        { step: 'E2', level: 'success', title: '✅ E2 — Fort potentiel', text: "Le \"Re:\" dans l'objet booste l'ouverture à 72% (effet thread). Le case study concret avec des chiffres (40% de réduction) crédibilise le message. Bon ratio réponse/ouverture." },
        { step: 'E3', level: 'warning', title: '⚡ E3 — À optimiser', text: "Baisse significative d'ouverture (55%) et de réponse (1.4%). L'angle \"coût de l'erreur\" peut être perçu comme anxiogène. <strong>Recommandation :</strong> tester un angle \"gain de temps\" plus positif, raccourcir à 2 phrases max." },
        { step: 'E4', level: 'blue', title: '📊 E4 — Normal pour un break-up', text: "Taux d'ouverture de 48% correct pour un dernier email. Le ton respectueux (\"je ne reviendrai pas\") évite la pression. Aucune modification nécessaire." }
      ],
      history: [
        { version: 'v4', title: 'Test A/B: Douleur vs Douleur+Urgence', desc: "Variante B avec angle urgence + objet provocant. Meilleure ouverture mais moins de conversion en RDV.", result: 'testing', resultText: '⏳ En cours', date: '17 fév.' },
        { version: 'v3', title: 'Passage angle douleur client sur E1 et E3', desc: "Remplacement preuve sociale par douleur client + CTA question ouverte.", result: 'improved', resultText: '▲ +3.2pts réponse', date: '10 fév.' },
        { version: 'v2', title: 'Optimisation objets email (A/B)', desc: '"Question rapide sur [secteur]" vs ancien objet générique. Personnalisé gagnant.', result: 'improved', resultText: '▲ +8pts ouverture', date: '3 fév.' },
        { version: 'v1', title: 'Lancement initial', desc: '4 emails, angle preuve sociale, CTA proposition de call, ton formel. 100 prospects.', result: 'neutral', resultText: '— Baseline', date: '27 jan.' }
      ],
      info: { period: '27 jan. → En cours (28 jours)', copyDesc: 'Pro décontracté · Vous · Court (3 phrases) · CTA question ouverte · FR' }
    },
    'dirigeants-formation': {
      id: 'dirigeants-formation',
      name: 'Dirigeants Formation',
      client: 'FormaPro Consulting',
      projectId: 'formapro',
      status: 'active',
      channel: 'linkedin',
      channelLabel: '💼 LinkedIn',
      channelColor: 'var(--purple)',
      sector: 'Formation & Éducation',
      sectorShort: 'Formation',
      position: 'Dirigeant',
      size: '1-10 sal.',
      angle: 'Preuve sociale',
      zone: 'France entière',
      tone: 'Pro décontracté',
      formality: 'Vous',
      length: 'Court',
      cta: 'Question ouverte',
      volume: { sent: 152, planned: 200 },
      iteration: 2,
      startDate: '3 fév.',
      lemlistRef: null,
      nextAction: { type: 'warning', text: 'Recommandation IA en attente — Changer l\'angle L2' },
      kpis: { contacts: 152, acceptRate: 38, replyRate: 6.8, interested: 3, meetings: 1 },
      sequence: [
        { id: 'L1', type: 'linkedin', label: 'Note de connexion', timing: 'J+0', subType: 'Max 300 caractères', subject: null, body: "{{firstName}}, votre parcours dans la formation m'a interpellé. J'accompagne des dirigeants du secteur sur la croissance commerciale — je serais ravi d'échanger avec vous.", maxChars: 300, stats: { accept: 38 } },
        { id: 'L2', type: 'linkedin', label: 'Message post-connexion', timing: 'J+3', subType: 'Conversationnel', subject: null, body: "Merci d'avoir accepté, {{firstName}} !\n\nJ'ai accompagné 3 organismes de formation comme le vôtre à générer entre 5 et 12 RDV qualifiés par mois.\n\nCurieux de savoir comment vous gérez votre développement commercial actuellement ?", stats: { reply: 6.8, interested: 3, stop: 1.2 } }
      ],
      diagnostics: [
        { step: 'L1', level: 'success', title: "✅ L1 — Bon taux d'acceptation", text: "38% d'acceptation au-dessus du benchmark LinkedIn (30%). Le compliment sur le parcours + positionnement sectoriel fonctionne bien. Pas de pitch dans l'invite = bonne pratique." },
        { step: 'L2', level: 'warning', title: "⚡ L2 — Réponse sous l'objectif", text: "6.8% de réponse vs objectif de 8%. Le \"3 organismes de formation\" manque de spécificité. <strong>Recommandation :</strong> remplacer l'angle preuve sociale par douleur client. Tester : \"Quel est votre plus gros frein à trouver de nouveaux clients en ce moment ?\"" }
      ],
      history: [
        { version: 'v2', title: 'Personnalisation note de connexion', desc: "Ajout compliment parcours + mention secteur formation. Suppression du lien externe.", result: 'improved', resultText: '▲ +8pts acceptation', date: '10 fév.' },
        { version: 'v1', title: 'Lancement initial', desc: "Note de connexion générique + message preuve sociale. 80 premiers prospects.", result: 'neutral', resultText: '— Baseline', date: '3 fév.' }
      ],
      info: { period: '3 fév. → En cours (20 jours)', copyDesc: 'Pro décontracté · Vous · Court · CTA question ouverte · FR' }
    },
    'drh-lyon': {
      id: 'drh-lyon',
      name: 'DRH PME Lyon',
      client: 'FormaPro Consulting',
      projectId: 'formapro',
      status: 'prep',
      channel: 'multi',
      channelLabel: '📧+💼 Multi',
      channelColor: 'var(--orange)',
      sector: 'Conseil & Consulting',
      sectorShort: 'Conseil',
      position: 'DRH',
      size: '51-200 sal.',
      angle: 'Offre directe',
      zone: 'Lyon & Rhône-Alpes',
      tone: 'Formel & Corporate',
      formality: 'Vous',
      length: 'Standard',
      cta: 'Proposition de call',
      volume: { sent: 0, planned: 187 },
      iteration: 0,
      startDate: '18 fév.',
      lemlistRef: null,
      nextAction: null,
      kpis: { contacts: 187, openRate: null, replyRate: null, interested: null, meetings: null },
      sequence: [
        { id: 'E1', type: 'email', label: 'Email initial', timing: 'J+0', subType: 'Offre directe', subject: '{{firstName}}, une solution concrète pour vos recrutements', body: "Bonjour {{firstName}}, nous aidons des DRH de PME comme {{companyName}} à réduire de 40% leur temps de recrutement. Seriez-vous disponible 15 minutes cette semaine ?", stats: null },
        { id: 'L1', type: 'linkedin', label: 'Note de connexion LinkedIn', timing: 'J+1', subType: 'Max 300 chars', subject: null, body: "{{firstName}}, votre expertise RH chez {{companyName}} m'a interpellé. J'échange régulièrement avec des DRH de PME lyonnaises — je serais ravi de vous compter dans mon réseau.", maxChars: 300, stats: null },
        { id: 'E2', type: 'email', label: 'Email valeur', timing: 'J+4', subType: 'Case study', subject: 'Re: recrutements — un résultat qui parle', body: "{{firstName}}, un exemple concret : une PME de conseil RH (180 personnes, Lyon) a divisé par 2 ses délais de recrutement en 3 mois...", stats: null },
        { id: 'L2', type: 'linkedin', label: 'Message LinkedIn', timing: 'J+5', subType: 'Post-connexion', subject: null, body: "Merci d'avoir accepté, {{firstName}} ! J'accompagne des PME lyonnaises sur l'optimisation RH...", stats: null },
        { id: 'E3', type: 'email', label: 'Email relance', timing: 'J+8', subType: 'Angle différent', subject: null, body: "{{firstName}}, une autre manière de voir les choses : combien vous coûte un recrutement raté chez {{companyName}} ?...", stats: null },
        { id: 'E4', type: 'email', label: 'Email break-up', timing: 'J+13', subType: 'Soft close', subject: null, body: "{{firstName}}, dernier message de ma part. Si le timing n'est pas bon, aucun souci...", stats: null }
      ],
      diagnostics: [],
      prepChecklist: [
        { icon: '✅', title: 'Paramètres de campagne configurés', desc: 'Cible, canal, angle, ton — tout est défini', status: 'Fait', statusColor: 'success', done: true },
        { icon: '✅', title: 'Séquences générées par Claude', desc: '4 emails + 2 LinkedIn · Angle offre directe · Ton formel', status: 'Fait', statusColor: 'success', done: true },
        { icon: '✅', title: 'Liste de prospects importée', desc: '187 contacts DRH · PME 51-200 sal. · Lyon & Rhône-Alpes', status: 'Fait', statusColor: 'success', done: true },
        { icon: '⏳', title: 'Validation des séquences par le client', desc: 'En attente de relecture — envoyé le 20 fév.', status: 'En attente', statusColor: 'warning', done: false, highlight: true },
        { icon: '⬜', title: 'Déploiement sur Lemlist', desc: 'Automatique après validation client', status: 'À faire', statusColor: 'text-muted', done: false }
      ],
      preLaunchReco: {
        text: "<strong>Alerte :</strong> L'angle \"offre directe\" avec CTA \"15 minutes cette semaine\" est agressif pour un premier contact DRH. Vos données montrent que les <strong>questions ouvertes</strong> convertissent 2x mieux que les propositions de call directes.<br><br><strong>Suggestion :</strong> Modifier E1 pour utiliser un CTA question (\"Quel est votre plus gros défi recrutement en ce moment ?\") et réserver la proposition de call pour E2. Gain estimé : +2-3pts de taux de réponse."
      },
      history: [],
      info: { period: '18 février 2026', createdDate: '18 février 2026', volumeDesc: '187 prospects · ~100/semaine', copyDesc: 'Formel & Corporate · Vous · CTA offre directe · FR', channelsDesc: 'Email (4) + LinkedIn (2) · 13 jours', launchEstimate: '~25 février (après validation)' }
    }
  },
  globalKpis: {
    contacts: { value: 247, trend: '▲ 12% vs S-1', direction: 'up' },
    openRate: { value: '62%', trend: '▲ 4pts', direction: 'up' },
    replyRate: { value: '8.1%', trend: '▲ 1.3pts', direction: 'up' },
    interested: { value: 5, trend: '▲ 2 cette semaine', direction: 'up' },
    meetings: { value: 3, trend: '▲ Objectif atteint', direction: 'up' },
    stops: { value: '1.2%', trend: '✓ Sous le seuil', direction: 'up' }
  },
  opportunities: [
    { name: 'Sophie Martin', title: 'DAF', company: 'Nexia Conseil', size: '35 sal.', status: 'Call planifié', statusColor: 'var(--success)', statusBg: 'rgba(0,214,143,0.1)', timing: 'Demain 14h' },
    { name: 'Thomas Durand', title: 'CEO', company: 'FormaPlus', size: '8 sal.', status: 'Intéressé', statusColor: 'var(--warning)', statusBg: 'var(--warning-bg)', timing: 'Relance vendredi' },
    { name: 'Marc Lefèvre', title: 'DG', company: 'Audit Express', size: '22 sal.', status: 'Intéressé', statusColor: 'var(--warning)', statusBg: 'var(--warning-bg)', timing: 'Attente réponse' }
  ],
  recommendations: [
    { level: 'success', label: '✅ Appliquer — Impact fort', text: "L'angle \"douleur client\" surperforme (+3.2pts de réponse vs preuve sociale). Recommandation : basculer la campagne LinkedIn sur cet angle." },
    { level: 'warning', label: '💡 Tester — Opportunité', text: "Le segment \"Dirigeant / 1-10 sal.\" a un taux de réponse de 11.3%. Lancer une campagne dédiée sur cette cible." },
    { level: 'blue', label: '📊 Insight', text: "Les emails envoyés le mardi matin (9h-10h) ont 15% d'ouvertures en plus. Ajuster le planning d'envoi." }
  ],
  reports: [
    { week: 'Semaine 4 — Rapport consolidé', dateRange: '10 — 16 février 2026', score: 'excellent', scoreLabel: '🚀 Excellent', metrics: { contacts: 247, openRate: '62%', replyRate: '8.1%', interested: 5, meetings: 3 }, synthesis: "<strong>Performance globale en hausse.</strong> La campagne \"DAF Île-de-France\" est votre meilleure performeuse cette semaine avec 9.2% de taux de réponse (+2.1pts vs S3). L'angle \"douleur client\" continue de surperformer sur le segment comptabilité. La campagne LinkedIn \"Dirigeants Formation\" progresse mais reste sous les objectifs de réponse (6.8% vs 8% cible).<br><br><strong>Canaux :</strong> L'email reste le canal le plus efficace (62% d'ouverture). LinkedIn montre un potentiel de conversion supérieur (ratio réponse→RDV de 33% vs 22% par email).<br><br><strong>Prochaine action recommandée :</strong> Lancer une campagne hybride Email+LinkedIn sur le segment \"Dirigeants PME 11-50\" qui combine le reach email et la conversion LinkedIn." },
    { week: 'Semaine 3', dateRange: '3 — 9 février 2026', score: 'good', scoreLabel: '🟢 Performant', metrics: { contacts: 220, openRate: '58%', replyRate: '6.8%', interested: 3, meetings: 2 }, synthesis: "Bonne progression du taux d'ouverture grâce à l'optimisation des objets d'email (A/B test gagné : \"Question rapide sur [secteur]\" +8pts vs ancien objet). Le segment comptabilité confirme son potentiel. Recommandation appliquée S2 (changement d'angle) porte ses fruits." },
    { week: 'Semaine 2', dateRange: '27 jan. — 2 fév. 2026', score: 'ok', scoreLabel: '🟡 Correct', metrics: { contacts: 185, openRate: '51%', replyRate: '5.2%', interested: 2, meetings: 1 }, synthesis: "Démarrage solide. Les taux sont dans la moyenne du marché B2B. L'angle \"preuve sociale\" fonctionne moins bien que prévu sur le segment Formation. Recommandation : tester l'angle \"douleur client\" sur la prochaine séquence." }
  ],
  chartData: [
    { label: 'S1', email: 40, linkedin: 25 },
    { label: 'S2', email: 52, linkedin: 38 },
    { label: 'S3', email: 58, linkedin: 45 },
    { label: 'S4', email: 78, linkedin: 55 }
  ]
}

