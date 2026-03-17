# CLAUDE.md — Bakal Project Briefing

> **Purpose:** This document provides full context for Claude Code to work on the Bakal project. Read this first before any task.

---

## 🎯 Project Overview

**Bakal** is a B2B prospecting automation platform that acts as an **API aggregator and AI orchestrator**:
- Centralizes and orchestrates existing tools (Lemlist, N8N, Claude) via their APIs
- AI-generated personalized copy
- Automated performance optimization through a cross-campaign learning loop

**Positioning:** Bakal is NOT a SaaS and NOT an agency — it's an **intelligent orchestration layer** that connects prospecting tools and adds AI-powered optimization on top. The value is in the orchestration and intelligence, not in building yet another tool.

**Pricing:** Entry point at **~€25/month** — accessible SMB volume play, not premium agency pricing.

**Target Market:** SMB owners/directors who need leads but lack time/expertise to prospect

---

## 👥 Team Context

- 2-3 co-founders, no formal company structure yet (planned within 1 year)
- Payments via individual billing + retrocession between partners
- Primary developer: Goran

---

## 🏗️ Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                           BAKAL SYSTEM                               │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐           │
│  │   LEMLIST    │───▶│     N8N      │───▶│   CLAUDE     │           │
│  │  (Campaigns) │    │  (Workflows) │    │   (AI/Copy)  │           │
│  └──────────────┘    └──────────────┘    └──────────────┘           │
│         │                   │                   │                    │
│         │                   ▼                   │                    │
│         │            ┌──────────────┐           │                    │
│         └───────────▶│  POSTGRESQL  │◀──────────┘                    │
│                      │  (Database)  │  ← Source de vérité            │
│                      └──────┬───────┘                                │
│                      ┌──────┴───────┐                                │
│                      ▼              ▼                                 │
│               ┌──────────┐   ┌──────────────┐                       │
│               │DASHBOARD │   │    NOTION    │                        │
│               │  BAKAL   │   │  (interne)   │                        │
│               └──────────┘   └──────────────┘                        │
│                Client         Équipe Bakal                           │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 🔧 Tech Stack

| Component | Tool | Purpose |
|-----------|------|---------|
| Email/LinkedIn Automation | **Lemlist** | Campaign execution, sequence management, stats collection |
| Workflow Automation | **N8N** | Orchestration between tools, scheduled jobs, API calls |
| AI Generation | **Claude API** | Copy generation, performance analysis, optimization |
| Database | **PostgreSQL** (Supabase or Neon) | Source of truth — campaigns, stats, memory, diagnostics |
| Client Dashboard | **Bakal Dashboard** | Client-facing dashboard — campaigns, stats, copy, optimization history, retention UX (progress bias, etc.) |
| Internal Ops | **Notion** (internal only) | Team-only — operational tracking, client notes, processes |
| Landing Page | **Static HTML** | Client-facing marketing site |

---

## 📁 Project File Structure

```
/landing/
  bakal-landing-page.html           # Landing page — dark theme
  bakal-landing-page-light.html     # Landing page — light theme
  bakal-prequalification.html       # Eligibility / prequalification form

/workflows/
  01-stats-collection.json          # N8N — Daily stats from Lemlist → PostgreSQL → Claude analysis
  02-regeneration-deployment.json   # N8N — Claude regeneration → Lemlist A/B deployment
  03-memory-consolidation.json      # N8N — Monthly cross-campaign pattern library
  README.md                         # Setup guide and configuration checklist

/docs/
  bakal-prompt-system.md            # Complete prompt architecture for copy generation
  bakal-refinement-system.md        # Auto-optimization loop (analysis → regeneration)

/CLAUDE.md                          # This file
/README.md                          # Project overview
```

---

## 📝 Prompt System Architecture

The copy generation system uses a **1 Master Prompt + 7 Sub-Prompts** architecture:

### Master Prompt
Generates complete multi-channel sequences based on client parameters:
- Style params: tone, formality (tu/vous), length, language
- Sequence params: touchpoints (4-8), channels, angle, CTA type, personalization level
- Client params: company info, target sector, decision-maker function, value prop, pain points, social proof

### Sub-Prompts (specialized)
1. **Email Initial** — First contact, hook-focused
2. **Email Value** — Follow-up with proof/case study
3. **Email Relance** — Different angle retry
4. **Email Break-up** — Final message, soft close
5. **LinkedIn Connection Note** — Max 300 chars, no pitch
6. **LinkedIn Message** — Post-connection, conversational
7. **Subject Lines** — A/B variants for all emails

### Lemlist Variables
These are preserved as-is in generated copy:
- `{{firstName}}`, `{{lastName}}`, `{{companyName}}`, `{{jobTitle}}`

---

## 🔄 Refinement System (Auto-Optimization Loop)

### The Loop
```
Lemlist (stats) → N8N → Claude (analyze) → Claude (regenerate) → N8N → Lemlist (deploy)
```

### Three Core Prompts

1. **Performance Analysis Prompt**
   - Input: Campaign stats (open rates, reply rates, acceptance rates)
   - Output: Structured diagnostic with priorities and regeneration instructions
   - Benchmarks: Open >50% good, Reply >5% good, LinkedIn accept >30% good

2. **Regeneration Prompt**
   - Input: Diagnostic + original messages + cross-campaign memory
   - Output: Optimized versions + A/B variants with clear hypotheses

3. **Cross-Campaign Memory Prompt**
   - Input: All diagnostics from period + existing memory
   - Output: Pattern library (what works by sector/target/message type)
   - Confidence levels: High (>200 prospects), Medium (50-200), Low (<50)

### N8N Workflows

**Workflow 1: Stats Collection (daily @ 8am)**
- Fetch active campaigns from Lemlist API
- Calculate per-touchpoint metrics
- Store in PostgreSQL `campaigns` + `touchpoints`
- Trigger analysis if campaign >50 prospects AND >7 days old

**Workflow 2: Regeneration + Deployment**
- Triggered by Workflow 1 when optimization needed
- Reads original messages + memory from PostgreSQL
- Calls Claude for regeneration
- Updates Lemlist sequences with A/B variants
- Stores new version in PostgreSQL `versions`

**Workflow 3: Memory Consolidation (monthly)**
- Aggregates all monthly diagnostics from PostgreSQL
- Updates `memory_patterns` table in PostgreSQL

---

## 📊 Database Structure (PostgreSQL / Supabase)

PostgreSQL (Supabase) is the **source of truth** for all campaign data. The client sees everything through the Bakal dashboard. Schema is deployed and live.

**Seed data:** `backend/db/seed-demo-data.sql` — run in Supabase SQL Editor to populate demo data.

### Table: users
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK, uuid_generate_v4() |
| email | TEXT | NOT NULL, unique |
| password_hash | TEXT | NOT NULL, bcrypt |
| name | TEXT | NOT NULL |
| company | TEXT | |
| role | TEXT | default 'client' |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

### Table: user_profiles
| Column | Type | Notes |
|--------|------|-------|
| user_id | UUID | PK, FK → users |
| company, sector, website, team_size | TEXT | Company info |
| description, value_prop, social_proof | TEXT | Positioning |
| pain_points, objections | TEXT | Sales context |
| persona_primary, persona_secondary | TEXT | Target personas |
| target_sectors, target_size, target_zones | TEXT | Targeting |
| default_tone | TEXT | default 'Pro décontracté' |
| default_formality | TEXT | default 'Vous' |
| avoid_words, signature_phrases | TEXT | Style prefs |

### Table: projects
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| user_id | UUID | FK → users |
| name | TEXT | NOT NULL |
| client | TEXT | |
| description | TEXT | |
| color | TEXT | default 'var(--blue)' |

### Table: campaigns
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| user_id | UUID | FK → users |
| project_id | UUID | FK → projects |
| name | TEXT | NOT NULL |
| client | TEXT | NOT NULL |
| status | TEXT | default 'prep' (prep / active / completed / optimizing) |
| channel | TEXT | default 'email' (email / linkedin / multi) |
| sector, sector_short | TEXT | Target sector |
| position | TEXT | Target job title (DAF, DRH, Dirigeant...) |
| size | TEXT | Company size filter |
| angle | TEXT | Copy angle (Douleur client, Preuve sociale...) |
| zone | TEXT | Geographic zone |
| tone | TEXT | default 'Pro décontracté' |
| formality | TEXT | default 'Vous' |
| length | TEXT | default 'Standard' |
| cta | TEXT | CTA type |
| start_date | DATE | |
| lemlist_id | TEXT | Lemlist campaign reference |
| iteration | INTEGER | default 1 |
| nb_prospects | INTEGER | default 0 |
| sent, planned | INTEGER | default 0 |
| open_rate | NUMERIC | Global open rate |
| reply_rate | NUMERIC | Global reply rate |
| accept_rate_lk | NUMERIC | LinkedIn acceptance rate |
| reply_rate_lk | NUMERIC | LinkedIn reply rate |
| interested | INTEGER | default 0 |
| meetings | INTEGER | default 0 |
| stops | NUMERIC | Unsubscribe rate |
| last_collected | TIMESTAMPTZ | Last stats collection |
| notion_page_id | TEXT | Legacy Notion link |

### Table: touchpoints
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| campaign_id | UUID | FK → campaigns, NOT NULL |
| step | TEXT | NOT NULL (E1, E2, L1, L2...) |
| type | TEXT | NOT NULL (email / linkedin) |
| label | TEXT | Display label |
| sub_type | TEXT | Angle/variant descriptor |
| timing | TEXT | Delay (J+0, J+3...) |
| subject | TEXT | Email subject line (null for LinkedIn) |
| body | TEXT | Message body |
| max_chars | INTEGER | Character limit (300 for LinkedIn notes) |
| open_rate, reply_rate, stop_rate, accept_rate | NUMERIC | Per-touchpoint stats |
| interested | INTEGER | default 0 |
| sort_order | INTEGER | default 0 |

### Table: diagnostics
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| campaign_id | UUID | FK → campaigns, NOT NULL |
| date_analyse | DATE | default CURRENT_DATE |
| diagnostic | TEXT | Structured analysis text (or JSON string) |
| priorities | TEXT[] | Array of action priorities |
| nb_to_optimize | INTEGER | default 0 |
| notion_page_id | TEXT | Legacy |

### Table: versions
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| campaign_id | UUID | FK → campaigns, NOT NULL |
| version | INTEGER | NOT NULL |
| date | DATE | default CURRENT_DATE |
| messages_modified | TEXT[] | Array of step IDs modified |
| hypotheses | TEXT | What was tested |
| result | TEXT | default 'testing' (testing / improved / degraded / neutral) |
| notion_page_id | TEXT | Legacy |

### Table: memory_patterns
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| pattern | TEXT | NOT NULL — what was learned |
| category | TEXT | NOT NULL (Objets / Corps / Timing / LinkedIn / Cible) |
| data | JSONB | Stats, examples, evidence |
| confidence | TEXT | default 'Faible' (Haute / Moyenne / Faible) |
| date_discovered | DATE | default CURRENT_DATE |
| sectors | TEXT[] | Applicable sectors |
| targets | TEXT[] | Applicable target personas |
| notion_page_id | TEXT | Legacy |

### Table: opportunities
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| user_id | UUID | FK → users, NOT NULL |
| campaign_id | UUID | FK → campaigns |
| name | TEXT | NOT NULL — prospect name |
| title | TEXT | Job title |
| company | TEXT | |
| company_size | TEXT | |
| status | TEXT | default 'new' |
| status_color | TEXT | CSS color var |
| timing | TEXT | Next action timing |

### Table: reports
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| user_id | UUID | FK → users, NOT NULL |
| week | TEXT | NOT NULL — week label |
| date_range | TEXT | |
| score | TEXT | default 'ok' (excellent / good / ok / warning) |
| score_label | TEXT | |
| contacts | INTEGER | default 0 |
| open_rate, reply_rate | NUMERIC | |
| interested | INTEGER | default 0 |
| meetings | INTEGER | default 0 |
| synthesis | TEXT | AI-generated weekly summary |

### Table: chart_data
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| user_id | UUID | FK → users, NOT NULL |
| label | TEXT | NOT NULL (S1, S2...) |
| email_count | INTEGER | default 0 |
| linkedin_count | INTEGER | default 0 |
| week_start | DATE | |

### Other tables
- **chat_threads** / **chat_messages** — AI chat history
- **documents** / **project_files** — Uploaded files (briefs, personas, guidelines)
- **refresh_tokens** — JWT refresh token management
- **settings** — Key-value app settings

### Database Status
- **Schema:** Deployed on Supabase (production)
- **Seed data:** Available in `backend/db/seed-demo-data.sql`
- **RLS:** Enabled, service role has full access
- **Dashboard connection:** `api-client.js` maps snake_case DB → camelCase frontend automatically

---

## 🚀 Implementation Phases

| Phase | Timeline | Scope |
|-------|----------|-------|
| **Phase 1 — Manual** | Done | Prompts documented, schema deployed, dashboard built |
| **Phase 2 — Semi-auto** | In progress | N8N automates stats collection + analysis, human validates before deployment |
| **Phase 3 — Full auto** | Planned | Complete loop automated, human oversight for edge cases only |

**Current Status:** Phase 2 (Supabase schema deployed, dashboard connected, seed data ready, N8N workflows in progress)

---

## 🧠 Retention Biases (Dashboard UX)

The dashboard leverages cognitive biases to increase engagement and reduce churn:

### Implemented Biases

1. **Progress Bias (Endowed Progress Effect)**
   - Users shown a progress bar toward a goal that's already partially filled
   - Campaign setup wizard starts at "20% complete" (account created = free progress)
   - Optimization score shows cumulative improvement over time
   - "Your AI has learned X patterns" — always growing, never resetting

2. **Loss Aversion**
   - "You've built X patterns — canceling resets your AI memory"
   - Show accumulated value that would be lost on churn

3. **Social Proof / Benchmarking**
   - "Your open rate is above 73% of users in your sector"
   - Anonymous peer comparison metrics

4. **Sunk Cost Visualization**
   - "Total prospects reached: X" — cumulative counters that never go down
   - "AI optimizations performed: X" — investment visualization

### Design Principles for Biases
- Always **truthful** — show real data, never fabricate progress
- **Subtle** — integrated naturally into the dashboard, not popup-heavy
- **Value-aligned** — biases reinforce behaviors that genuinely help the user

---

## 🔑 Key Design Decisions

1. **Why Lemlist?** — Best-in-class for multi-channel sequences, good API, handles deliverability
2. **Why N8N over Zapier?** — Self-hostable, more complex logic support, better for AI integrations
3. **Why PostgreSQL as source of truth?** — Scalable to 1000+ users, supports complex queries/aggregations for cross-campaign memory, reliable under load. Supabase/Neon for managed hosting.
4. **Why keep Notion?** — Internal team ops only (client notes, processes). NOT exposed to clients. Replaceable by admin panel at scale.
5. **Why a dashboard, not Notion, for clients?** — Clients see their campaigns on the Bakal SaaS dashboard. Professional product experience, no dependency on third-party UX.
6. **Why not pay-per-lead?** — Lead value varies wildly by sector; flat fee simpler and more predictable
7. **Why ~€25/month entry point?** — Low barrier, SMB volume play. Value comes from orchestration, not infrastructure cost.
8. **Why retention biases?** — At €25/month, churn is the #1 risk. Progress bias and sunk cost visualization keep users engaged by showing real accumulated value.

---

## 🛠️ Development Priorities

When building the platform:

1. **PostgreSQL schema first** — Deploy database tables before workflows can write to them
2. **Start with Workflow 1** — Stats collection is foundation for everything
3. **Test analysis prompt manually** — Validate diagnostic quality before automating
4. **A/B testing infrastructure** — Ensure Lemlist setup supports variant deployment
5. **Dashboard MVP** — Client-facing views for campaigns, stats, and optimization history
6. **Monitoring/alerts** — Know when campaigns need attention before clients notice

---

## 📐 Landing Page Notes

- Two themes exist: dark (Outfit font, gradient accents) and light (DM Sans, cleaner)
- Both available in French and English
- Key sections: Hero → Pain points → How it works → What's included → Pricing → Testimonials → FAQ → CTA
- Pricing displayed: ~€25/month entry point
- CTA links to Calendly (placeholder URL needs replacement)

---

## ⚠️ Important Constraints

- **Never mention "AI" or "automated"** in prospect-facing copy — maintain human feel
- **Respect Lemlist rate limits** when building N8N workflows
- **LinkedIn connection notes max 300 chars** — hard platform limit
- **Cross-campaign memory requires volume** — patterns only reliable with >50 prospects per test
- **Break-up emails always short** — 3-4 lines max, never guilt-trip

---

## 🔗 API Endpoints Reference

### Lemlist API
- Base: `https://api.lemlist.com/api`
- Auth: API key in header
- Key endpoints:
  - `GET /campaigns` — List campaigns
  - `GET /campaigns/{id}/export` — Stats export
  - `PATCH /campaigns/{id}/sequences` — Update sequences

### Claude API
- Base: `https://api.anthropic.com/v1`
- Endpoint: `POST /messages`
- Model: Use latest available (claude-3-opus or claude-3-sonnet)

### PostgreSQL (via Supabase or Neon)
- **Supabase**: Auto-generated REST API at `https://<project>.supabase.co/rest/v1`
- **Neon**: Standard PostgreSQL connection string, use with any ORM/client
- Auth: API key (Supabase) or connection string (Neon)
- All campaign data, diagnostics, versions, and cross-campaign memory stored here

### Notion API (internal team use only)
- Base: `https://api.notion.com/v1`
- Auth: Bearer token
- Used for internal ops only — NOT part of the product data flow
- Key endpoints:
  - `POST /databases/{id}/query` — Read database
  - `POST /pages` — Create entry
  - `PATCH /pages/{id}` — Update entry

---

## 💬 Communication Style

When generating copy for Bakal clients:
- **Default tone:** Conversational but professional
- **Default formality:** "vous" (French) / formal "you" (English)
- **Avoid:** Corporate jargon, aggressive sales tactics, spam patterns
- **Embrace:** Direct value statements, specific numbers, conversational questions

---

## 📎 Quick Reference Commands

```bash
# Common tasks you might be asked to do:

# 1. Generate a new campaign sequence
→ Use Master Prompt from bakal-prompt-system.md with client params

# 2. Analyze campaign performance
→ Use Analysis Prompt from bakal-refinement-system.md with stats

# 3. Regenerate underperforming messages
→ Use Regeneration Prompt with diagnostic + originals

# 4. Update landing page
→ Edit landing/bakal-landing-page.html (dark) or landing/bakal-landing-page-light.html

# 5. Extend database structure
→ Follow PostgreSQL schema patterns from this file, migrate to SQL
```

---

*Last updated: March 2026*
*For questions about project history, check conversation context or ask Goran.*
