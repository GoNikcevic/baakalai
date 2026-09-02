# CLAUDE.md — Baakalai

> Context file for AI assistants working on this codebase. Keep concise — use Grep/Glob for file discovery.

## 1. What is Baakalai

baakalai is the AI system that exploits your CRM to generate revenue. It connects to existing CRMs (Pipedrive, HubSpot, Salesforce, Odoo, Notion, Airtable, Folk) and reads data 24/7 — spotting stagnant deals to reactivate, clients ready to upsell, accounts about to churn. It sends the right follow-up, at the right time, from the user's own email. 12 AI agents build a collective memory that compounds.

**Naming rule:** baakalai is *a system* (singular, the product identity), made of *12 agents* (plural, the architecture). Never call the product "the agent" — the singular contradicts the multi-agent architecture we sell, and "system" is only credible because the 12 agents are real. Category anchor is **RevOps** (a function nobody owns), never "revenue intelligence" (the category Gong defined and owns). Never claim baakalai *is* a RevOps platform — no consolidated forecasting, territories, comp or CPQ. Always "the job a RevOps would do".

**3 pillars:** CRM Intelligence > Activation > Prospection (prospection = door, not the product).

**Pricing:** Starter 49€/mo, Growth 149€/mo, Scale 349€/mo. Team plan up to 5 members.

## 2. Tech Stack

- **Frontend**: React 19 + Vite 7 + React Router 7 (inline styles, no CSS-in-JS)
- **Backend**: Node.js + Express + PostgreSQL (Supabase, pgvector enabled)
- **AI**: Claude API with hybrid Sonnet/Opus routing + prompt caching
- **Deployment**: Railway auto-deploy main → app.baakal.ai
- **Landing**: Cloudflare Pages auto-deploy → baakal.ai
- **Email**: Resend (system), nodemailer/SMTP+OAuth (user activation emails)
- **Security**: Helmet, DOMPurify, bcrypt 12, AES-256-GCM, JWT
- **Theme**: Light-first, Geist font, primary #6E57FA, paper #FAFAF9

## 3. Code Conventions & Rules

- Backend: CommonJS (`require`/`module.exports`), Express routes, raw SQL queries
- Frontend: ES Modules, React functional components, inline styles
- DB migrations: numbered SQL files in `backend/db/migrations/`
- API keys: encrypted in `user_integrations` via `config/crypto.js`
- Git: `main` branch, Railway auto-deploys on push

### Mandatory Rules

1. **i18n**: NEVER hardcode French text in JSX. Always use `t('key')` from `useI18n()`. Add keys to BOTH `fr.json` AND `en.json` in the same commit.
2. **Active CRM**: Always use `users.active_crm_provider` to determine which CRM to sync/display. Never hardcode provider priority order.
3. **Pattern writes**: `replaceOrCreate()` uses a table-based lease (`lib/db-lock.js`, `cron_locks` table) for mutual exclusion. NEVER use `pg_advisory_lock` — DATABASE_URL goes through Supavisor in transaction mode, where advisory locks leak and block forever. All pattern writes are anonymized in the DAO (`lib/anonymize.js`); `shared` is granted automatically when redaction is complete.
4. **Email dedup**: Before inserting nurture emails, always check for existing pending/recent emails for the same contact (2-hour + 7-day windows).
5. **Environments**: Never share credentials between prod and staging. Never point staging `APP_URL` to production.

## 4. Architecture

### Agent System (4 operational + 7 strategic + 2 specialized)

| Agent | Schedule | What it does |
|-------|----------|-------------|
| Prospection | 8AM + 8PM | Stats, batch A/B, deliverability |
| CRM | 9AM | Delta sync, data quality, nurture, response analysis, churn scoring |
| Strategic (fast) | 9:30AM | Deal Coach, Upsell Detector, Copy Optimizer (per user) |
| Agent Chains | 9:45AM | Deal Reactivation + Auto-Upsell autonomous chains |
| Memory | Sunday 10AM | Consolidation, pruning, templates, heavy strategic agents |
| Reporting | Monday 9AM | Anomaly detection, weekly report |

**Key patterns:**
- `db.memoryPatterns.replaceOrCreate()` — atomic upsert with advisory lock + pgvector semantic dedup
- Delta sync — only sync what changed since last run
- Owner resolver — unified CRM owner → team member mapping (`lib/crm-owner-resolver.js`)
- CRM field mapper — map CRM custom fields to product lines/status (`lib/crm-field-mapper.js`)

### Database (key tables)

`users` (+ `active_crm_provider`), `teams`, `team_members`, `opportunities` (contacts with CRM link + churn_score + owner), `memory_patterns` (cross-campaign learnings), `nurture_triggers`, `nurture_emails`, `user_integrations` (encrypted keys), `product_lines`, `agent_chain_executions`

## 5. Environments

| Env | URL | DB (Supabase) | Branch |
|-----|-----|---------------|--------|
| **Production** | app.baakal.ai | `wbxmdchrsceaibhjtwxl` | main |
| **Staging** | baakal-staging.up.railway.app | `eomzkghixlgtnadsgfuc` | staging |

- Railway auto-deploys: `main` → production, `staging` → staging (same service, two environments)
- Workflow (depuis 2026-09-02): push sur `staging` d'abord → validation Goran → push sur `main`
- Staging has `ORCHESTRATOR_ENABLED=false` (no agent crons)
- Never share `DATABASE_URL`, `JWT_SECRET`, or `ENCRYPTION_SECRET` between envs

## 6. Current Gaps

- [x] Stripe billing + paywall — socle livré (routes /api/billing, webhook, migration 078, section Réglages, paywall d'essai expiré). Inerte tant que STRIPE_SECRET_KEY + price IDs ne sont pas posés sur Railway ; comptes existants exemptés (trial_ends_at NULL).
- [ ] Microsoft OAuth publisher verification (beta testers can't consent Outlook)
- [ ] Salesforce campaigns (contacts + deals done, missing campaigns)
- [ ] A/B testing on activation emails (only prospection currently)
- [ ] Membership analytics (tenure, LTV by segment, renewal rates)
- [ ] Bug: `t is not defined` occasionally on navigation (need to reproduce)

## 7. Business Context

- **ICP**: PME B2B 5-50 pers, ≥12 mois historique CRM, pas de RevOps
- **Wedge**: Revenue intelligence for SMBs — structurally inaccessible to Gong/Clari
- **Hero job**: Deal reactivation ("1 deal recovered = tool paid for itself")
- **4 jobs**: Reactivation > Upsell > Churn > Data cleaning
- **Competitors**: Attio ($29-69/seat, no outbound), Lemlist/Apollo (outreach only, no CRM intelligence)
- **Owner**: Goran Nikcevic
