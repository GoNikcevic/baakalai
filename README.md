# baakalai

B2B platform that orchestrates **prospecting + client activation** with AI. Not just outbound — Baakalai handles the full cycle from cold outreach to client retention.

## What it does

**Prospection** — Create campaigns via AI chat, generate personalized sequences (email + LinkedIn), deploy to Lemlist/Apollo, A/B test and refine automatically.

**Activation** — Import contacts from Pipedrive/HubSpot/Odoo, detect stagnant deals and churn risk, send personalized follow-up emails, analyze responses with AI.

**Intelligence** — 4 autonomous agents (Prospection, CRM, Memory, Reporting) that learn from every campaign and improve over time.

## Stack

- Frontend: React 19 + Vite 7
- Backend: Node.js + Express + PostgreSQL (Supabase)
- AI: Claude API (Anthropic)
- Deploy: Railway (auto-deploy from main)
- Outreach: Lemlist, Apollo
- CRM: Pipedrive, HubSpot, Salesforce, Odoo
- Email: Resend (system) + SMTP/nodemailer (activation)

## Project Structure

```
baakalai/
├── frontend/src/
│   ├── pages/           # ChatPage, Dashboard, Campaigns, Clients, Activation, CRM Analytics, Settings
│   ├── components/      # Layout, OnboardingWizard, EmailSettings, TeamSettings
│   └── i18n/            # FR + EN translations
├── backend/
│   ├── api/             # lemlist, apollo, pipedrive, odoo, hubspot, claude, brave-search
│   ├── lib/             # crm-agent, prospection-agent, memory-agent, reporting-agent,
│   │                    #   response-analysis-agent, email-outbound, nurture-engine,
│   │                    #   crm-cleaning-agent, crm-bidirectional-sync
│   ├── routes/          # chat, campaigns, crm, nurture, stats, teams, dashboard
│   ├── orchestrator/    # 4-agent scheduler
│   └── db/              # migrations (033+)
├── docs/                # Architecture docs, changelogs
├── CLAUDE.md            # Full project context for AI assistants
└── README.md
```

## Pricing

$75/user/month. Team plan up to 5 members.

## License

Proprietary. All rights reserved.
