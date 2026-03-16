# Bakal — N8N Workflows

These are importable N8N workflow definitions for the Bakal optimization loop.
All workflows delegate to the **Bakal backend API**, keeping credentials centralized and logic in one place.

## Architecture

```
N8N (scheduler/triggers) → Bakal Backend API → PostgreSQL + Claude + Lemlist + Notion
```

N8N only handles **scheduling and orchestration**. All business logic (stats collection, AI analysis, regeneration, deployment, Notion sync) lives in the backend.

## Workflows

| File | Name | Trigger | Backend Endpoint |
|------|------|---------|-----------------|
| `01-stats-collection.json` | Stats Collection | Daily @ 8am | `POST /api/stats/collect` |
| `02-regeneration-deployment.json` | Regeneration + Deployment | Webhook | `POST /api/ai/run-refinement` + `POST /api/ai/deploy-to-lemlist` |
| `03-memory-consolidation.json` | Memory Consolidation | Monthly (1st @ 6am) | `POST /api/ai/consolidate-memory` |

## How to Import

1. Open your N8N instance
2. Go to **Workflows** > **Import from File**
3. Import in order: `01` → `02` → `03`
4. Configure the environment variable and credential (see below)
5. Activate each workflow

## Setup Checklist

### 1. N8N Environment Variable

Set in your N8N instance (Settings → Variables, or via `N8N_` env vars):

```
BAKAL_BACKEND_URL=http://localhost:3001
```

Replace with your production backend URL if deploying remotely.

### 2. Backend JWT Credential

Create **one** HTTP Header Auth credential in N8N:

- **Name:** `Bakal Backend JWT`
- **Header Name:** `Authorization`
- **Header Value:** `Bearer <admin-jwt-token>`

To generate an admin JWT token:
1. Start the Bakal backend: `cd backend && npm start`
2. Login as admin: `curl -X POST http://localhost:3001/api/auth/login -H 'Content-Type: application/json' -d '{"email":"admin@bakal.io","password":"admin123"}'`
3. Copy the `token` from the response
4. Use it as the Header Value: `Bearer eyJhbG...`

### 3. Inter-Workflow Link (optional)

If you want WF1 to trigger WF2 automatically:
1. Import WF2 first
2. Copy its webhook URL
3. Add an HTTP Request node in WF1 after "Campaigns Analyzed?" to POST to that URL

By default, the backend orchestrator handles the full loop internally when `ORCHESTRATOR_ENABLED=true` in `.env`.

## Workflow Flow

```
WF1: Stats Collection (daily)
  ├── Backend /api/stats/collect
  │   ├── Fetches campaigns from Lemlist API
  │   ├── Calculates per-touchpoint metrics
  │   ├── Stores in PostgreSQL (campaigns + touchpoints)
  │   ├── Runs Claude analysis if eligible (>50 prospects)
  │   └── Stores diagnostics in PostgreSQL + syncs to Notion
  ├── IF campaigns were analyzed → trigger WF2
  └── ELSE → done

WF2: Regeneration + Deployment (on demand)
  ├── Backend /api/ai/run-refinement
  │   ├── Reads campaign + touchpoints + memory from PostgreSQL
  │   ├── Claude → performance analysis + diagnostic
  │   ├── Claude → regenerate underperforming messages
  │   ├── Stores version history in PostgreSQL + Notion
  │   └── Updates campaign status to 'optimizing'
  ├── IF regeneration produced messages → deploy
  │   └── Backend /api/ai/deploy-to-lemlist
  │       ├── Maps messages to Lemlist sequence steps
  │       ├── PATCHes Lemlist sequences with new content
  │       └── Updates touchpoints in PostgreSQL
  └── ELSE → analysis only, no deployment

WF3: Memory Consolidation (monthly)
  └── Backend /api/ai/consolidate-memory
      ├── Aggregates all diagnostics from PostgreSQL
      ├── Fetches existing memory patterns
      ├── Claude → identify/update/create patterns
      ├── Stores patterns in PostgreSQL
      └── Syncs to Notion
```

## Backend vs N8N

The backend already has a built-in orchestrator (`ORCHESTRATOR_ENABLED=true` in `.env`) that runs:
- **collect-stats**: Daily at 8am (same as WF1)
- **regenerate**: After stats collection for eligible campaigns
- **consolidate**: Monthly on the 1st at 9am (same as WF3)

N8N workflows are an **alternative** to the built-in orchestrator, useful when:
- You need visual workflow monitoring
- You want to add custom steps (Slack notifications, email alerts, etc.)
- You prefer N8N's retry/error handling over cron

You can use **either** the built-in orchestrator **or** N8N — not both simultaneously.
To use N8N instead, set `ORCHESTRATOR_ENABLED=false` in the backend `.env`.
