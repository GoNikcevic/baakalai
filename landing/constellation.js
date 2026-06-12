// ============================================================
// BAAKALAI — Constellation Visualization (production)
// Data + Layout + Scene + SidePanel + App
// ============================================================

// ─── DATA ───────────────────────────────────────────────────

const TOOL_CATEGORIES = [
  { id: 'prospecting', label: 'PROSPECTING', color: '#A998FF' },
  { id: 'crm',         label: 'CRM',         color: '#C4B5FD' },
  { id: 'email',       label: 'EMAIL',       color: '#9A84EB' },
  { id: 'data',        label: 'DATA',        color: '#6E57FA' },
];

const AGENTS_FR = [
  { id: 'prospection', name: 'Prospection', short: 'PRSP',
    tagline: "G\u00e8re l'outbound quand tu en as besoin.",
    desc: "G\u00e9n\u00e8re s\u00e9quences email/LinkedIn, recherche prospects via Apollo, d\u00e9ploie sur Lemlist/Smartlead, refine en A/B continu. Coordonne le Copy Optimizer et le Timing Agent.",
    stats: { campagnes_actives: 23, prospects_traites: 12847, taux_reponse: '8.4%' },
    tools: ['apollo', 'lemlist', 'smartlead', 'instantly', 'lgm', 'brave'] },
  { id: 'crm', name: 'CRM', short: 'CRM',
    tagline: "Lit ton CRM 24/7. R\u00e9active les deals, d\u00e9tecte les upsells.",
    desc: "Sync bidirectionnelle, d\u00e9tecte stagnation et churn, d\u00e9clenche follow-ups personnalis\u00e9s. Coordonne le Deal Coach, l'Upsell Detector et le Win/Loss Analyst. Le c\u0153ur du produit.",
    stats: { deals_suivis: 847, deals_relances: 124, taux_reactivation: '31%' },
    tools: ['pipedrive', 'hubspot', 'salesforce', 'odoo', 'notion', 'airtable'] },
  { id: 'memory', name: 'Memory', short: 'MEM',
    tagline: "Plus tu l'utilises, plus il est pr\u00e9cis.",
    desc: "Consolide les patterns gagnants, vectorise les contextes via pgvector, alimente les 11 autres agents. Coordonne l'ICP Refiner et le Competitor Watch. C'est le moat.",
    stats: { patterns_appris: 4129, sources: 9, hits_semaine: 2840 },
    tools: ['supabase', 'pgvector', 'notion-store'] },
  { id: 'reporting', name: 'Reporting', short: 'RPRT',
    tagline: "Te dit ce qui marche \u2014 et ce qui meurt.",
    desc: "G\u00e9n\u00e8re diagnostics hebdo, rep\u00e8re les deals \u00e0 r\u00e9activer, livre des recommandations en langage clair. 12 agents au total, 4 quotidiens + 7 strat\u00e9giques + 1 g\u00e9n\u00e9rateur de templates.",
    stats: { rapports_generes: 156, anomalies_detectees: 38, recos_actives: 12 },
    tools: ['notion-store', 'resend', 'gmail'] },
];

const AGENTS_EN = [
  { id: 'prospection', name: 'Prospection', short: 'PRSP',
    tagline: "Handles outbound when you need it.",
    desc: "Generates email/LinkedIn sequences, sources prospects via Apollo, deploys on Lemlist/Smartlead, refines through continuous A/B testing. Coordinates the Copy Optimizer and Timing Agent.",
    stats: { active_campaigns: 23, prospects_processed: 12847, reply_rate: '8.4%' },
    tools: ['apollo', 'lemlist', 'smartlead', 'instantly', 'lgm', 'brave'] },
  { id: 'crm', name: 'CRM', short: 'CRM',
    tagline: "Reads your CRM 24/7. Reactivates deals, detects upsells.",
    desc: "Two-way sync, detects stagnation and churn, fires personalised follow-ups. Coordinates the Deal Coach, Upsell Detector, and Win/Loss Analyst. The core of the product.",
    stats: { deals_tracked: 847, deals_revived: 124, reactivation_rate: '31%' },
    tools: ['pipedrive', 'hubspot', 'salesforce', 'odoo', 'notion', 'airtable'] },
  { id: 'memory', name: 'Memory', short: 'MEM',
    tagline: "The more you use it, the sharper it gets.",
    desc: "Consolidates winning patterns, vectorises context through pgvector, feeds the 11 other agents. Coordinates the ICP Refiner and Competitor Watch. This is the moat.",
    stats: { patterns_learned: 4129, sources: 9, hits_this_week: 2840 },
    tools: ['supabase', 'pgvector', 'notion-store'] },
  { id: 'reporting', name: 'Reporting', short: 'RPRT',
    tagline: "Tells you what works \u2014 and what's dying.",
    desc: "Writes weekly diagnostics, flags deals to reactivate, delivers recommendations in plain language. 12 agents total: 4 daily + 7 strategic + 1 template generator.",
    stats: { reports_shipped: 156, anomalies_flagged: 38, active_recos: 12 },
    tools: ['notion-store', 'resend', 'gmail'] },
];

const TOOLS_FR = [
  { id: 'apollo', name: 'Apollo', cat: 'prospecting', desc: 'Recherche & enrichissement prospects',
    role: "Le moteur de recherche de prospects. baakalai l\u2019utilise pour trouver des contacts qui matchent un ICP \u2014 par poste, secteur, taille, localisation \u2014 et r\u00e9cup\u00e8re les infos enrichies.",
    interactions: [
      { agent: 'prospection', action: 'search(icp)', purpose: 'trouve les leads qui matchent le crit\u00e8re' },
      { agent: 'prospection', action: 'enrich(contact)', purpose: 'remplit les champs manquants avant envoi' } ] },
  { id: 'lemlist', name: 'Lemlist', cat: 'prospecting', desc: 'Campagnes & s\u00e9quences',
    role: "L\u2019ex\u00e9cutant des campagnes email. baakalai y d\u00e9ploie les s\u00e9quences r\u00e9dig\u00e9es par Claude, surveille l\u2019A/B test, et rapatrie les r\u00e9ponses vers la Memory.",
    interactions: [
      { agent: 'prospection', action: 'create_campaign', purpose: 'pousse une s\u00e9quence pr\u00eate \u00e0 envoyer' },
      { agent: 'prospection', action: 'sync_replies', purpose: 'r\u00e9cup\u00e8re r\u00e9ponses \u2192 Memory' } ] },
  { id: 'smartlead', name: 'Smartlead', cat: 'prospecting', desc: 'Campagnes, leads, analytics',
    role: "Alternative \u00e0 Lemlist pour les volumes plus importants. M\u00eame r\u00f4le : d\u00e9ployer la s\u00e9quence, g\u00e9rer la d\u00e9livrabilit\u00e9, remonter les analytics.",
    interactions: [
      { agent: 'prospection', action: 'create_campaign', purpose: 'pousse s\u00e9quence multi-inboxes' },
      { agent: 'prospection', action: 'fetch_analytics', purpose: 'remonte open/reply pour Reporting' } ] },
  { id: 'instantly', name: 'Instantly', cat: 'prospecting', desc: 'Workflows & s\u00e9quences',
    role: "Outil de s\u00e9quences avec workflows conditionnels. baakalai l\u2019utilise quand le sc\u00e9nario n\u00e9cessite des branches.",
    interactions: [ { agent: 'prospection', action: 'create_workflow', purpose: 's\u00e9quence conditionnelle' } ] },
  { id: 'lgm', name: 'LaGrowthMachine', cat: 'prospecting', desc: 'Workflows multicanal',
    role: "Multicanal email + LinkedIn + Twitter. baakalai l\u2019orchestre quand un prospect doit recevoir un mix de touches sur plusieurs canaux.",
    interactions: [ { agent: 'prospection', action: 'multichannel_seq', purpose: 'mixe email + LI + X' } ] },
  { id: 'brave', name: 'Brave Search', cat: 'prospecting', desc: 'Recherche web pour enrichir',
    role: "Le navigateur silencieux. Quand baakalai a besoin de comprendre une soci\u00e9t\u00e9 (actu, lev\u00e9e, prod) avant de personnaliser un message, il consulte Brave.",
    interactions: [ { agent: 'prospection', action: 'web_search(company)', purpose: 'contexte r\u00e9cent pour personnalisation' } ] },
  { id: 'pipedrive', name: 'Pipedrive', cat: 'crm', desc: 'Sync bidirectionnelle + webhooks',
    role: "Le CRM source de v\u00e9rit\u00e9 c\u00f4t\u00e9 commercial. Sync bidirectionnelle : baakalai lit les deals/contacts et renvoie les activit\u00e9s.",
    interactions: [
      { agent: 'crm', action: 'webhook \u2192 deal_stagnant', purpose: 'd\u00e9clenche relance automatique' },
      { agent: 'crm', action: 'log_activity', purpose: '\u00e9crit note + tag dans le deal' } ] },
  { id: 'hubspot', name: 'HubSpot', cat: 'crm', desc: 'Contacts/deals, score pushing',
    role: "CRM alternatif. M\u00eames responsabilit\u00e9s que Pipedrive : lecture des deals, push des activit\u00e9s, mise \u00e0 jour des scores.",
    interactions: [
      { agent: 'crm', action: 'sync_contacts', purpose: 'maintient base unifi\u00e9e' },
      { agent: 'crm', action: 'push_score', purpose: 'remonte score deal calcul\u00e9 par Memory' } ] },
  { id: 'salesforce', name: 'Salesforce', cat: 'crm', desc: 'REST API, field mapping',
    role: "Pour les structures qui tournent sur Salesforce. baakalai fait du field mapping custom, lit les opportunities et \u00e9crit dans les custom fields.",
    interactions: [
      { agent: 'crm', action: 'sync_opportunities', purpose: 'lecture pipeline' },
      { agent: 'crm', action: 'write_custom_field', purpose: 'pousse les insights baakalai' } ] },
  { id: 'odoo', name: 'Odoo', cat: 'crm', desc: 'JSON-RPC, contacts/deals',
    role: "Pour les bo\u00eetes sur stack Odoo. Connexion JSON-RPC, sync des contacts et deals comme un CRM standard.",
    interactions: [ { agent: 'crm', action: 'rpc_sync', purpose: 'sync contacts/deals via Odoo' } ] },
  { id: 'notion', name: 'Notion', cat: 'crm', desc: 'Sync contacts, schema',
    role: "Pour les \u00e9quipes qui g\u00e8rent leurs contacts dans Notion. baakalai d\u00e9tecte le schema et sync les bases de contacts comme un CRM.",
    interactions: [ { agent: 'crm', action: 'sync_database', purpose: 'lit/\u00e9crit la base Notion contacts' } ] },
  { id: 'airtable', name: 'Airtable', cat: 'crm', desc: 'Sync contacts (batch 10)',
    role: "Pour les bases de contacts dans Airtable. Sync par batch de 10 (rate limit), m\u00eame r\u00f4le que les autres CRM.",
    interactions: [ { agent: 'crm', action: 'batch_sync', purpose: 'sync 10 records \u00e0 la fois' } ] },
  { id: 'gmail', name: 'Gmail', cat: 'email', desc: 'Envoi 1-click via OAuth',
    role: "Ton inbox personnel. Quand baakalai doit envoyer depuis ton adresse pro (relance personnelle, follow-up deal), il passe par OAuth Gmail.",
    interactions: [
      { agent: 'crm', action: 'send_personal', purpose: 'envoi 1-to-1 depuis ton adresse' },
      { agent: 'reporting', action: 'send_report', purpose: 'livre le rapport hebdo dans ta bo\u00eete' } ] },
  { id: 'outlook', name: 'Outlook', cat: 'email', desc: 'Envoi via Microsoft OAuth',
    role: "\u00c9quivalent Gmail pour l\u2019\u00e9cosyst\u00e8me Microsoft. baakalai s\u2019authentifie via Microsoft OAuth et envoie depuis ton adresse.",
    interactions: [ { agent: 'crm', action: 'send_personal', purpose: 'envoi depuis ton Outlook' } ] },
  { id: 'smtp', name: 'SMTP', cat: 'email', desc: 'Tout provider (OVH, Gmail\u2026)',
    role: "Pour les configs custom \u2014 OVH, serveur d\u00e9di\u00e9, Gmail SMTP. Quand l\u2019OAuth ne suffit pas, baakalai utilise un SMTP brut avec credentials chiffr\u00e9s.",
    interactions: [ { agent: 'crm', action: 'send_via_smtp', purpose: 'envoi sur ton serveur custom' } ] },
  { id: 'resend', name: 'Resend', cat: 'email', desc: 'Emails syst\u00e8me',
    role: "Le canal d\u2019emails syst\u00e8me baakalai \u2192 toi : rapports hebdo, alertes, digests. Pas pour l\u2019outbound.",
    interactions: [
      { agent: 'reporting', action: 'send_digest', purpose: 'livre le rapport vendredi 17h' },
      { agent: 'reporting', action: 'send_alert', purpose: 'flag anomalie en temps r\u00e9el' } ] },
  { id: 'supabase', name: 'Supabase', cat: 'data', desc: 'PostgreSQL principal',
    role: "La base PostgreSQL principale de baakalai. Stocke les campagnes, contacts unifi\u00e9s, \u00e9v\u00e9nements, logs.",
    interactions: [
      { agent: 'reporting', action: 'query_week', purpose: 'aggr\u00e8ge les KPI de la semaine' },
      { agent: 'memory', action: 'persist_pattern', purpose: 'stocke les patterns gagnants' } ] },
  { id: 'pgvector', name: 'pgvector', cat: 'data', desc: 'Recherche vectorielle',
    role: "L\u2019extension PostgreSQL qui rend la Memory vectorielle. baakalai y indexe les emails, deals et contextes pour retrouver les patterns par similarit\u00e9 s\u00e9mantique.",
    interactions: [
      { agent: 'memory', action: 'vector_search', purpose: 'trouve les cas similaires' },
      { agent: 'memory', action: 'embed(text)', purpose: 'vectorise nouveau pattern' } ] },
  { id: 'notion-store', name: 'Notion (store)', cat: 'data', desc: 'Diagnostics & versions',
    role: "Notion utilis\u00e9 comme store de documents \u2014 diagnostics versionn\u00e9s, rapports archiv\u00e9s. Chaque rapport hebdo y a sa page.",
    interactions: [
      { agent: 'reporting', action: 'archive_report', purpose: 'pose le rapport versionn\u00e9' },
      { agent: 'memory', action: 'read_diagnostic', purpose: 'consulte les diagnostics pass\u00e9s' } ] },
];

const TOOLS_EN = [
  { id: 'apollo', name: 'Apollo', cat: 'prospecting', desc: 'Lead search & enrichment',
    role: "The lead search engine. baakalai uses it to find contacts matching an ICP \u2014 by role, industry, size, location \u2014 and pulls back enriched data.",
    interactions: [
      { agent: 'prospection', action: 'search(icp)', purpose: 'finds leads matching the criteria' },
      { agent: 'prospection', action: 'enrich(contact)', purpose: 'fills missing fields before sending' } ] },
  { id: 'lemlist', name: 'Lemlist', cat: 'prospecting', desc: 'Email campaigns & sequences',
    role: "The email campaign runner. baakalai deploys Claude-written sequences here, watches the A/B, and pulls replies back into Memory.",
    interactions: [
      { agent: 'prospection', action: 'create_campaign', purpose: 'pushes a ready-to-send sequence' },
      { agent: 'prospection', action: 'sync_replies', purpose: 'pulls replies \u2192 Memory' } ] },
  { id: 'smartlead', name: 'Smartlead', cat: 'prospecting', desc: 'Campaigns, leads, analytics',
    role: "Alternative to Lemlist for higher volumes. Same role: deploy the sequence, manage deliverability, surface analytics.",
    interactions: [
      { agent: 'prospection', action: 'create_campaign', purpose: 'pushes multi-inbox sequence' },
      { agent: 'prospection', action: 'fetch_analytics', purpose: 'feeds open/reply rates to Reporting' } ] },
  { id: 'instantly', name: 'Instantly', cat: 'prospecting', desc: 'Workflows & sequences',
    role: "Sequence tool with conditional workflows. baakalai uses it when the scenario needs branches.",
    interactions: [ { agent: 'prospection', action: 'create_workflow', purpose: 'conditional sequence' } ] },
  { id: 'lgm', name: 'LaGrowthMachine', cat: 'prospecting', desc: 'Multichannel workflows',
    role: "Multichannel: email + LinkedIn + Twitter. baakalai orchestrates it when a prospect needs touches across multiple channels.",
    interactions: [ { agent: 'prospection', action: 'multichannel_seq', purpose: 'mixes email + LI + X' } ] },
  { id: 'brave', name: 'Brave Search', cat: 'prospecting', desc: 'Web research for enrichment',
    role: "The silent browser. When baakalai needs to understand a company before personalising a message, it queries Brave.",
    interactions: [ { agent: 'prospection', action: 'web_search(company)', purpose: 'fresh context for personalisation' } ] },
  { id: 'pipedrive', name: 'Pipedrive', cat: 'crm', desc: 'Two-way sync + webhooks',
    role: "The source-of-truth CRM on the sales side. Two-way sync: baakalai reads deals/contacts and writes back activities.",
    interactions: [
      { agent: 'crm', action: 'webhook \u2192 stagnant_deal', purpose: 'triggers automatic follow-up' },
      { agent: 'crm', action: 'log_activity', purpose: 'writes note + tag in the deal' } ] },
  { id: 'hubspot', name: 'HubSpot', cat: 'crm', desc: 'Contacts/deals, score pushing',
    role: "Alternative CRM. Same responsibilities as Pipedrive: read deals, push activities, update predictive scores.",
    interactions: [
      { agent: 'crm', action: 'sync_contacts', purpose: 'keeps unified base' },
      { agent: 'crm', action: 'push_score', purpose: 'pushes back the deal score from Memory' } ] },
  { id: 'salesforce', name: 'Salesforce', cat: 'crm', desc: 'REST API, field mapping',
    role: "For Salesforce-driven orgs. baakalai handles custom field mapping, reads opportunities and writes into custom fields.",
    interactions: [
      { agent: 'crm', action: 'sync_opportunities', purpose: 'reads the pipeline' },
      { agent: 'crm', action: 'write_custom_field', purpose: 'pushes baakalai insights' } ] },
  { id: 'odoo', name: 'Odoo', cat: 'crm', desc: 'JSON-RPC, contacts/deals',
    role: "For Odoo-stack companies. JSON-RPC connection, syncs contacts and deals like a standard CRM.",
    interactions: [ { agent: 'crm', action: 'rpc_sync', purpose: 'syncs contacts/deals via Odoo' } ] },
  { id: 'notion', name: 'Notion', cat: 'crm', desc: 'Contact sync, schema',
    role: "For teams running their contacts in Notion. baakalai detects the schema and syncs the contact base like a CRM.",
    interactions: [ { agent: 'crm', action: 'sync_database', purpose: 'reads/writes the Notion contacts base' } ] },
  { id: 'airtable', name: 'Airtable', cat: 'crm', desc: 'Contact sync (batch 10)',
    role: "For Airtable-based contact bases. Sync in batches of 10 (rate limit), same role as the other CRMs.",
    interactions: [ { agent: 'crm', action: 'batch_sync', purpose: 'syncs 10 records at a time' } ] },
  { id: 'gmail', name: 'Gmail', cat: 'email', desc: '1-click send via OAuth',
    role: "Your personal inbox. When baakalai needs to send from your work address, it goes through Gmail OAuth.",
    interactions: [
      { agent: 'crm', action: 'send_personal', purpose: '1-to-1 send from your address' },
      { agent: 'reporting', action: 'send_report', purpose: 'drops the weekly report in your inbox' } ] },
  { id: 'outlook', name: 'Outlook', cat: 'email', desc: 'Send via Microsoft OAuth',
    role: "Gmail equivalent for the Microsoft world. baakalai authenticates via Microsoft OAuth and sends from your address.",
    interactions: [ { agent: 'crm', action: 'send_personal', purpose: 'send from your Outlook' } ] },
  { id: 'smtp', name: 'SMTP', cat: 'email', desc: 'Any provider (OVH, Gmail\u2026)',
    role: "For custom configs \u2014 OVH, dedicated server, Gmail SMTP. When OAuth isn't enough, baakalai uses raw SMTP with encrypted creds.",
    interactions: [ { agent: 'crm', action: 'send_via_smtp', purpose: 'send through your custom server' } ] },
  { id: 'resend', name: 'Resend', cat: 'email', desc: 'System emails',
    role: "The system-email channel from baakalai \u2192 you: weekly reports, alerts, digests. Not for outbound.",
    interactions: [
      { agent: 'reporting', action: 'send_digest', purpose: 'delivers the report Friday 5pm' },
      { agent: 'reporting', action: 'send_alert', purpose: 'flags anomalies in real time' } ] },
  { id: 'supabase', name: 'Supabase', cat: 'data', desc: 'Main PostgreSQL',
    role: "baakalai's main PostgreSQL database. Stores campaigns, unified contacts, events, logs.",
    interactions: [
      { agent: 'reporting', action: 'query_week', purpose: "aggregates the week's KPIs" },
      { agent: 'memory', action: 'persist_pattern', purpose: 'stores winning patterns' } ] },
  { id: 'pgvector', name: 'pgvector', cat: 'data', desc: 'Vector search',
    role: "The PostgreSQL extension that makes Memory vectorial. baakalai indexes emails, deals and context here to retrieve patterns by semantic similarity.",
    interactions: [
      { agent: 'memory', action: 'vector_search', purpose: 'finds similar cases' },
      { agent: 'memory', action: 'embed(text)', purpose: 'vectorises new pattern' } ] },
  { id: 'notion-store', name: 'Notion (store)', cat: 'data', desc: 'Diagnostics & versions',
    role: "Notion used as a doc store \u2014 versioned diagnostics, archived reports. Each weekly report gets its own page.",
    interactions: [
      { agent: 'reporting', action: 'archive_report', purpose: 'drops the versioned report' },
      { agent: 'memory', action: 'read_diagnostic', purpose: 'consults past diagnostics' } ] },
];

const SCENARIOS_FR = [
  { id: 'cold_outreach', title: 'Une nouvelle campagne, de z\u00e9ro',
    caption: 'Tu lances "CTOs SaaS Paris" \u2014 voici comment baakalai, Prospection et tes outils s\'organisent.',
    steps: [
      { from: 'user', to: 'claude', verb: 'demande campagne', detail: 'CTOs SaaS \u00b7 Paris \u00b7 100 leads', dur: 1200 },
      { from: 'claude', to: 'memory', verb: 'consulte patterns', detail: 'segments gagnants \u00b7 saisonnalit\u00e9', dur: 1800 },
      { from: 'memory', to: 'claude', verb: 'renvoie 3 angles', detail: 'pricing \u00b7 scaling \u00b7 hiring', dur: 1400 },
      { from: 'claude', to: 'prospection', verb: 'd\u00e9l\u00e8gue', detail: 's\u00e9quence 7 touches', dur: 1200 },
      { from: 'prospection', to: 'apollo', verb: 'search', detail: 'role:CTO \u00b7 industry:SaaS \u00b7 loc:Paris', dur: 1600 },
      { from: 'apollo', to: 'prospection', verb: 'returns', detail: '118 contacts \u00b7 96% enrichis', dur: 1200 },
      { from: 'prospection', to: 'brave', verb: 'enrichit', detail: 'context web \u00b7 12 soci\u00e9t\u00e9s', dur: 1400 },
      { from: 'prospection', to: 'lemlist', verb: 'd\u00e9ploie', detail: 'cmp_847 \u00b7 118 leads \u00b7 d\u00e9marrage 09h', dur: 1800 },
      { from: 'lemlist', to: 'prospection', verb: 'confirme', detail: 'campagne live \u00b7 A/B 50/50', dur: 1200 } ] },
  { id: 'crm_revival', title: 'Un deal qui dort se r\u00e9veille',
    caption: 'Pipedrive ping un deal stagnant \u2014 l\'agent CRM enqu\u00eate, baakalai r\u00e9dige, ton SMTP envoie.',
    steps: [
      { from: 'pipedrive', to: 'crm', verb: 'webhook', detail: 'deal #4218 \u00b7 14j sans activit\u00e9', dur: 1400 },
      { from: 'crm', to: 'memory', verb: 'cherche similaires', detail: 'deals stagnants \u2192 relances OK', dur: 1600 },
      { from: 'memory', to: 'crm', verb: 'renvoie pattern', detail: 'mardi 10h \u00b7 ton direct \u00b7 47% reply', dur: 1200 },
      { from: 'crm', to: 'claude', verb: 'demande email', detail: 'contexte deal + pattern Memory', dur: 1500 },
      { from: 'claude', to: 'crm', verb: 'r\u00e9dige', detail: '3 variantes \u00b7 80 mots chacune', dur: 1800 },
      { from: 'crm', to: 'smtp', verb: 'envoie', detail: 'variante B \u00b7 prog. mardi 10:00', dur: 1200 },
      { from: 'crm', to: 'pipedrive', verb: 'log activit\u00e9', detail: 'note + tag "auto-follow"', dur: 1000 } ] },
  { id: 'weekly_report', title: 'Le rapport du vendredi',
    caption: 'Reporting analyse la semaine, rep\u00e8re ce qui m\u00e9rite ton attention, te livre le tout en clair.',
    steps: [
      { from: 'reporting', to: 'supabase', verb: 'query semaine', detail: '23 campagnes \u00b7 156 envois', dur: 1400 },
      { from: 'reporting', to: 'memory', verb: 'compare', detail: 'vs S17 \u00b7 drift segments', dur: 1500 },
      { from: 'memory', to: 'reporting', verb: 'flag anomalie', detail: 'cmp_823 \u00b7 open rate -34%', dur: 1300 },
      { from: 'reporting', to: 'claude', verb: 'demande synth\u00e8se', detail: 'ton conversationnel \u00b7 3 actions', dur: 1500 },
      { from: 'claude', to: 'reporting', verb: 'r\u00e9dige', detail: '4 paragraphes \u00b7 1 reco prio', dur: 1700 },
      { from: 'reporting', to: 'notion-store', verb: 'archive', detail: 'rapport_S18 \u00b7 versionn\u00e9', dur: 1100 },
      { from: 'reporting', to: 'resend', verb: 'envoie', detail: '\u00e0 toi \u00b7 vendredi 17h', dur: 1100 } ] },
];

const SCENARIOS_EN = [
  { id: 'cold_outreach', title: 'A new campaign, from scratch',
    caption: 'You launch "SaaS CTOs in Paris" \u2014 here\'s how baakalai, Prospection and your tools coordinate.',
    steps: [
      { from: 'user', to: 'claude', verb: 'requests campaign', detail: 'SaaS CTOs \u00b7 Paris \u00b7 100 leads', dur: 1200 },
      { from: 'claude', to: 'memory', verb: 'queries patterns', detail: 'winning segments \u00b7 seasonality', dur: 1800 },
      { from: 'memory', to: 'claude', verb: 'returns 3 angles', detail: 'pricing \u00b7 scaling \u00b7 hiring', dur: 1400 },
      { from: 'claude', to: 'prospection', verb: 'delegates', detail: '7-touch sequence', dur: 1200 },
      { from: 'prospection', to: 'apollo', verb: 'search', detail: 'role:CTO \u00b7 industry:SaaS \u00b7 loc:Paris', dur: 1600 },
      { from: 'apollo', to: 'prospection', verb: 'returns', detail: '118 contacts \u00b7 96% enriched', dur: 1200 },
      { from: 'prospection', to: 'brave', verb: 'enriches', detail: 'web context \u00b7 12 companies', dur: 1400 },
      { from: 'prospection', to: 'lemlist', verb: 'deploys', detail: 'cmp_847 \u00b7 118 leads \u00b7 starts 9am', dur: 1800 },
      { from: 'lemlist', to: 'prospection', verb: 'confirms', detail: 'campaign live \u00b7 A/B 50/50', dur: 1200 } ] },
  { id: 'crm_revival', title: 'A sleeping deal wakes up',
    caption: 'Pipedrive pings a stagnant deal \u2014 CRM agent investigates, baakalai writes, your SMTP sends.',
    steps: [
      { from: 'pipedrive', to: 'crm', verb: 'webhook', detail: 'deal #4218 \u00b7 14d no activity', dur: 1400 },
      { from: 'crm', to: 'memory', verb: 'finds similar', detail: 'stagnant deals \u2192 revivals OK', dur: 1600 },
      { from: 'memory', to: 'crm', verb: 'returns pattern', detail: 'tue 10am \u00b7 direct tone \u00b7 47% reply', dur: 1200 },
      { from: 'crm', to: 'claude', verb: 'requests email', detail: 'deal context + Memory pattern', dur: 1500 },
      { from: 'claude', to: 'crm', verb: 'writes', detail: '3 variants \u00b7 80 words each', dur: 1800 },
      { from: 'crm', to: 'smtp', verb: 'sends', detail: 'variant B \u00b7 scheduled tue 10:00', dur: 1200 },
      { from: 'crm', to: 'pipedrive', verb: 'logs activity', detail: 'note + tag "auto-follow"', dur: 1000 } ] },
  { id: 'weekly_report', title: 'The Friday report',
    caption: 'Reporting analyses the week, flags what deserves your attention, delivers it in plain words.',
    steps: [
      { from: 'reporting', to: 'supabase', verb: 'query week', detail: '23 campaigns \u00b7 156 sends', dur: 1400 },
      { from: 'reporting', to: 'memory', verb: 'compares', detail: 'vs W17 \u00b7 segment drift', dur: 1500 },
      { from: 'memory', to: 'reporting', verb: 'flags anomaly', detail: 'cmp_823 \u00b7 open rate -34%', dur: 1300 },
      { from: 'reporting', to: 'claude', verb: 'requests synthesis', detail: 'conversational tone \u00b7 3 actions', dur: 1500 },
      { from: 'claude', to: 'reporting', verb: 'writes', detail: '4 paragraphs \u00b7 1 prio reco', dur: 1700 },
      { from: 'reporting', to: 'notion-store', verb: 'archives', detail: 'report_W18 \u00b7 versioned', dur: 1100 },
      { from: 'reporting', to: 'resend', verb: 'sends', detail: 'to you \u00b7 friday 5pm', dur: 1100 } ] },
];

const UI_FR = {
  hint: 'GLISSER \u00b7 MOLETTE POUR ZOOMER',
  scenario: 'SC\u00c9NARIO',
  reset: 'RESET',
  filterAll: 'Tout',
  brain: 'CERVEAU', agent: 'AGENT', tool: 'OUTIL',
  brainTitle: 'baakalai \u2014 orchestrateur',
  brainTooltip: "Le cerveau de baakalai. D\u00e9cide quel agent activer, \u00e9crit, analyse, consolide la m\u00e9moire \u2014 propuls\u00e9 par Claude.",
  brainBig: 'baakalai',
  brainSub: "orchestre tout, lit, \u00e9crit, refine \u2014 propuls\u00e9 par Claude",
  brainBody: "baakalai est au centre \u2014 pas parce qu\u2019il fait tout, mais parce qu\u2019il d\u00e9cide. \u00c0 chaque demande, il lit l\u2019historique, consulte la Memory, choisit l\u2019agent qui doit prendre le relai, puis r\u00e9dige le langage humain (s\u00e9quences, emails, rapports). Le moteur de raisonnement est Claude (Anthropic).",
  agentEyebrow: 'AGENT AUTONOME',
  isolate: '\u2192 Isoler',
  showAll: '\u21a9 Tout r\u00e9afficher',
  focusMode: '(focus mode)',
  role: 'R\u00d4LE',
  interactions: 'INTERACTIONS',
  heroEyebrow: 'COMMENT BAAKALAI TRAVAILLE',
  heroTitle1: 'Pendant que tu dors,',
  heroTitle2: 'la constellation',
  heroTitle3: 'travaille.',
  heroSub: "baakalai au centre. Douze agents qui lisent ton CRM 24/7. Dix-neuf outils qui ob\u00e9issent au doigt et \u00e0 l\u2019\u0153il. Regarde-les r\u00e9activer tes deals \u2014 en direct.",
  ctaTitle: "Connecte tes outils \u2014 baakalai prend le relais.",
  ctaButton: 'Rejoindre la beta',
  ctaNote: '14 jours offerts. Pas de carte requise.',
};

const UI_EN = {
  hint: 'DRAG \u00b7 SCROLL TO ZOOM',
  scenario: 'SCENARIO',
  reset: 'RESET',
  filterAll: 'All',
  brain: 'BRAIN', agent: 'AGENT', tool: 'TOOL',
  brainTitle: 'baakalai \u2014 orchestrator',
  brainTooltip: "baakalai\u2019s brain. Decides which agent to activate, writes, analyses, consolidates memory \u2014 powered by Claude.",
  brainBig: 'baakalai',
  brainSub: "orchestrates everything, reads, writes, refines \u2014 powered by Claude",
  brainBody: "baakalai sits at the center \u2014 not because it does everything, but because it decides. On every request it reads the history, queries Memory, picks the agent that should take over, then writes the human language (sequences, emails, reports). The reasoning engine is Claude (Anthropic).",
  agentEyebrow: 'AUTONOMOUS AGENT',
  isolate: '\u2192 Isolate',
  showAll: '\u21a9 Show all',
  focusMode: '(focus mode)',
  role: 'ROLE',
  interactions: 'INTERACTIONS',
  heroEyebrow: 'HOW BAAKALAI WORKS',
  heroTitle1: 'While you sleep,',
  heroTitle2: 'the constellation',
  heroTitle3: 'is working.',
  heroSub: "baakalai at the center. Twelve agents reading your CRM 24/7. Nineteen tools at its fingertips. Watch them reactivate your deals \u2014 live.",
  ctaTitle: "Connect your tools \u2014 baakalai takes over.",
  ctaButton: 'Join the beta',
  ctaNote: '14 days free. No card required.',
};

const TR_NAV_FR = { how: "Comment \u00e7a marche", pricing: 'Beta', login: 'Login', try: 'Rejoindre la beta \u2192', philEyebrow: '\u2014 LA PHILOSOPHIE', philTitle: ['On a d\u00e9coup\u00e9 le boulot en ', 'douze agents', " \u2014 quatre op\u00e9rationnels quotidiens, sept strat\u00e9giques, un g\u00e9n\u00e9rateur de templates."], hintCaption: '\u2191 survol une \u00e9toile \u00b7 clique pour voir ce qu\u2019elle fait \u00b7 isole un agent pour suivre son fil', filterAll: 'Tout afficher', focus: 'focus', pause: '\u23f8 Pause', resume: '\u25b6 Reprendre', readyCaption: 'pr\u00eat \u00e0 voir ta propre constellation ?' };
const TR_NAV_EN = { how: 'How it works', pricing: 'Pricing', login: 'Login', try: 'Join the beta \u2192', philEyebrow: '\u2014 THE PHILOSOPHY', philTitle: ['We split the job into ', 'twelve agents', " \u2014 four daily operators, seven strategic, one template generator."], hintCaption: '\u2191 hover a star \u00b7 click to see what it does \u00b7 isolate an agent to follow its thread', filterAll: 'Show all', focus: 'focus', pause: '\u23f8 Pause', resume: '\u25b6 Resume', readyCaption: 'ready to see your own constellation?' };

function getConstData(lang) {
  const isEn = lang === 'en';
  return {
    AGENTS: isEn ? AGENTS_EN : AGENTS_FR,
    TOOLS:  isEn ? TOOLS_EN  : TOOLS_FR,
    TOOL_CATEGORIES,
    SCENARIOS: isEn ? SCENARIOS_EN : SCENARIOS_FR,
    UI: isEn ? UI_EN : UI_FR,
    lang: isEn ? 'en' : 'fr',
  };
}

// ─── LAYOUT ─────────────────────────────────────────────────

const CX = 600, CY = 420;

const seedRand = (seed) => {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
};

const AGENT_ANCHORS = {
  prospection: { angle: -150, distX: 280, distY: 150 },
  crm:         { angle:  -30, distX: 280, distY: 150 },
  memory:      { angle:   30, distX: 280, distY: 150 },
  reporting:   { angle:  150, distX: 280, distY: 150 },
};

const CAT_AGENT = {
  prospecting: 'prospection',
  crm:         'crm',
  email:       'memory',
  data:        'reporting',
};

const polarXY = (cx, cy, angleDeg, distX, distY) => {
  const r = (angleDeg * Math.PI) / 180;
  return { x: cx + Math.cos(r) * distX, y: cy + Math.sin(r) * distY };
};

const buildLayout = (agents, tools) => {
  const r1 = seedRand(7);
  const r2 = seedRand(42);

  const agentPos = {};
  Object.entries(AGENT_ANCHORS).forEach(([id, a]) => {
    agentPos[id] = polarXY(CX, CY, a.angle, a.distX, a.distY);
  });

  const byAgent = { prospection: [], crm: [], memory: [], reporting: [] };
  tools.forEach(t => {
    const agentId = CAT_AGENT[t.cat];
    byAgent[agentId].push(t);
  });

  const TOOL_RADIUS_X = [430, 500];
  const TOOL_RADIUS_Y = [240, 290];

  const toolPos = {};
  Object.entries(byAgent).forEach(([agentId, items]) => {
    const baseAngle = AGENT_ANCHORS[agentId].angle;
    const n = items.length;
    items.forEach((t, i) => {
      const t01 = n === 1 ? 0.5 : i / (n - 1);
      const arcDeg = (t01 - 0.5) * 50;
      const angleDeg = baseAngle + arcDeg;
      const ring = i % 2;
      toolPos[t.id] = polarXY(CX, CY, angleDeg, TOOL_RADIUS_X[ring], TOOL_RADIUS_Y[ring]);
    });
  });

  const dust = Array.from({ length: 220 }).map(() => ({
    x: r1() * 1200,
    y: r2() * 840,
    size: r1() * 1.4 + 0.2,
    op: 0.15 + r2() * 0.55,
  }));

  return { agentPos, toolPos, dust, claudePos: { x: CX, y: CY } };
};

// ─── ZOOM BTN STYLE ────────────────────────────────────────

const zoomBtnStyle = {
  width: 36, height: 36,
  background: 'rgba(10,8,32,0.85)',
  border: '1px solid rgba(110,87,250,0.45)',
  borderRadius: 6,
  color: '#FFFFFF', fontSize: 18, fontWeight: 500,
  cursor: 'pointer', fontFamily: 'Geist, sans-serif',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  backdropFilter: 'blur(8px)',
};

// ─── CONSTELLATION SCENE ────────────────────────────────────

const Constellation = ({ onSelect, focusedAgent, activeFilter, paused, data, t }) => {
  const W = 1200, H = 840;
  const { AGENTS: A2, TOOLS: T2, TOOL_CATEGORIES: TC2, SCENARIOS } = data;

  const layout = React.useMemo(() => buildLayout(A2, T2), []);
  const [hover, setHover] = React.useState(null);
  const [scenarioIdx, setScenarioIdx] = React.useState(0);
  const [stepIdx, setStepIdx] = React.useState(0);
  const [zoom, setZoom] = React.useState(1);
  const [pan, setPan] = React.useState({ x: 0, y: 0 });
  const dragRef = React.useRef(null);

  React.useEffect(() => {
    if (paused) return;
    const scenario = SCENARIOS[scenarioIdx];
    const step = scenario.steps[stepIdx];
    const tm = setTimeout(() => {
      const next = stepIdx + 1;
      if (next >= scenario.steps.length) {
        setStepIdx(0);
        setScenarioIdx((s) => (s + 1) % SCENARIOS.length);
      } else {
        setStepIdx(next);
      }
    }, step.dur);
    return () => clearTimeout(tm);
  }, [scenarioIdx, stepIdx, paused, SCENARIOS]);

  const currentScenario = SCENARIOS[scenarioIdx];
  const currentStep = currentScenario.steps[stepIdx];

  const nodePos = (id) => {
    if (id === 'claude') return layout.claudePos;
    if (id === 'user')   return { x: 80, y: H - 80 };
    if (layout.agentPos[id]) return layout.agentPos[id];
    if (layout.toolPos[id])  return layout.toolPos[id];
    return null;
  };

  const isDimmed = (kind, id) => {
    if (focusedAgent) {
      if (kind === 'claude') return false;
      if (kind === 'agent') return id !== focusedAgent;
      if (kind === 'tool') {
        const ag = A2.find((x) => x.id === focusedAgent);
        return !ag.tools.includes(id);
      }
    }
    if (activeFilter !== 'all' && kind === 'tool') {
      const tool = T2.find((x) => x.id === id);
      return tool.cat !== activeFilter;
    }
    return false;
  };

  const onPanStart = (e) => {
    if (e.target.closest('[data-node]')) return;
    dragRef.current = { sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y };
  };
  const onPanMove = (e) => {
    if (!dragRef.current) return;
    setPan({ x: dragRef.current.px + e.clientX - dragRef.current.sx, y: dragRef.current.py + e.clientY - dragRef.current.sy });
  };
  const onPanEnd = () => { dragRef.current = null; };
  const onWheel = (e) => {
    e.preventDefault();
    setZoom((z) => Math.max(0.5, Math.min(2.5, z - e.deltaY * 0.0015)));
  };
  const setZoomClamped = (z) => setZoom(Math.max(0.5, Math.min(2.5, z)));
  const resetView = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

  const fromPos = nodePos(currentStep.from);
  const toPos   = nodePos(currentStep.to);
  const worldTransform = `translate(${W/2 + pan.x}, ${H/2 + pan.y}) scale(${zoom}) translate(${-W/2}, ${-H/2})`;

  return React.createElement('div', {
    onMouseDown: onPanStart, onMouseMove: onPanMove, onMouseUp: onPanEnd, onMouseLeave: onPanEnd, onWheel: onWheel,
    style: { width: W, height: H, position: 'relative', overflow: 'hidden', background: 'radial-gradient(ellipse at 50% 40%, #1a1538 0%, #0a0820 50%, #050410 100%)', cursor: dragRef.current ? 'grabbing' : 'grab' }
  },
    React.createElement('svg', { width: W, height: H, style: { position: 'absolute', inset: 0, userSelect: 'none' } },
      React.createElement('defs', null,
        React.createElement('radialGradient', { id: 'claudeGlow' },
          React.createElement('stop', { offset: '0%', stopColor: '#A998FF', stopOpacity: 0.9 }),
          React.createElement('stop', { offset: '40%', stopColor: '#6E57FA', stopOpacity: 0.5 }),
          React.createElement('stop', { offset: '100%', stopColor: '#6E57FA', stopOpacity: 0 }),
        ),
        React.createElement('radialGradient', { id: 'agentGlow' },
          React.createElement('stop', { offset: '0%', stopColor: '#C4B5FD', stopOpacity: 0.85 }),
          React.createElement('stop', { offset: '100%', stopColor: '#9A84EB', stopOpacity: 0 }),
        ),
        React.createElement('radialGradient', { id: 'toolGlow' },
          React.createElement('stop', { offset: '0%', stopColor: '#A998FF', stopOpacity: 0.7 }),
          React.createElement('stop', { offset: '100%', stopColor: '#A998FF', stopOpacity: 0 }),
        ),
      ),
      React.createElement('g', { transform: worldTransform },
        // Dust
        layout.dust.map((d, i) => React.createElement('circle', { key: 'd'+i, cx: d.x, cy: d.y, r: d.size, fill: '#A998FF', opacity: d.op })),

        // Agent warm glows
        A2.map((a) => {
          const p = layout.agentPos[a.id];
          return React.createElement('circle', { key: 'tw'+a.id, cx: p.x, cy: p.y, r: 70, fill: 'url(#agentGlow)', opacity: isDimmed('agent', a.id) ? 0.06 : 0.5 });
        }),

        // Hub-to-agent lines
        A2.map((a) => {
          const p = layout.agentPos[a.id];
          const dim = isDimmed('agent', a.id);
          return React.createElement('line', { key: 'l'+a.id, x1: layout.claudePos.x, y1: layout.claudePos.y, x2: p.x, y2: p.y, stroke: '#A998FF', strokeWidth: 1.4, opacity: dim ? 0.06 : 0.38 });
        }),

        // Agent-to-tool lines
        A2.map((agent) => {
          const ap = layout.agentPos[agent.id];
          return agent.tools.map((toolId) => {
            const tp = layout.toolPos[toolId];
            if (!tp) return null;
            const dim = isDimmed('agent', agent.id) || isDimmed('tool', toolId);
            const isLit = (currentStep.from === agent.id && currentStep.to === toolId) || (currentStep.from === toolId && currentStep.to === agent.id);
            return React.createElement('line', { key: 'at-'+agent.id+'-'+toolId, x1: ap.x, y1: ap.y, x2: tp.x, y2: tp.y, stroke: isLit ? '#FFFFFF' : '#A998FF', strokeWidth: isLit ? 2 : 0.9, opacity: dim ? 0.04 : (isLit ? 0.95 : 0.18) },
              isLit ? React.createElement('animate', { attributeName: 'opacity', values: '0.5;1;0.5', dur: '1.2s', repeatCount: 'indefinite' }) : null
            );
          });
        }),

        // Active step line + particles
        fromPos && toPos && React.createElement('g', null,
          React.createElement('line', { x1: fromPos.x, y1: fromPos.y, x2: toPos.x, y2: toPos.y, stroke: '#FAFAF9', strokeWidth: 2, opacity: 0.9 },
            React.createElement('animate', { attributeName: 'opacity', values: '0.6;1;0.6', dur: '1.4s', repeatCount: 'indefinite' })
          ),
          React.createElement('circle', { r: 4.5, fill: '#FFFFFF' },
            React.createElement('animateMotion', { dur: (currentStep.dur / 1000) + 's', repeatCount: '1', path: 'M '+fromPos.x+' '+fromPos.y+' L '+toPos.x+' '+toPos.y })
          ),
          React.createElement('circle', { r: 3, fill: '#A998FF', opacity: 0.6 },
            React.createElement('animateMotion', { dur: (currentStep.dur / 1000) + 's', begin: '0.1s', repeatCount: '1', path: 'M '+fromPos.x+' '+fromPos.y+' L '+toPos.x+' '+toPos.y })
          ),
        ),

        // Tools
        T2.map((tl) => {
          const p = layout.toolPos[tl.id];
          if (!p) return null;
          const dim = isDimmed('tool', tl.id);
          const sz = 16;
          const cat = TC2.find(c => c.id === tl.cat);
          const catColor = cat ? cat.color : '#A998FF';
          const isOnPath = currentStep.from === tl.id || currentStep.to === tl.id;
          const letter = (tl.name[0] || '?').toUpperCase();
          return React.createElement('g', { key: tl.id, 'data-node': '1', onMouseEnter: () => setHover({ kind: 'tool', node: tl, x: p.x, y: p.y }), onMouseLeave: () => setHover(null), onClick: () => onSelect({ kind: 'tool', data: tl }), style: { cursor: 'pointer' }, opacity: dim ? 0.25 : 1 },
            isOnPath && React.createElement('circle', { cx: p.x, cy: p.y, r: sz + 14, fill: 'url(#toolGlow)' },
              React.createElement('animate', { attributeName: 'r', values: (sz+10)+';'+(sz+22)+';'+(sz+10), dur: '1.6s', repeatCount: 'indefinite' })
            ),
            React.createElement('circle', { cx: p.x, cy: p.y, r: sz, fill: '#FAFAF9', stroke: isOnPath ? '#FFFFFF' : catColor, strokeWidth: isOnPath ? 2.5 : 1.5 }),
            React.createElement('text', { x: p.x, y: p.y + 5, textAnchor: 'middle', fontFamily: 'Geist, sans-serif', fontSize: 15, fontWeight: 600, fill: '#0A0A0A', letterSpacing: '-0.02em' }, letter),
            React.createElement('circle', { cx: p.x + sz - 4, cy: p.y - sz + 4, r: 3.5, fill: catColor, stroke: '#0a0820', strokeWidth: 1 }),
            React.createElement('text', { x: p.x, y: p.y + sz + 14, textAnchor: 'middle', fontFamily: 'Geist Mono, monospace', fontSize: 9.5, fill: '#FFFFFF', opacity: dim ? 0.3 : 0.85, letterSpacing: '0.04em' }, tl.name.toUpperCase()),
          );
        }),

        // Agents
        A2.map((a) => {
          const p = layout.agentPos[a.id];
          const dim = isDimmed('agent', a.id);
          const sz = 26;
          const isOnPath = currentStep.from === a.id || currentStep.to === a.id;
          const letter = a.short[0];
          return React.createElement('g', { key: a.id, 'data-node': '1', onMouseEnter: () => setHover({ kind: 'agent', node: a, x: p.x, y: p.y }), onMouseLeave: () => setHover(null), onClick: () => onSelect({ kind: 'agent', data: a }), style: { cursor: 'pointer' }, opacity: dim ? 0.25 : 1 },
            React.createElement('circle', { cx: p.x, cy: p.y, r: 48, fill: 'url(#agentGlow)', opacity: dim ? 0.1 : 0.7 }),
            isOnPath && React.createElement('circle', { cx: p.x, cy: p.y, r: sz + 10, fill: 'none', stroke: '#FFFFFF', strokeWidth: 1.5, opacity: 0.7 },
              React.createElement('animate', { attributeName: 'r', values: (sz+6)+';'+(sz+16)+';'+(sz+6), dur: '1.6s', repeatCount: 'indefinite' })
            ),
            React.createElement('circle', { cx: p.x, cy: p.y, r: sz, fill: '#C4B5FD', stroke: '#FFFFFF', strokeWidth: focusedAgent === a.id ? 2.5 : 1 }),
            React.createElement('text', { x: p.x, y: p.y + 8, textAnchor: 'middle', fontFamily: 'Geist, sans-serif', fontSize: 22, fontWeight: 600, fill: '#0A0A0A', letterSpacing: '-0.02em' }, letter),
            React.createElement('text', { x: p.x, y: p.y + sz + 18, textAnchor: 'middle', fontFamily: 'Geist Mono, monospace', fontSize: 11, fontWeight: 500, fill: '#FFFFFF', opacity: dim ? 0.3 : 1, letterSpacing: '0.06em' }, a.name.toUpperCase()),
            React.createElement('text', { x: p.x, y: p.y + sz + 36, textAnchor: 'middle', fontFamily: 'Geist Mono, monospace', fontSize: 9.5, fontWeight: 500, letterSpacing: '0.04em', fill: '#A998FF', opacity: dim ? 0.2 : 0.85 }, a.tagline.split(',')[0].toUpperCase()),
          );
        }),

        // Baakalai hub
        React.createElement('g', { 'data-node': '1', onMouseEnter: () => setHover({ kind: 'claude', x: layout.claudePos.x, y: layout.claudePos.y }), onMouseLeave: () => setHover(null), onClick: () => onSelect({ kind: 'claude' }), style: { cursor: 'pointer' } },
          React.createElement('circle', { cx: layout.claudePos.x, cy: layout.claudePos.y, r: 100, fill: 'url(#claudeGlow)' }),
          React.createElement('circle', { cx: layout.claudePos.x, cy: layout.claudePos.y, r: 65, fill: 'url(#claudeGlow)', opacity: 0.9 }),
          React.createElement('circle', { cx: layout.claudePos.x, cy: layout.claudePos.y, r: 40, fill: '#6E57FA', stroke: '#FFFFFF', strokeWidth: 1.5 }),
          React.createElement('g', { transform: 'translate('+(layout.claudePos.x - 18)+', '+(layout.claudePos.y - 18)+') scale(0.36)' },
            React.createElement('line', { x1: 50, y1: 50, x2: 22, y2: 26, stroke: '#FFFFFF', strokeWidth: 6, strokeLinecap: 'round', opacity: 0.9 }),
            React.createElement('line', { x1: 50, y1: 50, x2: 82, y2: 30, stroke: '#FFFFFF', strokeWidth: 6, strokeLinecap: 'round', opacity: 0.7 }),
            React.createElement('line', { x1: 50, y1: 50, x2: 30, y2: 80, stroke: '#FFFFFF', strokeWidth: 6, strokeLinecap: 'round', opacity: 0.9 }),
            React.createElement('circle', { cx: 22, cy: 26, r: 9, fill: '#FFFFFF', opacity: 0.9 }),
            React.createElement('circle', { cx: 82, cy: 30, r: 10, fill: '#FFFFFF', opacity: 0.7 }),
            React.createElement('circle', { cx: 30, cy: 80, r: 9, fill: '#FFFFFF', opacity: 0.9 }),
            React.createElement('circle', { cx: 50, cy: 50, r: 14, fill: '#FFFFFF' }),
          ),
          React.createElement('text', { x: layout.claudePos.x, y: layout.claudePos.y + 60, textAnchor: 'middle', fontFamily: 'Geist Mono, monospace', fontSize: 12, fontWeight: 600, fill: '#FFFFFF', letterSpacing: '0.1em' }, 'BAAKALAI'),
        ),
      ),
    ),

    // Tooltip
    hover && (() => {
      const sx = (hover.x - W / 2) * zoom + W / 2 + pan.x;
      const sy = (hover.y - H / 2) * zoom + H / 2 + pan.y;
      return React.createElement('div', { style: { position: 'absolute', left: sx + 18, top: sy - 10, padding: '8px 12px', background: 'rgba(10,8,32,0.92)', border: '1px solid #6E57FA', borderRadius: 8, pointerEvents: 'none', maxWidth: 240, zIndex: 5, backdropFilter: 'blur(8px)' } },
        React.createElement('div', { style: { fontFamily: 'Geist Mono, monospace', fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#A998FF' } },
          hover.kind === 'claude' ? 'BAAKALAI \u00b7 ' + t.brain : hover.kind === 'agent' ? t.agent : t.tool),
        React.createElement('div', { style: { fontFamily: 'Geist, sans-serif', fontSize: 14, fontWeight: 500, color: '#FFFFFF', marginTop: 2 } },
          hover.kind === 'claude' ? t.brainTitle : hover.node.name),
        React.createElement('div', { style: { fontSize: 11.5, color: '#C4B5FD', marginTop: 4, lineHeight: 1.4 } },
          hover.kind === 'claude' ? t.brainTooltip : hover.kind === 'agent' ? hover.node.tagline : hover.node.desc),
      );
    })(),

    // Zoom controls
    React.createElement('div', { style: { position: 'absolute', top: 20, right: 20, display: 'flex', flexDirection: 'column', gap: 6, zIndex: 4 } },
      React.createElement('button', { onClick: () => setZoomClamped(zoom + 0.2), style: zoomBtnStyle }, '+'),
      React.createElement('button', { onClick: () => setZoomClamped(zoom - 0.2), style: zoomBtnStyle }, '\u2212'),
      React.createElement('button', { onClick: resetView, style: { ...zoomBtnStyle, fontSize: 10, fontFamily: 'Geist Mono, monospace', letterSpacing: '0.06em' } }, t.reset),
      React.createElement('div', { style: { marginTop: 4, padding: '6px 8px', background: 'rgba(10,8,32,0.85)', border: '1px solid rgba(110,87,250,0.4)', borderRadius: 6, fontFamily: 'Geist Mono, monospace', fontSize: 10, color: '#A998FF', textAlign: 'center' } }, Math.round(zoom * 100) + '%'),
    ),

    // Caption
    React.createElement('div', { style: { position: 'absolute', left: 32, bottom: 32, right: 32, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', pointerEvents: 'none' } },
      React.createElement('div', { style: { maxWidth: 540 } },
        React.createElement('div', { style: { fontFamily: 'Geist Mono, monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#A998FF', marginBottom: 8 } },
          t.scenario + ' ' + String(scenarioIdx + 1).padStart(2, '0') + ' \u00b7 ' + currentScenario.title.toUpperCase()),
        React.createElement('div', { style: { display: 'flex', alignItems: 'baseline', gap: 12, fontFamily: 'Geist Mono, monospace', fontSize: 11, color: '#FAFAF9' } },
          React.createElement('span', { style: { color: '#A998FF' } }, currentStep.from.toUpperCase()),
          React.createElement('span', { style: { color: '#525251' } }, '\u2192'),
          React.createElement('span', { style: { color: '#A998FF' } }, currentStep.to.toUpperCase()),
        ),
        React.createElement('div', { style: { fontFamily: 'Geist Mono, monospace', fontSize: 14, fontWeight: 500, color: '#FFFFFF', marginTop: 6, lineHeight: 1.4, letterSpacing: '-0.005em' } }, currentStep.verb),
        React.createElement('div', { style: { fontFamily: 'Geist, sans-serif', fontSize: 13, color: '#C4B5FD', marginTop: 4 } }, currentStep.detail),
      ),
      React.createElement('div', { style: { display: 'flex', gap: 4, alignItems: 'center' } },
        currentScenario.steps.map((_, i) => React.createElement('span', { key: i, style: { width: i === stepIdx ? 24 : 6, height: 3, borderRadius: 999, background: i === stepIdx ? '#FFFFFF' : (i < stepIdx ? '#A998FF' : '#2A2A48'), transition: 'all 200ms cubic-bezier(0.2,0.6,0.2,1)' } })),
      ),
    ),

    // Hint
    React.createElement('div', { style: { position: 'absolute', top: 20, left: '50%', transform: 'translateX(-50%)', fontFamily: 'Geist Mono, monospace', fontSize: 10, color: 'rgba(169,152,255,0.55)', letterSpacing: '0.08em', pointerEvents: 'none' } }, t.hint),
  );
};

// ─── SIDE PANEL ─────────────────────────────────────────────

const SidePanel = ({ selection, onClose, focusedAgent, setFocusedAgent, data, t }) => {
  if (!selection) return null;
  const { kind, data: node } = selection;
  const h = React.createElement;

  const Header = ({ eyebrow, title, sub }) => h('div', { style: { paddingBottom: 16, borderBottom: '1px solid #2A2A48', marginBottom: 16 } },
    h('div', { style: { fontFamily: 'Geist Mono, monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#A998FF' } }, eyebrow),
    h('div', { style: { fontFamily: 'Geist, sans-serif', fontSize: 24, fontWeight: 500, letterSpacing: '-0.025em', color: '#FFFFFF', marginTop: 6 } }, title),
    sub && h('div', { style: { fontFamily: 'Geist Mono, monospace', fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#C4B5FD', marginTop: 6, lineHeight: 1.45 } }, sub),
  );

  const Stat = ({ k, v }) => h('div', null,
    h('div', { style: { fontFamily: 'Geist Mono, monospace', fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#7A7A78' } }, k),
    h('div', { style: { fontFamily: 'Geist, sans-serif', fontSize: 22, fontWeight: 500, letterSpacing: '-0.03em', color: '#FFFFFF', marginTop: 2, fontFeatureSettings: '"tnum"' } }, v),
  );

  let body;
  if (kind === 'claude') {
    body = h(React.Fragment, null,
      h(Header, { eyebrow: t.brain, title: t.brainBig, sub: t.brainSub }),
      h('div', { style: { fontSize: 14, color: '#FAFAF9', lineHeight: 1.55 } }, t.brainBody),
    );
  } else if (kind === 'agent') {
    const isFocused = focusedAgent === node.id;
    body = h(React.Fragment, null,
      h(Header, { eyebrow: t.agentEyebrow, title: node.name, sub: node.tagline }),
      h('div', { style: { fontSize: 14, color: '#FAFAF9', lineHeight: 1.55 } }, node.desc),
      h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginTop: 18, paddingTop: 14, borderTop: '1px dashed #2A2A48' } },
        Object.entries(node.stats).map(([k, v]) => h(Stat, { key: k, k: k.replace(/_/g, ' '), v: v }))
      ),
      h('button', { onClick: () => setFocusedAgent(isFocused ? null : node.id), style: { marginTop: 18, width: '100%', padding: '10px 14px', background: isFocused ? '#FFFFFF' : 'transparent', color: isFocused ? '#0A0A0A' : '#FFFFFF', border: '1.5px solid #FFFFFF', borderRadius: 999, fontFamily: 'Geist, sans-serif', fontSize: 13, fontWeight: 500, cursor: 'pointer', letterSpacing: '-0.005em' } },
        isFocused ? t.showAll : t.isolate + ' ' + node.name + ' ' + t.focusMode),
    );
  } else if (kind === 'tool') {
    const cat = data.TOOL_CATEGORIES.find(c => c.id === node.cat);
    const catColor = cat ? cat.color : '#A998FF';
    body = h(React.Fragment, null,
      h(Header, { eyebrow: t.tool + ' \u00b7 ' + node.cat.toUpperCase(), title: node.name, sub: node.desc }),
      h('div', { style: { fontFamily: 'Geist Mono, monospace', fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#7A7A78', marginBottom: 8 } }, t.role),
      h('div', { style: { fontSize: 13.5, color: '#FAFAF9', lineHeight: 1.55, marginBottom: 18 } }, node.role || node.desc),
      node.interactions && node.interactions.length > 0 && h('div', { style: { paddingTop: 16, borderTop: '1px dashed #2A2A48' } },
        h('div', { style: { fontFamily: 'Geist Mono, monospace', fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#7A7A78', marginBottom: 10 } }, t.interactions + ' \u00b7 ' + node.interactions.length),
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
          node.interactions.map((it, i) => {
            const agent = data.AGENTS.find(a => a.id === it.agent);
            const agentName = agent ? agent.name : it.agent;
            return h('div', { key: i, style: { display: 'flex', gap: 10, alignItems: 'flex-start' } },
              h('span', { style: { flexShrink: 0, padding: '3px 9px', background: 'rgba(196,181,253,0.14)', border: '1px solid rgba(196,181,253,0.35)', borderRadius: 999, fontFamily: 'Geist Mono, monospace', fontSize: 9.5, color: '#C4B5FD', letterSpacing: '0.05em', textTransform: 'uppercase', whiteSpace: 'nowrap' } }, agentName),
              h('div', { style: { flex: 1, minWidth: 0 } },
                h('div', { style: { fontFamily: 'Geist Mono, monospace', fontSize: 11.5, color: catColor, letterSpacing: '-0.005em' } }, it.action),
                h('div', { style: { fontFamily: 'Geist, sans-serif', fontSize: 12.5, color: '#FAFAF9', marginTop: 2, lineHeight: 1.4 } }, it.purpose),
              ),
            );
          }),
        ),
      ),
    );
  }

  return h('div', { style: { position: 'absolute', right: 24, top: 24, width: 360, maxHeight: 'calc(100% - 48px)', overflowY: 'auto', padding: 24, background: 'rgba(10,8,32,0.85)', border: '1px solid #2A2A48', borderRadius: 14, backdropFilter: 'blur(16px)', zIndex: 10, animation: 'slideIn 200ms cubic-bezier(0.2,0.6,0.2,1)' } },
    h('button', { onClick: onClose, style: { position: 'absolute', right: 14, top: 14, width: 28, height: 28, border: '1px solid #2A2A48', background: 'transparent', color: '#A998FF', borderRadius: 999, cursor: 'pointer', fontSize: 14, lineHeight: 1 } }, '\u00d7'),
    body,
  );
};

// ─── APP ────────────────────────────────────────────────────

const initialLang = (() => {
  try {
    const url = new URLSearchParams(window.location.search).get('lang');
    if (url === 'en' || url === 'fr') return url;
    const ls = localStorage.getItem('baakalai-lang');
    if (ls === 'en' || ls === 'fr') return ls;
  } catch (e) {}
  return 'fr';
})();

const ConstellationApp = () => {
  const h = React.createElement;
  const [lang, setLang] = React.useState(initialLang);
  const data = React.useMemo(() => getConstData(lang), [lang]);
  const t = data.UI;
  const tn = lang === 'en' ? TR_NAV_EN : TR_NAV_FR;
  const { TOOL_CATEGORIES: TC, AGENTS } = data;

  const [selection, setSelection] = React.useState(null);
  const [focusedAgent, setFocusedAgent] = React.useState(null);
  const [activeFilter, setActiveFilter] = React.useState('all');
  const [paused, setPaused] = React.useState(false);

  React.useEffect(() => {
    try { localStorage.setItem('baakalai-lang', lang); } catch (e) {}
    document.documentElement.lang = lang;
    try {
      const url = new URL(window.location);
      url.searchParams.set('lang', lang);
      window.history.replaceState({}, '', url);
    } catch (e) {}
  }, [lang]);

  return h(React.Fragment, null,
    // NAV
    h('nav', { className: 'c-nav' },
      h('a', { href: '/', className: 'c-wordmark' },
        h('svg', { width: 22, height: 22, viewBox: '0 0 100 100' },
          h('line', { x1: 50, y1: 50, x2: 22, y2: 26, stroke: '#C4B5FD', strokeWidth: 6, strokeLinecap: 'round' }),
          h('line', { x1: 50, y1: 50, x2: 82, y2: 30, stroke: '#9A84EB', strokeWidth: 6, strokeLinecap: 'round' }),
          h('line', { x1: 50, y1: 50, x2: 30, y2: 80, stroke: '#C4B5FD', strokeWidth: 6, strokeLinecap: 'round' }),
          h('circle', { cx: 22, cy: 26, r: 8, fill: '#C4B5FD' }),
          h('circle', { cx: 82, cy: 30, r: 9, fill: '#9A84EB' }),
          h('circle', { cx: 30, cy: 80, r: 8, fill: '#C4B5FD' }),
          h('circle', { cx: 50, cy: 50, r: 14, fill: '#6E57FA' }),
        ),
        h('span', null, 'baakalai'),
      ),
      h('div', { style: { display: 'flex', gap: 24, alignItems: 'center', fontFamily: 'Geist, sans-serif', fontSize: 13 } },
        h('a', { href: '#', style: { color: '#A998FF', textDecoration: 'none' } }, tn.how),
        h('a', { href: '/#beta', style: { color: '#7A7A78', textDecoration: 'none' } }, tn.pricing),
        h('a', { href: 'https://app.baakal.ai', style: { color: '#7A7A78', textDecoration: 'none' } }, tn.login),
        h('div', { className: 'c-lang-switch', role: 'group' },
          h('button', { className: lang === 'fr' ? 'active' : '', onClick: () => setLang('fr') }, 'FR'),
          h('button', { className: lang === 'en' ? 'active' : '', onClick: () => setLang('en') }, 'EN'),
        ),
        h('a', { href: '/#book', style: { background: '#FFFFFF', color: '#0A0A0A', padding: '8px 14px', borderRadius: 999, fontWeight: 500, textDecoration: 'none' } }, tn.try),
      ),
    ),

    // HERO
    h('section', { style: { minHeight: '100vh', position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 110 } },
      h('div', { className: 'fade-up', style: { textAlign: 'center', maxWidth: 920, padding: '0 32px', marginBottom: 32 } },
        h('div', { style: { fontFamily: 'Geist Mono, monospace', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#A998FF' } }, '\u2014 BAAKALAI \u00b7 ' + t.heroEyebrow),
        h('h1', { style: { fontSize: 'clamp(38px, 5.5vw, 68px)', fontWeight: 500, letterSpacing: '-0.035em', color: '#FFFFFF', lineHeight: 1.02, margin: '14px 0 16px' } },
          t.heroTitle1, h('br'), h('em', { style: { fontStyle: 'normal', color: '#A998FF' } }, t.heroTitle2), ' ', t.heroTitle3),
        h('p', { style: { fontSize: 17, color: '#C4B5FD', lineHeight: 1.55, margin: 0, maxWidth: 660, marginInline: 'auto' } }, t.heroSub),
      ),

      // Filter chips
      h('div', { className: 'fade-up', style: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20, justifyContent: 'center', padding: '0 32px', animationDelay: '120ms' } },
        h('button', { className: 'c-chip' + (activeFilter === 'all' ? ' active' : ''), onClick: () => setActiveFilter('all') }, tn.filterAll),
        TC.map(c => h('button', { key: c.id, className: 'c-chip' + (activeFilter === c.id ? ' active' : ''), onClick: () => setActiveFilter(c.id) }, c.label)),
        h('span', { style: { width: 1, alignSelf: 'stretch', background: '#2A2A48', margin: '0 4px' } }),
        AGENTS.map(a => h('button', { key: a.id, className: 'c-chip' + (focusedAgent === a.id ? ' active' : ''), onClick: () => setFocusedAgent(focusedAgent === a.id ? null : a.id), style: { borderColor: focusedAgent === a.id ? '#FFFFFF' : undefined } }, tn.focus + ' \u00b7 ' + a.name)),
        h('span', { style: { width: 1, alignSelf: 'stretch', background: '#2A2A48', margin: '0 4px' } }),
        h('button', { className: 'c-chip', onClick: () => setPaused(p => !p) }, paused ? tn.resume : tn.pause),
      ),

      // Stage
      h('div', { className: 'fade-up', style: { position: 'relative', width: 1200, maxWidth: '100%', borderRadius: 18, overflow: 'hidden', border: '1px solid #2A2A48', boxShadow: '0 40px 100px -30px rgba(110,87,250,0.3), 0 80px 160px -60px rgba(110,87,250,0.15)', animationDelay: '240ms' } },
        h(Constellation, { onSelect: setSelection, focusedAgent, activeFilter, paused, data, t }),
        h(SidePanel, { selection, onClose: () => setSelection(null), focusedAgent, setFocusedAgent, data, t }),
      ),

      // Hint
      h('div', { style: { marginTop: 18, fontFamily: 'Geist Mono, monospace', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#A998FF', textAlign: 'center', lineHeight: 1.6 } }, tn.hintCaption),
    ),

    // PHILOSOPHY
    h('section', { style: { padding: '120px 32px', maxWidth: 1240, margin: '0 auto' } },
      h('div', { style: { fontFamily: 'Geist Mono, monospace', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#A998FF' } }, tn.philEyebrow),
      h('h2', { style: { fontSize: 'clamp(28px, 3.5vw, 44px)', fontWeight: 500, letterSpacing: '-0.03em', color: '#FFFFFF', lineHeight: 1.08, margin: '14px 0 0', maxWidth: 880 } },
        tn.philTitle[0], h('em', { style: { fontStyle: 'normal', color: '#A998FF' } }, tn.philTitle[1]), tn.philTitle[2]),
      h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 24, marginTop: 60 } },
        AGENTS.map(a => h('div', { key: a.id, style: { padding: 24, background: 'rgba(110,87,250,0.05)', border: '1px solid #2A2A48', borderRadius: 14 } },
          h('div', { style: { width: 36, height: 36, borderRadius: '50%', background: '#C4B5FD', marginBottom: 16 } }),
          h('div', { style: { fontFamily: 'Geist Mono, monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#A998FF' } }, t.agent + ' \u00b7 ' + a.short),
          h('div', { style: { fontSize: 22, fontWeight: 500, letterSpacing: '-0.025em', color: '#FFFFFF', marginTop: 6, lineHeight: 1.15 } }, a.name),
          h('div', { style: { fontFamily: 'Geist Mono, monospace', fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#A998FF', marginTop: 8, lineHeight: 1.4 } }, a.tagline),
          h('div', { style: { fontSize: 13, color: '#C4B5FD', marginTop: 14, lineHeight: 1.55 } }, a.desc),
        )),
      ),
    ),

    // CTA
    h('section', { style: { padding: '80px 32px 140px', textAlign: 'center' } },
      h('div', { style: { fontFamily: 'Geist Mono, monospace', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#A998FF', marginBottom: 14, lineHeight: 1.4 } }, tn.readyCaption),
      h('h3', { style: { fontSize: 'clamp(28px, 4vw, 48px)', fontWeight: 500, letterSpacing: '-0.03em', color: '#FFFFFF', margin: '0 0 32px', maxWidth: 720, marginInline: 'auto', lineHeight: 1.1 } }, t.ctaTitle),
      h('a', { href: '/#book', style: { display: 'inline-block', padding: '14px 28px', background: '#FFFFFF', color: '#0A0A0A', borderRadius: 999, fontFamily: 'Geist, sans-serif', fontSize: 15, fontWeight: 500, textDecoration: 'none' } }, t.ctaButton),
      h('div', { style: { fontFamily: 'Geist Mono, monospace', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#7A7A78', marginTop: 20 } }, t.ctaNote),
    ),
  );
};

// ─── MOUNT ──────────────────────────────────────────────────
const root = ReactDOM.createRoot(document.getElementById('constellation-root'));
root.render(React.createElement(ConstellationApp));
