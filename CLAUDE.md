# CLAUDE.md · Baakalai

> Context file for AI assistants working on this codebase. Keep concise, use Grep/Glob for file discovery.

## 1. What is Baakalai

baakalai is the AI system that exploits your CRM to generate revenue. It connects to existing CRMs (Pipedrive, HubSpot, Salesforce, Odoo, Notion, Airtable, Folk) and reads data 24/7 : spotting stagnant deals to reactivate, clients ready to upsell, accounts about to churn. It sends the right follow-up, at the right time, from the user's own email. 12 AI agents build a collective memory that compounds.

**Naming rule:** baakalai is *a system* (singular, the product identity), made of *12 agents* (plural, the architecture). Never call the product "the agent" : the singular contradicts the multi-agent architecture we sell, and "system" is only credible because the 12 agents are real. Category anchor is **RevOps** (a function nobody owns), never "revenue intelligence" (the category Gong defined and owns). Never claim baakalai *is* a RevOps platform : no consolidated forecasting, territories, comp or CPQ. Always "the job a RevOps would do".

**3 pillars:** CRM Intelligence > Automatisation (ex-« Activation », renommée 2026-09-14) > Prospection (prospection = door, not the product).

**Pricing:** 79 €/siège/mois, produit complet (décision Goran 2026-09-03, prix relevé de 69 à 79 le 2026-09-21 ; remplace l'ancienne grille 49/149/349). Annuel : 2 mois offerts. Founding members beta : −50 % à la sortie publique. **Aucun plafond de sièges** (arbitrage Goran 2026-09-21) : un seul price × quantité de sièges, le produit doit tenir 20 personnes et plus. Le plafond est levé par la **migration 107** (`teams.max_members` : NULL = aucun plafond). ⚠️ Attention à ne pas confondre deux mécanismes : `teams.max_members` **était réellement appliqué** par `db.teams.addMember` et bloquait le 6e membre en production, tandis que `ENTITLEMENTS.teamMembers` (`lib/billing.js`) et `requirePlan()` (`middleware/plan-gate.js`) sont déclarés mais **lus par personne**. Dettes ouvertes : (1) le socle Stripe (migration 078) est construit pour 3 tiers à 49/149/349 et envoie `quantity: 1` (`routes/billing.js`), à refondre en price unique × quantité ; (2) les entitlements morts sont à supprimer en même temps que cette refonte, pas avant (sinon code à moitié branché). Prix affiché publiquement sur la landing (`landing/i18n.js`, `index.html`, `diagnostic.html`).

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
3. **Pattern writes**: `replaceOrCreate()` uses a table-based lease (`lib/db-lock.js`, `cron_locks` table) for mutual exclusion. NEVER use `pg_advisory_lock` : DATABASE_URL goes through Supavisor in transaction mode, where advisory locks leak and block forever. All pattern writes are anonymized in the DAO (`lib/anonymize.js`); `shared` is granted automatically when redaction is complete.
4. **Email dedup**: Before inserting nurture emails, always check for existing pending/recent emails for the same contact (2-hour + 7-day windows).
5. **Environments**: Never share credentials between prod and staging. Never point staging `APP_URL` to production.
6. **Pré-push**: ALWAYS run `node scripts/check-conflicts.js` before any `git push`. It blocks on remote desync (someone pushed meanwhile) and warns on merge conflicts against `main`. Report the conflicting files to Goran instead of pushing blind : never resolve a conflict against `main` without asking him first, the arbitrations are product decisions. Two automatic reminders back this up: `.claude/hooks/session-start.sh` prints the conflict state at every session start (`--report`, non-blocking), and `.githooks/pre-push` runs the blocking check (enable once per clone via `bash scripts/install-hooks.sh`).
7. **Pré-modif (pull)**: ALWAYS `git fetch origin <branche> && git pull origin <branche>` BEFORE starting any modification : never edit files on a stale checkout. Goran works from several machines and sessions; a branch left untouched for a few hours is routinely dozens of commits behind. If the pull brings in changes touching the files about to be modified, re-read them before editing.
8. **Style (décision Goran 2026-09-15, portée élargie le 2026-09-16)**: **aucun tiret cadratin (U+2014) ni demi-cadratin (U+2013) nulle part dans baakalai** : landing, app, backend, emails, commentaires de code. Purge faite le 2026-09-16 (204 sur la landing, 519 dans `frontend/src`, 920 dans le backend, 179 dans les traductions). Le repo est à zéro, ne pas en réintroduire. Remplacer selon le sens, jamais par un `sed` aveugle : deux-points pour « libellé : explication », virgule pour un complément, parenthèses pour une incise encadrée par deux tirets, « à » pour une fourchette chiffrée, « : » pour un séparateur de titre. **Typographie française : espace AVANT les deux-points** (« Réactivation : repère »), pas en anglais (« Reactivation: spots »). Dans un fichier où FR et EN cohabitent sur la même ligne (JSX), préférer la virgule pour ne pas avoir à trancher. En complément, tout texte lu par un contact ne doit contenir aucune tournure reconnaissable d'IA (« J'espère que vous allez bien », « Je me permets de », « N'hésitez pas à », triades, « Ce n'est pas X, c'est Y »…). Double verrou obligatoire via `lib/human-style.js` : concaténer `HUMAN_STYLE_RULES` (ou `_FR`) dans tout nouveau prompt de génération de contenu contact, et laisser les chokepoints `humanize()` en place (email-outbound.sendPersonalEmail, api/linkedin send*, DAO touchpoints). Ne jamais appliquer `humanize()` au contenu écrit par l'utilisateur (signatures, messages manuels).
9. **Jamais de push inachevé**: NEVER push while a modification, a feature or a fix is incomplete : half-wired code, missing i18n keys, an untested migration, a TODO left in the flow. This holds even if Goran explicitly asks to push: answer no, list precisely what is left to finish, and push only once it is done (or once he confirms in a second message that he wants the partial state pushed anyway). Committing locally on an in-progress state is fine; pushing is not : `staging` auto-deploys.

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
- `db.memoryPatterns.replaceOrCreate()` : atomic upsert with advisory lock + pgvector semantic dedup
- Delta sync : only sync what changed since last run
- Owner resolver : unified CRM owner → team member mapping (`lib/crm-owner-resolver.js`)
- CRM field mapper : map CRM custom fields to product lines/status (`lib/crm-field-mapper.js`)

### Database (key tables)

`users` (+ `active_crm_provider`), `teams`, `team_members`, `opportunities` (contacts with CRM link + churn_score + owner), `memory_patterns` (cross-campaign learnings), `nurture_triggers`, `nurture_emails`, `user_integrations` (encrypted keys), `product_lines`, `agent_chain_executions`

## 5. Environments

| Env | URL | DB (Supabase) | Branch |
|-----|-----|---------------|--------|
| **Production** | app.baakal.ai | `wbxmdchrsceaibhjtwxl` | main |
| **Staging** | baakal-staging.up.railway.app | `eomzkghixlgtnadsgfuc` | staging |

- Railway auto-deploys: `main` → production, `staging` → staging (same service, two environments)
- Workflow (depuis 2026-09-02): push sur `staging` d'abord → validation Goran → push sur `main`
- Avant chaque push: `node scripts/check-conflicts.js` (désynchro distante + conflits de fusion vers `main`)
- Staging has `ORCHESTRATOR_ENABLED=false` (no agent crons)
- Never share `DATABASE_URL`, `JWT_SECRET`, or `ENCRYPTION_SECRET` between envs

## 6. Current Gaps

- [x] Stripe billing + paywall : socle livré (routes /api/billing, webhook, migration 078, section Réglages, paywall d'essai expiré). Inerte tant que STRIPE_SECRET_KEY + price IDs ne sont pas posés sur Railway ; comptes existants exemptés (trial_ends_at NULL).
- [ ] **Import CRM : date de création et owner jamais persistés** (constaté 2026-09-21 sur les 443 opportunités de prod). `opportunities.created_at` est la date d'insertion chez nous ; la vraie date CRM (`add_time` Pipedrive, `createdate` HubSpot, `CreatedDate` Salesforce) est bien récupérée par la couche `api/` puis jetée faute de colonne. `owner_email` et `crm_owner_id` sont NULL sur 100 % des lignes alors que `db.opportunities.create` les accepte : les 9 points d'appel (6 dans `routes/crm.js`, un par provider, plus `crm-agent.js` et `crm-sync.js`) ne les passent pas. Conséquence : 2 des 3 critères ICP déductibles restent NULL, et le rapprochement owner → membre d'équipe ne peut pas fonctionner. Correctif : colonne `crm_created_at` + mapping par provider.
- [ ] Microsoft OAuth publisher verification (beta testers can't consent Outlook)
- [ ] Salesforce campaigns (contacts + deals done, missing campaigns)
- [ ] A/B testing on activation emails (only prospection currently)
- [ ] Membership analytics (tenure, LTV by segment, renewal rates)
- [ ] Bug: `t is not defined` occasionally on navigation (need to reproduce)

## 7. Business Context

- **ICP** (élargi 2026-09-02, révisé 2026-09-21): PME B2B 5-200 pers, ≥12 mois historique CRM, base clients existante, **pas de RevOps à temps plein**. L'effectif est un proxy : qualifier sur ces 3 critères.
  - Le plafond « ≤5 personnes sur le CRM » est **supprimé** : le produit doit tenir 20 sièges et plus (arbitrage Goran 2026-09-21). Côté code, il était bien appliqué via `teams.max_members` ; la migration 107 le lève.
  - Le RevOps est un **signal, plus un disqualifiant** : l'absence d'un RevOps dédié reste un bon indicateur de douleur, mais quelqu'un qui porte la casquette en plus de son métier est l'acheteur, pas un faux positif. Ne disqualifier que les boîtes déjà outillées (Gong, Clari), où le wedge ne prend pas.
  - **Qualification instrumentée depuis le 2026-09-21** (migration 106) : `user_profiles.job_role` demandé à l'onboarding, colonnes `icp_*` calculées par `lib/icp-signals.js` après chaque import CRM. NULL y signifie « inconnu », jamais « zéro » : `icp_crm_history_months` et `icp_crm_seat_count` restent NULL tant que les importeurs ne persistent pas la date de création CRM et l'owner du deal (cf. §6).
- **Wedge**: Revenue intelligence for SMBs : structurally inaccessible to Gong/Clari
- **Hero job**: Deal reactivation ("1 deal recovered = tool paid for itself")
- **4 jobs**: Reactivation > Upsell > Churn > Data cleaning
- **Competitors**: Attio ($29-69/seat, no outbound), Lemlist/Apollo (outreach only, no CRM intelligence)
- **Owner**: Goran Nikcevic
