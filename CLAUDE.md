# CLAUDE.md — Baakalai Project Briefing

> **Purpose:** This document provides full context for any AI assistant (Claude Code, Claude Chat, Cowork, etc.) to work on Baakalai. Read this first before any task.

---

## 1. What is Baakalai

baakalai orchestre votre prospection et votre relation client avec l'IA. Il génère des séquences personnalisées, les déploie sur vos outils existants, et gère vos clients dans votre CRM — détection des deals stagnants, relance des contacts inactifs, upsell au bon moment. Chaque email envoyé, chaque réponse analysée, chaque deal conclu nourrit une mémoire collective qui apprend quel angle fonctionne, quel timing convertit, et quelle approche décroche un rendez-vous.

- **Prospection** : Create campaigns via AI chat, generate sequences (email + LinkedIn), deploy to Lemlist/Apollo, A/B test, refine automatically
- **Activation (CRM)** : Import contacts from Pipedrive/HubSpot/Odoo, detect stagnant deals/churn risk, send personalized follow-up emails via user's own SMTP, analyze responses
- **Intelligence** : 4 autonomous AI agents (Prospection, CRM, Memory, Reporting) + 9 pattern sources that learn from every campaign and every CRM interaction

Pricing: $75/user/month. Team plan: up to 5 members with roles (admin, prospection, activation, viewer).

## 2. Tech Stack

- **Frontend** : React 19 + Vite 7 + React Router 7
- **Backend** : Node.js + Express + PostgreSQL (Supabase)
- **AI** : Claude API (Anthropic) with hybrid Sonnet/Opus routing + prompt caching
- **Deployment** : Railway (auto-deploy main → app.baakal.ai), Cloudflare Pages (auto-deploy landing/* → baakal.ai)
- **Email** : Resend (system emails), nodemailer/SMTP+OAuth (user emails for activation)
- **Security** : Helmet, DOMPurify, bcrypt 12, AES-256-GCM, JWT code exchange
- **Fonts** : Geist + Geist Mono (brand v6)
- **Theme** : Light-first, purple/lavender accents (#6E57FA primary)

## 3. Integrations

| Tool | Type | Status | What it does |
|------|------|--------|-------------|
| Lemlist | Outreach | Production | Campaign deployment, stats sync (v2 API), activities, conditional sequences |
| Apollo | Outreach + Enrichment | Production | Prospect search (200/request), contact enrichment, campaign stats |
| Smartlead | Outreach | Production | Campaign deployment, sequences, leads, analytics, replies |
| Pipedrive | CRM | Production | Full bidirectional sync + real-time webhooks, upsert contacts, deals, pipelines, stages, activities, notes, owner mapping |
| HubSpot | CRM | Production | Contact/deal sync, push scores, owner mapping, field mapping |
| Salesforce | CRM | Production | Contact/deal sync via REST, owner mapping, field mapping |
| Odoo | CRM + ERP | Production | JSON-RPC client. Contacts, deals, stages, invoices, activities, notes, owner mapping |
| Notion | CRM + Docs | Production | Contact sync, database discovery |
| Airtable | CRM | Production | Contact sync with batch of 10 |
| Brave Search | Web search | Production | Web prospect agent (5 queries/company) |
| Resend | Email (system) | Production | Verification, password reset, weekly reports |
| Gmail OAuth | Email (activation) | Production | 1-click connect, auto token refresh, emails sent from user's Gmail |
| Microsoft OAuth | Email (activation) | Ready | Needs Azure app registration, code is ready |
| SMTP (user) | Email (activation) | Production | Personal emails via Gmail/Outlook/OVH for nurture campaigns |

## 4. Key Features

### Prospection
- Chat-driven campaign creation with Claude AI
- 5 pre-built campaign templates (SaaS B2B, Prise de RDV, Relance clients, Recrutement, Partenariat)
- Multi-channel sequences (email + LinkedIn) with conditional branching
- Lemlist deployment with A/B testing and batch mode
- Prospect search via Lemlist database (200/request) or Apollo
- Web search agent for deep company research
- Replies tab with auto-sync from Lemlist + Apollo

### Activation (CRM)
- Import contacts from any connected CRM (Pipedrive, Odoo, HubSpot)
- Client detail panel with timeline (emails + CRM activities + invoices for Odoo)
- 8 pre-built trigger types: deal_won, deal_stagnant, inactive_contact, deal_lost, onboarding_check, renewal_reminder, upsell_opportunity, feedback_request
- Preview mode before sending (see who gets emailed + sample email)
- Response analysis agent (sentiment + intent detection via Claude)
- Trigger effectiveness scoring over time
- Data cleaning agent: duplicates, missing fields, invalid emails, inactive contacts, format issues (score /100)

### Intelligence (11 AI Agents)

**Operational (scheduled):**
1. **Prospection Agent** (daily 8AM): stats collection + batch A/B + deliverability checks
2. **CRM Agent** (daily 9AM): delta sync + data quality + nurture + response analysis + churn scoring + owner sync
3. **Memory Agent** (Sunday 10AM): consolidation + pruning + template generation + strategic agents
4. **Reporting Agent** (Monday 9AM): anomaly detection + weekly report (only to active users)

**Strategic (Sunday + on-demand via POST /api/strategic/run/:agent):**
5. **Competitor Watch**: competitive landscape, positioning angles, evaluation triggers
6. **Timing Agent**: best day/hour, optimal follow-up delay from response data
7. **Deal Coach**: AI-suggested next action for each stagnant deal
8. **Upsell Detector**: cross-sell/upsell scoring for won clients
9. **Win/Loss Analyst**: discriminating patterns between won and lost deals
10. **Copy Optimizer**: email length, subject lines, tone analysis from response data
11. **ICP Refiner**: ideal customer profile refinement from actual conversion data

**Template Agent** (Sunday): generates sector-specific templates from memory patterns + campaign stats. 15 sectors covered.

All strategic agents use `db.memoryPatterns.replaceOrCreate()` to prevent pattern explosion.

### Team Mode
- Teams table with invite codes (max 5 members). Auto-created for solo users on first product line
- Roles: admin (full access), prospection, activation, viewer (read-only)
- Role-based UI: non-admins see simplified sidebar (Chat, Dashboard, Clients, Nurture, Profile only)
- Non-admins only see contacts they own (filtered server-side)
- Shared CRM keys at team level
- Team campaigns: admin creates, each rep sends from their own inbox
- Join page: /join/:code

### Multi-product / Product Lines
- Product lines (verticals) in Profile page with tabbed UI
- Each project: name, icon, description, target sectors, value prop, pain points
- Contacts can be assigned to product lines (many-to-many)
- CRM field mapping: map Pipedrive/HubSpot/Salesforce custom fields → product lines
- Team campaigns can target specific product lines

### Churn Prediction
- Score 0-100 per contact, 5 weighted signals: inactivity, deal stagnation, email engagement, profile completeness, status
- Integrated into CRM Agent daily run
- ClientsPage: summary cards (Critical/High/Medium/Low), risk filter tab, factor breakdown

### Account Ownership
- CRM owner → Baakalai team member mapping (matched by email)
- Unified resolver for Pipedrive, HubSpot, Salesforce, Odoo
- Owner synced during CRM Agent delta sync
- Pipedrive webhooks for real-time owner/contact/deal updates

## 5. Database Schema (key tables)

```
users, teams, team_members
campaigns, touchpoints, diagnostics, versions
opportunities (contacts/clients with CRM link + owner_id + churn_score + churn_factors)
prospect_activities (Lemlist/Apollo reply/open/click data)
memory_patterns (cross-campaign learnings, replaceOrCreate for dedup)
nurture_triggers (activation rules)
nurture_emails (sent/pending/cancelled activation emails + team_campaign_id)
email_accounts (SMTP/OAuth credentials per team)
crm_cleaning_reports (data quality scan results)
crm_field_mappings (CRM field → Baakalai concept mapping)
user_integrations (encrypted API keys per user/team)
product_lines (verticals per team)
opportunity_product_lines (many-to-many contact ↔ product line)
team_campaigns (admin-launched campaigns for sales team)
chat_threads, chat_messages
notifications, templates, reports
```

## 6. Key Backend Files

```
backend/
  api/
    lemlist.js      — Lemlist API (v2 stats, activities, conditional sequences, search)
    apollo.js       — Apollo API (campaigns, contacts, activities, enrichment)
    smartlead.js    — Smartlead API (campaigns, sequences, leads, analytics, replies)
    pipedrive.js    — Pipedrive API (persons, deals, pipelines, stages, activities, notes, upsert, users)
    odoo.js         — Odoo JSON-RPC (contacts, deals, invoices, stages, activities)
    claude.js       — Claude API with CHAT_SYSTEM_RULES (all chat actions defined here)
    hubspot.js      — HubSpot API
    salesforce.js   — Salesforce API
  lib/
    crm-agent.js           — Unified CRM agent (sync + quality + nurture + response analysis + churn + owner)
    prospection-agent.js   — Wraps collect-stats + batch-orchestrator + deliverability
    memory-agent.js        — Wraps consolidate + pruning + templates + strategic agents
    reporting-agent.js     — Wraps weekly-report + anomaly detection
    response-analysis-agent.js — Analyzes CRM replies, scores triggers, creates memory patterns
    churn-scoring.js       — Churn prediction scoring engine (0-100, 5 signals)
    email-outbound.js      — SMTP/OAuth email sending + auto token refresh + Pipedrive note logging
    nurture-engine.js      — Trigger evaluation + Claude email generation
    crm-owner-resolver.js  — Unified owner mapping for all CRM providers
    crm-field-mapper.js    — CRM field mapping (Pipedrive/HubSpot/Salesforce → product lines/status)
    crm-cleaning-agent.js  — Data quality scan with provider adapters
    crm-bidirectional-sync.js — Pipedrive <> Baakalai sync
    template-agent.js      — Sector template generation from memory patterns + stats
    outreach-deploy.js     — Deploy campaigns to Apollo/Smartlead/Instantly (text→HTML conversion)
    agents/
      strategic-orchestrator.js — Coordinates all 7 strategic agents
      competitor-watch.js   — Competitive landscape analysis
      timing-agent.js       — Optimal send windows from response data
      deal-coach.js         — AI-powered next best action for stagnant deals
      upsell-detector.js    — Cross-sell/upsell opportunity scoring
      win-loss-analyst.js   — Won vs lost deal pattern analysis
      copy-optimizer.js     — Email copy effectiveness analysis
      icp-refiner.js        — ICP refinement from conversion data
  routes/
    chat.js       — Chat with Claude + CRM actions from chat
    campaigns.js  — Campaign CRUD + launch to Lemlist
    crm.js        — CRM sync, import, clean, client detail, pipelines, product lines, field mapping
    nurture.js    — Triggers CRUD, email accounts (SMTP+OAuth), preview, send
    team-campaigns.js — Admin-launched team email campaigns
    strategic.js  — Strategic agent API (run-all, run/:agent, list)
    webhooks.js   — Pipedrive real-time webhooks (public, secret-validated)
    stats.js      — Lemlist/Apollo stats sync, activities
    teams.js      — Team create, join, members, roles
    dashboard.js  — KPIs, activation metrics, refresh stats
    templates.js  — Template CRUD + on-demand generation
  orchestrator/
    index.js      — 4-agent scheduler (Prospection 8AM, CRM 9AM, Memory Sun, Reporting Mon)
```

## 7. Key Frontend Files

```
frontend/src/
  pages/
    ChatPage.jsx            — Chat with Claude, campaign templates, CRM action cards
    DashboardPage.jsx       — KPIs, deliverability, ICP insights, weekly report link
    CampaignsList.jsx       — Campaign list with filters, archive, delete
    ClientsPage.jsx         — Client import, pipeline stages, detail panel, churn scores, owner filter, product line tags
    NurturePage.jsx         — Activation: dashboard, campaigns, triggers, pending/sent, preview, team campaigns
    ProfilePage.jsx         — Company profile with tabbed product lines (name, value prop, pain points, docs)
    CRMAnalyticsPage.jsx    — Pipeline, attribution, scoring, health (live data cleaning)
    SettingsPage.jsx        — API keys with guides, email accounts, team management, Odoo form
    MemoryExplorerPage.jsx  — AI memory patterns with apply/delete/export
  components/
    Layout.jsx              — Sidebar nav with mark logo
    OnboardingWizard.jsx    — 3-step wizard (company+target, API keys with guides, confirmation)
    EmailAccountSettings.jsx — SMTP config + OAuth Gmail/Microsoft 1-click connect
    TeamSettings.jsx        — Team creation, invite link, member roles
    ProductLinesSettings.jsx — Product lines CRUD (also in SettingsPage)
    FieldMappingSettings.jsx — CRM field → Baakalai concept mapping UI
    DeliverabilityCard.jsx  — Health score + refresh stats
    ICPInsightsCard.jsx     — ICP analysis card
```

## 8. Chat Actions (claude.js CHAT_SYSTEM_RULES)

Claude can propose these structured actions in the chat (JSON blocks):

| Action | What it does |
|--------|-------------|
| create_campaign | Create campaign with full sequence |
| search_prospects | Search via Lemlist/Apollo (limit 200) |
| web_search_prospects | Deep web search for specific companies |
| add_prospects_manual | Parse pasted contact list |
| send_email | Send personal email to a contact |
| scan_crm | Trigger CRM health scan |
| run_nurture | Execute activation triggers |
| import_crm | Import contacts from CRM |
| list_clients | Show filtered client list |

## 9. Brand Identity (v6)

- Name: **baakalai** (lowercase, no dot, no ".ai")
- Domain: baakal.ai (landing, Cloudflare Pages) / app.baakal.ai (platform, Railway)
- Font: Geist (sans) + Geist Mono
- Colors: paper #FAFAF9, ink #0A0A0A, primary #6E57FA, lavender #C4B5FD
- Mark: rounded square with purple + lavender bars
- Verb: "refine" (not "optimize")
- Tone: direct, product-first, specific over vague

## 10. Current State & Known Gaps

### Working in production
- Full prospection flow (chat > campaign > sequences > Lemlist deploy > stats > A/B)
- CRM Pipedrive full integration (import, sync, cleaning, activation, response analysis)
- Odoo integration (contacts, deals, invoices, stages)
- Team mode (create, invite, roles)
- Activation page with triggers, preview, campaigns view
- Brand v6 (light theme, Geist font, purple accents)
- 4 autonomous agents replacing 7 crons
- Chat actions for CRM operations

### Completed (April-May 2026)
- [x] Memory patterns injected into nurture email generation
- [x] i18n FR/EN on all main pages
- [x] 9 pattern sources (was 4)
- [x] Pipedrive webhooks (real-time sync)
- [x] OAuth Gmail (1-click connect)
- [x] Churn prediction scoring (0-100)
- [x] Account ownership + multi-CRM owner resolver
- [x] Product lines / multi-product support
- [x] Team campaigns (admin → reps)
- [x] Role-based UI for sales reps
- [x] CRM field mapping (Pipedrive/HubSpot/Salesforce)
- [x] Smartlead integration
- [x] 7 strategic AI agents
- [x] Template generation agent (15 sectors)
- [x] Security audit (20/20 fixed) + DOMPurify + Helmet
- [x] Domain split (baakal.ai landing / app.baakal.ai platform)
- [x] Text→HTML conversion for all outreach tools

### Remaining gaps
- [ ] Microsoft OAuth (Azure app registration needed)
- [ ] Stripe payment integration
- [ ] Landing page Lightfield-style redesign
- [ ] Membership analytics: tenure, LTV by segment, renewal rates
- [ ] Salesforce full integration (contacts + deals done, missing campaigns)
- [ ] Renewal trigger needs custom field mapping
- [ ] A/B testing on activation emails (only on prospection currently)
- [ ] Bug: `t is not defined` occasionally when navigating (need to reproduce)

## 11. Business Context

- **Vision**: Full customer lifecycle hub — outreach + CRM + analytics (Amplitude/GA) + billing (Stripe/Odoo) all connected, AI analyzes everything and triggers the right action
- **ICP**: SMB services B2B (10-400 employees) + membership organizations. Sectors: crypto, telecom, cybersecurity, agencies, biotech, health, freelance
- **Pricing**: $75/user/month (team plan up to 5 members)
- **Competitors**: SalesCaptain (~EUR30k/4 months agency), GTM Studio (~EUR140k/7 months agency), Lemlist/Apollo (tools only, no AI orchestration)
- **Key differentiator**: AI that learns from every campaign + prospection AND activation in one tool
- **Target onboarding time**: <30 minutes to first campaign (currently ~25-35 min)
- **Owner**: Goran Nikcevic (goran@oenobiote.com)

## 12. Code Conventions

- Backend: CommonJS (require/module.exports), Express routes, PostgreSQL via raw queries
- Frontend: ES Modules (import/export), React functional components, inline styles (no CSS-in-JS lib)
- i18n: fr.json + en.json with useT() hook
- **RULE: NEVER hardcode French text in JSX.** Always use t('key') from useT(). When adding ANY user-facing string, add the key to BOTH fr.json AND en.json in the same commit. No exceptions.
- DB migrations: numbered SQL files in backend/db/migrations/
- Env vars: ORCHESTRATOR_ENABLED, PGVECTOR_ENABLED for feature flags
- API keys: encrypted in user_integrations table via config/crypto.js
- Git: main branch, Railway auto-deploys on push
