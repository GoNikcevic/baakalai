const express = require('express');
const router = express.Router();
const db = require('../db');

// Static templates as fallback
const TEMPLATES = [
  {
    id: 'daf-finance',
    name: 'DAF / Directeurs Financiers',
    sector: 'Finance / Comptabilite',
    channel: 'email',
    description: 'Sequence email ciblant les DAF avec un angle automatisation et ROI chiffre.',
    tags: ['Email', 'Finance', 'Automatisation'],
    popularity: 95,
    sequence: [
      { step: 'E1', type: 'email', label: 'Email initial', timing: 'J+0', subject: 'Question rapide sur votre gestion comptable', body: 'Bonjour {{firstName}},\n\nJe me permets de vous contacter car j\'ai remarque que {{companyName}} utilise encore des processus manuels pour la comptabilite.\n\nNos clients dans votre secteur recuperent en moyenne 14h/semaine en automatisant ces taches.\n\nSeriez-vous ouvert a un echange de 15 minutes pour voir si c\'est applicable chez vous ?\n\nCordialement' },
      { step: 'E2', type: 'email', label: 'Relance valeur', timing: 'J+3', subject: 'Re: {{companyName}} — 14h/semaine recuperables ?', body: 'Bonjour {{firstName}},\n\nJe me permets de revenir vers vous. Cabinet Fidrec a reduit 60% de son temps de saisie en 3 mois.\n\nLeur DAF m\'a dit : "On ne savait pas que c\'etait possible avec notre outil actuel."\n\nEst-ce un sujet pour vous aussi ?' },
      { step: 'E3', type: 'email', label: 'Social proof', timing: 'J+7', subject: 'Comment Cabinet Fidrec a reduit 60% du temps de saisie', body: 'Bonjour {{firstName}},\n\nDernier message, promis. Voici le cas concret :\n\n→ Cabinet Fidrec, 45 collaborateurs\n→ Sage 100, saisie manuelle des factures\n→ Resultat : -60% de temps, +0 erreur de saisie\n\nSi vous voulez le detail de la methode, je suis disponible pour un call rapide.\n\nBonne journee' },
      { step: 'E4', type: 'email', label: 'Break-up', timing: 'J+14', subject: 'Dernier message', body: '{{firstName}},\n\nJe comprends que ce n\'est peut-etre pas le bon moment.\n\nSi le sujet de l\'automatisation comptable redevient prioritaire, mon calendrier est ouvert : [lien]\n\nA bientot peut-etre.' },
    ],
  },
  {
    id: 'cto-saas',
    name: 'CTOs SaaS B2B',
    sector: 'Tech / SaaS',
    channel: 'multi',
    description: 'Sequence multi-canal (LinkedIn + Email) pour CTOs avec angle dette technique.',
    tags: ['Multi-canal', 'Tech', 'LinkedIn'],
    popularity: 88,
    sequence: [
      { step: 'L1', type: 'linkedin', label: 'Connexion LinkedIn', timing: 'J+0', subject: null, body: 'Salut {{firstName}}, je vois que tu scales {{companyName}} — j\'accompagne des CTOs sur la gestion de la dette technique pendant les phases de croissance. Curieux d\'echanger ?' },
      { step: 'L2', type: 'linkedin', label: 'Message LinkedIn', timing: 'J+2', subject: null, body: 'Merci pour la connexion {{firstName}} ! Question rapide : comment tu geres le ratio feature vs refacto chez {{companyName}} en ce moment ? C\'est souvent le point de friction #1 quand on scale.' },
      { step: 'E1', type: 'email', label: 'Email follow-up', timing: 'J+4', subject: 'La dette technique de {{companyName}}', body: 'Salut {{firstName}},\n\nJe t\'ai contacte sur LinkedIn — je me permets un email aussi.\n\nOn a aide DataFlow (30 devs) a reduire leur dette technique de 40% en 3 mois sans ralentir le delivery.\n\n20 min pour voir si c\'est applicable chez toi ?' },
    ],
  },
  {
    id: 'drh-formation',
    name: 'DRH / Formation Continue',
    sector: 'Formation professionnelle',
    channel: 'email',
    description: 'Sequence email pour DRH avec angle ROI formation et preuve sociale.',
    tags: ['Email', 'Formation', 'RH'],
    popularity: 72,
    sequence: [
      { step: 'E1', type: 'email', label: 'Email initial', timing: 'J+0', subject: 'Le ROI de votre plan de formation', body: 'Bonjour {{firstName}},\n\nAvec la reforme de la formation professionnelle, beaucoup de DRH se retrouvent a devoir justifier chaque euro investi.\n\nNos clients mesurent en moyenne un ROI de 2.3x sur leurs programmes de formation — et surtout, ils savent le prouver a leur direction.\n\nEst-ce un sujet chez {{companyName}} ?' },
      { step: 'E2', type: 'email', label: 'Relance chiffree', timing: 'J+4', subject: 'Re: {{companyName}} — 2.3x de ROI en moyenne', body: 'Bonjour {{firstName}},\n\nPetit complement chiffre :\n\n→ 73% des DRH ne mesurent pas le ROI de leurs formations\n→ Ceux qui le font obtiennent en moyenne 2.3x leur investissement\n→ La cle : un framework de mesure en 3 etapes\n\nJe peux vous l\'envoyer si ca vous interesse. 15 min suffisent pour voir si c\'est applicable.' },
      { step: 'E3', type: 'email', label: 'Break-up', timing: 'J+10', subject: 'Bonne continuation', body: '{{firstName}},\n\nPas de reponse, je comprends — les agendas de DRH sont charges.\n\nSi le sujet du ROI formation redevient prioritaire, je reste disponible.\n\nBonne continuation chez {{companyName}}.' },
    ],
  },
  {
    id: 'agence-marketing',
    name: 'Agences Marketing Digital',
    sector: 'Marketing / Communication',
    channel: 'email',
    description: 'Sequence pour agences marketing avec angle sous-traitance outbound.',
    tags: ['Email', 'Agences', 'Partenariat'],
    popularity: 65,
    sequence: [
      { step: 'E1', type: 'email', label: 'Email initial', timing: 'J+0', subject: 'Proposition partenariat outbound', body: 'Bonjour {{firstName}},\n\nJe travaille avec plusieurs agences marketing qui proposent desormais l\'outbound a leurs clients — sans avoir a recruter un SDR.\n\nL\'idee : vous gardez la relation client, on s\'occupe de la prospection en marque blanche.\n\nC\'est un modele qui vous parlerait ?' },
      { step: 'E2', type: 'email', label: 'Case study', timing: 'J+3', subject: 'Comment l\'agence XYZ a ajoute 40% de CA', body: 'Bonjour {{firstName}},\n\nExemple concret : l\'agence XYZ (12 personnes, Lyon) a ajoute l\'outbound B2B a son offre il y a 6 mois.\n\nResultat : +40% de CA, 0 recrutement supplementaire.\n\nJe peux vous montrer le setup en 20 min si ca vous interesse.' },
    ],
  },
  {
    id: 'ecommerce-decision',
    name: 'E-commerce / Responsables Acquisition',
    sector: 'E-commerce / Retail',
    channel: 'email',
    description: 'Sequence pour responsables acquisition e-commerce avec angle diversification canaux.',
    tags: ['Email', 'E-commerce', 'Acquisition'],
    popularity: 58,
    sequence: [
      { step: 'E1', type: 'email', label: 'Email initial', timing: 'J+0', subject: '{{companyName}} — au-dela du paid social ?', body: 'Bonjour {{firstName}},\n\nLa plupart des e-commercants dependent a 80%+ du paid social pour leur acquisition.\n\nOn aide les marques comme la votre a diversifier avec l\'outbound B2B — clients wholesale, partenariats retail, prescripteurs.\n\nC\'est un axe que vous explorez chez {{companyName}} ?' },
      { step: 'E2', type: 'email', label: 'Relance', timing: 'J+4', subject: 'Re: diversification acquisition', body: '{{firstName}},\n\nUn chiffre : nos clients e-commerce generent en moyenne 15 leads B2B qualifies par mois via l\'outbound — sans budget pub supplementaire.\n\n15 min pour voir si c\'est faisable pour {{companyName}} ?' },
    ],
  },
];

// GET / — returns DB templates + static fallback merged
router.get('/', async (req, res) => {
  try {
    const dbTemplates = await db.templates.list();
    // Merge: DB templates first, then static ones that aren't duplicated
    const dbIds = new Set(dbTemplates.map(t => t.id));
    const staticFiltered = TEMPLATES.filter(t => !dbIds.has(t.id));
    const all = [...dbTemplates.map(t => ({
      ...t,
      sequence: typeof t.sequence === 'string' ? JSON.parse(t.sequence) : t.sequence,
      touchpointCount: (typeof t.sequence === 'string' ? JSON.parse(t.sequence) : t.sequence).length,
    })), ...staticFiltered.map(({ sequence, ...t }) => ({ ...t, touchpointCount: sequence.length }))];
    res.json({ templates: all });
  } catch (err) {
    // Fallback to static if DB fails
    const list = TEMPLATES.map(({ sequence, ...t }) => ({ ...t, touchpointCount: sequence.length }));
    res.json({ templates: list });
  }
});

// GET /:id — checks DB first, then static
router.get('/:id', async (req, res) => {
  try {
    const dbTemplate = await db.templates.get(req.params.id);
    if (dbTemplate) {
      dbTemplate.sequence = typeof dbTemplate.sequence === 'string' ? JSON.parse(dbTemplate.sequence) : dbTemplate.sequence;
      return res.json({ template: dbTemplate });
    }
  } catch (err) {
    // Fall through to static lookup
  }
  const template = TEMPLATES.find(t => t.id === req.params.id);
  if (!template) return res.status(404).json({ error: 'Template not found' });
  res.json({ template });
});

// POST /use/:id — increment popularity when user selects a template
router.post('/use/:id', async (req, res) => {
  try {
    await db.templates.incrementPopularity(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to track template usage' });
  }
});

// POST /generate — Generate templates for specific sectors (on-demand)
router.post('/generate', async (req, res) => {
  try {
    const { sectors } = req.body;
    const { generateForSectors, TARGET_SECTORS } = require('../lib/template-agent');
    const targetSectors = Array.isArray(sectors) && sectors.length > 0 ? sectors : TARGET_SECTORS;
    const report = await generateForSectors(targetSectors);
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /sectors — List available sectors for template generation
router.get('/sectors', (_req, res) => {
  const { TARGET_SECTORS } = require('../lib/template-agent');
  res.json({ sectors: TARGET_SECTORS });
});

module.exports = router;
