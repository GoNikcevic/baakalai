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
    desc: 'CRM tout-en-un (marketing, ventes, service)',
    benefit: 'Synchroniser automatiquement les prospects intéressés dans votre CRM. Suivre le pipeline du premier contact au closing. Tier gratuit disponible.',
    howToGet: 'HubSpot → Settings → Integrations → Private Apps → Create',
    url: 'https://app.hubspot.com/private-apps/',
  },
  pipedriveKey: {
    label: 'Pipedrive', icon: '🟢', category: 'crm', priority: 5,
    regex: null, prefix: null,
    desc: 'CRM orienté vente et pipeline',
    benefit: 'Créer automatiquement des deals quand un prospect répond positivement. Interface visuelle du pipeline. Idéal pour les équipes de 1 à 20 commerciaux.',
    howToGet: 'Pipedrive → Settings → Personal preferences → API',
    url: 'https://app.pipedrive.com/settings/api',
  },
  folkKey: {
    label: 'Folk', icon: '👥', category: 'crm', priority: 6,
    regex: null, prefix: null,
    desc: 'CRM relationnel, simple et moderne',
    benefit: 'CRM léger pensé pour les petites équipes. Import de contacts LinkedIn en 1 clic, pipeline visuel, et intégrations natives avec les outils de prospection.',
    howToGet: 'Folk → Settings → API → Generate Token',
    url: 'https://app.folk.app/settings',
  },
  salesforceKey: {
    label: 'Salesforce', icon: '☁️', category: 'crm', priority: 7,
    regex: null, prefix: null,
    desc: 'CRM entreprise et gestion commerciale',
    benefit: 'Intégrer Bakal dans votre écosystème Salesforce. Créer des leads et opportunités automatiquement. Pour les équipes 50+ ou les process complexes.',
    howToGet: 'Salesforce → Setup → Apps → Connected Apps → Consumer Key',
    url: null,
  },
  // ── Enrichment ──
  dropcontactKey: {
    label: 'Dropcontact', icon: '📧', category: 'enrichment', priority: 8,
    regex: null, prefix: null,
    desc: 'Enrichissement email B2B — 100% RGPD, made in France',
    benefit: 'Trouver et vérifier les emails pros de vos prospects. Conforme RGPD (audité CNIL), données fraîches, taux de fiabilité >98%. Le standard en France.',
    howToGet: 'Dropcontact → Dashboard → API → API Key',
    url: 'https://app.dropcontact.com/app/settings/api',
    recommended: true,
  },
  apolloKey: {
    label: 'Apollo.io', icon: '🚀', category: 'enrichment', priority: 9,
    regex: null, prefix: null,
    desc: 'Base de données B2B (275M+ contacts) + enrichissement',
    benefit: 'Trouver des prospects par secteur, poste, taille d\'entreprise et zone géo. Enrichir les données. Séquençage intégré. Tier gratuit généreux.',
    howToGet: 'Apollo → Settings → Integrations → API Keys',
    url: 'https://app.apollo.io/#/settings/integrations/api',
  },
  hunterKey: {
    label: 'Hunter.io', icon: '🔍', category: 'enrichment', priority: 10,
    regex: null, prefix: null,
    desc: 'Recherche et vérification d\'emails',
    benefit: 'Trouver les emails de n\'importe quel pro à partir du nom + entreprise. Vérifier la validité avant envoi. 25 recherches/mois gratuites.',
    howToGet: 'Hunter → Dashboard → API → Your API Key',
    url: 'https://hunter.io/api-keys',
  },
  kasprKey: {
    label: 'Kaspr', icon: '📱', category: 'enrichment', priority: 11,
    regex: null, prefix: null,
    desc: 'Emails et téléphones depuis LinkedIn',
    benefit: 'Extension Chrome pour récupérer emails et numéros de téléphone directement depuis les profils LinkedIn. 395M+ de contacts. Idéal en combinaison avec Waalaxy.',
    howToGet: 'Kaspr → Dashboard → API → Generate Key',
    url: 'https://app.kaspr.io/settings',
  },
  lushaKey: {
    label: 'Lusha', icon: '📇', category: 'enrichment', priority: 12,
    regex: null, prefix: null,
    desc: 'Données de contact B2B vérifiées (RGPD/CCPA)',
    benefit: 'Données de contact directes (email + téléphone). Enrichissement de listes en masse. Extension navigateur. Conforme RGPD et CCPA.',
    howToGet: 'Lusha → Settings → API → Access Token',
    url: 'https://app.lusha.com/settings',
  },
  snovKey: {
    label: 'Snov.io', icon: '🎯', category: 'enrichment', priority: 13,
    regex: null, prefix: null,
    desc: 'Email finder + vérificateur + séquences',
    benefit: 'Tout-en-un : trouver des emails, les vérifier, et envoyer des séquences. Bonne alternative économique. Tier gratuit avec 50 crédits/mois.',
    howToGet: 'Snov.io → Settings → API → User ID & Secret',
    url: 'https://app.snov.io/account/api',
  },
  // ── Outreach (complémentaire) ──
  instantlyKey: {
    label: 'Instantly', icon: '⚡', category: 'outreach', priority: 14,
    regex: null, prefix: null,
    desc: 'Cold email à volume (comptes email illimités)',
    benefit: 'Connecter des dizaines de boîtes email pour un tarif fixe. Rotation automatique, warm-up intégré. Idéal si vous envoyez plus de 200 emails/jour.',
    howToGet: 'Instantly → Settings → Integrations → API',
    url: 'https://app.instantly.ai/app/settings/integrations',
  },
  lgmKey: {
    label: 'La Growth Machine', icon: '🇫🇷', category: 'outreach', priority: 15,
    regex: null, prefix: null,
    desc: 'Outreach multicanal français (Email + LinkedIn + Twitter)',
    benefit: 'Séquences multicanales avec IA. Voice cloning pour les messages audio LinkedIn. Intégrations natives HubSpot/Pipedrive. Alternative française à Lemlist.',
    howToGet: 'LGM → Settings → Integrations → API Key',
    url: 'https://app.lagrowthmachine.com/settings',
  },
  waalaxyKey: {
    label: 'Waalaxy', icon: '👾', category: 'outreach', priority: 16,
    regex: null, prefix: null,
    desc: 'Prospection LinkedIn + email — très populaire en Europe',
    benefit: 'Automatiser la prospection LinkedIn (connexions, messages, visites) + email. Import de leads depuis LinkedIn/Sales Navigator. Tier gratuit disponible.',
    howToGet: 'Waalaxy → Settings → API',
    url: 'https://app.waalaxy.com/settings',
  },
  // ── LinkedIn / Scraping ──
  phantombusterKey: {
    label: 'PhantomBuster', icon: '👻', category: 'scraping', priority: 17,
    regex: null, prefix: null,
    desc: 'Automatisation et scraping LinkedIn / web (no-code)',
    benefit: 'Extraire des listes de prospects depuis LinkedIn, Google Maps, sites web. 100+ "Phantoms" prêts à l\'emploi. Enrichir et synchroniser avec votre CRM.',
    howToGet: 'PhantomBuster → Dashboard → API → API Key',
    url: 'https://phantombuster.com/api',
  },
  captaindataKey: {
    label: 'Captain Data', icon: '🏴‍☠️', category: 'scraping', priority: 18,
    regex: null, prefix: null,
    desc: 'Extraction de données B2B — made in France',
    benefit: 'Scraping LinkedIn, Google, sites d\'emploi. Enrichissement automatique. API-first, idéal pour automatiser les workflows N8N. Entreprise française.',
    howToGet: 'Captain Data → Settings → API → API Key',
    url: 'https://app.captaindata.co/settings',
  },
  // ── Calendar ──
  calendlyKey: {
    label: 'Calendly', icon: '📅', category: 'calendar', priority: 19,
    regex: null, prefix: null,
    desc: 'Prise de rendez-vous automatisée',
    benefit: 'Générer automatiquement des liens de RDV dans vos séquences. Tracker les rendez-vous pris directement dans Bakal. Le plus utilisé.',
    howToGet: 'Calendly → Integrations → API & Webhooks → Personal Access Token',
    url: 'https://calendly.com/integrations/api_webhooks',
  },
  calcomKey: {
    label: 'Cal.com', icon: '📆', category: 'calendar', priority: 20,
    regex: null, prefix: null,
    desc: 'Prise de RDV open-source et auto-hébergeable',
    benefit: 'Alternative open-source à Calendly. Auto-hébergeable pour la confidentialité. Gratuit en self-hosted. API complète.',
    howToGet: 'Cal.com → Settings → Developer → API Keys',
    url: 'https://app.cal.com/settings/developer/api-keys',
  },
  // ── Deliverability ──
  mailreachKey: {
    label: 'Mailreach', icon: '🛡️', category: 'deliverability', priority: 21,
    regex: null, prefix: null,
    desc: 'Warm-up email + monitoring de délivrabilité',
    benefit: 'Préchauffer vos boîtes email, tester le placement inbox vs spam, et monitorer votre réputation d\'expéditeur en temps réel.',
    howToGet: 'Mailreach → Settings → API → API Key',
    url: 'https://app.mailreach.co/settings',
  },
  warmboxKey: {
    label: 'Warmbox', icon: '🔥', category: 'deliverability', priority: 22,
    regex: null, prefix: null,
    desc: 'Warm-up email avec 35 000 boîtes d\'échange',
    benefit: 'Réchauffer vos boîtes email avec un réseau de 35 000 adresses. Emails générés par GPT-4 pour un warm-up réaliste. Rapport par fournisseur (Gmail, Outlook...).',
    howToGet: 'Warmbox → Settings → API → API Key',
    url: 'https://app.warmbox.ai/settings',
  },
};

const CATEGORY_INFO = {
  core:           { label: 'Essentiels', desc: 'Les 3 outils de base pour faire fonctionner Bakal', icon: '⚡' },
  crm:            { label: 'CRM', desc: 'Synchronisez vos leads dans votre CRM existant', icon: '📊' },
  enrichment:     { label: 'Enrichissement & Données B2B', desc: 'Trouvez et vérifiez les coordonnées de vos prospects', icon: '🔎' },
  outreach:       { label: 'Outreach complémentaire', desc: 'Outils de prospection en complément de Lemlist', icon: '📨' },
  scraping:       { label: 'Scraping & Automatisation', desc: 'Extraction de données LinkedIn et web', icon: '🕷️' },
  calendar:       { label: 'Calendrier', desc: 'Automatisez la prise de rendez-vous', icon: '📅' },
  deliverability: { label: 'Délivrabilité', desc: 'Warm-up et monitoring de vos emails', icon: '🛡️' },
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
  // ── Core ──
  if (lower.includes('lemlist')) return 'lemlistKey';
  if (lower.includes('notion')) return 'notionToken';
  if (lower.includes('claude') || lower.includes('anthropic')) return 'claudeKey';
  // ── CRM ──
  if (lower.includes('hubspot')) return 'hubspotKey';
  if (lower.includes('pipedrive')) return 'pipedriveKey';
  if (lower.includes('salesforce')) return 'salesforceKey';
  if (lower.includes('folk')) return 'folkKey';
  // ── Enrichment ──
  if (lower.includes('dropcontact')) return 'dropcontactKey';
  if (lower.includes('apollo')) return 'apolloKey';
  if (lower.includes('hunter')) return 'hunterKey';
  if (lower.includes('kaspr')) return 'kasprKey';
  if (lower.includes('lusha')) return 'lushaKey';
  if (lower.includes('snov')) return 'snovKey';
  // ── Outreach ──
  if (lower.includes('instantly')) return 'instantlyKey';
  if (lower.includes('growth machine') || lower.includes('lgm')) return 'lgmKey';
  if (lower.includes('waalaxy')) return 'waalaxyKey';
  // ── LinkedIn / Scraping ──
  if (lower.includes('phantombuster') || lower.includes('phantom')) return 'phantombusterKey';
  if (lower.includes('captain data') || lower.includes('captaindata')) return 'captaindataKey';
  // ── Calendar ──
  if (lower.includes('calendly')) return 'calendlyKey';
  if (lower.includes('cal.com') || lower.includes('calcom')) return 'calcomKey';
  // ── Deliverability ──
  if (lower.includes('mailreach')) return 'mailreachKey';
  if (lower.includes('warmbox')) return 'warmboxKey';
  // Category-level detection
  if (lower.match(/\bcrm\b/)) return '_category_crm';
  if (lower.match(/\b(enrichi|enrichment|données prospect|trouver.*email)\b/)) return '_category_enrichment';
  if (lower.match(/\b(calendrier|rdv|rendez.?vous|booking)\b/)) return '_category_calendar';
  if (lower.match(/\b(outreach|séquence|cold.?email|envoi.?auto)\b/)) return '_category_outreach';
  if (lower.match(/\b(scrap|extraction|données|linkedin.?scrap)\b/)) return '_category_scraping';
  if (lower.match(/\b(délivrabilité|deliverability|warm.?up|inbox|spam)\b/)) return '_category_deliverability';
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

  // Analyze / stats / diagnostic intent
  if (_conv.stage === 'init' && lower.match(/\b(analy|stats?|statist|diagnostic|performance|résultat|rapport|kpi|tableau de bord|dashboard)\b/)) {
    response = handleAnalyzeQuery(text);
  } else if (_conv.stage === 'init' && (lower.includes('optimi') || lower.includes('sous-performe') || lower.includes('améliorer') || lower.includes('régénér'))) {
    response = handleOptimizationQuery(text);
  } else if (_conv.stage === 'init' && (lower.includes('angle') || lower.includes('approche')) && lower.includes('secteur')) {
    response = handleAngleQuery(text);
  } else if (_conv.stage === 'init' && handleStrategicQuery(text)) {
    response = handleStrategicQuery(text);
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

/* ═══ Benchmarks ═══ */

const BENCHMARKS = {
  email: { open: { bad: 35, ok: 50, good: 60 }, reply: { bad: 2, ok: 5, good: 8 }, stop: { bad: 3, ok: 1.5, good: 0.5 } },
  linkedin: { accept: { bad: 20, ok: 30, good: 40 }, reply: { bad: 3, ok: 5, good: 8 } },
};

function rateMetric(value, thresholds) {
  if (value == null) return { label: '—', emoji: '⬜', level: 'unknown' };
  if (value >= thresholds.good) return { label: 'Excellent', emoji: '🟢', level: 'success' };
  if (value >= thresholds.ok) return { label: 'Correct', emoji: '🟡', level: 'ok' };
  return { label: 'À améliorer', emoji: '🔴', level: 'bad' };
}

/* ═══ Campaign analysis ═══ */

function analyzeCampaignStats(c) {
  const isLinkedIn = c.channel === 'linkedin';
  const isMulti = c.channel === 'multi';
  const results = { campaign: c, touchpoints: [], priorities: [], globalScore: 'unknown' };

  if (!c.sequence || c.sequence.length === 0) return results;

  let totalScore = 0;
  let scoredSteps = 0;

  c.sequence.forEach(step => {
    if (!step.stats) return;
    const tp = { id: step.id, type: step.type, label: step.label, metrics: [], issues: [], strengths: [] };

    if (step.type === 'email') {
      const bench = BENCHMARKS.email;
      if (step.stats.open != null) {
        const r = rateMetric(step.stats.open, bench.open);
        tp.metrics.push({ name: 'Ouverture', value: step.stats.open + '%', rating: r });
        if (r.level === 'bad') tp.issues.push(`Taux d'ouverture faible (${step.stats.open}%) — revoir l'objet et le nom d'expéditeur`);
        if (r.level === 'success') tp.strengths.push(`Excellent taux d'ouverture (${step.stats.open}%)`);
        totalScore += r.level === 'success' ? 3 : r.level === 'ok' ? 2 : 1;
        scoredSteps++;
      }
      if (step.stats.reply != null) {
        const r = rateMetric(step.stats.reply, bench.reply);
        tp.metrics.push({ name: 'Réponse', value: step.stats.reply + '%', rating: r });
        if (r.level === 'bad') tp.issues.push(`Taux de réponse insuffisant (${step.stats.reply}%) — revoir le CTA et l'angle`);
        if (r.level === 'success') tp.strengths.push(`Fort taux de réponse (${step.stats.reply}%)`);
        totalScore += r.level === 'success' ? 3 : r.level === 'ok' ? 2 : 1;
        scoredSteps++;
      }
      if (step.stats.stop != null && step.stats.stop > BENCHMARKS.email.stop.ok) {
        tp.issues.push(`Taux de désinscription élevé (${step.stats.stop}%) — message peut-être trop insistant`);
      }
    }

    if (step.type === 'linkedin') {
      const bench = BENCHMARKS.linkedin;
      if (step.stats.accept != null) {
        const r = rateMetric(step.stats.accept, bench.accept);
        tp.metrics.push({ name: 'Acceptation', value: step.stats.accept + '%', rating: r });
        if (r.level === 'bad') tp.issues.push(`Taux d'acceptation faible (${step.stats.accept}%) — revoir le profil et la note`);
        if (r.level === 'success') tp.strengths.push(`Bon taux d'acceptation (${step.stats.accept}%)`);
        totalScore += r.level === 'success' ? 3 : r.level === 'ok' ? 2 : 1;
        scoredSteps++;
      }
      if (step.stats.reply != null) {
        const r = rateMetric(step.stats.reply, bench.reply);
        tp.metrics.push({ name: 'Réponse', value: step.stats.reply + '%', rating: r });
        if (r.level === 'bad') tp.issues.push(`Réponse LinkedIn faible (${step.stats.reply}%) — message trop long ou trop commercial`);
        if (r.level === 'success') tp.strengths.push(`Bon engagement LinkedIn (${step.stats.reply}%)`);
        totalScore += r.level === 'success' ? 3 : r.level === 'ok' ? 2 : 1;
        scoredSteps++;
      }
    }

    results.touchpoints.push(tp);
  });

  // Global score
  if (scoredSteps > 0) {
    const avg = totalScore / scoredSteps;
    results.globalScore = avg >= 2.5 ? 'excellent' : avg >= 1.8 ? 'good' : avg >= 1.3 ? 'ok' : 'bad';
  }

  // Priorities
  const allIssues = results.touchpoints.flatMap(tp => tp.issues.map(i => ({ step: tp.id, issue: i })));
  results.priorities = allIssues.slice(0, 3);

  return results;
}

function formatAnalysisReport(analysis) {
  const c = analysis.campaign;
  const scoreEmoji = { excellent: '🚀', good: '🟢', ok: '🟡', bad: '🔴', unknown: '⬜' };
  const scoreLabel = { excellent: 'Excellent', good: 'Performant', ok: 'Correct', bad: 'À optimiser', unknown: 'Pas encore de données' };

  let msg = `## Diagnostic — ${c.name}\n\n`;
  msg += `**Score global :** ${scoreEmoji[analysis.globalScore]} ${scoreLabel[analysis.globalScore]}\n`;
  msg += `**Canal :** ${c.channelLabel} · **${c.kpis.contacts} contacts** · Itération ${c.iteration}\n\n`;

  // Per-touchpoint breakdown
  if (analysis.touchpoints.length > 0) {
    msg += `### Détail par touchpoint\n\n`;
    analysis.touchpoints.forEach(tp => {
      const metricsStr = tp.metrics.map(m => `${m.rating.emoji} ${m.name}: **${m.value}** (${m.rating.label})`).join(' · ');
      msg += `**${tp.id} — ${tp.label}**\n${metricsStr}\n`;
      tp.strengths.forEach(s => { msg += `- ✅ ${s}\n`; });
      tp.issues.forEach(i => { msg += `- ⚡ ${i}\n`; });
      msg += '\n';
    });
  }

  // Priorities
  if (analysis.priorities.length > 0) {
    msg += `### Priorités d'optimisation\n\n`;
    analysis.priorities.forEach((p, i) => {
      msg += `${i + 1}. **${p.step}** — ${p.issue}\n`;
    });
    msg += '\n';
  }

  // Existing diagnostics (from data)
  if (c.diagnostics && c.diagnostics.length > 0) {
    const warnings = c.diagnostics.filter(d => d.level === 'warning');
    if (warnings.length > 0) {
      msg += `### Recommandations IA\n\n`;
      warnings.forEach(d => {
        msg += `- ${d.text.replace(/<[^>]*>/g, '').replace(/Recommandation\s*:\s*/i, '**Recommandation :** ')}\n`;
      });
      msg += '\n';
    }
  }

  // Next action
  if (c.nextAction) {
    msg += `**Prochaine action :** ${c.nextAction.text}\n\n`;
  }

  return msg;
}

function handleAnalyzeQuery(text) {
  const campaigns = Object.values(typeof BAKAL !== 'undefined' ? BAKAL.campaigns : {});
  if (campaigns.length === 0) {
    return { content: `Vous n'avez pas encore de campagne. Voulez-vous en créer une ? Décrivez-moi votre cible idéale.` };
  }

  // Check if user mentions a specific campaign
  const lower = text.toLowerCase();
  const match = campaigns.find(c => lower.includes(c.name.toLowerCase()) || lower.includes(c.id));
  if (match) {
    return handleAnalyzeCampaign(match);
  }

  // Global analysis of all active campaigns
  const active = campaigns.filter(c => c.status === 'active');
  const prep = campaigns.filter(c => c.status === 'prep');

  if (active.length === 0) {
    let msg = `Aucune campagne active pour le moment.\n\n`;
    if (prep.length > 0) {
      msg += `Vous avez **${prep.length} campagne(s) en préparation** :\n`;
      prep.forEach(c => { msg += `- **${c.name}** (${c.channelLabel}) — ${c.kpis.contacts} prospects\n`; });
      msg += `\nLancez-les pour commencer à collecter des stats !`;
    }
    return { content: msg };
  }

  // Multi-campaign dashboard
  let msg = `## Analyse globale — ${active.length} campagne(s) active(s)\n\n`;

  // Global KPIs
  const globalKpis = typeof BAKAL !== 'undefined' ? BAKAL.globalKpis : {};
  if (globalKpis.contacts) {
    msg += `### KPIs consolidés\n`;
    msg += `- **Contacts :** ${globalKpis.contacts.value} ${globalKpis.contacts.trend ? `(${globalKpis.contacts.trend})` : ''}\n`;
    if (globalKpis.openRate) msg += `- **Ouverture :** ${globalKpis.openRate.value} ${globalKpis.openRate.trend ? `(${globalKpis.openRate.trend})` : ''}\n`;
    if (globalKpis.replyRate) msg += `- **Réponse :** ${globalKpis.replyRate.value} ${globalKpis.replyRate.trend ? `(${globalKpis.replyRate.trend})` : ''}\n`;
    if (globalKpis.meetings) msg += `- **RDV :** ${globalKpis.meetings.value} ${globalKpis.meetings.trend ? `(${globalKpis.meetings.trend})` : ''}\n`;
    msg += '\n';
  }

  // Per-campaign summary
  msg += `### Par campagne\n\n`;
  active.forEach(c => {
    const analysis = analyzeCampaignStats(c);
    const scoreEmoji = { excellent: '🚀', good: '🟢', ok: '🟡', bad: '🔴', unknown: '⬜' };
    const mainMetric = c.channel === 'linkedin'
      ? (c.kpis.acceptRate ? `Accept: ${c.kpis.acceptRate}%` : '—')
      : (c.kpis.openRate ? `Open: ${c.kpis.openRate}%` : '—');
    const replyMetric = c.kpis.replyRate ? `Reply: ${c.kpis.replyRate}%` : '';

    msg += `${scoreEmoji[analysis.globalScore]} **${c.name}** (${c.channelLabel})\n`;
    msg += `- ${c.kpis.contacts} contacts · ${mainMetric}${replyMetric ? ` · ${replyMetric}` : ''}\n`;
    if (analysis.priorities.length > 0) {
      msg += `- ⚡ ${analysis.priorities[0].issue}\n`;
    }
    msg += '\n';
  });

  // Recommendations
  const recos = typeof BAKAL !== 'undefined' ? BAKAL.recommendations : [];
  if (recos.length > 0) {
    msg += `### Recommandations\n\n`;
    recos.forEach(r => {
      msg += `- ${r.label} : ${r.text}\n`;
    });
    msg += '\n';
  }

  msg += `Pour un diagnostic détaillé, dites-moi le nom de la campagne (ex: *"Analyse DAF Île-de-France"*).`;

  return { content: msg };
}

function handleAnalyzeCampaign(campaign) {
  const analysis = analyzeCampaignStats(campaign);
  const msg = formatAnalysisReport(analysis);
  return { content: msg + `Voulez-vous que je **régénère les messages sous-performants** ou que j'analyse une autre campagne ?` };
}

function handleOptimizationQuery(text) {
  const campaigns = Object.values(typeof BAKAL !== 'undefined' ? BAKAL.campaigns : {});
  if (campaigns.length === 0) {
    return { content: `Vous n'avez pas encore de campagne active. Voulez-vous en créer une ? Décrivez-moi votre cible idéale.` };
  }

  // Check for specific campaign
  const lower = text.toLowerCase();
  const match = campaigns.find(c => lower.includes(c.name.toLowerCase()) || lower.includes(c.id));
  if (match) {
    const analysis = analyzeCampaignStats(match);
    let msg = formatAnalysisReport(analysis);
    msg += `\n### Que faire maintenant ?\n\n`;
    if (analysis.priorities.length > 0) {
      msg += `Je recommande de **régénérer ${analysis.priorities[0].step}** en priorité. `;
    }
    msg += `Dites "optimise" pour que je propose de nouvelles versions des messages sous-performants.`;
    return { content: msg };
  }

  // List campaigns that need optimization
  const active = campaigns.filter(c => c.status === 'active');
  const needsWork = active.filter(c => {
    const a = analyzeCampaignStats(c);
    return a.priorities.length > 0;
  });

  if (needsWork.length === 0) {
    return { content: `Toutes vos campagnes actives performent bien ! Pas d'optimisation urgente à faire.\n\nVoulez-vous créer une nouvelle campagne ou analyser les stats en détail ?` };
  }

  let msg = `Voici les campagnes qui pourraient être optimisées :\n\n`;
  needsWork.forEach(c => {
    const a = analyzeCampaignStats(c);
    msg += `**${c.name}** — ${a.priorities.length} point(s) à améliorer\n`;
    a.priorities.forEach(p => { msg += `  - ⚡ ${p.step} : ${p.issue}\n`; });
    msg += '\n';
  });
  msg += `Quelle campagne voulez-vous optimiser ?`;
  return { content: msg };
}

function handleAngleQuery(text) {
  const sector = extractParam(text, SECTORS) || 'Tech';
  return {
    content: `Pour le secteur **${sector}**, voici les angles qui fonctionnent le mieux d'après nos données :\n\n1. **Douleur client** — Question directe sur un problème connu du secteur. Meilleur taux de réponse en général (+2-3pts vs moyenne).\n2. **Preuve sociale** — Case study d'un client similaire avec des chiffres concrets. Très efficace en follow-up.\n3. **Curiosité** — Question ouverte intrigante qui pousse à la réponse. Bon sur les profils senior.\n\nL'angle "proposition directe" est à éviter en premier contact — il fonctionne mieux après un échange.\n\nVoulez-vous que je crée une campagne avec un de ces angles ?`
  };
}

/* ═══ Strategic knowledge base ═══ */

const KNOWLEDGE_BASE = [
  {
    triggers: ['meilleur moment', 'quand envoyer', 'heure', 'jour', 'timing', 'quel jour', 'quelle heure', 'horaire'],
    answer: `### Meilleur timing d'envoi\n\n**Email B2B :**\n- **Mardi et jeudi matin (9h-10h30)** — meilleur taux d'ouverture (+15% vs moyenne)\n- Éviter le lundi matin (boîte saturée) et le vendredi après-midi\n- Les relances en milieu de semaine (mercredi) fonctionnent bien\n\n**LinkedIn :**\n- **Mardi-jeudi, 8h-9h ou 17h-18h** — pics de connexion\n- Les notes envoyées le week-end ont un taux d'acceptation plus bas (-8pts)\n\n**Espacement entre touchpoints :**\n- E1 → E2 : 3 jours (assez pour lire, pas assez pour oublier)\n- E2 → E3 : 4-5 jours (changement d'angle)\n- E3 → E4 (break-up) : 5-7 jours`,
  },
  {
    triggers: ['combien touchpoint', 'combien email', 'combien de messages', 'nombre de relance', 'combien relance', 'trop de relance', 'nombre touchpoint', 'combien de mail'],
    answer: `### Nombre optimal de touchpoints\n\n**Email seul :** 4 touchpoints est le sweet spot\n- E1 (initial) → E2 (valeur/preuve) → E3 (angle différent) → E4 (break-up)\n- Au-delà de 4, le taux de désinscription monte significativement\n- 80% des réponses arrivent sur E1 et E2\n\n**LinkedIn seul :** 2 touchpoints\n- Note de connexion (max 300 chars, pas de pitch)\n- Message post-connexion (conversationnel)\n\n**Multi-canal (recommandé) :** 5 touchpoints\n- Email + LinkedIn combinés → +40% de taux de réponse vs email seul\n- Le LinkedIn entre deux emails crée un "effet de présence"\n\n**Règle d'or :** Mieux vaut 4 messages bien écrits que 8 messages moyens.`,
  },
  {
    triggers: ['tu ou vous', 'tutoyer', 'vouvoyer', 'tutoiement', 'vouvoiement', 'formel', 'informel', 'formalité'],
    answer: `### Tu vs Vous en prospection B2B\n\n**Vous (défaut recommandé) :**\n- Secteurs traditionnels (finance, juridique, industrie, santé)\n- Cibles senior (DAF, DG, DRH)\n- Premier contact avec des grands comptes\n\n**Tu envisageable :**\n- Startups et scale-ups tech\n- Cibles junior-mid (Growth, Marketing, DevRel)\n- Si votre propre marque est très décontractée\n\n**Notre constat :** Le vouvoiement ne fait jamais perdre de deal. Le tutoiement peut en faire perdre. En cas de doute, vouvoyez.\n\n**Astuce :** Commencez en "vous" puis passez au "tu" naturellement si le prospect répond de manière informelle.`,
  },
  {
    triggers: ['objet email', 'subject line', 'ligne objet', 'titre email', 'quel objet', 'objet efficace'],
    answer: `### Rédiger des objets email efficaces\n\n**Ce qui fonctionne :**\n- **Personnalisation** : "{{firstName}}, une question rapide" (+12pts d'ouverture)\n- **Curiosité** : "Une idée pour {{companyName}}" \n- **Re:** en follow-up : crée un effet de thread (+15pts)\n- **Court** : 4-7 mots idéalement\n\n**Ce qui ne fonctionne pas :**\n- Majuscules ("URGENT", "OFFRE") → spam filter\n- Émojis en B2B (sauf secteur créatif) → -5pts d'ouverture\n- Trop générique ("Proposition de collaboration")\n- Mensonger ("Re:" sur un premier email → perte de confiance)\n\n**A/B testing :** Toujours tester 2 variantes d'objet. 200 envois minimum pour un résultat fiable.\n\n**Nos top performers :**\n1. "{{firstName}}, une question sur {{companyName}}"\n2. "Idée pour votre [problème spécifique]"\n3. "{{firstName}} — 15 min cette semaine ?"`,
  },
  {
    triggers: ['longueur', 'combien de mots', 'email court', 'email long', 'taille du message', 'message court', 'message long'],
    answer: `### Longueur idéale des messages\n\n**Email initial (E1) :** 3-5 phrases max\n- Hook (1 phrase) → Contexte (1-2 phrases) → CTA question (1 phrase)\n- Les emails de plus de 150 mots perdent 30% de réponses\n\n**Email valeur (E2) :** 4-6 phrases\n- Peut être un peu plus long car il apporte de la preuve\n- Mais toujours scannable (paragraphes courts)\n\n**Email break-up (E4) :** 2-3 phrases MAXIMUM\n- Le plus court de la séquence\n- Jamais de culpabilisation\n\n**Note LinkedIn :** Max 300 caractères (limite plateforme)\n- Pas de pitch, juste une raison de connecter\n\n**Message LinkedIn :** 3-4 phrases\n- Conversationnel, comme un message à un collègue`,
  },
  {
    triggers: ['cta', 'call to action', 'appel à l\'action', 'question ouverte', 'proposition call', 'demander rdv', 'comment conclure'],
    answer: `### Quel CTA utiliser ?\n\n**Question ouverte (recommandé en E1) :**\n- "C'est aussi un sujet chez {{companyName}} ?" → +3pts de réponse vs proposition de call\n- Moins engageant, plus naturel, ouvre la conversation\n\n**Proposition de call (E2 ou E3) :**\n- "15 minutes cette semaine pour en discuter ?" → bon en follow-up\n- Trop direct en premier contact (sauf secteurs transactionnels)\n\n**Lien Calendly :**\n- Uniquement après un échange positif ou en E3\n- En E1, ça fait spam\n\n**Soft close (E4 break-up) :**\n- "Mon offre reste ouverte" → crée la rareté sans pression\n- 5-10% des réponses arrivent sur le break-up\n\n**Nos données :** CTA question ouverte > proposition call > Calendly en premier contact.`,
  },
  {
    triggers: ['délivrabilité', 'deliverability', 'spam', 'inbox', 'warm up', 'warmup', 'email en spam', 'boîte de réception'],
    answer: `### Optimiser la délivrabilité\n\n**Les bases :**\n- **SPF, DKIM, DMARC** configurés sur votre domaine\n- **Warm-up** de 2-3 semaines avant d'envoyer en volume (Mailreach, Warmbox)\n- **Volume progressif** : commencer à 20-30/jour, monter à 50-80/jour max\n\n**Red flags à éviter :**\n- Plus de 80 emails/jour/boîte\n- Taux de bounce > 5% (nettoyez vos listes !)\n- Liens trackés en masse (1 lien max par email)\n- Pièces jointes en cold email\n- Mots spam : "gratuit", "offre limitée", "cliquez ici"\n\n**Monitoring :**\n- Vérifiez votre score expéditeur sur mail-tester.com\n- Un taux d'ouverture < 30% = problème de délivrabilité\n\n**Outils recommandés :** Mailreach ou Warmbox pour le warm-up, Dropcontact pour la vérification d'emails.`,
  },
  {
    triggers: ['linkedin', 'note de connexion', 'linkedin message', 'profil linkedin', 'social selling', 'connection request'],
    answer: `### Best practices LinkedIn\n\n**Note de connexion (max 300 chars) :**\n- JAMAIS de pitch commercial\n- Mentionnez un point commun (secteur, ville, connexion mutuelle)\n- "Ravi d'échanger" > "Je souhaiterais vous présenter"\n- Benchmark : 30-40% d'acceptation = bon\n\n**Message post-connexion :**\n- Attendre 2-3 jours après l'acceptation\n- Conversationnel, comme un message entre pairs\n- UNE question ouverte, pas un pavé\n- Benchmark : 5-8% de réponse = bon\n\n**Profil optimisé (indispensable) :**\n- Photo pro, bannière avec proposition de valeur\n- Titre orienté bénéfice ("J'aide les X à Y") pas titre de poste\n- 3+ posts récents pour crédibiliser\n\n**Multi-canal :** Le combo Email J+0 → LinkedIn J+2 → Email J+5 est le plus efficace.`,
  },
  {
    triggers: ['taux', 'benchmark', 'bon taux', 'taux moyen', 'kpi', 'objectif', 'indicateur'],
    answer: `### Benchmarks B2B (cold outreach)\n\n**Email :**\n| Métrique | 🔴 Faible | 🟡 Correct | 🟢 Bon | 🚀 Excellent |\n|----------|-----------|------------|--------|-------------|\n| Ouverture | <35% | 35-50% | 50-65% | >65% |\n| Réponse | <2% | 2-5% | 5-8% | >8% |\n| Désinscription | >3% | 1.5-3% | <1.5% | <0.5% |\n\n**LinkedIn :**\n| Métrique | 🔴 Faible | 🟡 Correct | 🟢 Bon |\n|----------|-----------|------------|--------|\n| Acceptation | <20% | 20-30% | >30% |\n| Réponse | <3% | 3-5% | >5% |\n\n**Conversion globale :**\n- Prospect → Réponse positive : 2-5%\n- Réponse positive → RDV : 30-50%\n- RDV → Client : 15-30%\n\n**Règle :** Il faut ~200 prospects contactés pour des stats fiables.`,
  },
  {
    triggers: ['combien de prospect', 'volume', 'taille liste', 'combien envoyer', 'nombre prospect', 'liste prospect'],
    answer: `### Volume et taille de liste\n\n**Volume recommandé par campagne :**\n- **Minimum :** 100 prospects (pour des stats exploitables)\n- **Idéal :** 200-500 prospects\n- **Maximum par boîte email :** 50-80/jour\n\n**Pour atteindre vos objectifs :**\n- Objectif 3 RDV/mois → ~300 prospects contactés\n- Objectif 5 RDV/mois → ~500 prospects contactés\n- Objectif 10 RDV/mois → ~1000 prospects (2 campagnes)\n\n**Qualité > Quantité :**\n- Une liste de 200 prospects ultra-ciblés > 1000 prospects vagues\n- Le ciblage précis (secteur + poste + taille + zone) multiplie par 2-3 le taux de réponse\n\n**Sources de prospects :** LinkedIn Sales Navigator, Apollo.io, Dropcontact, PhantomBuster.`,
  },
  {
    triggers: ['a/b test', 'ab test', 'tester', 'variante', 'variant', 'split test', 'test ab'],
    answer: `### A/B Testing en prospection\n\n**Quoi tester (par priorité) :**\n1. **Objet email** — impact le plus fort sur l'ouverture\n2. **CTA** — impact direct sur la réponse\n3. **Angle d'approche** — douleur vs preuve sociale vs curiosité\n4. **Longueur** — court vs détaillé\n\n**Méthodologie :**\n- **1 variable à la fois** — sinon impossible de savoir ce qui a marché\n- **200 prospects minimum** par variante (100+100)\n- **7 jours minimum** avant de conclure\n- **Mesurer le bon KPI** : ouverture pour les objets, réponse pour le corps\n\n**Piège courant :** Tester l'objet ET le corps en même temps. Si les résultats s'améliorent, vous ne savez pas pourquoi.\n\n**Comment Bakal gère ça :** Le système de régénération crée automatiquement des variantes A/B avec des hypothèses claires.`,
  },
];

function matchKnowledge(text) {
  const lower = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  let bestMatch = null;
  let bestScore = 0;

  for (const entry of KNOWLEDGE_BASE) {
    let score = 0;
    for (const trigger of entry.triggers) {
      const normalTrigger = trigger.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (lower.includes(normalTrigger)) score += normalTrigger.length;
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = entry;
    }
  }

  return bestScore >= 3 ? bestMatch : null;
}

function handleStrategicQuery(text) {
  const kb = matchKnowledge(text);
  if (kb) {
    return { content: kb.answer + `\n\nUne autre question, ou voulez-vous **créer une campagne** avec ces principes ?` };
  }
  return null;
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

/* ═══ Contextual suggestions ═══ */

function getSuggestionsForContext(metadata) {
  const campaigns = typeof BAKAL !== 'undefined' ? Object.values(BAKAL.campaigns) : [];
  const activeCampaigns = campaigns.filter(c => c.status === 'active');
  const hasCampaigns = campaigns.length > 0;

  // After campaign creation
  if (metadata && metadata.action === 'create_campaign') {
    return [
      'Créer cette campagne',
      'Changer le canal',
      'Modifier la cible',
      'Changer l\'angle d\'approche',
    ];
  }

  // After analysis/optimization response — detect by checking last assistant message
  const lastMsg = _conv.history.filter(h => h.role === 'assistant').slice(-1)[0];
  if (lastMsg && lastMsg.content && lastMsg.content.includes('Diagnostic —')) {
    const campaigns = typeof BAKAL !== 'undefined' ? Object.values(BAKAL.campaigns).filter(c => c.status === 'active') : [];
    const suggestions = ['Régénérer les messages sous-performants'];
    if (campaigns.length > 1) suggestions.push('Analyser une autre campagne');
    suggestions.push('Créer une nouvelle campagne');
    return suggestions;
  }
  if (lastMsg && lastMsg.content && lastMsg.content.includes('Analyse globale')) {
    const campaigns = typeof BAKAL !== 'undefined' ? Object.values(BAKAL.campaigns).filter(c => c.status === 'active') : [];
    return campaigns.slice(0, 3).map(c => `Détail "${c.name}"`).concat(['Créer une nouvelle campagne']);
  }

  // Campaign confirmed and being created
  if (_conv.stage === 'done') {
    return [
      'Créer une autre campagne',
      'Analyser mes stats',
      'Voir les intégrations disponibles',
    ];
  }

  // Gathering params — suggest common values for what's missing
  if (_conv.stage === 'gathering') {
    const missing = getMissingParams();
    if (missing.length > 0) {
      const param = missing[0];
      const quickSuggestions = {
        sector: ['Tech & SaaS', 'Comptabilité & Finance', 'Conseil & Consulting'],
        position: ['Dirigeant / CEO', 'DAF', 'DRH'],
        channel: ['Email', 'LinkedIn', 'Multi (Email + LinkedIn)'],
        zone: ['France entière', 'Île-de-France', 'Lyon / Rhône-Alpes'],
        size: ['1-10 sal. (TPE)', '11-50 sal. (PME)', '50-200 sal. (ETI)'],
      };
      return quickSuggestions[param] || [];
    }
  }

  // Waiting for confirmation
  if (_conv.stage === 'confirm') {
    return ['Oui, créer la campagne', 'Modifier quelque chose', 'Recommencer'];
  }

  // API keys flow
  if (_conv.stage === 'api_keys') {
    if (_conv.apiKeyField) {
      return ['Passer', 'Voir un autre outil', 'Terminé'];
    }
    return ['Essentiels', 'CRM', 'Enrichissement', 'Terminé'];
  }

  // After strategic/knowledge response
  if (lastMsg && lastMsg.content && lastMsg.content.includes('Une autre question')) {
    return [
      'Créer une campagne',
      'Meilleur timing d\'envoi ?',
      'Benchmarks B2B',
      'Tu ou Vous ?',
    ];
  }

  // Default — init stage
  const suggestions = [];
  if (hasCampaigns) {
    suggestions.push('Créer une nouvelle campagne');
    if (activeCampaigns.length > 0) {
      suggestions.push('Analyser mes campagnes actives');
      suggestions.push('Optimiser une campagne');
    }
  } else {
    suggestions.push('Créer ma première campagne');
    suggestions.push('Quel angle pour le secteur tech ?');
  }
  suggestions.push('Configurer mes intégrations');
  return suggestions;
}

function getWelcomeSuggestions() {
  const campaigns = typeof BAKAL !== 'undefined' ? Object.values(BAKAL.campaigns) : [];
  const active = campaigns.filter(c => c.status === 'active');

  if (active.length > 0) {
    const c = active[0];
    return [
      `Analyser "${c.name}"`,
      'Créer une nouvelle campagne',
      'Optimiser une campagne qui sous-performe',
    ];
  }
  if (campaigns.length > 0) {
    return [
      'Créer une nouvelle campagne',
      'Analyser mes stats',
      'Quel angle pour mon secteur ?',
    ];
  }
  return [
    'Cibler des DAF en Île-de-France',
    'Quel angle pour le secteur tech ?',
    'Configurer mes intégrations',
  ];
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
