# Orchestrator — n8n Replacement (Future)

> **Status:** Structure only. Not active. n8n remains the orchestrator for now.
>
> **When to activate:** ~10-15 active clients, or if n8n becomes a bottleneck.

## Purpose

Drop-in replacement for the 3 n8n workflows, using the existing Express backend
and API clients (`api/lemlist.js`, `api/notion.js`, `api/claude.js`).

## Structure

```
orchestrator/
  index.js              ← Scheduler entry point (cron definitions)
  jobs/
    collect-stats.js    ← Workflow 1: Daily stats Lemlist → Notion → Claude analysis
    regenerate.js       ← Workflow 2: Claude regen → Lemlist A/B deploy
    consolidate.js      ← Workflow 3: Monthly cross-campaign memory
  queue/
    index.js            ← Queue setup (BullMQ when needed, in-memory for start)
    processors.js       ← Job processors (delegates to jobs/*)
```

## Migration path

1. **Phase A (hybrid):** n8n calls these endpoints via HTTP instead of doing logic internally
2. **Phase B (standalone):** Enable cron in `index.js`, disable n8n workflows
3. **Phase C (scaled):** Add Redis + BullMQ for parallel job processing

## How to activate

```js
// In server.js, uncomment:
// const orchestrator = require('./orchestrator');
// orchestrator.start();
```
