# Baakalai — Bug Tracker & Lessons Learned

Registry of bugs found, fixed, and patterns to avoid.

---

## Session 2026-05-28

### CRITICAL — Fixed

| # | Bug | File | Root Cause | Fix | Lesson |
|---|-----|------|-----------|-----|--------|
| 1 | `handleFixAll` crash — `health` undefined in callback scope | `CRMDiagnosticReport.jsx:84` | `health` was destructured from `data` at line 168, but the `useCallback` at line 83 referenced it before that line executed | Extract `health` from `data` inside the callback body | Never reference destructured variables from render scope inside `useCallback` — they may not be in scope when the callback is defined |
| 2 | Deal Coach crashes on invalid `churn_factors` JSON | `deal-coach.js:67` | `JSON.parse(deal.churn_factors)` inline in a template string without try/catch | Wrapped in IIFE with try/catch fallback to 'N/A' | Never put `JSON.parse()` inside template literals — always wrap in try/catch |
| 3 | Odoo adapter crashes on malformed token | `crm-cleaning-agent.js:62,78` | `JSON.parse(token)` called directly in `listPersons()` and `updatePerson()` without error handling | Added try/catch with descriptive error message | All `JSON.parse()` on external data must be wrapped in try/catch |
| 4 | Churn scoring UPDATE fails silently | `churn-scoring.js:167` | DB UPDATE not in try/catch — if one contact fails, entire scoring loop throws | Wrapped in try/catch, log error, continue loop | DB writes in loops must always be individually try/caught |
| 5 | Churn scoring NaN on null dates | `churn-scoring.js:54` | `new Date(null).getTime()` returns NaN, comparison `NaN >= 60` is always false | Added null check + `isNaN()` guard | Always validate date inputs before arithmetic — NaN comparisons silently fail |

### HIGH — Fixed

| # | Bug | File | Root Cause | Fix | Lesson |
|---|-----|------|-----------|-----|--------|
| 6 | CRM Health scan fails for Notion/Airtable/Folk users | `CRMAnalyticsPage.jsx:649` | Provider detection list hardcoded to `['pipedrive', 'hubspot', 'salesforce', 'odoo']` — missing 3 providers | Added `'notion', 'airtable', 'folk'` to the list | When adding a new CRM provider, grep for ALL provider lists and update them all |
| 7 | CRM Health scan race condition | `CRMAnalyticsPage.jsx:668` | `useEffect` launched scan immediately with default `provider='pipedrive'` before `/crm/providers` API responded | Changed `provider` default to `null`, scan only fires when provider is detected | Never set a default value for async-detected state — use `null` and guard |
| 8 | HubSpot import silently fails on 401/403 | `crm.js:668-692` | `fetch()` response not checked with `!res.ok` before `res.json()` | Added early return with 502 + error body on non-OK response | Always check `res.ok` before parsing response body |
| 9 | `fetchData` infinite loop risk | `CRMAnalyticsPage.jsx:87-102` | `data` object in `useCallback` deps caused re-render loop since `setData` creates new object each time | Replaced with `useRef` for cache tracking, removed `data` from deps | Never put mutable state objects in `useCallback` deps — use refs for cache flags |
| 10 | Deal Coach regex JSON fallback crashes | `deal-coach.js:85` | `JSON.parse(m[0])` on regex-matched string without try/catch | Added try/catch around fallback parse | All JSON.parse from regex matches need try/catch — regex may match invalid JSON |

### MEDIUM — Fixed

| # | Bug | File | Root Cause | Fix | Lesson |
|---|-----|------|-----------|-----|--------|
| 11 | Duplicate status badge in client list | `ClientsPage.jsx:366+395` | Status badge rendered twice — once in grid columns, once always-visible at end of row | Removed duplicate, added conditional badge for panel-open mode | Review grid layouts for duplicate columns after refactoring |
| 12 | `alert()` / `prompt()` for email feedback | `ClientsPage.jsx:443,448` | Native browser dialogs for success/error feedback | Replaced with `showToast()` | Never use `alert()` or `prompt()` in a modern SPA — use toast/modal components |
| 13 | DealCoach dismiss is permanent | `DealCoachCard.jsx:36` | `localStorage.setItem('dismissed', 'true')` — no expiry | Changed to store timestamp, expires after 24h | Dismissals should have TTL, not be permanent |
| 14 | i18n: 35+ French strings hardcoded in CRM Analytics | `CRMAnalyticsPage.jsx` | Labels like "Entonnoir du pipeline", "Score moyen" directly in JSX | Replaced with `t()` calls, added analytics i18n section | All user-facing text must go through `t()` — no inline strings |
| 15 | CRM errors silently swallowed | `CRMDiagnosticReport.jsx:79,106` | `catch { /* ignore */ }` on fix/merge operations | Added `showToast({ type: 'error' })` on catch | Never silently catch user-facing errors — always show feedback |

---

## Recurring Patterns to Watch

### JSON.parse Safety
**Rule**: Every `JSON.parse()` on data from DB, API, or user input MUST be in try/catch.
**Files affected**: `deal-coach.js`, `crm-cleaning-agent.js`, `churn-scoring.js`, `response-analysis-agent.js`

### Provider Lists
**Rule**: When adding a CRM provider, update ALL provider lists across the codebase.
**Grep**: `['pipedrive'` or `'hubspot', 'salesforce'` — there are 6+ locations.
**Files**: `crm-cleaning-agent.js`, `CRMAnalyticsPage.jsx`, `ClientsPage.jsx`, `crm.js (routes)`, `nurture-engine.js`

### useCallback Dependencies
**Rule**: Never put mutable state objects (`data`, `report`, etc.) in useCallback deps. Use refs for cache flags.
**Files**: `CRMAnalyticsPage.jsx`, `CRMDiagnosticReport.jsx`

### Error Feedback
**Rule**: All user-triggered actions must show success/error feedback (toast or inline).
**Pattern**: `try { await action(); showToast({type:'success'}); } catch(err) { showToast({type:'error', message: err.message}); }`

### DB Writes in Loops
**Rule**: Individual try/catch per iteration. Log and continue, don't break the loop.
**Files**: `churn-scoring.js`, `crm-cleaning-agent.js`, `nurture-engine.js`

### Date/NaN Guards
**Rule**: Always validate dates before arithmetic. `new Date(null).getTime()` → NaN, and NaN comparisons are always false.
**Pattern**: `const dateStr = raw.date; const time = dateStr ? new Date(dateStr).getTime() : 0; if (isNaN(time)) ...`
