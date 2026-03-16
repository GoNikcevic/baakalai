#!/usr/bin/env node
/**
 * Seed the database with realistic demo campaigns.
 * Mirrors the BAKAL_DEMO_DATA from app/campaigns-data.js so
 * the frontend can load from the backend instead of hardcoded data.
 *
 * Usage: node scripts/seed-demo.js [--reset]
 *   --reset  Deletes all existing data before seeding
 */

require('dotenv').config();
const db = require('../db');
const bcrypt = require('bcryptjs');

const RESET = process.argv.includes('--reset');

async function main() {
  console.log('\n  Bakal — Demo Seed\n  ==================\n');

  if (RESET) {
    console.log('  Resetting database...');
    const tables = [
      'chart_data', 'reports', 'opportunities',
      'chat_messages', 'chat_threads',
      'versions', 'diagnostics', 'touchpoints',
      'campaigns', 'memory_patterns', 'user_profiles',
      'project_files', 'projects', 'custom_variables',
      'documents', 'refresh_tokens', 'settings', 'users',
    ];
    for (const table of tables) {
      try { await db.query(`DELETE FROM ${table}`); } catch { /* table may not exist */ }
    }
    console.log('  All tables cleared.\n');
  }

  // Check if campaigns already exist
  const existing = await db.campaigns.list();
  if (existing.length > 0 && !RESET) {
    console.log(`  Database already has ${existing.length} campaign(s). Use --reset to clear and re-seed.`);
    process.exit(0);
  }

  // ═══════════════════════════════════════════════════
  // Demo User
  // ═══════════════════════════════════════════════════

  const passwordHash = await bcrypt.hash('Demo2026!', 10);
  const user = await db.users.create({
    email: 'demo@bakal.fr',
    passwordHash,
    name: 'Goran Demo',
    company: 'FormaPro Consulting',
    role: 'admin',
  });
  const userId = user.id;

  console.log(`  User: ${user.email} (id=${userId}, password=Demo2026!)`);

  // ═══════════════════════════════════════════════════
  // User Profile
  // ═══════════════════════════════════════════════════

  await db.profiles.upsert(userId, {
    company: 'FormaPro Consulting',
    sector: 'Formation professionnelle',
    website: 'https://formapro-consulting.fr',
    team_size: '5-10',
    description: 'Cabinet de formation professionnelle spécialisé dans les métiers de la finance et des RH',
    value_prop: 'Formations certifiantes avec taux de réussite de 94%, accompagnement personnalisé de A à Z',
    social_proof: '200+ entreprises formées, 94% de taux de réussite, partenaire OPCO',
    pain_points: 'Difficulté à trouver des prospects qualifiés, coût d\'acquisition élevé, cycle de vente long',
    objections: 'Prix trop élevé, pas le temps, déjà un prestataire',
    persona_primary: 'DAF / Directeur Financier',
    persona_secondary: 'DRH / Dirigeant PME',
    target_sectors: 'Comptabilité, Finance, Conseil, RH',
    target_size: '11-200 salariés',
    target_zones: 'Île-de-France, Lyon, France entière',
    default_tone: 'Pro décontracté',
    default_formality: 'Vous',
  });

  console.log('  Profile created');

  // ═══════════════════════════════════════════════════
  // Projects
  // ═══════════════════════════════════════════════════

  const project1 = await db.projects.create({
    userId,
    name: 'FormaPro Consulting',
    client: 'FormaPro Consulting',
    description: 'Prospection multi-cible pour cabinet de formation professionnelle',
    color: 'var(--blue)',
  });

  const project2 = await db.projects.create({
    userId,
    name: 'TechVision SaaS',
    client: 'TechVision',
    description: 'Lancement produit SaaS — acquisition early adopters B2B',
    color: 'var(--purple)',
  });

  console.log(`  Projects: ${project1.name}, ${project2.name}`);

  // ═══════════════════════════════════════════════════
  // Campaign 1: DAF Île-de-France (Email, Active)
  // ═══════════════════════════════════════════════════

  const camp1 = await db.campaigns.create({
    name: 'DAF Île-de-France',
    client: 'FormaPro Consulting',
    status: 'active',
    channel: 'email',
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
    startDate: '2026-01-27',
    iteration: 4,
    nbProspects: 250,
    sent: 250,
    planned: 300,
    userId,
    projectId: project1.id,
  });

  await db.campaigns.update(camp1.id, {
    open_rate: 68,
    reply_rate: 9.2,
    interested: 6,
    meetings: 3,
  });

  console.log(`  Campaign: ${camp1.name}`);

  // Touchpoints
  const camp1Touchpoints = [
    { step: 'E1', type: 'email', label: 'Email initial', timing: 'J+0', subType: 'Angle douleur client', subject: '{{firstName}}, une question sur votre gestion financière', body: "Bonjour {{firstName}}, combien d'heures par semaine votre équipe passe-t-elle sur des tâches qui pourraient être automatisées ? Chez {{companyName}}, les cabinets comme le vôtre gagnent en moyenne 12h/semaine..." },
    { step: 'E2', type: 'email', label: 'Email valeur', timing: 'J+3', subType: 'Case study', subject: 'Re: gestion financière — un cas concret', body: "{{firstName}}, je me permets de revenir avec un exemple concret. Le cabinet Nexia Conseil (35 personnes, secteur similaire) a réduit de 40% le temps de reporting..." },
    { step: 'E3', type: 'email', label: 'Email relance', timing: 'J+7', subType: 'Angle différent', subject: 'Autre approche, {{firstName}}', body: "{{firstName}}, je change d'approche. Plutôt que de parler d'automatisation, une question simple : quel est le coût réel d'une erreur de saisie dans un bilan chez {{companyName}} ?..." },
    { step: 'E4', type: 'email', label: 'Email break-up', timing: 'J+12', subType: 'Soft close', subject: 'Dernière tentative, {{firstName}}', body: "{{firstName}}, je ne veux pas encombrer votre boîte. Si ce n'est pas le bon moment, pas de souci — je ne reviendrai pas. Juste un dernier mot : si un jour 12h/semaine récupérées..." },
  ];

  for (let i = 0; i < camp1Touchpoints.length; i++) {
    await db.touchpoints.create(camp1.id, { ...camp1Touchpoints[i], sortOrder: i });
  }

  // Update touchpoint stats
  const camp1TpRows = await db.touchpoints.listByCampaign(camp1.id);
  const camp1Stats = [
    { open_rate: 68, reply_rate: 4.2, stop_rate: 0.4 },
    { open_rate: 72, reply_rate: 3.1, stop_rate: 0.8 },
    { open_rate: 55, reply_rate: 1.4, stop_rate: 0 },
    { open_rate: 48, reply_rate: 0.5, stop_rate: 0 },
  ];
  for (let i = 0; i < camp1TpRows.length; i++) {
    if (camp1Stats[i]) await db.touchpoints.update(camp1TpRows[i].id, camp1Stats[i]);
  }

  // Diagnostics
  await db.diagnostics.create(camp1.id, {
    diagnostic: JSON.stringify([
      { step: 'E1', level: 'success', title: 'E1 — Performant', text: "L'objet personnalisé avec {{firstName}} et la question directe fonctionnent très bien. Taux d'ouverture de 68% au-dessus du benchmark (50%). Le CTA question ouverte génère un bon taux de réponse (4.2%)." },
      { step: 'E2', level: 'success', title: 'E2 — Fort potentiel', text: "Le \"Re:\" dans l'objet booste l'ouverture à 72% (effet thread). Le case study concret avec des chiffres (40% de réduction) crédibilise le message." },
      { step: 'E3', level: 'warning', title: 'E3 — À optimiser', text: "Baisse significative d'ouverture (55%) et de réponse (1.4%). L'angle \"coût de l'erreur\" peut être perçu comme anxiogène. Recommandation : tester un angle \"gain de temps\" plus positif." },
      { step: 'E4', level: 'blue', title: 'E4 — Normal pour un break-up', text: "Taux d'ouverture de 48% correct pour un dernier email. Le ton respectueux évite la pression. Aucune modification nécessaire." },
    ]),
    priorities: ['E3'],
    nbToOptimize: 1,
  });

  // Version history
  const camp1Versions = [
    { version: 4, hypotheses: 'Test A/B: Douleur vs Douleur+Urgence', result: 'testing', date: '2026-02-17', messagesModified: ['E1', 'E3'] },
    { version: 3, hypotheses: 'Passage angle douleur client sur E1 et E3', result: 'improved', date: '2026-02-10', messagesModified: ['E1', 'E3'] },
    { version: 2, hypotheses: 'Optimisation objets email (A/B)', result: 'improved', date: '2026-02-03', messagesModified: ['E1', 'E2', 'E3', 'E4'] },
    { version: 1, hypotheses: 'Lancement initial', result: 'neutral', date: '2026-01-27', messagesModified: [] },
  ];
  for (const v of camp1Versions) await db.versions.create(camp1.id, v);

  console.log(`    ${camp1Touchpoints.length} touchpoints, 1 diagnostic, ${camp1Versions.length} versions`);

  // ═══════════════════════════════════════════════════
  // Campaign 2: Dirigeants Formation (LinkedIn, Active)
  // ═══════════════════════════════════════════════════

  const camp2 = await db.campaigns.create({
    name: 'Dirigeants Formation',
    client: 'FormaPro Consulting',
    status: 'active',
    channel: 'linkedin',
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
    startDate: '2026-02-03',
    iteration: 2,
    nbProspects: 152,
    sent: 152,
    planned: 200,
    userId,
    projectId: project1.id,
  });

  await db.campaigns.update(camp2.id, {
    accept_rate_lk: 38,
    reply_rate: 6.8,
    interested: 3,
    meetings: 1,
  });

  console.log(`  Campaign: ${camp2.name}`);

  const camp2Touchpoints = [
    { step: 'L1', type: 'linkedin', label: 'Note de connexion', timing: 'J+0', subType: 'Max 300 caractères', subject: null, body: "{{firstName}}, votre parcours dans la formation m'a interpellé. J'accompagne des dirigeants du secteur sur la croissance commerciale — je serais ravi d'échanger avec vous.", maxChars: 300 },
    { step: 'L2', type: 'linkedin', label: 'Message post-connexion', timing: 'J+3', subType: 'Conversationnel', subject: null, body: "Merci d'avoir accepté, {{firstName}} !\n\nJ'ai accompagné 3 organismes de formation comme le vôtre à générer entre 5 et 12 RDV qualifiés par mois.\n\nCurieux de savoir comment vous gérez votre développement commercial actuellement ?" },
  ];

  for (let i = 0; i < camp2Touchpoints.length; i++) {
    await db.touchpoints.create(camp2.id, { ...camp2Touchpoints[i], sortOrder: i });
  }

  const camp2TpRows = await db.touchpoints.listByCampaign(camp2.id);
  const camp2Stats = [{ accept_rate: 38 }, { reply_rate: 6.8, interested: 3, stop_rate: 1.2 }];
  for (let i = 0; i < camp2TpRows.length; i++) {
    if (camp2Stats[i]) await db.touchpoints.update(camp2TpRows[i].id, camp2Stats[i]);
  }

  await db.diagnostics.create(camp2.id, {
    diagnostic: JSON.stringify([
      { step: 'L1', level: 'success', title: 'L1 — Bon taux d\'acceptation', text: "38% d'acceptation au-dessus du benchmark LinkedIn (30%). Le compliment sur le parcours + positionnement sectoriel fonctionne bien." },
      { step: 'L2', level: 'warning', title: 'L2 — Réponse sous l\'objectif', text: "6.8% de réponse vs objectif de 8%. Le \"3 organismes de formation\" manque de spécificité. Recommandation : tester un angle douleur client." },
    ]),
    priorities: ['L2'],
    nbToOptimize: 1,
  });

  const camp2Versions = [
    { version: 2, hypotheses: 'Personnalisation note de connexion', result: 'improved', date: '2026-02-10', messagesModified: ['L1'] },
    { version: 1, hypotheses: 'Lancement initial', result: 'neutral', date: '2026-02-03', messagesModified: [] },
  ];
  for (const v of camp2Versions) await db.versions.create(camp2.id, v);

  console.log(`    ${camp2Touchpoints.length} touchpoints, 1 diagnostic, ${camp2Versions.length} versions`);

  // ═══════════════════════════════════════════════════
  // Campaign 3: DRH PME Lyon (Multi, Prep)
  // ═══════════════════════════════════════════════════

  const camp3 = await db.campaigns.create({
    name: 'DRH PME Lyon',
    client: 'FormaPro Consulting',
    status: 'prep',
    channel: 'multi',
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
    startDate: '2026-02-18',
    iteration: 0,
    nbProspects: 187,
    sent: 0,
    planned: 187,
    userId,
    projectId: project1.id,
  });

  console.log(`  Campaign: ${camp3.name}`);

  const camp3Touchpoints = [
    { step: 'E1', type: 'email', label: 'Email initial', timing: 'J+0', subType: 'Offre directe', subject: '{{firstName}}, une solution concrète pour vos recrutements', body: "Bonjour {{firstName}}, nous aidons des DRH de PME comme {{companyName}} à réduire de 40% leur temps de recrutement. Seriez-vous disponible 15 minutes cette semaine ?" },
    { step: 'L1', type: 'linkedin', label: 'Note de connexion LinkedIn', timing: 'J+1', subType: 'Max 300 chars', subject: null, body: "{{firstName}}, votre expertise RH chez {{companyName}} m'a interpellé. J'échange régulièrement avec des DRH de PME lyonnaises — je serais ravi de vous compter dans mon réseau.", maxChars: 300 },
    { step: 'E2', type: 'email', label: 'Email valeur', timing: 'J+4', subType: 'Case study', subject: 'Re: recrutements — un résultat qui parle', body: "{{firstName}}, un exemple concret : une PME de conseil RH (180 personnes, Lyon) a divisé par 2 ses délais de recrutement en 3 mois..." },
    { step: 'L2', type: 'linkedin', label: 'Message LinkedIn', timing: 'J+5', subType: 'Post-connexion', subject: null, body: "Merci d'avoir accepté, {{firstName}} ! J'accompagne des PME lyonnaises sur l'optimisation RH..." },
    { step: 'E3', type: 'email', label: 'Email relance', timing: 'J+8', subType: 'Angle différent', subject: null, body: "{{firstName}}, une autre manière de voir les choses : combien vous coûte un recrutement raté chez {{companyName}} ?..." },
    { step: 'E4', type: 'email', label: 'Email break-up', timing: 'J+13', subType: 'Soft close', subject: null, body: "{{firstName}}, dernier message de ma part. Si le timing n'est pas bon, aucun souci..." },
  ];

  for (let i = 0; i < camp3Touchpoints.length; i++) {
    await db.touchpoints.create(camp3.id, { ...camp3Touchpoints[i], sortOrder: i });
  }

  console.log(`    ${camp3Touchpoints.length} touchpoints`);

  // ═══════════════════════════════════════════════════
  // Memory Patterns
  // ═══════════════════════════════════════════════════

  const patterns = [
    { pattern: 'Questions ouvertes > propositions de call (+2-3pts réponse)', category: 'Corps', data: 'CTA type "question ouverte" surperforme systématiquement les "proposition de call" sur les premiers emails.', confidence: 'Haute', sectors: ['Comptabilité & Finance', 'Formation & Éducation'], targets: ['DAF', 'Dirigeant'] },
    { pattern: 'Angle douleur client > preuve sociale (+3.2pts réponse email)', category: 'Corps', data: 'L\'angle "douleur client" convertit mieux que la preuve sociale. Effet fort sur E1 et E3.', confidence: 'Moyenne', sectors: ['Comptabilité & Finance'], targets: ['DAF'] },
    { pattern: 'Objets personnalisés avec {{firstName}} +8pts ouverture', category: 'Objets', data: 'Les objets contenant {{firstName}} et une référence au secteur surperforment les objets génériques.', confidence: 'Haute', sectors: ['Comptabilité & Finance'], targets: ['DAF'] },
    { pattern: 'Envoi mardi matin (9h-10h) +15% ouvertures', category: 'Timing', data: 'Les emails envoyés le mardi entre 9h et 10h montrent un taux d\'ouverture supérieur de 15%.', confidence: 'Moyenne', sectors: ['Comptabilité & Finance'], targets: ['DAF'] },
    { pattern: 'Compliment parcours + secteur booste acceptation LinkedIn (+8pts)', category: 'LinkedIn', data: 'Les notes de connexion qui complimentent le parcours et mentionnent le secteur spécifique obtiennent un taux d\'acceptation 8 points supérieur.', confidence: 'Moyenne', sectors: ['Formation & Éducation'], targets: ['Dirigeant'] },
  ];

  for (const p of patterns) await db.memoryPatterns.create(p);
  console.log(`  ${patterns.length} memory patterns`);

  // ═══════════════════════════════════════════════════
  // Opportunities
  // ═══════════════════════════════════════════════════

  const opps = [
    { userId, campaignId: camp1.id, name: 'Marie Dupont', title: 'DAF', company: 'Cabinet Nexia', companySize: '35 sal.', status: 'interested', statusColor: 'var(--green)', timing: 'RDV prévu le 20 mars' },
    { userId, campaignId: camp1.id, name: 'Jean-Pierre Martin', title: 'Directeur Financier', company: 'Groupe Audit Plus', companySize: '48 sal.', status: 'meeting', statusColor: 'var(--blue)', timing: 'Call le 18 mars' },
    { userId, campaignId: camp1.id, name: 'Sophie Laurent', title: 'DAF', company: 'FidéConseil', companySize: '22 sal.', status: 'replied', statusColor: 'var(--orange)', timing: 'Relance J+3' },
    { userId, campaignId: camp2.id, name: 'Pierre Moreau', title: 'Dirigeant', company: 'FormExpert', companySize: '8 sal.', status: 'interested', statusColor: 'var(--green)', timing: 'Message LinkedIn envoyé' },
    { userId, campaignId: camp2.id, name: 'Isabelle Petit', title: 'Directrice', company: 'Forma Plus', companySize: '5 sal.', status: 'new', statusColor: 'var(--text-muted)', timing: 'Connexion acceptée' },
  ];

  for (const o of opps) await db.opportunities.create(o);
  console.log(`  ${opps.length} opportunities`);

  // ═══════════════════════════════════════════════════
  // Reports (weekly)
  // ═══════════════════════════════════════════════════

  const reportsData = [
    { userId, week: 'S10', dateRange: '3 — 9 mars', score: 'excellent', scoreLabel: 'Excellent', contacts: 85, openRate: 66, replyRate: 8.5, interested: 3, meetings: 2, synthesis: 'Semaine record avec 2 RDV pris. Le test A/B sur DAF IDF confirme la supériorité de l\'angle douleur. LinkedIn Dirigeants commence à décoller.' },
    { userId, week: 'S9', dateRange: '24 fév. — 2 mars', score: 'good', scoreLabel: 'Bon', contacts: 72, openRate: 62, replyRate: 7.1, interested: 2, meetings: 1, synthesis: 'Bonne progression. L\'optimisation v3 de DAF IDF porte ses fruits. Nouvelle campagne DRH Lyon en préparation.' },
    { userId, week: 'S8', dateRange: '17 — 23 fév.', score: 'ok', scoreLabel: 'Correct', contacts: 64, openRate: 58, replyRate: 5.8, interested: 1, meetings: 0, synthesis: 'Semaine stable. Lancement du test A/B v4. LinkedIn en croissance lente mais régulière.' },
    { userId, week: 'S7', dateRange: '10 — 16 fév.', score: 'good', scoreLabel: 'Bon', contacts: 58, openRate: 61, replyRate: 6.2, interested: 2, meetings: 1, synthesis: 'Passage à l\'angle douleur client sur DAF IDF : +3.2pts de réponse. Première optimisation réussie.' },
  ];

  for (const r of reportsData) await db.reports.create(r);
  console.log(`  ${reportsData.length} weekly reports`);

  // ═══════════════════════════════════════════════════
  // Chart Data (weekly activity)
  // ═══════════════════════════════════════════════════

  const chartPoints = [
    { userId, label: 'S5', emailCount: 45, linkedinCount: 0, weekStart: '2026-01-27' },
    { userId, label: 'S6', emailCount: 62, linkedinCount: 30, weekStart: '2026-02-03' },
    { userId, label: 'S7', emailCount: 58, linkedinCount: 35, weekStart: '2026-02-10' },
    { userId, label: 'S8', emailCount: 64, linkedinCount: 38, weekStart: '2026-02-17' },
    { userId, label: 'S9', emailCount: 72, linkedinCount: 42, weekStart: '2026-02-24' },
    { userId, label: 'S10', emailCount: 85, linkedinCount: 47, weekStart: '2026-03-03' },
    { userId, label: 'S11', emailCount: 78, linkedinCount: 50, weekStart: '2026-03-10' },
  ];

  for (const c of chartPoints) await db.chartData.create(c);
  console.log(`  ${chartPoints.length} chart data points`);

  // ═══════════════════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════════════════

  const counts = {};
  const countTables = ['users', 'campaigns', 'touchpoints', 'diagnostics', 'versions', 'memory_patterns', 'opportunities', 'reports', 'chart_data', 'projects'];
  for (const table of countTables) {
    const r = await db.query(`SELECT COUNT(*) as c FROM ${table}`);
    counts[table] = r.rows[0].c;
  }

  console.log('\n  ════════════════════════════════════════');
  console.log('  Seed complete!');
  for (const [table, count] of Object.entries(counts)) {
    console.log(`    ${table}: ${count}`);
  }
  console.log('  ════════════════════════════════════════');
  console.log('\n  Login: demo@bakal.fr / Demo2026!\n');

  process.exit(0);
}

main().catch(err => {
  console.error('Seed error:', err);
  process.exit(1);
});
