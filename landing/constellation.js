// ============================================================
// BAAKALAI — Comment ça marche : le noyau et la boucle
// Vanilla JS, aucune dépendance. Données FR/EN + scène SVG +
// séquenceur de boucle + panneau de détail.
// ============================================================

// ─── DATA · ÉTAPES DE LA BOUCLE (briques natives) ───────────

const STEPS_FR = [
  { id: 'crm-read', num: 1, name: 'Lecture CRM', sub: 'SYNC 24/7', badge: 'BRIQUE NATIVE',
    tip: 'Sync bidirectionnelle avec ton CRM — lecture des deals, écriture des activités.',
    role: 'La porte d’entrée. baakalai se connecte à ton CRM — HubSpot, Pipedrive et Salesforce en OAuth un clic ; Odoo, Notion, Airtable et Folk par clé API — et lit deals, contacts et historique en continu. Il écrit en retour chaque activité.',
    agents: ['CRM'],
    interactions: [
      { agent: 'CRM', action: 'sync_bidirectionnelle', purpose: 'lit les deals, écrit les activités' },
      { agent: 'CRM', action: 'webhook → deal_event', purpose: 'réagit en temps réel aux changements' } ] },
  { id: 'detect', num: 2, name: 'Détection', sub: 'STAGNATION · CHURN · UPSELL', badge: 'BRIQUE NATIVE',
    tip: 'Repère les deals stagnants, les signaux de churn et les upsells — c’est ce qui déclenche la boucle.',
    role: 'Le radar. À chaque sync, les agents cherchent les deals qui dorment, les signaux de churn et les opportunités d’upsell. C’est la détection qui déclenche la boucle — pas toi.',
    agents: ['CRM', 'Upsell Detector', 'Win/Loss Analyst'],
    interactions: [
      { agent: 'CRM', action: 'detect_stagnation', purpose: 'deal sans activité depuis N jours' },
      { agent: 'Upsell Detector', action: 'score_upsell', purpose: 'repère les comptes à étendre' },
      { agent: 'Win/Loss Analyst', action: 'analyse_perdus', purpose: 'comprend pourquoi un deal meurt' } ] },
  { id: 'sequence', num: 3, name: 'Séquence proposée', sub: 'BRANCHES CONDITIONNELLES', badge: 'MOTEUR DE SÉQUENCES',
    tip: 'Le Deal Coach propose une séquence de relance à branches : répond / ne répond pas.',
    role: 'Le Deal Coach propose une séquence de relance à branches conditionnelles : si le prospect répond, on arrête ; s’il ignore, l’étape suivante part au moment choisi. Chaque étape est rédigée à partir des patterns de la Memory.',
    agents: ['Deal Coach', 'Memory', 'Copy Optimizer', 'Timing Agent'],
    interactions: [
      { agent: 'Deal Coach', action: 'propose_sequence', purpose: '3–5 étapes, 2 branches par étape' },
      { agent: 'Memory', action: 'patterns_gagnants', purpose: 'angle, ton et timing qui ont déjà marché' },
      { agent: 'Copy Optimizer', action: 'redige_variantes', purpose: '80 mots max, ta voix' } ] },
  { id: 'approve', num: 4, name: 'Ton approbation', sub: 'RIEN NE PART SANS TOI', badge: 'TOI',
    tip: 'La séquence arrive avec son raisonnement — tu valides, tu édites ou tu refuses.',
    role: 'Rien ne part sans toi. La séquence proposée arrive avec son raisonnement — tu valides, tu édites ou tu refuses. Une fois approuvée, elle tourne toute seule.',
    agents: ['Deal Coach', 'Reporting'],
    interactions: [
      { agent: 'Deal Coach', action: 'soumet_sequence', purpose: 'te montre le plan avant tout envoi' },
      { agent: 'Reporting', action: 'trace_approbation', purpose: 'archive qui a validé quoi, quand' } ] },
  { id: 'send', num: 5, name: 'Envoi', sub: 'DEPUIS TA BOÎTE', badge: 'ENVOI NATIF',
    tip: 'Pas d’outil tiers requis : baakalai envoie depuis ta boîte Gmail ou Outlook.',
    role: 'Pas d’outil tiers requis : baakalai envoie depuis ta boîte Gmail ou Outlook (OAuth un clic) ou ton SMTP. Tes relances partent de ton adresse, avec ta signature, dans ton fuseau.',
    agents: ['CRM', 'Prospection', 'Timing Agent'],
    interactions: [
      { agent: 'CRM', action: 'send_personal', purpose: 'relance 1-to-1 depuis ton adresse' },
      { agent: 'Prospection', action: 'send_step', purpose: 'déroule l’étape N de la séquence' },
      { agent: 'Timing Agent', action: 'schedule', purpose: 'choisit le créneau qui répond le mieux' } ] },
  { id: 'reply', num: 6, name: 'Réponse', sub: 'STOP OU ÉTAPE SUIVANTE', badge: 'DÉTECTION DE RÉPONSE',
    tip: 'Dès qu’un prospect répond, la séquence s’arrête net. S’il ignore, l’étape suivante part.',
    role: 'baakalai surveille ta boîte : dès qu’un prospect répond, la séquence s’arrête net et le deal te revient. S’il ignore, l’étape suivante part comme prévu. C’est la branche conditionnelle au cœur du moteur.',
    agents: ['CRM', 'Memory'],
    interactions: [
      { agent: 'CRM', action: 'detect_reply → stop_sequence', purpose: 'coupe la branche, te notifie' },
      { agent: 'Memory', action: 'enregistre_issue', purpose: 'réponse ou silence, tout devient pattern' } ] },
  { id: 'memory', num: 7, name: 'Mémoire', sub: 'NOURRIT LA SUITE', badge: 'BRIQUE NATIVE',
    tip: 'Consolide les patterns gagnants et nourrit la détection suivante. Le moat.',
    role: 'Chaque issue — réponse, silence, deal relancé — devient un pattern. La Memory consolide, vectorise, et nourrit la détection suivante. Plus tu l’utilises, plus la boucle est précise.',
    agents: ['Memory', 'ICP Refiner', 'Competitor Watch'],
    interactions: [
      { agent: 'Memory', action: 'persist_pattern', purpose: 'stocke ce qui a marché — et pourquoi' },
      { agent: 'ICP Refiner', action: 'affine_cible', purpose: 'resserre le profil qui répond' },
      { agent: 'Memory', action: 'alimente_11_agents', purpose: 'les autres agents lisent les patterns' } ] },
];

const STEPS_EN = [
  { id: 'crm-read', num: 1, name: 'CRM read', sub: 'SYNC 24/7', badge: 'NATIVE BRICK',
    tip: 'Two-way sync with your CRM — reads deals, writes activities back.',
    role: 'The entry point. baakalai connects to your CRM — HubSpot, Pipedrive and Salesforce in one-click OAuth; Odoo, Notion, Airtable and Folk via API key — and reads deals, contacts and history continuously. It writes every activity back.',
    agents: ['CRM'],
    interactions: [
      { agent: 'CRM', action: 'two_way_sync', purpose: 'reads deals, writes activities' },
      { agent: 'CRM', action: 'webhook → deal_event', purpose: 'reacts to changes in real time' } ] },
  { id: 'detect', num: 2, name: 'Detection', sub: 'STALL · CHURN · UPSELL', badge: 'NATIVE BRICK',
    tip: 'Spots stalled deals, churn signals and upsells — this is what triggers the loop.',
    role: 'The radar. On every sync, the agents look for sleeping deals, churn signals and upsell opportunities. Detection triggers the loop — not you.',
    agents: ['CRM', 'Upsell Detector', 'Win/Loss Analyst'],
    interactions: [
      { agent: 'CRM', action: 'detect_stagnation', purpose: 'deal with no activity for N days' },
      { agent: 'Upsell Detector', action: 'score_upsell', purpose: 'flags accounts to expand' },
      { agent: 'Win/Loss Analyst', action: 'analyse_losses', purpose: 'understands why a deal dies' } ] },
  { id: 'sequence', num: 3, name: 'Proposed sequence', sub: 'CONDITIONAL BRANCHES', badge: 'SEQUENCE ENGINE',
    tip: 'The Deal Coach proposes a branching follow-up sequence: replies / doesn\u2019t reply.',
    role: 'The Deal Coach proposes a follow-up sequence with conditional branches: if the prospect replies, it stops; if they ignore, the next step goes out at the chosen moment. Every step is written from Memory patterns.',
    agents: ['Deal Coach', 'Memory', 'Copy Optimizer', 'Timing Agent'],
    interactions: [
      { agent: 'Deal Coach', action: 'propose_sequence', purpose: '3–5 steps, 2 branches per step' },
      { agent: 'Memory', action: 'winning_patterns', purpose: 'angle, tone and timing that already worked' },
      { agent: 'Copy Optimizer', action: 'draft_variants', purpose: '80 words max, your voice' } ] },
  { id: 'approve', num: 4, name: 'Your approval', sub: 'NOTHING SHIPS WITHOUT YOU', badge: 'YOU',
    tip: 'The sequence arrives with its reasoning — you approve, edit or reject.',
    role: 'Nothing ships without you. The proposed sequence arrives with its reasoning — you approve, edit or reject. Once approved, it runs on its own.',
    agents: ['Deal Coach', 'Reporting'],
    interactions: [
      { agent: 'Deal Coach', action: 'submit_sequence', purpose: 'shows you the plan before anything sends' },
      { agent: 'Reporting', action: 'log_approval', purpose: 'records who approved what, when' } ] },
  { id: 'send', num: 5, name: 'Send', sub: 'FROM YOUR OWN INBOX', badge: 'NATIVE SENDING',
    tip: 'No third-party tool required: baakalai sends from your Gmail or Outlook inbox.',
    role: 'No third-party tool required: baakalai sends from your Gmail or Outlook inbox (one-click OAuth) or your SMTP. Your follow-ups leave from your address, with your signature, in your timezone.',
    agents: ['CRM', 'Prospection', 'Timing Agent'],
    interactions: [
      { agent: 'CRM', action: 'send_personal', purpose: '1-to-1 follow-up from your address' },
      { agent: 'Prospection', action: 'send_step', purpose: 'runs step N of the sequence' },
      { agent: 'Timing Agent', action: 'schedule', purpose: 'picks the slot that gets replies' } ] },
  { id: 'reply', num: 6, name: 'Reply', sub: 'STOP OR NEXT STEP', badge: 'REPLY DETECTION',
    tip: 'The moment a prospect replies, the sequence stops dead. If they ignore, the next step goes out.',
    role: 'baakalai watches your inbox: the moment a prospect replies, the sequence stops dead and the deal comes back to you. If they ignore, the next step goes out as planned. This is the conditional branch at the heart of the engine.',
    agents: ['CRM', 'Memory'],
    interactions: [
      { agent: 'CRM', action: 'detect_reply → stop_sequence', purpose: 'cuts the branch, notifies you' },
      { agent: 'Memory', action: 'record_outcome', purpose: 'reply or silence, everything becomes a pattern' } ] },
  { id: 'memory', num: 7, name: 'Memory', sub: 'FEEDS THE NEXT PASS', badge: 'NATIVE BRICK',
    tip: 'Consolidates winning patterns and feeds the next detection. The moat.',
    role: 'Every outcome — reply, silence, revived deal — becomes a pattern. Memory consolidates, vectorises, and feeds the next detection. The more you use it, the sharper the loop.',
    agents: ['Memory', 'ICP Refiner', 'Competitor Watch'],
    interactions: [
      { agent: 'Memory', action: 'persist_pattern', purpose: 'stores what worked — and why' },
      { agent: 'ICP Refiner', action: 'refine_target', purpose: 'tightens the profile that replies' },
      { agent: 'Memory', action: 'feeds_11_agents', purpose: 'the other agents read the patterns' } ] },
];

// ─── DATA · TA BOÎTE (envoi natif, dans le noyau) ───────────

const INBOX_FR = {
  id: 'inbox', name: 'Ta boîte', badge: 'NATIF', sub: 'GMAIL · OUTLOOK · SMTP',
  tip: 'baakalai envoie depuis ta propre boîte et y détecte les réponses. Aucun outil tiers requis.',
  role: 'Le canal d’envoi par défaut — et il t’appartient. Gmail et Outlook se connectent en OAuth un clic ; un SMTP custom (OVH, serveur dédié…) se branche avec des credentials chiffrés. baakalai envoie chaque étape depuis ton adresse, surveille les réponses et coupe la séquence dès que le prospect répond.',
  agents: ['CRM', 'Prospection', 'Reporting'],
  interactions: [
    { agent: 'CRM', action: 'send_personal', purpose: 'relance depuis ton adresse, ta signature' },
    { agent: 'CRM', action: 'detect_reply', purpose: 'lit ta boîte, stoppe la branche' },
    { agent: 'Reporting', action: 'send_report', purpose: 'livre le rapport hebdo dans ta boîte' } ] };

const INBOX_EN = {
  id: 'inbox', name: 'Your inbox', badge: 'NATIVE', sub: 'GMAIL · OUTLOOK · SMTP',
  tip: 'baakalai sends from your own inbox and detects replies there. No third-party tool required.',
  role: 'The default sending channel — and it belongs to you. Gmail and Outlook connect in one-click OAuth; a custom SMTP (OVH, dedicated server…) plugs in with encrypted credentials. baakalai sends every step from your address, watches for replies and cuts the sequence the moment the prospect answers.',
  agents: ['CRM', 'Prospection', 'Reporting'],
  interactions: [
    { agent: 'CRM', action: 'send_personal', purpose: 'follow-up from your address, your signature' },
    { agent: 'CRM', action: 'detect_reply', purpose: 'reads your inbox, stops the branch' },
    { agent: 'Reporting', action: 'send_report', purpose: 'drops the weekly report in your inbox' } ] };

// ─── DATA · OUTILS PÉRIPHÉRIQUES ────────────────────────────
// group: 'crm-oauth' | 'crm-config' | 'outbound' | 'infra'

const TOOLS_FR = [
  { id: 'hubspot', name: 'HubSpot', group: 'crm-oauth', tag: '1 CLIC',
    tip: 'CRM — connexion OAuth un clic.',
    role: 'CRM connecté en OAuth un clic. baakalai lit les contacts et les deals, pousse les activités et remonte les scores calculés par la Memory.',
    interactions: [
      { agent: 'CRM', action: 'sync_contacts', purpose: 'maintient une base unifiée' },
      { agent: 'CRM', action: 'push_score', purpose: 'remonte le score deal calculé par Memory' } ] },
  { id: 'pipedrive', name: 'Pipedrive', group: 'crm-oauth', tag: '1 CLIC',
    tip: 'CRM — connexion OAuth un clic, webhooks temps réel.',
    role: 'CRM connecté en OAuth un clic. Sync bidirectionnelle : baakalai lit les deals et contacts, renvoie les activités, et réagit aux webhooks en temps réel.',
    interactions: [
      { agent: 'CRM', action: 'webhook → deal_stagnant', purpose: 'déclenche la boucle de relance' },
      { agent: 'CRM', action: 'log_activity', purpose: 'écrit note + tag dans le deal' } ] },
  { id: 'salesforce', name: 'Salesforce', group: 'crm-oauth', tag: '1 CLIC',
    tip: 'CRM — connexion OAuth un clic, field mapping custom.',
    role: 'Pour les structures qui tournent sur Salesforce — OAuth un clic. baakalai fait du field mapping custom, lit les opportunities et écrit dans les custom fields.',
    interactions: [
      { agent: 'CRM', action: 'sync_opportunities', purpose: 'lecture pipeline' },
      { agent: 'CRM', action: 'write_custom_field', purpose: 'pousse les insights baakalai' } ] },
  { id: 'odoo', name: 'Odoo', group: 'crm-config', tag: 'CLÉ API',
    tip: 'CRM — connexion par clé API (JSON-RPC).',
    role: 'Pour les boîtes sur stack Odoo. Connexion JSON-RPC par clé API — pas encore d’OAuth un clic. Sync des contacts et deals comme un CRM standard.',
    interactions: [ { agent: 'CRM', action: 'rpc_sync', purpose: 'sync contacts/deals via Odoo' } ] },
  { id: 'notion', name: 'Notion', group: 'crm-config', tag: 'CLÉ API',
    tip: 'Base de contacts — connexion par clé API.',
    role: 'Pour les équipes qui gèrent leurs contacts dans Notion. Connexion par clé API : baakalai détecte le schema et sync les bases de contacts comme un CRM.',
    interactions: [ { agent: 'CRM', action: 'sync_database', purpose: 'lit/écrit la base Notion contacts' } ] },
  { id: 'airtable', name: 'Airtable', group: 'crm-config', tag: 'CLÉ API',
    tip: 'Base de contacts — connexion par clé API, batch de 10.',
    role: 'Pour les bases de contacts dans Airtable. Connexion par clé API, sync par batch de 10 (rate limit), même rôle que les autres CRM.',
    interactions: [ { agent: 'CRM', action: 'batch_sync', purpose: 'sync 10 records à la fois' } ] },
  { id: 'folk', name: 'Folk', group: 'crm-config', tag: 'CLÉ API',
    tip: 'CRM léger — connexion par clé API.',
    role: 'Pour les équipes qui pilotent leurs relations dans Folk. Connexion par clé API — pas encore d’OAuth un clic. baakalai sync les contacts et les groupes comme un CRM.',
    interactions: [ { agent: 'CRM', action: 'api_sync', purpose: 'sync contacts/groupes Folk' } ] },
  { id: 'apollo', name: 'Apollo', group: 'outbound', tag: 'OPTIONNEL',
    tip: 'Recherche & enrichissement de prospects — optionnel.',
    role: 'Le moteur de recherche de prospects. Optionnel : utile quand tu fais de l’outbound à froid. baakalai l’utilise pour trouver des contacts qui matchent un ICP et récupère les infos enrichies.',
    interactions: [
      { agent: 'Prospection', action: 'search(icp)', purpose: 'trouve les leads qui matchent le critère' },
      { agent: 'Prospection', action: 'enrich(contact)', purpose: 'remplit les champs manquants avant envoi' } ] },
  { id: 'lemlist', name: 'Lemlist', group: 'outbound', tag: 'OPTIONNEL',
    tip: 'Campagnes & séquences — optionnel depuis l’envoi natif.',
    role: 'Optionnel depuis le moteur d’envoi natif : baakalai envoie par défaut depuis ta propre boîte. Si tu as déjà Lemlist, il y déploie les séquences rédigées par Claude, surveille l’A/B test, et rapatrie les réponses vers la Memory.',
    interactions: [
      { agent: 'Prospection', action: 'create_campaign', purpose: 'pousse une séquence prête à envoyer' },
      { agent: 'Prospection', action: 'sync_replies', purpose: 'récupère réponses → Memory' } ] },
  { id: 'smartlead', name: 'Smartlead', group: 'outbound', tag: 'OPTIONNEL',
    tip: 'Campagnes multi-inboxes — optionnel, gros volumes.',
    role: 'Optionnel, alternative à Lemlist pour les volumes plus importants. Même rôle : déployer la séquence, gérer la délivrabilité, remonter les analytics.',
    interactions: [
      { agent: 'Prospection', action: 'create_campaign', purpose: 'pousse séquence multi-inboxes' },
      { agent: 'Prospection', action: 'fetch_analytics', purpose: 'remonte open/reply pour Reporting' } ] },
  { id: 'instantly', name: 'Instantly', group: 'outbound', tag: 'OPTIONNEL',
    tip: 'Workflows & séquences — les branches tournent nativement.',
    role: 'Optionnel : les séquences conditionnelles à branches tournent désormais nativement dans baakalai. Reste branchable pour les équipes qui pilotent déjà leur outbound depuis Instantly.',
    interactions: [ { agent: 'Prospection', action: 'create_workflow', purpose: 'séquence conditionnelle' } ] },
  { id: 'lgm', name: 'LaGrowthMachine', group: 'outbound', tag: 'OPTIONNEL',
    tip: 'Workflows multicanal email + LinkedIn — optionnel.',
    role: 'Multicanal email + LinkedIn + Twitter. Optionnel : baakalai l’orchestre quand un prospect doit recevoir un mix de touches sur plusieurs canaux.',
    interactions: [ { agent: 'Prospection', action: 'multichannel_seq', purpose: 'mixe email + LI + X' } ] },
  { id: 'brave', name: 'Brave Search', group: 'outbound', tag: 'OPTIONNEL',
    tip: 'Recherche web pour personnaliser — optionnel.',
    role: 'Le navigateur silencieux. Quand baakalai a besoin de comprendre une société (actu, levée, prod) avant de personnaliser un message, il consulte Brave.',
    interactions: [ { agent: 'Prospection', action: 'web_search(company)', purpose: 'contexte récent pour personnalisation' } ] },
  { id: 'supabase', name: 'Supabase', group: 'infra', tag: 'INFRA',
    tip: 'PostgreSQL principal — sous le capot.',
    role: 'La base PostgreSQL principale de baakalai. Stocke les campagnes, contacts unifiés, événements, logs.',
    interactions: [
      { agent: 'Reporting', action: 'query_week', purpose: 'aggrège les KPI de la semaine' },
      { agent: 'Memory', action: 'persist_pattern', purpose: 'stocke les patterns gagnants' } ] },
  { id: 'pgvector', name: 'pgvector', group: 'infra', tag: 'INFRA',
    tip: 'Recherche vectorielle de la Memory — sous le capot.',
    role: 'L’extension PostgreSQL qui rend la Memory vectorielle. baakalai y indexe les emails, deals et contextes pour retrouver les patterns par similarité sémantique.',
    interactions: [
      { agent: 'Memory', action: 'vector_search', purpose: 'trouve les cas similaires' },
      { agent: 'Memory', action: 'embed(text)', purpose: 'vectorise nouveau pattern' } ] },
  { id: 'notion-store', name: 'Notion (store)', group: 'infra', tag: 'INFRA',
    tip: 'Store de diagnostics versionnés — sous le capot.',
    role: 'Notion utilisé comme store de documents — diagnostics versionnés, rapports archivés. Chaque rapport hebdo y a sa page.',
    interactions: [
      { agent: 'Reporting', action: 'archive_report', purpose: 'pose le rapport versionné' },
      { agent: 'Memory', action: 'read_diagnostic', purpose: 'consulte les diagnostics passés' } ] },
  { id: 'resend', name: 'Resend', group: 'infra', tag: 'INFRA',
    tip: 'Emails système baakalai → toi — jamais pour l’outbound.',
    role: 'Le canal d’emails système baakalai → toi : rapports hebdo, alertes, digests. Pas pour l’outbound.',
    interactions: [
      { agent: 'Reporting', action: 'send_digest', purpose: 'livre le rapport vendredi 17h' },
      { agent: 'Reporting', action: 'send_alert', purpose: 'flag anomalie en temps réel' } ] },
];

const TOOLS_EN = [
  { id: 'hubspot', name: 'HubSpot', group: 'crm-oauth', tag: '1 CLICK',
    tip: 'CRM — one-click OAuth connection.',
    role: 'CRM connected in one-click OAuth. baakalai reads contacts and deals, pushes activities and writes back the scores computed by Memory.',
    interactions: [
      { agent: 'CRM', action: 'sync_contacts', purpose: 'keeps a unified base' },
      { agent: 'CRM', action: 'push_score', purpose: 'pushes back the deal score from Memory' } ] },
  { id: 'pipedrive', name: 'Pipedrive', group: 'crm-oauth', tag: '1 CLICK',
    tip: 'CRM — one-click OAuth, real-time webhooks.',
    role: 'CRM connected in one-click OAuth. Two-way sync: baakalai reads deals and contacts, writes back activities, and reacts to webhooks in real time.',
    interactions: [
      { agent: 'CRM', action: 'webhook → stagnant_deal', purpose: 'triggers the follow-up loop' },
      { agent: 'CRM', action: 'log_activity', purpose: 'writes note + tag in the deal' } ] },
  { id: 'salesforce', name: 'Salesforce', group: 'crm-oauth', tag: '1 CLICK',
    tip: 'CRM — one-click OAuth, custom field mapping.',
    role: 'For Salesforce-driven orgs — one-click OAuth. baakalai handles custom field mapping, reads opportunities and writes into custom fields.',
    interactions: [
      { agent: 'CRM', action: 'sync_opportunities', purpose: 'reads the pipeline' },
      { agent: 'CRM', action: 'write_custom_field', purpose: 'pushes baakalai insights' } ] },
  { id: 'odoo', name: 'Odoo', group: 'crm-config', tag: 'API KEY',
    tip: 'CRM — API-key connection (JSON-RPC).',
    role: 'For Odoo-stack companies. JSON-RPC connection via API key — no one-click OAuth yet. Syncs contacts and deals like a standard CRM.',
    interactions: [ { agent: 'CRM', action: 'rpc_sync', purpose: 'syncs contacts/deals via Odoo' } ] },
  { id: 'notion', name: 'Notion', group: 'crm-config', tag: 'API KEY',
    tip: 'Contact base — API-key connection.',
    role: 'For teams running their contacts in Notion. API-key connection: baakalai detects the schema and syncs the contact base like a CRM.',
    interactions: [ { agent: 'CRM', action: 'sync_database', purpose: 'reads/writes the Notion contacts base' } ] },
  { id: 'airtable', name: 'Airtable', group: 'crm-config', tag: 'API KEY',
    tip: 'Contact base — API-key connection, batches of 10.',
    role: 'For Airtable-based contact bases. API-key connection, sync in batches of 10 (rate limit), same role as the other CRMs.',
    interactions: [ { agent: 'CRM', action: 'batch_sync', purpose: 'syncs 10 records at a time' } ] },
  { id: 'folk', name: 'Folk', group: 'crm-config', tag: 'API KEY',
    tip: 'Lightweight CRM — API-key connection.',
    role: 'For teams running their relationships in Folk. API-key connection — no one-click OAuth yet. baakalai syncs contacts and groups like a CRM.',
    interactions: [ { agent: 'CRM', action: 'api_sync', purpose: 'syncs Folk contacts/groups' } ] },
  { id: 'apollo', name: 'Apollo', group: 'outbound', tag: 'OPTIONAL',
    tip: 'Lead search & enrichment — optional.',
    role: 'The lead search engine. Optional: useful when you run cold outbound. baakalai uses it to find contacts matching an ICP and pulls back enriched data.',
    interactions: [
      { agent: 'Prospection', action: 'search(icp)', purpose: 'finds leads matching the criteria' },
      { agent: 'Prospection', action: 'enrich(contact)', purpose: 'fills missing fields before sending' } ] },
  { id: 'lemlist', name: 'Lemlist', group: 'outbound', tag: 'OPTIONAL',
    tip: 'Campaigns & sequences — optional since native sending.',
    role: 'Optional since the native sending engine: baakalai sends from your own inbox by default. If you already run Lemlist, it deploys Claude-written sequences there, watches the A/B, and pulls replies back into Memory.',
    interactions: [
      { agent: 'Prospection', action: 'create_campaign', purpose: 'pushes a ready-to-send sequence' },
      { agent: 'Prospection', action: 'sync_replies', purpose: 'pulls replies → Memory' } ] },
  { id: 'smartlead', name: 'Smartlead', group: 'outbound', tag: 'OPTIONAL',
    tip: 'Multi-inbox campaigns — optional, higher volumes.',
    role: 'Optional, alternative to Lemlist for higher volumes. Same role: deploy the sequence, manage deliverability, surface analytics.',
    interactions: [
      { agent: 'Prospection', action: 'create_campaign', purpose: 'pushes multi-inbox sequence' },
      { agent: 'Prospection', action: 'fetch_analytics', purpose: 'feeds open/reply rates to Reporting' } ] },
  { id: 'instantly', name: 'Instantly', group: 'outbound', tag: 'OPTIONAL',
    tip: 'Workflows & sequences — branches now run natively.',
    role: 'Optional: branching conditional sequences now run natively inside baakalai. Still pluggable for teams already driving their outbound from Instantly.',
    interactions: [ { agent: 'Prospection', action: 'create_workflow', purpose: 'conditional sequence' } ] },
  { id: 'lgm', name: 'LaGrowthMachine', group: 'outbound', tag: 'OPTIONAL',
    tip: 'Multichannel email + LinkedIn workflows — optional.',
    role: 'Multichannel: email + LinkedIn + Twitter. Optional: baakalai orchestrates it when a prospect needs touches across multiple channels.',
    interactions: [ { agent: 'Prospection', action: 'multichannel_seq', purpose: 'mixes email + LI + X' } ] },
  { id: 'brave', name: 'Brave Search', group: 'outbound', tag: 'OPTIONAL',
    tip: 'Web research for personalisation — optional.',
    role: 'The silent browser. When baakalai needs to understand a company (news, funding, product) before personalising a message, it queries Brave.',
    interactions: [ { agent: 'Prospection', action: 'web_search(company)', purpose: 'fresh context for personalisation' } ] },
  { id: 'supabase', name: 'Supabase', group: 'infra', tag: 'INFRA',
    tip: 'Main PostgreSQL — under the hood.',
    role: 'baakalai\u2019s main PostgreSQL database. Stores campaigns, unified contacts, events, logs.',
    interactions: [
      { agent: 'Reporting', action: 'query_week', purpose: 'aggregates the week\u2019s KPIs' },
      { agent: 'Memory', action: 'persist_pattern', purpose: 'stores winning patterns' } ] },
  { id: 'pgvector', name: 'pgvector', group: 'infra', tag: 'INFRA',
    tip: 'Vector search behind Memory — under the hood.',
    role: 'The PostgreSQL extension that makes Memory vectorial. baakalai indexes emails, deals and context here to retrieve patterns by semantic similarity.',
    interactions: [
      { agent: 'Memory', action: 'vector_search', purpose: 'finds similar cases' },
      { agent: 'Memory', action: 'embed(text)', purpose: 'vectorises new pattern' } ] },
  { id: 'notion-store', name: 'Notion (store)', group: 'infra', tag: 'INFRA',
    tip: 'Versioned diagnostics store — under the hood.',
    role: 'Notion used as a doc store — versioned diagnostics, archived reports. Each weekly report gets its own page.',
    interactions: [
      { agent: 'Reporting', action: 'archive_report', purpose: 'drops the versioned report' },
      { agent: 'Memory', action: 'read_diagnostic', purpose: 'consults past diagnostics' } ] },
  { id: 'resend', name: 'Resend', group: 'infra', tag: 'INFRA',
    tip: 'System emails baakalai → you — never for outbound.',
    role: 'The system-email channel from baakalai → you: weekly reports, alerts, digests. Not for outbound.',
    interactions: [
      { agent: 'Reporting', action: 'send_digest', purpose: 'delivers the report Friday 5pm' },
      { agent: 'Reporting', action: 'send_alert', purpose: 'flags anomalies in real time' } ] },
];

// ─── DATA · SÉQUENCE ANIMÉE (une passe de la boucle) ────────
// via:'bezier' = le trajet ENTRANT emprunte la branche « ignore »

const SEQ_FR = [
  { node: 'crm-read', verb: 'lit ton CRM', detail: 'deals · contacts · historique' },
  { node: 'detect',   verb: 'détecte', detail: 'deal #4218 · 14 j sans activité' },
  { node: 'sequence', verb: 'propose une séquence', detail: 'Deal Coach · 3 étapes · 2 branches' },
  { node: 'approve',  verb: 'attend ton feu vert', detail: 'tu valides, tu édites ou tu refuses' },
  { node: 'send',     verb: 'envoie depuis ta boîte', detail: 'Gmail OAuth · étape 1 · mar. 10:00' },
  { node: 'reply',    verb: 'pas de réponse', detail: 'branche « ignore » → étape suivante', branch: 'ignore' },
  { node: 'send',     verb: 'renvoie', detail: 'étape 2 · toujours depuis ton adresse', via: 'bezier' },
  { node: 'reply',    verb: 'réponse détectée', detail: 'branche « répond » → séquence stoppée', branch: 'stop' },
  { node: 'memory',   verb: 'mémorise', detail: 'pattern gagnant → les 11 autres agents' },
];

const SEQ_EN = [
  { node: 'crm-read', verb: 'reads your CRM', detail: 'deals · contacts · history' },
  { node: 'detect',   verb: 'detects', detail: 'deal #4218 · 14d no activity' },
  { node: 'sequence', verb: 'proposes a sequence', detail: 'Deal Coach · 3 steps · 2 branches' },
  { node: 'approve',  verb: 'waits for your go', detail: 'you approve, edit or reject' },
  { node: 'send',     verb: 'sends from your inbox', detail: 'Gmail OAuth · step 1 · tue 10:00' },
  { node: 'reply',    verb: 'no reply', detail: '"ignore" branch → next step', branch: 'ignore' },
  { node: 'send',     verb: 'sends again', detail: 'step 2 · still from your address', via: 'bezier' },
  { node: 'reply',    verb: 'reply detected', detail: '"reply" branch → sequence stopped', branch: 'stop' },
  { node: 'memory',   verb: 'memorises', detail: 'winning pattern → the 11 other agents' },
];

// ─── DATA · AGENTS (section philosophie) ────────────────────

const AGENTS_FR = [
  { id: 'prospection', name: 'Prospection', short: 'PRSP',
    tagline: 'Gère l’outbound quand tu en as besoin.',
    desc: 'Génère séquences email/LinkedIn, recherche prospects (Apollo, en option), envoie depuis ta propre boîte mail, refine en A/B continu. Coordonne le Copy Optimizer et le Timing Agent.' },
  { id: 'crm', name: 'CRM', short: 'CRM',
    tagline: 'Lit ton CRM 24/7. Réactive les deals, détecte les upsells.',
    desc: 'Sync bidirectionnelle, détecte stagnation et churn, déclenche follow-ups personnalisés. Coordonne le Deal Coach, l’Upsell Detector et le Win/Loss Analyst. Le cœur du produit.' },
  { id: 'memory', name: 'Memory', short: 'MEM',
    tagline: 'Plus tu l’utilises, plus il est précis.',
    desc: 'Consolide les patterns gagnants, vectorise les contextes via pgvector, alimente les 11 autres agents. Coordonne l’ICP Refiner et le Competitor Watch. C’est le moat.' },
  { id: 'reporting', name: 'Reporting', short: 'RPRT',
    tagline: 'Te dit ce qui marche — et ce qui meurt.',
    desc: 'Génère diagnostics hebdo, repère les deals à réactiver, livre des recommandations en langage clair. 12 agents au total, 4 quotidiens + 7 stratégiques + 1 générateur de templates.' },
];

const AGENTS_EN = [
  { id: 'prospection', name: 'Prospection', short: 'PRSP',
    tagline: 'Handles outbound when you need it.',
    desc: 'Generates email/LinkedIn sequences, sources prospects (Apollo, optional), sends from your own inbox, refines through continuous A/B testing. Coordinates the Copy Optimizer and Timing Agent.' },
  { id: 'crm', name: 'CRM', short: 'CRM',
    tagline: 'Reads your CRM 24/7. Reactivates deals, detects upsells.',
    desc: 'Two-way sync, detects stagnation and churn, fires personalised follow-ups. Coordinates the Deal Coach, Upsell Detector, and Win/Loss Analyst. The core of the product.' },
  { id: 'memory', name: 'Memory', short: 'MEM',
    tagline: 'The more you use it, the sharper it gets.',
    desc: 'Consolidates winning patterns, vectorises context through pgvector, feeds the 11 other agents. Coordinates the ICP Refiner and Competitor Watch. This is the moat.' },
  { id: 'reporting', name: 'Reporting', short: 'RPRT',
    tagline: 'Tells you what works — and what\u2019s dying.',
    desc: 'Writes weekly diagnostics, flags deals to reactivate, delivers recommendations in plain language. 12 agents total: 4 daily + 7 strategic + 1 template generator.' },
];

// ─── DATA · UI ──────────────────────────────────────────────

const UI_FR = {
  navHow: 'Comment ça marche', navPricing: 'Tarif', navLogin: 'Se connecter', navTry: 'Rejoindre la beta →',
  heroEyebrow: '— BAAKALAI · COMMENT ÇA MARCHE',
  heroT1: 'Une ', heroEm: 'boucle', heroT2: ' qui se referme.', heroT3: 'Pas une pile d’outils.',
  heroSub: 'baakalai lit ton CRM, détecte les deals qui dorment, propose une séquence de relance, attend ton feu vert, envoie depuis ta boîte Gmail ou Outlook — et s’arrête dès qu’on te répond. Ce qu’il apprend nourrit la détection suivante. Douze agents qui font le travail qu’un RevOps ferait.',
  legendCore: 'Natif — tourne dans baakalai',
  legendInbox: 'Ta boîte — Gmail · Outlook · SMTP',
  legendOpt: 'Optionnel — si tu l’as déjà',
  pause: '⏸ Pause', resume: '▶ Reprendre',
  hint: '↑ clique une étape ou un outil pour voir son rôle · la boucle tourne toute seule',
  scrollHint: '← fais défiler le schéma →',
  capEyebrow: 'LA BOUCLE', step: 'ÉTAPE',
  coreLabel: '— LE NOYAU BAAKALAI', coreSub: '12 AGENTS · PROPULSÉ PAR CLAUDE',
  coreTip: 'Le cerveau de baakalai. Décide quel agent activer, écrit, analyse, consolide la mémoire — propulsé par Claude.',
  coreTitle: 'baakalai — le noyau',
  coreBody: 'baakalai est au centre — pas parce qu’il fait tout, mais parce qu’il décide. À chaque passe de la boucle, il lit l’historique, consulte la Memory, choisit lequel des douze agents doit prendre le relai, puis rédige le langage humain (séquences, emails, rapports). Le moteur de raisonnement est Claude (Anthropic). Ensemble, ils font le travail qu’un RevOps ferait — la boucle entière, de la lecture du CRM à la mémoire.',
  coreBadges: ['12 AGENTS', 'ENVOI NATIF', 'MOTEUR DE SÉQUENCES', 'MÉMOIRE'],
  branchStop: 'RÉPOND → ON ARRÊTE',
  branchIgnore: 'IGNORE → ÉTAPE SUIVANTE',
  inboxLabel: 'TA BOÎTE · NATIF',
  grpCrm: 'TON CRM', grpCrmOauth: 'OAUTH 1 CLIC', grpCrmConfig: 'CLÉ API', grpCrmNote: 'BRANCHE LE TIEN',
  grpOutbound: 'DÉJÀ OUTILLÉ ?', grpOutboundNote: 'OPTIONNEL — BAAKALAI ENVOIE SANS EUX',
  grpInfra: 'SOUS LE CAPOT',
  kindStep: 'ÉTAPE DE LA BOUCLE', kindTool: 'OUTIL TIERS', kindInfra: 'INFRA BAAKALAI', kindInbox: 'ENVOI NATIF', kindCore: 'ORCHESTRATEUR',
  panelRole: 'RÔLE', panelInter: 'INTERACTIONS', panelAgents: 'AGENTS IMPLIQUÉS',
  philEyebrow: '— LA PHILOSOPHIE',
  philTitle: ['On a découpé le boulot en ', 'douze agents', ' — quatre opérationnels quotidiens, sept stratégiques, un générateur de templates.'],
  agentWord: 'AGENT',
  ctaCaption: 'prêt à voir ta propre boucle tourner ?',
  ctaTitle: 'Connecte ton CRM et ta boîte — baakalai prend le relais.',
  ctaButton: 'Rejoindre la beta',
  ctaNote: 'Beta sur candidature · 20 minutes avec un fondateur',
};

const UI_EN = {
  navHow: 'How it works', navPricing: 'Pricing', navLogin: 'Sign in', navTry: 'Join the beta →',
  heroEyebrow: '— BAAKALAI · HOW IT WORKS',
  heroT1: 'A ', heroEm: 'loop', heroT2: ' that closes.', heroT3: 'Not a stack of tools.',
  heroSub: 'baakalai reads your CRM, spots sleeping deals, drafts a follow-up sequence, waits for your go, sends from your own Gmail or Outlook inbox — and stops the moment someone replies. What it learns feeds the next detection. Twelve agents doing the work a RevOps hire would do.',
  legendCore: 'Native — runs inside baakalai',
  legendInbox: 'Your inbox — Gmail · Outlook · SMTP',
  legendOpt: 'Optional — if you already have it',
  pause: '⏸ Pause', resume: '▶ Resume',
  hint: '↑ click a step or a tool to see its role · the loop runs on its own',
  scrollHint: '← scroll the diagram →',
  capEyebrow: 'THE LOOP', step: 'STEP',
  coreLabel: '— THE BAAKALAI CORE', coreSub: '12 AGENTS · POWERED BY CLAUDE',
  coreTip: 'baakalai\u2019s brain. Decides which agent to activate, writes, analyses, consolidates memory — powered by Claude.',
  coreTitle: 'baakalai — the core',
  coreBody: 'baakalai sits at the center — not because it does everything, but because it decides. On every pass of the loop it reads the history, queries Memory, picks which of the twelve agents should take over, then writes the human language (sequences, emails, reports). The reasoning engine is Claude (Anthropic). Together they do the work a RevOps hire would do — the whole loop, from CRM read to memory.',
  coreBadges: ['12 AGENTS', 'NATIVE SENDING', 'SEQUENCE ENGINE', 'MEMORY'],
  branchStop: 'REPLIES → WE STOP',
  branchIgnore: 'IGNORES → NEXT STEP',
  inboxLabel: 'YOUR INBOX · NATIVE',
  grpCrm: 'YOUR CRM', grpCrmOauth: 'ONE-CLICK OAUTH', grpCrmConfig: 'API KEY', grpCrmNote: 'PLUG IN YOURS',
  grpOutbound: 'ALREADY TOOLED UP?', grpOutboundNote: 'OPTIONAL — BAAKALAI SENDS WITHOUT THEM',
  grpInfra: 'UNDER THE HOOD',
  kindStep: 'LOOP STEP', kindTool: 'THIRD-PARTY TOOL', kindInfra: 'BAAKALAI INFRA', kindInbox: 'NATIVE SENDING', kindCore: 'ORCHESTRATOR',
  panelRole: 'ROLE', panelInter: 'INTERACTIONS', panelAgents: 'AGENTS INVOLVED',
  philEyebrow: '— THE PHILOSOPHY',
  philTitle: ['We split the job into ', 'twelve agents', ' — four daily operators, seven strategic, one template generator.'],
  agentWord: 'AGENT',
  ctaCaption: 'ready to watch your own loop run?',
  ctaTitle: 'Connect your CRM and your inbox — baakalai takes over.',
  ctaButton: 'Join the beta',
  ctaNote: 'Beta by application · 20 minutes with a founder',
};

function getData(lang) {
  const en = lang === 'en';
  return {
    lang: en ? 'en' : 'fr',
    STEPS: en ? STEPS_EN : STEPS_FR,
    TOOLS: en ? TOOLS_EN : TOOLS_FR,
    INBOX: en ? INBOX_EN : INBOX_FR,
    SEQ: en ? SEQ_EN : SEQ_FR,
    AGENTS: en ? AGENTS_EN : AGENTS_FR,
    UI: en ? UI_EN : UI_FR,
  };
}

// ─── GÉOMÉTRIE ──────────────────────────────────────────────

const W = 1280, H = 880, CX = 640, CY = 430;
const RX = 270, RY = 185;      // anneau des étapes
const BX = 360, BY = 272;      // frontière du noyau

const ORDER = ['crm-read', 'detect', 'sequence', 'approve', 'send', 'reply', 'memory'];
const STEP_DEG = 360 / 7;
const angleOf = (i) => 180 + i * STEP_DEG;
const rad = (d) => (d * Math.PI) / 180;
const ringPt = (deg) => ({ x: CX + Math.cos(rad(deg)) * RX, y: CY + Math.sin(rad(deg)) * RY });

const STEP_POS = {};
ORDER.forEach((id, i) => { STEP_POS[id] = { ...ringPt(angleOf(i)), deg: angleOf(i), i }; });

// Branche « ignore » : bézier quadratique reply → send
const BR = { p0: STEP_POS['reply'], p1: { x: 830, y: 645 }, p2: { x: STEP_POS['send'].x - 14, y: STEP_POS['send'].y + 22 } };
const bezierPt = (t) => ({
  x: (1 - t) * (1 - t) * BR.p0.x + 2 * (1 - t) * t * BR.p1.x + t * t * BR.p2.x,
  y: (1 - t) * (1 - t) * BR.p0.y + 2 * (1 - t) * t * BR.p1.y + t * t * BR.p2.y,
});

// Colonnes périphériques
const CRM_COL_X = 150;
const CRM_YS = { header: 108, oauthSub: 142, oauth: [176, 230, 284], configSub: 342, config: [376, 430, 484, 538] };
const OUT_COL_X = 1130;
const OUT_YS = { header: 108, note: 126, tools: [168, 226, 284, 342, 400, 458] };
const INFRA_Y = 812;
const INFRA_XS = [478, 586, 694, 802];

const seedRand = (seed) => { let s = seed; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; };

// ─── SCÈNE SVG ──────────────────────────────────────────────

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

function svgScene(d) {
  const t = d.UI;
  const r1 = seedRand(7), r2 = seedRand(42);
  let dust = '';
  for (let i = 0; i < 200; i++) {
    dust += `<circle cx="${(r1() * W).toFixed(1)}" cy="${(r2() * H).toFixed(1)}" r="${(r1() * 1.4 + 0.2).toFixed(2)}" fill="#A998FF" opacity="${(0.12 + r2() * 0.45).toFixed(2)}"/>`;
  }

  // Anneau de la boucle + chevrons de direction
  let ring = `<ellipse cx="${CX}" cy="${CY}" rx="${RX}" ry="${RY}" fill="none" stroke="#A998FF" stroke-width="1.2" opacity="0.28"/>`;
  for (let i = 0; i < 7; i++) {
    const mid = angleOf(i) + STEP_DEG / 2;
    const p = ringPt(mid);
    const dir = Math.atan2(Math.cos(rad(mid)) * RY, -Math.sin(rad(mid)) * RX) * 180 / Math.PI;
    ring += `<path d="M -6 -4.5 L 3 0 L -6 4.5" fill="none" stroke="#A998FF" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" opacity="0.6" transform="translate(${p.x.toFixed(1)},${p.y.toFixed(1)}) rotate(${dir.toFixed(1)})"/>`;
  }

  // Nœuds d’étapes
  let steps = '';
  d.STEPS.forEach((s) => {
    const p = STEP_POS[s.id];
    const isYou = s.id === 'approve';
    steps += `<g class="nx-step" data-node="step:${s.id}" data-step="${s.id}">
      <circle class="halo" cx="${p.x}" cy="${p.y}" r="42" fill="none" stroke="#FFFFFF" stroke-width="1" opacity="0"/>
      <circle cx="${p.x}" cy="${p.y}" r="44" fill="rgba(196,181,253,0.12)"/>
      <circle class="body" cx="${p.x}" cy="${p.y}" r="27" fill="${isYou ? '#FFFFFF' : '#C4B5FD'}" stroke="rgba(255,255,255,0.35)" stroke-width="1"/>
      <text x="${p.x}" y="${p.y + 7}" text-anchor="middle" font-family="Geist Mono, monospace" font-size="19" font-weight="600" fill="#0A0A0A">${isYou ? '★' : s.num}</text>
      <text x="${p.x}" y="${p.y + 47}" text-anchor="middle" font-family="Geist, sans-serif" font-size="14.5" font-weight="500" fill="#FFFFFF" letter-spacing="-0.01em">${esc(s.name)}</text>
      <text x="${p.x}" y="${p.y + 63}" text-anchor="middle" font-family="Geist Mono, monospace" font-size="8.5" letter-spacing="0.05em" fill="#A998FF">${esc(s.sub)}</text>
    </g>`;
  });

  // Branche conditionnelle
  const rp = STEP_POS['reply'];
  const branch = `
    <g id="branch-stop" class="nx-branch" data-node="step:reply">
      <line class="branch-line" x1="${rp.x - 20}" y1="${rp.y + 18}" x2="592" y2="676" stroke="#C4B5FD" stroke-width="1.4" opacity="0.55"/>
      <rect x="580" y="670" width="11" height="11" rx="2" fill="#C4B5FD"/>
      <text x="570" y="680" text-anchor="end" font-family="Geist Mono, monospace" font-size="9.5" letter-spacing="0.05em" fill="#C4B5FD">${esc(t.branchStop)}</text>
    </g>
    <g id="branch-ignore" class="nx-branch" data-node="step:reply">
      <path class="branch-line" d="M ${BR.p0.x} ${BR.p0.y} Q ${BR.p1.x} ${BR.p1.y} ${BR.p2.x} ${BR.p2.y}" fill="none" stroke="#A998FF" stroke-width="1.4" stroke-dasharray="4 5" opacity="0.55" marker-end="url(#arrow)"/>
      <text x="852" y="668" text-anchor="middle" font-family="Geist Mono, monospace" font-size="9.5" letter-spacing="0.05em" fill="#A998FF">${esc(t.branchIgnore)}</text>
    </g>`;

  // Ta boîte (chip natif près de l’envoi)
  const sp = STEP_POS['send'];
  const inbox = `
    <g data-node="inbox">
      <line x1="${sp.x - 27}" y1="${sp.y + 6}" x2="852" y2="547" stroke="#FFFFFF" stroke-width="1.2" opacity="0.4"/>
      <text x="770" y="524" text-anchor="middle" font-family="Geist Mono, monospace" font-size="8.5" letter-spacing="0.07em" fill="#FFFFFF" opacity="0.85">${esc(t.inboxLabel)}</text>
      <rect x="688" y="533" width="164" height="26" rx="13" fill="rgba(250,250,249,0.08)" stroke="#FFFFFF" stroke-opacity="0.55" stroke-width="1.2"/>
      <text x="770" y="550" text-anchor="middle" font-family="Geist Mono, monospace" font-size="10" letter-spacing="0.06em" fill="#FAFAF9">GMAIL · OUTLOOK · SMTP</text>
    </g>`;

  // Frontière du noyau
  const core = `
    <ellipse cx="${CX}" cy="${CY}" rx="${BX}" ry="${BY}" fill="rgba(110,87,250,0.05)" stroke="#2A2A48" stroke-width="1.5"/>
    <text x="${CX}" y="${CY - BY - 16}" text-anchor="middle" font-family="Geist Mono, monospace" font-size="10.5" letter-spacing="0.1em" fill="#A998FF">${esc(t.coreLabel)}</text>`;

  // Cœur : marque synapse + wordmark
  const mark = `
    <g data-node="core">
      <circle cx="${CX}" cy="${CY - 14}" r="86" fill="url(#coreGlow)"/>
      <circle cx="${CX}" cy="${CY - 14}" r="34" fill="#6E57FA" stroke="#FFFFFF" stroke-width="1.5"/>
      <g transform="translate(${CX - 15.5}, ${CY - 29.5}) scale(0.31)">
        <line x1="50" y1="50" x2="22" y2="26" stroke="#FFFFFF" stroke-width="6" stroke-linecap="round" opacity="0.9"/>
        <line x1="50" y1="50" x2="82" y2="30" stroke="#FFFFFF" stroke-width="6" stroke-linecap="round" opacity="0.7"/>
        <line x1="50" y1="50" x2="30" y2="80" stroke="#FFFFFF" stroke-width="6" stroke-linecap="round" opacity="0.9"/>
        <circle cx="22" cy="26" r="9" fill="#FFFFFF" opacity="0.9"/>
        <circle cx="82" cy="30" r="10" fill="#FFFFFF" opacity="0.7"/>
        <circle cx="30" cy="80" r="9" fill="#FFFFFF" opacity="0.9"/>
        <circle cx="50" cy="50" r="14" fill="#FFFFFF"/>
      </g>
      <text x="${CX}" y="${CY + 46}" text-anchor="middle" font-family="Geist, sans-serif" font-size="21" font-weight="600" letter-spacing="-0.01em" fill="#FFFFFF">baakalai</text>
      <text x="${CX}" y="${CY + 66}" text-anchor="middle" font-family="Geist Mono, monospace" font-size="9" letter-spacing="0.08em" fill="#A998FF">${esc(t.coreSub)}</text>
    </g>`;

  // Colonne CRM (gauche)
  const crmPort = { x: CX - BX + 2, y: CY };
  const crmNode = STEP_POS['crm-read'];
  let crmCol = `
    <text x="${CRM_COL_X}" y="${CRM_YS.header}" text-anchor="middle" font-family="Geist Mono, monospace" font-size="10.5" letter-spacing="0.1em" fill="#FAFAF9" opacity="0.9">${esc(t.grpCrm)}</text>
    <text x="${CRM_COL_X}" y="${CRM_YS.header + 16}" text-anchor="middle" font-family="Geist Mono, monospace" font-size="8.5" letter-spacing="0.07em" fill="#7A7A78">${esc(t.grpCrmNote)}</text>
    <text x="${CRM_COL_X}" y="${CRM_YS.oauthSub + 12}" text-anchor="middle" font-family="Geist Mono, monospace" font-size="8.5" letter-spacing="0.07em" fill="#A998FF">⚡ ${esc(t.grpCrmOauth)}</text>
    <text x="${CRM_COL_X}" y="${CRM_YS.configSub + 12}" text-anchor="middle" font-family="Geist Mono, monospace" font-size="8.5" letter-spacing="0.07em" fill="#7A7A78">${esc(t.grpCrmConfig)}</text>
    <line x1="${crmPort.x}" y1="${crmPort.y}" x2="${crmNode.x - 28}" y2="${crmNode.y}" stroke="#A998FF" stroke-width="1.4" opacity="0.5"/>
    <circle cx="${crmPort.x}" cy="${crmPort.y}" r="4" fill="#050410" stroke="#A998FF" stroke-width="1.5"/>`;
  const crmTools = d.TOOLS.filter(x => x.group === 'crm-oauth' || x.group === 'crm-config');
  crmTools.forEach((tool) => {
    const oauth = tool.group === 'crm-oauth';
    const idx = oauth ? CRM_YS.oauth[['hubspot','pipedrive','salesforce'].indexOf(tool.id)] : CRM_YS.config[['odoo','notion','airtable','folk'].indexOf(tool.id)];
    const y = idx;
    crmCol += `<g data-node="tool:${tool.id}">
      <line x1="${CRM_COL_X + 14}" y1="${y}" x2="${crmPort.x - 4}" y2="${crmPort.y}" stroke="#A998FF" stroke-width="1" ${oauth ? 'opacity="0.32"' : 'stroke-dasharray="3 4" opacity="0.24"'}/>
      <circle cx="${CRM_COL_X}" cy="${y}" r="12" fill="#FAFAF9" stroke="${oauth ? '#6E57FA' : '#2A2A48'}" stroke-width="${oauth ? 1.8 : 1.2}"/>
      <text x="${CRM_COL_X}" y="${y + 4.5}" text-anchor="middle" font-family="Geist, sans-serif" font-size="12" font-weight="600" fill="#0A0A0A">${esc(tool.name[0])}</text>
      <text x="${CRM_COL_X - 22}" y="${y + 1}" text-anchor="end" font-family="Geist Mono, monospace" font-size="9.5" letter-spacing="0.04em" fill="#FFFFFF" opacity="0.9">${esc(tool.name.toUpperCase())}</text>
      <text x="${CRM_COL_X - 22}" y="${y + 13}" text-anchor="end" font-family="Geist Mono, monospace" font-size="7.5" letter-spacing="0.05em" fill="${oauth ? '#A998FF' : '#7A7A78'}">${esc(tool.tag)}</text>
    </g>`;
  });

  // Colonne outbound (droite)
  const outPort = { x: CX + BX - 2, y: CY };
  let outCol = `
    <text x="${OUT_COL_X}" y="${OUT_YS.header}" text-anchor="middle" font-family="Geist Mono, monospace" font-size="10.5" letter-spacing="0.1em" fill="#FAFAF9" opacity="0.9">${esc(t.grpOutbound)}</text>
    <text x="${OUT_COL_X}" y="${OUT_YS.note}" text-anchor="middle" font-family="Geist Mono, monospace" font-size="8" letter-spacing="0.05em" fill="#7A7A78">${esc(t.grpOutboundNote)}</text>
    <circle cx="${outPort.x}" cy="${outPort.y}" r="4" fill="#050410" stroke="#A998FF" stroke-width="1.5" opacity="0.7"/>`;
  const outTools = d.TOOLS.filter(x => x.group === 'outbound');
  outTools.forEach((tool, i) => {
    const y = OUT_YS.tools[i];
    outCol += `<g data-node="tool:${tool.id}" opacity="0.85">
      <line x1="${OUT_COL_X - 14}" y1="${y}" x2="${outPort.x + 4}" y2="${outPort.y}" stroke="#A998FF" stroke-width="1" stroke-dasharray="3 4" opacity="0.22"/>
      <circle cx="${OUT_COL_X}" cy="${y}" r="12" fill="#FAFAF9" stroke="#2A2A48" stroke-width="1.2" stroke-dasharray="3 3"/>
      <text x="${OUT_COL_X}" y="${y + 4.5}" text-anchor="middle" font-family="Geist, sans-serif" font-size="12" font-weight="600" fill="#0A0A0A">${esc(tool.name[0])}</text>
      <text x="${OUT_COL_X + 22}" y="${y + 1}" text-anchor="start" font-family="Geist Mono, monospace" font-size="9.5" letter-spacing="0.04em" fill="#FFFFFF" opacity="0.9">${esc(tool.name.toUpperCase())}</text>
      <text x="${OUT_COL_X + 22}" y="${y + 13}" text-anchor="start" font-family="Geist Mono, monospace" font-size="7.5" letter-spacing="0.05em" fill="#7A7A78">${esc(tool.tag)}</text>
    </g>`;
  });

  // Infra (bas, discret)
  let infra = `<text x="${CX}" y="${INFRA_Y - 38}" text-anchor="middle" font-family="Geist Mono, monospace" font-size="9" letter-spacing="0.1em" fill="#7A7A78">${esc(t.grpInfra)}</text>`;
  const infraTools = d.TOOLS.filter(x => x.group === 'infra');
  infraTools.forEach((tool, i) => {
    const x = INFRA_XS[i];
    infra += `<g data-node="tool:${tool.id}" opacity="0.65">
      <line x1="${x}" y1="${INFRA_Y - 10}" x2="${CX}" y2="${CY + BY + 3}" stroke="#A998FF" stroke-width="0.8" stroke-dasharray="2 4" opacity="0.18"/>
      <circle cx="${x}" cy="${INFRA_Y}" r="9" fill="rgba(250,250,249,0.9)" stroke="#2A2A48" stroke-width="1"/>
      <text x="${x}" y="${INFRA_Y + 3.5}" text-anchor="middle" font-family="Geist, sans-serif" font-size="10" font-weight="600" fill="#0A0A0A">${esc(tool.name[0])}</text>
      <text x="${x}" y="${INFRA_Y + 26}" text-anchor="middle" font-family="Geist Mono, monospace" font-size="8" letter-spacing="0.05em" fill="#7A7A78">${esc(tool.name.toUpperCase())}</text>
    </g>`;
  });

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="coreGlow">
        <stop offset="0%" stop-color="#A998FF" stop-opacity="0.85"/>
        <stop offset="40%" stop-color="#6E57FA" stop-opacity="0.45"/>
        <stop offset="100%" stop-color="#6E57FA" stop-opacity="0"/>
      </radialGradient>
      <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M 0 1 L 8 5 L 0 9" fill="none" stroke="#A998FF" stroke-width="1.6" stroke-linecap="round"/>
      </marker>
    </defs>
    ${dust}
    ${core}
    ${ring}
    ${branch}
    ${inbox}
    ${crmCol}
    ${outCol}
    ${infra}
    ${mark}
    ${steps}
    <circle id="seq-dot" r="5" fill="#FFFFFF" opacity="0"/>
    <circle id="seq-dot2" r="3" fill="#A998FF" opacity="0"/>
  </svg>`;
}

// ─── PAGE ───────────────────────────────────────────────────

function pageHTML(d) {
  const t = d.UI;
  const markSvg = `<svg width="22" height="22" viewBox="0 0 100 100" aria-hidden="true">
    <line x1="50" y1="50" x2="22" y2="26" stroke="#C4B5FD" stroke-width="6" stroke-linecap="round"/>
    <line x1="50" y1="50" x2="82" y2="30" stroke="#9A84EB" stroke-width="6" stroke-linecap="round"/>
    <line x1="50" y1="50" x2="30" y2="80" stroke="#C4B5FD" stroke-width="6" stroke-linecap="round"/>
    <circle cx="22" cy="26" r="8" fill="#C4B5FD"/><circle cx="82" cy="30" r="9" fill="#9A84EB"/>
    <circle cx="30" cy="80" r="8" fill="#C4B5FD"/><circle cx="50" cy="50" r="14" fill="#6E57FA"/>
  </svg>`;

  const agentCards = d.AGENTS.map(a => `
    <div class="c-agent-card">
      <div class="dot"></div>
      <div class="k">${esc(t.agentWord)} · ${esc(a.short)}</div>
      <div class="n">${esc(a.name)}</div>
      <div class="t">${esc(a.tagline)}</div>
      <div class="d">${esc(a.desc)}</div>
    </div>`).join('');

  return `
  <nav class="c-nav">
    <a href="/" class="c-wordmark">${markSvg}<span>baakalai</span></a>
    <div class="c-nav-links">
      <a href="#">${esc(t.navHow)}</a>
      <a href="/#beta" class="dim">${esc(t.navPricing)}</a>
      <a href="https://app.baakal.ai" class="dim">${esc(t.navLogin)}</a>
      <div class="c-lang-switch" role="group">
        <button data-lang="fr" class="${d.lang === 'fr' ? 'active' : ''}">FR</button>
        <button data-lang="en" class="${d.lang === 'en' ? 'active' : ''}">EN</button>
      </div>
      <a href="/#book" class="c-cta-pill">${esc(t.navTry)}</a>
    </div>
  </nav>

  <section class="c-hero">
    <div class="c-hero-copy fade-up">
      <div class="c-eyebrow">${esc(t.heroEyebrow)}</div>
      <h1>${esc(t.heroT1)}<em>${esc(t.heroEm)}</em>${esc(t.heroT2)}<br>${esc(t.heroT3)}</h1>
      <p>${esc(t.heroSub)}</p>
    </div>

    <div class="c-legend fade-up" style="animation-delay:120ms; margin-bottom:18px; padding:0 24px;">
      <span><span class="swatch" style="background:#C4B5FD"></span>${esc(t.legendCore)}</span>
      <span><span class="swatch" style="background:transparent; border:1.5px solid #FFFFFF"></span>${esc(t.legendInbox)}</span>
      <span><span class="swatch" style="background:transparent; border:1.5px dashed #7A7A78"></span>${esc(t.legendOpt)}</span>
      <button class="c-chip" data-pause>${esc(t.pause)}</button>
    </div>

    <div class="c-scroll-hint">${esc(t.scrollHint)}</div>
    <div class="c-stage-scroll fade-up" style="animation-delay:240ms;">
      <div class="c-stage" id="stage">
        ${svgScene(d)}
        <div class="c-caption">
          <div class="eyebrow" id="cap-eyebrow">${esc(t.capEyebrow)}</div>
          <div class="verb" id="cap-verb"></div>
          <div class="detail" id="cap-detail"></div>
        </div>
        <div class="c-tip" id="tip"><div class="k" id="tip-k"></div><div class="n" id="tip-n"></div><div class="d" id="tip-d"></div></div>
        <div id="panel-root"></div>
      </div>
    </div>
    <div class="c-hint">${esc(t.hint)}</div>
  </section>

  <section class="c-phil">
    <div class="c-eyebrow">${esc(t.philEyebrow)}</div>
    <h2>${esc(t.philTitle[0])}<em>${esc(t.philTitle[1])}</em>${esc(t.philTitle[2])}</h2>
    <div class="c-agent-grid">${agentCards}</div>
  </section>

  <section class="c-cta">
    <div class="c-eyebrow" style="margin-bottom:14px;">${esc(t.ctaCaption)}</div>
    <h3>${esc(t.ctaTitle)}</h3>
    <a href="/#book" class="btn">${esc(t.ctaButton)}</a>
    <div class="note">${esc(t.ctaNote)}</div>
  </section>`;
}

// ─── PANNEAU DE DÉTAIL ──────────────────────────────────────

function panelHTML(d, sel) {
  const t = d.UI;
  let kind, item, badges = [];
  if (sel.kind === 'core') {
    kind = t.kindCore;
    item = { name: t.coreTitle, role: t.coreBody, interactions: [], agents: [] };
    badges = t.coreBadges;
  } else if (sel.kind === 'inbox') {
    kind = t.kindInbox; item = d.INBOX; badges = [d.INBOX.badge, d.INBOX.sub];
  } else if (sel.kind === 'step') {
    kind = t.kindStep; item = d.STEPS.find(s => s.id === sel.id);
    badges = [item.badge, `${t.step} ${item.num}/7`];
  } else {
    item = d.TOOLS.find(x => x.id === sel.id);
    kind = item.group === 'infra' ? t.kindInfra : t.kindTool;
    badges = [item.tag];
  }
  if (!item) return '';

  const badgeHtml = badges.map((b, i) => `<span class="c-badge ${i === 0 ? (sel.kind === 'tool' && (item.tag === 'OPTIONNEL' || item.tag === 'OPTIONAL' || item.tag === 'INFRA') ? 'ghost' : 'primary') : ''}">${esc(b)}</span>`).join('');
  const inters = (item.interactions || []).map(x => `
    <div class="c-inter">
      <div><span class="act">${esc(x.action)}</span><span class="agent">${esc(x.agent)}</span></div>
      <div class="why">${esc(x.purpose)}</div>
    </div>`).join('');
  const agents = (item.agents || []).map(a => `<span>${esc(a)}</span>`).join('');

  return `<aside class="c-panel">
    <button class="c-panel-close" data-close aria-label="Fermer">✕</button>
    <div class="eyebrow">${esc(kind)}</div>
    <h3>${esc(item.name)}</h3>
    <div class="badges">${badgeHtml}</div>
    <div class="sec">${esc(t.panelRole)}</div>
    <div class="role">${esc(item.role)}</div>
    ${agents ? `<div class="sec">${esc(t.panelAgents)}</div><div class="c-agents-row">${agents}</div>` : ''}
    ${inters ? `<div class="sec">${esc(t.panelInter)}</div>${inters}` : ''}
  </aside>`;
}

// ─── SÉQUENCEUR ─────────────────────────────────────────────

function makeSequencer(d) {
  const seq = d.SEQ;
  const t = d.UI;
  const dot = document.getElementById('seq-dot');
  const dot2 = document.getElementById('seq-dot2');
  const capE = document.getElementById('cap-eyebrow');
  const capV = document.getElementById('cap-verb');
  const capD = document.getElementById('cap-detail');
  const HOLD = 1700, TRAVEL = 950;

  let idx = 0, phase = 'hold', phaseStart = performance.now(), paused = false, pausedAt = 0, raf = 0, stopped = false;

  const stepEls = {};
  ORDER.forEach(id => { stepEls[id] = document.querySelector(`[data-step="${id}"]`); });
  const brStop = document.getElementById('branch-stop');
  const brIgnore = document.getElementById('branch-ignore');

  const setDot = (p, on) => {
    dot.setAttribute('cx', p.x); dot.setAttribute('cy', p.y); dot.setAttribute('opacity', on ? '1' : '0');
    dot2.setAttribute('cx', p.x); dot2.setAttribute('cy', p.y); dot2.setAttribute('opacity', on ? '0.6' : '0');
  };

  const enterHold = (i) => {
    idx = i; phase = 'hold'; phaseStart = performance.now();
    const e = seq[idx];
    Object.values(stepEls).forEach(el => el && el.classList.remove('active'));
    const el = stepEls[e.node]; if (el) el.classList.add('active');
    brStop.classList.toggle('lit', e.branch === 'stop');
    brIgnore.classList.toggle('lit', e.branch === 'ignore');
    const stepNum = (d.STEPS.find(s => s.id === e.node) || {}).num;
    capE.textContent = `${t.capEyebrow} · ${t.step} ${String(stepNum).padStart(2, '0')}`;
    capV.textContent = e.verb;
    capD.textContent = e.detail;
    setDot(STEP_POS[e.node], true);
  };

  const travelPos = (from, to, viaBezier, k) => {
    if (viaBezier) return bezierPt(k);
    let a1 = from.deg, a2 = to.deg;
    while (a2 <= a1) a2 += 360;
    return ringPt(a1 + (a2 - a1) * k);
  };

  const tick = (now) => {
    if (stopped) return;
    if (paused) { raf = requestAnimationFrame(tick); return; }
    const el = now - phaseStart;
    if (phase === 'hold') {
      if (el >= HOLD) { phase = 'travel'; phaseStart = now; }
    } else {
      const k = Math.min(1, el / TRAVEL);
      const next = (idx + 1) % seq.length;
      const from = STEP_POS[seq[idx].node];
      const to = STEP_POS[seq[next].node];
      const ease = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      setDot(travelPos(from, to, seq[next].via === 'bezier', ease), true);
      if (k >= 1) enterHold(next);
    }
    raf = requestAnimationFrame(tick);
  };

  enterHold(0);
  raf = requestAnimationFrame(tick);

  return {
    setPaused(p) {
      if (p && !paused) { paused = true; pausedAt = performance.now(); }
      else if (!p && paused) { paused = false; phaseStart += performance.now() - pausedAt; }
    },
    get paused() { return paused; },
    destroy() { stopped = true; cancelAnimationFrame(raf); },
  };
}

// ─── APP ────────────────────────────────────────────────────

(function () {
  const app = document.getElementById('app');
  let lang = (() => {
    try {
      const url = new URLSearchParams(window.location.search).get('lang');
      if (url === 'en' || url === 'fr') return url;
      const ls = localStorage.getItem('baakalai-lang');
      if (ls === 'en' || ls === 'fr') return ls;
    } catch (e) {}
    return 'fr';
  })();

  let d = getData(lang);
  let sequencer = null;
  let selection = null;

  function persistLang() {
    try { localStorage.setItem('baakalai-lang', lang); } catch (e) {}
    document.documentElement.lang = lang;
    try {
      const url = new URL(window.location);
      url.searchParams.set('lang', lang);
      window.history.replaceState({}, '', url);
    } catch (e) {}
  }

  function renderPanel() {
    document.getElementById('panel-root').innerHTML = selection ? panelHTML(d, selection) : '';
  }

  function render() {
    if (sequencer) sequencer.destroy();
    d = getData(lang);
    app.innerHTML = pageHTML(d);
    renderPanel();
    sequencer = makeSequencer(d);
  }

  // Tooltip data lookup
  function tipFor(kind, id) {
    const t = d.UI;
    if (kind === 'core') return { k: t.kindCore, n: t.coreTitle, tip: t.coreTip };
    if (kind === 'inbox') return { k: t.kindInbox, n: d.INBOX.name, tip: d.INBOX.tip };
    if (kind === 'step') { const s = d.STEPS.find(x => x.id === id); return s && { k: t.kindStep, n: s.name, tip: s.tip }; }
    const tool = d.TOOLS.find(x => x.id === id);
    return tool && { k: tool.group === 'infra' ? t.kindInfra : t.kindTool, n: tool.name, tip: tool.tip };
  }

  function parseNode(el) {
    const v = el.getAttribute('data-node');
    if (v === 'core') return { kind: 'core' };
    if (v === 'inbox') return { kind: 'inbox' };
    const [kind, id] = v.split(':');
    return { kind, id };
  }

  document.addEventListener('click', (e) => {
    const langBtn = e.target.closest('[data-lang]');
    if (langBtn) { lang = langBtn.getAttribute('data-lang'); persistLang(); render(); return; }
    const pauseBtn = e.target.closest('[data-pause]');
    if (pauseBtn) {
      sequencer.setPaused(!sequencer.paused);
      pauseBtn.textContent = sequencer.paused ? d.UI.resume : d.UI.pause;
      return;
    }
    if (e.target.closest('[data-close]')) { selection = null; renderPanel(); return; }
    const node = e.target.closest('[data-node]');
    if (node) { selection = parseNode(node); renderPanel(); return; }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && selection) { selection = null; renderPanel(); }
  });

  // Tooltip (survol desktop)
  document.addEventListener('mousemove', (e) => {
    const tipEl = document.getElementById('tip');
    if (!tipEl) return;
    const node = e.target.closest ? e.target.closest('[data-node]') : null;
    if (!node || selection) { tipEl.style.display = 'none'; return; }
    const info = tipFor(...(function () { const p = parseNode(node); return [p.kind, p.id]; })());
    if (!info) { tipEl.style.display = 'none'; return; }
    const stage = document.getElementById('stage');
    const r = stage.getBoundingClientRect();
    tipEl.style.display = 'block';
    document.getElementById('tip-k').textContent = info.k;
    document.getElementById('tip-n').textContent = info.n;
    document.getElementById('tip-d').textContent = info.tip;
    const x = Math.min(e.clientX - r.left + 16, r.width - 270);
    const y = Math.min(e.clientY - r.top + 12, r.height - 110);
    tipEl.style.left = x + 'px';
    tipEl.style.top = y + 'px';
  });

  persistLang();
  render();
})();
