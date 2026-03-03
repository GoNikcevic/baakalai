/* ═══════════════════════════════════════════════════
   BAKAL — Hybrid Chat Engine
   Claude API via backend when available,
   local pattern-matching engine as fallback
   ═══════════════════════════════════════════════════ */

/* ═══ Conversation state (local engine) ═══ */
let _conv = {
  stage: 'init',         // init | gathering | confirm | done | api_keys
  params: {},            // collected campaign parameters
  asked: [],             // what we've already asked about
  history: [],           // message history for context
  threadTitle: null,
  apiKeyField: null,     // which key we're currently collecting: lemlistKey | claudeKey | notionToken
};

function resetConversation() {
  _conv = { stage: 'init', params: {}, asked: [], history: [], threadTitle: null, apiKeyField: null };
}

/* ═══ Parameter extraction ═══ */

const SECTORS = [
  { keys: ['tech', 'saas', 'logiciel', 'informatique', 'digital', 'numérique', 'it'], label: 'Tech & SaaS' },
  { keys: ['compta', 'finance', 'daf', 'comptable', 'audit', 'expert-comptable', 'cabinet comptable'], label: 'Comptabilité & Finance' },
  { keys: ['formation', 'éducation', 'organisme', 'edtech', 'apprentissage'], label: 'Formation & Éducation' },
  { keys: ['immobilier', 'immo', 'agence immobilière', 'promoteur'], label: 'Immobilier' },
  { keys: ['conseil', 'consulting', 'consultant', 'cabinet de conseil'], label: 'Conseil & Consulting' },
  { keys: ['santé', 'médical', 'pharma', 'clinique', 'médecin', 'dentiste'], label: 'Santé & Médical' },
  { keys: ['marketing', 'agence', 'communication', 'pub', 'publicité'], label: 'Marketing & Communication' },
  { keys: ['rh', 'ressources humaines', 'recrutement', 'talent', 'paie'], label: 'Ressources Humaines' },
  { keys: ['industrie', 'manufacture', 'usine', 'production', 'btp', 'construction'], label: 'Industrie & BTP' },
  { keys: ['e-commerce', 'ecommerce', 'commerce', 'retail', 'vente', 'boutique'], label: 'E-commerce & Retail' },
  { keys: ['juridique', 'avocat', 'droit', 'cabinet d\'avocat', 'notaire'], label: 'Juridique' },
  { keys: ['assurance', 'courtier', 'mutuelle'], label: 'Assurance' },
  { keys: ['logistique', 'transport', 'supply chain'], label: 'Logistique & Transport' },
];

const POSITIONS = [
  { keys: ['daf', 'directeur financier', 'finance'], label: 'DAF / Directeur financier' },
  { keys: ['dirigeant', 'ceo', 'pdg', 'fondateur', 'gérant', 'patron', 'boss', 'directeur général', 'dg'], label: 'Dirigeant / CEO' },
  { keys: ['drh', 'directeur rh', 'responsable rh', 'rh'], label: 'DRH / Responsable RH' },
  { keys: ['cto', 'directeur technique', 'dsi', 'responsable it'], label: 'CTO / DSI' },
  { keys: ['cmo', 'directeur marketing', 'responsable marketing', 'marketing'], label: 'Directeur Marketing' },
  { keys: ['commercial', 'directeur commercial', 'sales', 'responsable commercial', 'vp sales'], label: 'Directeur Commercial' },
  { keys: ['dg', 'directeur', 'responsable', 'manager', 'head'], label: 'Directeur / Responsable' },
  { keys: ['office manager', 'assistante', 'secrétaire', 'admin'], label: 'Office Manager' },
];

const SIZES = [
  { keys: ['tpe', '1-10', 'micro', 'solo', 'indépendant', 'freelance', 'petite'], label: '1-10 sal.' },
  { keys: ['pme', '11-50', 'petite entreprise', 'moyenne', '10-50', '20-50'], label: '11-50 sal.' },
  { keys: ['eti', '50-200', '51-200', 'grande pme', '100', '50-250'], label: '50-200 sal.' },
  { keys: ['grande', '200+', 'grand compte', '200-500', 'entreprise', '500+'], label: '200+ sal.' },
];

const CHANNELS = [
  { keys: ['email', 'mail', 'e-mail', 'emailing', 'cold email'], label: 'email' },
  { keys: ['linkedin', 'lk', 'réseaux sociaux', 'social selling'], label: 'linkedin' },
  { keys: ['multi', 'les deux', 'email et linkedin', 'multicanal', 'omni', 'les 2', 'email + linkedin'], label: 'multi' },
];

const ZONES = [
  { keys: ['idf', 'île-de-france', 'ile-de-france', 'paris', 'region parisienne'], label: 'Île-de-France' },
  { keys: ['lyon', 'rhône', 'auvergne'], label: 'Lyon / Auvergne-Rhône-Alpes' },
  { keys: ['france', 'france entière', 'national', 'tout le territoire'], label: 'France entière' },
  { keys: ['europe', 'international', 'monde'], label: 'Europe / International' },
  { keys: ['marseille', 'paca', 'sud'], label: 'PACA / Sud' },
];

const ANGLES = [
  { keys: ['douleur', 'pain', 'problème', 'frustration', 'frein'], label: 'Douleur client' },
  { keys: ['preuve', 'social', 'cas client', 'case study', 'témoignage', 'résultat'], label: 'Preuve sociale' },
  { keys: ['curiosité', 'question', 'intrigue'], label: 'Curiosité' },
  { keys: ['événement', 'actualité', 'tendance', 'news'], label: 'Actualité / Événement' },
  { keys: ['direct', 'proposition', 'offre'], label: 'Proposition directe' },
];

function extractParam(text, dict) {
  const lower = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  for (const entry of dict) {
    for (const key of entry.keys) {
      const normalKey = key.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (lower.includes(normalKey)) return entry.label;
    }
  }
  return null;
}

function extractAllParams(text) {
  const found = {};
  const sector = extractParam(text, SECTORS);
  if (sector) found.sector = sector;
  const position = extractParam(text, POSITIONS);
  if (position) found.position = position;
  const size = extractParam(text, SIZES);
  if (size) found.size = size;
  const channel = extractParam(text, CHANNELS);
  if (channel) found.channel = channel;
  const zone = extractParam(text, ZONES);
  if (zone) found.zone = zone;
  const angle = extractParam(text, ANGLES);
  if (angle) found.angle = angle;
  return found;
}

/* ═══ Sequence generation ═══ */

function generateSequence(params) {
  const ch = params.channel || 'email';
  const pos = params.position || 'Dirigeant';
  const sec = (params.sector || 'votre secteur').split(' ')[0].toLowerCase();
  const fn = '{{firstName}}';
  const co = '{{companyName}}';

  if (ch === 'linkedin') {
    return [
      { step: 'L1', type: 'linkedin', label: 'Note de connexion', timing: 'J+0',
        subject: null,
        body: `${fn}, votre parcours dans ${sec} m'a interpellé. J'échange régulièrement avec des ${pos.toLowerCase()}s du secteur sur leurs enjeux de croissance — ravi de connecter.` },
      { step: 'L2', type: 'linkedin', label: 'Message post-connexion', timing: 'J+3',
        subject: null,
        body: `Merci pour la connexion, ${fn} !\n\nJ'ai accompagné plusieurs entreprises de ${sec} à structurer leur acquisition client. Curieux de savoir : quel est votre plus gros défi commercial en ce moment chez ${co} ?` },
    ];
  }

  if (ch === 'multi') {
    return [
      { step: 'E1', type: 'email', label: 'Email initial', timing: 'J+0',
        subject: `${fn}, une question rapide`,
        body: `Bonjour ${fn},\n\nEn échangeant avec des ${pos.toLowerCase()}s dans ${sec}, un sujet revient souvent : le temps perdu sur des tâches qui ne génèrent pas directement de valeur.\n\nC'est aussi un sujet chez ${co} ?` },
      { step: 'L1', type: 'linkedin', label: 'Note de connexion', timing: 'J+2',
        subject: null,
        body: `${fn}, je me suis permis de vous envoyer un email. Ravi d'échanger ici aussi — je travaille avec plusieurs entreprises de ${sec}.` },
      { step: 'E2', type: 'email', label: 'Email valeur', timing: 'J+5',
        subject: `Re: ${sec} — un exemple concret`,
        body: `${fn}, pour illustrer concrètement :\n\nUn de nos clients dans un secteur similaire a augmenté son taux de conversion de 35% en 3 mois en structurant sa prospection.\n\nSi vous avez 15 minutes, je vous montre comment.` },
      { step: 'L2', type: 'linkedin', label: 'Message LinkedIn', timing: 'J+7',
        subject: null,
        body: `${fn}, est-ce que mon dernier email a atterri au bon endroit ? Je travaille avec plusieurs ${pos.toLowerCase()}s dans ${sec} et les résultats sont encourageants. Seriez-vous ouvert à un échange de 10 minutes ?` },
      { step: 'E3', type: 'email', label: 'Email break-up', timing: 'J+12',
        subject: `Dernière tentative, ${fn}`,
        body: `${fn}, je ne vais pas insister davantage.\n\nSi le timing n'est pas bon, aucun souci. Mon offre reste ouverte si vous souhaitez en discuter plus tard.\n\nBonne continuation !` },
    ];
  }

  // Default: email
  return [
    { step: 'E1', type: 'email', label: 'Email initial', timing: 'J+0',
      subject: `${fn}, une question rapide sur ${co}`,
      body: `Bonjour ${fn},\n\nEn échangeant avec des ${pos.toLowerCase()}s dans ${sec}, un sujet revient systématiquement : le temps passé sur des tâches à faible valeur qui freinent la croissance.\n\nC'est aussi un enjeu chez ${co} ?` },
    { step: 'E2', type: 'email', label: 'Email valeur', timing: 'J+3',
      subject: `Re: ${fn} — un cas concret`,
      body: `${fn}, un exemple rapide.\n\nUn de nos clients, une entreprise de ${sec} de taille similaire, a réduit de 40% son temps de prospection tout en augmentant ses résultats de 35%.\n\nSi vous avez 15 minutes cette semaine, je vous montre comment ils ont fait.` },
    { step: 'E3', type: 'email', label: 'Email relance', timing: 'J+7',
      subject: `Autre angle, ${fn}`,
      body: `${fn}, je change d'approche.\n\nPlutôt que de parler d'efficacité, une question : combien de prospects qualifiés votre équipe contacte par mois chez ${co} ?\n\nLa plupart des entreprises de ${sec} que j'accompagne ont doublé ce chiffre en 60 jours.` },
    { step: 'E4', type: 'email', label: 'Email break-up', timing: 'J+12',
      subject: `${fn} — je clos le sujet`,
      body: `${fn}, je ne veux pas encombrer votre boîte.\n\nSi ce n'est pas le bon moment, pas de souci du tout. Mon offre reste ouverte.\n\nBonne continuation !` },
  ];
}

/* ═══ Integrations catalog & API Key management via chat ═══ */

const INTEGRATIONS = {
  // ── Core (required) ──
  lemlistKey: {
    label: 'Lemlist', icon: '✉️', category: 'core', priority: 1,
    regex: null, prefix: null,
    desc: 'Automatisation multi-canal (email + LinkedIn)',
    benefit: 'Envoyer vos séquences de prospection automatiquement, collecter les stats de performance, et déployer les optimisations.',
    howToGet: 'Lemlist → Settings → Integrations → API',
    url: 'https://app.lemlist.com/settings',
  },
  claudeKey: {
    label: 'Claude (Anthropic)', icon: '🤖', category: 'core', priority: 2,
    regex: /\bsk-ant-[a-zA-Z0-9_-]{20,}\b/, prefix: 'sk-ant-',
    desc: 'IA pour la génération et l\'optimisation de copy',
    benefit: 'Générer des séquences de prospection personnalisées, analyser vos performances, et optimiser automatiquement vos messages.',
    howToGet: 'console.anthropic.com → Settings → API Keys',
    url: 'https://console.anthropic.com/settings/keys',
  },
  notionToken: {
    label: 'Notion', icon: '📝', category: 'core', priority: 3,
    regex: /\b(ntn_|secret_)[a-zA-Z0-9_-]{20,}\b/, prefix: 'ntn_ / secret_',
    desc: 'Hub de données et reporting',
    benefit: 'Synchroniser vos campagnes, diagnostics et historiques dans Notion. Avoir un tableau de bord partageable avec votre équipe.',
    howToGet: 'notion.so/my-integrations → Créer une intégration',
    url: 'https://www.notion.so/my-integrations',
  },
  // ── CRM ──
  hubspotKey: {
    label: 'HubSpot', icon: '🟠', category: 'crm', priority: 4,
    regex: /\bpat-[a-zA-Z0-9_-]{20,}\b/, prefix: 'pat-',
    desc: 'CRM et gestion de pipeline commercial',
    benefit: 'Synchroniser automatiquement les prospects intéressés dans votre CRM. Suivre le pipeline du premier contact au closing.',
    howToGet: 'HubSpot → Settings → Integrations → Private Apps → Create',
    url: 'https://app.hubspot.com/private-apps/',
  },
  pipedriveKey: {
    label: 'Pipedrive', icon: '🟢', category: 'crm', priority: 5,
    regex: null, prefix: null,
    desc: 'CRM orienté vente et pipeline',
    benefit: 'Créer automatiquement des deals dans Pipedrive quand un prospect répond positivement. Suivre chaque lead dans votre pipeline.',
    howToGet: 'Pipedrive → Settings → Personal preferences → API',
    url: 'https://app.pipedrive.com/settings/api',
  },
  salesforceKey: {
    label: 'Salesforce', icon: '☁️', category: 'crm', priority: 6,
    regex: null, prefix: null,
    desc: 'CRM entreprise et gestion commerciale',
    benefit: 'Intégrer Bakal dans votre écosystème Salesforce. Créer des leads et opportunités automatiquement.',
    howToGet: 'Salesforce → Setup → Apps → Connected Apps → Consumer Key',
    url: null,
  },
  // ── Enrichment ──
  dropcontactKey: {
    label: 'Dropcontact', icon: '📧', category: 'enrichment', priority: 7,
    regex: null, prefix: null,
    desc: 'Enrichissement d\'emails B2B (RGPD-compliant)',
    benefit: 'Trouver et vérifier les emails professionnels de vos prospects. Conforme RGPD, données fraîches, taux de fiabilité >98%.',
    howToGet: 'Dropcontact → Dashboard → API → API Key',
    url: 'https://app.dropcontact.com/app/settings/api',
  },
  apolloKey: {
    label: 'Apollo.io', icon: '🚀', category: 'enrichment', priority: 8,
    regex: null, prefix: null,
    desc: 'Base de données B2B + enrichissement',
    benefit: 'Accéder à +275M de contacts B2B. Trouver des prospects par secteur, poste, taille d\'entreprise et zone géographique.',
    howToGet: 'Apollo → Settings → Integrations → API Keys',
    url: 'https://app.apollo.io/#/settings/integrations/api',
  },
  hunterKey: {
    label: 'Hunter.io', icon: '🔍', category: 'enrichment', priority: 9,
    regex: null, prefix: null,
    desc: 'Recherche et vérification d\'emails',
    benefit: 'Trouver les emails de n\'importe quel professionnel. Vérifier la validité des adresses avant l\'envoi pour protéger votre délivrabilité.',
    howToGet: 'Hunter → Dashboard → API → Your API Key',
    url: 'https://hunter.io/api-keys',
  },
  // ── Calendar ──
  calendlyKey: {
    label: 'Calendly', icon: '📅', category: 'calendar', priority: 10,
    regex: null, prefix: null,
    desc: 'Prise de rendez-vous automatisée',
    benefit: 'Générer automatiquement des liens de RDV dans vos séquences. Tracker les rendez-vous pris directement dans Bakal.',
    howToGet: 'Calendly → Integrations → API & Webhooks → Personal Access Token',
    url: 'https://calendly.com/integrations/api_webhooks',
  },
};

const CATEGORY_INFO = {
  core:       { label: 'Essentiels', desc: 'Les 3 outils de base pour faire fonctionner Bakal', icon: '⚡' },
  crm:        { label: 'CRM', desc: 'Synchronisez vos leads dans votre CRM existant', icon: '📊' },
  enrichment: { label: 'Enrichissement', desc: 'Trouvez et vérifiez les données de vos prospects', icon: '🔎' },
  calendar:   { label: 'Calendrier', desc: 'Automatisez la prise de rendez-vous', icon: '📅' },
};

function detectApiKeyInText(text) {
  for (const [field, info] of Object.entries(INTEGRATIONS)) {
    if (info.regex && info.regex.test(text)) {
      return { field, value: text.match(info.regex)[0] };
    }
  }
  if (_conv.apiKeyField && text.trim().length >= 10 && !text.includes(' ')) {
    return { field: _conv.apiKeyField, value: text.trim() };
  }
  return null;
}

function isApiKeyIntent(lower) {
  return (
    (lower.includes('clé') || lower.includes('cle') || lower.includes('key') || lower.includes('api') || lower.includes('token')) &&
    (lower.includes('configur') || lower.includes('ajouter') || lower.includes('ajout') ||
     lower.includes('saisir') || lower.includes('entrer') || lower.includes('mettre') ||
     lower.includes('connecter') || lower.includes('paramètre') || lower.includes('parametre') ||
     lower.includes('setup') || lower.includes('modifier') || lower.includes('changer'))
  ) || (
    lower.includes('configurer') && detectWhichKey(lower)
  ) || (
    lower.match(/\b(intégration|integration|onboarding|connecter|outils)\b/) &&
    lower.match(/\b(configur|ajouter|démarrer|commencer|setup|lancer)\b/)
  );
}

function isOnboardingIntent(lower) {
  return (
    lower.match(/\b(onboarding|démarrer|commencer|setup|configurer tout|tout configurer|guide|guidé)\b/) ||
    (lower.includes('intégration') && lower.match(/\b(toutes|tout|tous|lister|voir|quelles)\b/)) ||
    (lower.includes('outil') && lower.match(/\b(connecter|disponible|proposez|lesquels|quels)\b/)) ||
    lower.match(/\b(quels?.outils|quelles?.intégrations)\b/)
  );
}

function detectWhichKey(lower) {
  if (lower.includes('lemlist')) return 'lemlistKey';
  if (lower.includes('notion')) return 'notionToken';
  if (lower.includes('claude') || lower.includes('anthropic')) return 'claudeKey';
  if (lower.includes('hubspot')) return 'hubspotKey';
  if (lower.includes('pipedrive')) return 'pipedriveKey';
  if (lower.includes('salesforce')) return 'salesforceKey';
  if (lower.includes('dropcontact')) return 'dropcontactKey';
  if (lower.includes('apollo')) return 'apolloKey';
  if (lower.includes('hunter')) return 'hunterKey';
  if (lower.includes('calendly')) return 'calendlyKey';
  // Category-level detection
  if (lower.match(/\bcrm\b/)) return '_category_crm';
  if (lower.match(/\b(enrichi|enrichment|données prospect|trouver.*email)\b/)) return '_category_enrichment';
  if (lower.match(/\b(calendrier|rdv|rendez.?vous|booking)\b/)) return '_category_calendar';
  return null;
}

async function saveApiKeyViaChat(field, value) {
  if (typeof BakalAPI === 'undefined' || !_backendAvailable) {
    return { ok: false, error: 'Backend non disponible. Configurez vos clés dans **Paramètres** quand le serveur sera connecté.' };
  }
  try {
    const result = await BakalAPI.saveKeys({ [field]: value });
    if (result.errors && result.errors.length > 0) {
      return { ok: false, error: result.errors[0] };
    }
    try {
      const testResult = await BakalAPI.testKeys();
      const status = testResult.results?.[field];
      if (status?.status === 'connected') return { ok: true, tested: true };
      if (status?.status === 'invalid') return { ok: true, tested: false, warning: 'Clé sauvegardée mais le test de connexion a échoué — vérifiez que la clé est correcte.' };
      return { ok: true, tested: false, warning: status?.message || null };
    } catch {
      return { ok: true, tested: false };
    }
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/* ── Onboarding flow ── */

function handleOnboardingStart() {
  _conv.stage = 'api_keys';
  _conv.apiKeyField = null;
  _conv.onboardingStep = 'overview';

  let msg = `Bienvenue dans la configuration de Bakal ! Voici les outils que vous pouvez connecter :\n\n`;

  for (const [catKey, catInfo] of Object.entries(CATEGORY_INFO)) {
    const tools = Object.entries(INTEGRATIONS).filter(([, v]) => v.category === catKey);
    msg += `**${catInfo.icon} ${catInfo.label}** — ${catInfo.desc}\n`;
    tools.forEach(([, tool]) => {
      msg += `  ${tool.icon} ${tool.label} — ${tool.desc}\n`;
    });
    msg += '\n';
  }

  msg += `---\n\n`;
  msg += `Par où voulez-vous commencer ?\n\n`;
  msg += `- **Essentiels** — Configurez Lemlist, Claude et Notion (recommandé pour démarrer)\n`;
  msg += `- **CRM** — Connectez HubSpot, Pipedrive ou Salesforce\n`;
  msg += `- **Enrichissement** — Dropcontact, Apollo ou Hunter\n`;
  msg += `- **Calendrier** — Calendly pour la prise de RDV\n`;
  msg += `- Ou nommez directement un outil (ex: "HubSpot")\n`;

  return { content: msg };
}

function handleCategoryExplain(category) {
  const catInfo = CATEGORY_INFO[category];
  const tools = Object.entries(INTEGRATIONS).filter(([, v]) => v.category === category);

  let msg = `**${catInfo.icon} ${catInfo.label}** — ${catInfo.desc}\n\n`;

  tools.forEach(([field, tool]) => {
    msg += `### ${tool.icon} ${tool.label}\n`;
    msg += `${tool.benefit}\n\n`;
    msg += `📋 Où trouver la clé : *${tool.howToGet}*\n\n`;
  });

  msg += `Quel outil souhaitez-vous connecter ? Ou tapez **suivant** pour voir une autre catégorie.`;

  _conv.stage = 'api_keys';
  _conv.apiKeyField = null;
  return { content: msg };
}

function handleToolExplain(field) {
  const tool = INTEGRATIONS[field];
  if (!tool) return { content: `Outil non reconnu.` };

  _conv.stage = 'api_keys';
  _conv.apiKeyField = field;

  let msg = `### ${tool.icon} ${tool.label}\n\n`;
  msg += `**Ce que ça permet :** ${tool.benefit}\n\n`;
  msg += `**Comment obtenir la clé :**\n`;
  msg += `1. Allez sur *${tool.howToGet}*\n`;
  if (tool.url) msg += `2. Lien direct : ${tool.url}\n`;
  msg += `3. Copiez la clé et collez-la ici\n\n`;
  if (tool.prefix) {
    msg += `Format attendu : commence par \`${tool.prefix}\`\n\n`;
  }
  msg += `Collez votre clé ci-dessous, ou tapez **passer** pour continuer sans configurer.`;

  return { content: msg };
}

function handleApiKeyIntent(text) {
  const lower = text.toLowerCase();

  // Check for onboarding / overview intent
  if (isOnboardingIntent(lower)) {
    return handleOnboardingStart();
  }

  const detected = detectWhichKey(lower);

  // Category-level redirect
  if (detected && detected.startsWith('_category_')) {
    return handleCategoryExplain(detected.replace('_category_', ''));
  }

  // Specific tool
  if (detected) {
    return handleToolExplain(detected);
  }

  // Generic "configure API keys" — show overview
  return handleOnboardingStart();
}

async function handleApiKeyInput(text) {
  const lower = text.toLowerCase();

  // Cancel / go back
  if (lower.match(/\b(annuler|cancel|retour|sortir|quitter)\b/)) {
    _conv.stage = 'init';
    _conv.apiKeyField = null;
    return { content: `Configuration terminée. Que puis-je faire d'autre ?` };
  }

  // "Skip" / "passer" current tool
  if (lower.match(/\b(passer|skip|sauter|plus tard|later)\b/)) {
    if (_conv.apiKeyField) {
      const skipped = INTEGRATIONS[_conv.apiKeyField]?.label || '';
      _conv.apiKeyField = null;
      return { content: `OK, on passe ${skipped}. Quel autre outil souhaitez-vous configurer ? Ou tapez **terminé** pour finir.` };
    }
    _conv.apiKeyField = null;
    return { content: `Quel outil souhaitez-vous configurer ? Tapez **terminé** pour finir.` };
  }

  // Category selection
  const catMatch = lower.match(/\b(essentiel|core|crm|enrichi|calendar|calendrier)\b/);
  if (catMatch && !_conv.apiKeyField) {
    const catMap = { essentiel: 'core', core: 'core', crm: 'crm', enrichi: 'enrichment', calendar: 'calendar', calendrier: 'calendar' };
    const cat = catMap[catMatch[1]];
    if (cat) return handleCategoryExplain(cat);
  }

  // Tool selection by name
  const toolKey = detectWhichKey(lower);
  if (toolKey && !toolKey.startsWith('_category_') && toolKey !== _conv.apiKeyField) {
    return handleToolExplain(toolKey);
  }
  if (toolKey && toolKey.startsWith('_category_')) {
    return handleCategoryExplain(toolKey.replace('_category_', ''));
  }

  // Try to detect a pasted key
  const detectedKey = detectApiKeyInText(text);
  if (detectedKey) {
    const tool = INTEGRATIONS[detectedKey.field];
    const result = await saveApiKeyViaChat(detectedKey.field, detectedKey.value);

    if (!result.ok) {
      return { content: `Erreur pour **${tool.label}** : ${result.error}` };
    }

    let msg = `${tool.icon} Clé **${tool.label}** sauvegardée et chiffrée.`;
    if (result.tested) {
      msg += ` Connexion **réussie** !`;
    } else if (result.warning) {
      msg += `\n\n⚠️ ${result.warning}`;
    }

    _conv.apiKeyField = null;
    msg += `\n\nVoulez-vous configurer un autre outil, ou avez-vous **terminé** ?`;
    return { content: msg };
  }

  // "Yes" / "another" / continue
  if (lower.match(/\b(oui|yes|autre|encore|suivant|next|continuer)\b/)) {
    _conv.apiKeyField = null;
    return handleOnboardingStart();
  }

  // "Done" / "finished"
  if (lower.match(/\b(non|no|fini|terminé|c'est bon|rien|stop)\b/)) {
    _conv.stage = 'init';
    _conv.apiKeyField = null;
    return { content: `Parfait, la configuration est terminée ! Que puis-je faire d'autre pour vous ?` };
  }

  // Didn't detect a valid key
  if (_conv.apiKeyField) {
    const tool = INTEGRATIONS[_conv.apiKeyField];
    return { content: `Je n'ai pas pu détecter une clé **${tool.label}** valide. Collez la clé complète (sans espaces).\n\nOù la trouver : *${tool.howToGet}*\n\nOu tapez **passer** pour continuer sans configurer.` };
  }

  return { content: `Dites-moi quel outil configurer, ou tapez **intégrations** pour voir la liste complète.` };
}

/* ═══ Local response logic ═══ */

function buildResponse(userText) {
  const text = userText.trim();
  const lower = text.toLowerCase();

  _conv.history.push({ role: 'user', content: text });

  // API key management — detect intent or continue key flow
  if (_conv.stage === 'api_keys') {
    // handleApiKeyInput is async — mark response as pending
    return { content: null, _asyncApiKey: true, _text: text };
  }

  // Detect onboarding / integration overview intent
  if (_conv.stage !== 'confirm' && isOnboardingIntent(lower)) {
    const response = handleOnboardingStart();
    _conv.history.push({ role: 'assistant', content: response.content });
    return response;
  }

  // Detect API key intent from any stage (except confirm)
  if (_conv.stage !== 'confirm' && (isApiKeyIntent(lower) || detectApiKeyInText(text))) {
    const detected = detectApiKeyInText(text);
    if (detected) {
      _conv.stage = 'api_keys';
      return { content: null, _asyncApiKey: true, _text: text };
    }
    const response = handleApiKeyIntent(text);
    _conv.history.push({ role: 'assistant', content: response.content });
    return response;
  }

  // Detect "go to settings" intent
  if (lower.match(/\b(paramètre|parametre|settings|réglage|reglage)\b/) && !lower.includes('campagne')) {
    const response = { content: `Vous pouvez configurer vos intégrations et préférences dans **Paramètres**, ou directement ici dans le chat.\n\nVoulez-vous :\n- **Voir les intégrations** disponibles (tapez "intégrations")\n- **Configurer une clé** API spécifique\n- **Créer une campagne** à la place` };
    _conv.history.push({ role: 'assistant', content: response.content });
    return response;
  }

  const newParams = extractAllParams(text);
  Object.assign(_conv.params, newParams);

  let response;

  if (_conv.stage === 'init' && (lower.includes('optimi') || lower.includes('sous-performe') || lower.includes('améliorer'))) {
    response = handleOptimizationQuery(text);
  } else if (_conv.stage === 'init' && (lower.includes('angle') || lower.includes('approche')) && lower.includes('secteur')) {
    response = handleAngleQuery(text);
  } else if (_conv.stage === 'confirm') {
    response = handleConfirmation(text);
  } else {
    if (_conv.stage === 'done') {
      resetConversation();
      const np = extractAllParams(text);
      Object.assign(_conv.params, np);
    }

    if (!_conv.threadTitle) {
      _conv.threadTitle = text.length > 50 ? text.slice(0, 47) + '...' : text;
    }

    _conv.stage = 'gathering';

    const missing = getMissingParams();
    if (missing.length === 0) {
      response = proposeCampaign();
    } else {
      response = askForParam(missing[0]);
    }
  }

  _conv.history.push({ role: 'assistant', content: response.content, metadata: response.metadata });
  return response;
}

function getMissingParams() {
  const required = ['sector', 'position'];
  const nice = ['channel', 'zone', 'size'];
  const missing = [];

  for (const p of required) {
    if (!_conv.params[p] && !_conv.asked.includes(p)) missing.push(p);
  }
  let optionalAsked = 0;
  for (const p of nice) {
    if (!_conv.params[p] && !_conv.asked.includes(p) && optionalAsked < 2) {
      missing.push(p);
      optionalAsked++;
    }
  }
  return missing;
}

function askForParam(param) {
  _conv.asked.push(param);

  let ack = '';
  const p = _conv.params;
  if (Object.keys(p).length > 0) {
    const parts = [];
    if (p.sector) parts.push(`secteur **${p.sector}**`);
    if (p.position) parts.push(`cible **${p.position}**`);
    if (p.size) parts.push(`entreprises de **${p.size}**`);
    if (p.channel) parts.push(`canal **${p.channel}**`);
    if (p.zone) parts.push(`zone **${p.zone}**`);
    if (parts.length > 0) ack = `Bien noté : ${parts.join(', ')}.\n\n`;
  }

  const questions = {
    sector: `${ack}Quel **secteur d'activité** souhaitez-vous cibler ?\n\nPar exemple : Tech & SaaS, Comptabilité, Formation, Immobilier, Conseil, Industrie, E-commerce...`,
    position: `${ack}Quel **poste / fonction** visez-vous chez vos prospects ?\n\nPar exemple : Dirigeant / CEO, DAF, DRH, CTO, Directeur Commercial, Directeur Marketing...`,
    channel: `${ack}Quel **canal** souhaitez-vous utiliser ?\n\n- **Email** — séquence de 4 emails (initial, valeur, relance, break-up)\n- **LinkedIn** — note de connexion + message post-connexion\n- **Multi** — email + LinkedIn combinés (5 touchpoints)`,
    zone: `${ack}Quelle **zone géographique** ciblez-vous ?\n\nPar exemple : Île-de-France, France entière, Lyon / Rhône-Alpes, PACA...`,
    size: `${ack}Quelle **taille d'entreprise** ciblez-vous ?\n\n- 1-10 salariés (TPE)\n- 11-50 salariés (PME)\n- 50-200 salariés (ETI)\n- 200+ salariés (Grandes entreprises)`,
  };

  return { content: questions[param] || `${ack}Pouvez-vous me donner plus de détails sur votre cible ?` };
}

function proposeCampaign() {
  _conv.stage = 'confirm';

  const p = _conv.params;
  if (!p.channel) p.channel = 'email';
  if (!p.zone) p.zone = 'France entière';
  if (!p.size) p.size = '11-50 sal.';
  if (!p.angle) p.angle = 'Douleur client';
  if (!p.tone) p.tone = 'Pro décontracté';

  const name = buildCampaignName(p);
  const sequence = generateSequence(p);

  const channelLabels = { email: 'Email (4 touchpoints)', linkedin: 'LinkedIn (2 touchpoints)', multi: 'Email + LinkedIn (5 touchpoints)' };

  let recap = `Voici ce que je vous propose :\n\n`;
  recap += `**${name}**\n\n`;
  recap += `- Secteur : **${p.sector}**\n`;
  recap += `- Cible : **${p.position}**\n`;
  recap += `- Taille : **${p.size}**\n`;
  recap += `- Zone : **${p.zone}**\n`;
  recap += `- Canal : **${channelLabels[p.channel] || p.channel}**\n`;
  recap += `- Angle : **${p.angle}**\n`;
  recap += `- Ton : **${p.tone}** · Vouvoiement\n\n`;
  recap += `La séquence contient **${sequence.length} touchpoints** avec des messages personnalisés pour votre cible.\n\n`;
  recap += `Voulez-vous **créer cette campagne** ? Vous pourrez ensuite modifier chaque message dans l'éditeur de séquences.`;

  const campaign = { name, sector: p.sector, position: p.position, size: p.size, channel: p.channel, zone: p.zone, angle: p.angle, tone: p.tone, sequence };

  return { content: recap, metadata: { action: 'create_campaign', campaign } };
}

function handleConfirmation(text) {
  const lower = text.toLowerCase();

  if (lower.match(/\b(oui|ok|go|créer|crée|valide|parfait|c'est bon|on y va|lance|top|génial|super|d'accord|allons-y|confirme|yes)\b/)) {
    _conv.stage = 'done';
    return { content: `La campagne est en cours de création...`, _autoCreate: true };
  }

  if (lower.match(/\b(modif|chang|ajust|plutôt|prefer|non|pas|autre|different)\b/)) {
    const newParams = extractAllParams(text);
    if (Object.keys(newParams).length > 0) {
      Object.assign(_conv.params, newParams);
      return proposeCampaign();
    }
    _conv.stage = 'gathering';
    return { content: `Bien sûr. Qu'est-ce que vous souhaitez changer ?\n\nVous pouvez modifier le secteur, la cible, le canal, la zone, la taille d'entreprise, ou l'angle d'approche.` };
  }

  return { content: `Souhaitez-vous créer cette campagne telle quelle, ou préférez-vous modifier quelque chose ?` };
}

function handleOptimizationQuery(text) {
  const campaigns = Object.values(typeof BAKAL !== 'undefined' ? BAKAL.campaigns : {});
  if (campaigns.length === 0) {
    return { content: `Vous n'avez pas encore de campagne active. Voulez-vous en créer une ? Décrivez-moi votre cible idéale.` };
  }

  const active = campaigns.filter(c => c.status === 'active');
  let response = `Voici un résumé de vos campagnes actives :\n\n`;
  active.forEach(c => {
    const open = c.kpis.openRate || c.kpis.acceptRate || '—';
    const reply = c.kpis.replyRate || '—';
    response += `**${c.name}** (${c.channelLabel})\n`;
    response += `- ${c.kpis.contacts} contacts · Ouverture: ${open}% · Réponse: ${reply}%\n`;
    if (c.diagnostics && c.diagnostics.length > 0) {
      const warning = c.diagnostics.find(d => d.level === 'warning');
      if (warning) response += `- Point d'attention : ${warning.text.replace(/<[^>]*>/g, '').slice(0, 120)}...\n`;
    }
    response += '\n';
  });
  response += `Pour optimiser une campagne spécifique, allez dans **Recommandations** depuis le menu, ou dites-moi laquelle vous intéresse.`;
  return { content: response };
}

function handleAngleQuery(text) {
  const sector = extractParam(text, SECTORS) || 'Tech';
  return {
    content: `Pour le secteur **${sector}**, voici les angles qui fonctionnent le mieux d'après nos données :\n\n1. **Douleur client** — Question directe sur un problème connu du secteur. Meilleur taux de réponse en général (+2-3pts vs moyenne).\n2. **Preuve sociale** — Case study d'un client similaire avec des chiffres concrets. Très efficace en follow-up.\n3. **Curiosité** — Question ouverte intrigante qui pousse à la réponse. Bon sur les profils senior.\n\nL'angle "proposition directe" est à éviter en premier contact — il fonctionne mieux après un échange.\n\nVoulez-vous que je crée une campagne avec un de ces angles ?`
  };
}

function buildCampaignName(p) {
  const pos = (p.position || 'Prospects').split('/')[0].trim();
  const sec = (p.sector || '').split('&')[0].trim().split(' ')[0];
  const zone = (p.zone || '').split('/')[0].trim();
  if (zone && zone !== 'France entière') {
    return `${pos} ${sec} ${zone}`;
  }
  return `${pos} ${sec}`;
}

/* ═══ Campaign creation (shared by both modes) ═══ */

function createCampaignLocally(campaignData) {
  if (typeof BAKAL === 'undefined') return null;

  const id = campaignData.name
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

  const channelMap = {
    email: { label: 'Email', color: 'var(--blue)' },
    linkedin: { label: 'LinkedIn', color: 'var(--purple)' },
    multi: { label: 'Multi', color: 'var(--orange)' },
  };
  const ch = channelMap[campaignData.channel] || channelMap.email;

  BAKAL.campaigns[id] = {
    id,
    name: campaignData.name,
    client: 'Mon entreprise',
    status: 'prep',
    channel: campaignData.channel || 'email',
    channelLabel: ch.label,
    channelColor: ch.color,
    sector: campaignData.sector || '',
    sectorShort: (campaignData.sector || '').split(' ')[0],
    position: campaignData.position || '',
    size: campaignData.size || '',
    angle: campaignData.angle || '',
    zone: campaignData.zone || '',
    tone: campaignData.tone || 'Pro décontracté',
    formality: 'Vous',
    length: 'Standard',
    cta: 'Question ouverte',
    volume: { sent: 0, planned: 200 },
    iteration: 0,
    startDate: new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }),
    lemlistRef: null,
    nextAction: null,
    kpis: { contacts: 0, openRate: null, replyRate: null, interested: null, meetings: null },
    sequence: (campaignData.sequence || []).map(s => ({
      id: s.step, type: s.type, label: s.label || '', timing: s.timing || '',
      subType: '', subject: s.subject || null, body: s.body || '',
      stats: null,
    })),
    diagnostics: [],
    history: [],
    prepChecklist: [
      { label: 'Vérifier les messages dans l\'éditeur', done: false },
      { label: 'Configurer la liste de prospects dans Lemlist', done: false },
      { label: 'Tester l\'email de délivrabilité', done: false },
      { label: 'Lancer la campagne', done: false },
    ],
    info: {
      period: 'Pas encore lancée',
      copyDesc: `${campaignData.tone || 'Pro décontracté'} · Vous · Standard · CTA question ouverte · FR`,
      channelsDesc: ch.label,
      launchEstimate: 'En préparation',
    },
  };

  // Register in copy editor
  if (typeof registerCampaignInEditor === 'function') {
    registerCampaignInEditor(id, BAKAL.campaigns[id]);
  }

  // Re-render dashboard
  if (typeof initFromData === 'function') initFromData();

  return id;
}

/* ═══ Thread management (local fallback) ═══ */

let _localThreads = [];
let _localThreadIdCounter = 1;

function createLocalThread(title) {
  const thread = {
    id: _localThreadIdCounter++,
    title: title || 'Nouvelle conversation',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  _localThreads.unshift(thread);
  return thread;
}

function deleteLocalThread(id) {
  _localThreads = _localThreads.filter(t => t.id !== id);
}

/* ═══ Hybrid integration with chat.js ═══ */

function patchChatHybrid() {
  // Store references to original chat.js functions
  const _origSendChatMessage = window.sendChatMessage;
  const _origCreateCampaignFromChat = window.createCampaignFromChat;
  const _origLoadChatThreads = window.loadChatThreads;
  const _origNewChatThread = window.newChatThread;
  const _origSelectChatThread = window.selectChatThread;
  const _origDeleteChatThread = window.deleteChatThread;

  /* ─── sendChatMessage: backend (Claude API) or local engine ─── */
  window.sendChatMessage = async function(overrideText) {
    // Backend available → use Claude API via backend
    if (_backendAvailable && typeof BakalAPI !== 'undefined') {
      return _origSendChatMessage.call(this, overrideText);
    }

    // Offline → local engine
    if (_chatSending) return;

    const input = document.getElementById('chatInput');
    const text = overrideText || input.value.trim();
    if (!text) return;

    if (!overrideText) {
      input.value = '';
      autoResizeChatInput(input);
    }

    // Create local thread if needed
    if (!_chatThreadId) {
      const thread = createLocalThread(text.slice(0, 60));
      _chatThreadId = thread.id;
      _chatThreads = _localThreads;
      renderChatThreadList();
      resetConversation();
    }

    appendMessage('user', text);
    showTypingIndicator();
    _chatSending = true;
    updateSendButton();

    let response = buildResponse(text);

    // Handle async API key operations
    if (response._asyncApiKey) {
      response = await handleApiKeyInput(response._text);
      _conv.history.push({ role: 'assistant', content: response.content });
    }

    // Typing delay proportional to response length
    const delay = Math.min(600 + response.content.length * 3, 2000);
    await new Promise(r => setTimeout(r, delay));

    hideTypingIndicator();
    appendMessage('assistant', response.content, response.metadata);

    // Update thread title
    if (_conv.threadTitle) {
      const thread = _localThreads.find(t => t.id === _chatThreadId);
      if (thread) {
        thread.title = _conv.threadTitle;
        thread.updated_at = new Date().toISOString();
        renderChatThreadList();
      }
    }

    // Handle auto-create (user said "oui" to campaign proposal)
    if (response._autoCreate) {
      const lastMeta = getLastCampaignMetadata();
      if (lastMeta) {
        setTimeout(() => {
          const id = createCampaignLocally(lastMeta);
          if (id) {
            appendMessage('assistant', `Campagne **"${lastMeta.name}"** créée avec succès !\nRedirection vers l'éditeur de séquences...`);
            setTimeout(() => showPage('copyeditor'), 1200);
          }
        }, 500);
      }
    }

    _chatSending = false;
    updateSendButton();
    input.focus();
  };

  /* ─── createCampaignFromChat: action card button handler ─── */
  window.createCampaignFromChat = async function(campaignData) {
    // Backend available → create via API, then generate AI sequence
    if (_backendAvailable && typeof BakalAPI !== 'undefined') {
      try {
        // Step 1: Create the campaign in the backend
        const result = await BakalAPI.request('/chat/threads/' + (_chatThreadId || 0) + '/create-campaign', {
          method: 'POST',
          body: JSON.stringify({ campaign: campaignData }),
        });

        const backendId = result.campaign ? result.campaign.id : null;

        // Step 2: Generate AI sequence for this campaign
        if (backendId) {
          appendMessage('assistant', `Campagne **"${campaignData.name}"** créée. Génération de la séquence par Claude en cours...`);

          try {
            const seqResult = await BakalAPI.generateSequence({
              campaignId: backendId,
              sector: campaignData.sector,
              position: campaignData.position,
              channel: campaignData.channel || 'email',
              size: campaignData.size,
              angle: campaignData.angle,
              tone: campaignData.tone,
              formality: campaignData.formality || 'Vous',
              zone: campaignData.zone,
              valueProp: campaignData.valueProp,
              painPoints: campaignData.painPoints,
            });

            // Update local campaign data with AI-generated sequence
            if (seqResult.sequence && seqResult.sequence.length > 0) {
              campaignData.sequence = seqResult.sequence;
            }

            const id = createCampaignLocally(campaignData);
            appendMessage('assistant', `Séquence de **${(seqResult.sequence || []).length} touchpoints** générée par Claude !\n\n${seqResult.strategy || ''}\n\nRedirection vers l'éditeur de séquences...`);
            setTimeout(() => showPage('copyeditor'), 1500);
            return;
          } catch (aiErr) {
            console.warn('AI sequence generation failed:', aiErr.message);
            // Still created the campaign, just with local sequences
          }
        }

        const id = createCampaignLocally(campaignData);
        appendMessage('assistant', `Campagne **"${campaignData.name}"** créée avec succès !\nRedirection vers l'éditeur de séquences...`);
        setTimeout(() => showPage('copyeditor'), 1200);
        return;
      } catch (err) {
        console.warn('Backend campaign creation failed, falling back to local:', err.message);
      }
    }

    // Offline fallback → create locally
    const id = createCampaignLocally(campaignData);
    if (id) {
      appendMessage('assistant', `Campagne **"${campaignData.name}"** créée !\nRedirection vers l'éditeur de séquences...`);
      setTimeout(() => showPage('copyeditor'), 1200);
    } else {
      appendMessage('assistant', 'Erreur lors de la création. Essayez via le bouton **+ Nouvelle campagne** du dashboard.');
    }
  };

  /* ─── Thread management: backend or local ─── */
  window.loadChatThreads = function() {
    if (_backendAvailable && typeof BakalAPI !== 'undefined') {
      return _origLoadChatThreads.call(this);
    }
    _chatThreads = _localThreads;
    renderChatThreadList();
  };

  window.newChatThread = function() {
    if (_backendAvailable && typeof BakalAPI !== 'undefined') {
      return _origNewChatThread.call(this);
    }
    _chatThreadId = null;
    resetConversation();
    showChatWelcome();
  };

  window.selectChatThread = function(threadId) {
    if (_backendAvailable && typeof BakalAPI !== 'undefined') {
      return _origSelectChatThread.call(this, threadId);
    }
    _chatThreadId = threadId;
    renderChatThreadList();
    showChatWelcome();
  };

  window.deleteChatThread = function(threadId, e) {
    if (e) e.stopPropagation();
    if (_backendAvailable && typeof BakalAPI !== 'undefined') {
      return _origDeleteChatThread.call(this, threadId, e);
    }
    deleteLocalThread(threadId);
    if (_chatThreadId === threadId) {
      _chatThreadId = null;
      resetConversation();
      showChatWelcome();
    }
    _chatThreads = _localThreads;
    renderChatThreadList();
  };
}

function getLastCampaignMetadata() {
  for (let i = _conv.history.length - 1; i >= 0; i--) {
    if (_conv.history[i].metadata?.campaign) return _conv.history[i].metadata.campaign;
  }
  if (_conv.params.sector && _conv.params.position) {
    const p = _conv.params;
    return {
      name: buildCampaignName(p),
      sector: p.sector,
      position: p.position,
      size: p.size || '11-50 sal.',
      channel: p.channel || 'email',
      zone: p.zone || 'France entière',
      angle: p.angle || 'Douleur client',
      tone: p.tone || 'Pro décontracté',
      sequence: generateSequence(p),
    };
  }
  return null;
}

/* ═══ Init ═══ */

document.addEventListener('DOMContentLoaded', () => {
  patchChatHybrid();
});

if (document.readyState !== 'loading') {
  patchChatHybrid();
}
