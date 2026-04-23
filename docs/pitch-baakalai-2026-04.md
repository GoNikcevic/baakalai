# Baakalai — Pitch Document (April 2026)

## One-liner

baakalai is the prospecting engine that refines itself — and now manages your existing clients too.

## The problem

SMB sales teams use 5-8 disconnected tools: one for finding prospects, another for emailing, another for CRM, another for follow-ups. No tool connects prospecting to client retention. When a deal closes, the relationship management starts from scratch in a different tool.

## What baakalai does

### Prospection (finding new clients)
- Chat with AI to create campaigns — describe your target, baakalai generates the full sequence
- Multi-channel: email + LinkedIn, with conditional branching (if opened → A, if not → B)
- Deploy directly to Lemlist or Apollo
- A/B testing with automatic refinement — baakalai learns what works
- 200 prospects per search, cross-campaign memory

### Activation (growing existing clients)
- Import contacts from Pipedrive, HubSpot, Salesforce, or Odoo
- 8 automated triggers: deal won, deal stagnant, inactive contact, deal lost, onboarding check, renewal reminder, upsell opportunity, feedback request
- AI generates personalized emails for each contact — not templates, real 1-to-1 messages
- Emails sent from your own email (Gmail/Outlook via SMTP) — looks like you typed it yourself
- Response analysis: AI reads CRM activities, detects sentiment (positive/negative/meeting request), updates contact status automatically
- Data cleaning: detect duplicates, missing fields, invalid emails, inactive contacts (score /100)

### Intelligence (gets smarter over time)
- 4 autonomous agents run daily: Prospection, CRM, Memory, Reporting
- Cross-campaign memory: patterns from successful campaigns inform future ones
- Trigger effectiveness scoring: tracks which activation triggers produce the most positive responses
- Weekly reports with AI recommendations

## How it's different from agencies

| | Agency (SalesCaptain, GTM Studio) | baakalai |
|---|---|---|
| Cost | €30k-€140k for 4-7 months | $75/user/month (~€2.7k/year for team of 3) |
| After contract ends | Nothing retained (domains cancelled, no docs) | Everything stays (data, patterns, sequences, memory) |
| Learning | Agency learns, not you | Your AI learns, your team learns |
| Scope | Outbound only | Outbound + client activation + CRM management |
| Dependency | Fully dependent on agency | Autonomous from day 1 |

## How it's different from tools (Lemlist, Apollo, HubSpot)

| | Point tools | baakalai |
|---|---|---|
| Setup | Configure each tool separately | One chat conversation, AI does the rest |
| Intelligence | Manual A/B testing, no cross-campaign learning | Automatic refinement, memory across all campaigns |
| Client activation | Not covered (CRM is separate) | Built-in: triggers, personalized emails, response analysis |
| Integration | You build the workflow | baakalai orchestrates Lemlist + Apollo + Pipedrive + Odoo natively |

## Integrations

**Outreach**: Lemlist, Apollo, Instantly, Smartlead, La Growth Machine, Waalaxy
**CRM**: Pipedrive, HubSpot, Salesforce, Odoo, Notion, Airtable
**Enrichment**: Apollo, Brave Search (web prospect agent)
**Email**: Gmail, Outlook, OVH (any SMTP)

## Team mode

Up to 5 members per team. Roles:
- **Admin**: full access + team management
- **Prospection**: campaigns, prospects, search
- **Activation**: clients, triggers, CRM, emails
- **Viewer**: read-only

Shared CRM keys, shared chat threads, automatic handoff (deal won → passes from prospection to activation team).

## Pricing

**$75/user/month**. No setup fee, no success fee, cancel anytime. Everything retained after cancellation.

## Current state (April 2026)

- Production on baakal.ai (Railway)
- 1 active beta tester (BforCure campaign, 83 prospects, live stats)
- Full Lemlist + Apollo + Pipedrive integration working
- Odoo integration live
- Brand v6 deployed (light theme, Geist font, purple accents)
- 4 autonomous agents operational
- Team mode, activation triggers, data cleaning, response analysis all built

## Target ICP

SMB owners and sales directors (1-50 employees) who:
- Need leads but lack time to manage outbound manually
- Already use a CRM (Pipedrive, HubSpot) but don't leverage it for retention
- Spend €500-5000/month on disconnected sales tools
- Want AI to handle the repetitive work while they focus on closing
