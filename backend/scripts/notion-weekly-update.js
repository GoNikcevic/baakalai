#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   BAKAL / STANKO · Weekly Update → Notion

   Usage:  cd backend && node scripts/notion-weekly-update.js

   Requires:
   - NOTION_TOKEN set in .env
   - The integration must be connected to the target page in Notion
     (Go to your page → ... → Connections → Add "Bakal")

   This script will:
   1. Find your "Stanko" workspace pages
   2. Create a "Résumé Semaine · 24-28 Fév. 2026" page with the weekly summary
   3. Create tasks in the Project Management database (if found)
   ═══════════════════════════════════════════════════════════════════════════ */

require('dotenv').config();
const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_TOKEN });

// ═══ The weekly summary content ═══
const WEEKLY_SUMMARY = {
  title: 'Résumé Semaine, 24-28 Février 2026',
  icon: '🚀',
  content: [
    {
      type: 'heading_2',
      text: 'Avancement Plateforme Bakal / Stanko'
    },
    {
      type: 'paragraph',
      text: "Voici un résumé des avancées réalisées cette semaine sur la plateforme de prospection automatisée. L'objectif est de préparer le lancement de la v1 fonctionnelle."
    },
    {
      type: 'heading_3',
      text: '1. Interface Chat & Assistant IA'
    },
    {
      type: 'bulleted_list_item',
      text: "Refonte complète de la page d'accueil du chat inspirée du design Stanko, sidebar avec historique des conversations, page d'accueil avec actions rapides"
    },
    {
      type: 'bulleted_list_item',
      text: "L'assistant conversationnel est maintenant connecté à l'API Claude. On peut lui parler pour créer des campagnes, poser des questions, et lancer des séquences."
    },
    {
      type: 'heading_3',
      text: '2. Copy Editor (Éditeur de séquences)'
    },
    {
      type: 'bulleted_list_item',
      text: "Connexion au backend en live : les données des campagnes (séquences, touchpoints) sont chargées depuis le serveur, pas en local"
    },
    {
      type: 'bulleted_list_item',
      text: "Sauvegarde en temps réel des modifications (objets, corps d'email, messages LinkedIn)"
    },
    {
      type: 'bulleted_list_item',
      text: "Bouton \"Lancer\" pour déployer les séquences + bouton \"Régénérer\" pour demander à Claude de réécrire un touchpoint"
    },
    {
      type: 'heading_3',
      text: '3. Pipeline IA (Backend)'
    },
    {
      type: 'bulleted_list_item',
      text: "Validation complète du pipeline IA : gestion d'erreurs, mode dry-run pour tester sans consommer de crédits, test du flux complet (analyse → diagnostic → régénération)"
    },
    {
      type: 'bulleted_list_item',
      text: 'Stockage chiffré des clés API (Lemlist, Notion, Claude) côté serveur, les clés ne sont jamais visibles en clair'
    },
    {
      type: 'heading_3',
      text: '4. Dashboard Analytics (NOUVEAU)'
    },
    {
      type: 'bulleted_list_item',
      text: "Nouvel onglet \"Analytics\" avec graphiques SVG : courbes d'engagement hebdomadaire (ouvertures, réponses, LinkedIn), sélecteur de période (4/8/12 semaines)"
    },
    {
      type: 'bulleted_list_item',
      text: 'Barres de performance par campagne, répartition par canal (Email vs LinkedIn vs Multi), et entonnoir de conversion (Contacté → Ouvert → Répondu → Intéressé → RDV)'
    },
    {
      type: 'heading_3',
      text: '5. Système de Notifications'
    },
    {
      type: 'bulleted_list_item',
      text: 'Notifications toast (pop-ups en haut à droite) avec 4 types : succès, alerte, erreur, info, auto-dismiss avec barre de progression'
    },
    {
      type: 'bulleted_list_item',
      text: 'Cloche de notification dans le header du dashboard avec panneau déroulant et compteur de non-lus'
    },
    {
      type: 'bulleted_list_item',
      text: "Alertes automatiques sur les campagnes : notification quand le taux de réponse est faible ou quand les ouvertures sont excellentes"
    },
    {
      type: 'heading_3',
      text: '6. Page Paramètres améliorée'
    },
    {
      type: 'bulleted_list_item',
      text: "Dashboard d'état des connexions : 3 cartes visuelles (Lemlist, Notion, Claude) montrant l'état en temps réel (connecté / non connecté / erreur)"
    },
    {
      type: 'bulleted_list_item',
      text: 'Section gestion des données : export CSV global et réinitialisation des préférences'
    },
    {
      type: 'heading_3',
      text: '7. Responsive Mobile'
    },
    {
      type: 'bulleted_list_item',
      text: "3 breakpoints responsive : tablette (1200px), sidebar réduite (900px), mobile complet (600px) avec barre de navigation en bas de l'écran"
    },
    {
      type: 'bulleted_list_item',
      text: 'Toutes les pages (chat, dashboard, copy editor, recommandations, paramètres) fonctionnent sur mobile'
    },
    {
      type: 'divider'
    },
    {
      type: 'heading_2',
      text: '📊 État actuel de la plateforme'
    },
    {
      type: 'paragraph',
      text: "Frontend : 95% terminé (toutes les pages fonctionnelles, responsive, thème clair/sombre). Backend : 70% terminé (API campaigns, IA pipeline, stockage chiffré). Intégrations externes : 20% (Notion connecté, Lemlist et N8N restent à configurer)."
    },
  ]
};

// ═══ Tasks for Project Management ═══
const LAUNCH_TASKS = [
  { title: 'Configurer Lemlist API', status: 'À faire', priority: 'Haute', category: 'Backend', desc: "Obtenir la clé API Lemlist, la configurer dans le backend, tester la connexion avec une campagne test. Endpoints nécessaires : GET /campaigns, GET /campaigns/{id}/export, PATCH /campaigns/{id}/sequences" },
  { title: 'Connecter Notion aux bases de données', status: 'En cours', priority: 'Haute', category: 'Backend', desc: "Exécuter le script setup-notion pour créer les 4 bases (Résultats, Diagnostics, Historique, Mémoire). Configurer les IDs dans le .env. Tester la sync bidirectionnelle." },
  { title: 'Déployer le backend (VPS ou Railway)', status: 'À faire', priority: 'Haute', category: 'Infrastructure', desc: "Choisir entre VPS (OVH/Hetzner) ou PaaS (Railway/Render). Configurer Docker, variables d'environnement, SSL. Pointer un sous-domaine api.stanko.fr." },
  { title: "Mettre en place l'authentification utilisateur", status: 'À faire', priority: 'Haute', category: 'Backend', desc: "Login/logout, sessions JWT, support multi-clients. Chaque client doit voir uniquement ses campagnes et ses données." },
  { title: 'Installer et configurer N8N', status: 'À faire', priority: 'Moyenne', category: 'Infrastructure', desc: "Self-host N8N (Docker ou N8N Cloud). Importer les 3 workflows (stats collection, regeneration, memory consolidation). Configurer les credentials Lemlist + Notion + Claude." },
  { title: 'Workflow 1 : Collecte automatique des stats', status: 'À faire', priority: 'Moyenne', category: 'Automatisation', desc: "Activer le workflow N8N quotidien (8h) : fetch stats Lemlist → calcul métriques → stockage Notion → trigger analyse Claude si >50 prospects et >7 jours." },
  { title: 'Workflow 2 : Régénération et déploiement A/B', status: 'À faire', priority: 'Moyenne', category: 'Automatisation', desc: "Workflow déclenché par W1 : lecture messages originaux + mémoire depuis Notion → appel Claude pour régénération → mise à jour séquences Lemlist avec variantes A/B." },
  { title: 'Workflow 3 : Consolidation mémoire mensuelle', status: 'À faire', priority: 'Basse', category: 'Automatisation', desc: "Workflow mensuel : agrégation des diagnostics du mois → mise à jour de la bibliothèque de patterns cross-campagne dans Notion." },
  { title: 'Tester le flux complet avec un vrai client', status: 'À faire', priority: 'Haute', category: 'Validation', desc: "Campagne pilote avec FormaPro Consulting : créer campagne → générer séquences → importer prospects → lancer sur Lemlist → collecter stats → analyser → optimiser. Objectif : valider le process de bout en bout." },
  { title: 'Finaliser la landing page', status: 'À faire', priority: 'Basse', category: 'Marketing', desc: "Remplacer les liens Calendly placeholder par les vrais. Ajouter de vrais témoignages clients. Vérifier les textes FR et EN. Déployer sur le domaine principal." },
  { title: 'Configurer le domaine et le DNS', status: 'À faire', priority: 'Moyenne', category: 'Infrastructure', desc: "Acheter/configurer stanko.fr (ou baakal.ai). Sous-domaines : app.stanko.fr (frontend), api.stanko.fr (backend), n8n.stanko.fr (workflows)." },
  { title: 'Mettre en place le monitoring', status: 'À faire', priority: 'Moyenne', category: 'Infrastructure', desc: "Alertes quand le backend tombe, quand les workflows N8N échouent, quand les clés API expirent. Uptime monitoring (UptimeRobot ou similaire)." },
];


// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('Connecting to Notion...');

  // 1. Verify connection
  try {
    const me = await notion.users.me();
    console.log(`✅ Connected as: ${me.name || me.id}`);
  } catch (e) {
    console.error('❌ Connection failed:', e.message);
    console.log('\nMake sure you:');
    console.log('1. Have NOTION_TOKEN set in .env');
    console.log('2. Connected the integration to your workspace page');
    console.log('   (Page → ... → Connections → Add "Bakal")');
    process.exit(1);
  }

  // 2. Search for pages to find where to create content
  console.log('\nSearching workspace...');
  const search = await notion.search({ page_size: 100 });

  console.log(`Found ${search.results.length} items:`);
  search.results.forEach(item => {
    const type = item.object;
    let title = '';
    if (type === 'page') {
      const props = item.properties || {};
      const titleProp = props.title || props.Name || Object.values(props).find(p => p.type === 'title');
      title = titleProp?.title?.[0]?.plain_text || '(untitled)';
    } else if (type === 'database') {
      title = item.title?.[0]?.plain_text || '(untitled db)';
    }
    console.log(`  ${type === 'database' ? '🗄️' : '📄'} ${title} (${item.id})`);
  });

  // 3. Find a suitable parent page
  // Try to find the Welcome page or any top-level page
  let parentPageId = null;

  // Look for common page names
  for (const item of search.results) {
    if (item.object !== 'page') continue;
    const props = item.properties || {};
    const titleProp = props.title || props.Name || Object.values(props).find(p => p.type === 'title');
    const title = (titleProp?.title?.[0]?.plain_text || '').toLowerCase();

    if (title.includes('welcome') || title.includes('stanko') || title.includes('bakal') || title.includes('projet')) {
      parentPageId = item.id;
      console.log(`\n📌 Using parent page: "${titleProp?.title?.[0]?.plain_text}" (${item.id})`);
      break;
    }
  }

  // Fallback: use the first page found
  if (!parentPageId) {
    const firstPage = search.results.find(r => r.object === 'page');
    if (firstPage) {
      parentPageId = firstPage.id;
      console.log(`\n📌 Using first available page as parent: ${parentPageId}`);
    }
  }

  if (!parentPageId) {
    console.error('\n❌ No pages found. Make sure the integration is connected to at least one page.');
    console.log('Go to any page in Notion → ... → Connections → Add "Bakal"');
    process.exit(1);
  }

  // 4. Create the weekly summary page
  console.log('\n📝 Creating weekly summary page...');

  const children = [];
  for (const block of WEEKLY_SUMMARY.content) {
    if (block.type === 'divider') {
      children.push({ object: 'block', type: 'divider', divider: {} });
    } else if (block.type === 'heading_2') {
      children.push({
        object: 'block', type: 'heading_2',
        heading_2: { rich_text: [{ type: 'text', text: { content: block.text } }] }
      });
    } else if (block.type === 'heading_3') {
      children.push({
        object: 'block', type: 'heading_3',
        heading_3: { rich_text: [{ type: 'text', text: { content: block.text } }] }
      });
    } else if (block.type === 'paragraph') {
      children.push({
        object: 'block', type: 'paragraph',
        paragraph: { rich_text: [{ type: 'text', text: { content: block.text } }] }
      });
    } else if (block.type === 'bulleted_list_item') {
      children.push({
        object: 'block', type: 'bulleted_list_item',
        bulleted_list_item: { rich_text: [{ type: 'text', text: { content: block.text } }] }
      });
    }
  }

  const summaryPage = await notion.pages.create({
    parent: { page_id: parentPageId },
    icon: { type: 'emoji', emoji: WEEKLY_SUMMARY.icon },
    properties: {
      title: { title: [{ text: { content: WEEKLY_SUMMARY.title } }] }
    },
    children: children
  });

  console.log(`✅ Weekly summary created: ${summaryPage.url}`);

  // 5. Look for a Project Management database, or create a task list page
  console.log('\n📋 Setting up project tasks...');

  let pmDb = null;
  for (const item of search.results) {
    if (item.object !== 'database') continue;
    const title = (item.title?.[0]?.plain_text || '').toLowerCase();
    if (title.includes('project') || title.includes('task') || title.includes('tâche') || title.includes('gestion')) {
      pmDb = item;
      console.log(`📌 Found PM database: "${item.title?.[0]?.plain_text}" (${item.id})`);
      break;
    }
  }

  if (pmDb) {
    // Add tasks to existing database
    for (const task of LAUNCH_TASKS) {
      try {
        const props = {
          Name: { title: [{ text: { content: task.title } }] }
        };

        // Try to set status if the property exists
        const dbInfo = await notion.databases.retrieve({ database_id: pmDb.id });
        const propNames = Object.keys(dbInfo.properties);

        const statusProp = propNames.find(p => p.toLowerCase().includes('status') || p.toLowerCase().includes('statut'));
        if (statusProp && dbInfo.properties[statusProp].type === 'select') {
          props[statusProp] = { select: { name: task.status } };
        }

        const priorityProp = propNames.find(p => p.toLowerCase().includes('priorit'));
        if (priorityProp && dbInfo.properties[priorityProp].type === 'select') {
          props[priorityProp] = { select: { name: task.priority } };
        }

        await notion.pages.create({
          parent: { database_id: pmDb.id },
          properties: props,
          children: [
            { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ text: { content: task.desc } }] } }
          ]
        });
        console.log(`  ✅ Task added: ${task.title}`);
      } catch (e) {
        console.log(`  ⚠️  Task "${task.title}": ${e.message}`);
      }
    }
  } else {
    // No PM database found · create a tasks page instead
    console.log('No PM database found. Creating a task list page...');

    const taskBlocks = [
      { object: 'block', type: 'heading_2', heading_2: { rich_text: [{ text: { content: 'Tâches restantes avant lancement' } }] } },
      { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ text: { content: "Liste des tâches à accomplir pour rendre la plateforme Stanko opérationnelle et prête pour le premier client pilote." } }] } },
      { object: 'block', type: 'divider', divider: {} },
    ];

    // Group by category
    const categories = {};
    for (const task of LAUNCH_TASKS) {
      if (!categories[task.category]) categories[task.category] = [];
      categories[task.category].push(task);
    }

    for (const [cat, tasks] of Object.entries(categories)) {
      taskBlocks.push({
        object: 'block', type: 'heading_3',
        heading_3: { rich_text: [{ text: { content: `${cat}` } }] }
      });
      for (const task of tasks) {
        taskBlocks.push({
          object: 'block', type: 'to_do',
          to_do: {
            rich_text: [
              { type: 'text', text: { content: `[${task.priority}] ${task.title}` }, annotations: { bold: true } },
              { type: 'text', text: { content: `, ${task.desc}` } }
            ],
            checked: task.status === 'Fait'
          }
        });
      }
    }

    const tasksPage = await notion.pages.create({
      parent: { page_id: parentPageId },
      icon: { type: 'emoji', emoji: '📋' },
      properties: {
        title: { title: [{ text: { content: 'Tâches, Lancement Stanko' } }] }
      },
      children: taskBlocks
    });

    console.log(`✅ Tasks page created: ${tasksPage.url}`);
  }

  console.log('\n🎉 Done! Check your Notion workspace.');
}

main().catch(e => {
  console.error('Fatal error:', e.message);
  process.exit(1);
});
