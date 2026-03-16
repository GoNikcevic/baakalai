/* ═══════════════════════════════════════════════════════════════════════════
   BAKAL — Centralized Campaigns Data Layer
   Single source of truth for all campaign data across the dashboard.
   Supports both populated (demo) and empty (new user) states.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ═══ Demo data backup (used for toggle) ═══ */
const BAKAL_DEMO_DATA = {
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
};


/* ═══ Live data object — starts with demo, toggled to empty for new-user mode ═══ */
const BAKAL = {
  projects: {},
  campaigns: {},
  globalKpis: {},
  opportunities: [],
  recommendations: [],
  reports: [],
  chartData: []
};

/* Track current mode: 'demo' | 'empty' | 'live' */
let _demoMode = true;
let _backendAvailable = false;


/* ═══════════════════════════════════════════════════════════════════════════
   UTILITY — Check if dashboard has data
   ═══════════════════════════════════════════════════════════════════════════ */

function isEmptyDashboard() {
  return Object.keys(BAKAL.campaigns).length === 0;
}


/* ═══════════════════════════════════════════════════════════════════════════
   DEMO TOGGLE — Switch between new-user and populated states
   ═══════════════════════════════════════════════════════════════════════════ */

function loadDemoData() {
  // Deep-copy demo data into BAKAL
  BAKAL.projects = JSON.parse(JSON.stringify(BAKAL_DEMO_DATA.projects));
  BAKAL.campaigns = JSON.parse(JSON.stringify(BAKAL_DEMO_DATA.campaigns));
  BAKAL.globalKpis = JSON.parse(JSON.stringify(BAKAL_DEMO_DATA.globalKpis));
  BAKAL.opportunities = JSON.parse(JSON.stringify(BAKAL_DEMO_DATA.opportunities));
  BAKAL.recommendations = JSON.parse(JSON.stringify(BAKAL_DEMO_DATA.recommendations));
  BAKAL.reports = JSON.parse(JSON.stringify(BAKAL_DEMO_DATA.reports));
  BAKAL.chartData = JSON.parse(JSON.stringify(BAKAL_DEMO_DATA.chartData));
}

function clearData() {
  BAKAL.projects = {};
  BAKAL.campaigns = {};
  BAKAL.globalKpis = {};
  BAKAL.opportunities = [];
  BAKAL.recommendations = [];
  BAKAL.reports = [];
  BAKAL.chartData = [];
}

/* ═══ Backend Data Loading ═══ */

async function loadFromBackend() {
  if (typeof BakalAPI === 'undefined') return false;

  try {
    const health = await BakalAPI.checkHealth();
    if (!health) return false;

    _backendAvailable = true;

    // Fetch all data in parallel
    const [campaigns, kpis, projects, opportunities, reports, chartData] = await Promise.all([
      BakalAPI.fetchAllCampaigns().catch(() => ({})),
      BakalAPI.fetchDashboard().catch(() => ({})),
      BakalAPI.fetchProjects().catch(() => ({})),
      BakalAPI.fetchOpportunities().catch(() => []),
      BakalAPI.fetchReports().catch(() => []),
      BakalAPI.fetchChartData().catch(() => []),
    ]);

    // If backend has data, use it
    if (Object.keys(campaigns).length > 0) {
      BAKAL.campaigns = campaigns;
      BAKAL.globalKpis = kpis;
      BAKAL.projects = Object.keys(projects).length > 0 ? projects : JSON.parse(JSON.stringify(BAKAL_DEMO_DATA.projects));

      // Link campaigns to projects
      for (const [pid, proj] of Object.entries(BAKAL.projects)) {
        proj.campaignIds = Object.values(BAKAL.campaigns)
          .filter(c => c.projectId === pid)
          .map(c => c.id);
      }

      // Use real data if available, demo data as fallback
      BAKAL.opportunities = opportunities.length > 0
        ? opportunities
        : JSON.parse(JSON.stringify(BAKAL_DEMO_DATA.opportunities));
      BAKAL.recommendations = JSON.parse(JSON.stringify(BAKAL_DEMO_DATA.recommendations));
      BAKAL.reports = reports.length > 0
        ? reports
        : JSON.parse(JSON.stringify(BAKAL_DEMO_DATA.reports));
      BAKAL.chartData = chartData.length > 0
        ? chartData
        : JSON.parse(JSON.stringify(BAKAL_DEMO_DATA.chartData));
      return true;
    }

    // Backend reachable but empty — return false so demo/empty toggle still works
    return false;
  } catch (err) {
    console.warn('Backend not available, using local data:', err.message);
    return false;
  }
}

/** Fetch full detail for a single campaign from backend and update BAKAL */
async function refreshCampaignFromBackend(campaignId) {
  if (!_backendAvailable || typeof BakalAPI === 'undefined') return;
  try {
    const detail = await BakalAPI.fetchCampaignDetail(campaignId);
    if (detail) {
      BAKAL.campaigns[detail.id] = detail;
    }
  } catch (err) {
    console.warn('Failed to refresh campaign:', err.message);
  }
}

function toggleDemoMode() {
  _demoMode = !_demoMode;
  const toggle = document.getElementById('demoToggle');
  const label = document.getElementById('demoToggleLabel');

  if (_demoMode) {
    loadDemoData();
    toggle.classList.add('active');
    label.textContent = 'Données démo';
  } else {
    clearData();
    toggle.classList.remove('active');
    label.textContent = 'Nouvel utilisateur';
  }

  initFromData();

  // Re-navigate to current section
  showSection('overview');
}

/** Initialize data: try backend first, fall back to demo */
async function initData() {
  const hasBackendData = await loadFromBackend();

  if (hasBackendData) {
    // Backend had real campaigns — use them
    _demoMode = false;
    const toggle = document.getElementById('demoToggle');
    const label = document.getElementById('demoToggleLabel');
    if (toggle) toggle.classList.remove('active');
    const source = (typeof BakalAPI !== 'undefined' && BakalAPI.useSupabase) ? 'Supabase' : 'Backend';
    if (label) label.textContent = `Données live (${source})`;
    console.log(`Loaded data from ${source}`);
  } else {
    // No backend data — load demo data as default
    loadDemoData();
    console.log(_backendAvailable
      ? 'Backend reachable but empty — using demo data'
      : 'Backend not available — using demo data'
    );
  }

  initFromData();
}


/* ═══════════════════════════════════════════════════════════════════════════
   RENDERING FUNCTIONS — Overview Section
   ═══════════════════════════════════════════════════════════════════════════ */

function renderGlobalKpis() {
  const kpis = BAKAL.globalKpis;
  const labels = {
    contacts: '📤 Contacts atteints',
    openRate: "📬 Taux d'ouverture",
    replyRate: '💬 Taux de réponse',
    interested: '🔥 Prospects intéressés',
    meetings: '📅 RDV qualifiés',
    stops: '🚫 Stops'
  };

  return Object.entries(kpis).map(([key, k]) =>
    `<div class="kpi-card">
      <div class="kpi-label">${labels[key]}</div>
      <div class="kpi-value">${k.value}</div>
      <div class="kpi-trend up">${k.trend}</div>
    </div>`
  ).join('');
}

function renderEmptyKpis() {
  const items = [
    { label: '📤 Contacts atteints', value: '—' },
    { label: "📬 Taux d'ouverture", value: '—' },
    { label: '💬 Taux de réponse', value: '—' },
    { label: '🔥 Prospects intéressés', value: '—' },
    { label: '📅 RDV qualifiés', value: '—' },
    { label: '🚫 Stops', value: '—' }
  ];
  return items.map(k =>
    `<div class="kpi-card">
      <div class="kpi-label">${k.label}</div>
      <div class="kpi-value" style="color:var(--text-muted)">${k.value}</div>
      <div class="kpi-trend" style="color:var(--text-muted)">En attente de données</div>
    </div>`
  ).join('');
}

function renderCampaignsTable() {
  const campaigns = Object.values(BAKAL.campaigns);
  return campaigns.map(c => {
    const isLinkedin = c.channel === 'linkedin';
    const isPrep = c.status === 'prep';

    const statusHtml = c.status === 'active'
      ? '<span class="status-badge status-active"><span class="pulse-dot" style="width:6px;height:6px;"></span> Active</span>'
      : '<span class="status-badge status-prep">⏳ En préparation</span>';

    let openHtml, replyHtml, meetingsHtml;

    if (isPrep) {
      openHtml = '<div style="color:var(--text-muted)">—</div>';
      replyHtml = '<div style="color:var(--text-muted)">—</div>';
      meetingsHtml = '<div style="color:var(--text-muted)">—</div>';
    } else if (isLinkedin) {
      openHtml = `<div style="font-weight:600;">—</div><div style="font-size:11px;color:var(--text-muted)">N/A LinkedIn</div>`;
      const replyPct = Math.min(c.kpis.replyRate * 10, 100);
      replyHtml = `<div style="font-weight:600;">${c.kpis.replyRate}%</div><div class="perf-bar"><div class="perf-fill ${c.kpis.replyRate >= 8 ? 'perf-good' : 'perf-ok'}" style="width:${replyPct}%"></div></div>`;
      meetingsHtml = `<span style="font-weight:700;color:var(--success)">${c.kpis.meetings}</span>`;
    } else {
      const openColor = c.kpis.openRate >= 50 ? 'perf-good' : 'perf-ok';
      openHtml = `<div style="font-weight:600;">${c.kpis.openRate}%</div><div class="perf-bar"><div class="perf-fill ${openColor}" style="width:${c.kpis.openRate}%"></div></div>`;
      const replyPct = Math.min(c.kpis.replyRate * 10, 100);
      replyHtml = `<div style="font-weight:600;">${c.kpis.replyRate}%</div><div class="perf-bar"><div class="perf-fill ${c.kpis.replyRate >= 8 ? 'perf-good' : 'perf-ok'}" style="width:${replyPct}%"></div></div>`;
      meetingsHtml = `<span style="font-weight:700;color:var(--success)">${c.kpis.meetings}</span>`;
    }

    return `<tr>
      <td>
        <div style="font-weight:600;">${c.name}</div>
        <div style="font-size:12px;color:var(--text-muted);">${c.sectorShort} · ${c.size} · ${c.angle}</div>
      </td>
      <td><span style="color:${c.channelColor}">${c.channelLabel}</span></td>
      <td>${statusHtml}</td>
      <td>${openHtml}</td>
      <td>${replyHtml}</td>
      <td>${meetingsHtml}</td>
    </tr>`;
  }).join('');
}

function renderOpportunities() {
  return BAKAL.opportunities.map(o =>
    `<div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:var(--bg-elevated);border-radius:8px;">
      <div>
        <div style="font-weight:600;font-size:14px;">${o.name}</div>
        <div style="font-size:12px;color:var(--text-muted);">${o.title} · ${o.company} · ${o.size}</div>
      </div>
      <div style="text-align:right;">
        <span class="status-badge" style="background:${o.statusBg};color:${o.statusColor};">${o.status}</span>
        <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">${o.timing}</div>
      </div>
    </div>`
  ).join('');
}

function renderRecommendations() {
  const colorMap = { success: 'success', warning: 'warning', blue: 'blue' };
  return BAKAL.recommendations.map(r =>
    `<div style="background:var(--bg-elevated);border-radius:8px;padding:14px;border-left:3px solid var(--${colorMap[r.level]});">
      <div style="font-size:12px;font-weight:600;color:var(--${colorMap[r.level]});margin-bottom:4px;">${r.label}</div>
      <div style="font-size:13px;color:var(--text-secondary);line-height:1.5;">${r.text}</div>
    </div>`
  ).join('');
}

function renderChart() {
  return BAKAL.chartData.map(d =>
    `<div class="chart-bar-group">
      <div class="chart-bar-wrapper">
        <div class="chart-bar email" style="height:${d.email}%"></div>
        <div class="chart-bar linkedin" style="height:${d.linkedin}%"></div>
      </div>
      <div class="chart-bar-label">${d.label}</div>
    </div>`
  ).join('');
}


/* ═══════════════════════════════════════════════════════════════════════════
   RENDERING FUNCTIONS — Reports Section
   ═══════════════════════════════════════════════════════════════════════════ */

function renderReports() {
  return BAKAL.reports.map(r => {
    const metricsHtml = [
      { v: r.metrics.contacts, l: 'Contacts' },
      { v: r.metrics.openRate, l: 'Ouvertures', color: 'var(--success)' },
      { v: r.metrics.replyRate, l: 'Réponses', color: 'var(--blue)' },
      { v: r.metrics.interested, l: 'Intéressés', color: 'var(--warning)' },
      { v: r.metrics.meetings, l: 'RDV', color: 'var(--text-secondary)' }
    ].map(m =>
      `<div class="report-metric">
        <div class="report-metric-value"${m.color ? ` style="color:${m.color}"` : ''}>${m.v}</div>
        <div class="report-metric-label">${m.l}</div>
      </div>`
    ).join('');

    return `<div class="report-card">
      <div class="report-header">
        <div>
          <div class="report-week">${r.week}</div>
          <div class="report-date">${r.dateRange}</div>
        </div>
        <span class="report-score score-${r.score}">${r.scoreLabel}</span>
      </div>
      <div class="report-metrics">${metricsHtml}</div>
      <div class="report-synthesis">
        <div class="report-synthesis-label">🤖 Synthèse IA${r.score === 'excellent' ? ' — Analyse multi-campagnes' : ''}</div>
        <div class="report-synthesis-text">${r.synthesis}</div>
      </div>
    </div>`;
  }).join('');
}


/* ═══════════════════════════════════════════════════════════════════════════
   RENDERING FUNCTIONS — Campaigns List
   ═══════════════════════════════════════════════════════════════════════════ */

function renderCampaignRow(c) {
  const isPrep = c.status === 'prep';
  const isLinkedin = c.channel === 'linkedin';
  const statusHtml = c.status === 'active'
    ? '<span class="status-badge status-active"><span class="pulse-dot" style="width:6px;height:6px;"></span> Active</span>'
    : '<span class="status-badge status-prep">⏳ Préparation</span>';

  let stat1Value, stat1Label, stat2Value, stat2Label;
  if (isPrep) {
    stat1Value = '—'; stat1Label = '—'; stat2Value = '—'; stat2Label = '—';
  } else if (isLinkedin) {
    stat1Value = '—'; stat1Label = 'N/A LinkedIn';
    stat2Value = c.kpis.replyRate + '%'; stat2Label = 'Réponse';
  } else {
    stat1Value = c.kpis.openRate + '%'; stat1Label = 'Ouverture';
    stat2Value = c.kpis.replyRate + '%'; stat2Label = 'Réponse';
  }

  const stat1Color = (stat1Value !== '—' && parseFloat(stat1Value) >= 50) ? 'var(--success)' : (stat1Value === '—' ? 'var(--text-muted)' : 'var(--warning)');
  const stat2Color = (stat2Value !== '—' && parseFloat(stat2Value) >= 8) ? 'var(--blue)' : (stat2Value === '—' ? 'var(--text-muted)' : 'var(--warning)');

  const dateLabel = isPrep ? 'Créée' : 'Lancée';

  // Audience size: sent (active) or planned (prep)
  const audienceCount = (c.volume && c.volume.sent > 0) ? c.volume.sent
    : (c.volume && c.volume.planned > 0) ? c.volume.planned
    : (c.kpis && c.kpis.contacts > 0) ? c.kpis.contacts
    : 0;
  const audienceLabel = (c.volume && c.volume.sent > 0) ? 'envoyés' : 'planifiés';
  const audienceHtml = audienceCount > 0
    ? `<span class="campaign-audience">${audienceCount} prospects</span>`
    : '';

  return `<div class="campaign-row" onclick="showCampaignDetail('${c.id}')">
    <div><div class="campaign-row-name">${c.name}${audienceHtml}</div><div class="campaign-row-meta">${c.sectorShort} · ${c.size} · ${c.angle} · ${dateLabel} ${c.startDate}</div></div>
    <div class="campaign-row-channel"><span style="color:${c.channelColor}">${c.channelLabel}</span></div>
    <div class="campaign-row-stat">${statusHtml}</div>
    <div class="campaign-row-stat"><div class="campaign-row-stat-value" style="color:${stat1Color}">${stat1Value}</div><div class="campaign-row-stat-label">${stat1Label}</div></div>
    <div class="campaign-row-stat"><div class="campaign-row-stat-value" style="color:${stat2Color}">${stat2Value}</div><div class="campaign-row-stat-label">${stat2Label}</div></div>
    <div class="campaign-row-arrow">→</div>
  </div>`;
}

/* ─── Campaign Filtering ─── */

function getFilteredCampaigns() {
  let campaigns = Object.values(BAKAL.campaigns);

  const searchEl = document.getElementById('campaigns-search');
  const statusEl = document.getElementById('filter-status');
  const channelEl = document.getElementById('filter-channel');
  const sectorEl = document.getElementById('filter-sector');

  const search = (searchEl?.value || '').trim().toLowerCase();
  const status = statusEl?.value || '';
  const channel = channelEl?.value || '';
  const sector = sectorEl?.value || '';

  if (search) {
    campaigns = campaigns.filter(c =>
      (c.name || '').toLowerCase().includes(search) ||
      (c.client || '').toLowerCase().includes(search) ||
      (c.sector || '').toLowerCase().includes(search) ||
      (c.position || '').toLowerCase().includes(search) ||
      (c.zone || '').toLowerCase().includes(search)
    );
  }
  if (status) {
    campaigns = campaigns.filter(c => c.status === status);
  }
  if (channel) {
    campaigns = campaigns.filter(c => c.channel === channel);
  }
  if (sector) {
    campaigns = campaigns.filter(c => (c.sector || '').includes(sector));
  }

  return campaigns;
}

function applyCampaignFilters() {
  const campaigns = getFilteredCampaigns();
  const projects = Object.values(BAKAL.projects || {});
  const total = Object.values(BAKAL.campaigns).length;
  const filtered = campaigns.length;
  const countEl = document.querySelector('#campaigns-list-view > div:first-child > div:first-child');
  if (countEl) {
    countEl.textContent = filtered < total
      ? `${filtered} / ${total} campagne${total > 1 ? 's' : ''}`
      : `${total} campagne${total > 1 ? 's' : ''} · ${projects.length} projet${projects.length > 1 ? 's' : ''}`;
  }

  // Re-render with filtered campaigns
  renderFilteredCampaignsList(campaigns);
}

function resetCampaignFilters() {
  const searchEl = document.getElementById('campaigns-search');
  const statusEl = document.getElementById('filter-status');
  const channelEl = document.getElementById('filter-channel');
  const sectorEl = document.getElementById('filter-sector');
  if (searchEl) searchEl.value = '';
  if (statusEl) statusEl.value = '';
  if (channelEl) channelEl.value = '';
  if (sectorEl) sectorEl.value = '';
  renderCampaignsList();
}

function populateSectorFilter() {
  const sectorEl = document.getElementById('filter-sector');
  if (!sectorEl) return;
  const sectors = [...new Set(Object.values(BAKAL.campaigns).map(c => c.sector).filter(Boolean))];
  const current = sectorEl.value;
  sectorEl.innerHTML = '<option value="">Tous les secteurs</option>' +
    sectors.map(s => `<option value="${s}"${s === current ? ' selected' : ''}>${s}</option>`).join('');
}

function renderFilteredCampaignsList(campaigns) {
  const listEl = document.querySelector('.campaigns-list');
  if (!listEl) return;

  if (campaigns.length === 0) {
    listEl.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);font-size:13px;">Aucune campagne ne correspond aux filtres.</div>';
    return;
  }

  // Flat list when filtering
  listEl.innerHTML = campaigns.map(c => renderCampaignRow(c)).join('');
}

function renderCampaignsList() {
  const campaigns = Object.values(BAKAL.campaigns);
  const projects = Object.values(BAKAL.projects || {});
  const countText = `${campaigns.length} campagne${campaigns.length > 1 ? 's' : ''} · ${projects.length} projet${projects.length > 1 ? 's' : ''}`;

  let html = '';

  // Group campaigns by project
  if (projects.length > 0) {
    projects.forEach(p => {
      const projectCampaigns = campaigns.filter(c => c.projectId === p.id);
      const activeCount = projectCampaigns.filter(c => c.status === 'active').length;
      const totalCount = projectCampaigns.length;

      const filesCount = (p.files || []).length;

      html += `<div class="project-group">
        <div class="project-header" onclick="toggleProjectGroup('${p.id}')">
          <div class="project-header-left">
            <span class="project-chevron" id="chevron-${p.id}">▾</span>
            <span class="project-color-dot" style="background:${p.color}"></span>
            <div>
              <div class="project-header-name">${p.name}</div>
              <div class="project-header-meta">${p.description}</div>
            </div>
          </div>
          <div class="project-header-right">
            ${filesCount > 0 ? `<span class="project-badge project-badge-files">${filesCount} fichier${filesCount > 1 ? 's' : ''}</span>` : ''}
            <span class="project-badge">${totalCount} campagne${totalCount > 1 ? 's' : ''}</span>
            ${activeCount > 0 ? `<span class="project-badge project-badge-active">${activeCount} active${activeCount > 1 ? 's' : ''}</span>` : ''}
          </div>
        </div>
        <div class="project-campaigns" id="project-campaigns-${p.id}">
          ${renderProjectFiles(p)}
          ${projectCampaigns.length > 0
            ? projectCampaigns.map(c => renderCampaignRow(c)).join('')
            : '<div class="project-empty">Aucune campagne dans ce projet. <a href="#" onclick="event.preventDefault();toggleCreator()">Créer une campagne</a></div>'}
        </div>
      </div>`;
    });

    // Orphan campaigns (no projectId)
    const orphans = campaigns.filter(c => !c.projectId);
    if (orphans.length > 0) {
      html += `<div class="project-group">
        <div class="project-header" onclick="toggleProjectGroup('_orphans')">
          <div class="project-header-left">
            <span class="project-chevron" id="chevron-_orphans">▾</span>
            <span class="project-color-dot" style="background:var(--text-muted)"></span>
            <div>
              <div class="project-header-name">Sans projet</div>
              <div class="project-header-meta">Campagnes non assignées à un projet</div>
            </div>
          </div>
          <div class="project-header-right">
            <span class="project-badge">${orphans.length} campagne${orphans.length > 1 ? 's' : ''}</span>
          </div>
        </div>
        <div class="project-campaigns" id="project-campaigns-_orphans">
          ${orphans.map(c => renderCampaignRow(c)).join('')}
        </div>
      </div>`;
    }
  } else {
    // No projects — flat list fallback
    html = campaigns.map(c => renderCampaignRow(c)).join('');
  }

  document.querySelector('#campaigns-list-view > div:first-child > div:first-child').textContent = countText;
  document.querySelector('.campaigns-list').innerHTML = html;
}

function toggleProjectGroup(projectId) {
  const container = document.getElementById('project-campaigns-' + projectId);
  const chevron = document.getElementById('chevron-' + projectId);
  if (!container) return;
  const collapsed = container.style.display === 'none';
  container.style.display = collapsed ? '' : 'none';
  if (chevron) chevron.textContent = collapsed ? '▾' : '▸';
}


/* ═══════════════════════════════════════════════════════════════════════════
   PROJECT FILES — Drop zone, file list, upload & delete
   ═══════════════════════════════════════════════════════════════════════════ */

const FILE_ICONS = {
  'application/pdf': '📄',
  'text/markdown': '📝',
  'text/plain': '📝',
  'image/png': '🖼️',
  'image/jpeg': '🖼️',
  'image/svg+xml': '🖼️',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '📃',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '📊',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '📊',
};

const CATEGORY_LABELS = {
  brief: 'Brief',
  persona: 'Persona',
  guidelines: 'Guidelines',
  data: 'Données',
  other: 'Autre',
};

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' o';
  if (bytes < 1048576) return Math.round(bytes / 1024) + ' Ko';
  return (bytes / 1048576).toFixed(1) + ' Mo';
}

function getFileIcon(mimeType) {
  return FILE_ICONS[mimeType] || '📎';
}

function renderProjectFiles(project) {
  const files = project.files || [];
  const pid = project.id;

  const filesListHtml = files.map(f => `
    <div class="pf-file-row" id="pf-file-${f.id}">
      <div class="pf-file-icon">${getFileIcon(f.type)}</div>
      <div class="pf-file-info">
        <div class="pf-file-name">${f.name}</div>
        <div class="pf-file-meta">${formatFileSize(f.size)} · ${CATEGORY_LABELS[f.category] || f.category}</div>
      </div>
      <button class="pf-file-delete" onclick="event.stopPropagation();deleteProjectFile('${pid}','${f.id}')" title="Supprimer">×</button>
    </div>
  `).join('');

  return `<div class="pf-section">
    <div class="pf-files-header">
      <span class="pf-files-title">Contexte projet</span>
      <span class="pf-files-count">${files.length} fichier${files.length !== 1 ? 's' : ''}</span>
    </div>
    ${files.length > 0 ? `<div class="pf-file-list" id="pf-list-${pid}">${filesListHtml}</div>` : ''}
    <div class="pf-dropzone"
         id="pf-dropzone-${pid}"
         ondragover="handleDragOver(event,'${pid}')"
         ondragleave="handleDragLeave(event,'${pid}')"
         ondrop="handleDrop(event,'${pid}')">
      <div class="pf-dropzone-content">
        <div class="pf-dropzone-icon">+</div>
        <div class="pf-dropzone-text">Glissez vos fichiers ici</div>
        <div class="pf-dropzone-hint">ou <a href="#" onclick="event.preventDefault();triggerFileInput('${pid}')">parcourir</a> · PDF, DOCX, MD, images — max 10 Mo</div>
      </div>
      <input type="file" id="pf-input-${pid}" multiple accept=".pdf,.docx,.doc,.md,.txt,.png,.jpg,.jpeg,.svg,.xlsx,.pptx" style="display:none" onchange="handleFileSelect(event,'${pid}')">
    </div>
    <div class="pf-upload-status" id="pf-status-${pid}"></div>
  </div>`;
}

function handleDragOver(e, projectId) {
  e.preventDefault();
  e.stopPropagation();
  const dz = document.getElementById('pf-dropzone-' + projectId);
  if (dz) dz.classList.add('pf-dropzone-active');
}

function handleDragLeave(e, projectId) {
  e.preventDefault();
  e.stopPropagation();
  const dz = document.getElementById('pf-dropzone-' + projectId);
  if (dz) dz.classList.remove('pf-dropzone-active');
}

function handleDrop(e, projectId) {
  e.preventDefault();
  e.stopPropagation();
  const dz = document.getElementById('pf-dropzone-' + projectId);
  if (dz) dz.classList.remove('pf-dropzone-active');
  const files = Array.from(e.dataTransfer.files);
  if (files.length > 0) uploadProjectFiles(projectId, files);
}

function triggerFileInput(projectId) {
  const input = document.getElementById('pf-input-' + projectId);
  if (input) input.click();
}

function handleFileSelect(e, projectId) {
  const files = Array.from(e.target.files);
  if (files.length > 0) uploadProjectFiles(projectId, files);
  e.target.value = '';
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 Mo
const ALLOWED_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'text/markdown', 'text/plain',
  'image/png', 'image/jpeg', 'image/svg+xml',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
];

function guessCategory(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'pdf') return 'brief';
  if (['png', 'jpg', 'jpeg', 'svg'].includes(ext)) return 'guidelines';
  if (['md', 'txt'].includes(ext)) return 'guidelines';
  if (['xlsx', 'csv'].includes(ext)) return 'data';
  if (['docx', 'doc'].includes(ext)) return 'persona';
  return 'other';
}

async function uploadProjectFiles(projectId, files) {
  const status = document.getElementById('pf-status-' + projectId);
  const project = BAKAL.projects[projectId];
  if (!project) return;

  // Validate files
  const errors = [];
  const valid = [];
  for (const f of files) {
    if (f.size > MAX_FILE_SIZE) {
      errors.push(f.name + ' dépasse 10 Mo');
    } else if (ALLOWED_TYPES.length > 0 && !ALLOWED_TYPES.includes(f.type) && f.type !== '') {
      errors.push(f.name + ' : type non supporté');
    } else {
      valid.push(f);
    }
  }

  if (errors.length > 0 && status) {
    status.innerHTML = '<div class="pf-status-error">' + errors.join('<br>') + '</div>';
    setTimeout(() => { status.innerHTML = ''; }, 4000);
  }

  if (valid.length === 0) return;

  // Show uploading state
  if (status) {
    status.innerHTML = '<div class="pf-status-uploading">Envoi de ' + valid.length + ' fichier' + (valid.length > 1 ? 's' : '') + '...</div>';
  }

  // Upload to backend (or local fallback)
  for (const file of valid) {
    try {
      const uploaded = await uploadFileToBackend(projectId, file);
      if (!project.files) project.files = [];
      project.files.push(uploaded);
    } catch (err) {
      console.warn('Upload failed for', file.name, err);
      if (status) {
        status.innerHTML = '<div class="pf-status-error">Erreur : ' + (err.message || 'Upload échoué') + '</div>';
        setTimeout(() => { status.innerHTML = ''; }, 4000);
        return;
      }
    }
  }

  // Success
  if (status) {
    status.innerHTML = '<div class="pf-status-success">' + valid.length + ' fichier' + (valid.length > 1 ? 's' : '') + ' ajouté' + (valid.length > 1 ? 's' : '') + '</div>';
    setTimeout(() => { status.innerHTML = ''; }, 3000);
  }

  // Re-render
  renderCampaignsList();
}

async function uploadFileToBackend(projectId, file) {
  if (typeof BakalAPI !== 'undefined' && _backendAvailable) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('category', guessCategory(file));

    const token = typeof BakalAuth !== 'undefined' ? BakalAuth.getToken() : null;
    const headers = {};
    if (token) headers['Authorization'] = 'Bearer ' + token;

    const base = (window.location.origin || 'http://localhost:3001') + '/api';
    const res = await fetch(base + '/projects/' + projectId + '/files', {
      method: 'POST',
      headers,
      body: formData,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'HTTP ' + res.status);
    }
    return res.json();
  }

  // Local fallback — store metadata only (no actual file persistence)
  return {
    id: 'f_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    name: file.name,
    type: file.type,
    size: file.size,
    uploadedAt: new Date().toISOString(),
    category: guessCategory(file),
  };
}

async function deleteProjectFile(projectId, fileId) {
  const project = BAKAL.projects[projectId];
  if (!project || !project.files) return;

  // Backend delete
  if (typeof BakalAPI !== 'undefined' && _backendAvailable) {
    try {
      const base = (window.location.origin || 'http://localhost:3001') + '/api';
      const token = typeof BakalAuth !== 'undefined' ? BakalAuth.getToken() : null;
      const headers = {};
      if (token) headers['Authorization'] = 'Bearer ' + token;

      await fetch(base + '/projects/' + projectId + '/files/' + fileId, {
        method: 'DELETE',
        headers,
      });
    } catch (err) {
      console.warn('Backend file delete failed:', err.message);
    }
  }

  // Remove from local data
  project.files = project.files.filter(f => f.id !== fileId);

  // Animate removal then re-render
  const row = document.getElementById('pf-file-' + fileId);
  if (row) {
    row.style.opacity = '0';
    row.style.transform = 'translateX(10px)';
    setTimeout(() => renderCampaignsList(), 200);
  } else {
    renderCampaignsList();
  }
}


/* ═══════════════════════════════════════════════════════════════════════════
   EMPTY STATE RENDERERS — New user experience
   ═══════════════════════════════════════════════════════════════════════════ */

function renderWelcomeBanner() {
  return `<div class="welcome-banner">
    <div class="welcome-title">Bienvenue sur Bakal</div>
    <div class="welcome-subtitle">
      Votre plateforme de prospection intelligente est prête. Suivez ces étapes pour lancer votre première campagne et commencer à générer des RDV qualifiés.
    </div>
    <div class="onboarding-steps">
      <div class="onboarding-step step-active">
        <div class="onboarding-step-number">1</div>
        <div class="onboarding-step-title">Créez votre campagne</div>
        <div class="onboarding-step-desc">Définissez votre cible, votre canal (Email, LinkedIn ou les deux) et votre angle d'approche.</div>
        <button class="btn btn-primary" onclick="toggleCreator()">Créer ma campagne</button>
      </div>
      <div class="onboarding-step">
        <div class="onboarding-step-number">2</div>
        <div class="onboarding-step-title">Claude génère vos séquences</div>
        <div class="onboarding-step-desc">L'IA rédige des messages personnalisés et adaptés à votre cible et votre secteur.</div>
      </div>
      <div class="onboarding-step">
        <div class="onboarding-step-number">3</div>
        <div class="onboarding-step-title">Importez vos prospects</div>
        <div class="onboarding-step-desc">Ajoutez votre liste de contacts ou laissez-nous la constituer pour vous.</div>
      </div>
      <div class="onboarding-step">
        <div class="onboarding-step-number">4</div>
        <div class="onboarding-step-title">Lancez et optimisez</div>
        <div class="onboarding-step-desc">Bakal analyse les performances et optimise automatiquement vos messages.</div>
      </div>
    </div>
  </div>`;
}

function renderEmptyOverviewGrid() {
  return `
    <!-- Campaigns table — empty -->
    <div class="card card-empty">
      <div class="card-header">
        <div class="card-title">🎯 Campagnes actives</div>
      </div>
      <div class="card-body">
        <div class="empty-icon">📭</div>
        <div class="empty-text">Aucune campagne pour le moment. Créez votre première campagne pour voir vos performances ici.</div>
        <button class="btn btn-primary" style="margin-top:16px;font-size:13px;" onclick="toggleCreator()">Créer une campagne</button>
      </div>
    </div>

    <!-- Performance chart — empty -->
    <div class="card card-empty">
      <div class="card-header">
        <div class="card-title">📈 Performance 4 semaines</div>
      </div>
      <div class="card-body">
        <div class="empty-icon">📊</div>
        <div class="empty-text">Les graphiques de performance apparaîtront dès que votre première campagne sera active.</div>
      </div>
    </div>

    <!-- Opportunities — empty -->
    <div class="card card-empty">
      <div class="card-header">
        <div class="card-title">🔥 Opportunités récentes</div>
      </div>
      <div class="card-body">
        <div class="empty-icon">💎</div>
        <div class="empty-text">Les prospects intéressés et les RDV planifiés s'afficheront ici au fil des réponses.</div>
      </div>
    </div>

    <!-- AI Recommendations — empty -->
    <div class="card card-empty">
      <div class="card-header">
        <div class="card-title">💡 Recommandations Claude</div>
      </div>
      <div class="card-body">
        <div class="empty-icon">🤖</div>
        <div class="empty-text">Claude analysera vos campagnes et proposera des optimisations dès qu'il aura suffisamment de données (>50 prospects, >7 jours).</div>
      </div>
    </div>`;
}

function renderEmptyReports() {
  return `<div class="empty-state">
    <div class="empty-state-icon">📋</div>
    <div class="empty-state-title">Aucun rapport disponible</div>
    <div class="empty-state-desc">
      Les rapports hebdomadaires sont générés automatiquement chaque lundi. Lancez votre première campagne pour recevoir votre premier bilan de performance.
    </div>
    <button class="btn btn-primary" onclick="toggleCreator()">Créer ma première campagne</button>
  </div>`;
}

function renderEmptyCampaignsList() {
  return `<div class="empty-state">
    <div class="empty-state-icon">🎯</div>
    <div class="empty-state-title">Aucune campagne créée</div>
    <div class="empty-state-desc">
      Créez votre première campagne de prospection. Choisissez votre cible, votre canal et votre angle — Claude s'occupe du reste.
    </div>
    <button class="btn btn-primary" onclick="toggleCreator()">Créer ma première campagne</button>
  </div>`;
}

function renderEmptyRefinement() {
  return `<div class="empty-state">
    <div class="empty-state-icon">🧬</div>
    <div class="empty-state-title">Refinement A/B non disponible</div>
    <div class="empty-state-desc">
      Le système de test A/B et d'optimisation s'active après la première semaine de campagne active, avec au moins 50 prospects contactés.
    </div>
    <button class="btn btn-ghost" onclick="showSection('overview')">Retour au dashboard</button>
  </div>`;
}


/* ═══════════════════════════════════════════════════════════════════════════
   INIT — Populate all sections from data on load
   Handles both empty (new user) and populated (demo) states
   ═══════════════════════════════════════════════════════════════════════════ */

function initFromData() {
  const empty = isEmptyDashboard();

  // Update header subtitle
  const subtitle = document.querySelector('.page-subtitle');
  if (subtitle) {
    if (empty) {
      subtitle.innerHTML = 'Bienvenue — Configurez votre première campagne';
    } else {
      const activeCount = Object.values(BAKAL.campaigns).filter(c => c.status === 'active').length;
      const today = new Date();
      const weekStr = 'Semaine du ' + today.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
      subtitle.innerHTML = `<span class="pulse-dot"></span>&nbsp;&nbsp;${activeCount} campagne${activeCount > 1 ? 's' : ''} active${activeCount > 1 ? 's' : ''} · ${weekStr}`;
    }
  }

  // Update sidebar badges
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    const badge = item.querySelector('.badge');
    if (item.textContent.includes('Opportunités') && badge) {
      badge.textContent = empty ? '0' : BAKAL.opportunities.length;
      badge.style.display = empty ? 'none' : '';
    }
    if (item.textContent.includes('Recommandations') && badge) {
      badge.textContent = empty ? '0' : BAKAL.recommendations.length;
      badge.style.display = empty ? 'none' : '';
    }
  });

  // ─── Sidebar campaign list ───
  if (typeof renderSidebarCampaigns === 'function') renderSidebarCampaigns();

  // ─── Overview section ───
  const overviewSection = document.getElementById('section-overview');
  const kpiGrid = overviewSection.querySelector('.kpi-grid');
  const sectionGrid = overviewSection.querySelector('.section-grid');

  // Remove existing welcome banner if any
  const existingBanner = overviewSection.querySelector('.welcome-banner');
  if (existingBanner) existingBanner.remove();

  if (empty) {
    // Insert welcome banner before KPI grid
    kpiGrid.insertAdjacentHTML('beforebegin', renderWelcomeBanner());
    kpiGrid.innerHTML = renderEmptyKpis();
    sectionGrid.innerHTML = renderEmptyOverviewGrid();
  } else {
    kpiGrid.innerHTML = renderGlobalKpis();

    // Restore the populated grid structure
    sectionGrid.innerHTML = `
      <!-- Campaigns table -->
      <div class="card">
        <div class="card-header">
          <div class="card-title">🎯 Campagnes actives</div>
          <button class="btn btn-ghost" style="padding: 6px 12px; font-size: 12px;" onclick="showSection('campaigns')">Voir tout →</button>
        </div>
        <div class="card-body" style="padding: 0;">
          <table class="campaign-table">
            <thead>
              <tr><th>Campagne</th><th>Canal</th><th>Statut</th><th>Ouvertures</th><th>Réponses</th><th>RDV</th></tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
      </div>

      <!-- Performance chart -->
      <div class="card">
        <div class="card-header">
          <div class="card-title">📈 Performance 4 semaines</div>
        </div>
        <div class="card-body">
          <div class="chart-container">
            <div class="chart-bars"></div>
          </div>
          <div class="chart-legend">
            <div class="chart-legend-item"><div class="chart-legend-dot" style="background:var(--blue)"></div> Email</div>
            <div class="chart-legend-item"><div class="chart-legend-dot" style="background:var(--purple)"></div> LinkedIn</div>
          </div>
        </div>
      </div>

      <!-- Opportunities -->
      <div class="card">
        <div class="card-header">
          <div class="card-title">🔥 Opportunités récentes</div>
          <span class="badge" style="background:var(--danger-bg);color:var(--danger);padding:4px 10px;border-radius:6px;font-size:12px;font-weight:600;">${BAKAL.opportunities.length} nouvelles</span>
        </div>
        <div class="card-body" style="padding:16px 24px;">
          <div style="display:flex;flex-direction:column;gap:12px;"></div>
        </div>
      </div>

      <!-- AI Recommendations -->
      <div class="card">
        <div class="card-header">
          <div class="card-title">💡 Recommandations Claude</div>
        </div>
        <div class="card-body">
          <div style="display:flex;flex-direction:column;gap:12px;"></div>
        </div>
      </div>`;

    // Fill in dynamic content
    document.querySelector('.campaign-table tbody').innerHTML = renderCampaignsTable();
    document.querySelector('.chart-bars').innerHTML = renderChart();

    const oppsContainer = sectionGrid.querySelector('.card:nth-child(3) .card-body > div');
    if (oppsContainer) oppsContainer.innerHTML = renderOpportunities();

    const recosContainer = sectionGrid.querySelector('.card:nth-child(4) .card-body > div');
    if (recosContainer) recosContainer.innerHTML = renderRecommendations();
  }

  // ─── Reports section (removed — single dashboard view) ───

  // ─── Campaigns list section ───
  if (empty) {
    document.querySelector('.campaigns-list').innerHTML = renderEmptyCampaignsList();
    document.querySelector('#campaigns-list-view > div:first-child').style.display = 'none';
  } else {
    document.querySelector('#campaigns-list-view > div:first-child').style.display = '';
    renderCampaignsList();
    populateSectorFilter();
  }

  // ─── Analytics section (removed — KPIs in dashboard overview) ───

  // ─── Retention biases (progress bar, cumulative stats, benchmarks) ───
  if (typeof renderRetentionBiases === 'function') renderRetentionBiases();

  // ─── Refinement section (now standalone page) ───
  const refinementSection = document.getElementById('section-refinement');
  if (!refinementSection) return;
  if (empty) {
    // Save original content if not already saved
    if (!refinementSection.dataset.originalSaved) {
      refinementSection.dataset.originalHtml = refinementSection.innerHTML;
      refinementSection.dataset.originalSaved = 'true';
    }
    refinementSection.innerHTML = renderEmptyRefinement();
  } else if (refinementSection.dataset.originalSaved) {
    refinementSection.innerHTML = refinementSection.dataset.originalHtml;
  }
}
