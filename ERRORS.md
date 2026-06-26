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

### Automated Audit — 2026-06-15

Found 184 potential issue(s):

| Severity | File | Line | Pattern | Code |
|----------|------|------|---------|------|
| HIGH | `backend/routes/ai.js` | 438 | JSON.parse without try/catch | `const data = typeof pattern.data === 'string' ? JSON.parse(pattern.data) : (patt` |
| MEDIUM | `backend/routes/ai.js` | 439 | new Date() on potentially null value without guard | `const age = Math.round((Date.now() - new Date(pattern.date_discovered).getTime()` |
| MEDIUM | `backend/routes/ai.js` | 525 | Empty catch block (swallowed error) | `} catch { /* solo user */ }` |
| MEDIUM | `backend/routes/ai.js` | 703 | Empty catch block (swallowed error) | `try { campaignMap[cid] = await db.campaigns.get(cid); } catch {}` |
| HIGH | `backend/routes/ai.js` | 861 | JSON.parse without try/catch | `const config = typeof campaign.ab_config === 'string' ? JSON.parse(campaign.ab_c` |
| MEDIUM | `backend/routes/analytics.js` | 102 | new Date() on potentially null value without guard | `const updatedAt = opp.updated_at ? new Date(opp.updated_at).getTime() : now;` |
| MEDIUM | `backend/routes/analytics.js` | 103 | new Date() on potentially null value without guard | `const createdAt = opp.created_at ? new Date(opp.created_at).getTime() : now;` |
| MEDIUM | `backend/routes/analytics.js` | 578 | new Date() on potentially null value without guard | `const create = new Date(o.created_at).getTime();` |
| MEDIUM | `backend/routes/analytics.js` | 651 | new Date() on potentially null value without guard | `const updatedAt = opp.updated_at ? new Date(opp.updated_at).getTime() : now;` |
| MEDIUM | `backend/routes/analytics.js` | 742 | new Date() on potentially null value without guard | `const stale = activeOpps.filter(o => { const u = o.updated_at ? new Date(o.updat` |
| MEDIUM | `backend/routes/auth.js` | 270 | Empty catch block (swallowed error) | `} catch { /* no team */ }` |
| MEDIUM | `backend/routes/auth.js` | 497 | Empty catch block (swallowed error) | `} catch { /* no team — ok */ }` |
| MEDIUM | `backend/routes/campaigns.js` | 237 | new Date() on potentially null value without guard | `const lastOpt = campaign.last_optimized_at ? new Date(campaign.last_optimized_at` |
| MEDIUM | `backend/routes/chat.js` | 251 | Empty catch block (swallowed error) | `} catch { /* default to fr */ }` |
| MEDIUM | `backend/routes/chat.js` | 324 | new Date() on potentially null value without guard | `new Date(c.created_at).getTime() > sixtyAgo` |
| LOW | `backend/routes/chat.js` | 450 | Hardcoded CRM provider list (may be incomplete) | `const providers = ['pipedrive', 'hubspot', 'salesforce', 'odoo'];` |
| HIGH | `backend/routes/crm.js` | 316 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| HIGH | `backend/routes/crm.js` | 349 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| HIGH | `backend/routes/crm.js` | 365 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| HIGH | `backend/routes/crm.js` | 713 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| HIGH | `backend/routes/crm.js` | 742 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| LOW | `backend/routes/crm.js` | 1034 | Hardcoded CRM provider list (may be incomplete) | `for (const provider of ['pipedrive', 'salesforce', 'hubspot']) {` |
| MEDIUM | `backend/routes/crm.js` | 1045 | Empty catch block (swallowed error) | `} catch { /* scoring works without deals */ }` |
| HIGH | `backend/routes/crm.js` | 1354 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| HIGH | `backend/routes/crm.js` | 1368 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| MEDIUM | `backend/routes/crm.js` | 1398 | Empty catch block (swallowed error) | `} catch { /* skip individual failures */ }` |
| MEDIUM | `backend/routes/documents.js` | 141 | Empty catch block (swallowed error) | `try { fs.unlinkSync(file.path); } catch {}` |
| MEDIUM | `backend/routes/documents.js` | 244 | Empty catch block (swallowed error) | `try { fs.unlinkSync(tempPath); } catch {}` |
| HIGH | `backend/routes/export.js` | 199 | JSON.parse without try/catch | `? JSON.parse(o.score_breakdown \|\| '{}')` |
| MEDIUM | `backend/routes/extension.js` | 62 | Empty catch block (swallowed error) | `} catch { /* optional */ }` |
| HIGH | `backend/routes/extension.js` | 102 | JSON.parse without try/catch | `const data = (typeof opp.data === 'string' ? JSON.parse(opp.data) : opp.data) \|` |
| HIGH | `backend/routes/extension.js` | 143 | JSON.parse without try/catch | `const data = (typeof opp.data === 'string' ? JSON.parse(opp.data) : opp.data) \|` |
| HIGH | `backend/routes/informz.js` | 67 | JSON.parse without try/catch | `if (m) parsed = JSON.parse(m[0]);` |
| HIGH | `backend/routes/informz.js` | 210 | JSON.parse without try/catch | `if (m) parsed = JSON.parse(m[0]);` |
| MEDIUM | `backend/routes/nurture.js` | 346 | Empty catch block (swallowed error) | `} catch { /* optional */ }` |
| MEDIUM | `backend/routes/nurture.js` | 359 | Empty catch block (swallowed error) | `if (m) { try { sampleEmail = JSON.parse(m[0]); } catch { /* malformed JSON */ } ` |
| MEDIUM | `backend/routes/nurture.js` | 361 | Empty catch block (swallowed error) | `} catch { /* skip preview generation */ }` |
| HIGH | `backend/routes/nurture.js` | 432 | fetch() without res.ok check before .json() | `const tokenRes = await fetch('https://oauth2.googleapis.com/token', {` |
| HIGH | `backend/routes/nurture.js` | 522 | fetch() without res.ok check before .json() | `const tokenRes = await fetch('https://login.microsoftonline.com/common/oauth2/v2` |
| HIGH | `backend/routes/settings.js` | 375 | JSON.parse without try/catch | `const currentMeta = typeof existing.metadata === 'string' ? JSON.parse(existing.` |
| HIGH | `backend/routes/signals.js` | 166 | JSON.parse without try/catch | `if (m) email = JSON.parse(m[0]);` |
| HIGH | `backend/routes/signals.js` | 351 | JSON.parse without try/catch | `if (m) sequence = JSON.parse(m[0]);` |
| HIGH | `backend/routes/stats.js` | 23 | fetch() without res.ok check before .json() | `const resp = await fetch(url, options);` |
| HIGH | `backend/routes/team-campaigns.js` | 136 | JSON.parse without try/catch | `if (m) sampleEmail = JSON.parse(m[0]);` |
| MEDIUM | `backend/routes/team-campaigns.js` | 202 | Empty catch block (swallowed error) | `if (m) { try { email = JSON.parse(m[0]); } catch { /* malformed AI response */ }` |
| HIGH | `backend/lib/ab-memory.js` | 187 | JSON.parse without try/catch | `const data = typeof top.data === 'string' ? JSON.parse(top.data) : (top.data \|\` |
| MEDIUM | `backend/lib/agent-chains.js` | 338 | Empty catch block (swallowed error) | `} catch { /* no product lines */ }` |
| MEDIUM | `backend/lib/agent-chains.js` | 360 | Empty catch block (swallowed error) | `} catch { /* ok */ }` |
| MEDIUM | `backend/lib/agents/signal-agent.js` | 125 | Empty catch block (swallowed error) | `} catch { /* enrichment is optional */ }` |
| MEDIUM | `backend/lib/agents/signal-agent.js` | 181 | Empty catch block (swallowed error) | `} catch { /* notifications are optional */ }` |
| MEDIUM | `backend/lib/agents/signal-agent.js` | 206 | Empty catch block (swallowed error) | `} catch { /* skip duplicates */ }` |
| MEDIUM | `backend/lib/agents/signal-agent.js` | 212 | Empty catch block (swallowed error) | `} catch { /* auto-prospecting is optional */ }` |
| HIGH | `backend/lib/agents/signal-agent.js` | 289 | fetch() without res.ok check before .json() | `const res = await fetch('https://api.apollo.io/v1/mixed_people/search', {` |
| MEDIUM | `backend/lib/agents/timing-agent.js` | 99 | new Date() on potentially null value without guard | `const replied = new Date(r.replied_at).getTime();` |
| MEDIUM | `backend/lib/agents/timing-agent.js` | 163 | new Date() on potentially null value without guard | `const sent = new Date(r.sent_at).getTime();` |
| MEDIUM | `backend/lib/agents/timing-agent.js` | 164 | new Date() on potentially null value without guard | `const resp = new Date(r.response_at).getTime();` |
| MEDIUM | `backend/lib/churn-scoring.js` | 85 | new Date() on potentially null value without guard | `const age = (now - new Date(e.created_at).getTime()) / DAY_MS;` |
| MEDIUM | `backend/lib/conversation-autopilot.js` | 190 | Empty catch block (swallowed error) | `try { return JSON.parse(match[0]); } catch { /* fallthrough */ }` |
| MEDIUM | `backend/lib/conversation-autopilot.js` | 319 | new Date() on potentially null value without guard | `return history.sort((a, b) => new Date(a.date) - new Date(b.date));` |
| MEDIUM | `backend/lib/crm-agent.js` | 62 | Empty catch block (swallowed error) | `} catch { /* solo user, no team */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 177 | Empty catch block (swallowed error) | `} catch { /* ok */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 205 | Empty catch block (swallowed error) | `} catch { /* notification is non-blocking */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 283 | Empty catch block (swallowed error) | `} catch { /* owner mapping is optional */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 350 | Empty catch block (swallowed error) | `} catch { /* mapping is optional */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 379 | Empty catch block (swallowed error) | `} catch { /* deal sync is optional */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 548 | Empty catch block (swallowed error) | `} catch { /* fallback to 50/50 */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 637 | Empty catch block (swallowed error) | `} catch { /* patterns optional */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 677 | Empty catch block (swallowed error) | `} catch { /* fallback to single */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 694 | Empty catch block (swallowed error) | `} catch { /* fallback below */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 772 | new Date() on potentially null value without guard | `.map(o => (new Date(o.updated_at).getTime() - new Date(o.created_at).getTime()) ` |
| MEDIUM | `backend/lib/crm-agent.js` | 794 | new Date() on potentially null value without guard | `.map(o => (new Date(o.updated_at).getTime() - new Date(o.created_at).getTime()) ` |
| MEDIUM | `backend/lib/crm-agent.js` | 864 | Empty catch block (swallowed error) | `} catch { /* optional */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 893 | Empty catch block (swallowed error) | `} catch { /* optional */ }` |
| MEDIUM | `backend/lib/crm-bidirectional-sync.js` | 84 | new Date() on potentially null value without guard | `const lastPush = opp.score_pushed_at ? new Date(opp.score_pushed_at).getTime() :` |
| MEDIUM | `backend/lib/crm-bidirectional-sync.js` | 93 | Empty catch block (swallowed error) | `} catch { /* ignore individual push errors */ }` |
| HIGH | `backend/lib/crm-export.js` | 23 | fetch() without res.ok check before .json() | `const res = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {` |
| HIGH | `backend/lib/crm-export.js` | 51 | fetch() without res.ok check before .json() | `const res = await fetch(`${instanceUrl}/services/data/v62.0/sobjects/Contact`, {` |
| HIGH | `backend/lib/crm-export.js` | 76 | fetch() without res.ok check before .json() | `const res = await fetch(`https://api.pipedrive.com/v1/persons?api_token=${apiKey` |
| HIGH | `backend/lib/crm-export.js` | 90 | fetch() without res.ok check before .json() | `await fetch(`https://api.pipedrive.com/v1/notes?api_token=${apiKey}`, {` |
| MEDIUM | `backend/lib/crm-owner-resolver.js` | 32 | Empty catch block (swallowed error) | `} catch { /* no team = solo user */ }` |
| MEDIUM | `backend/lib/deliverability-agent.js` | 200 | Empty catch block (swallowed error) | `} catch { /* notification is best-effort */ }` |
| HIGH | `backend/lib/email-outbound.js` | 117 | fetch() without res.ok check before .json() | `const res = await fetch(tokenUrl, {` |
| HIGH | `backend/lib/email.js` | 16 | fetch() without res.ok check before .json() | `const res = await fetch('https://api.resend.com/emails', {` |
| MEDIUM | `backend/lib/enrich-agent.js` | 210 | Empty catch block (swallowed error) | `} catch { /* Brave search failed */ }` |
| HIGH | `backend/lib/enrich-agent.js` | 241 | JSON.parse without try/catch | `return JSON.parse(match[0]);` |
| MEDIUM | `backend/lib/enrich-agent.js` | 336 | Empty catch block (swallowed error) | `} catch { /* verification failed, keep the email */ }` |
| MEDIUM | `backend/lib/enrich-agent.js` | 375 | Empty catch block (swallowed error) | `} catch { /* continue */ }` |
| HIGH | `backend/lib/enrich-agent.js` | 411 | JSON.parse without try/catch | `const parsed = JSON.parse(match[0]);` |
| HIGH | `backend/lib/icp-agent.js` | 170 | JSON.parse without try/catch | `const data = typeof userIcp.data === 'string' ? JSON.parse(userIcp.data) : userI` |
| HIGH | `backend/lib/lifecycle-emails.js` | 188 | JSON.parse without try/catch | `const userData = (typeof user.data === 'string' ? JSON.parse(user.data) : user.d` |
| MEDIUM | `backend/lib/lifecycle-emails.js` | 190 | new Date() on potentially null value without guard | `const daysSinceSignup = Math.floor((Date.now() - new Date(user.created_at).getTi` |
| HIGH | `backend/lib/lifecycle-emails.js` | 240 | JSON.parse without try/catch | `const userData = (typeof user.data === 'string' ? JSON.parse(user.data) : user.d` |
| MEDIUM | `backend/lib/nurture-engine.js` | 78 | new Date() on potentially null value without guard | `const dealAge = (Date.now() - new Date(deal.createdAt).getTime()) / DAY_MS;` |
| MEDIUM | `backend/lib/nurture-engine.js` | 104 | new Date() on potentially null value without guard | `const lastUpdate = c.update_time ? new Date(c.update_time).getTime() : 0;` |
| MEDIUM | `backend/lib/nurture-engine.js` | 121 | new Date() on potentially null value without guard | `const renewalTime = new Date(o.renewal_date).getTime();` |
| MEDIUM | `backend/lib/nurture-engine.js` | 276 | Empty catch block (swallowed error) | `try { return JSON.parse(jsonMatch[0]); } catch { /* fall through */ }` |
| HIGH | `backend/lib/outreach-deploy.js` | 79 | fetch() without res.ok check before .json() | `const r = await fetch('https://api.apollo.io/v1/emailer_campaigns', {` |
| HIGH | `backend/lib/outreach-deploy.js` | 124 | fetch() without res.ok check before .json() | `const r = await fetch(`https://api.instantly.ai/api/v1/campaign/step/add?api_key` |
| MEDIUM | `backend/lib/reporting-agent.js` | 143 | Empty catch block (swallowed error) | `} catch { /* ignore notification errors */ }` |
| MEDIUM | `backend/lib/response-analysis-agent.js` | 58 | new Date() on potentially null value without guard | `const sentAt = new Date(email.sent_at).getTime();` |
| MEDIUM | `backend/lib/response-analysis-agent.js` | 60 | new Date() on potentially null value without guard | `const actDate = a.dueDate ? new Date(a.dueDate).getTime() : 0;` |
| HIGH | `backend/lib/response-analysis-agent.js` | 272 | JSON.parse without try/catch | `if (match) return JSON.parse(match[0]);` |
| MEDIUM | `backend/lib/response-analysis-agent.js` | 273 | Empty catch block (swallowed error) | `} catch { /* fallback below */ }` |
| HIGH | `backend/lib/template-agent.js` | 169 | JSON.parse without try/catch | `if (match) template = JSON.parse(match[0]);` |
| HIGH | `backend/lib/vector-store.js` | 190 | fetch() without res.ok check before .json() | `const res = await fetch('https://api.voyageai.com/v1/embeddings', {` |
| HIGH | `backend/lib/web-prospect-agent.js` | 169 | JSON.parse without try/catch | `const parsed = JSON.parse(jsonMatch[0]);` |
| HIGH | `backend/api/airtable-crm.js` | 18 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/apollo.js` | 24 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/brave-search.js` | 30 | fetch() without res.ok check before .json() | `const res = await fetch(`${BASE_URL}?${params}`, {` |
| HIGH | `backend/api/folk.js` | 15 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/hubspot.js` | 15 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/informz.js` | 73 | fetch() without res.ok check before .json() | `const res = await fetch(endpoint, {` |
| HIGH | `backend/api/instantly.js` | 28 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/lagrowthmachine.js` | 25 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/lemlist.js` | 15 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| MEDIUM | `backend/api/lemlist.js` | 647 | Empty catch block (swallowed error) | `} catch { /* logger optional */ }` |
| MEDIUM | `backend/api/lemlist.js` | 687 | Empty catch block (swallowed error) | `} catch { /* logger optional */ }` |
| HIGH | `backend/api/lemlist.js` | 749 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/linkedin.js` | 56 | fetch() without res.ok check before .json() | `const res = await fetch(`${VOYAGER_BASE}${endpoint}`, {` |
| HIGH | `backend/api/odoo.js` | 20 | fetch() without res.ok check before .json() | `const res = await fetch(`${url}/jsonrpc`, {` |
| HIGH | `backend/api/pipedrive.js` | 16 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/salesforce.js` | 13 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/waalaxy.js` | 25 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `frontend/src/components/AuthGate.jsx` | 214 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/forgot-password', {` |
| LOW | `frontend/src/components/FieldMappingSettings.jsx` | 47 | Hardcoded CRM provider list (may be incomplete) | `const crmProviders = ['pipedrive', 'hubspot', 'salesforce'];` |
| MEDIUM | `frontend/src/components/ICPInsightsCard.jsx` | 201 | new Date() on potentially null value without guard | `{new Date(data.analyzedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: ` |
| MEDIUM | `frontend/src/components/OnboardingChecklist.jsx` | 47 | Empty catch block (swallowed error) | `} catch { /* checklist won't show */ }` |
| MEDIUM | `frontend/src/components/TeamSettings.jsx` | 53 | Native alert()/prompt() in frontend | `alert(err.message);` |
| MEDIUM | `frontend/src/components/TeamSettings.jsx` | 74 | Native alert()/prompt() in frontend | `alert(err.message);` |
| MEDIUM | `frontend/src/components/TeamSettings.jsx` | 84 | Native alert()/prompt() in frontend | `alert(err.message);` |
| MEDIUM | `frontend/src/components/TeamSettings.jsx` | 93 | Native alert()/prompt() in frontend | `alert(err.message);` |
| HIGH | `frontend/src/components/VariableManager.jsx` | 378 | JSON.parse without try/catch | `initialRegistry ? JSON.parse(JSON.stringify(initialRegistry)) : JSON.parse(JSON.` |
| MEDIUM | `frontend/src/components/campaigns/CampaignDetailLayout.jsx` | 94 | Native alert()/prompt() in frontend | `window.alert(t('campaigns.archiveFailed', { error: err.message \|\| 'erreur inco` |
| MEDIUM | `frontend/src/components/campaigns/tabs/RepliesTab.jsx` | 125 | new Date() on potentially null value without guard | `const happenedAt = a.happened_at ? new Date(a.happened_at) : null;` |
| MEDIUM | `frontend/src/components/editor/__tests__/editor-helpers.test.js` | 14 | Native alert()/prompt() in frontend | `expect(escapeHtml('<script>alert("xss")</script>')).toBe(` |
| MEDIUM | `frontend/src/components/editor/__tests__/editor-helpers.test.js` | 15 | Native alert()/prompt() in frontend | `'&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'` |
| MEDIUM | `frontend/src/pages/CampaignsList.jsx` | 114 | Native alert()/prompt() in frontend | `window.alert(t('campaigns.errorPrefix', { message: err.message }));` |
| MEDIUM | `frontend/src/pages/CampaignsList.jsx` | 132 | Native alert()/prompt() in frontend | `window.alert(t('campaigns.errorPrefix', { message: err.message }));` |
| MEDIUM | `frontend/src/pages/CampaignsList.jsx` | 517 | new Date() on potentially null value without guard | `{en ? 'Sends at:' : 'Envoi à :'} {new Date(q.scheduled_at).toLocaleString(en ? '` |
| MEDIUM | `frontend/src/pages/CampaignsList.jsx` | 551 | new Date() on potentially null value without guard | `{en ? 'Sent:' : 'Envoyé :'} {new Date(q.sent_at).toLocaleString(en ? 'en-US' : '` |
| HIGH | `frontend/src/pages/ChatPage.jsx` | 1975 | JSON.parse without try/catch | `metadata: m.metadata ? (typeof m.metadata === 'string' ? JSON.parse(m.metadata) ` |
| MEDIUM | `frontend/src/pages/ClientsPage.jsx` | 582 | Native alert()/prompt() in frontend | `const subject = prompt('Objet de l\'email :');` |
| MEDIUM | `frontend/src/pages/ClientsPage.jsx` | 584 | Native alert()/prompt() in frontend | `const body = prompt('Message :');` |
| HIGH | `frontend/src/pages/CopyEditorPage.jsx` | 805 | JSON.parse without try/catch | `const copy = { ...JSON.parse(JSON.stringify(original)), id: tpId + '-copy', labe` |
| MEDIUM | `frontend/src/pages/MembershipPage.jsx` | 136 | new Date() on potentially null value without guard | `<div style={{ fontWeight: 600 }}>{new Date(r.renewal_date).toLocaleDateString(en` |
| MEDIUM | `frontend/src/pages/MemoryExplorerPage.jsx` | 392 | new Date() on potentially null value without guard | `<span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>{e.sen` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 103 | Native alert()/prompt() in frontend | `alert((lang === 'en' ? 'Error: ' : 'Erreur: ') + err.message);` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 166 | Native alert()/prompt() in frontend | `alert((lang === 'en' ? 'Error: ' : 'Erreur: ') + err.message);` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 285 | Native alert()/prompt() in frontend | `alert((lang === 'en' ? 'Error: ' : 'Erreur: ') + err.message);` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 416 | new Date() on potentially null value without guard | `{trigger.last_run && ` \u00B7 ${lang === 'en' ? 'Last run:' : 'Dernier run :'} $` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 473 | Native alert()/prompt() in frontend | `alert((en ? 'Error: ' : 'Erreur: ') + err.message);` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 525 | new Date() on potentially null value without guard | `{email.sent_at && ` \u00B7 ${en ? 'Sent on' : 'Envoy\u00E9 le'} ${new Date(email` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 766 | new Date() on potentially null value without guard | `{e.sent_at ? new Date(e.sent_at).toLocaleDateString(en ? 'en-US' : 'fr-FR', { da` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 1015 | new Date() on potentially null value without guard | `{en ? 'by' : 'par'} {c.created_by_name} {'\u00B7'} {new Date(c.created_at).toLoc` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 1207 | new Date() on potentially null value without guard | `{en ? 'Scheduled:' : 'Planifié :'} {new Date(q.scheduled_at).toLocaleString(lang` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 1243 | new Date() on potentially null value without guard | `{en ? 'Sent:' : 'Envoyé :'} {new Date(q.sent_at).toLocaleString(lang === 'en' ? ` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 1310 | new Date() on potentially null value without guard | `{test.startedAt ? new Date(test.startedAt).toLocaleDateString(en ? 'en-US' : 'fr` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 1501 | new Date() on potentially null value without guard | `{e.to} &middot; {new Date(e.createdAt).toLocaleDateString(en ? 'en-US' : 'fr-FR'` |
| HIGH | `frontend/src/pages/ProfilePage.jsx` | 127 | fetch() without res.ok check before .json() | `const res = await fetch('/api/profile', {` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 256 | Native alert()/prompt() in frontend | `alert((en ? 'Reparse failed for all docs:\n\n' : 'Reparse a échoué pour tous les` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 260 | Native alert()/prompt() in frontend | `alert((en ? 'Error: ' : 'Erreur: ') + err.message);` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 263 | Native alert()/prompt() in frontend | `alert('Auto-fill: ' + err.message);` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 469 | new Date() on potentially null value without guard | `{new Date(doc.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: '` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 476 | Empty catch block (swallowed error) | `} catch {}` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 746 | new Date() on potentially null value without guard | `<span style={{ color: 'var(--text-muted)', fontSize: 10 }}>{new Date(doc.created` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 747 | Empty catch block (swallowed error) | `<button onClick={async () => { try { await request('/documents/' + doc.id, { met` |
| MEDIUM | `frontend/src/pages/RecosPage.jsx` | 67 | new Date() on potentially null value without guard | `date: d.created_at ? new Date(d.created_at).toLocaleDateString('fr-FR', { day: '` |
| HIGH | `frontend/src/pages/ResetPasswordPage.jsx` | 129 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/reset-password', {` |
| HIGH | `frontend/src/pages/SettingsPage.jsx` | 136 | JSON.parse without try/catch | `return saved ? { ...DEFAULT_PREFERENCES, ...JSON.parse(saved) } : { ...DEFAULT_P` |
| HIGH | `frontend/src/pages/SettingsPage.jsx` | 1007 | JSON.parse without try/catch | `const user = JSON.parse(localStorage.getItem('bakal_user') \|\| '{}');` |
| MEDIUM | `frontend/src/pages/SignalsPage.jsx` | 308 | new Date() on potentially null value without guard | `<span>{new Date(s.detected_at).toLocaleDateString(en ? 'en-US' : 'fr-FR', { day:` |
| MEDIUM | `frontend/src/pages/SignalsPage.jsx` | 452 | new Date() on potentially null value without guard | `{new Date(s.detected_at).toLocaleDateString(en ? 'en-US' : 'fr-FR', { day: 'nume` |
| MEDIUM | `frontend/src/pages/SignalsPage.jsx` | 585 | new Date() on potentially null value without guard | `{c.last_run && <span>{en ? 'Last scan' : 'Dernier scan'}: {new Date(c.last_run).` |
| HIGH | `frontend/src/services/api-client.js` | 23 | fetch() without res.ok check before .json() | `let res = await fetch(url, { headers, ...opts });` |
| HIGH | `frontend/src/services/api-client.js` | 31 | fetch() without res.ok check before .json() | `res = await fetch(url, { headers, ...opts });` |
| HIGH | `frontend/src/services/api-client.js` | 110 | JSON.parse without try/catch | `? (typeof c.ab_config === 'string' ? JSON.parse(c.ab_config) : c.ab_config)` |
| MEDIUM | `frontend/src/services/api-client.js` | 115 | new Date() on potentially null value without guard | `createdDate: c.created_at ? new Date(c.created_at).toLocaleDateString('fr-FR', {` |
| HIGH | `frontend/src/services/api-client.js` | 716 | fetch() without res.ok check before .json() | `const res = await fetch(url, { method: 'POST', headers, body: formData });` |
| HIGH | `frontend/src/services/auth.js` | 53 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/login', {` |
| HIGH | `frontend/src/services/auth.js` | 77 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/register', {` |
| HIGH | `frontend/src/services/auth.js` | 95 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/resend-verification', {` |
| HIGH | `frontend/src/services/auth.js` | 116 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/refresh', {` |
| HIGH | `frontend/src/services/auth.js` | 144 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/account', {` |
| HIGH | `frontend/src/services/auth.js` | 161 | fetch() without res.ok check before .json() | `await fetch('/api/auth/logout', {` |

### Automated Audit — 2026-06-16

Found 184 potential issue(s):

| Severity | File | Line | Pattern | Code |
|----------|------|------|---------|------|
| HIGH | `backend/routes/ai.js` | 438 | JSON.parse without try/catch | `const data = typeof pattern.data === 'string' ? JSON.parse(pattern.data) : (patt` |
| MEDIUM | `backend/routes/ai.js` | 439 | new Date() on potentially null value without guard | `const age = Math.round((Date.now() - new Date(pattern.date_discovered).getTime()` |
| MEDIUM | `backend/routes/ai.js` | 525 | Empty catch block (swallowed error) | `} catch { /* solo user */ }` |
| MEDIUM | `backend/routes/ai.js` | 703 | Empty catch block (swallowed error) | `try { campaignMap[cid] = await db.campaigns.get(cid); } catch {}` |
| HIGH | `backend/routes/ai.js` | 861 | JSON.parse without try/catch | `const config = typeof campaign.ab_config === 'string' ? JSON.parse(campaign.ab_c` |
| MEDIUM | `backend/routes/analytics.js` | 102 | new Date() on potentially null value without guard | `const updatedAt = opp.updated_at ? new Date(opp.updated_at).getTime() : now;` |
| MEDIUM | `backend/routes/analytics.js` | 103 | new Date() on potentially null value without guard | `const createdAt = opp.created_at ? new Date(opp.created_at).getTime() : now;` |
| MEDIUM | `backend/routes/analytics.js` | 578 | new Date() on potentially null value without guard | `const create = new Date(o.created_at).getTime();` |
| MEDIUM | `backend/routes/analytics.js` | 651 | new Date() on potentially null value without guard | `const updatedAt = opp.updated_at ? new Date(opp.updated_at).getTime() : now;` |
| MEDIUM | `backend/routes/analytics.js` | 742 | new Date() on potentially null value without guard | `const stale = activeOpps.filter(o => { const u = o.updated_at ? new Date(o.updat` |
| MEDIUM | `backend/routes/auth.js` | 270 | Empty catch block (swallowed error) | `} catch { /* no team */ }` |
| MEDIUM | `backend/routes/auth.js` | 497 | Empty catch block (swallowed error) | `} catch { /* no team — ok */ }` |
| MEDIUM | `backend/routes/campaigns.js` | 237 | new Date() on potentially null value without guard | `const lastOpt = campaign.last_optimized_at ? new Date(campaign.last_optimized_at` |
| MEDIUM | `backend/routes/chat.js` | 251 | Empty catch block (swallowed error) | `} catch { /* default to fr */ }` |
| MEDIUM | `backend/routes/chat.js` | 324 | new Date() on potentially null value without guard | `new Date(c.created_at).getTime() > sixtyAgo` |
| LOW | `backend/routes/chat.js` | 450 | Hardcoded CRM provider list (may be incomplete) | `const providers = ['pipedrive', 'hubspot', 'salesforce', 'odoo'];` |
| HIGH | `backend/routes/crm.js` | 316 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| HIGH | `backend/routes/crm.js` | 349 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| HIGH | `backend/routes/crm.js` | 365 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| HIGH | `backend/routes/crm.js` | 713 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| HIGH | `backend/routes/crm.js` | 742 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| LOW | `backend/routes/crm.js` | 1034 | Hardcoded CRM provider list (may be incomplete) | `for (const provider of ['pipedrive', 'salesforce', 'hubspot']) {` |
| MEDIUM | `backend/routes/crm.js` | 1045 | Empty catch block (swallowed error) | `} catch { /* scoring works without deals */ }` |
| HIGH | `backend/routes/crm.js` | 1354 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| HIGH | `backend/routes/crm.js` | 1368 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| MEDIUM | `backend/routes/crm.js` | 1398 | Empty catch block (swallowed error) | `} catch { /* skip individual failures */ }` |
| MEDIUM | `backend/routes/documents.js` | 141 | Empty catch block (swallowed error) | `try { fs.unlinkSync(file.path); } catch {}` |
| MEDIUM | `backend/routes/documents.js` | 244 | Empty catch block (swallowed error) | `try { fs.unlinkSync(tempPath); } catch {}` |
| HIGH | `backend/routes/export.js` | 199 | JSON.parse without try/catch | `? JSON.parse(o.score_breakdown \|\| '{}')` |
| MEDIUM | `backend/routes/extension.js` | 62 | Empty catch block (swallowed error) | `} catch { /* optional */ }` |
| HIGH | `backend/routes/extension.js` | 102 | JSON.parse without try/catch | `const data = (typeof opp.data === 'string' ? JSON.parse(opp.data) : opp.data) \|` |
| HIGH | `backend/routes/extension.js` | 143 | JSON.parse without try/catch | `const data = (typeof opp.data === 'string' ? JSON.parse(opp.data) : opp.data) \|` |
| HIGH | `backend/routes/informz.js` | 67 | JSON.parse without try/catch | `if (m) parsed = JSON.parse(m[0]);` |
| HIGH | `backend/routes/informz.js` | 210 | JSON.parse without try/catch | `if (m) parsed = JSON.parse(m[0]);` |
| MEDIUM | `backend/routes/nurture.js` | 346 | Empty catch block (swallowed error) | `} catch { /* optional */ }` |
| MEDIUM | `backend/routes/nurture.js` | 359 | Empty catch block (swallowed error) | `if (m) { try { sampleEmail = JSON.parse(m[0]); } catch { /* malformed JSON */ } ` |
| MEDIUM | `backend/routes/nurture.js` | 361 | Empty catch block (swallowed error) | `} catch { /* skip preview generation */ }` |
| HIGH | `backend/routes/nurture.js` | 432 | fetch() without res.ok check before .json() | `const tokenRes = await fetch('https://oauth2.googleapis.com/token', {` |
| HIGH | `backend/routes/nurture.js` | 522 | fetch() without res.ok check before .json() | `const tokenRes = await fetch('https://login.microsoftonline.com/common/oauth2/v2` |
| HIGH | `backend/routes/settings.js` | 375 | JSON.parse without try/catch | `const currentMeta = typeof existing.metadata === 'string' ? JSON.parse(existing.` |
| HIGH | `backend/routes/signals.js` | 166 | JSON.parse without try/catch | `if (m) email = JSON.parse(m[0]);` |
| HIGH | `backend/routes/signals.js` | 351 | JSON.parse without try/catch | `if (m) sequence = JSON.parse(m[0]);` |
| HIGH | `backend/routes/stats.js` | 23 | fetch() without res.ok check before .json() | `const resp = await fetch(url, options);` |
| HIGH | `backend/routes/team-campaigns.js` | 136 | JSON.parse without try/catch | `if (m) sampleEmail = JSON.parse(m[0]);` |
| MEDIUM | `backend/routes/team-campaigns.js` | 202 | Empty catch block (swallowed error) | `if (m) { try { email = JSON.parse(m[0]); } catch { /* malformed AI response */ }` |
| HIGH | `backend/lib/ab-memory.js` | 187 | JSON.parse without try/catch | `const data = typeof top.data === 'string' ? JSON.parse(top.data) : (top.data \|\` |
| MEDIUM | `backend/lib/agent-chains.js` | 338 | Empty catch block (swallowed error) | `} catch { /* no product lines */ }` |
| MEDIUM | `backend/lib/agent-chains.js` | 360 | Empty catch block (swallowed error) | `} catch { /* ok */ }` |
| MEDIUM | `backend/lib/agents/signal-agent.js` | 125 | Empty catch block (swallowed error) | `} catch { /* enrichment is optional */ }` |
| MEDIUM | `backend/lib/agents/signal-agent.js` | 181 | Empty catch block (swallowed error) | `} catch { /* notifications are optional */ }` |
| MEDIUM | `backend/lib/agents/signal-agent.js` | 206 | Empty catch block (swallowed error) | `} catch { /* skip duplicates */ }` |
| MEDIUM | `backend/lib/agents/signal-agent.js` | 212 | Empty catch block (swallowed error) | `} catch { /* auto-prospecting is optional */ }` |
| HIGH | `backend/lib/agents/signal-agent.js` | 289 | fetch() without res.ok check before .json() | `const res = await fetch('https://api.apollo.io/v1/mixed_people/search', {` |
| MEDIUM | `backend/lib/agents/timing-agent.js` | 99 | new Date() on potentially null value without guard | `const replied = new Date(r.replied_at).getTime();` |
| MEDIUM | `backend/lib/agents/timing-agent.js` | 163 | new Date() on potentially null value without guard | `const sent = new Date(r.sent_at).getTime();` |
| MEDIUM | `backend/lib/agents/timing-agent.js` | 164 | new Date() on potentially null value without guard | `const resp = new Date(r.response_at).getTime();` |
| MEDIUM | `backend/lib/churn-scoring.js` | 85 | new Date() on potentially null value without guard | `const age = (now - new Date(e.created_at).getTime()) / DAY_MS;` |
| MEDIUM | `backend/lib/conversation-autopilot.js` | 190 | Empty catch block (swallowed error) | `try { return JSON.parse(match[0]); } catch { /* fallthrough */ }` |
| MEDIUM | `backend/lib/conversation-autopilot.js` | 319 | new Date() on potentially null value without guard | `return history.sort((a, b) => new Date(a.date) - new Date(b.date));` |
| MEDIUM | `backend/lib/crm-agent.js` | 62 | Empty catch block (swallowed error) | `} catch { /* solo user, no team */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 177 | Empty catch block (swallowed error) | `} catch { /* ok */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 205 | Empty catch block (swallowed error) | `} catch { /* notification is non-blocking */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 283 | Empty catch block (swallowed error) | `} catch { /* owner mapping is optional */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 350 | Empty catch block (swallowed error) | `} catch { /* mapping is optional */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 379 | Empty catch block (swallowed error) | `} catch { /* deal sync is optional */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 548 | Empty catch block (swallowed error) | `} catch { /* fallback to 50/50 */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 637 | Empty catch block (swallowed error) | `} catch { /* patterns optional */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 677 | Empty catch block (swallowed error) | `} catch { /* fallback to single */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 694 | Empty catch block (swallowed error) | `} catch { /* fallback below */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 772 | new Date() on potentially null value without guard | `.map(o => (new Date(o.updated_at).getTime() - new Date(o.created_at).getTime()) ` |
| MEDIUM | `backend/lib/crm-agent.js` | 794 | new Date() on potentially null value without guard | `.map(o => (new Date(o.updated_at).getTime() - new Date(o.created_at).getTime()) ` |
| MEDIUM | `backend/lib/crm-agent.js` | 864 | Empty catch block (swallowed error) | `} catch { /* optional */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 893 | Empty catch block (swallowed error) | `} catch { /* optional */ }` |
| MEDIUM | `backend/lib/crm-bidirectional-sync.js` | 84 | new Date() on potentially null value without guard | `const lastPush = opp.score_pushed_at ? new Date(opp.score_pushed_at).getTime() :` |
| MEDIUM | `backend/lib/crm-bidirectional-sync.js` | 93 | Empty catch block (swallowed error) | `} catch { /* ignore individual push errors */ }` |
| HIGH | `backend/lib/crm-export.js` | 23 | fetch() without res.ok check before .json() | `const res = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {` |
| HIGH | `backend/lib/crm-export.js` | 51 | fetch() without res.ok check before .json() | `const res = await fetch(`${instanceUrl}/services/data/v62.0/sobjects/Contact`, {` |
| HIGH | `backend/lib/crm-export.js` | 76 | fetch() without res.ok check before .json() | `const res = await fetch(`https://api.pipedrive.com/v1/persons?api_token=${apiKey` |
| HIGH | `backend/lib/crm-export.js` | 90 | fetch() without res.ok check before .json() | `await fetch(`https://api.pipedrive.com/v1/notes?api_token=${apiKey}`, {` |
| MEDIUM | `backend/lib/crm-owner-resolver.js` | 32 | Empty catch block (swallowed error) | `} catch { /* no team = solo user */ }` |
| MEDIUM | `backend/lib/deliverability-agent.js` | 200 | Empty catch block (swallowed error) | `} catch { /* notification is best-effort */ }` |
| HIGH | `backend/lib/email-outbound.js` | 117 | fetch() without res.ok check before .json() | `const res = await fetch(tokenUrl, {` |
| HIGH | `backend/lib/email.js` | 16 | fetch() without res.ok check before .json() | `const res = await fetch('https://api.resend.com/emails', {` |
| MEDIUM | `backend/lib/enrich-agent.js` | 210 | Empty catch block (swallowed error) | `} catch { /* Brave search failed */ }` |
| HIGH | `backend/lib/enrich-agent.js` | 241 | JSON.parse without try/catch | `return JSON.parse(match[0]);` |
| MEDIUM | `backend/lib/enrich-agent.js` | 336 | Empty catch block (swallowed error) | `} catch { /* verification failed, keep the email */ }` |
| MEDIUM | `backend/lib/enrich-agent.js` | 375 | Empty catch block (swallowed error) | `} catch { /* continue */ }` |
| HIGH | `backend/lib/enrich-agent.js` | 411 | JSON.parse without try/catch | `const parsed = JSON.parse(match[0]);` |
| HIGH | `backend/lib/icp-agent.js` | 170 | JSON.parse without try/catch | `const data = typeof userIcp.data === 'string' ? JSON.parse(userIcp.data) : userI` |
| HIGH | `backend/lib/lifecycle-emails.js` | 188 | JSON.parse without try/catch | `const userData = (typeof user.data === 'string' ? JSON.parse(user.data) : user.d` |
| MEDIUM | `backend/lib/lifecycle-emails.js` | 190 | new Date() on potentially null value without guard | `const daysSinceSignup = Math.floor((Date.now() - new Date(user.created_at).getTi` |
| HIGH | `backend/lib/lifecycle-emails.js` | 240 | JSON.parse without try/catch | `const userData = (typeof user.data === 'string' ? JSON.parse(user.data) : user.d` |
| MEDIUM | `backend/lib/nurture-engine.js` | 78 | new Date() on potentially null value without guard | `const dealAge = (Date.now() - new Date(deal.createdAt).getTime()) / DAY_MS;` |
| MEDIUM | `backend/lib/nurture-engine.js` | 104 | new Date() on potentially null value without guard | `const lastUpdate = c.update_time ? new Date(c.update_time).getTime() : 0;` |
| MEDIUM | `backend/lib/nurture-engine.js` | 121 | new Date() on potentially null value without guard | `const renewalTime = new Date(o.renewal_date).getTime();` |
| MEDIUM | `backend/lib/nurture-engine.js` | 276 | Empty catch block (swallowed error) | `try { return JSON.parse(jsonMatch[0]); } catch { /* fall through */ }` |
| HIGH | `backend/lib/outreach-deploy.js` | 79 | fetch() without res.ok check before .json() | `const r = await fetch('https://api.apollo.io/v1/emailer_campaigns', {` |
| HIGH | `backend/lib/outreach-deploy.js` | 124 | fetch() without res.ok check before .json() | `const r = await fetch(`https://api.instantly.ai/api/v1/campaign/step/add?api_key` |
| MEDIUM | `backend/lib/reporting-agent.js` | 143 | Empty catch block (swallowed error) | `} catch { /* ignore notification errors */ }` |
| MEDIUM | `backend/lib/response-analysis-agent.js` | 58 | new Date() on potentially null value without guard | `const sentAt = new Date(email.sent_at).getTime();` |
| MEDIUM | `backend/lib/response-analysis-agent.js` | 60 | new Date() on potentially null value without guard | `const actDate = a.dueDate ? new Date(a.dueDate).getTime() : 0;` |
| HIGH | `backend/lib/response-analysis-agent.js` | 272 | JSON.parse without try/catch | `if (match) return JSON.parse(match[0]);` |
| MEDIUM | `backend/lib/response-analysis-agent.js` | 273 | Empty catch block (swallowed error) | `} catch { /* fallback below */ }` |
| HIGH | `backend/lib/template-agent.js` | 169 | JSON.parse without try/catch | `if (match) template = JSON.parse(match[0]);` |
| HIGH | `backend/lib/vector-store.js` | 190 | fetch() without res.ok check before .json() | `const res = await fetch('https://api.voyageai.com/v1/embeddings', {` |
| HIGH | `backend/lib/web-prospect-agent.js` | 169 | JSON.parse without try/catch | `const parsed = JSON.parse(jsonMatch[0]);` |
| HIGH | `backend/api/airtable-crm.js` | 18 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/apollo.js` | 24 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/brave-search.js` | 30 | fetch() without res.ok check before .json() | `const res = await fetch(`${BASE_URL}?${params}`, {` |
| HIGH | `backend/api/folk.js` | 15 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/hubspot.js` | 15 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/informz.js` | 73 | fetch() without res.ok check before .json() | `const res = await fetch(endpoint, {` |
| HIGH | `backend/api/instantly.js` | 28 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/lagrowthmachine.js` | 25 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/lemlist.js` | 15 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| MEDIUM | `backend/api/lemlist.js` | 647 | Empty catch block (swallowed error) | `} catch { /* logger optional */ }` |
| MEDIUM | `backend/api/lemlist.js` | 687 | Empty catch block (swallowed error) | `} catch { /* logger optional */ }` |
| HIGH | `backend/api/lemlist.js` | 749 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/linkedin.js` | 56 | fetch() without res.ok check before .json() | `const res = await fetch(`${VOYAGER_BASE}${endpoint}`, {` |
| HIGH | `backend/api/odoo.js` | 20 | fetch() without res.ok check before .json() | `const res = await fetch(`${url}/jsonrpc`, {` |
| HIGH | `backend/api/pipedrive.js` | 16 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/salesforce.js` | 13 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/waalaxy.js` | 25 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `frontend/src/components/AuthGate.jsx` | 214 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/forgot-password', {` |
| LOW | `frontend/src/components/FieldMappingSettings.jsx` | 47 | Hardcoded CRM provider list (may be incomplete) | `const crmProviders = ['pipedrive', 'hubspot', 'salesforce'];` |
| MEDIUM | `frontend/src/components/ICPInsightsCard.jsx` | 201 | new Date() on potentially null value without guard | `{new Date(data.analyzedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: ` |
| MEDIUM | `frontend/src/components/OnboardingChecklist.jsx` | 47 | Empty catch block (swallowed error) | `} catch { /* checklist won't show */ }` |
| MEDIUM | `frontend/src/components/TeamSettings.jsx` | 53 | Native alert()/prompt() in frontend | `alert(err.message);` |
| MEDIUM | `frontend/src/components/TeamSettings.jsx` | 74 | Native alert()/prompt() in frontend | `alert(err.message);` |
| MEDIUM | `frontend/src/components/TeamSettings.jsx` | 84 | Native alert()/prompt() in frontend | `alert(err.message);` |
| MEDIUM | `frontend/src/components/TeamSettings.jsx` | 93 | Native alert()/prompt() in frontend | `alert(err.message);` |
| HIGH | `frontend/src/components/VariableManager.jsx` | 378 | JSON.parse without try/catch | `initialRegistry ? JSON.parse(JSON.stringify(initialRegistry)) : JSON.parse(JSON.` |
| MEDIUM | `frontend/src/components/campaigns/CampaignDetailLayout.jsx` | 94 | Native alert()/prompt() in frontend | `window.alert(t('campaigns.archiveFailed', { error: err.message \|\| 'erreur inco` |
| MEDIUM | `frontend/src/components/campaigns/tabs/RepliesTab.jsx` | 125 | new Date() on potentially null value without guard | `const happenedAt = a.happened_at ? new Date(a.happened_at) : null;` |
| MEDIUM | `frontend/src/components/editor/__tests__/editor-helpers.test.js` | 14 | Native alert()/prompt() in frontend | `expect(escapeHtml('<script>alert("xss")</script>')).toBe(` |
| MEDIUM | `frontend/src/components/editor/__tests__/editor-helpers.test.js` | 15 | Native alert()/prompt() in frontend | `'&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'` |
| MEDIUM | `frontend/src/pages/CampaignsList.jsx` | 114 | Native alert()/prompt() in frontend | `window.alert(t('campaigns.errorPrefix', { message: err.message }));` |
| MEDIUM | `frontend/src/pages/CampaignsList.jsx` | 132 | Native alert()/prompt() in frontend | `window.alert(t('campaigns.errorPrefix', { message: err.message }));` |
| MEDIUM | `frontend/src/pages/CampaignsList.jsx` | 517 | new Date() on potentially null value without guard | `{en ? 'Sends at:' : 'Envoi à :'} {new Date(q.scheduled_at).toLocaleString(en ? '` |
| MEDIUM | `frontend/src/pages/CampaignsList.jsx` | 551 | new Date() on potentially null value without guard | `{en ? 'Sent:' : 'Envoyé :'} {new Date(q.sent_at).toLocaleString(en ? 'en-US' : '` |
| HIGH | `frontend/src/pages/ChatPage.jsx` | 1975 | JSON.parse without try/catch | `metadata: m.metadata ? (typeof m.metadata === 'string' ? JSON.parse(m.metadata) ` |
| MEDIUM | `frontend/src/pages/ClientsPage.jsx` | 582 | Native alert()/prompt() in frontend | `const subject = prompt('Objet de l\'email :');` |
| MEDIUM | `frontend/src/pages/ClientsPage.jsx` | 584 | Native alert()/prompt() in frontend | `const body = prompt('Message :');` |
| HIGH | `frontend/src/pages/CopyEditorPage.jsx` | 805 | JSON.parse without try/catch | `const copy = { ...JSON.parse(JSON.stringify(original)), id: tpId + '-copy', labe` |
| MEDIUM | `frontend/src/pages/MembershipPage.jsx` | 136 | new Date() on potentially null value without guard | `<div style={{ fontWeight: 600 }}>{new Date(r.renewal_date).toLocaleDateString(en` |
| MEDIUM | `frontend/src/pages/MemoryExplorerPage.jsx` | 392 | new Date() on potentially null value without guard | `<span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>{e.sen` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 103 | Native alert()/prompt() in frontend | `alert((lang === 'en' ? 'Error: ' : 'Erreur: ') + err.message);` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 166 | Native alert()/prompt() in frontend | `alert((lang === 'en' ? 'Error: ' : 'Erreur: ') + err.message);` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 285 | Native alert()/prompt() in frontend | `alert((lang === 'en' ? 'Error: ' : 'Erreur: ') + err.message);` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 416 | new Date() on potentially null value without guard | `{trigger.last_run && ` \u00B7 ${lang === 'en' ? 'Last run:' : 'Dernier run :'} $` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 473 | Native alert()/prompt() in frontend | `alert((en ? 'Error: ' : 'Erreur: ') + err.message);` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 525 | new Date() on potentially null value without guard | `{email.sent_at && ` \u00B7 ${en ? 'Sent on' : 'Envoy\u00E9 le'} ${new Date(email` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 766 | new Date() on potentially null value without guard | `{e.sent_at ? new Date(e.sent_at).toLocaleDateString(en ? 'en-US' : 'fr-FR', { da` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 1015 | new Date() on potentially null value without guard | `{en ? 'by' : 'par'} {c.created_by_name} {'\u00B7'} {new Date(c.created_at).toLoc` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 1207 | new Date() on potentially null value without guard | `{en ? 'Scheduled:' : 'Planifié :'} {new Date(q.scheduled_at).toLocaleString(lang` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 1243 | new Date() on potentially null value without guard | `{en ? 'Sent:' : 'Envoyé :'} {new Date(q.sent_at).toLocaleString(lang === 'en' ? ` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 1310 | new Date() on potentially null value without guard | `{test.startedAt ? new Date(test.startedAt).toLocaleDateString(en ? 'en-US' : 'fr` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 1501 | new Date() on potentially null value without guard | `{e.to} &middot; {new Date(e.createdAt).toLocaleDateString(en ? 'en-US' : 'fr-FR'` |
| HIGH | `frontend/src/pages/ProfilePage.jsx` | 127 | fetch() without res.ok check before .json() | `const res = await fetch('/api/profile', {` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 256 | Native alert()/prompt() in frontend | `alert((en ? 'Reparse failed for all docs:\n\n' : 'Reparse a échoué pour tous les` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 260 | Native alert()/prompt() in frontend | `alert((en ? 'Error: ' : 'Erreur: ') + err.message);` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 263 | Native alert()/prompt() in frontend | `alert('Auto-fill: ' + err.message);` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 469 | new Date() on potentially null value without guard | `{new Date(doc.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: '` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 476 | Empty catch block (swallowed error) | `} catch {}` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 746 | new Date() on potentially null value without guard | `<span style={{ color: 'var(--text-muted)', fontSize: 10 }}>{new Date(doc.created` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 747 | Empty catch block (swallowed error) | `<button onClick={async () => { try { await request('/documents/' + doc.id, { met` |
| MEDIUM | `frontend/src/pages/RecosPage.jsx` | 67 | new Date() on potentially null value without guard | `date: d.created_at ? new Date(d.created_at).toLocaleDateString('fr-FR', { day: '` |
| HIGH | `frontend/src/pages/ResetPasswordPage.jsx` | 129 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/reset-password', {` |
| HIGH | `frontend/src/pages/SettingsPage.jsx` | 136 | JSON.parse without try/catch | `return saved ? { ...DEFAULT_PREFERENCES, ...JSON.parse(saved) } : { ...DEFAULT_P` |
| HIGH | `frontend/src/pages/SettingsPage.jsx` | 1007 | JSON.parse without try/catch | `const user = JSON.parse(localStorage.getItem('bakal_user') \|\| '{}');` |
| MEDIUM | `frontend/src/pages/SignalsPage.jsx` | 308 | new Date() on potentially null value without guard | `<span>{new Date(s.detected_at).toLocaleDateString(en ? 'en-US' : 'fr-FR', { day:` |
| MEDIUM | `frontend/src/pages/SignalsPage.jsx` | 452 | new Date() on potentially null value without guard | `{new Date(s.detected_at).toLocaleDateString(en ? 'en-US' : 'fr-FR', { day: 'nume` |
| MEDIUM | `frontend/src/pages/SignalsPage.jsx` | 585 | new Date() on potentially null value without guard | `{c.last_run && <span>{en ? 'Last scan' : 'Dernier scan'}: {new Date(c.last_run).` |
| HIGH | `frontend/src/services/api-client.js` | 23 | fetch() without res.ok check before .json() | `let res = await fetch(url, { headers, ...opts });` |
| HIGH | `frontend/src/services/api-client.js` | 31 | fetch() without res.ok check before .json() | `res = await fetch(url, { headers, ...opts });` |
| HIGH | `frontend/src/services/api-client.js` | 110 | JSON.parse without try/catch | `? (typeof c.ab_config === 'string' ? JSON.parse(c.ab_config) : c.ab_config)` |
| MEDIUM | `frontend/src/services/api-client.js` | 115 | new Date() on potentially null value without guard | `createdDate: c.created_at ? new Date(c.created_at).toLocaleDateString('fr-FR', {` |
| HIGH | `frontend/src/services/api-client.js` | 716 | fetch() without res.ok check before .json() | `const res = await fetch(url, { method: 'POST', headers, body: formData });` |
| HIGH | `frontend/src/services/auth.js` | 53 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/login', {` |
| HIGH | `frontend/src/services/auth.js` | 77 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/register', {` |
| HIGH | `frontend/src/services/auth.js` | 95 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/resend-verification', {` |
| HIGH | `frontend/src/services/auth.js` | 116 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/refresh', {` |
| HIGH | `frontend/src/services/auth.js` | 144 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/account', {` |
| HIGH | `frontend/src/services/auth.js` | 161 | fetch() without res.ok check before .json() | `await fetch('/api/auth/logout', {` |

### Automated Audit — 2026-06-17

Found 184 potential issue(s):

| Severity | File | Line | Pattern | Code |
|----------|------|------|---------|------|
| HIGH | `backend/routes/ai.js` | 438 | JSON.parse without try/catch | `const data = typeof pattern.data === 'string' ? JSON.parse(pattern.data) : (patt` |
| MEDIUM | `backend/routes/ai.js` | 439 | new Date() on potentially null value without guard | `const age = Math.round((Date.now() - new Date(pattern.date_discovered).getTime()` |
| MEDIUM | `backend/routes/ai.js` | 525 | Empty catch block (swallowed error) | `} catch { /* solo user */ }` |
| MEDIUM | `backend/routes/ai.js` | 703 | Empty catch block (swallowed error) | `try { campaignMap[cid] = await db.campaigns.get(cid); } catch {}` |
| HIGH | `backend/routes/ai.js` | 861 | JSON.parse without try/catch | `const config = typeof campaign.ab_config === 'string' ? JSON.parse(campaign.ab_c` |
| MEDIUM | `backend/routes/analytics.js` | 102 | new Date() on potentially null value without guard | `const updatedAt = opp.updated_at ? new Date(opp.updated_at).getTime() : now;` |
| MEDIUM | `backend/routes/analytics.js` | 103 | new Date() on potentially null value without guard | `const createdAt = opp.created_at ? new Date(opp.created_at).getTime() : now;` |
| MEDIUM | `backend/routes/analytics.js` | 578 | new Date() on potentially null value without guard | `const create = new Date(o.created_at).getTime();` |
| MEDIUM | `backend/routes/analytics.js` | 651 | new Date() on potentially null value without guard | `const updatedAt = opp.updated_at ? new Date(opp.updated_at).getTime() : now;` |
| MEDIUM | `backend/routes/analytics.js` | 742 | new Date() on potentially null value without guard | `const stale = activeOpps.filter(o => { const u = o.updated_at ? new Date(o.updat` |
| MEDIUM | `backend/routes/auth.js` | 270 | Empty catch block (swallowed error) | `} catch { /* no team */ }` |
| MEDIUM | `backend/routes/auth.js` | 497 | Empty catch block (swallowed error) | `} catch { /* no team — ok */ }` |
| MEDIUM | `backend/routes/campaigns.js` | 237 | new Date() on potentially null value without guard | `const lastOpt = campaign.last_optimized_at ? new Date(campaign.last_optimized_at` |
| MEDIUM | `backend/routes/chat.js` | 251 | Empty catch block (swallowed error) | `} catch { /* default to fr */ }` |
| MEDIUM | `backend/routes/chat.js` | 324 | new Date() on potentially null value without guard | `new Date(c.created_at).getTime() > sixtyAgo` |
| LOW | `backend/routes/chat.js` | 450 | Hardcoded CRM provider list (may be incomplete) | `const providers = ['pipedrive', 'hubspot', 'salesforce', 'odoo'];` |
| HIGH | `backend/routes/crm.js` | 316 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| HIGH | `backend/routes/crm.js` | 349 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| HIGH | `backend/routes/crm.js` | 365 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| HIGH | `backend/routes/crm.js` | 713 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| HIGH | `backend/routes/crm.js` | 742 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| LOW | `backend/routes/crm.js` | 1034 | Hardcoded CRM provider list (may be incomplete) | `for (const provider of ['pipedrive', 'salesforce', 'hubspot']) {` |
| MEDIUM | `backend/routes/crm.js` | 1045 | Empty catch block (swallowed error) | `} catch { /* scoring works without deals */ }` |
| HIGH | `backend/routes/crm.js` | 1354 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| HIGH | `backend/routes/crm.js` | 1368 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| MEDIUM | `backend/routes/crm.js` | 1398 | Empty catch block (swallowed error) | `} catch { /* skip individual failures */ }` |
| MEDIUM | `backend/routes/documents.js` | 141 | Empty catch block (swallowed error) | `try { fs.unlinkSync(file.path); } catch {}` |
| MEDIUM | `backend/routes/documents.js` | 244 | Empty catch block (swallowed error) | `try { fs.unlinkSync(tempPath); } catch {}` |
| HIGH | `backend/routes/export.js` | 199 | JSON.parse without try/catch | `? JSON.parse(o.score_breakdown \|\| '{}')` |
| MEDIUM | `backend/routes/extension.js` | 62 | Empty catch block (swallowed error) | `} catch { /* optional */ }` |
| HIGH | `backend/routes/extension.js` | 102 | JSON.parse without try/catch | `const data = (typeof opp.data === 'string' ? JSON.parse(opp.data) : opp.data) \|` |
| HIGH | `backend/routes/extension.js` | 143 | JSON.parse without try/catch | `const data = (typeof opp.data === 'string' ? JSON.parse(opp.data) : opp.data) \|` |
| HIGH | `backend/routes/informz.js` | 67 | JSON.parse without try/catch | `if (m) parsed = JSON.parse(m[0]);` |
| HIGH | `backend/routes/informz.js` | 210 | JSON.parse without try/catch | `if (m) parsed = JSON.parse(m[0]);` |
| MEDIUM | `backend/routes/nurture.js` | 346 | Empty catch block (swallowed error) | `} catch { /* optional */ }` |
| MEDIUM | `backend/routes/nurture.js` | 359 | Empty catch block (swallowed error) | `if (m) { try { sampleEmail = JSON.parse(m[0]); } catch { /* malformed JSON */ } ` |
| MEDIUM | `backend/routes/nurture.js` | 361 | Empty catch block (swallowed error) | `} catch { /* skip preview generation */ }` |
| HIGH | `backend/routes/nurture.js` | 432 | fetch() without res.ok check before .json() | `const tokenRes = await fetch('https://oauth2.googleapis.com/token', {` |
| HIGH | `backend/routes/nurture.js` | 522 | fetch() without res.ok check before .json() | `const tokenRes = await fetch('https://login.microsoftonline.com/common/oauth2/v2` |
| HIGH | `backend/routes/settings.js` | 375 | JSON.parse without try/catch | `const currentMeta = typeof existing.metadata === 'string' ? JSON.parse(existing.` |
| HIGH | `backend/routes/signals.js` | 166 | JSON.parse without try/catch | `if (m) email = JSON.parse(m[0]);` |
| HIGH | `backend/routes/signals.js` | 351 | JSON.parse without try/catch | `if (m) sequence = JSON.parse(m[0]);` |
| HIGH | `backend/routes/stats.js` | 23 | fetch() without res.ok check before .json() | `const resp = await fetch(url, options);` |
| HIGH | `backend/routes/team-campaigns.js` | 136 | JSON.parse without try/catch | `if (m) sampleEmail = JSON.parse(m[0]);` |
| MEDIUM | `backend/routes/team-campaigns.js` | 202 | Empty catch block (swallowed error) | `if (m) { try { email = JSON.parse(m[0]); } catch { /* malformed AI response */ }` |
| HIGH | `backend/lib/ab-memory.js` | 187 | JSON.parse without try/catch | `const data = typeof top.data === 'string' ? JSON.parse(top.data) : (top.data \|\` |
| MEDIUM | `backend/lib/agent-chains.js` | 338 | Empty catch block (swallowed error) | `} catch { /* no product lines */ }` |
| MEDIUM | `backend/lib/agent-chains.js` | 360 | Empty catch block (swallowed error) | `} catch { /* ok */ }` |
| MEDIUM | `backend/lib/agents/signal-agent.js` | 125 | Empty catch block (swallowed error) | `} catch { /* enrichment is optional */ }` |
| MEDIUM | `backend/lib/agents/signal-agent.js` | 181 | Empty catch block (swallowed error) | `} catch { /* notifications are optional */ }` |
| MEDIUM | `backend/lib/agents/signal-agent.js` | 206 | Empty catch block (swallowed error) | `} catch { /* skip duplicates */ }` |
| MEDIUM | `backend/lib/agents/signal-agent.js` | 212 | Empty catch block (swallowed error) | `} catch { /* auto-prospecting is optional */ }` |
| HIGH | `backend/lib/agents/signal-agent.js` | 289 | fetch() without res.ok check before .json() | `const res = await fetch('https://api.apollo.io/v1/mixed_people/search', {` |
| MEDIUM | `backend/lib/agents/timing-agent.js` | 99 | new Date() on potentially null value without guard | `const replied = new Date(r.replied_at).getTime();` |
| MEDIUM | `backend/lib/agents/timing-agent.js` | 163 | new Date() on potentially null value without guard | `const sent = new Date(r.sent_at).getTime();` |
| MEDIUM | `backend/lib/agents/timing-agent.js` | 164 | new Date() on potentially null value without guard | `const resp = new Date(r.response_at).getTime();` |
| MEDIUM | `backend/lib/churn-scoring.js` | 85 | new Date() on potentially null value without guard | `const age = (now - new Date(e.created_at).getTime()) / DAY_MS;` |
| MEDIUM | `backend/lib/conversation-autopilot.js` | 190 | Empty catch block (swallowed error) | `try { return JSON.parse(match[0]); } catch { /* fallthrough */ }` |
| MEDIUM | `backend/lib/conversation-autopilot.js` | 319 | new Date() on potentially null value without guard | `return history.sort((a, b) => new Date(a.date) - new Date(b.date));` |
| MEDIUM | `backend/lib/crm-agent.js` | 62 | Empty catch block (swallowed error) | `} catch { /* solo user, no team */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 177 | Empty catch block (swallowed error) | `} catch { /* ok */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 205 | Empty catch block (swallowed error) | `} catch { /* notification is non-blocking */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 283 | Empty catch block (swallowed error) | `} catch { /* owner mapping is optional */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 350 | Empty catch block (swallowed error) | `} catch { /* mapping is optional */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 379 | Empty catch block (swallowed error) | `} catch { /* deal sync is optional */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 548 | Empty catch block (swallowed error) | `} catch { /* fallback to 50/50 */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 637 | Empty catch block (swallowed error) | `} catch { /* patterns optional */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 677 | Empty catch block (swallowed error) | `} catch { /* fallback to single */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 694 | Empty catch block (swallowed error) | `} catch { /* fallback below */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 772 | new Date() on potentially null value without guard | `.map(o => (new Date(o.updated_at).getTime() - new Date(o.created_at).getTime()) ` |
| MEDIUM | `backend/lib/crm-agent.js` | 794 | new Date() on potentially null value without guard | `.map(o => (new Date(o.updated_at).getTime() - new Date(o.created_at).getTime()) ` |
| MEDIUM | `backend/lib/crm-agent.js` | 864 | Empty catch block (swallowed error) | `} catch { /* optional */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 893 | Empty catch block (swallowed error) | `} catch { /* optional */ }` |
| MEDIUM | `backend/lib/crm-bidirectional-sync.js` | 84 | new Date() on potentially null value without guard | `const lastPush = opp.score_pushed_at ? new Date(opp.score_pushed_at).getTime() :` |
| MEDIUM | `backend/lib/crm-bidirectional-sync.js` | 93 | Empty catch block (swallowed error) | `} catch { /* ignore individual push errors */ }` |
| HIGH | `backend/lib/crm-export.js` | 23 | fetch() without res.ok check before .json() | `const res = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {` |
| HIGH | `backend/lib/crm-export.js` | 51 | fetch() without res.ok check before .json() | `const res = await fetch(`${instanceUrl}/services/data/v62.0/sobjects/Contact`, {` |
| HIGH | `backend/lib/crm-export.js` | 76 | fetch() without res.ok check before .json() | `const res = await fetch(`https://api.pipedrive.com/v1/persons?api_token=${apiKey` |
| HIGH | `backend/lib/crm-export.js` | 90 | fetch() without res.ok check before .json() | `await fetch(`https://api.pipedrive.com/v1/notes?api_token=${apiKey}`, {` |
| MEDIUM | `backend/lib/crm-owner-resolver.js` | 32 | Empty catch block (swallowed error) | `} catch { /* no team = solo user */ }` |
| MEDIUM | `backend/lib/deliverability-agent.js` | 200 | Empty catch block (swallowed error) | `} catch { /* notification is best-effort */ }` |
| HIGH | `backend/lib/email-outbound.js` | 117 | fetch() without res.ok check before .json() | `const res = await fetch(tokenUrl, {` |
| HIGH | `backend/lib/email.js` | 16 | fetch() without res.ok check before .json() | `const res = await fetch('https://api.resend.com/emails', {` |
| MEDIUM | `backend/lib/enrich-agent.js` | 210 | Empty catch block (swallowed error) | `} catch { /* Brave search failed */ }` |
| HIGH | `backend/lib/enrich-agent.js` | 241 | JSON.parse without try/catch | `return JSON.parse(match[0]);` |
| MEDIUM | `backend/lib/enrich-agent.js` | 336 | Empty catch block (swallowed error) | `} catch { /* verification failed, keep the email */ }` |
| MEDIUM | `backend/lib/enrich-agent.js` | 375 | Empty catch block (swallowed error) | `} catch { /* continue */ }` |
| HIGH | `backend/lib/enrich-agent.js` | 411 | JSON.parse without try/catch | `const parsed = JSON.parse(match[0]);` |
| HIGH | `backend/lib/icp-agent.js` | 170 | JSON.parse without try/catch | `const data = typeof userIcp.data === 'string' ? JSON.parse(userIcp.data) : userI` |
| HIGH | `backend/lib/lifecycle-emails.js` | 188 | JSON.parse without try/catch | `const userData = (typeof user.data === 'string' ? JSON.parse(user.data) : user.d` |
| MEDIUM | `backend/lib/lifecycle-emails.js` | 190 | new Date() on potentially null value without guard | `const daysSinceSignup = Math.floor((Date.now() - new Date(user.created_at).getTi` |
| HIGH | `backend/lib/lifecycle-emails.js` | 240 | JSON.parse without try/catch | `const userData = (typeof user.data === 'string' ? JSON.parse(user.data) : user.d` |
| MEDIUM | `backend/lib/nurture-engine.js` | 78 | new Date() on potentially null value without guard | `const dealAge = (Date.now() - new Date(deal.createdAt).getTime()) / DAY_MS;` |
| MEDIUM | `backend/lib/nurture-engine.js` | 104 | new Date() on potentially null value without guard | `const lastUpdate = c.update_time ? new Date(c.update_time).getTime() : 0;` |
| MEDIUM | `backend/lib/nurture-engine.js` | 121 | new Date() on potentially null value without guard | `const renewalTime = new Date(o.renewal_date).getTime();` |
| MEDIUM | `backend/lib/nurture-engine.js` | 276 | Empty catch block (swallowed error) | `try { return JSON.parse(jsonMatch[0]); } catch { /* fall through */ }` |
| HIGH | `backend/lib/outreach-deploy.js` | 79 | fetch() without res.ok check before .json() | `const r = await fetch('https://api.apollo.io/v1/emailer_campaigns', {` |
| HIGH | `backend/lib/outreach-deploy.js` | 124 | fetch() without res.ok check before .json() | `const r = await fetch(`https://api.instantly.ai/api/v1/campaign/step/add?api_key` |
| MEDIUM | `backend/lib/reporting-agent.js` | 143 | Empty catch block (swallowed error) | `} catch { /* ignore notification errors */ }` |
| MEDIUM | `backend/lib/response-analysis-agent.js` | 58 | new Date() on potentially null value without guard | `const sentAt = new Date(email.sent_at).getTime();` |
| MEDIUM | `backend/lib/response-analysis-agent.js` | 60 | new Date() on potentially null value without guard | `const actDate = a.dueDate ? new Date(a.dueDate).getTime() : 0;` |
| HIGH | `backend/lib/response-analysis-agent.js` | 272 | JSON.parse without try/catch | `if (match) return JSON.parse(match[0]);` |
| MEDIUM | `backend/lib/response-analysis-agent.js` | 273 | Empty catch block (swallowed error) | `} catch { /* fallback below */ }` |
| HIGH | `backend/lib/template-agent.js` | 169 | JSON.parse without try/catch | `if (match) template = JSON.parse(match[0]);` |
| HIGH | `backend/lib/vector-store.js` | 190 | fetch() without res.ok check before .json() | `const res = await fetch('https://api.voyageai.com/v1/embeddings', {` |
| HIGH | `backend/lib/web-prospect-agent.js` | 169 | JSON.parse without try/catch | `const parsed = JSON.parse(jsonMatch[0]);` |
| HIGH | `backend/api/airtable-crm.js` | 18 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/apollo.js` | 24 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/brave-search.js` | 30 | fetch() without res.ok check before .json() | `const res = await fetch(`${BASE_URL}?${params}`, {` |
| HIGH | `backend/api/folk.js` | 15 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/hubspot.js` | 15 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/informz.js` | 73 | fetch() without res.ok check before .json() | `const res = await fetch(endpoint, {` |
| HIGH | `backend/api/instantly.js` | 28 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/lagrowthmachine.js` | 25 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/lemlist.js` | 15 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| MEDIUM | `backend/api/lemlist.js` | 647 | Empty catch block (swallowed error) | `} catch { /* logger optional */ }` |
| MEDIUM | `backend/api/lemlist.js` | 687 | Empty catch block (swallowed error) | `} catch { /* logger optional */ }` |
| HIGH | `backend/api/lemlist.js` | 749 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/linkedin.js` | 56 | fetch() without res.ok check before .json() | `const res = await fetch(`${VOYAGER_BASE}${endpoint}`, {` |
| HIGH | `backend/api/odoo.js` | 20 | fetch() without res.ok check before .json() | `const res = await fetch(`${url}/jsonrpc`, {` |
| HIGH | `backend/api/pipedrive.js` | 16 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/salesforce.js` | 13 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/waalaxy.js` | 25 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `frontend/src/components/AuthGate.jsx` | 214 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/forgot-password', {` |
| LOW | `frontend/src/components/FieldMappingSettings.jsx` | 47 | Hardcoded CRM provider list (may be incomplete) | `const crmProviders = ['pipedrive', 'hubspot', 'salesforce'];` |
| MEDIUM | `frontend/src/components/ICPInsightsCard.jsx` | 201 | new Date() on potentially null value without guard | `{new Date(data.analyzedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: ` |
| MEDIUM | `frontend/src/components/OnboardingChecklist.jsx` | 47 | Empty catch block (swallowed error) | `} catch { /* checklist won't show */ }` |
| MEDIUM | `frontend/src/components/TeamSettings.jsx` | 53 | Native alert()/prompt() in frontend | `alert(err.message);` |
| MEDIUM | `frontend/src/components/TeamSettings.jsx` | 74 | Native alert()/prompt() in frontend | `alert(err.message);` |
| MEDIUM | `frontend/src/components/TeamSettings.jsx` | 84 | Native alert()/prompt() in frontend | `alert(err.message);` |
| MEDIUM | `frontend/src/components/TeamSettings.jsx` | 93 | Native alert()/prompt() in frontend | `alert(err.message);` |
| HIGH | `frontend/src/components/VariableManager.jsx` | 378 | JSON.parse without try/catch | `initialRegistry ? JSON.parse(JSON.stringify(initialRegistry)) : JSON.parse(JSON.` |
| MEDIUM | `frontend/src/components/campaigns/CampaignDetailLayout.jsx` | 94 | Native alert()/prompt() in frontend | `window.alert(t('campaigns.archiveFailed', { error: err.message \|\| 'erreur inco` |
| MEDIUM | `frontend/src/components/campaigns/tabs/RepliesTab.jsx` | 125 | new Date() on potentially null value without guard | `const happenedAt = a.happened_at ? new Date(a.happened_at) : null;` |
| MEDIUM | `frontend/src/components/editor/__tests__/editor-helpers.test.js` | 14 | Native alert()/prompt() in frontend | `expect(escapeHtml('<script>alert("xss")</script>')).toBe(` |
| MEDIUM | `frontend/src/components/editor/__tests__/editor-helpers.test.js` | 15 | Native alert()/prompt() in frontend | `'&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'` |
| MEDIUM | `frontend/src/pages/CampaignsList.jsx` | 114 | Native alert()/prompt() in frontend | `window.alert(t('campaigns.errorPrefix', { message: err.message }));` |
| MEDIUM | `frontend/src/pages/CampaignsList.jsx` | 132 | Native alert()/prompt() in frontend | `window.alert(t('campaigns.errorPrefix', { message: err.message }));` |
| MEDIUM | `frontend/src/pages/CampaignsList.jsx` | 517 | new Date() on potentially null value without guard | `{en ? 'Sends at:' : 'Envoi à :'} {new Date(q.scheduled_at).toLocaleString(en ? '` |
| MEDIUM | `frontend/src/pages/CampaignsList.jsx` | 551 | new Date() on potentially null value without guard | `{en ? 'Sent:' : 'Envoyé :'} {new Date(q.sent_at).toLocaleString(en ? 'en-US' : '` |
| HIGH | `frontend/src/pages/ChatPage.jsx` | 1975 | JSON.parse without try/catch | `metadata: m.metadata ? (typeof m.metadata === 'string' ? JSON.parse(m.metadata) ` |
| MEDIUM | `frontend/src/pages/ClientsPage.jsx` | 582 | Native alert()/prompt() in frontend | `const subject = prompt('Objet de l\'email :');` |
| MEDIUM | `frontend/src/pages/ClientsPage.jsx` | 584 | Native alert()/prompt() in frontend | `const body = prompt('Message :');` |
| HIGH | `frontend/src/pages/CopyEditorPage.jsx` | 805 | JSON.parse without try/catch | `const copy = { ...JSON.parse(JSON.stringify(original)), id: tpId + '-copy', labe` |
| MEDIUM | `frontend/src/pages/MembershipPage.jsx` | 136 | new Date() on potentially null value without guard | `<div style={{ fontWeight: 600 }}>{new Date(r.renewal_date).toLocaleDateString(en` |
| MEDIUM | `frontend/src/pages/MemoryExplorerPage.jsx` | 392 | new Date() on potentially null value without guard | `<span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>{e.sen` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 103 | Native alert()/prompt() in frontend | `alert((lang === 'en' ? 'Error: ' : 'Erreur: ') + err.message);` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 166 | Native alert()/prompt() in frontend | `alert((lang === 'en' ? 'Error: ' : 'Erreur: ') + err.message);` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 285 | Native alert()/prompt() in frontend | `alert((lang === 'en' ? 'Error: ' : 'Erreur: ') + err.message);` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 416 | new Date() on potentially null value without guard | `{trigger.last_run && ` \u00B7 ${lang === 'en' ? 'Last run:' : 'Dernier run :'} $` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 473 | Native alert()/prompt() in frontend | `alert((en ? 'Error: ' : 'Erreur: ') + err.message);` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 525 | new Date() on potentially null value without guard | `{email.sent_at && ` \u00B7 ${en ? 'Sent on' : 'Envoy\u00E9 le'} ${new Date(email` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 766 | new Date() on potentially null value without guard | `{e.sent_at ? new Date(e.sent_at).toLocaleDateString(en ? 'en-US' : 'fr-FR', { da` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 1015 | new Date() on potentially null value without guard | `{en ? 'by' : 'par'} {c.created_by_name} {'\u00B7'} {new Date(c.created_at).toLoc` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 1207 | new Date() on potentially null value without guard | `{en ? 'Scheduled:' : 'Planifié :'} {new Date(q.scheduled_at).toLocaleString(lang` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 1243 | new Date() on potentially null value without guard | `{en ? 'Sent:' : 'Envoyé :'} {new Date(q.sent_at).toLocaleString(lang === 'en' ? ` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 1310 | new Date() on potentially null value without guard | `{test.startedAt ? new Date(test.startedAt).toLocaleDateString(en ? 'en-US' : 'fr` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 1501 | new Date() on potentially null value without guard | `{e.to} &middot; {new Date(e.createdAt).toLocaleDateString(en ? 'en-US' : 'fr-FR'` |
| HIGH | `frontend/src/pages/ProfilePage.jsx` | 127 | fetch() without res.ok check before .json() | `const res = await fetch('/api/profile', {` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 256 | Native alert()/prompt() in frontend | `alert((en ? 'Reparse failed for all docs:\n\n' : 'Reparse a échoué pour tous les` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 260 | Native alert()/prompt() in frontend | `alert((en ? 'Error: ' : 'Erreur: ') + err.message);` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 263 | Native alert()/prompt() in frontend | `alert('Auto-fill: ' + err.message);` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 469 | new Date() on potentially null value without guard | `{new Date(doc.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: '` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 476 | Empty catch block (swallowed error) | `} catch {}` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 746 | new Date() on potentially null value without guard | `<span style={{ color: 'var(--text-muted)', fontSize: 10 }}>{new Date(doc.created` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 747 | Empty catch block (swallowed error) | `<button onClick={async () => { try { await request('/documents/' + doc.id, { met` |
| MEDIUM | `frontend/src/pages/RecosPage.jsx` | 67 | new Date() on potentially null value without guard | `date: d.created_at ? new Date(d.created_at).toLocaleDateString('fr-FR', { day: '` |
| HIGH | `frontend/src/pages/ResetPasswordPage.jsx` | 129 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/reset-password', {` |
| HIGH | `frontend/src/pages/SettingsPage.jsx` | 136 | JSON.parse without try/catch | `return saved ? { ...DEFAULT_PREFERENCES, ...JSON.parse(saved) } : { ...DEFAULT_P` |
| HIGH | `frontend/src/pages/SettingsPage.jsx` | 1007 | JSON.parse without try/catch | `const user = JSON.parse(localStorage.getItem('bakal_user') \|\| '{}');` |
| MEDIUM | `frontend/src/pages/SignalsPage.jsx` | 308 | new Date() on potentially null value without guard | `<span>{new Date(s.detected_at).toLocaleDateString(en ? 'en-US' : 'fr-FR', { day:` |
| MEDIUM | `frontend/src/pages/SignalsPage.jsx` | 452 | new Date() on potentially null value without guard | `{new Date(s.detected_at).toLocaleDateString(en ? 'en-US' : 'fr-FR', { day: 'nume` |
| MEDIUM | `frontend/src/pages/SignalsPage.jsx` | 585 | new Date() on potentially null value without guard | `{c.last_run && <span>{en ? 'Last scan' : 'Dernier scan'}: {new Date(c.last_run).` |
| HIGH | `frontend/src/services/api-client.js` | 23 | fetch() without res.ok check before .json() | `let res = await fetch(url, { headers, ...opts });` |
| HIGH | `frontend/src/services/api-client.js` | 31 | fetch() without res.ok check before .json() | `res = await fetch(url, { headers, ...opts });` |
| HIGH | `frontend/src/services/api-client.js` | 110 | JSON.parse without try/catch | `? (typeof c.ab_config === 'string' ? JSON.parse(c.ab_config) : c.ab_config)` |
| MEDIUM | `frontend/src/services/api-client.js` | 115 | new Date() on potentially null value without guard | `createdDate: c.created_at ? new Date(c.created_at).toLocaleDateString('fr-FR', {` |
| HIGH | `frontend/src/services/api-client.js` | 716 | fetch() without res.ok check before .json() | `const res = await fetch(url, { method: 'POST', headers, body: formData });` |
| HIGH | `frontend/src/services/auth.js` | 53 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/login', {` |
| HIGH | `frontend/src/services/auth.js` | 77 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/register', {` |
| HIGH | `frontend/src/services/auth.js` | 95 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/resend-verification', {` |
| HIGH | `frontend/src/services/auth.js` | 116 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/refresh', {` |
| HIGH | `frontend/src/services/auth.js` | 144 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/account', {` |
| HIGH | `frontend/src/services/auth.js` | 161 | fetch() without res.ok check before .json() | `await fetch('/api/auth/logout', {` |

### Automated Audit — 2026-06-18

Found 184 potential issue(s):

| Severity | File | Line | Pattern | Code |
|----------|------|------|---------|------|
| HIGH | `backend/routes/ai.js` | 438 | JSON.parse without try/catch | `const data = typeof pattern.data === 'string' ? JSON.parse(pattern.data) : (patt` |
| MEDIUM | `backend/routes/ai.js` | 439 | new Date() on potentially null value without guard | `const age = Math.round((Date.now() - new Date(pattern.date_discovered).getTime()` |
| MEDIUM | `backend/routes/ai.js` | 525 | Empty catch block (swallowed error) | `} catch { /* solo user */ }` |
| MEDIUM | `backend/routes/ai.js` | 703 | Empty catch block (swallowed error) | `try { campaignMap[cid] = await db.campaigns.get(cid); } catch {}` |
| HIGH | `backend/routes/ai.js` | 861 | JSON.parse without try/catch | `const config = typeof campaign.ab_config === 'string' ? JSON.parse(campaign.ab_c` |
| MEDIUM | `backend/routes/analytics.js` | 102 | new Date() on potentially null value without guard | `const updatedAt = opp.updated_at ? new Date(opp.updated_at).getTime() : now;` |
| MEDIUM | `backend/routes/analytics.js` | 103 | new Date() on potentially null value without guard | `const createdAt = opp.created_at ? new Date(opp.created_at).getTime() : now;` |
| MEDIUM | `backend/routes/analytics.js` | 578 | new Date() on potentially null value without guard | `const create = new Date(o.created_at).getTime();` |
| MEDIUM | `backend/routes/analytics.js` | 651 | new Date() on potentially null value without guard | `const updatedAt = opp.updated_at ? new Date(opp.updated_at).getTime() : now;` |
| MEDIUM | `backend/routes/analytics.js` | 742 | new Date() on potentially null value without guard | `const stale = activeOpps.filter(o => { const u = o.updated_at ? new Date(o.updat` |
| MEDIUM | `backend/routes/auth.js` | 270 | Empty catch block (swallowed error) | `} catch { /* no team */ }` |
| MEDIUM | `backend/routes/auth.js` | 497 | Empty catch block (swallowed error) | `} catch { /* no team — ok */ }` |
| MEDIUM | `backend/routes/campaigns.js` | 237 | new Date() on potentially null value without guard | `const lastOpt = campaign.last_optimized_at ? new Date(campaign.last_optimized_at` |
| MEDIUM | `backend/routes/chat.js` | 251 | Empty catch block (swallowed error) | `} catch { /* default to fr */ }` |
| MEDIUM | `backend/routes/chat.js` | 324 | new Date() on potentially null value without guard | `new Date(c.created_at).getTime() > sixtyAgo` |
| LOW | `backend/routes/chat.js` | 450 | Hardcoded CRM provider list (may be incomplete) | `const providers = ['pipedrive', 'hubspot', 'salesforce', 'odoo'];` |
| HIGH | `backend/routes/crm.js` | 316 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| HIGH | `backend/routes/crm.js` | 349 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| HIGH | `backend/routes/crm.js` | 365 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| HIGH | `backend/routes/crm.js` | 713 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| HIGH | `backend/routes/crm.js` | 742 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| LOW | `backend/routes/crm.js` | 1034 | Hardcoded CRM provider list (may be incomplete) | `for (const provider of ['pipedrive', 'salesforce', 'hubspot']) {` |
| MEDIUM | `backend/routes/crm.js` | 1045 | Empty catch block (swallowed error) | `} catch { /* scoring works without deals */ }` |
| HIGH | `backend/routes/crm.js` | 1354 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| HIGH | `backend/routes/crm.js` | 1368 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| MEDIUM | `backend/routes/crm.js` | 1398 | Empty catch block (swallowed error) | `} catch { /* skip individual failures */ }` |
| MEDIUM | `backend/routes/documents.js` | 141 | Empty catch block (swallowed error) | `try { fs.unlinkSync(file.path); } catch {}` |
| MEDIUM | `backend/routes/documents.js` | 244 | Empty catch block (swallowed error) | `try { fs.unlinkSync(tempPath); } catch {}` |
| HIGH | `backend/routes/export.js` | 199 | JSON.parse without try/catch | `? JSON.parse(o.score_breakdown \|\| '{}')` |
| MEDIUM | `backend/routes/extension.js` | 62 | Empty catch block (swallowed error) | `} catch { /* optional */ }` |
| HIGH | `backend/routes/extension.js` | 102 | JSON.parse without try/catch | `const data = (typeof opp.data === 'string' ? JSON.parse(opp.data) : opp.data) \|` |
| HIGH | `backend/routes/extension.js` | 143 | JSON.parse without try/catch | `const data = (typeof opp.data === 'string' ? JSON.parse(opp.data) : opp.data) \|` |
| HIGH | `backend/routes/informz.js` | 67 | JSON.parse without try/catch | `if (m) parsed = JSON.parse(m[0]);` |
| HIGH | `backend/routes/informz.js` | 210 | JSON.parse without try/catch | `if (m) parsed = JSON.parse(m[0]);` |
| MEDIUM | `backend/routes/nurture.js` | 346 | Empty catch block (swallowed error) | `} catch { /* optional */ }` |
| MEDIUM | `backend/routes/nurture.js` | 359 | Empty catch block (swallowed error) | `if (m) { try { sampleEmail = JSON.parse(m[0]); } catch { /* malformed JSON */ } ` |
| MEDIUM | `backend/routes/nurture.js` | 361 | Empty catch block (swallowed error) | `} catch { /* skip preview generation */ }` |
| HIGH | `backend/routes/nurture.js` | 432 | fetch() without res.ok check before .json() | `const tokenRes = await fetch('https://oauth2.googleapis.com/token', {` |
| HIGH | `backend/routes/nurture.js` | 522 | fetch() without res.ok check before .json() | `const tokenRes = await fetch('https://login.microsoftonline.com/common/oauth2/v2` |
| HIGH | `backend/routes/settings.js` | 375 | JSON.parse without try/catch | `const currentMeta = typeof existing.metadata === 'string' ? JSON.parse(existing.` |
| HIGH | `backend/routes/signals.js` | 166 | JSON.parse without try/catch | `if (m) email = JSON.parse(m[0]);` |
| HIGH | `backend/routes/signals.js` | 351 | JSON.parse without try/catch | `if (m) sequence = JSON.parse(m[0]);` |
| HIGH | `backend/routes/stats.js` | 23 | fetch() without res.ok check before .json() | `const resp = await fetch(url, options);` |
| HIGH | `backend/routes/team-campaigns.js` | 136 | JSON.parse without try/catch | `if (m) sampleEmail = JSON.parse(m[0]);` |
| MEDIUM | `backend/routes/team-campaigns.js` | 202 | Empty catch block (swallowed error) | `if (m) { try { email = JSON.parse(m[0]); } catch { /* malformed AI response */ }` |
| HIGH | `backend/lib/ab-memory.js` | 187 | JSON.parse without try/catch | `const data = typeof top.data === 'string' ? JSON.parse(top.data) : (top.data \|\` |
| MEDIUM | `backend/lib/agent-chains.js` | 338 | Empty catch block (swallowed error) | `} catch { /* no product lines */ }` |
| MEDIUM | `backend/lib/agent-chains.js` | 360 | Empty catch block (swallowed error) | `} catch { /* ok */ }` |
| MEDIUM | `backend/lib/agents/signal-agent.js` | 125 | Empty catch block (swallowed error) | `} catch { /* enrichment is optional */ }` |
| MEDIUM | `backend/lib/agents/signal-agent.js` | 181 | Empty catch block (swallowed error) | `} catch { /* notifications are optional */ }` |
| MEDIUM | `backend/lib/agents/signal-agent.js` | 206 | Empty catch block (swallowed error) | `} catch { /* skip duplicates */ }` |
| MEDIUM | `backend/lib/agents/signal-agent.js` | 212 | Empty catch block (swallowed error) | `} catch { /* auto-prospecting is optional */ }` |
| HIGH | `backend/lib/agents/signal-agent.js` | 289 | fetch() without res.ok check before .json() | `const res = await fetch('https://api.apollo.io/v1/mixed_people/search', {` |
| MEDIUM | `backend/lib/agents/timing-agent.js` | 99 | new Date() on potentially null value without guard | `const replied = new Date(r.replied_at).getTime();` |
| MEDIUM | `backend/lib/agents/timing-agent.js` | 163 | new Date() on potentially null value without guard | `const sent = new Date(r.sent_at).getTime();` |
| MEDIUM | `backend/lib/agents/timing-agent.js` | 164 | new Date() on potentially null value without guard | `const resp = new Date(r.response_at).getTime();` |
| MEDIUM | `backend/lib/churn-scoring.js` | 85 | new Date() on potentially null value without guard | `const age = (now - new Date(e.created_at).getTime()) / DAY_MS;` |
| MEDIUM | `backend/lib/conversation-autopilot.js` | 190 | Empty catch block (swallowed error) | `try { return JSON.parse(match[0]); } catch { /* fallthrough */ }` |
| MEDIUM | `backend/lib/conversation-autopilot.js` | 319 | new Date() on potentially null value without guard | `return history.sort((a, b) => new Date(a.date) - new Date(b.date));` |
| MEDIUM | `backend/lib/crm-agent.js` | 62 | Empty catch block (swallowed error) | `} catch { /* solo user, no team */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 177 | Empty catch block (swallowed error) | `} catch { /* ok */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 205 | Empty catch block (swallowed error) | `} catch { /* notification is non-blocking */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 283 | Empty catch block (swallowed error) | `} catch { /* owner mapping is optional */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 350 | Empty catch block (swallowed error) | `} catch { /* mapping is optional */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 379 | Empty catch block (swallowed error) | `} catch { /* deal sync is optional */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 548 | Empty catch block (swallowed error) | `} catch { /* fallback to 50/50 */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 637 | Empty catch block (swallowed error) | `} catch { /* patterns optional */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 677 | Empty catch block (swallowed error) | `} catch { /* fallback to single */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 694 | Empty catch block (swallowed error) | `} catch { /* fallback below */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 772 | new Date() on potentially null value without guard | `.map(o => (new Date(o.updated_at).getTime() - new Date(o.created_at).getTime()) ` |
| MEDIUM | `backend/lib/crm-agent.js` | 794 | new Date() on potentially null value without guard | `.map(o => (new Date(o.updated_at).getTime() - new Date(o.created_at).getTime()) ` |
| MEDIUM | `backend/lib/crm-agent.js` | 864 | Empty catch block (swallowed error) | `} catch { /* optional */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 893 | Empty catch block (swallowed error) | `} catch { /* optional */ }` |
| MEDIUM | `backend/lib/crm-bidirectional-sync.js` | 84 | new Date() on potentially null value without guard | `const lastPush = opp.score_pushed_at ? new Date(opp.score_pushed_at).getTime() :` |
| MEDIUM | `backend/lib/crm-bidirectional-sync.js` | 93 | Empty catch block (swallowed error) | `} catch { /* ignore individual push errors */ }` |
| HIGH | `backend/lib/crm-export.js` | 23 | fetch() without res.ok check before .json() | `const res = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {` |
| HIGH | `backend/lib/crm-export.js` | 51 | fetch() without res.ok check before .json() | `const res = await fetch(`${instanceUrl}/services/data/v62.0/sobjects/Contact`, {` |
| HIGH | `backend/lib/crm-export.js` | 76 | fetch() without res.ok check before .json() | `const res = await fetch(`https://api.pipedrive.com/v1/persons?api_token=${apiKey` |
| HIGH | `backend/lib/crm-export.js` | 90 | fetch() without res.ok check before .json() | `await fetch(`https://api.pipedrive.com/v1/notes?api_token=${apiKey}`, {` |
| MEDIUM | `backend/lib/crm-owner-resolver.js` | 32 | Empty catch block (swallowed error) | `} catch { /* no team = solo user */ }` |
| MEDIUM | `backend/lib/deliverability-agent.js` | 200 | Empty catch block (swallowed error) | `} catch { /* notification is best-effort */ }` |
| HIGH | `backend/lib/email-outbound.js` | 117 | fetch() without res.ok check before .json() | `const res = await fetch(tokenUrl, {` |
| HIGH | `backend/lib/email.js` | 16 | fetch() without res.ok check before .json() | `const res = await fetch('https://api.resend.com/emails', {` |
| MEDIUM | `backend/lib/enrich-agent.js` | 210 | Empty catch block (swallowed error) | `} catch { /* Brave search failed */ }` |
| HIGH | `backend/lib/enrich-agent.js` | 241 | JSON.parse without try/catch | `return JSON.parse(match[0]);` |
| MEDIUM | `backend/lib/enrich-agent.js` | 336 | Empty catch block (swallowed error) | `} catch { /* verification failed, keep the email */ }` |
| MEDIUM | `backend/lib/enrich-agent.js` | 375 | Empty catch block (swallowed error) | `} catch { /* continue */ }` |
| HIGH | `backend/lib/enrich-agent.js` | 411 | JSON.parse without try/catch | `const parsed = JSON.parse(match[0]);` |
| HIGH | `backend/lib/icp-agent.js` | 170 | JSON.parse without try/catch | `const data = typeof userIcp.data === 'string' ? JSON.parse(userIcp.data) : userI` |
| HIGH | `backend/lib/lifecycle-emails.js` | 188 | JSON.parse without try/catch | `const userData = (typeof user.data === 'string' ? JSON.parse(user.data) : user.d` |
| MEDIUM | `backend/lib/lifecycle-emails.js` | 190 | new Date() on potentially null value without guard | `const daysSinceSignup = Math.floor((Date.now() - new Date(user.created_at).getTi` |
| HIGH | `backend/lib/lifecycle-emails.js` | 240 | JSON.parse without try/catch | `const userData = (typeof user.data === 'string' ? JSON.parse(user.data) : user.d` |
| MEDIUM | `backend/lib/nurture-engine.js` | 78 | new Date() on potentially null value without guard | `const dealAge = (Date.now() - new Date(deal.createdAt).getTime()) / DAY_MS;` |
| MEDIUM | `backend/lib/nurture-engine.js` | 104 | new Date() on potentially null value without guard | `const lastUpdate = c.update_time ? new Date(c.update_time).getTime() : 0;` |
| MEDIUM | `backend/lib/nurture-engine.js` | 121 | new Date() on potentially null value without guard | `const renewalTime = new Date(o.renewal_date).getTime();` |
| MEDIUM | `backend/lib/nurture-engine.js` | 276 | Empty catch block (swallowed error) | `try { return JSON.parse(jsonMatch[0]); } catch { /* fall through */ }` |
| HIGH | `backend/lib/outreach-deploy.js` | 79 | fetch() without res.ok check before .json() | `const r = await fetch('https://api.apollo.io/v1/emailer_campaigns', {` |
| HIGH | `backend/lib/outreach-deploy.js` | 124 | fetch() without res.ok check before .json() | `const r = await fetch(`https://api.instantly.ai/api/v1/campaign/step/add?api_key` |
| MEDIUM | `backend/lib/reporting-agent.js` | 143 | Empty catch block (swallowed error) | `} catch { /* ignore notification errors */ }` |
| MEDIUM | `backend/lib/response-analysis-agent.js` | 58 | new Date() on potentially null value without guard | `const sentAt = new Date(email.sent_at).getTime();` |
| MEDIUM | `backend/lib/response-analysis-agent.js` | 60 | new Date() on potentially null value without guard | `const actDate = a.dueDate ? new Date(a.dueDate).getTime() : 0;` |
| HIGH | `backend/lib/response-analysis-agent.js` | 272 | JSON.parse without try/catch | `if (match) return JSON.parse(match[0]);` |
| MEDIUM | `backend/lib/response-analysis-agent.js` | 273 | Empty catch block (swallowed error) | `} catch { /* fallback below */ }` |
| HIGH | `backend/lib/template-agent.js` | 169 | JSON.parse without try/catch | `if (match) template = JSON.parse(match[0]);` |
| HIGH | `backend/lib/vector-store.js` | 190 | fetch() without res.ok check before .json() | `const res = await fetch('https://api.voyageai.com/v1/embeddings', {` |
| HIGH | `backend/lib/web-prospect-agent.js` | 169 | JSON.parse without try/catch | `const parsed = JSON.parse(jsonMatch[0]);` |
| HIGH | `backend/api/airtable-crm.js` | 18 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/apollo.js` | 24 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/brave-search.js` | 30 | fetch() without res.ok check before .json() | `const res = await fetch(`${BASE_URL}?${params}`, {` |
| HIGH | `backend/api/folk.js` | 15 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/hubspot.js` | 15 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/informz.js` | 73 | fetch() without res.ok check before .json() | `const res = await fetch(endpoint, {` |
| HIGH | `backend/api/instantly.js` | 28 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/lagrowthmachine.js` | 25 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/lemlist.js` | 15 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| MEDIUM | `backend/api/lemlist.js` | 647 | Empty catch block (swallowed error) | `} catch { /* logger optional */ }` |
| MEDIUM | `backend/api/lemlist.js` | 687 | Empty catch block (swallowed error) | `} catch { /* logger optional */ }` |
| HIGH | `backend/api/lemlist.js` | 749 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/linkedin.js` | 56 | fetch() without res.ok check before .json() | `const res = await fetch(`${VOYAGER_BASE}${endpoint}`, {` |
| HIGH | `backend/api/odoo.js` | 20 | fetch() without res.ok check before .json() | `const res = await fetch(`${url}/jsonrpc`, {` |
| HIGH | `backend/api/pipedrive.js` | 16 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/salesforce.js` | 13 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/waalaxy.js` | 25 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `frontend/src/components/AuthGate.jsx` | 214 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/forgot-password', {` |
| LOW | `frontend/src/components/FieldMappingSettings.jsx` | 47 | Hardcoded CRM provider list (may be incomplete) | `const crmProviders = ['pipedrive', 'hubspot', 'salesforce'];` |
| MEDIUM | `frontend/src/components/ICPInsightsCard.jsx` | 201 | new Date() on potentially null value without guard | `{new Date(data.analyzedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: ` |
| MEDIUM | `frontend/src/components/OnboardingChecklist.jsx` | 47 | Empty catch block (swallowed error) | `} catch { /* checklist won't show */ }` |
| MEDIUM | `frontend/src/components/TeamSettings.jsx` | 53 | Native alert()/prompt() in frontend | `alert(err.message);` |
| MEDIUM | `frontend/src/components/TeamSettings.jsx` | 74 | Native alert()/prompt() in frontend | `alert(err.message);` |
| MEDIUM | `frontend/src/components/TeamSettings.jsx` | 84 | Native alert()/prompt() in frontend | `alert(err.message);` |
| MEDIUM | `frontend/src/components/TeamSettings.jsx` | 93 | Native alert()/prompt() in frontend | `alert(err.message);` |
| HIGH | `frontend/src/components/VariableManager.jsx` | 378 | JSON.parse without try/catch | `initialRegistry ? JSON.parse(JSON.stringify(initialRegistry)) : JSON.parse(JSON.` |
| MEDIUM | `frontend/src/components/campaigns/CampaignDetailLayout.jsx` | 94 | Native alert()/prompt() in frontend | `window.alert(t('campaigns.archiveFailed', { error: err.message \|\| 'erreur inco` |
| MEDIUM | `frontend/src/components/campaigns/tabs/RepliesTab.jsx` | 125 | new Date() on potentially null value without guard | `const happenedAt = a.happened_at ? new Date(a.happened_at) : null;` |
| MEDIUM | `frontend/src/components/editor/__tests__/editor-helpers.test.js` | 14 | Native alert()/prompt() in frontend | `expect(escapeHtml('<script>alert("xss")</script>')).toBe(` |
| MEDIUM | `frontend/src/components/editor/__tests__/editor-helpers.test.js` | 15 | Native alert()/prompt() in frontend | `'&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'` |
| MEDIUM | `frontend/src/pages/CampaignsList.jsx` | 114 | Native alert()/prompt() in frontend | `window.alert(t('campaigns.errorPrefix', { message: err.message }));` |
| MEDIUM | `frontend/src/pages/CampaignsList.jsx` | 132 | Native alert()/prompt() in frontend | `window.alert(t('campaigns.errorPrefix', { message: err.message }));` |
| MEDIUM | `frontend/src/pages/CampaignsList.jsx` | 517 | new Date() on potentially null value without guard | `{en ? 'Sends at:' : 'Envoi à :'} {new Date(q.scheduled_at).toLocaleString(en ? '` |
| MEDIUM | `frontend/src/pages/CampaignsList.jsx` | 551 | new Date() on potentially null value without guard | `{en ? 'Sent:' : 'Envoyé :'} {new Date(q.sent_at).toLocaleString(en ? 'en-US' : '` |
| HIGH | `frontend/src/pages/ChatPage.jsx` | 1975 | JSON.parse without try/catch | `metadata: m.metadata ? (typeof m.metadata === 'string' ? JSON.parse(m.metadata) ` |
| MEDIUM | `frontend/src/pages/ClientsPage.jsx` | 582 | Native alert()/prompt() in frontend | `const subject = prompt('Objet de l\'email :');` |
| MEDIUM | `frontend/src/pages/ClientsPage.jsx` | 584 | Native alert()/prompt() in frontend | `const body = prompt('Message :');` |
| HIGH | `frontend/src/pages/CopyEditorPage.jsx` | 805 | JSON.parse without try/catch | `const copy = { ...JSON.parse(JSON.stringify(original)), id: tpId + '-copy', labe` |
| MEDIUM | `frontend/src/pages/MembershipPage.jsx` | 136 | new Date() on potentially null value without guard | `<div style={{ fontWeight: 600 }}>{new Date(r.renewal_date).toLocaleDateString(en` |
| MEDIUM | `frontend/src/pages/MemoryExplorerPage.jsx` | 392 | new Date() on potentially null value without guard | `<span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>{e.sen` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 103 | Native alert()/prompt() in frontend | `alert((lang === 'en' ? 'Error: ' : 'Erreur: ') + err.message);` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 166 | Native alert()/prompt() in frontend | `alert((lang === 'en' ? 'Error: ' : 'Erreur: ') + err.message);` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 285 | Native alert()/prompt() in frontend | `alert((lang === 'en' ? 'Error: ' : 'Erreur: ') + err.message);` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 416 | new Date() on potentially null value without guard | `{trigger.last_run && ` \u00B7 ${lang === 'en' ? 'Last run:' : 'Dernier run :'} $` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 473 | Native alert()/prompt() in frontend | `alert((en ? 'Error: ' : 'Erreur: ') + err.message);` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 525 | new Date() on potentially null value without guard | `{email.sent_at && ` \u00B7 ${en ? 'Sent on' : 'Envoy\u00E9 le'} ${new Date(email` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 766 | new Date() on potentially null value without guard | `{e.sent_at ? new Date(e.sent_at).toLocaleDateString(en ? 'en-US' : 'fr-FR', { da` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 1015 | new Date() on potentially null value without guard | `{en ? 'by' : 'par'} {c.created_by_name} {'\u00B7'} {new Date(c.created_at).toLoc` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 1207 | new Date() on potentially null value without guard | `{en ? 'Scheduled:' : 'Planifié :'} {new Date(q.scheduled_at).toLocaleString(lang` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 1243 | new Date() on potentially null value without guard | `{en ? 'Sent:' : 'Envoyé :'} {new Date(q.sent_at).toLocaleString(lang === 'en' ? ` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 1310 | new Date() on potentially null value without guard | `{test.startedAt ? new Date(test.startedAt).toLocaleDateString(en ? 'en-US' : 'fr` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 1501 | new Date() on potentially null value without guard | `{e.to} &middot; {new Date(e.createdAt).toLocaleDateString(en ? 'en-US' : 'fr-FR'` |
| HIGH | `frontend/src/pages/ProfilePage.jsx` | 127 | fetch() without res.ok check before .json() | `const res = await fetch('/api/profile', {` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 256 | Native alert()/prompt() in frontend | `alert((en ? 'Reparse failed for all docs:\n\n' : 'Reparse a échoué pour tous les` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 260 | Native alert()/prompt() in frontend | `alert((en ? 'Error: ' : 'Erreur: ') + err.message);` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 263 | Native alert()/prompt() in frontend | `alert('Auto-fill: ' + err.message);` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 469 | new Date() on potentially null value without guard | `{new Date(doc.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: '` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 476 | Empty catch block (swallowed error) | `} catch {}` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 746 | new Date() on potentially null value without guard | `<span style={{ color: 'var(--text-muted)', fontSize: 10 }}>{new Date(doc.created` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 747 | Empty catch block (swallowed error) | `<button onClick={async () => { try { await request('/documents/' + doc.id, { met` |
| MEDIUM | `frontend/src/pages/RecosPage.jsx` | 67 | new Date() on potentially null value without guard | `date: d.created_at ? new Date(d.created_at).toLocaleDateString('fr-FR', { day: '` |
| HIGH | `frontend/src/pages/ResetPasswordPage.jsx` | 129 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/reset-password', {` |
| HIGH | `frontend/src/pages/SettingsPage.jsx` | 136 | JSON.parse without try/catch | `return saved ? { ...DEFAULT_PREFERENCES, ...JSON.parse(saved) } : { ...DEFAULT_P` |
| HIGH | `frontend/src/pages/SettingsPage.jsx` | 1007 | JSON.parse without try/catch | `const user = JSON.parse(localStorage.getItem('bakal_user') \|\| '{}');` |
| MEDIUM | `frontend/src/pages/SignalsPage.jsx` | 308 | new Date() on potentially null value without guard | `<span>{new Date(s.detected_at).toLocaleDateString(en ? 'en-US' : 'fr-FR', { day:` |
| MEDIUM | `frontend/src/pages/SignalsPage.jsx` | 452 | new Date() on potentially null value without guard | `{new Date(s.detected_at).toLocaleDateString(en ? 'en-US' : 'fr-FR', { day: 'nume` |
| MEDIUM | `frontend/src/pages/SignalsPage.jsx` | 585 | new Date() on potentially null value without guard | `{c.last_run && <span>{en ? 'Last scan' : 'Dernier scan'}: {new Date(c.last_run).` |
| HIGH | `frontend/src/services/api-client.js` | 23 | fetch() without res.ok check before .json() | `let res = await fetch(url, { headers, ...opts });` |
| HIGH | `frontend/src/services/api-client.js` | 31 | fetch() without res.ok check before .json() | `res = await fetch(url, { headers, ...opts });` |
| HIGH | `frontend/src/services/api-client.js` | 110 | JSON.parse without try/catch | `? (typeof c.ab_config === 'string' ? JSON.parse(c.ab_config) : c.ab_config)` |
| MEDIUM | `frontend/src/services/api-client.js` | 115 | new Date() on potentially null value without guard | `createdDate: c.created_at ? new Date(c.created_at).toLocaleDateString('fr-FR', {` |
| HIGH | `frontend/src/services/api-client.js` | 716 | fetch() without res.ok check before .json() | `const res = await fetch(url, { method: 'POST', headers, body: formData });` |
| HIGH | `frontend/src/services/auth.js` | 53 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/login', {` |
| HIGH | `frontend/src/services/auth.js` | 77 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/register', {` |
| HIGH | `frontend/src/services/auth.js` | 95 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/resend-verification', {` |
| HIGH | `frontend/src/services/auth.js` | 116 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/refresh', {` |
| HIGH | `frontend/src/services/auth.js` | 144 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/account', {` |
| HIGH | `frontend/src/services/auth.js` | 161 | fetch() without res.ok check before .json() | `await fetch('/api/auth/logout', {` |

### Automated Audit — 2026-06-19

Found 187 potential issue(s):

| Severity | File | Line | Pattern | Code |
|----------|------|------|---------|------|
| HIGH | `backend/routes/ai.js` | 438 | JSON.parse without try/catch | `const data = typeof pattern.data === 'string' ? JSON.parse(pattern.data) : (patt` |
| MEDIUM | `backend/routes/ai.js` | 439 | new Date() on potentially null value without guard | `const age = Math.round((Date.now() - new Date(pattern.date_discovered).getTime()` |
| MEDIUM | `backend/routes/ai.js` | 525 | Empty catch block (swallowed error) | `} catch { /* solo user */ }` |
| MEDIUM | `backend/routes/ai.js` | 703 | Empty catch block (swallowed error) | `try { campaignMap[cid] = await db.campaigns.get(cid); } catch {}` |
| HIGH | `backend/routes/ai.js` | 861 | JSON.parse without try/catch | `const config = typeof campaign.ab_config === 'string' ? JSON.parse(campaign.ab_c` |
| MEDIUM | `backend/routes/analytics.js` | 102 | new Date() on potentially null value without guard | `const updatedAt = opp.updated_at ? new Date(opp.updated_at).getTime() : now;` |
| MEDIUM | `backend/routes/analytics.js` | 103 | new Date() on potentially null value without guard | `const createdAt = opp.created_at ? new Date(opp.created_at).getTime() : now;` |
| MEDIUM | `backend/routes/analytics.js` | 578 | new Date() on potentially null value without guard | `const create = new Date(o.created_at).getTime();` |
| MEDIUM | `backend/routes/analytics.js` | 651 | new Date() on potentially null value without guard | `const updatedAt = opp.updated_at ? new Date(opp.updated_at).getTime() : now;` |
| MEDIUM | `backend/routes/analytics.js` | 742 | new Date() on potentially null value without guard | `const stale = activeOpps.filter(o => { const u = o.updated_at ? new Date(o.updat` |
| MEDIUM | `backend/routes/auth.js` | 270 | Empty catch block (swallowed error) | `} catch { /* no team */ }` |
| MEDIUM | `backend/routes/auth.js` | 497 | Empty catch block (swallowed error) | `} catch { /* no team — ok */ }` |
| MEDIUM | `backend/routes/campaigns.js` | 237 | new Date() on potentially null value without guard | `const lastOpt = campaign.last_optimized_at ? new Date(campaign.last_optimized_at` |
| MEDIUM | `backend/routes/chat.js` | 251 | Empty catch block (swallowed error) | `} catch { /* default to fr */ }` |
| MEDIUM | `backend/routes/chat.js` | 324 | new Date() on potentially null value without guard | `new Date(c.created_at).getTime() > sixtyAgo` |
| LOW | `backend/routes/chat.js` | 450 | Hardcoded CRM provider list (may be incomplete) | `const providers = ['pipedrive', 'hubspot', 'salesforce', 'odoo'];` |
| HIGH | `backend/routes/crm.js` | 318 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| HIGH | `backend/routes/crm.js` | 351 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| HIGH | `backend/routes/crm.js` | 367 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| HIGH | `backend/routes/crm.js` | 715 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| HIGH | `backend/routes/crm.js` | 744 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| LOW | `backend/routes/crm.js` | 1036 | Hardcoded CRM provider list (may be incomplete) | `for (const provider of ['pipedrive', 'salesforce', 'hubspot']) {` |
| MEDIUM | `backend/routes/crm.js` | 1047 | Empty catch block (swallowed error) | `} catch { /* scoring works without deals */ }` |
| HIGH | `backend/routes/crm.js` | 1356 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| HIGH | `backend/routes/crm.js` | 1370 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| MEDIUM | `backend/routes/crm.js` | 1400 | Empty catch block (swallowed error) | `} catch { /* skip individual failures */ }` |
| HIGH | `backend/routes/crm.js` | 1569 | fetch() without res.ok check before .json() | `const tokenRes = await fetch('https://login.salesforce.com/services/oauth2/token` |
| HIGH | `backend/routes/crm.js` | 1714 | fetch() without res.ok check before .json() | `const tokenRes = await fetch('https://login.salesforce.com/services/oauth2/token` |
| HIGH | `backend/routes/crm.js` | 1765 | fetch() without res.ok check before .json() | `const tokenRes = await fetch('https://login.salesforce.com/services/oauth2/token` |
| MEDIUM | `backend/routes/documents.js` | 141 | Empty catch block (swallowed error) | `try { fs.unlinkSync(file.path); } catch {}` |
| MEDIUM | `backend/routes/documents.js` | 244 | Empty catch block (swallowed error) | `try { fs.unlinkSync(tempPath); } catch {}` |
| HIGH | `backend/routes/export.js` | 199 | JSON.parse without try/catch | `? JSON.parse(o.score_breakdown \|\| '{}')` |
| MEDIUM | `backend/routes/extension.js` | 62 | Empty catch block (swallowed error) | `} catch { /* optional */ }` |
| HIGH | `backend/routes/extension.js` | 102 | JSON.parse without try/catch | `const data = (typeof opp.data === 'string' ? JSON.parse(opp.data) : opp.data) \|` |
| HIGH | `backend/routes/extension.js` | 143 | JSON.parse without try/catch | `const data = (typeof opp.data === 'string' ? JSON.parse(opp.data) : opp.data) \|` |
| HIGH | `backend/routes/informz.js` | 67 | JSON.parse without try/catch | `if (m) parsed = JSON.parse(m[0]);` |
| HIGH | `backend/routes/informz.js` | 210 | JSON.parse without try/catch | `if (m) parsed = JSON.parse(m[0]);` |
| MEDIUM | `backend/routes/nurture.js` | 346 | Empty catch block (swallowed error) | `} catch { /* optional */ }` |
| MEDIUM | `backend/routes/nurture.js` | 359 | Empty catch block (swallowed error) | `if (m) { try { sampleEmail = JSON.parse(m[0]); } catch { /* malformed JSON */ } ` |
| MEDIUM | `backend/routes/nurture.js` | 361 | Empty catch block (swallowed error) | `} catch { /* skip preview generation */ }` |
| HIGH | `backend/routes/nurture.js` | 432 | fetch() without res.ok check before .json() | `const tokenRes = await fetch('https://oauth2.googleapis.com/token', {` |
| HIGH | `backend/routes/nurture.js` | 522 | fetch() without res.ok check before .json() | `const tokenRes = await fetch('https://login.microsoftonline.com/common/oauth2/v2` |
| HIGH | `backend/routes/settings.js` | 375 | JSON.parse without try/catch | `const currentMeta = typeof existing.metadata === 'string' ? JSON.parse(existing.` |
| HIGH | `backend/routes/signals.js` | 166 | JSON.parse without try/catch | `if (m) email = JSON.parse(m[0]);` |
| HIGH | `backend/routes/signals.js` | 351 | JSON.parse without try/catch | `if (m) sequence = JSON.parse(m[0]);` |
| HIGH | `backend/routes/stats.js` | 23 | fetch() without res.ok check before .json() | `const resp = await fetch(url, options);` |
| HIGH | `backend/routes/team-campaigns.js` | 136 | JSON.parse without try/catch | `if (m) sampleEmail = JSON.parse(m[0]);` |
| MEDIUM | `backend/routes/team-campaigns.js` | 202 | Empty catch block (swallowed error) | `if (m) { try { email = JSON.parse(m[0]); } catch { /* malformed AI response */ }` |
| HIGH | `backend/lib/ab-memory.js` | 187 | JSON.parse without try/catch | `const data = typeof top.data === 'string' ? JSON.parse(top.data) : (top.data \|\` |
| MEDIUM | `backend/lib/agent-chains.js` | 338 | Empty catch block (swallowed error) | `} catch { /* no product lines */ }` |
| MEDIUM | `backend/lib/agent-chains.js` | 360 | Empty catch block (swallowed error) | `} catch { /* ok */ }` |
| MEDIUM | `backend/lib/agents/signal-agent.js` | 125 | Empty catch block (swallowed error) | `} catch { /* enrichment is optional */ }` |
| MEDIUM | `backend/lib/agents/signal-agent.js` | 181 | Empty catch block (swallowed error) | `} catch { /* notifications are optional */ }` |
| MEDIUM | `backend/lib/agents/signal-agent.js` | 206 | Empty catch block (swallowed error) | `} catch { /* skip duplicates */ }` |
| MEDIUM | `backend/lib/agents/signal-agent.js` | 212 | Empty catch block (swallowed error) | `} catch { /* auto-prospecting is optional */ }` |
| HIGH | `backend/lib/agents/signal-agent.js` | 289 | fetch() without res.ok check before .json() | `const res = await fetch('https://api.apollo.io/v1/mixed_people/search', {` |
| MEDIUM | `backend/lib/agents/timing-agent.js` | 99 | new Date() on potentially null value without guard | `const replied = new Date(r.replied_at).getTime();` |
| MEDIUM | `backend/lib/agents/timing-agent.js` | 163 | new Date() on potentially null value without guard | `const sent = new Date(r.sent_at).getTime();` |
| MEDIUM | `backend/lib/agents/timing-agent.js` | 164 | new Date() on potentially null value without guard | `const resp = new Date(r.response_at).getTime();` |
| MEDIUM | `backend/lib/churn-scoring.js` | 85 | new Date() on potentially null value without guard | `const age = (now - new Date(e.created_at).getTime()) / DAY_MS;` |
| MEDIUM | `backend/lib/conversation-autopilot.js` | 190 | Empty catch block (swallowed error) | `try { return JSON.parse(match[0]); } catch { /* fallthrough */ }` |
| MEDIUM | `backend/lib/conversation-autopilot.js` | 319 | new Date() on potentially null value without guard | `return history.sort((a, b) => new Date(a.date) - new Date(b.date));` |
| MEDIUM | `backend/lib/crm-agent.js` | 62 | Empty catch block (swallowed error) | `} catch { /* solo user, no team */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 177 | Empty catch block (swallowed error) | `} catch { /* ok */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 205 | Empty catch block (swallowed error) | `} catch { /* notification is non-blocking */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 283 | Empty catch block (swallowed error) | `} catch { /* owner mapping is optional */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 350 | Empty catch block (swallowed error) | `} catch { /* mapping is optional */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 379 | Empty catch block (swallowed error) | `} catch { /* deal sync is optional */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 548 | Empty catch block (swallowed error) | `} catch { /* fallback to 50/50 */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 637 | Empty catch block (swallowed error) | `} catch { /* patterns optional */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 677 | Empty catch block (swallowed error) | `} catch { /* fallback to single */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 694 | Empty catch block (swallowed error) | `} catch { /* fallback below */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 772 | new Date() on potentially null value without guard | `.map(o => (new Date(o.updated_at).getTime() - new Date(o.created_at).getTime()) ` |
| MEDIUM | `backend/lib/crm-agent.js` | 794 | new Date() on potentially null value without guard | `.map(o => (new Date(o.updated_at).getTime() - new Date(o.created_at).getTime()) ` |
| MEDIUM | `backend/lib/crm-agent.js` | 864 | Empty catch block (swallowed error) | `} catch { /* optional */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 893 | Empty catch block (swallowed error) | `} catch { /* optional */ }` |
| MEDIUM | `backend/lib/crm-bidirectional-sync.js` | 84 | new Date() on potentially null value without guard | `const lastPush = opp.score_pushed_at ? new Date(opp.score_pushed_at).getTime() :` |
| MEDIUM | `backend/lib/crm-bidirectional-sync.js` | 93 | Empty catch block (swallowed error) | `} catch { /* ignore individual push errors */ }` |
| HIGH | `backend/lib/crm-export.js` | 23 | fetch() without res.ok check before .json() | `const res = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {` |
| HIGH | `backend/lib/crm-export.js` | 51 | fetch() without res.ok check before .json() | `const res = await fetch(`${instanceUrl}/services/data/v62.0/sobjects/Contact`, {` |
| HIGH | `backend/lib/crm-export.js` | 76 | fetch() without res.ok check before .json() | `const res = await fetch(`https://api.pipedrive.com/v1/persons?api_token=${apiKey` |
| HIGH | `backend/lib/crm-export.js` | 90 | fetch() without res.ok check before .json() | `await fetch(`https://api.pipedrive.com/v1/notes?api_token=${apiKey}`, {` |
| MEDIUM | `backend/lib/crm-owner-resolver.js` | 32 | Empty catch block (swallowed error) | `} catch { /* no team = solo user */ }` |
| MEDIUM | `backend/lib/deliverability-agent.js` | 200 | Empty catch block (swallowed error) | `} catch { /* notification is best-effort */ }` |
| HIGH | `backend/lib/email-outbound.js` | 117 | fetch() without res.ok check before .json() | `const res = await fetch(tokenUrl, {` |
| HIGH | `backend/lib/email.js` | 16 | fetch() without res.ok check before .json() | `const res = await fetch('https://api.resend.com/emails', {` |
| MEDIUM | `backend/lib/enrich-agent.js` | 210 | Empty catch block (swallowed error) | `} catch { /* Brave search failed */ }` |
| HIGH | `backend/lib/enrich-agent.js` | 241 | JSON.parse without try/catch | `return JSON.parse(match[0]);` |
| MEDIUM | `backend/lib/enrich-agent.js` | 336 | Empty catch block (swallowed error) | `} catch { /* verification failed, keep the email */ }` |
| MEDIUM | `backend/lib/enrich-agent.js` | 375 | Empty catch block (swallowed error) | `} catch { /* continue */ }` |
| HIGH | `backend/lib/enrich-agent.js` | 411 | JSON.parse without try/catch | `const parsed = JSON.parse(match[0]);` |
| HIGH | `backend/lib/icp-agent.js` | 170 | JSON.parse without try/catch | `const data = typeof userIcp.data === 'string' ? JSON.parse(userIcp.data) : userI` |
| HIGH | `backend/lib/lifecycle-emails.js` | 188 | JSON.parse without try/catch | `const userData = (typeof user.data === 'string' ? JSON.parse(user.data) : user.d` |
| MEDIUM | `backend/lib/lifecycle-emails.js` | 190 | new Date() on potentially null value without guard | `const daysSinceSignup = Math.floor((Date.now() - new Date(user.created_at).getTi` |
| HIGH | `backend/lib/lifecycle-emails.js` | 240 | JSON.parse without try/catch | `const userData = (typeof user.data === 'string' ? JSON.parse(user.data) : user.d` |
| MEDIUM | `backend/lib/nurture-engine.js` | 78 | new Date() on potentially null value without guard | `const dealAge = (Date.now() - new Date(deal.createdAt).getTime()) / DAY_MS;` |
| MEDIUM | `backend/lib/nurture-engine.js` | 104 | new Date() on potentially null value without guard | `const lastUpdate = c.update_time ? new Date(c.update_time).getTime() : 0;` |
| MEDIUM | `backend/lib/nurture-engine.js` | 121 | new Date() on potentially null value without guard | `const renewalTime = new Date(o.renewal_date).getTime();` |
| MEDIUM | `backend/lib/nurture-engine.js` | 276 | Empty catch block (swallowed error) | `try { return JSON.parse(jsonMatch[0]); } catch { /* fall through */ }` |
| HIGH | `backend/lib/outreach-deploy.js` | 79 | fetch() without res.ok check before .json() | `const r = await fetch('https://api.apollo.io/v1/emailer_campaigns', {` |
| HIGH | `backend/lib/outreach-deploy.js` | 124 | fetch() without res.ok check before .json() | `const r = await fetch(`https://api.instantly.ai/api/v1/campaign/step/add?api_key` |
| MEDIUM | `backend/lib/reporting-agent.js` | 143 | Empty catch block (swallowed error) | `} catch { /* ignore notification errors */ }` |
| MEDIUM | `backend/lib/response-analysis-agent.js` | 58 | new Date() on potentially null value without guard | `const sentAt = new Date(email.sent_at).getTime();` |
| MEDIUM | `backend/lib/response-analysis-agent.js` | 60 | new Date() on potentially null value without guard | `const actDate = a.dueDate ? new Date(a.dueDate).getTime() : 0;` |
| HIGH | `backend/lib/response-analysis-agent.js` | 272 | JSON.parse without try/catch | `if (match) return JSON.parse(match[0]);` |
| MEDIUM | `backend/lib/response-analysis-agent.js` | 273 | Empty catch block (swallowed error) | `} catch { /* fallback below */ }` |
| HIGH | `backend/lib/template-agent.js` | 169 | JSON.parse without try/catch | `if (match) template = JSON.parse(match[0]);` |
| HIGH | `backend/lib/vector-store.js` | 190 | fetch() without res.ok check before .json() | `const res = await fetch('https://api.voyageai.com/v1/embeddings', {` |
| HIGH | `backend/lib/web-prospect-agent.js` | 169 | JSON.parse without try/catch | `const parsed = JSON.parse(jsonMatch[0]);` |
| HIGH | `backend/api/airtable-crm.js` | 18 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/apollo.js` | 24 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/brave-search.js` | 30 | fetch() without res.ok check before .json() | `const res = await fetch(`${BASE_URL}?${params}`, {` |
| HIGH | `backend/api/folk.js` | 15 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/hubspot.js` | 15 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/informz.js` | 73 | fetch() without res.ok check before .json() | `const res = await fetch(endpoint, {` |
| HIGH | `backend/api/instantly.js` | 28 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/lagrowthmachine.js` | 25 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/lemlist.js` | 15 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| MEDIUM | `backend/api/lemlist.js` | 647 | Empty catch block (swallowed error) | `} catch { /* logger optional */ }` |
| MEDIUM | `backend/api/lemlist.js` | 687 | Empty catch block (swallowed error) | `} catch { /* logger optional */ }` |
| HIGH | `backend/api/lemlist.js` | 749 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/linkedin.js` | 56 | fetch() without res.ok check before .json() | `const res = await fetch(`${VOYAGER_BASE}${endpoint}`, {` |
| HIGH | `backend/api/odoo.js` | 20 | fetch() without res.ok check before .json() | `const res = await fetch(`${url}/jsonrpc`, {` |
| HIGH | `backend/api/pipedrive.js` | 16 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/salesforce.js` | 13 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/waalaxy.js` | 25 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `frontend/src/components/AuthGate.jsx` | 214 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/forgot-password', {` |
| LOW | `frontend/src/components/FieldMappingSettings.jsx` | 47 | Hardcoded CRM provider list (may be incomplete) | `const crmProviders = ['pipedrive', 'hubspot', 'salesforce'];` |
| MEDIUM | `frontend/src/components/ICPInsightsCard.jsx` | 201 | new Date() on potentially null value without guard | `{new Date(data.analyzedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: ` |
| MEDIUM | `frontend/src/components/OnboardingChecklist.jsx` | 47 | Empty catch block (swallowed error) | `} catch { /* checklist won't show */ }` |
| MEDIUM | `frontend/src/components/TeamSettings.jsx` | 53 | Native alert()/prompt() in frontend | `alert(err.message);` |
| MEDIUM | `frontend/src/components/TeamSettings.jsx` | 74 | Native alert()/prompt() in frontend | `alert(err.message);` |
| MEDIUM | `frontend/src/components/TeamSettings.jsx` | 84 | Native alert()/prompt() in frontend | `alert(err.message);` |
| MEDIUM | `frontend/src/components/TeamSettings.jsx` | 93 | Native alert()/prompt() in frontend | `alert(err.message);` |
| HIGH | `frontend/src/components/VariableManager.jsx` | 378 | JSON.parse without try/catch | `initialRegistry ? JSON.parse(JSON.stringify(initialRegistry)) : JSON.parse(JSON.` |
| MEDIUM | `frontend/src/components/campaigns/CampaignDetailLayout.jsx` | 94 | Native alert()/prompt() in frontend | `window.alert(t('campaigns.archiveFailed', { error: err.message \|\| 'erreur inco` |
| MEDIUM | `frontend/src/components/campaigns/tabs/RepliesTab.jsx` | 125 | new Date() on potentially null value without guard | `const happenedAt = a.happened_at ? new Date(a.happened_at) : null;` |
| MEDIUM | `frontend/src/components/editor/__tests__/editor-helpers.test.js` | 14 | Native alert()/prompt() in frontend | `expect(escapeHtml('<script>alert("xss")</script>')).toBe(` |
| MEDIUM | `frontend/src/components/editor/__tests__/editor-helpers.test.js` | 15 | Native alert()/prompt() in frontend | `'&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'` |
| MEDIUM | `frontend/src/pages/CampaignsList.jsx` | 114 | Native alert()/prompt() in frontend | `window.alert(t('campaigns.errorPrefix', { message: err.message }));` |
| MEDIUM | `frontend/src/pages/CampaignsList.jsx` | 132 | Native alert()/prompt() in frontend | `window.alert(t('campaigns.errorPrefix', { message: err.message }));` |
| MEDIUM | `frontend/src/pages/CampaignsList.jsx` | 517 | new Date() on potentially null value without guard | `{en ? 'Sends at:' : 'Envoi à :'} {new Date(q.scheduled_at).toLocaleString(en ? '` |
| MEDIUM | `frontend/src/pages/CampaignsList.jsx` | 551 | new Date() on potentially null value without guard | `{en ? 'Sent:' : 'Envoyé :'} {new Date(q.sent_at).toLocaleString(en ? 'en-US' : '` |
| HIGH | `frontend/src/pages/ChatPage.jsx` | 1975 | JSON.parse without try/catch | `metadata: m.metadata ? (typeof m.metadata === 'string' ? JSON.parse(m.metadata) ` |
| MEDIUM | `frontend/src/pages/ClientsPage.jsx` | 582 | Native alert()/prompt() in frontend | `const subject = prompt('Objet de l\'email :');` |
| MEDIUM | `frontend/src/pages/ClientsPage.jsx` | 584 | Native alert()/prompt() in frontend | `const body = prompt('Message :');` |
| HIGH | `frontend/src/pages/CopyEditorPage.jsx` | 805 | JSON.parse without try/catch | `const copy = { ...JSON.parse(JSON.stringify(original)), id: tpId + '-copy', labe` |
| MEDIUM | `frontend/src/pages/MembershipPage.jsx` | 136 | new Date() on potentially null value without guard | `<div style={{ fontWeight: 600 }}>{new Date(r.renewal_date).toLocaleDateString(en` |
| MEDIUM | `frontend/src/pages/MemoryExplorerPage.jsx` | 392 | new Date() on potentially null value without guard | `<span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>{e.sen` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 103 | Native alert()/prompt() in frontend | `alert((lang === 'en' ? 'Error: ' : 'Erreur: ') + err.message);` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 166 | Native alert()/prompt() in frontend | `alert((lang === 'en' ? 'Error: ' : 'Erreur: ') + err.message);` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 285 | Native alert()/prompt() in frontend | `alert((lang === 'en' ? 'Error: ' : 'Erreur: ') + err.message);` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 416 | new Date() on potentially null value without guard | `{trigger.last_run && ` \u00B7 ${lang === 'en' ? 'Last run:' : 'Dernier run :'} $` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 473 | Native alert()/prompt() in frontend | `alert((en ? 'Error: ' : 'Erreur: ') + err.message);` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 525 | new Date() on potentially null value without guard | `{email.sent_at && ` \u00B7 ${en ? 'Sent on' : 'Envoy\u00E9 le'} ${new Date(email` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 766 | new Date() on potentially null value without guard | `{e.sent_at ? new Date(e.sent_at).toLocaleDateString(en ? 'en-US' : 'fr-FR', { da` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 1015 | new Date() on potentially null value without guard | `{en ? 'by' : 'par'} {c.created_by_name} {'\u00B7'} {new Date(c.created_at).toLoc` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 1207 | new Date() on potentially null value without guard | `{en ? 'Scheduled:' : 'Planifié :'} {new Date(q.scheduled_at).toLocaleString(lang` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 1243 | new Date() on potentially null value without guard | `{en ? 'Sent:' : 'Envoyé :'} {new Date(q.sent_at).toLocaleString(lang === 'en' ? ` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 1310 | new Date() on potentially null value without guard | `{test.startedAt ? new Date(test.startedAt).toLocaleDateString(en ? 'en-US' : 'fr` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 1501 | new Date() on potentially null value without guard | `{e.to} &middot; {new Date(e.createdAt).toLocaleDateString(en ? 'en-US' : 'fr-FR'` |
| HIGH | `frontend/src/pages/ProfilePage.jsx` | 127 | fetch() without res.ok check before .json() | `const res = await fetch('/api/profile', {` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 256 | Native alert()/prompt() in frontend | `alert((en ? 'Reparse failed for all docs:\n\n' : 'Reparse a échoué pour tous les` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 260 | Native alert()/prompt() in frontend | `alert((en ? 'Error: ' : 'Erreur: ') + err.message);` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 263 | Native alert()/prompt() in frontend | `alert('Auto-fill: ' + err.message);` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 469 | new Date() on potentially null value without guard | `{new Date(doc.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: '` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 476 | Empty catch block (swallowed error) | `} catch {}` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 746 | new Date() on potentially null value without guard | `<span style={{ color: 'var(--text-muted)', fontSize: 10 }}>{new Date(doc.created` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 747 | Empty catch block (swallowed error) | `<button onClick={async () => { try { await request('/documents/' + doc.id, { met` |
| MEDIUM | `frontend/src/pages/RecosPage.jsx` | 67 | new Date() on potentially null value without guard | `date: d.created_at ? new Date(d.created_at).toLocaleDateString('fr-FR', { day: '` |
| HIGH | `frontend/src/pages/ResetPasswordPage.jsx` | 129 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/reset-password', {` |
| HIGH | `frontend/src/pages/SettingsPage.jsx` | 136 | JSON.parse without try/catch | `return saved ? { ...DEFAULT_PREFERENCES, ...JSON.parse(saved) } : { ...DEFAULT_P` |
| HIGH | `frontend/src/pages/SettingsPage.jsx` | 1007 | JSON.parse without try/catch | `const user = JSON.parse(localStorage.getItem('bakal_user') \|\| '{}');` |
| MEDIUM | `frontend/src/pages/SignalsPage.jsx` | 308 | new Date() on potentially null value without guard | `<span>{new Date(s.detected_at).toLocaleDateString(en ? 'en-US' : 'fr-FR', { day:` |
| MEDIUM | `frontend/src/pages/SignalsPage.jsx` | 452 | new Date() on potentially null value without guard | `{new Date(s.detected_at).toLocaleDateString(en ? 'en-US' : 'fr-FR', { day: 'nume` |
| MEDIUM | `frontend/src/pages/SignalsPage.jsx` | 585 | new Date() on potentially null value without guard | `{c.last_run && <span>{en ? 'Last scan' : 'Dernier scan'}: {new Date(c.last_run).` |
| HIGH | `frontend/src/services/api-client.js` | 23 | fetch() without res.ok check before .json() | `let res = await fetch(url, { headers, ...opts });` |
| HIGH | `frontend/src/services/api-client.js` | 31 | fetch() without res.ok check before .json() | `res = await fetch(url, { headers, ...opts });` |
| HIGH | `frontend/src/services/api-client.js` | 110 | JSON.parse without try/catch | `? (typeof c.ab_config === 'string' ? JSON.parse(c.ab_config) : c.ab_config)` |
| MEDIUM | `frontend/src/services/api-client.js` | 115 | new Date() on potentially null value without guard | `createdDate: c.created_at ? new Date(c.created_at).toLocaleDateString('fr-FR', {` |
| HIGH | `frontend/src/services/api-client.js` | 716 | fetch() without res.ok check before .json() | `const res = await fetch(url, { method: 'POST', headers, body: formData });` |
| HIGH | `frontend/src/services/auth.js` | 53 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/login', {` |
| HIGH | `frontend/src/services/auth.js` | 77 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/register', {` |
| HIGH | `frontend/src/services/auth.js` | 95 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/resend-verification', {` |
| HIGH | `frontend/src/services/auth.js` | 116 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/refresh', {` |
| HIGH | `frontend/src/services/auth.js` | 144 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/account', {` |
| HIGH | `frontend/src/services/auth.js` | 161 | fetch() without res.ok check before .json() | `await fetch('/api/auth/logout', {` |

### Automated Audit — 2026-06-20

Found 187 potential issue(s):

| Severity | File | Line | Pattern | Code |
|----------|------|------|---------|------|
| HIGH | `backend/routes/ai.js` | 438 | JSON.parse without try/catch | `const data = typeof pattern.data === 'string' ? JSON.parse(pattern.data) : (patt` |
| MEDIUM | `backend/routes/ai.js` | 439 | new Date() on potentially null value without guard | `const age = Math.round((Date.now() - new Date(pattern.date_discovered).getTime()` |
| MEDIUM | `backend/routes/ai.js` | 525 | Empty catch block (swallowed error) | `} catch { /* solo user */ }` |
| MEDIUM | `backend/routes/ai.js` | 703 | Empty catch block (swallowed error) | `try { campaignMap[cid] = await db.campaigns.get(cid); } catch {}` |
| HIGH | `backend/routes/ai.js` | 861 | JSON.parse without try/catch | `const config = typeof campaign.ab_config === 'string' ? JSON.parse(campaign.ab_c` |
| MEDIUM | `backend/routes/analytics.js` | 102 | new Date() on potentially null value without guard | `const updatedAt = opp.updated_at ? new Date(opp.updated_at).getTime() : now;` |
| MEDIUM | `backend/routes/analytics.js` | 103 | new Date() on potentially null value without guard | `const createdAt = opp.created_at ? new Date(opp.created_at).getTime() : now;` |
| MEDIUM | `backend/routes/analytics.js` | 578 | new Date() on potentially null value without guard | `const create = new Date(o.created_at).getTime();` |
| MEDIUM | `backend/routes/analytics.js` | 651 | new Date() on potentially null value without guard | `const updatedAt = opp.updated_at ? new Date(opp.updated_at).getTime() : now;` |
| MEDIUM | `backend/routes/analytics.js` | 742 | new Date() on potentially null value without guard | `const stale = activeOpps.filter(o => { const u = o.updated_at ? new Date(o.updat` |
| MEDIUM | `backend/routes/auth.js` | 270 | Empty catch block (swallowed error) | `} catch { /* no team */ }` |
| MEDIUM | `backend/routes/auth.js` | 497 | Empty catch block (swallowed error) | `} catch { /* no team — ok */ }` |
| MEDIUM | `backend/routes/campaigns.js` | 237 | new Date() on potentially null value without guard | `const lastOpt = campaign.last_optimized_at ? new Date(campaign.last_optimized_at` |
| MEDIUM | `backend/routes/chat.js` | 251 | Empty catch block (swallowed error) | `} catch { /* default to fr */ }` |
| MEDIUM | `backend/routes/chat.js` | 324 | new Date() on potentially null value without guard | `new Date(c.created_at).getTime() > sixtyAgo` |
| LOW | `backend/routes/chat.js` | 450 | Hardcoded CRM provider list (may be incomplete) | `const providers = ['pipedrive', 'hubspot', 'salesforce', 'odoo'];` |
| HIGH | `backend/routes/crm.js` | 318 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| HIGH | `backend/routes/crm.js` | 351 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| HIGH | `backend/routes/crm.js` | 367 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| HIGH | `backend/routes/crm.js` | 715 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| HIGH | `backend/routes/crm.js` | 744 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| LOW | `backend/routes/crm.js` | 1036 | Hardcoded CRM provider list (may be incomplete) | `for (const provider of ['pipedrive', 'salesforce', 'hubspot']) {` |
| MEDIUM | `backend/routes/crm.js` | 1047 | Empty catch block (swallowed error) | `} catch { /* scoring works without deals */ }` |
| HIGH | `backend/routes/crm.js` | 1356 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| HIGH | `backend/routes/crm.js` | 1370 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| MEDIUM | `backend/routes/crm.js` | 1400 | Empty catch block (swallowed error) | `} catch { /* skip individual failures */ }` |
| HIGH | `backend/routes/crm.js` | 1569 | fetch() without res.ok check before .json() | `const tokenRes = await fetch('https://login.salesforce.com/services/oauth2/token` |
| HIGH | `backend/routes/crm.js` | 1714 | fetch() without res.ok check before .json() | `const tokenRes = await fetch('https://login.salesforce.com/services/oauth2/token` |
| HIGH | `backend/routes/crm.js` | 1765 | fetch() without res.ok check before .json() | `const tokenRes = await fetch('https://login.salesforce.com/services/oauth2/token` |
| MEDIUM | `backend/routes/documents.js` | 141 | Empty catch block (swallowed error) | `try { fs.unlinkSync(file.path); } catch {}` |
| MEDIUM | `backend/routes/documents.js` | 244 | Empty catch block (swallowed error) | `try { fs.unlinkSync(tempPath); } catch {}` |
| HIGH | `backend/routes/export.js` | 199 | JSON.parse without try/catch | `? JSON.parse(o.score_breakdown \|\| '{}')` |
| MEDIUM | `backend/routes/extension.js` | 62 | Empty catch block (swallowed error) | `} catch { /* optional */ }` |
| HIGH | `backend/routes/extension.js` | 102 | JSON.parse without try/catch | `const data = (typeof opp.data === 'string' ? JSON.parse(opp.data) : opp.data) \|` |
| HIGH | `backend/routes/extension.js` | 143 | JSON.parse without try/catch | `const data = (typeof opp.data === 'string' ? JSON.parse(opp.data) : opp.data) \|` |
| HIGH | `backend/routes/informz.js` | 67 | JSON.parse without try/catch | `if (m) parsed = JSON.parse(m[0]);` |
| HIGH | `backend/routes/informz.js` | 210 | JSON.parse without try/catch | `if (m) parsed = JSON.parse(m[0]);` |
| MEDIUM | `backend/routes/nurture.js` | 346 | Empty catch block (swallowed error) | `} catch { /* optional */ }` |
| MEDIUM | `backend/routes/nurture.js` | 359 | Empty catch block (swallowed error) | `if (m) { try { sampleEmail = JSON.parse(m[0]); } catch { /* malformed JSON */ } ` |
| MEDIUM | `backend/routes/nurture.js` | 361 | Empty catch block (swallowed error) | `} catch { /* skip preview generation */ }` |
| HIGH | `backend/routes/nurture.js` | 432 | fetch() without res.ok check before .json() | `const tokenRes = await fetch('https://oauth2.googleapis.com/token', {` |
| HIGH | `backend/routes/nurture.js` | 522 | fetch() without res.ok check before .json() | `const tokenRes = await fetch('https://login.microsoftonline.com/common/oauth2/v2` |
| HIGH | `backend/routes/settings.js` | 375 | JSON.parse without try/catch | `const currentMeta = typeof existing.metadata === 'string' ? JSON.parse(existing.` |
| HIGH | `backend/routes/signals.js` | 166 | JSON.parse without try/catch | `if (m) email = JSON.parse(m[0]);` |
| HIGH | `backend/routes/signals.js` | 351 | JSON.parse without try/catch | `if (m) sequence = JSON.parse(m[0]);` |
| HIGH | `backend/routes/stats.js` | 23 | fetch() without res.ok check before .json() | `const resp = await fetch(url, options);` |
| HIGH | `backend/routes/team-campaigns.js` | 136 | JSON.parse without try/catch | `if (m) sampleEmail = JSON.parse(m[0]);` |
| MEDIUM | `backend/routes/team-campaigns.js` | 202 | Empty catch block (swallowed error) | `if (m) { try { email = JSON.parse(m[0]); } catch { /* malformed AI response */ }` |
| HIGH | `backend/lib/ab-memory.js` | 187 | JSON.parse without try/catch | `const data = typeof top.data === 'string' ? JSON.parse(top.data) : (top.data \|\` |
| MEDIUM | `backend/lib/agent-chains.js` | 338 | Empty catch block (swallowed error) | `} catch { /* no product lines */ }` |
| MEDIUM | `backend/lib/agent-chains.js` | 360 | Empty catch block (swallowed error) | `} catch { /* ok */ }` |
| MEDIUM | `backend/lib/agents/signal-agent.js` | 125 | Empty catch block (swallowed error) | `} catch { /* enrichment is optional */ }` |
| MEDIUM | `backend/lib/agents/signal-agent.js` | 181 | Empty catch block (swallowed error) | `} catch { /* notifications are optional */ }` |
| MEDIUM | `backend/lib/agents/signal-agent.js` | 206 | Empty catch block (swallowed error) | `} catch { /* skip duplicates */ }` |
| MEDIUM | `backend/lib/agents/signal-agent.js` | 212 | Empty catch block (swallowed error) | `} catch { /* auto-prospecting is optional */ }` |
| HIGH | `backend/lib/agents/signal-agent.js` | 289 | fetch() without res.ok check before .json() | `const res = await fetch('https://api.apollo.io/v1/mixed_people/search', {` |
| MEDIUM | `backend/lib/agents/timing-agent.js` | 99 | new Date() on potentially null value without guard | `const replied = new Date(r.replied_at).getTime();` |
| MEDIUM | `backend/lib/agents/timing-agent.js` | 163 | new Date() on potentially null value without guard | `const sent = new Date(r.sent_at).getTime();` |
| MEDIUM | `backend/lib/agents/timing-agent.js` | 164 | new Date() on potentially null value without guard | `const resp = new Date(r.response_at).getTime();` |
| MEDIUM | `backend/lib/churn-scoring.js` | 85 | new Date() on potentially null value without guard | `const age = (now - new Date(e.created_at).getTime()) / DAY_MS;` |
| MEDIUM | `backend/lib/conversation-autopilot.js` | 190 | Empty catch block (swallowed error) | `try { return JSON.parse(match[0]); } catch { /* fallthrough */ }` |
| MEDIUM | `backend/lib/conversation-autopilot.js` | 319 | new Date() on potentially null value without guard | `return history.sort((a, b) => new Date(a.date) - new Date(b.date));` |
| MEDIUM | `backend/lib/crm-agent.js` | 62 | Empty catch block (swallowed error) | `} catch { /* solo user, no team */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 177 | Empty catch block (swallowed error) | `} catch { /* ok */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 205 | Empty catch block (swallowed error) | `} catch { /* notification is non-blocking */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 283 | Empty catch block (swallowed error) | `} catch { /* owner mapping is optional */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 350 | Empty catch block (swallowed error) | `} catch { /* mapping is optional */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 379 | Empty catch block (swallowed error) | `} catch { /* deal sync is optional */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 548 | Empty catch block (swallowed error) | `} catch { /* fallback to 50/50 */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 637 | Empty catch block (swallowed error) | `} catch { /* patterns optional */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 677 | Empty catch block (swallowed error) | `} catch { /* fallback to single */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 694 | Empty catch block (swallowed error) | `} catch { /* fallback below */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 772 | new Date() on potentially null value without guard | `.map(o => (new Date(o.updated_at).getTime() - new Date(o.created_at).getTime()) ` |
| MEDIUM | `backend/lib/crm-agent.js` | 794 | new Date() on potentially null value without guard | `.map(o => (new Date(o.updated_at).getTime() - new Date(o.created_at).getTime()) ` |
| MEDIUM | `backend/lib/crm-agent.js` | 864 | Empty catch block (swallowed error) | `} catch { /* optional */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 893 | Empty catch block (swallowed error) | `} catch { /* optional */ }` |
| MEDIUM | `backend/lib/crm-bidirectional-sync.js` | 84 | new Date() on potentially null value without guard | `const lastPush = opp.score_pushed_at ? new Date(opp.score_pushed_at).getTime() :` |
| MEDIUM | `backend/lib/crm-bidirectional-sync.js` | 93 | Empty catch block (swallowed error) | `} catch { /* ignore individual push errors */ }` |
| HIGH | `backend/lib/crm-export.js` | 23 | fetch() without res.ok check before .json() | `const res = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {` |
| HIGH | `backend/lib/crm-export.js` | 51 | fetch() without res.ok check before .json() | `const res = await fetch(`${instanceUrl}/services/data/v62.0/sobjects/Contact`, {` |
| HIGH | `backend/lib/crm-export.js` | 76 | fetch() without res.ok check before .json() | `const res = await fetch(`https://api.pipedrive.com/v1/persons?api_token=${apiKey` |
| HIGH | `backend/lib/crm-export.js` | 90 | fetch() without res.ok check before .json() | `await fetch(`https://api.pipedrive.com/v1/notes?api_token=${apiKey}`, {` |
| MEDIUM | `backend/lib/crm-owner-resolver.js` | 32 | Empty catch block (swallowed error) | `} catch { /* no team = solo user */ }` |
| MEDIUM | `backend/lib/deliverability-agent.js` | 200 | Empty catch block (swallowed error) | `} catch { /* notification is best-effort */ }` |
| HIGH | `backend/lib/email-outbound.js` | 117 | fetch() without res.ok check before .json() | `const res = await fetch(tokenUrl, {` |
| HIGH | `backend/lib/email.js` | 16 | fetch() without res.ok check before .json() | `const res = await fetch('https://api.resend.com/emails', {` |
| MEDIUM | `backend/lib/enrich-agent.js` | 210 | Empty catch block (swallowed error) | `} catch { /* Brave search failed */ }` |
| HIGH | `backend/lib/enrich-agent.js` | 241 | JSON.parse without try/catch | `return JSON.parse(match[0]);` |
| MEDIUM | `backend/lib/enrich-agent.js` | 336 | Empty catch block (swallowed error) | `} catch { /* verification failed, keep the email */ }` |
| MEDIUM | `backend/lib/enrich-agent.js` | 375 | Empty catch block (swallowed error) | `} catch { /* continue */ }` |
| HIGH | `backend/lib/enrich-agent.js` | 411 | JSON.parse without try/catch | `const parsed = JSON.parse(match[0]);` |
| HIGH | `backend/lib/icp-agent.js` | 170 | JSON.parse without try/catch | `const data = typeof userIcp.data === 'string' ? JSON.parse(userIcp.data) : userI` |
| HIGH | `backend/lib/lifecycle-emails.js` | 188 | JSON.parse without try/catch | `const userData = (typeof user.data === 'string' ? JSON.parse(user.data) : user.d` |
| MEDIUM | `backend/lib/lifecycle-emails.js` | 190 | new Date() on potentially null value without guard | `const daysSinceSignup = Math.floor((Date.now() - new Date(user.created_at).getTi` |
| HIGH | `backend/lib/lifecycle-emails.js` | 240 | JSON.parse without try/catch | `const userData = (typeof user.data === 'string' ? JSON.parse(user.data) : user.d` |
| MEDIUM | `backend/lib/nurture-engine.js` | 78 | new Date() on potentially null value without guard | `const dealAge = (Date.now() - new Date(deal.createdAt).getTime()) / DAY_MS;` |
| MEDIUM | `backend/lib/nurture-engine.js` | 104 | new Date() on potentially null value without guard | `const lastUpdate = c.update_time ? new Date(c.update_time).getTime() : 0;` |
| MEDIUM | `backend/lib/nurture-engine.js` | 121 | new Date() on potentially null value without guard | `const renewalTime = new Date(o.renewal_date).getTime();` |
| MEDIUM | `backend/lib/nurture-engine.js` | 276 | Empty catch block (swallowed error) | `try { return JSON.parse(jsonMatch[0]); } catch { /* fall through */ }` |
| HIGH | `backend/lib/outreach-deploy.js` | 79 | fetch() without res.ok check before .json() | `const r = await fetch('https://api.apollo.io/v1/emailer_campaigns', {` |
| HIGH | `backend/lib/outreach-deploy.js` | 124 | fetch() without res.ok check before .json() | `const r = await fetch(`https://api.instantly.ai/api/v1/campaign/step/add?api_key` |
| MEDIUM | `backend/lib/reporting-agent.js` | 143 | Empty catch block (swallowed error) | `} catch { /* ignore notification errors */ }` |
| MEDIUM | `backend/lib/response-analysis-agent.js` | 58 | new Date() on potentially null value without guard | `const sentAt = new Date(email.sent_at).getTime();` |
| MEDIUM | `backend/lib/response-analysis-agent.js` | 60 | new Date() on potentially null value without guard | `const actDate = a.dueDate ? new Date(a.dueDate).getTime() : 0;` |
| HIGH | `backend/lib/response-analysis-agent.js` | 272 | JSON.parse without try/catch | `if (match) return JSON.parse(match[0]);` |
| MEDIUM | `backend/lib/response-analysis-agent.js` | 273 | Empty catch block (swallowed error) | `} catch { /* fallback below */ }` |
| HIGH | `backend/lib/template-agent.js` | 169 | JSON.parse without try/catch | `if (match) template = JSON.parse(match[0]);` |
| HIGH | `backend/lib/vector-store.js` | 190 | fetch() without res.ok check before .json() | `const res = await fetch('https://api.voyageai.com/v1/embeddings', {` |
| HIGH | `backend/lib/web-prospect-agent.js` | 169 | JSON.parse without try/catch | `const parsed = JSON.parse(jsonMatch[0]);` |
| HIGH | `backend/api/airtable-crm.js` | 18 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/apollo.js` | 24 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/brave-search.js` | 30 | fetch() without res.ok check before .json() | `const res = await fetch(`${BASE_URL}?${params}`, {` |
| HIGH | `backend/api/folk.js` | 15 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/hubspot.js` | 15 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/informz.js` | 73 | fetch() without res.ok check before .json() | `const res = await fetch(endpoint, {` |
| HIGH | `backend/api/instantly.js` | 28 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/lagrowthmachine.js` | 25 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/lemlist.js` | 15 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| MEDIUM | `backend/api/lemlist.js` | 647 | Empty catch block (swallowed error) | `} catch { /* logger optional */ }` |
| MEDIUM | `backend/api/lemlist.js` | 687 | Empty catch block (swallowed error) | `} catch { /* logger optional */ }` |
| HIGH | `backend/api/lemlist.js` | 749 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/linkedin.js` | 56 | fetch() without res.ok check before .json() | `const res = await fetch(`${VOYAGER_BASE}${endpoint}`, {` |
| HIGH | `backend/api/odoo.js` | 20 | fetch() without res.ok check before .json() | `const res = await fetch(`${url}/jsonrpc`, {` |
| HIGH | `backend/api/pipedrive.js` | 16 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/salesforce.js` | 13 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/waalaxy.js` | 25 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `frontend/src/components/AuthGate.jsx` | 214 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/forgot-password', {` |
| LOW | `frontend/src/components/FieldMappingSettings.jsx` | 47 | Hardcoded CRM provider list (may be incomplete) | `const crmProviders = ['pipedrive', 'hubspot', 'salesforce'];` |
| MEDIUM | `frontend/src/components/ICPInsightsCard.jsx` | 201 | new Date() on potentially null value without guard | `{new Date(data.analyzedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: ` |
| MEDIUM | `frontend/src/components/OnboardingChecklist.jsx` | 47 | Empty catch block (swallowed error) | `} catch { /* checklist won't show */ }` |
| MEDIUM | `frontend/src/components/TeamSettings.jsx` | 53 | Native alert()/prompt() in frontend | `alert(err.message);` |
| MEDIUM | `frontend/src/components/TeamSettings.jsx` | 74 | Native alert()/prompt() in frontend | `alert(err.message);` |
| MEDIUM | `frontend/src/components/TeamSettings.jsx` | 84 | Native alert()/prompt() in frontend | `alert(err.message);` |
| MEDIUM | `frontend/src/components/TeamSettings.jsx` | 93 | Native alert()/prompt() in frontend | `alert(err.message);` |
| HIGH | `frontend/src/components/VariableManager.jsx` | 378 | JSON.parse without try/catch | `initialRegistry ? JSON.parse(JSON.stringify(initialRegistry)) : JSON.parse(JSON.` |
| MEDIUM | `frontend/src/components/campaigns/CampaignDetailLayout.jsx` | 94 | Native alert()/prompt() in frontend | `window.alert(t('campaigns.archiveFailed', { error: err.message \|\| 'erreur inco` |
| MEDIUM | `frontend/src/components/campaigns/tabs/RepliesTab.jsx` | 125 | new Date() on potentially null value without guard | `const happenedAt = a.happened_at ? new Date(a.happened_at) : null;` |
| MEDIUM | `frontend/src/components/editor/__tests__/editor-helpers.test.js` | 14 | Native alert()/prompt() in frontend | `expect(escapeHtml('<script>alert("xss")</script>')).toBe(` |
| MEDIUM | `frontend/src/components/editor/__tests__/editor-helpers.test.js` | 15 | Native alert()/prompt() in frontend | `'&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'` |
| MEDIUM | `frontend/src/pages/CampaignsList.jsx` | 114 | Native alert()/prompt() in frontend | `window.alert(t('campaigns.errorPrefix', { message: err.message }));` |
| MEDIUM | `frontend/src/pages/CampaignsList.jsx` | 132 | Native alert()/prompt() in frontend | `window.alert(t('campaigns.errorPrefix', { message: err.message }));` |
| MEDIUM | `frontend/src/pages/CampaignsList.jsx` | 517 | new Date() on potentially null value without guard | `{en ? 'Sends at:' : 'Envoi à :'} {new Date(q.scheduled_at).toLocaleString(en ? '` |
| MEDIUM | `frontend/src/pages/CampaignsList.jsx` | 551 | new Date() on potentially null value without guard | `{en ? 'Sent:' : 'Envoyé :'} {new Date(q.sent_at).toLocaleString(en ? 'en-US' : '` |
| HIGH | `frontend/src/pages/ChatPage.jsx` | 1975 | JSON.parse without try/catch | `metadata: m.metadata ? (typeof m.metadata === 'string' ? JSON.parse(m.metadata) ` |
| MEDIUM | `frontend/src/pages/ClientsPage.jsx` | 582 | Native alert()/prompt() in frontend | `const subject = prompt('Objet de l\'email :');` |
| MEDIUM | `frontend/src/pages/ClientsPage.jsx` | 584 | Native alert()/prompt() in frontend | `const body = prompt('Message :');` |
| HIGH | `frontend/src/pages/CopyEditorPage.jsx` | 805 | JSON.parse without try/catch | `const copy = { ...JSON.parse(JSON.stringify(original)), id: tpId + '-copy', labe` |
| MEDIUM | `frontend/src/pages/MembershipPage.jsx` | 136 | new Date() on potentially null value without guard | `<div style={{ fontWeight: 600 }}>{new Date(r.renewal_date).toLocaleDateString(en` |
| MEDIUM | `frontend/src/pages/MemoryExplorerPage.jsx` | 392 | new Date() on potentially null value without guard | `<span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>{e.sen` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 103 | Native alert()/prompt() in frontend | `alert((lang === 'en' ? 'Error: ' : 'Erreur: ') + err.message);` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 166 | Native alert()/prompt() in frontend | `alert((lang === 'en' ? 'Error: ' : 'Erreur: ') + err.message);` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 285 | Native alert()/prompt() in frontend | `alert((lang === 'en' ? 'Error: ' : 'Erreur: ') + err.message);` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 416 | new Date() on potentially null value without guard | `{trigger.last_run && ` \u00B7 ${lang === 'en' ? 'Last run:' : 'Dernier run :'} $` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 473 | Native alert()/prompt() in frontend | `alert((en ? 'Error: ' : 'Erreur: ') + err.message);` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 525 | new Date() on potentially null value without guard | `{email.sent_at && ` \u00B7 ${en ? 'Sent on' : 'Envoy\u00E9 le'} ${new Date(email` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 766 | new Date() on potentially null value without guard | `{e.sent_at ? new Date(e.sent_at).toLocaleDateString(en ? 'en-US' : 'fr-FR', { da` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 1015 | new Date() on potentially null value without guard | `{en ? 'by' : 'par'} {c.created_by_name} {'\u00B7'} {new Date(c.created_at).toLoc` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 1207 | new Date() on potentially null value without guard | `{en ? 'Scheduled:' : 'Planifié :'} {new Date(q.scheduled_at).toLocaleString(lang` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 1243 | new Date() on potentially null value without guard | `{en ? 'Sent:' : 'Envoyé :'} {new Date(q.sent_at).toLocaleString(lang === 'en' ? ` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 1310 | new Date() on potentially null value without guard | `{test.startedAt ? new Date(test.startedAt).toLocaleDateString(en ? 'en-US' : 'fr` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 1501 | new Date() on potentially null value without guard | `{e.to} &middot; {new Date(e.createdAt).toLocaleDateString(en ? 'en-US' : 'fr-FR'` |
| HIGH | `frontend/src/pages/ProfilePage.jsx` | 127 | fetch() without res.ok check before .json() | `const res = await fetch('/api/profile', {` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 256 | Native alert()/prompt() in frontend | `alert((en ? 'Reparse failed for all docs:\n\n' : 'Reparse a échoué pour tous les` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 260 | Native alert()/prompt() in frontend | `alert((en ? 'Error: ' : 'Erreur: ') + err.message);` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 263 | Native alert()/prompt() in frontend | `alert('Auto-fill: ' + err.message);` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 469 | new Date() on potentially null value without guard | `{new Date(doc.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: '` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 476 | Empty catch block (swallowed error) | `} catch {}` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 746 | new Date() on potentially null value without guard | `<span style={{ color: 'var(--text-muted)', fontSize: 10 }}>{new Date(doc.created` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 747 | Empty catch block (swallowed error) | `<button onClick={async () => { try { await request('/documents/' + doc.id, { met` |
| MEDIUM | `frontend/src/pages/RecosPage.jsx` | 67 | new Date() on potentially null value without guard | `date: d.created_at ? new Date(d.created_at).toLocaleDateString('fr-FR', { day: '` |
| HIGH | `frontend/src/pages/ResetPasswordPage.jsx` | 129 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/reset-password', {` |
| HIGH | `frontend/src/pages/SettingsPage.jsx` | 136 | JSON.parse without try/catch | `return saved ? { ...DEFAULT_PREFERENCES, ...JSON.parse(saved) } : { ...DEFAULT_P` |
| HIGH | `frontend/src/pages/SettingsPage.jsx` | 1007 | JSON.parse without try/catch | `const user = JSON.parse(localStorage.getItem('bakal_user') \|\| '{}');` |
| MEDIUM | `frontend/src/pages/SignalsPage.jsx` | 308 | new Date() on potentially null value without guard | `<span>{new Date(s.detected_at).toLocaleDateString(en ? 'en-US' : 'fr-FR', { day:` |
| MEDIUM | `frontend/src/pages/SignalsPage.jsx` | 452 | new Date() on potentially null value without guard | `{new Date(s.detected_at).toLocaleDateString(en ? 'en-US' : 'fr-FR', { day: 'nume` |
| MEDIUM | `frontend/src/pages/SignalsPage.jsx` | 585 | new Date() on potentially null value without guard | `{c.last_run && <span>{en ? 'Last scan' : 'Dernier scan'}: {new Date(c.last_run).` |
| HIGH | `frontend/src/services/api-client.js` | 23 | fetch() without res.ok check before .json() | `let res = await fetch(url, { headers, ...opts });` |
| HIGH | `frontend/src/services/api-client.js` | 31 | fetch() without res.ok check before .json() | `res = await fetch(url, { headers, ...opts });` |
| HIGH | `frontend/src/services/api-client.js` | 110 | JSON.parse without try/catch | `? (typeof c.ab_config === 'string' ? JSON.parse(c.ab_config) : c.ab_config)` |
| MEDIUM | `frontend/src/services/api-client.js` | 115 | new Date() on potentially null value without guard | `createdDate: c.created_at ? new Date(c.created_at).toLocaleDateString('fr-FR', {` |
| HIGH | `frontend/src/services/api-client.js` | 716 | fetch() without res.ok check before .json() | `const res = await fetch(url, { method: 'POST', headers, body: formData });` |
| HIGH | `frontend/src/services/auth.js` | 53 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/login', {` |
| HIGH | `frontend/src/services/auth.js` | 77 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/register', {` |
| HIGH | `frontend/src/services/auth.js` | 95 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/resend-verification', {` |
| HIGH | `frontend/src/services/auth.js` | 116 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/refresh', {` |
| HIGH | `frontend/src/services/auth.js` | 144 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/account', {` |
| HIGH | `frontend/src/services/auth.js` | 161 | fetch() without res.ok check before .json() | `await fetch('/api/auth/logout', {` |

### Automated Audit — 2026-06-21

Found 187 potential issue(s):

| Severity | File | Line | Pattern | Code |
|----------|------|------|---------|------|
| HIGH | `backend/routes/ai.js` | 438 | JSON.parse without try/catch | `const data = typeof pattern.data === 'string' ? JSON.parse(pattern.data) : (patt` |
| MEDIUM | `backend/routes/ai.js` | 439 | new Date() on potentially null value without guard | `const age = Math.round((Date.now() - new Date(pattern.date_discovered).getTime()` |
| MEDIUM | `backend/routes/ai.js` | 525 | Empty catch block (swallowed error) | `} catch { /* solo user */ }` |
| MEDIUM | `backend/routes/ai.js` | 703 | Empty catch block (swallowed error) | `try { campaignMap[cid] = await db.campaigns.get(cid); } catch {}` |
| HIGH | `backend/routes/ai.js` | 861 | JSON.parse without try/catch | `const config = typeof campaign.ab_config === 'string' ? JSON.parse(campaign.ab_c` |
| MEDIUM | `backend/routes/analytics.js` | 102 | new Date() on potentially null value without guard | `const updatedAt = opp.updated_at ? new Date(opp.updated_at).getTime() : now;` |
| MEDIUM | `backend/routes/analytics.js` | 103 | new Date() on potentially null value without guard | `const createdAt = opp.created_at ? new Date(opp.created_at).getTime() : now;` |
| MEDIUM | `backend/routes/analytics.js` | 578 | new Date() on potentially null value without guard | `const create = new Date(o.created_at).getTime();` |
| MEDIUM | `backend/routes/analytics.js` | 651 | new Date() on potentially null value without guard | `const updatedAt = opp.updated_at ? new Date(opp.updated_at).getTime() : now;` |
| MEDIUM | `backend/routes/analytics.js` | 742 | new Date() on potentially null value without guard | `const stale = activeOpps.filter(o => { const u = o.updated_at ? new Date(o.updat` |
| MEDIUM | `backend/routes/auth.js` | 270 | Empty catch block (swallowed error) | `} catch { /* no team */ }` |
| MEDIUM | `backend/routes/auth.js` | 497 | Empty catch block (swallowed error) | `} catch { /* no team — ok */ }` |
| MEDIUM | `backend/routes/campaigns.js` | 237 | new Date() on potentially null value without guard | `const lastOpt = campaign.last_optimized_at ? new Date(campaign.last_optimized_at` |
| MEDIUM | `backend/routes/chat.js` | 251 | Empty catch block (swallowed error) | `} catch { /* default to fr */ }` |
| MEDIUM | `backend/routes/chat.js` | 324 | new Date() on potentially null value without guard | `new Date(c.created_at).getTime() > sixtyAgo` |
| LOW | `backend/routes/chat.js` | 450 | Hardcoded CRM provider list (may be incomplete) | `const providers = ['pipedrive', 'hubspot', 'salesforce', 'odoo'];` |
| HIGH | `backend/routes/crm.js` | 318 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| HIGH | `backend/routes/crm.js` | 351 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| HIGH | `backend/routes/crm.js` | 367 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| HIGH | `backend/routes/crm.js` | 715 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| HIGH | `backend/routes/crm.js` | 744 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| LOW | `backend/routes/crm.js` | 1036 | Hardcoded CRM provider list (may be incomplete) | `for (const provider of ['pipedrive', 'salesforce', 'hubspot']) {` |
| MEDIUM | `backend/routes/crm.js` | 1047 | Empty catch block (swallowed error) | `} catch { /* scoring works without deals */ }` |
| HIGH | `backend/routes/crm.js` | 1356 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| HIGH | `backend/routes/crm.js` | 1370 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| MEDIUM | `backend/routes/crm.js` | 1400 | Empty catch block (swallowed error) | `} catch { /* skip individual failures */ }` |
| HIGH | `backend/routes/crm.js` | 1569 | fetch() without res.ok check before .json() | `const tokenRes = await fetch('https://login.salesforce.com/services/oauth2/token` |
| HIGH | `backend/routes/crm.js` | 1714 | fetch() without res.ok check before .json() | `const tokenRes = await fetch('https://login.salesforce.com/services/oauth2/token` |
| HIGH | `backend/routes/crm.js` | 1765 | fetch() without res.ok check before .json() | `const tokenRes = await fetch('https://login.salesforce.com/services/oauth2/token` |
| MEDIUM | `backend/routes/documents.js` | 141 | Empty catch block (swallowed error) | `try { fs.unlinkSync(file.path); } catch {}` |
| MEDIUM | `backend/routes/documents.js` | 244 | Empty catch block (swallowed error) | `try { fs.unlinkSync(tempPath); } catch {}` |
| HIGH | `backend/routes/export.js` | 199 | JSON.parse without try/catch | `? JSON.parse(o.score_breakdown \|\| '{}')` |
| MEDIUM | `backend/routes/extension.js` | 62 | Empty catch block (swallowed error) | `} catch { /* optional */ }` |
| HIGH | `backend/routes/extension.js` | 102 | JSON.parse without try/catch | `const data = (typeof opp.data === 'string' ? JSON.parse(opp.data) : opp.data) \|` |
| HIGH | `backend/routes/extension.js` | 143 | JSON.parse without try/catch | `const data = (typeof opp.data === 'string' ? JSON.parse(opp.data) : opp.data) \|` |
| HIGH | `backend/routes/informz.js` | 67 | JSON.parse without try/catch | `if (m) parsed = JSON.parse(m[0]);` |
| HIGH | `backend/routes/informz.js` | 210 | JSON.parse without try/catch | `if (m) parsed = JSON.parse(m[0]);` |
| MEDIUM | `backend/routes/nurture.js` | 346 | Empty catch block (swallowed error) | `} catch { /* optional */ }` |
| MEDIUM | `backend/routes/nurture.js` | 359 | Empty catch block (swallowed error) | `if (m) { try { sampleEmail = JSON.parse(m[0]); } catch { /* malformed JSON */ } ` |
| MEDIUM | `backend/routes/nurture.js` | 361 | Empty catch block (swallowed error) | `} catch { /* skip preview generation */ }` |
| HIGH | `backend/routes/nurture.js` | 432 | fetch() without res.ok check before .json() | `const tokenRes = await fetch('https://oauth2.googleapis.com/token', {` |
| HIGH | `backend/routes/nurture.js` | 522 | fetch() without res.ok check before .json() | `const tokenRes = await fetch('https://login.microsoftonline.com/common/oauth2/v2` |
| HIGH | `backend/routes/settings.js` | 375 | JSON.parse without try/catch | `const currentMeta = typeof existing.metadata === 'string' ? JSON.parse(existing.` |
| HIGH | `backend/routes/signals.js` | 166 | JSON.parse without try/catch | `if (m) email = JSON.parse(m[0]);` |
| HIGH | `backend/routes/signals.js` | 351 | JSON.parse without try/catch | `if (m) sequence = JSON.parse(m[0]);` |
| HIGH | `backend/routes/stats.js` | 23 | fetch() without res.ok check before .json() | `const resp = await fetch(url, options);` |
| HIGH | `backend/routes/team-campaigns.js` | 136 | JSON.parse without try/catch | `if (m) sampleEmail = JSON.parse(m[0]);` |
| MEDIUM | `backend/routes/team-campaigns.js` | 202 | Empty catch block (swallowed error) | `if (m) { try { email = JSON.parse(m[0]); } catch { /* malformed AI response */ }` |
| HIGH | `backend/lib/ab-memory.js` | 187 | JSON.parse without try/catch | `const data = typeof top.data === 'string' ? JSON.parse(top.data) : (top.data \|\` |
| MEDIUM | `backend/lib/agent-chains.js` | 338 | Empty catch block (swallowed error) | `} catch { /* no product lines */ }` |
| MEDIUM | `backend/lib/agent-chains.js` | 360 | Empty catch block (swallowed error) | `} catch { /* ok */ }` |
| MEDIUM | `backend/lib/agents/signal-agent.js` | 125 | Empty catch block (swallowed error) | `} catch { /* enrichment is optional */ }` |
| MEDIUM | `backend/lib/agents/signal-agent.js` | 181 | Empty catch block (swallowed error) | `} catch { /* notifications are optional */ }` |
| MEDIUM | `backend/lib/agents/signal-agent.js` | 206 | Empty catch block (swallowed error) | `} catch { /* skip duplicates */ }` |
| MEDIUM | `backend/lib/agents/signal-agent.js` | 212 | Empty catch block (swallowed error) | `} catch { /* auto-prospecting is optional */ }` |
| HIGH | `backend/lib/agents/signal-agent.js` | 289 | fetch() without res.ok check before .json() | `const res = await fetch('https://api.apollo.io/v1/mixed_people/search', {` |
| MEDIUM | `backend/lib/agents/timing-agent.js` | 99 | new Date() on potentially null value without guard | `const replied = new Date(r.replied_at).getTime();` |
| MEDIUM | `backend/lib/agents/timing-agent.js` | 163 | new Date() on potentially null value without guard | `const sent = new Date(r.sent_at).getTime();` |
| MEDIUM | `backend/lib/agents/timing-agent.js` | 164 | new Date() on potentially null value without guard | `const resp = new Date(r.response_at).getTime();` |
| MEDIUM | `backend/lib/churn-scoring.js` | 85 | new Date() on potentially null value without guard | `const age = (now - new Date(e.created_at).getTime()) / DAY_MS;` |
| MEDIUM | `backend/lib/conversation-autopilot.js` | 190 | Empty catch block (swallowed error) | `try { return JSON.parse(match[0]); } catch { /* fallthrough */ }` |
| MEDIUM | `backend/lib/conversation-autopilot.js` | 319 | new Date() on potentially null value without guard | `return history.sort((a, b) => new Date(a.date) - new Date(b.date));` |
| MEDIUM | `backend/lib/crm-agent.js` | 62 | Empty catch block (swallowed error) | `} catch { /* solo user, no team */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 177 | Empty catch block (swallowed error) | `} catch { /* ok */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 205 | Empty catch block (swallowed error) | `} catch { /* notification is non-blocking */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 283 | Empty catch block (swallowed error) | `} catch { /* owner mapping is optional */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 350 | Empty catch block (swallowed error) | `} catch { /* mapping is optional */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 379 | Empty catch block (swallowed error) | `} catch { /* deal sync is optional */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 548 | Empty catch block (swallowed error) | `} catch { /* fallback to 50/50 */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 637 | Empty catch block (swallowed error) | `} catch { /* patterns optional */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 677 | Empty catch block (swallowed error) | `} catch { /* fallback to single */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 694 | Empty catch block (swallowed error) | `} catch { /* fallback below */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 772 | new Date() on potentially null value without guard | `.map(o => (new Date(o.updated_at).getTime() - new Date(o.created_at).getTime()) ` |
| MEDIUM | `backend/lib/crm-agent.js` | 794 | new Date() on potentially null value without guard | `.map(o => (new Date(o.updated_at).getTime() - new Date(o.created_at).getTime()) ` |
| MEDIUM | `backend/lib/crm-agent.js` | 864 | Empty catch block (swallowed error) | `} catch { /* optional */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 893 | Empty catch block (swallowed error) | `} catch { /* optional */ }` |
| MEDIUM | `backend/lib/crm-bidirectional-sync.js` | 84 | new Date() on potentially null value without guard | `const lastPush = opp.score_pushed_at ? new Date(opp.score_pushed_at).getTime() :` |
| MEDIUM | `backend/lib/crm-bidirectional-sync.js` | 93 | Empty catch block (swallowed error) | `} catch { /* ignore individual push errors */ }` |
| HIGH | `backend/lib/crm-export.js` | 23 | fetch() without res.ok check before .json() | `const res = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {` |
| HIGH | `backend/lib/crm-export.js` | 51 | fetch() without res.ok check before .json() | `const res = await fetch(`${instanceUrl}/services/data/v62.0/sobjects/Contact`, {` |
| HIGH | `backend/lib/crm-export.js` | 76 | fetch() without res.ok check before .json() | `const res = await fetch(`https://api.pipedrive.com/v1/persons?api_token=${apiKey` |
| HIGH | `backend/lib/crm-export.js` | 90 | fetch() without res.ok check before .json() | `await fetch(`https://api.pipedrive.com/v1/notes?api_token=${apiKey}`, {` |
| MEDIUM | `backend/lib/crm-owner-resolver.js` | 32 | Empty catch block (swallowed error) | `} catch { /* no team = solo user */ }` |
| MEDIUM | `backend/lib/deliverability-agent.js` | 200 | Empty catch block (swallowed error) | `} catch { /* notification is best-effort */ }` |
| HIGH | `backend/lib/email-outbound.js` | 117 | fetch() without res.ok check before .json() | `const res = await fetch(tokenUrl, {` |
| HIGH | `backend/lib/email.js` | 16 | fetch() without res.ok check before .json() | `const res = await fetch('https://api.resend.com/emails', {` |
| MEDIUM | `backend/lib/enrich-agent.js` | 210 | Empty catch block (swallowed error) | `} catch { /* Brave search failed */ }` |
| HIGH | `backend/lib/enrich-agent.js` | 241 | JSON.parse without try/catch | `return JSON.parse(match[0]);` |
| MEDIUM | `backend/lib/enrich-agent.js` | 336 | Empty catch block (swallowed error) | `} catch { /* verification failed, keep the email */ }` |
| MEDIUM | `backend/lib/enrich-agent.js` | 375 | Empty catch block (swallowed error) | `} catch { /* continue */ }` |
| HIGH | `backend/lib/enrich-agent.js` | 411 | JSON.parse without try/catch | `const parsed = JSON.parse(match[0]);` |
| HIGH | `backend/lib/icp-agent.js` | 170 | JSON.parse without try/catch | `const data = typeof userIcp.data === 'string' ? JSON.parse(userIcp.data) : userI` |
| HIGH | `backend/lib/lifecycle-emails.js` | 188 | JSON.parse without try/catch | `const userData = (typeof user.data === 'string' ? JSON.parse(user.data) : user.d` |
| MEDIUM | `backend/lib/lifecycle-emails.js` | 190 | new Date() on potentially null value without guard | `const daysSinceSignup = Math.floor((Date.now() - new Date(user.created_at).getTi` |
| HIGH | `backend/lib/lifecycle-emails.js` | 240 | JSON.parse without try/catch | `const userData = (typeof user.data === 'string' ? JSON.parse(user.data) : user.d` |
| MEDIUM | `backend/lib/nurture-engine.js` | 78 | new Date() on potentially null value without guard | `const dealAge = (Date.now() - new Date(deal.createdAt).getTime()) / DAY_MS;` |
| MEDIUM | `backend/lib/nurture-engine.js` | 104 | new Date() on potentially null value without guard | `const lastUpdate = c.update_time ? new Date(c.update_time).getTime() : 0;` |
| MEDIUM | `backend/lib/nurture-engine.js` | 121 | new Date() on potentially null value without guard | `const renewalTime = new Date(o.renewal_date).getTime();` |
| MEDIUM | `backend/lib/nurture-engine.js` | 276 | Empty catch block (swallowed error) | `try { return JSON.parse(jsonMatch[0]); } catch { /* fall through */ }` |
| HIGH | `backend/lib/outreach-deploy.js` | 79 | fetch() without res.ok check before .json() | `const r = await fetch('https://api.apollo.io/v1/emailer_campaigns', {` |
| HIGH | `backend/lib/outreach-deploy.js` | 124 | fetch() without res.ok check before .json() | `const r = await fetch(`https://api.instantly.ai/api/v1/campaign/step/add?api_key` |
| MEDIUM | `backend/lib/reporting-agent.js` | 143 | Empty catch block (swallowed error) | `} catch { /* ignore notification errors */ }` |
| MEDIUM | `backend/lib/response-analysis-agent.js` | 58 | new Date() on potentially null value without guard | `const sentAt = new Date(email.sent_at).getTime();` |
| MEDIUM | `backend/lib/response-analysis-agent.js` | 60 | new Date() on potentially null value without guard | `const actDate = a.dueDate ? new Date(a.dueDate).getTime() : 0;` |
| HIGH | `backend/lib/response-analysis-agent.js` | 272 | JSON.parse without try/catch | `if (match) return JSON.parse(match[0]);` |
| MEDIUM | `backend/lib/response-analysis-agent.js` | 273 | Empty catch block (swallowed error) | `} catch { /* fallback below */ }` |
| HIGH | `backend/lib/template-agent.js` | 169 | JSON.parse without try/catch | `if (match) template = JSON.parse(match[0]);` |
| HIGH | `backend/lib/vector-store.js` | 190 | fetch() without res.ok check before .json() | `const res = await fetch('https://api.voyageai.com/v1/embeddings', {` |
| HIGH | `backend/lib/web-prospect-agent.js` | 169 | JSON.parse without try/catch | `const parsed = JSON.parse(jsonMatch[0]);` |
| HIGH | `backend/api/airtable-crm.js` | 18 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/apollo.js` | 24 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/brave-search.js` | 30 | fetch() without res.ok check before .json() | `const res = await fetch(`${BASE_URL}?${params}`, {` |
| HIGH | `backend/api/folk.js` | 15 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/hubspot.js` | 15 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/informz.js` | 73 | fetch() without res.ok check before .json() | `const res = await fetch(endpoint, {` |
| HIGH | `backend/api/instantly.js` | 28 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/lagrowthmachine.js` | 25 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/lemlist.js` | 15 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| MEDIUM | `backend/api/lemlist.js` | 647 | Empty catch block (swallowed error) | `} catch { /* logger optional */ }` |
| MEDIUM | `backend/api/lemlist.js` | 687 | Empty catch block (swallowed error) | `} catch { /* logger optional */ }` |
| HIGH | `backend/api/lemlist.js` | 749 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/linkedin.js` | 56 | fetch() without res.ok check before .json() | `const res = await fetch(`${VOYAGER_BASE}${endpoint}`, {` |
| HIGH | `backend/api/odoo.js` | 20 | fetch() without res.ok check before .json() | `const res = await fetch(`${url}/jsonrpc`, {` |
| HIGH | `backend/api/pipedrive.js` | 16 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/salesforce.js` | 13 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/waalaxy.js` | 25 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `frontend/src/components/AuthGate.jsx` | 214 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/forgot-password', {` |
| LOW | `frontend/src/components/FieldMappingSettings.jsx` | 47 | Hardcoded CRM provider list (may be incomplete) | `const crmProviders = ['pipedrive', 'hubspot', 'salesforce'];` |
| MEDIUM | `frontend/src/components/ICPInsightsCard.jsx` | 201 | new Date() on potentially null value without guard | `{new Date(data.analyzedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: ` |
| MEDIUM | `frontend/src/components/OnboardingChecklist.jsx` | 47 | Empty catch block (swallowed error) | `} catch { /* checklist won't show */ }` |
| MEDIUM | `frontend/src/components/TeamSettings.jsx` | 53 | Native alert()/prompt() in frontend | `alert(err.message);` |
| MEDIUM | `frontend/src/components/TeamSettings.jsx` | 74 | Native alert()/prompt() in frontend | `alert(err.message);` |
| MEDIUM | `frontend/src/components/TeamSettings.jsx` | 84 | Native alert()/prompt() in frontend | `alert(err.message);` |
| MEDIUM | `frontend/src/components/TeamSettings.jsx` | 93 | Native alert()/prompt() in frontend | `alert(err.message);` |
| HIGH | `frontend/src/components/VariableManager.jsx` | 378 | JSON.parse without try/catch | `initialRegistry ? JSON.parse(JSON.stringify(initialRegistry)) : JSON.parse(JSON.` |
| MEDIUM | `frontend/src/components/campaigns/CampaignDetailLayout.jsx` | 94 | Native alert()/prompt() in frontend | `window.alert(t('campaigns.archiveFailed', { error: err.message \|\| 'erreur inco` |
| MEDIUM | `frontend/src/components/campaigns/tabs/RepliesTab.jsx` | 125 | new Date() on potentially null value without guard | `const happenedAt = a.happened_at ? new Date(a.happened_at) : null;` |
| MEDIUM | `frontend/src/components/editor/__tests__/editor-helpers.test.js` | 14 | Native alert()/prompt() in frontend | `expect(escapeHtml('<script>alert("xss")</script>')).toBe(` |
| MEDIUM | `frontend/src/components/editor/__tests__/editor-helpers.test.js` | 15 | Native alert()/prompt() in frontend | `'&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'` |
| MEDIUM | `frontend/src/pages/CampaignsList.jsx` | 114 | Native alert()/prompt() in frontend | `window.alert(t('campaigns.errorPrefix', { message: err.message }));` |
| MEDIUM | `frontend/src/pages/CampaignsList.jsx` | 132 | Native alert()/prompt() in frontend | `window.alert(t('campaigns.errorPrefix', { message: err.message }));` |
| MEDIUM | `frontend/src/pages/CampaignsList.jsx` | 517 | new Date() on potentially null value without guard | `{en ? 'Sends at:' : 'Envoi à :'} {new Date(q.scheduled_at).toLocaleString(en ? '` |
| MEDIUM | `frontend/src/pages/CampaignsList.jsx` | 551 | new Date() on potentially null value without guard | `{en ? 'Sent:' : 'Envoyé :'} {new Date(q.sent_at).toLocaleString(en ? 'en-US' : '` |
| HIGH | `frontend/src/pages/ChatPage.jsx` | 1975 | JSON.parse without try/catch | `metadata: m.metadata ? (typeof m.metadata === 'string' ? JSON.parse(m.metadata) ` |
| MEDIUM | `frontend/src/pages/ClientsPage.jsx` | 582 | Native alert()/prompt() in frontend | `const subject = prompt('Objet de l\'email :');` |
| MEDIUM | `frontend/src/pages/ClientsPage.jsx` | 584 | Native alert()/prompt() in frontend | `const body = prompt('Message :');` |
| HIGH | `frontend/src/pages/CopyEditorPage.jsx` | 805 | JSON.parse without try/catch | `const copy = { ...JSON.parse(JSON.stringify(original)), id: tpId + '-copy', labe` |
| MEDIUM | `frontend/src/pages/MembershipPage.jsx` | 136 | new Date() on potentially null value without guard | `<div style={{ fontWeight: 600 }}>{new Date(r.renewal_date).toLocaleDateString(en` |
| MEDIUM | `frontend/src/pages/MemoryExplorerPage.jsx` | 392 | new Date() on potentially null value without guard | `<span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>{e.sen` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 103 | Native alert()/prompt() in frontend | `alert((lang === 'en' ? 'Error: ' : 'Erreur: ') + err.message);` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 166 | Native alert()/prompt() in frontend | `alert((lang === 'en' ? 'Error: ' : 'Erreur: ') + err.message);` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 285 | Native alert()/prompt() in frontend | `alert((lang === 'en' ? 'Error: ' : 'Erreur: ') + err.message);` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 416 | new Date() on potentially null value without guard | `{trigger.last_run && ` \u00B7 ${lang === 'en' ? 'Last run:' : 'Dernier run :'} $` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 473 | Native alert()/prompt() in frontend | `alert((en ? 'Error: ' : 'Erreur: ') + err.message);` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 525 | new Date() on potentially null value without guard | `{email.sent_at && ` \u00B7 ${en ? 'Sent on' : 'Envoy\u00E9 le'} ${new Date(email` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 766 | new Date() on potentially null value without guard | `{e.sent_at ? new Date(e.sent_at).toLocaleDateString(en ? 'en-US' : 'fr-FR', { da` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 1015 | new Date() on potentially null value without guard | `{en ? 'by' : 'par'} {c.created_by_name} {'\u00B7'} {new Date(c.created_at).toLoc` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 1207 | new Date() on potentially null value without guard | `{en ? 'Scheduled:' : 'Planifié :'} {new Date(q.scheduled_at).toLocaleString(lang` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 1243 | new Date() on potentially null value without guard | `{en ? 'Sent:' : 'Envoyé :'} {new Date(q.sent_at).toLocaleString(lang === 'en' ? ` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 1310 | new Date() on potentially null value without guard | `{test.startedAt ? new Date(test.startedAt).toLocaleDateString(en ? 'en-US' : 'fr` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 1501 | new Date() on potentially null value without guard | `{e.to} &middot; {new Date(e.createdAt).toLocaleDateString(en ? 'en-US' : 'fr-FR'` |
| HIGH | `frontend/src/pages/ProfilePage.jsx` | 127 | fetch() without res.ok check before .json() | `const res = await fetch('/api/profile', {` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 256 | Native alert()/prompt() in frontend | `alert((en ? 'Reparse failed for all docs:\n\n' : 'Reparse a échoué pour tous les` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 260 | Native alert()/prompt() in frontend | `alert((en ? 'Error: ' : 'Erreur: ') + err.message);` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 263 | Native alert()/prompt() in frontend | `alert('Auto-fill: ' + err.message);` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 469 | new Date() on potentially null value without guard | `{new Date(doc.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: '` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 476 | Empty catch block (swallowed error) | `} catch {}` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 746 | new Date() on potentially null value without guard | `<span style={{ color: 'var(--text-muted)', fontSize: 10 }}>{new Date(doc.created` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 747 | Empty catch block (swallowed error) | `<button onClick={async () => { try { await request('/documents/' + doc.id, { met` |
| MEDIUM | `frontend/src/pages/RecosPage.jsx` | 67 | new Date() on potentially null value without guard | `date: d.created_at ? new Date(d.created_at).toLocaleDateString('fr-FR', { day: '` |
| HIGH | `frontend/src/pages/ResetPasswordPage.jsx` | 129 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/reset-password', {` |
| HIGH | `frontend/src/pages/SettingsPage.jsx` | 136 | JSON.parse without try/catch | `return saved ? { ...DEFAULT_PREFERENCES, ...JSON.parse(saved) } : { ...DEFAULT_P` |
| HIGH | `frontend/src/pages/SettingsPage.jsx` | 1007 | JSON.parse without try/catch | `const user = JSON.parse(localStorage.getItem('bakal_user') \|\| '{}');` |
| MEDIUM | `frontend/src/pages/SignalsPage.jsx` | 308 | new Date() on potentially null value without guard | `<span>{new Date(s.detected_at).toLocaleDateString(en ? 'en-US' : 'fr-FR', { day:` |
| MEDIUM | `frontend/src/pages/SignalsPage.jsx` | 452 | new Date() on potentially null value without guard | `{new Date(s.detected_at).toLocaleDateString(en ? 'en-US' : 'fr-FR', { day: 'nume` |
| MEDIUM | `frontend/src/pages/SignalsPage.jsx` | 585 | new Date() on potentially null value without guard | `{c.last_run && <span>{en ? 'Last scan' : 'Dernier scan'}: {new Date(c.last_run).` |
| HIGH | `frontend/src/services/api-client.js` | 23 | fetch() without res.ok check before .json() | `let res = await fetch(url, { headers, ...opts });` |
| HIGH | `frontend/src/services/api-client.js` | 31 | fetch() without res.ok check before .json() | `res = await fetch(url, { headers, ...opts });` |
| HIGH | `frontend/src/services/api-client.js` | 110 | JSON.parse without try/catch | `? (typeof c.ab_config === 'string' ? JSON.parse(c.ab_config) : c.ab_config)` |
| MEDIUM | `frontend/src/services/api-client.js` | 115 | new Date() on potentially null value without guard | `createdDate: c.created_at ? new Date(c.created_at).toLocaleDateString('fr-FR', {` |
| HIGH | `frontend/src/services/api-client.js` | 716 | fetch() without res.ok check before .json() | `const res = await fetch(url, { method: 'POST', headers, body: formData });` |
| HIGH | `frontend/src/services/auth.js` | 53 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/login', {` |
| HIGH | `frontend/src/services/auth.js` | 77 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/register', {` |
| HIGH | `frontend/src/services/auth.js` | 95 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/resend-verification', {` |
| HIGH | `frontend/src/services/auth.js` | 116 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/refresh', {` |
| HIGH | `frontend/src/services/auth.js` | 144 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/account', {` |
| HIGH | `frontend/src/services/auth.js` | 161 | fetch() without res.ok check before .json() | `await fetch('/api/auth/logout', {` |

### Automated Audit — 2026-06-22

Found 187 potential issue(s):

| Severity | File | Line | Pattern | Code |
|----------|------|------|---------|------|
| HIGH | `backend/routes/ai.js` | 438 | JSON.parse without try/catch | `const data = typeof pattern.data === 'string' ? JSON.parse(pattern.data) : (patt` |
| MEDIUM | `backend/routes/ai.js` | 439 | new Date() on potentially null value without guard | `const age = Math.round((Date.now() - new Date(pattern.date_discovered).getTime()` |
| MEDIUM | `backend/routes/ai.js` | 525 | Empty catch block (swallowed error) | `} catch { /* solo user */ }` |
| MEDIUM | `backend/routes/ai.js` | 703 | Empty catch block (swallowed error) | `try { campaignMap[cid] = await db.campaigns.get(cid); } catch {}` |
| HIGH | `backend/routes/ai.js` | 861 | JSON.parse without try/catch | `const config = typeof campaign.ab_config === 'string' ? JSON.parse(campaign.ab_c` |
| MEDIUM | `backend/routes/analytics.js` | 102 | new Date() on potentially null value without guard | `const updatedAt = opp.updated_at ? new Date(opp.updated_at).getTime() : now;` |
| MEDIUM | `backend/routes/analytics.js` | 103 | new Date() on potentially null value without guard | `const createdAt = opp.created_at ? new Date(opp.created_at).getTime() : now;` |
| MEDIUM | `backend/routes/analytics.js` | 578 | new Date() on potentially null value without guard | `const create = new Date(o.created_at).getTime();` |
| MEDIUM | `backend/routes/analytics.js` | 651 | new Date() on potentially null value without guard | `const updatedAt = opp.updated_at ? new Date(opp.updated_at).getTime() : now;` |
| MEDIUM | `backend/routes/analytics.js` | 742 | new Date() on potentially null value without guard | `const stale = activeOpps.filter(o => { const u = o.updated_at ? new Date(o.updat` |
| MEDIUM | `backend/routes/auth.js` | 270 | Empty catch block (swallowed error) | `} catch { /* no team */ }` |
| MEDIUM | `backend/routes/auth.js` | 497 | Empty catch block (swallowed error) | `} catch { /* no team — ok */ }` |
| MEDIUM | `backend/routes/campaigns.js` | 237 | new Date() on potentially null value without guard | `const lastOpt = campaign.last_optimized_at ? new Date(campaign.last_optimized_at` |
| MEDIUM | `backend/routes/chat.js` | 251 | Empty catch block (swallowed error) | `} catch { /* default to fr */ }` |
| MEDIUM | `backend/routes/chat.js` | 324 | new Date() on potentially null value without guard | `new Date(c.created_at).getTime() > sixtyAgo` |
| LOW | `backend/routes/chat.js` | 450 | Hardcoded CRM provider list (may be incomplete) | `const providers = ['pipedrive', 'hubspot', 'salesforce', 'odoo'];` |
| HIGH | `backend/routes/crm.js` | 318 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| HIGH | `backend/routes/crm.js` | 351 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| HIGH | `backend/routes/crm.js` | 367 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| HIGH | `backend/routes/crm.js` | 715 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| HIGH | `backend/routes/crm.js` | 744 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| LOW | `backend/routes/crm.js` | 1036 | Hardcoded CRM provider list (may be incomplete) | `for (const provider of ['pipedrive', 'salesforce', 'hubspot']) {` |
| MEDIUM | `backend/routes/crm.js` | 1047 | Empty catch block (swallowed error) | `} catch { /* scoring works without deals */ }` |
| HIGH | `backend/routes/crm.js` | 1356 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| HIGH | `backend/routes/crm.js` | 1370 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| MEDIUM | `backend/routes/crm.js` | 1400 | Empty catch block (swallowed error) | `} catch { /* skip individual failures */ }` |
| HIGH | `backend/routes/crm.js` | 1569 | fetch() without res.ok check before .json() | `const tokenRes = await fetch('https://login.salesforce.com/services/oauth2/token` |
| HIGH | `backend/routes/crm.js` | 1714 | fetch() without res.ok check before .json() | `const tokenRes = await fetch('https://login.salesforce.com/services/oauth2/token` |
| HIGH | `backend/routes/crm.js` | 1765 | fetch() without res.ok check before .json() | `const tokenRes = await fetch('https://login.salesforce.com/services/oauth2/token` |
| MEDIUM | `backend/routes/documents.js` | 141 | Empty catch block (swallowed error) | `try { fs.unlinkSync(file.path); } catch {}` |
| MEDIUM | `backend/routes/documents.js` | 244 | Empty catch block (swallowed error) | `try { fs.unlinkSync(tempPath); } catch {}` |
| HIGH | `backend/routes/export.js` | 199 | JSON.parse without try/catch | `? JSON.parse(o.score_breakdown \|\| '{}')` |
| MEDIUM | `backend/routes/extension.js` | 62 | Empty catch block (swallowed error) | `} catch { /* optional */ }` |
| HIGH | `backend/routes/extension.js` | 102 | JSON.parse without try/catch | `const data = (typeof opp.data === 'string' ? JSON.parse(opp.data) : opp.data) \|` |
| HIGH | `backend/routes/extension.js` | 143 | JSON.parse without try/catch | `const data = (typeof opp.data === 'string' ? JSON.parse(opp.data) : opp.data) \|` |
| HIGH | `backend/routes/informz.js` | 67 | JSON.parse without try/catch | `if (m) parsed = JSON.parse(m[0]);` |
| HIGH | `backend/routes/informz.js` | 210 | JSON.parse without try/catch | `if (m) parsed = JSON.parse(m[0]);` |
| MEDIUM | `backend/routes/nurture.js` | 346 | Empty catch block (swallowed error) | `} catch { /* optional */ }` |
| MEDIUM | `backend/routes/nurture.js` | 359 | Empty catch block (swallowed error) | `if (m) { try { sampleEmail = JSON.parse(m[0]); } catch { /* malformed JSON */ } ` |
| MEDIUM | `backend/routes/nurture.js` | 361 | Empty catch block (swallowed error) | `} catch { /* skip preview generation */ }` |
| HIGH | `backend/routes/nurture.js` | 432 | fetch() without res.ok check before .json() | `const tokenRes = await fetch('https://oauth2.googleapis.com/token', {` |
| HIGH | `backend/routes/nurture.js` | 522 | fetch() without res.ok check before .json() | `const tokenRes = await fetch('https://login.microsoftonline.com/common/oauth2/v2` |
| HIGH | `backend/routes/settings.js` | 375 | JSON.parse without try/catch | `const currentMeta = typeof existing.metadata === 'string' ? JSON.parse(existing.` |
| HIGH | `backend/routes/signals.js` | 166 | JSON.parse without try/catch | `if (m) email = JSON.parse(m[0]);` |
| HIGH | `backend/routes/signals.js` | 351 | JSON.parse without try/catch | `if (m) sequence = JSON.parse(m[0]);` |
| HIGH | `backend/routes/stats.js` | 23 | fetch() without res.ok check before .json() | `const resp = await fetch(url, options);` |
| HIGH | `backend/routes/team-campaigns.js` | 136 | JSON.parse without try/catch | `if (m) sampleEmail = JSON.parse(m[0]);` |
| MEDIUM | `backend/routes/team-campaigns.js` | 202 | Empty catch block (swallowed error) | `if (m) { try { email = JSON.parse(m[0]); } catch { /* malformed AI response */ }` |
| HIGH | `backend/lib/ab-memory.js` | 187 | JSON.parse without try/catch | `const data = typeof top.data === 'string' ? JSON.parse(top.data) : (top.data \|\` |
| MEDIUM | `backend/lib/agent-chains.js` | 338 | Empty catch block (swallowed error) | `} catch { /* no product lines */ }` |
| MEDIUM | `backend/lib/agent-chains.js` | 360 | Empty catch block (swallowed error) | `} catch { /* ok */ }` |
| MEDIUM | `backend/lib/agents/signal-agent.js` | 125 | Empty catch block (swallowed error) | `} catch { /* enrichment is optional */ }` |
| MEDIUM | `backend/lib/agents/signal-agent.js` | 181 | Empty catch block (swallowed error) | `} catch { /* notifications are optional */ }` |
| MEDIUM | `backend/lib/agents/signal-agent.js` | 206 | Empty catch block (swallowed error) | `} catch { /* skip duplicates */ }` |
| MEDIUM | `backend/lib/agents/signal-agent.js` | 212 | Empty catch block (swallowed error) | `} catch { /* auto-prospecting is optional */ }` |
| HIGH | `backend/lib/agents/signal-agent.js` | 289 | fetch() without res.ok check before .json() | `const res = await fetch('https://api.apollo.io/v1/mixed_people/search', {` |
| MEDIUM | `backend/lib/agents/timing-agent.js` | 99 | new Date() on potentially null value without guard | `const replied = new Date(r.replied_at).getTime();` |
| MEDIUM | `backend/lib/agents/timing-agent.js` | 163 | new Date() on potentially null value without guard | `const sent = new Date(r.sent_at).getTime();` |
| MEDIUM | `backend/lib/agents/timing-agent.js` | 164 | new Date() on potentially null value without guard | `const resp = new Date(r.response_at).getTime();` |
| MEDIUM | `backend/lib/churn-scoring.js` | 85 | new Date() on potentially null value without guard | `const age = (now - new Date(e.created_at).getTime()) / DAY_MS;` |
| MEDIUM | `backend/lib/conversation-autopilot.js` | 190 | Empty catch block (swallowed error) | `try { return JSON.parse(match[0]); } catch { /* fallthrough */ }` |
| MEDIUM | `backend/lib/conversation-autopilot.js` | 319 | new Date() on potentially null value without guard | `return history.sort((a, b) => new Date(a.date) - new Date(b.date));` |
| MEDIUM | `backend/lib/crm-agent.js` | 62 | Empty catch block (swallowed error) | `} catch { /* solo user, no team */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 177 | Empty catch block (swallowed error) | `} catch { /* ok */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 205 | Empty catch block (swallowed error) | `} catch { /* notification is non-blocking */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 283 | Empty catch block (swallowed error) | `} catch { /* owner mapping is optional */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 350 | Empty catch block (swallowed error) | `} catch { /* mapping is optional */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 379 | Empty catch block (swallowed error) | `} catch { /* deal sync is optional */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 548 | Empty catch block (swallowed error) | `} catch { /* fallback to 50/50 */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 637 | Empty catch block (swallowed error) | `} catch { /* patterns optional */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 677 | Empty catch block (swallowed error) | `} catch { /* fallback to single */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 694 | Empty catch block (swallowed error) | `} catch { /* fallback below */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 772 | new Date() on potentially null value without guard | `.map(o => (new Date(o.updated_at).getTime() - new Date(o.created_at).getTime()) ` |
| MEDIUM | `backend/lib/crm-agent.js` | 794 | new Date() on potentially null value without guard | `.map(o => (new Date(o.updated_at).getTime() - new Date(o.created_at).getTime()) ` |
| MEDIUM | `backend/lib/crm-agent.js` | 864 | Empty catch block (swallowed error) | `} catch { /* optional */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 893 | Empty catch block (swallowed error) | `} catch { /* optional */ }` |
| MEDIUM | `backend/lib/crm-bidirectional-sync.js` | 84 | new Date() on potentially null value without guard | `const lastPush = opp.score_pushed_at ? new Date(opp.score_pushed_at).getTime() :` |
| MEDIUM | `backend/lib/crm-bidirectional-sync.js` | 93 | Empty catch block (swallowed error) | `} catch { /* ignore individual push errors */ }` |
| HIGH | `backend/lib/crm-export.js` | 23 | fetch() without res.ok check before .json() | `const res = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {` |
| HIGH | `backend/lib/crm-export.js` | 51 | fetch() without res.ok check before .json() | `const res = await fetch(`${instanceUrl}/services/data/v62.0/sobjects/Contact`, {` |
| HIGH | `backend/lib/crm-export.js` | 76 | fetch() without res.ok check before .json() | `const res = await fetch(`https://api.pipedrive.com/v1/persons?api_token=${apiKey` |
| HIGH | `backend/lib/crm-export.js` | 90 | fetch() without res.ok check before .json() | `await fetch(`https://api.pipedrive.com/v1/notes?api_token=${apiKey}`, {` |
| MEDIUM | `backend/lib/crm-owner-resolver.js` | 32 | Empty catch block (swallowed error) | `} catch { /* no team = solo user */ }` |
| MEDIUM | `backend/lib/deliverability-agent.js` | 200 | Empty catch block (swallowed error) | `} catch { /* notification is best-effort */ }` |
| HIGH | `backend/lib/email-outbound.js` | 117 | fetch() without res.ok check before .json() | `const res = await fetch(tokenUrl, {` |
| HIGH | `backend/lib/email.js` | 16 | fetch() without res.ok check before .json() | `const res = await fetch('https://api.resend.com/emails', {` |
| MEDIUM | `backend/lib/enrich-agent.js` | 210 | Empty catch block (swallowed error) | `} catch { /* Brave search failed */ }` |
| HIGH | `backend/lib/enrich-agent.js` | 241 | JSON.parse without try/catch | `return JSON.parse(match[0]);` |
| MEDIUM | `backend/lib/enrich-agent.js` | 336 | Empty catch block (swallowed error) | `} catch { /* verification failed, keep the email */ }` |
| MEDIUM | `backend/lib/enrich-agent.js` | 375 | Empty catch block (swallowed error) | `} catch { /* continue */ }` |
| HIGH | `backend/lib/enrich-agent.js` | 411 | JSON.parse without try/catch | `const parsed = JSON.parse(match[0]);` |
| HIGH | `backend/lib/icp-agent.js` | 170 | JSON.parse without try/catch | `const data = typeof userIcp.data === 'string' ? JSON.parse(userIcp.data) : userI` |
| HIGH | `backend/lib/lifecycle-emails.js` | 188 | JSON.parse without try/catch | `const userData = (typeof user.data === 'string' ? JSON.parse(user.data) : user.d` |
| MEDIUM | `backend/lib/lifecycle-emails.js` | 190 | new Date() on potentially null value without guard | `const daysSinceSignup = Math.floor((Date.now() - new Date(user.created_at).getTi` |
| HIGH | `backend/lib/lifecycle-emails.js` | 240 | JSON.parse without try/catch | `const userData = (typeof user.data === 'string' ? JSON.parse(user.data) : user.d` |
| MEDIUM | `backend/lib/nurture-engine.js` | 78 | new Date() on potentially null value without guard | `const dealAge = (Date.now() - new Date(deal.createdAt).getTime()) / DAY_MS;` |
| MEDIUM | `backend/lib/nurture-engine.js` | 104 | new Date() on potentially null value without guard | `const lastUpdate = c.update_time ? new Date(c.update_time).getTime() : 0;` |
| MEDIUM | `backend/lib/nurture-engine.js` | 121 | new Date() on potentially null value without guard | `const renewalTime = new Date(o.renewal_date).getTime();` |
| MEDIUM | `backend/lib/nurture-engine.js` | 276 | Empty catch block (swallowed error) | `try { return JSON.parse(jsonMatch[0]); } catch { /* fall through */ }` |
| HIGH | `backend/lib/outreach-deploy.js` | 79 | fetch() without res.ok check before .json() | `const r = await fetch('https://api.apollo.io/v1/emailer_campaigns', {` |
| HIGH | `backend/lib/outreach-deploy.js` | 124 | fetch() without res.ok check before .json() | `const r = await fetch(`https://api.instantly.ai/api/v1/campaign/step/add?api_key` |
| MEDIUM | `backend/lib/reporting-agent.js` | 143 | Empty catch block (swallowed error) | `} catch { /* ignore notification errors */ }` |
| MEDIUM | `backend/lib/response-analysis-agent.js` | 58 | new Date() on potentially null value without guard | `const sentAt = new Date(email.sent_at).getTime();` |
| MEDIUM | `backend/lib/response-analysis-agent.js` | 60 | new Date() on potentially null value without guard | `const actDate = a.dueDate ? new Date(a.dueDate).getTime() : 0;` |
| HIGH | `backend/lib/response-analysis-agent.js` | 272 | JSON.parse without try/catch | `if (match) return JSON.parse(match[0]);` |
| MEDIUM | `backend/lib/response-analysis-agent.js` | 273 | Empty catch block (swallowed error) | `} catch { /* fallback below */ }` |
| HIGH | `backend/lib/template-agent.js` | 169 | JSON.parse without try/catch | `if (match) template = JSON.parse(match[0]);` |
| HIGH | `backend/lib/vector-store.js` | 190 | fetch() without res.ok check before .json() | `const res = await fetch('https://api.voyageai.com/v1/embeddings', {` |
| HIGH | `backend/lib/web-prospect-agent.js` | 169 | JSON.parse without try/catch | `const parsed = JSON.parse(jsonMatch[0]);` |
| HIGH | `backend/api/airtable-crm.js` | 18 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/apollo.js` | 24 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/brave-search.js` | 30 | fetch() without res.ok check before .json() | `const res = await fetch(`${BASE_URL}?${params}`, {` |
| HIGH | `backend/api/folk.js` | 15 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/hubspot.js` | 15 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/informz.js` | 73 | fetch() without res.ok check before .json() | `const res = await fetch(endpoint, {` |
| HIGH | `backend/api/instantly.js` | 28 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/lagrowthmachine.js` | 25 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/lemlist.js` | 15 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| MEDIUM | `backend/api/lemlist.js` | 647 | Empty catch block (swallowed error) | `} catch { /* logger optional */ }` |
| MEDIUM | `backend/api/lemlist.js` | 687 | Empty catch block (swallowed error) | `} catch { /* logger optional */ }` |
| HIGH | `backend/api/lemlist.js` | 749 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/linkedin.js` | 56 | fetch() without res.ok check before .json() | `const res = await fetch(`${VOYAGER_BASE}${endpoint}`, {` |
| HIGH | `backend/api/odoo.js` | 20 | fetch() without res.ok check before .json() | `const res = await fetch(`${url}/jsonrpc`, {` |
| HIGH | `backend/api/pipedrive.js` | 16 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/salesforce.js` | 13 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/waalaxy.js` | 25 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `frontend/src/components/AuthGate.jsx` | 214 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/forgot-password', {` |
| LOW | `frontend/src/components/FieldMappingSettings.jsx` | 47 | Hardcoded CRM provider list (may be incomplete) | `const crmProviders = ['pipedrive', 'hubspot', 'salesforce'];` |
| MEDIUM | `frontend/src/components/ICPInsightsCard.jsx` | 201 | new Date() on potentially null value without guard | `{new Date(data.analyzedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: ` |
| MEDIUM | `frontend/src/components/OnboardingChecklist.jsx` | 47 | Empty catch block (swallowed error) | `} catch { /* checklist won't show */ }` |
| MEDIUM | `frontend/src/components/TeamSettings.jsx` | 53 | Native alert()/prompt() in frontend | `alert(err.message);` |
| MEDIUM | `frontend/src/components/TeamSettings.jsx` | 74 | Native alert()/prompt() in frontend | `alert(err.message);` |
| MEDIUM | `frontend/src/components/TeamSettings.jsx` | 84 | Native alert()/prompt() in frontend | `alert(err.message);` |
| MEDIUM | `frontend/src/components/TeamSettings.jsx` | 93 | Native alert()/prompt() in frontend | `alert(err.message);` |
| HIGH | `frontend/src/components/VariableManager.jsx` | 378 | JSON.parse without try/catch | `initialRegistry ? JSON.parse(JSON.stringify(initialRegistry)) : JSON.parse(JSON.` |
| MEDIUM | `frontend/src/components/campaigns/CampaignDetailLayout.jsx` | 94 | Native alert()/prompt() in frontend | `window.alert(t('campaigns.archiveFailed', { error: err.message \|\| 'erreur inco` |
| MEDIUM | `frontend/src/components/campaigns/tabs/RepliesTab.jsx` | 125 | new Date() on potentially null value without guard | `const happenedAt = a.happened_at ? new Date(a.happened_at) : null;` |
| MEDIUM | `frontend/src/components/editor/__tests__/editor-helpers.test.js` | 14 | Native alert()/prompt() in frontend | `expect(escapeHtml('<script>alert("xss")</script>')).toBe(` |
| MEDIUM | `frontend/src/components/editor/__tests__/editor-helpers.test.js` | 15 | Native alert()/prompt() in frontend | `'&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'` |
| MEDIUM | `frontend/src/pages/CampaignsList.jsx` | 114 | Native alert()/prompt() in frontend | `window.alert(t('campaigns.errorPrefix', { message: err.message }));` |
| MEDIUM | `frontend/src/pages/CampaignsList.jsx` | 132 | Native alert()/prompt() in frontend | `window.alert(t('campaigns.errorPrefix', { message: err.message }));` |
| MEDIUM | `frontend/src/pages/CampaignsList.jsx` | 517 | new Date() on potentially null value without guard | `{en ? 'Sends at:' : 'Envoi à :'} {new Date(q.scheduled_at).toLocaleString(en ? '` |
| MEDIUM | `frontend/src/pages/CampaignsList.jsx` | 551 | new Date() on potentially null value without guard | `{en ? 'Sent:' : 'Envoyé :'} {new Date(q.sent_at).toLocaleString(en ? 'en-US' : '` |
| HIGH | `frontend/src/pages/ChatPage.jsx` | 1975 | JSON.parse without try/catch | `metadata: m.metadata ? (typeof m.metadata === 'string' ? JSON.parse(m.metadata) ` |
| MEDIUM | `frontend/src/pages/ClientsPage.jsx` | 582 | Native alert()/prompt() in frontend | `const subject = prompt('Objet de l\'email :');` |
| MEDIUM | `frontend/src/pages/ClientsPage.jsx` | 584 | Native alert()/prompt() in frontend | `const body = prompt('Message :');` |
| HIGH | `frontend/src/pages/CopyEditorPage.jsx` | 805 | JSON.parse without try/catch | `const copy = { ...JSON.parse(JSON.stringify(original)), id: tpId + '-copy', labe` |
| MEDIUM | `frontend/src/pages/MembershipPage.jsx` | 136 | new Date() on potentially null value without guard | `<div style={{ fontWeight: 600 }}>{new Date(r.renewal_date).toLocaleDateString(en` |
| MEDIUM | `frontend/src/pages/MemoryExplorerPage.jsx` | 392 | new Date() on potentially null value without guard | `<span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>{e.sen` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 103 | Native alert()/prompt() in frontend | `alert((lang === 'en' ? 'Error: ' : 'Erreur: ') + err.message);` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 166 | Native alert()/prompt() in frontend | `alert((lang === 'en' ? 'Error: ' : 'Erreur: ') + err.message);` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 285 | Native alert()/prompt() in frontend | `alert((lang === 'en' ? 'Error: ' : 'Erreur: ') + err.message);` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 416 | new Date() on potentially null value without guard | `{trigger.last_run && ` \u00B7 ${lang === 'en' ? 'Last run:' : 'Dernier run :'} $` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 473 | Native alert()/prompt() in frontend | `alert((en ? 'Error: ' : 'Erreur: ') + err.message);` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 525 | new Date() on potentially null value without guard | `{email.sent_at && ` \u00B7 ${en ? 'Sent on' : 'Envoy\u00E9 le'} ${new Date(email` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 766 | new Date() on potentially null value without guard | `{e.sent_at ? new Date(e.sent_at).toLocaleDateString(en ? 'en-US' : 'fr-FR', { da` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 1015 | new Date() on potentially null value without guard | `{en ? 'by' : 'par'} {c.created_by_name} {'\u00B7'} {new Date(c.created_at).toLoc` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 1207 | new Date() on potentially null value without guard | `{en ? 'Scheduled:' : 'Planifié :'} {new Date(q.scheduled_at).toLocaleString(lang` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 1243 | new Date() on potentially null value without guard | `{en ? 'Sent:' : 'Envoyé :'} {new Date(q.sent_at).toLocaleString(lang === 'en' ? ` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 1310 | new Date() on potentially null value without guard | `{test.startedAt ? new Date(test.startedAt).toLocaleDateString(en ? 'en-US' : 'fr` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 1501 | new Date() on potentially null value without guard | `{e.to} &middot; {new Date(e.createdAt).toLocaleDateString(en ? 'en-US' : 'fr-FR'` |
| HIGH | `frontend/src/pages/ProfilePage.jsx` | 127 | fetch() without res.ok check before .json() | `const res = await fetch('/api/profile', {` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 256 | Native alert()/prompt() in frontend | `alert((en ? 'Reparse failed for all docs:\n\n' : 'Reparse a échoué pour tous les` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 260 | Native alert()/prompt() in frontend | `alert((en ? 'Error: ' : 'Erreur: ') + err.message);` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 263 | Native alert()/prompt() in frontend | `alert('Auto-fill: ' + err.message);` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 469 | new Date() on potentially null value without guard | `{new Date(doc.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: '` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 476 | Empty catch block (swallowed error) | `} catch {}` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 746 | new Date() on potentially null value without guard | `<span style={{ color: 'var(--text-muted)', fontSize: 10 }}>{new Date(doc.created` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 747 | Empty catch block (swallowed error) | `<button onClick={async () => { try { await request('/documents/' + doc.id, { met` |
| MEDIUM | `frontend/src/pages/RecosPage.jsx` | 67 | new Date() on potentially null value without guard | `date: d.created_at ? new Date(d.created_at).toLocaleDateString('fr-FR', { day: '` |
| HIGH | `frontend/src/pages/ResetPasswordPage.jsx` | 129 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/reset-password', {` |
| HIGH | `frontend/src/pages/SettingsPage.jsx` | 136 | JSON.parse without try/catch | `return saved ? { ...DEFAULT_PREFERENCES, ...JSON.parse(saved) } : { ...DEFAULT_P` |
| HIGH | `frontend/src/pages/SettingsPage.jsx` | 1007 | JSON.parse without try/catch | `const user = JSON.parse(localStorage.getItem('bakal_user') \|\| '{}');` |
| MEDIUM | `frontend/src/pages/SignalsPage.jsx` | 308 | new Date() on potentially null value without guard | `<span>{new Date(s.detected_at).toLocaleDateString(en ? 'en-US' : 'fr-FR', { day:` |
| MEDIUM | `frontend/src/pages/SignalsPage.jsx` | 452 | new Date() on potentially null value without guard | `{new Date(s.detected_at).toLocaleDateString(en ? 'en-US' : 'fr-FR', { day: 'nume` |
| MEDIUM | `frontend/src/pages/SignalsPage.jsx` | 585 | new Date() on potentially null value without guard | `{c.last_run && <span>{en ? 'Last scan' : 'Dernier scan'}: {new Date(c.last_run).` |
| HIGH | `frontend/src/services/api-client.js` | 23 | fetch() without res.ok check before .json() | `let res = await fetch(url, { headers, ...opts });` |
| HIGH | `frontend/src/services/api-client.js` | 31 | fetch() without res.ok check before .json() | `res = await fetch(url, { headers, ...opts });` |
| HIGH | `frontend/src/services/api-client.js` | 110 | JSON.parse without try/catch | `? (typeof c.ab_config === 'string' ? JSON.parse(c.ab_config) : c.ab_config)` |
| MEDIUM | `frontend/src/services/api-client.js` | 115 | new Date() on potentially null value without guard | `createdDate: c.created_at ? new Date(c.created_at).toLocaleDateString('fr-FR', {` |
| HIGH | `frontend/src/services/api-client.js` | 716 | fetch() without res.ok check before .json() | `const res = await fetch(url, { method: 'POST', headers, body: formData });` |
| HIGH | `frontend/src/services/auth.js` | 53 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/login', {` |
| HIGH | `frontend/src/services/auth.js` | 77 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/register', {` |
| HIGH | `frontend/src/services/auth.js` | 95 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/resend-verification', {` |
| HIGH | `frontend/src/services/auth.js` | 116 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/refresh', {` |
| HIGH | `frontend/src/services/auth.js` | 144 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/account', {` |
| HIGH | `frontend/src/services/auth.js` | 161 | fetch() without res.ok check before .json() | `await fetch('/api/auth/logout', {` |

### Automated Audit — 2026-06-23

Found 187 potential issue(s):

| Severity | File | Line | Pattern | Code |
|----------|------|------|---------|------|
| HIGH | `backend/routes/ai.js` | 438 | JSON.parse without try/catch | `const data = typeof pattern.data === 'string' ? JSON.parse(pattern.data) : (patt` |
| MEDIUM | `backend/routes/ai.js` | 439 | new Date() on potentially null value without guard | `const age = Math.round((Date.now() - new Date(pattern.date_discovered).getTime()` |
| MEDIUM | `backend/routes/ai.js` | 525 | Empty catch block (swallowed error) | `} catch { /* solo user */ }` |
| MEDIUM | `backend/routes/ai.js` | 703 | Empty catch block (swallowed error) | `try { campaignMap[cid] = await db.campaigns.get(cid); } catch {}` |
| HIGH | `backend/routes/ai.js` | 861 | JSON.parse without try/catch | `const config = typeof campaign.ab_config === 'string' ? JSON.parse(campaign.ab_c` |
| MEDIUM | `backend/routes/analytics.js` | 102 | new Date() on potentially null value without guard | `const updatedAt = opp.updated_at ? new Date(opp.updated_at).getTime() : now;` |
| MEDIUM | `backend/routes/analytics.js` | 103 | new Date() on potentially null value without guard | `const createdAt = opp.created_at ? new Date(opp.created_at).getTime() : now;` |
| MEDIUM | `backend/routes/analytics.js` | 578 | new Date() on potentially null value without guard | `const create = new Date(o.created_at).getTime();` |
| MEDIUM | `backend/routes/analytics.js` | 651 | new Date() on potentially null value without guard | `const updatedAt = opp.updated_at ? new Date(opp.updated_at).getTime() : now;` |
| MEDIUM | `backend/routes/analytics.js` | 742 | new Date() on potentially null value without guard | `const stale = activeOpps.filter(o => { const u = o.updated_at ? new Date(o.updat` |
| MEDIUM | `backend/routes/auth.js` | 270 | Empty catch block (swallowed error) | `} catch { /* no team */ }` |
| MEDIUM | `backend/routes/auth.js` | 497 | Empty catch block (swallowed error) | `} catch { /* no team — ok */ }` |
| MEDIUM | `backend/routes/campaigns.js` | 237 | new Date() on potentially null value without guard | `const lastOpt = campaign.last_optimized_at ? new Date(campaign.last_optimized_at` |
| MEDIUM | `backend/routes/chat.js` | 251 | Empty catch block (swallowed error) | `} catch { /* default to fr */ }` |
| MEDIUM | `backend/routes/chat.js` | 324 | new Date() on potentially null value without guard | `new Date(c.created_at).getTime() > sixtyAgo` |
| LOW | `backend/routes/chat.js` | 450 | Hardcoded CRM provider list (may be incomplete) | `const providers = ['pipedrive', 'hubspot', 'salesforce', 'odoo'];` |
| HIGH | `backend/routes/crm.js` | 318 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| HIGH | `backend/routes/crm.js` | 351 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| HIGH | `backend/routes/crm.js` | 367 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| HIGH | `backend/routes/crm.js` | 715 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| HIGH | `backend/routes/crm.js` | 744 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| LOW | `backend/routes/crm.js` | 1036 | Hardcoded CRM provider list (may be incomplete) | `for (const provider of ['pipedrive', 'salesforce', 'hubspot']) {` |
| MEDIUM | `backend/routes/crm.js` | 1047 | Empty catch block (swallowed error) | `} catch { /* scoring works without deals */ }` |
| HIGH | `backend/routes/crm.js` | 1356 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| HIGH | `backend/routes/crm.js` | 1370 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| MEDIUM | `backend/routes/crm.js` | 1400 | Empty catch block (swallowed error) | `} catch { /* skip individual failures */ }` |
| HIGH | `backend/routes/crm.js` | 1569 | fetch() without res.ok check before .json() | `const tokenRes = await fetch('https://login.salesforce.com/services/oauth2/token` |
| HIGH | `backend/routes/crm.js` | 1714 | fetch() without res.ok check before .json() | `const tokenRes = await fetch('https://login.salesforce.com/services/oauth2/token` |
| HIGH | `backend/routes/crm.js` | 1765 | fetch() without res.ok check before .json() | `const tokenRes = await fetch('https://login.salesforce.com/services/oauth2/token` |
| MEDIUM | `backend/routes/documents.js` | 141 | Empty catch block (swallowed error) | `try { fs.unlinkSync(file.path); } catch {}` |
| MEDIUM | `backend/routes/documents.js` | 244 | Empty catch block (swallowed error) | `try { fs.unlinkSync(tempPath); } catch {}` |
| HIGH | `backend/routes/export.js` | 199 | JSON.parse without try/catch | `? JSON.parse(o.score_breakdown \|\| '{}')` |
| MEDIUM | `backend/routes/extension.js` | 62 | Empty catch block (swallowed error) | `} catch { /* optional */ }` |
| HIGH | `backend/routes/extension.js` | 102 | JSON.parse without try/catch | `const data = (typeof opp.data === 'string' ? JSON.parse(opp.data) : opp.data) \|` |
| HIGH | `backend/routes/extension.js` | 143 | JSON.parse without try/catch | `const data = (typeof opp.data === 'string' ? JSON.parse(opp.data) : opp.data) \|` |
| HIGH | `backend/routes/informz.js` | 67 | JSON.parse without try/catch | `if (m) parsed = JSON.parse(m[0]);` |
| HIGH | `backend/routes/informz.js` | 210 | JSON.parse without try/catch | `if (m) parsed = JSON.parse(m[0]);` |
| MEDIUM | `backend/routes/nurture.js` | 346 | Empty catch block (swallowed error) | `} catch { /* optional */ }` |
| MEDIUM | `backend/routes/nurture.js` | 359 | Empty catch block (swallowed error) | `if (m) { try { sampleEmail = JSON.parse(m[0]); } catch { /* malformed JSON */ } ` |
| MEDIUM | `backend/routes/nurture.js` | 361 | Empty catch block (swallowed error) | `} catch { /* skip preview generation */ }` |
| HIGH | `backend/routes/nurture.js` | 432 | fetch() without res.ok check before .json() | `const tokenRes = await fetch('https://oauth2.googleapis.com/token', {` |
| HIGH | `backend/routes/nurture.js` | 522 | fetch() without res.ok check before .json() | `const tokenRes = await fetch('https://login.microsoftonline.com/common/oauth2/v2` |
| HIGH | `backend/routes/settings.js` | 375 | JSON.parse without try/catch | `const currentMeta = typeof existing.metadata === 'string' ? JSON.parse(existing.` |
| HIGH | `backend/routes/signals.js` | 166 | JSON.parse without try/catch | `if (m) email = JSON.parse(m[0]);` |
| HIGH | `backend/routes/signals.js` | 351 | JSON.parse without try/catch | `if (m) sequence = JSON.parse(m[0]);` |
| HIGH | `backend/routes/stats.js` | 23 | fetch() without res.ok check before .json() | `const resp = await fetch(url, options);` |
| HIGH | `backend/routes/team-campaigns.js` | 136 | JSON.parse without try/catch | `if (m) sampleEmail = JSON.parse(m[0]);` |
| MEDIUM | `backend/routes/team-campaigns.js` | 202 | Empty catch block (swallowed error) | `if (m) { try { email = JSON.parse(m[0]); } catch { /* malformed AI response */ }` |
| HIGH | `backend/lib/ab-memory.js` | 187 | JSON.parse without try/catch | `const data = typeof top.data === 'string' ? JSON.parse(top.data) : (top.data \|\` |
| MEDIUM | `backend/lib/agent-chains.js` | 338 | Empty catch block (swallowed error) | `} catch { /* no product lines */ }` |
| MEDIUM | `backend/lib/agent-chains.js` | 360 | Empty catch block (swallowed error) | `} catch { /* ok */ }` |
| MEDIUM | `backend/lib/agents/signal-agent.js` | 125 | Empty catch block (swallowed error) | `} catch { /* enrichment is optional */ }` |
| MEDIUM | `backend/lib/agents/signal-agent.js` | 181 | Empty catch block (swallowed error) | `} catch { /* notifications are optional */ }` |
| MEDIUM | `backend/lib/agents/signal-agent.js` | 206 | Empty catch block (swallowed error) | `} catch { /* skip duplicates */ }` |
| MEDIUM | `backend/lib/agents/signal-agent.js` | 212 | Empty catch block (swallowed error) | `} catch { /* auto-prospecting is optional */ }` |
| HIGH | `backend/lib/agents/signal-agent.js` | 289 | fetch() without res.ok check before .json() | `const res = await fetch('https://api.apollo.io/v1/mixed_people/search', {` |
| MEDIUM | `backend/lib/agents/timing-agent.js` | 99 | new Date() on potentially null value without guard | `const replied = new Date(r.replied_at).getTime();` |
| MEDIUM | `backend/lib/agents/timing-agent.js` | 163 | new Date() on potentially null value without guard | `const sent = new Date(r.sent_at).getTime();` |
| MEDIUM | `backend/lib/agents/timing-agent.js` | 164 | new Date() on potentially null value without guard | `const resp = new Date(r.response_at).getTime();` |
| MEDIUM | `backend/lib/churn-scoring.js` | 85 | new Date() on potentially null value without guard | `const age = (now - new Date(e.created_at).getTime()) / DAY_MS;` |
| MEDIUM | `backend/lib/conversation-autopilot.js` | 190 | Empty catch block (swallowed error) | `try { return JSON.parse(match[0]); } catch { /* fallthrough */ }` |
| MEDIUM | `backend/lib/conversation-autopilot.js` | 319 | new Date() on potentially null value without guard | `return history.sort((a, b) => new Date(a.date) - new Date(b.date));` |
| MEDIUM | `backend/lib/crm-agent.js` | 62 | Empty catch block (swallowed error) | `} catch { /* solo user, no team */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 177 | Empty catch block (swallowed error) | `} catch { /* ok */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 205 | Empty catch block (swallowed error) | `} catch { /* notification is non-blocking */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 283 | Empty catch block (swallowed error) | `} catch { /* owner mapping is optional */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 350 | Empty catch block (swallowed error) | `} catch { /* mapping is optional */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 379 | Empty catch block (swallowed error) | `} catch { /* deal sync is optional */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 548 | Empty catch block (swallowed error) | `} catch { /* fallback to 50/50 */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 637 | Empty catch block (swallowed error) | `} catch { /* patterns optional */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 677 | Empty catch block (swallowed error) | `} catch { /* fallback to single */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 694 | Empty catch block (swallowed error) | `} catch { /* fallback below */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 772 | new Date() on potentially null value without guard | `.map(o => (new Date(o.updated_at).getTime() - new Date(o.created_at).getTime()) ` |
| MEDIUM | `backend/lib/crm-agent.js` | 794 | new Date() on potentially null value without guard | `.map(o => (new Date(o.updated_at).getTime() - new Date(o.created_at).getTime()) ` |
| MEDIUM | `backend/lib/crm-agent.js` | 864 | Empty catch block (swallowed error) | `} catch { /* optional */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 893 | Empty catch block (swallowed error) | `} catch { /* optional */ }` |
| MEDIUM | `backend/lib/crm-bidirectional-sync.js` | 84 | new Date() on potentially null value without guard | `const lastPush = opp.score_pushed_at ? new Date(opp.score_pushed_at).getTime() :` |
| MEDIUM | `backend/lib/crm-bidirectional-sync.js` | 93 | Empty catch block (swallowed error) | `} catch { /* ignore individual push errors */ }` |
| HIGH | `backend/lib/crm-export.js` | 23 | fetch() without res.ok check before .json() | `const res = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {` |
| HIGH | `backend/lib/crm-export.js` | 51 | fetch() without res.ok check before .json() | `const res = await fetch(`${instanceUrl}/services/data/v62.0/sobjects/Contact`, {` |
| HIGH | `backend/lib/crm-export.js` | 76 | fetch() without res.ok check before .json() | `const res = await fetch(`https://api.pipedrive.com/v1/persons?api_token=${apiKey` |
| HIGH | `backend/lib/crm-export.js` | 90 | fetch() without res.ok check before .json() | `await fetch(`https://api.pipedrive.com/v1/notes?api_token=${apiKey}`, {` |
| MEDIUM | `backend/lib/crm-owner-resolver.js` | 32 | Empty catch block (swallowed error) | `} catch { /* no team = solo user */ }` |
| MEDIUM | `backend/lib/deliverability-agent.js` | 200 | Empty catch block (swallowed error) | `} catch { /* notification is best-effort */ }` |
| HIGH | `backend/lib/email-outbound.js` | 117 | fetch() without res.ok check before .json() | `const res = await fetch(tokenUrl, {` |
| HIGH | `backend/lib/email.js` | 16 | fetch() without res.ok check before .json() | `const res = await fetch('https://api.resend.com/emails', {` |
| MEDIUM | `backend/lib/enrich-agent.js` | 210 | Empty catch block (swallowed error) | `} catch { /* Brave search failed */ }` |
| HIGH | `backend/lib/enrich-agent.js` | 241 | JSON.parse without try/catch | `return JSON.parse(match[0]);` |
| MEDIUM | `backend/lib/enrich-agent.js` | 336 | Empty catch block (swallowed error) | `} catch { /* verification failed, keep the email */ }` |
| MEDIUM | `backend/lib/enrich-agent.js` | 375 | Empty catch block (swallowed error) | `} catch { /* continue */ }` |
| HIGH | `backend/lib/enrich-agent.js` | 411 | JSON.parse without try/catch | `const parsed = JSON.parse(match[0]);` |
| HIGH | `backend/lib/icp-agent.js` | 170 | JSON.parse without try/catch | `const data = typeof userIcp.data === 'string' ? JSON.parse(userIcp.data) : userI` |
| HIGH | `backend/lib/lifecycle-emails.js` | 188 | JSON.parse without try/catch | `const userData = (typeof user.data === 'string' ? JSON.parse(user.data) : user.d` |
| MEDIUM | `backend/lib/lifecycle-emails.js` | 190 | new Date() on potentially null value without guard | `const daysSinceSignup = Math.floor((Date.now() - new Date(user.created_at).getTi` |
| HIGH | `backend/lib/lifecycle-emails.js` | 240 | JSON.parse without try/catch | `const userData = (typeof user.data === 'string' ? JSON.parse(user.data) : user.d` |
| MEDIUM | `backend/lib/nurture-engine.js` | 78 | new Date() on potentially null value without guard | `const dealAge = (Date.now() - new Date(deal.createdAt).getTime()) / DAY_MS;` |
| MEDIUM | `backend/lib/nurture-engine.js` | 104 | new Date() on potentially null value without guard | `const lastUpdate = c.update_time ? new Date(c.update_time).getTime() : 0;` |
| MEDIUM | `backend/lib/nurture-engine.js` | 121 | new Date() on potentially null value without guard | `const renewalTime = new Date(o.renewal_date).getTime();` |
| MEDIUM | `backend/lib/nurture-engine.js` | 276 | Empty catch block (swallowed error) | `try { return JSON.parse(jsonMatch[0]); } catch { /* fall through */ }` |
| HIGH | `backend/lib/outreach-deploy.js` | 79 | fetch() without res.ok check before .json() | `const r = await fetch('https://api.apollo.io/v1/emailer_campaigns', {` |
| HIGH | `backend/lib/outreach-deploy.js` | 124 | fetch() without res.ok check before .json() | `const r = await fetch(`https://api.instantly.ai/api/v1/campaign/step/add?api_key` |
| MEDIUM | `backend/lib/reporting-agent.js` | 143 | Empty catch block (swallowed error) | `} catch { /* ignore notification errors */ }` |
| MEDIUM | `backend/lib/response-analysis-agent.js` | 58 | new Date() on potentially null value without guard | `const sentAt = new Date(email.sent_at).getTime();` |
| MEDIUM | `backend/lib/response-analysis-agent.js` | 60 | new Date() on potentially null value without guard | `const actDate = a.dueDate ? new Date(a.dueDate).getTime() : 0;` |
| HIGH | `backend/lib/response-analysis-agent.js` | 272 | JSON.parse without try/catch | `if (match) return JSON.parse(match[0]);` |
| MEDIUM | `backend/lib/response-analysis-agent.js` | 273 | Empty catch block (swallowed error) | `} catch { /* fallback below */ }` |
| HIGH | `backend/lib/template-agent.js` | 169 | JSON.parse without try/catch | `if (match) template = JSON.parse(match[0]);` |
| HIGH | `backend/lib/vector-store.js` | 190 | fetch() without res.ok check before .json() | `const res = await fetch('https://api.voyageai.com/v1/embeddings', {` |
| HIGH | `backend/lib/web-prospect-agent.js` | 169 | JSON.parse without try/catch | `const parsed = JSON.parse(jsonMatch[0]);` |
| HIGH | `backend/api/airtable-crm.js` | 18 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/apollo.js` | 24 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/brave-search.js` | 30 | fetch() without res.ok check before .json() | `const res = await fetch(`${BASE_URL}?${params}`, {` |
| HIGH | `backend/api/folk.js` | 15 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/hubspot.js` | 15 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/informz.js` | 73 | fetch() without res.ok check before .json() | `const res = await fetch(endpoint, {` |
| HIGH | `backend/api/instantly.js` | 28 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/lagrowthmachine.js` | 25 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/lemlist.js` | 15 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| MEDIUM | `backend/api/lemlist.js` | 647 | Empty catch block (swallowed error) | `} catch { /* logger optional */ }` |
| MEDIUM | `backend/api/lemlist.js` | 687 | Empty catch block (swallowed error) | `} catch { /* logger optional */ }` |
| HIGH | `backend/api/lemlist.js` | 749 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/linkedin.js` | 56 | fetch() without res.ok check before .json() | `const res = await fetch(`${VOYAGER_BASE}${endpoint}`, {` |
| HIGH | `backend/api/odoo.js` | 20 | fetch() without res.ok check before .json() | `const res = await fetch(`${url}/jsonrpc`, {` |
| HIGH | `backend/api/pipedrive.js` | 16 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/salesforce.js` | 13 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/waalaxy.js` | 25 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `frontend/src/components/AuthGate.jsx` | 214 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/forgot-password', {` |
| LOW | `frontend/src/components/FieldMappingSettings.jsx` | 47 | Hardcoded CRM provider list (may be incomplete) | `const crmProviders = ['pipedrive', 'hubspot', 'salesforce'];` |
| MEDIUM | `frontend/src/components/ICPInsightsCard.jsx` | 201 | new Date() on potentially null value without guard | `{new Date(data.analyzedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: ` |
| MEDIUM | `frontend/src/components/OnboardingChecklist.jsx` | 47 | Empty catch block (swallowed error) | `} catch { /* checklist won't show */ }` |
| MEDIUM | `frontend/src/components/TeamSettings.jsx` | 53 | Native alert()/prompt() in frontend | `alert(err.message);` |
| MEDIUM | `frontend/src/components/TeamSettings.jsx` | 74 | Native alert()/prompt() in frontend | `alert(err.message);` |
| MEDIUM | `frontend/src/components/TeamSettings.jsx` | 84 | Native alert()/prompt() in frontend | `alert(err.message);` |
| MEDIUM | `frontend/src/components/TeamSettings.jsx` | 93 | Native alert()/prompt() in frontend | `alert(err.message);` |
| HIGH | `frontend/src/components/VariableManager.jsx` | 378 | JSON.parse without try/catch | `initialRegistry ? JSON.parse(JSON.stringify(initialRegistry)) : JSON.parse(JSON.` |
| MEDIUM | `frontend/src/components/campaigns/CampaignDetailLayout.jsx` | 94 | Native alert()/prompt() in frontend | `window.alert(t('campaigns.archiveFailed', { error: err.message \|\| 'erreur inco` |
| MEDIUM | `frontend/src/components/campaigns/tabs/RepliesTab.jsx` | 125 | new Date() on potentially null value without guard | `const happenedAt = a.happened_at ? new Date(a.happened_at) : null;` |
| MEDIUM | `frontend/src/components/editor/__tests__/editor-helpers.test.js` | 14 | Native alert()/prompt() in frontend | `expect(escapeHtml('<script>alert("xss")</script>')).toBe(` |
| MEDIUM | `frontend/src/components/editor/__tests__/editor-helpers.test.js` | 15 | Native alert()/prompt() in frontend | `'&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'` |
| MEDIUM | `frontend/src/pages/CampaignsList.jsx` | 114 | Native alert()/prompt() in frontend | `window.alert(t('campaigns.errorPrefix', { message: err.message }));` |
| MEDIUM | `frontend/src/pages/CampaignsList.jsx` | 132 | Native alert()/prompt() in frontend | `window.alert(t('campaigns.errorPrefix', { message: err.message }));` |
| MEDIUM | `frontend/src/pages/CampaignsList.jsx` | 517 | new Date() on potentially null value without guard | `{en ? 'Sends at:' : 'Envoi à :'} {new Date(q.scheduled_at).toLocaleString(en ? '` |
| MEDIUM | `frontend/src/pages/CampaignsList.jsx` | 551 | new Date() on potentially null value without guard | `{en ? 'Sent:' : 'Envoyé :'} {new Date(q.sent_at).toLocaleString(en ? 'en-US' : '` |
| HIGH | `frontend/src/pages/ChatPage.jsx` | 1975 | JSON.parse without try/catch | `metadata: m.metadata ? (typeof m.metadata === 'string' ? JSON.parse(m.metadata) ` |
| MEDIUM | `frontend/src/pages/ClientsPage.jsx` | 582 | Native alert()/prompt() in frontend | `const subject = prompt('Objet de l\'email :');` |
| MEDIUM | `frontend/src/pages/ClientsPage.jsx` | 584 | Native alert()/prompt() in frontend | `const body = prompt('Message :');` |
| HIGH | `frontend/src/pages/CopyEditorPage.jsx` | 805 | JSON.parse without try/catch | `const copy = { ...JSON.parse(JSON.stringify(original)), id: tpId + '-copy', labe` |
| MEDIUM | `frontend/src/pages/MembershipPage.jsx` | 136 | new Date() on potentially null value without guard | `<div style={{ fontWeight: 600 }}>{new Date(r.renewal_date).toLocaleDateString(en` |
| MEDIUM | `frontend/src/pages/MemoryExplorerPage.jsx` | 392 | new Date() on potentially null value without guard | `<span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>{e.sen` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 103 | Native alert()/prompt() in frontend | `alert((lang === 'en' ? 'Error: ' : 'Erreur: ') + err.message);` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 166 | Native alert()/prompt() in frontend | `alert((lang === 'en' ? 'Error: ' : 'Erreur: ') + err.message);` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 285 | Native alert()/prompt() in frontend | `alert((lang === 'en' ? 'Error: ' : 'Erreur: ') + err.message);` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 416 | new Date() on potentially null value without guard | `{trigger.last_run && ` \u00B7 ${lang === 'en' ? 'Last run:' : 'Dernier run :'} $` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 473 | Native alert()/prompt() in frontend | `alert((en ? 'Error: ' : 'Erreur: ') + err.message);` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 525 | new Date() on potentially null value without guard | `{email.sent_at && ` \u00B7 ${en ? 'Sent on' : 'Envoy\u00E9 le'} ${new Date(email` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 766 | new Date() on potentially null value without guard | `{e.sent_at ? new Date(e.sent_at).toLocaleDateString(en ? 'en-US' : 'fr-FR', { da` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 1015 | new Date() on potentially null value without guard | `{en ? 'by' : 'par'} {c.created_by_name} {'\u00B7'} {new Date(c.created_at).toLoc` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 1207 | new Date() on potentially null value without guard | `{en ? 'Scheduled:' : 'Planifié :'} {new Date(q.scheduled_at).toLocaleString(lang` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 1243 | new Date() on potentially null value without guard | `{en ? 'Sent:' : 'Envoyé :'} {new Date(q.sent_at).toLocaleString(lang === 'en' ? ` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 1310 | new Date() on potentially null value without guard | `{test.startedAt ? new Date(test.startedAt).toLocaleDateString(en ? 'en-US' : 'fr` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 1501 | new Date() on potentially null value without guard | `{e.to} &middot; {new Date(e.createdAt).toLocaleDateString(en ? 'en-US' : 'fr-FR'` |
| HIGH | `frontend/src/pages/ProfilePage.jsx` | 127 | fetch() without res.ok check before .json() | `const res = await fetch('/api/profile', {` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 256 | Native alert()/prompt() in frontend | `alert((en ? 'Reparse failed for all docs:\n\n' : 'Reparse a échoué pour tous les` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 260 | Native alert()/prompt() in frontend | `alert((en ? 'Error: ' : 'Erreur: ') + err.message);` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 263 | Native alert()/prompt() in frontend | `alert('Auto-fill: ' + err.message);` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 469 | new Date() on potentially null value without guard | `{new Date(doc.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: '` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 476 | Empty catch block (swallowed error) | `} catch {}` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 746 | new Date() on potentially null value without guard | `<span style={{ color: 'var(--text-muted)', fontSize: 10 }}>{new Date(doc.created` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 747 | Empty catch block (swallowed error) | `<button onClick={async () => { try { await request('/documents/' + doc.id, { met` |
| MEDIUM | `frontend/src/pages/RecosPage.jsx` | 67 | new Date() on potentially null value without guard | `date: d.created_at ? new Date(d.created_at).toLocaleDateString('fr-FR', { day: '` |
| HIGH | `frontend/src/pages/ResetPasswordPage.jsx` | 129 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/reset-password', {` |
| HIGH | `frontend/src/pages/SettingsPage.jsx` | 136 | JSON.parse without try/catch | `return saved ? { ...DEFAULT_PREFERENCES, ...JSON.parse(saved) } : { ...DEFAULT_P` |
| HIGH | `frontend/src/pages/SettingsPage.jsx` | 1016 | JSON.parse without try/catch | `const user = JSON.parse(localStorage.getItem('bakal_user') \|\| '{}');` |
| MEDIUM | `frontend/src/pages/SignalsPage.jsx` | 308 | new Date() on potentially null value without guard | `<span>{new Date(s.detected_at).toLocaleDateString(en ? 'en-US' : 'fr-FR', { day:` |
| MEDIUM | `frontend/src/pages/SignalsPage.jsx` | 452 | new Date() on potentially null value without guard | `{new Date(s.detected_at).toLocaleDateString(en ? 'en-US' : 'fr-FR', { day: 'nume` |
| MEDIUM | `frontend/src/pages/SignalsPage.jsx` | 585 | new Date() on potentially null value without guard | `{c.last_run && <span>{en ? 'Last scan' : 'Dernier scan'}: {new Date(c.last_run).` |
| HIGH | `frontend/src/services/api-client.js` | 23 | fetch() without res.ok check before .json() | `let res = await fetch(url, { headers, ...opts });` |
| HIGH | `frontend/src/services/api-client.js` | 31 | fetch() without res.ok check before .json() | `res = await fetch(url, { headers, ...opts });` |
| HIGH | `frontend/src/services/api-client.js` | 110 | JSON.parse without try/catch | `? (typeof c.ab_config === 'string' ? JSON.parse(c.ab_config) : c.ab_config)` |
| MEDIUM | `frontend/src/services/api-client.js` | 115 | new Date() on potentially null value without guard | `createdDate: c.created_at ? new Date(c.created_at).toLocaleDateString('fr-FR', {` |
| HIGH | `frontend/src/services/api-client.js` | 716 | fetch() without res.ok check before .json() | `const res = await fetch(url, { method: 'POST', headers, body: formData });` |
| HIGH | `frontend/src/services/auth.js` | 53 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/login', {` |
| HIGH | `frontend/src/services/auth.js` | 77 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/register', {` |
| HIGH | `frontend/src/services/auth.js` | 95 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/resend-verification', {` |
| HIGH | `frontend/src/services/auth.js` | 116 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/refresh', {` |
| HIGH | `frontend/src/services/auth.js` | 144 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/account', {` |
| HIGH | `frontend/src/services/auth.js` | 161 | fetch() without res.ok check before .json() | `await fetch('/api/auth/logout', {` |

### Automated Audit — 2026-06-24

Found 184 potential issue(s):

| Severity | File | Line | Pattern | Code |
|----------|------|------|---------|------|
| HIGH | `backend/routes/ai.js` | 438 | JSON.parse without try/catch | `const data = typeof pattern.data === 'string' ? JSON.parse(pattern.data) : (patt` |
| MEDIUM | `backend/routes/ai.js` | 439 | new Date() on potentially null value without guard | `const age = Math.round((Date.now() - new Date(pattern.date_discovered).getTime()` |
| MEDIUM | `backend/routes/ai.js` | 525 | Empty catch block (swallowed error) | `} catch { /* solo user */ }` |
| MEDIUM | `backend/routes/ai.js` | 703 | Empty catch block (swallowed error) | `try { campaignMap[cid] = await db.campaigns.get(cid); } catch {}` |
| HIGH | `backend/routes/ai.js` | 861 | JSON.parse without try/catch | `const config = typeof campaign.ab_config === 'string' ? JSON.parse(campaign.ab_c` |
| MEDIUM | `backend/routes/analytics.js` | 102 | new Date() on potentially null value without guard | `const updatedAt = opp.updated_at ? new Date(opp.updated_at).getTime() : now;` |
| MEDIUM | `backend/routes/analytics.js` | 103 | new Date() on potentially null value without guard | `const createdAt = opp.created_at ? new Date(opp.created_at).getTime() : now;` |
| MEDIUM | `backend/routes/analytics.js` | 578 | new Date() on potentially null value without guard | `const create = new Date(o.created_at).getTime();` |
| MEDIUM | `backend/routes/analytics.js` | 651 | new Date() on potentially null value without guard | `const updatedAt = opp.updated_at ? new Date(opp.updated_at).getTime() : now;` |
| MEDIUM | `backend/routes/analytics.js` | 742 | new Date() on potentially null value without guard | `const stale = activeOpps.filter(o => { const u = o.updated_at ? new Date(o.updat` |
| MEDIUM | `backend/routes/auth.js` | 270 | Empty catch block (swallowed error) | `} catch { /* no team */ }` |
| MEDIUM | `backend/routes/auth.js` | 497 | Empty catch block (swallowed error) | `} catch { /* no team — ok */ }` |
| MEDIUM | `backend/routes/campaigns.js` | 237 | new Date() on potentially null value without guard | `const lastOpt = campaign.last_optimized_at ? new Date(campaign.last_optimized_at` |
| MEDIUM | `backend/routes/chat.js` | 251 | Empty catch block (swallowed error) | `} catch { /* default to fr */ }` |
| MEDIUM | `backend/routes/chat.js` | 324 | new Date() on potentially null value without guard | `new Date(c.created_at).getTime() > sixtyAgo` |
| LOW | `backend/routes/chat.js` | 450 | Hardcoded CRM provider list (may be incomplete) | `const providers = ['pipedrive', 'hubspot', 'salesforce', 'odoo'];` |
| HIGH | `backend/routes/crm.js` | 318 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| HIGH | `backend/routes/crm.js` | 351 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| HIGH | `backend/routes/crm.js` | 367 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| HIGH | `backend/routes/crm.js` | 715 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| HIGH | `backend/routes/crm.js` | 744 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| LOW | `backend/routes/crm.js` | 1036 | Hardcoded CRM provider list (may be incomplete) | `for (const provider of ['pipedrive', 'salesforce', 'hubspot']) {` |
| MEDIUM | `backend/routes/crm.js` | 1047 | Empty catch block (swallowed error) | `} catch { /* scoring works without deals */ }` |
| HIGH | `backend/routes/crm.js` | 1356 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| HIGH | `backend/routes/crm.js` | 1370 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| MEDIUM | `backend/routes/crm.js` | 1400 | Empty catch block (swallowed error) | `} catch { /* skip individual failures */ }` |
| HIGH | `backend/routes/crm.js` | 1569 | fetch() without res.ok check before .json() | `const tokenRes = await fetch('https://login.salesforce.com/services/oauth2/token` |
| HIGH | `backend/routes/crm.js` | 1714 | fetch() without res.ok check before .json() | `const tokenRes = await fetch('https://login.salesforce.com/services/oauth2/token` |
| HIGH | `backend/routes/crm.js` | 1765 | fetch() without res.ok check before .json() | `const tokenRes = await fetch('https://login.salesforce.com/services/oauth2/token` |
| MEDIUM | `backend/routes/documents.js` | 141 | Empty catch block (swallowed error) | `try { fs.unlinkSync(file.path); } catch {}` |
| MEDIUM | `backend/routes/documents.js` | 244 | Empty catch block (swallowed error) | `try { fs.unlinkSync(tempPath); } catch {}` |
| HIGH | `backend/routes/export.js` | 199 | JSON.parse without try/catch | `? JSON.parse(o.score_breakdown \|\| '{}')` |
| MEDIUM | `backend/routes/extension.js` | 62 | Empty catch block (swallowed error) | `} catch { /* optional */ }` |
| HIGH | `backend/routes/extension.js` | 102 | JSON.parse without try/catch | `const data = (typeof opp.data === 'string' ? JSON.parse(opp.data) : opp.data) \|` |
| HIGH | `backend/routes/extension.js` | 143 | JSON.parse without try/catch | `const data = (typeof opp.data === 'string' ? JSON.parse(opp.data) : opp.data) \|` |
| HIGH | `backend/routes/informz.js` | 67 | JSON.parse without try/catch | `if (m) parsed = JSON.parse(m[0]);` |
| HIGH | `backend/routes/informz.js` | 210 | JSON.parse without try/catch | `if (m) parsed = JSON.parse(m[0]);` |
| MEDIUM | `backend/routes/nurture.js` | 346 | Empty catch block (swallowed error) | `} catch { /* optional */ }` |
| MEDIUM | `backend/routes/nurture.js` | 359 | Empty catch block (swallowed error) | `if (m) { try { sampleEmail = JSON.parse(m[0]); } catch { /* malformed JSON */ } ` |
| MEDIUM | `backend/routes/nurture.js` | 361 | Empty catch block (swallowed error) | `} catch { /* skip preview generation */ }` |
| HIGH | `backend/routes/nurture.js` | 432 | fetch() without res.ok check before .json() | `const tokenRes = await fetch('https://oauth2.googleapis.com/token', {` |
| HIGH | `backend/routes/nurture.js` | 522 | fetch() without res.ok check before .json() | `const tokenRes = await fetch('https://login.microsoftonline.com/common/oauth2/v2` |
| HIGH | `backend/routes/settings.js` | 375 | JSON.parse without try/catch | `const currentMeta = typeof existing.metadata === 'string' ? JSON.parse(existing.` |
| HIGH | `backend/routes/signals.js` | 166 | JSON.parse without try/catch | `if (m) email = JSON.parse(m[0]);` |
| HIGH | `backend/routes/signals.js` | 351 | JSON.parse without try/catch | `if (m) sequence = JSON.parse(m[0]);` |
| HIGH | `backend/routes/stats.js` | 23 | fetch() without res.ok check before .json() | `const resp = await fetch(url, options);` |
| HIGH | `backend/routes/team-campaigns.js` | 136 | JSON.parse without try/catch | `if (m) sampleEmail = JSON.parse(m[0]);` |
| MEDIUM | `backend/routes/team-campaigns.js` | 202 | Empty catch block (swallowed error) | `if (m) { try { email = JSON.parse(m[0]); } catch { /* malformed AI response */ }` |
| HIGH | `backend/lib/ab-memory.js` | 187 | JSON.parse without try/catch | `const data = typeof top.data === 'string' ? JSON.parse(top.data) : (top.data \|\` |
| MEDIUM | `backend/lib/agent-chains.js` | 338 | Empty catch block (swallowed error) | `} catch { /* no product lines */ }` |
| MEDIUM | `backend/lib/agent-chains.js` | 360 | Empty catch block (swallowed error) | `} catch { /* ok */ }` |
| MEDIUM | `backend/lib/agents/signal-agent.js` | 125 | Empty catch block (swallowed error) | `} catch { /* enrichment is optional */ }` |
| MEDIUM | `backend/lib/agents/signal-agent.js` | 181 | Empty catch block (swallowed error) | `} catch { /* notifications are optional */ }` |
| MEDIUM | `backend/lib/agents/signal-agent.js` | 206 | Empty catch block (swallowed error) | `} catch { /* skip duplicates */ }` |
| MEDIUM | `backend/lib/agents/signal-agent.js` | 212 | Empty catch block (swallowed error) | `} catch { /* auto-prospecting is optional */ }` |
| HIGH | `backend/lib/agents/signal-agent.js` | 289 | fetch() without res.ok check before .json() | `const res = await fetch('https://api.apollo.io/v1/mixed_people/search', {` |
| MEDIUM | `backend/lib/agents/timing-agent.js` | 99 | new Date() on potentially null value without guard | `const replied = new Date(r.replied_at).getTime();` |
| MEDIUM | `backend/lib/agents/timing-agent.js` | 163 | new Date() on potentially null value without guard | `const sent = new Date(r.sent_at).getTime();` |
| MEDIUM | `backend/lib/agents/timing-agent.js` | 164 | new Date() on potentially null value without guard | `const resp = new Date(r.response_at).getTime();` |
| MEDIUM | `backend/lib/churn-scoring.js` | 85 | new Date() on potentially null value without guard | `const age = (now - new Date(e.created_at).getTime()) / DAY_MS;` |
| MEDIUM | `backend/lib/conversation-autopilot.js` | 190 | Empty catch block (swallowed error) | `try { return JSON.parse(match[0]); } catch { /* fallthrough */ }` |
| MEDIUM | `backend/lib/conversation-autopilot.js` | 319 | new Date() on potentially null value without guard | `return history.sort((a, b) => new Date(a.date) - new Date(b.date));` |
| MEDIUM | `backend/lib/crm-agent.js` | 62 | Empty catch block (swallowed error) | `} catch { /* solo user, no team */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 177 | Empty catch block (swallowed error) | `} catch { /* ok */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 205 | Empty catch block (swallowed error) | `} catch { /* notification is non-blocking */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 283 | Empty catch block (swallowed error) | `} catch { /* owner mapping is optional */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 350 | Empty catch block (swallowed error) | `} catch { /* mapping is optional */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 379 | Empty catch block (swallowed error) | `} catch { /* deal sync is optional */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 548 | Empty catch block (swallowed error) | `} catch { /* fallback to 50/50 */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 637 | Empty catch block (swallowed error) | `} catch { /* patterns optional */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 677 | Empty catch block (swallowed error) | `} catch { /* fallback to single */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 694 | Empty catch block (swallowed error) | `} catch { /* fallback below */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 772 | new Date() on potentially null value without guard | `.map(o => (new Date(o.updated_at).getTime() - new Date(o.created_at).getTime()) ` |
| MEDIUM | `backend/lib/crm-agent.js` | 794 | new Date() on potentially null value without guard | `.map(o => (new Date(o.updated_at).getTime() - new Date(o.created_at).getTime()) ` |
| MEDIUM | `backend/lib/crm-agent.js` | 864 | Empty catch block (swallowed error) | `} catch { /* optional */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 893 | Empty catch block (swallowed error) | `} catch { /* optional */ }` |
| MEDIUM | `backend/lib/crm-bidirectional-sync.js` | 84 | new Date() on potentially null value without guard | `const lastPush = opp.score_pushed_at ? new Date(opp.score_pushed_at).getTime() :` |
| MEDIUM | `backend/lib/crm-bidirectional-sync.js` | 93 | Empty catch block (swallowed error) | `} catch { /* ignore individual push errors */ }` |
| HIGH | `backend/lib/crm-export.js` | 23 | fetch() without res.ok check before .json() | `const res = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {` |
| HIGH | `backend/lib/crm-export.js` | 51 | fetch() without res.ok check before .json() | `const res = await fetch(`${instanceUrl}/services/data/v62.0/sobjects/Contact`, {` |
| HIGH | `backend/lib/crm-export.js` | 76 | fetch() without res.ok check before .json() | `const res = await fetch(`https://api.pipedrive.com/v1/persons?api_token=${apiKey` |
| HIGH | `backend/lib/crm-export.js` | 90 | fetch() without res.ok check before .json() | `await fetch(`https://api.pipedrive.com/v1/notes?api_token=${apiKey}`, {` |
| MEDIUM | `backend/lib/crm-owner-resolver.js` | 32 | Empty catch block (swallowed error) | `} catch { /* no team = solo user */ }` |
| MEDIUM | `backend/lib/deliverability-agent.js` | 200 | Empty catch block (swallowed error) | `} catch { /* notification is best-effort */ }` |
| HIGH | `backend/lib/email-outbound.js` | 117 | fetch() without res.ok check before .json() | `const res = await fetch(tokenUrl, {` |
| HIGH | `backend/lib/email.js` | 16 | fetch() without res.ok check before .json() | `const res = await fetch('https://api.resend.com/emails', {` |
| MEDIUM | `backend/lib/enrich-agent.js` | 210 | Empty catch block (swallowed error) | `} catch { /* Brave search failed */ }` |
| HIGH | `backend/lib/enrich-agent.js` | 241 | JSON.parse without try/catch | `return JSON.parse(match[0]);` |
| MEDIUM | `backend/lib/enrich-agent.js` | 336 | Empty catch block (swallowed error) | `} catch { /* verification failed, keep the email */ }` |
| MEDIUM | `backend/lib/enrich-agent.js` | 375 | Empty catch block (swallowed error) | `} catch { /* continue */ }` |
| HIGH | `backend/lib/enrich-agent.js` | 411 | JSON.parse without try/catch | `const parsed = JSON.parse(match[0]);` |
| HIGH | `backend/lib/icp-agent.js` | 170 | JSON.parse without try/catch | `const data = typeof userIcp.data === 'string' ? JSON.parse(userIcp.data) : userI` |
| HIGH | `backend/lib/lifecycle-emails.js` | 188 | JSON.parse without try/catch | `const userData = (typeof user.data === 'string' ? JSON.parse(user.data) : user.d` |
| MEDIUM | `backend/lib/lifecycle-emails.js` | 190 | new Date() on potentially null value without guard | `const daysSinceSignup = Math.floor((Date.now() - new Date(user.created_at).getTi` |
| HIGH | `backend/lib/lifecycle-emails.js` | 240 | JSON.parse without try/catch | `const userData = (typeof user.data === 'string' ? JSON.parse(user.data) : user.d` |
| MEDIUM | `backend/lib/nurture-engine.js` | 78 | new Date() on potentially null value without guard | `const dealAge = (Date.now() - new Date(deal.createdAt).getTime()) / DAY_MS;` |
| MEDIUM | `backend/lib/nurture-engine.js` | 104 | new Date() on potentially null value without guard | `const lastUpdate = c.update_time ? new Date(c.update_time).getTime() : 0;` |
| MEDIUM | `backend/lib/nurture-engine.js` | 121 | new Date() on potentially null value without guard | `const renewalTime = new Date(o.renewal_date).getTime();` |
| MEDIUM | `backend/lib/nurture-engine.js` | 276 | Empty catch block (swallowed error) | `try { return JSON.parse(jsonMatch[0]); } catch { /* fall through */ }` |
| HIGH | `backend/lib/outreach-deploy.js` | 79 | fetch() without res.ok check before .json() | `const r = await fetch('https://api.apollo.io/v1/emailer_campaigns', {` |
| HIGH | `backend/lib/outreach-deploy.js` | 124 | fetch() without res.ok check before .json() | `const r = await fetch(`https://api.instantly.ai/api/v1/campaign/step/add?api_key` |
| MEDIUM | `backend/lib/reporting-agent.js` | 143 | Empty catch block (swallowed error) | `} catch { /* ignore notification errors */ }` |
| MEDIUM | `backend/lib/response-analysis-agent.js` | 58 | new Date() on potentially null value without guard | `const sentAt = new Date(email.sent_at).getTime();` |
| MEDIUM | `backend/lib/response-analysis-agent.js` | 60 | new Date() on potentially null value without guard | `const actDate = a.dueDate ? new Date(a.dueDate).getTime() : 0;` |
| HIGH | `backend/lib/response-analysis-agent.js` | 272 | JSON.parse without try/catch | `if (match) return JSON.parse(match[0]);` |
| MEDIUM | `backend/lib/response-analysis-agent.js` | 273 | Empty catch block (swallowed error) | `} catch { /* fallback below */ }` |
| HIGH | `backend/lib/template-agent.js` | 169 | JSON.parse without try/catch | `if (match) template = JSON.parse(match[0]);` |
| HIGH | `backend/lib/vector-store.js` | 190 | fetch() without res.ok check before .json() | `const res = await fetch('https://api.voyageai.com/v1/embeddings', {` |
| HIGH | `backend/lib/web-prospect-agent.js` | 169 | JSON.parse without try/catch | `const parsed = JSON.parse(jsonMatch[0]);` |
| HIGH | `backend/api/airtable-crm.js` | 18 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/apollo.js` | 24 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/brave-search.js` | 30 | fetch() without res.ok check before .json() | `const res = await fetch(`${BASE_URL}?${params}`, {` |
| HIGH | `backend/api/folk.js` | 15 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/hubspot.js` | 15 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/informz.js` | 73 | fetch() without res.ok check before .json() | `const res = await fetch(endpoint, {` |
| HIGH | `backend/api/instantly.js` | 28 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/lagrowthmachine.js` | 25 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/lemlist.js` | 15 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| MEDIUM | `backend/api/lemlist.js` | 647 | Empty catch block (swallowed error) | `} catch { /* logger optional */ }` |
| MEDIUM | `backend/api/lemlist.js` | 687 | Empty catch block (swallowed error) | `} catch { /* logger optional */ }` |
| HIGH | `backend/api/lemlist.js` | 749 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/linkedin.js` | 56 | fetch() without res.ok check before .json() | `const res = await fetch(`${VOYAGER_BASE}${endpoint}`, {` |
| HIGH | `backend/api/odoo.js` | 20 | fetch() without res.ok check before .json() | `const res = await fetch(`${url}/jsonrpc`, {` |
| HIGH | `backend/api/pipedrive.js` | 16 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/salesforce.js` | 13 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/waalaxy.js` | 25 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `frontend/src/components/AuthGate.jsx` | 214 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/forgot-password', {` |
| LOW | `frontend/src/components/FieldMappingSettings.jsx` | 47 | Hardcoded CRM provider list (may be incomplete) | `const crmProviders = ['pipedrive', 'hubspot', 'salesforce'];` |
| MEDIUM | `frontend/src/components/ICPInsightsCard.jsx` | 201 | new Date() on potentially null value without guard | `{new Date(data.analyzedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: ` |
| MEDIUM | `frontend/src/components/OnboardingChecklist.jsx` | 47 | Empty catch block (swallowed error) | `} catch { /* checklist won't show */ }` |
| MEDIUM | `frontend/src/components/TeamSettings.jsx` | 53 | Native alert()/prompt() in frontend | `alert(err.message);` |
| MEDIUM | `frontend/src/components/TeamSettings.jsx` | 74 | Native alert()/prompt() in frontend | `alert(err.message);` |
| MEDIUM | `frontend/src/components/TeamSettings.jsx` | 84 | Native alert()/prompt() in frontend | `alert(err.message);` |
| MEDIUM | `frontend/src/components/TeamSettings.jsx` | 93 | Native alert()/prompt() in frontend | `alert(err.message);` |
| HIGH | `frontend/src/components/VariableManager.jsx` | 378 | JSON.parse without try/catch | `initialRegistry ? JSON.parse(JSON.stringify(initialRegistry)) : JSON.parse(JSON.` |
| MEDIUM | `frontend/src/components/campaigns/CampaignDetailLayout.jsx` | 94 | Native alert()/prompt() in frontend | `window.alert(t('campaigns.archiveFailed', { error: err.message \|\| 'erreur inco` |
| MEDIUM | `frontend/src/components/campaigns/tabs/RepliesTab.jsx` | 125 | new Date() on potentially null value without guard | `const happenedAt = a.happened_at ? new Date(a.happened_at) : null;` |
| MEDIUM | `frontend/src/components/editor/__tests__/editor-helpers.test.js` | 14 | Native alert()/prompt() in frontend | `expect(escapeHtml('<script>alert("xss")</script>')).toBe(` |
| MEDIUM | `frontend/src/components/editor/__tests__/editor-helpers.test.js` | 15 | Native alert()/prompt() in frontend | `'&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'` |
| MEDIUM | `frontend/src/pages/CampaignsList.jsx` | 114 | Native alert()/prompt() in frontend | `window.alert(t('campaigns.errorPrefix', { message: err.message }));` |
| MEDIUM | `frontend/src/pages/CampaignsList.jsx` | 132 | Native alert()/prompt() in frontend | `window.alert(t('campaigns.errorPrefix', { message: err.message }));` |
| MEDIUM | `frontend/src/pages/CampaignsList.jsx` | 517 | new Date() on potentially null value without guard | `{en ? 'Sends at:' : 'Envoi à :'} {new Date(q.scheduled_at).toLocaleString(en ? '` |
| MEDIUM | `frontend/src/pages/CampaignsList.jsx` | 551 | new Date() on potentially null value without guard | `{en ? 'Sent:' : 'Envoyé :'} {new Date(q.sent_at).toLocaleString(en ? 'en-US' : '` |
| MEDIUM | `frontend/src/pages/ClientsPage.jsx` | 582 | Native alert()/prompt() in frontend | `const subject = prompt('Objet de l\'email :');` |
| MEDIUM | `frontend/src/pages/ClientsPage.jsx` | 584 | Native alert()/prompt() in frontend | `const body = prompt('Message :');` |
| HIGH | `frontend/src/pages/CopyEditorPage.jsx` | 805 | JSON.parse without try/catch | `const copy = { ...JSON.parse(JSON.stringify(original)), id: tpId + '-copy', labe` |
| MEDIUM | `frontend/src/pages/MembershipPage.jsx` | 136 | new Date() on potentially null value without guard | `<div style={{ fontWeight: 600 }}>{new Date(r.renewal_date).toLocaleDateString(en` |
| MEDIUM | `frontend/src/pages/MemoryExplorerPage.jsx` | 392 | new Date() on potentially null value without guard | `<span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>{e.sen` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 103 | Native alert()/prompt() in frontend | `alert((lang === 'en' ? 'Error: ' : 'Erreur: ') + err.message);` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 166 | Native alert()/prompt() in frontend | `alert((lang === 'en' ? 'Error: ' : 'Erreur: ') + err.message);` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 285 | Native alert()/prompt() in frontend | `alert((lang === 'en' ? 'Error: ' : 'Erreur: ') + err.message);` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 416 | new Date() on potentially null value without guard | `{trigger.last_run && ` \u00B7 ${lang === 'en' ? 'Last run:' : 'Dernier run :'} $` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 473 | Native alert()/prompt() in frontend | `alert((en ? 'Error: ' : 'Erreur: ') + err.message);` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 525 | new Date() on potentially null value without guard | `{email.sent_at && ` \u00B7 ${en ? 'Sent on' : 'Envoy\u00E9 le'} ${new Date(email` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 766 | new Date() on potentially null value without guard | `{e.sent_at ? new Date(e.sent_at).toLocaleDateString(en ? 'en-US' : 'fr-FR', { da` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 1015 | new Date() on potentially null value without guard | `{en ? 'by' : 'par'} {c.created_by_name} {'\u00B7'} {new Date(c.created_at).toLoc` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 1207 | new Date() on potentially null value without guard | `{en ? 'Scheduled:' : 'Planifié :'} {new Date(q.scheduled_at).toLocaleString(lang` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 1243 | new Date() on potentially null value without guard | `{en ? 'Sent:' : 'Envoyé :'} {new Date(q.sent_at).toLocaleString(lang === 'en' ? ` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 1310 | new Date() on potentially null value without guard | `{test.startedAt ? new Date(test.startedAt).toLocaleDateString(en ? 'en-US' : 'fr` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 1501 | new Date() on potentially null value without guard | `{e.to} &middot; {new Date(e.createdAt).toLocaleDateString(en ? 'en-US' : 'fr-FR'` |
| HIGH | `frontend/src/pages/ProfilePage.jsx` | 127 | fetch() without res.ok check before .json() | `const res = await fetch('/api/profile', {` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 256 | Native alert()/prompt() in frontend | `alert((en ? 'Reparse failed for all docs:\n\n' : 'Reparse a échoué pour tous les` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 260 | Native alert()/prompt() in frontend | `alert((en ? 'Error: ' : 'Erreur: ') + err.message);` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 263 | Native alert()/prompt() in frontend | `alert('Auto-fill: ' + err.message);` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 469 | new Date() on potentially null value without guard | `{new Date(doc.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: '` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 476 | Empty catch block (swallowed error) | `} catch {}` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 746 | new Date() on potentially null value without guard | `<span style={{ color: 'var(--text-muted)', fontSize: 10 }}>{new Date(doc.created` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 747 | Empty catch block (swallowed error) | `<button onClick={async () => { try { await request('/documents/' + doc.id, { met` |
| MEDIUM | `frontend/src/pages/RecosPage.jsx` | 67 | new Date() on potentially null value without guard | `date: d.created_at ? new Date(d.created_at).toLocaleDateString('fr-FR', { day: '` |
| HIGH | `frontend/src/pages/ResetPasswordPage.jsx` | 129 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/reset-password', {` |
| MEDIUM | `frontend/src/pages/SignalsPage.jsx` | 308 | new Date() on potentially null value without guard | `<span>{new Date(s.detected_at).toLocaleDateString(en ? 'en-US' : 'fr-FR', { day:` |
| MEDIUM | `frontend/src/pages/SignalsPage.jsx` | 452 | new Date() on potentially null value without guard | `{new Date(s.detected_at).toLocaleDateString(en ? 'en-US' : 'fr-FR', { day: 'nume` |
| MEDIUM | `frontend/src/pages/SignalsPage.jsx` | 585 | new Date() on potentially null value without guard | `{c.last_run && <span>{en ? 'Last scan' : 'Dernier scan'}: {new Date(c.last_run).` |
| HIGH | `frontend/src/services/api-client.js` | 23 | fetch() without res.ok check before .json() | `let res = await fetch(url, { headers, ...opts });` |
| HIGH | `frontend/src/services/api-client.js` | 31 | fetch() without res.ok check before .json() | `res = await fetch(url, { headers, ...opts });` |
| HIGH | `frontend/src/services/api-client.js` | 110 | JSON.parse without try/catch | `? (typeof c.ab_config === 'string' ? JSON.parse(c.ab_config) : c.ab_config)` |
| MEDIUM | `frontend/src/services/api-client.js` | 115 | new Date() on potentially null value without guard | `createdDate: c.created_at ? new Date(c.created_at).toLocaleDateString('fr-FR', {` |
| HIGH | `frontend/src/services/api-client.js` | 716 | fetch() without res.ok check before .json() | `const res = await fetch(url, { method: 'POST', headers, body: formData });` |
| HIGH | `frontend/src/services/auth.js` | 53 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/login', {` |
| HIGH | `frontend/src/services/auth.js` | 77 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/register', {` |
| HIGH | `frontend/src/services/auth.js` | 95 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/resend-verification', {` |
| HIGH | `frontend/src/services/auth.js` | 116 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/refresh', {` |
| HIGH | `frontend/src/services/auth.js` | 144 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/account', {` |
| HIGH | `frontend/src/services/auth.js` | 161 | fetch() without res.ok check before .json() | `await fetch('/api/auth/logout', {` |

### Automated Audit — 2026-06-25

Found 184 potential issue(s):

| Severity | File | Line | Pattern | Code |
|----------|------|------|---------|------|
| HIGH | `backend/routes/ai.js` | 438 | JSON.parse without try/catch | `const data = typeof pattern.data === 'string' ? JSON.parse(pattern.data) : (patt` |
| MEDIUM | `backend/routes/ai.js` | 439 | new Date() on potentially null value without guard | `const age = Math.round((Date.now() - new Date(pattern.date_discovered).getTime()` |
| MEDIUM | `backend/routes/ai.js` | 525 | Empty catch block (swallowed error) | `} catch { /* solo user */ }` |
| MEDIUM | `backend/routes/ai.js` | 703 | Empty catch block (swallowed error) | `try { campaignMap[cid] = await db.campaigns.get(cid); } catch {}` |
| HIGH | `backend/routes/ai.js` | 861 | JSON.parse without try/catch | `const config = typeof campaign.ab_config === 'string' ? JSON.parse(campaign.ab_c` |
| MEDIUM | `backend/routes/analytics.js` | 102 | new Date() on potentially null value without guard | `const updatedAt = opp.updated_at ? new Date(opp.updated_at).getTime() : now;` |
| MEDIUM | `backend/routes/analytics.js` | 103 | new Date() on potentially null value without guard | `const createdAt = opp.created_at ? new Date(opp.created_at).getTime() : now;` |
| MEDIUM | `backend/routes/analytics.js` | 578 | new Date() on potentially null value without guard | `const create = new Date(o.created_at).getTime();` |
| MEDIUM | `backend/routes/analytics.js` | 651 | new Date() on potentially null value without guard | `const updatedAt = opp.updated_at ? new Date(opp.updated_at).getTime() : now;` |
| MEDIUM | `backend/routes/analytics.js` | 742 | new Date() on potentially null value without guard | `const stale = activeOpps.filter(o => { const u = o.updated_at ? new Date(o.updat` |
| MEDIUM | `backend/routes/auth.js` | 270 | Empty catch block (swallowed error) | `} catch { /* no team */ }` |
| MEDIUM | `backend/routes/auth.js` | 497 | Empty catch block (swallowed error) | `} catch { /* no team — ok */ }` |
| MEDIUM | `backend/routes/campaigns.js` | 237 | new Date() on potentially null value without guard | `const lastOpt = campaign.last_optimized_at ? new Date(campaign.last_optimized_at` |
| MEDIUM | `backend/routes/chat.js` | 251 | Empty catch block (swallowed error) | `} catch { /* default to fr */ }` |
| MEDIUM | `backend/routes/chat.js` | 324 | new Date() on potentially null value without guard | `new Date(c.created_at).getTime() > sixtyAgo` |
| LOW | `backend/routes/chat.js` | 450 | Hardcoded CRM provider list (may be incomplete) | `const providers = ['pipedrive', 'hubspot', 'salesforce', 'odoo'];` |
| HIGH | `backend/routes/crm.js` | 318 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| HIGH | `backend/routes/crm.js` | 351 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| HIGH | `backend/routes/crm.js` | 367 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| HIGH | `backend/routes/crm.js` | 715 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| HIGH | `backend/routes/crm.js` | 744 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| LOW | `backend/routes/crm.js` | 1036 | Hardcoded CRM provider list (may be incomplete) | `for (const provider of ['pipedrive', 'salesforce', 'hubspot']) {` |
| MEDIUM | `backend/routes/crm.js` | 1047 | Empty catch block (swallowed error) | `} catch { /* scoring works without deals */ }` |
| HIGH | `backend/routes/crm.js` | 1356 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| HIGH | `backend/routes/crm.js` | 1370 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| MEDIUM | `backend/routes/crm.js` | 1400 | Empty catch block (swallowed error) | `} catch { /* skip individual failures */ }` |
| HIGH | `backend/routes/crm.js` | 1569 | fetch() without res.ok check before .json() | `const tokenRes = await fetch('https://login.salesforce.com/services/oauth2/token` |
| HIGH | `backend/routes/crm.js` | 1714 | fetch() without res.ok check before .json() | `const tokenRes = await fetch('https://login.salesforce.com/services/oauth2/token` |
| HIGH | `backend/routes/crm.js` | 1765 | fetch() without res.ok check before .json() | `const tokenRes = await fetch('https://login.salesforce.com/services/oauth2/token` |
| MEDIUM | `backend/routes/documents.js` | 141 | Empty catch block (swallowed error) | `try { fs.unlinkSync(file.path); } catch {}` |
| MEDIUM | `backend/routes/documents.js` | 244 | Empty catch block (swallowed error) | `try { fs.unlinkSync(tempPath); } catch {}` |
| HIGH | `backend/routes/export.js` | 199 | JSON.parse without try/catch | `? JSON.parse(o.score_breakdown \|\| '{}')` |
| MEDIUM | `backend/routes/extension.js` | 62 | Empty catch block (swallowed error) | `} catch { /* optional */ }` |
| HIGH | `backend/routes/extension.js` | 102 | JSON.parse without try/catch | `const data = (typeof opp.data === 'string' ? JSON.parse(opp.data) : opp.data) \|` |
| HIGH | `backend/routes/extension.js` | 143 | JSON.parse without try/catch | `const data = (typeof opp.data === 'string' ? JSON.parse(opp.data) : opp.data) \|` |
| HIGH | `backend/routes/informz.js` | 67 | JSON.parse without try/catch | `if (m) parsed = JSON.parse(m[0]);` |
| HIGH | `backend/routes/informz.js` | 210 | JSON.parse without try/catch | `if (m) parsed = JSON.parse(m[0]);` |
| MEDIUM | `backend/routes/nurture.js` | 346 | Empty catch block (swallowed error) | `} catch { /* optional */ }` |
| MEDIUM | `backend/routes/nurture.js` | 359 | Empty catch block (swallowed error) | `if (m) { try { sampleEmail = JSON.parse(m[0]); } catch { /* malformed JSON */ } ` |
| MEDIUM | `backend/routes/nurture.js` | 361 | Empty catch block (swallowed error) | `} catch { /* skip preview generation */ }` |
| HIGH | `backend/routes/nurture.js` | 432 | fetch() without res.ok check before .json() | `const tokenRes = await fetch('https://oauth2.googleapis.com/token', {` |
| HIGH | `backend/routes/nurture.js` | 522 | fetch() without res.ok check before .json() | `const tokenRes = await fetch('https://login.microsoftonline.com/common/oauth2/v2` |
| HIGH | `backend/routes/settings.js` | 375 | JSON.parse without try/catch | `const currentMeta = typeof existing.metadata === 'string' ? JSON.parse(existing.` |
| HIGH | `backend/routes/signals.js` | 166 | JSON.parse without try/catch | `if (m) email = JSON.parse(m[0]);` |
| HIGH | `backend/routes/signals.js` | 351 | JSON.parse without try/catch | `if (m) sequence = JSON.parse(m[0]);` |
| HIGH | `backend/routes/stats.js` | 23 | fetch() without res.ok check before .json() | `const resp = await fetch(url, options);` |
| HIGH | `backend/routes/team-campaigns.js` | 136 | JSON.parse without try/catch | `if (m) sampleEmail = JSON.parse(m[0]);` |
| MEDIUM | `backend/routes/team-campaigns.js` | 202 | Empty catch block (swallowed error) | `if (m) { try { email = JSON.parse(m[0]); } catch { /* malformed AI response */ }` |
| HIGH | `backend/lib/ab-memory.js` | 187 | JSON.parse without try/catch | `const data = typeof top.data === 'string' ? JSON.parse(top.data) : (top.data \|\` |
| MEDIUM | `backend/lib/agent-chains.js` | 338 | Empty catch block (swallowed error) | `} catch { /* no product lines */ }` |
| MEDIUM | `backend/lib/agent-chains.js` | 360 | Empty catch block (swallowed error) | `} catch { /* ok */ }` |
| MEDIUM | `backend/lib/agents/signal-agent.js` | 125 | Empty catch block (swallowed error) | `} catch { /* enrichment is optional */ }` |
| MEDIUM | `backend/lib/agents/signal-agent.js` | 181 | Empty catch block (swallowed error) | `} catch { /* notifications are optional */ }` |
| MEDIUM | `backend/lib/agents/signal-agent.js` | 206 | Empty catch block (swallowed error) | `} catch { /* skip duplicates */ }` |
| MEDIUM | `backend/lib/agents/signal-agent.js` | 212 | Empty catch block (swallowed error) | `} catch { /* auto-prospecting is optional */ }` |
| HIGH | `backend/lib/agents/signal-agent.js` | 289 | fetch() without res.ok check before .json() | `const res = await fetch('https://api.apollo.io/v1/mixed_people/search', {` |
| MEDIUM | `backend/lib/agents/timing-agent.js` | 99 | new Date() on potentially null value without guard | `const replied = new Date(r.replied_at).getTime();` |
| MEDIUM | `backend/lib/agents/timing-agent.js` | 163 | new Date() on potentially null value without guard | `const sent = new Date(r.sent_at).getTime();` |
| MEDIUM | `backend/lib/agents/timing-agent.js` | 164 | new Date() on potentially null value without guard | `const resp = new Date(r.response_at).getTime();` |
| MEDIUM | `backend/lib/churn-scoring.js` | 85 | new Date() on potentially null value without guard | `const age = (now - new Date(e.created_at).getTime()) / DAY_MS;` |
| MEDIUM | `backend/lib/conversation-autopilot.js` | 190 | Empty catch block (swallowed error) | `try { return JSON.parse(match[0]); } catch { /* fallthrough */ }` |
| MEDIUM | `backend/lib/conversation-autopilot.js` | 319 | new Date() on potentially null value without guard | `return history.sort((a, b) => new Date(a.date) - new Date(b.date));` |
| MEDIUM | `backend/lib/crm-agent.js` | 62 | Empty catch block (swallowed error) | `} catch { /* solo user, no team */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 177 | Empty catch block (swallowed error) | `} catch { /* ok */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 205 | Empty catch block (swallowed error) | `} catch { /* notification is non-blocking */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 283 | Empty catch block (swallowed error) | `} catch { /* owner mapping is optional */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 350 | Empty catch block (swallowed error) | `} catch { /* mapping is optional */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 379 | Empty catch block (swallowed error) | `} catch { /* deal sync is optional */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 548 | Empty catch block (swallowed error) | `} catch { /* fallback to 50/50 */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 637 | Empty catch block (swallowed error) | `} catch { /* patterns optional */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 677 | Empty catch block (swallowed error) | `} catch { /* fallback to single */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 694 | Empty catch block (swallowed error) | `} catch { /* fallback below */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 772 | new Date() on potentially null value without guard | `.map(o => (new Date(o.updated_at).getTime() - new Date(o.created_at).getTime()) ` |
| MEDIUM | `backend/lib/crm-agent.js` | 794 | new Date() on potentially null value without guard | `.map(o => (new Date(o.updated_at).getTime() - new Date(o.created_at).getTime()) ` |
| MEDIUM | `backend/lib/crm-agent.js` | 864 | Empty catch block (swallowed error) | `} catch { /* optional */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 893 | Empty catch block (swallowed error) | `} catch { /* optional */ }` |
| MEDIUM | `backend/lib/crm-bidirectional-sync.js` | 84 | new Date() on potentially null value without guard | `const lastPush = opp.score_pushed_at ? new Date(opp.score_pushed_at).getTime() :` |
| MEDIUM | `backend/lib/crm-bidirectional-sync.js` | 93 | Empty catch block (swallowed error) | `} catch { /* ignore individual push errors */ }` |
| HIGH | `backend/lib/crm-export.js` | 23 | fetch() without res.ok check before .json() | `const res = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {` |
| HIGH | `backend/lib/crm-export.js` | 51 | fetch() without res.ok check before .json() | `const res = await fetch(`${instanceUrl}/services/data/v62.0/sobjects/Contact`, {` |
| HIGH | `backend/lib/crm-export.js` | 76 | fetch() without res.ok check before .json() | `const res = await fetch(`https://api.pipedrive.com/v1/persons?api_token=${apiKey` |
| HIGH | `backend/lib/crm-export.js` | 90 | fetch() without res.ok check before .json() | `await fetch(`https://api.pipedrive.com/v1/notes?api_token=${apiKey}`, {` |
| MEDIUM | `backend/lib/crm-owner-resolver.js` | 32 | Empty catch block (swallowed error) | `} catch { /* no team = solo user */ }` |
| MEDIUM | `backend/lib/deliverability-agent.js` | 200 | Empty catch block (swallowed error) | `} catch { /* notification is best-effort */ }` |
| HIGH | `backend/lib/email-outbound.js` | 117 | fetch() without res.ok check before .json() | `const res = await fetch(tokenUrl, {` |
| HIGH | `backend/lib/email.js` | 16 | fetch() without res.ok check before .json() | `const res = await fetch('https://api.resend.com/emails', {` |
| MEDIUM | `backend/lib/enrich-agent.js` | 210 | Empty catch block (swallowed error) | `} catch { /* Brave search failed */ }` |
| HIGH | `backend/lib/enrich-agent.js` | 241 | JSON.parse without try/catch | `return JSON.parse(match[0]);` |
| MEDIUM | `backend/lib/enrich-agent.js` | 336 | Empty catch block (swallowed error) | `} catch { /* verification failed, keep the email */ }` |
| MEDIUM | `backend/lib/enrich-agent.js` | 375 | Empty catch block (swallowed error) | `} catch { /* continue */ }` |
| HIGH | `backend/lib/enrich-agent.js` | 411 | JSON.parse without try/catch | `const parsed = JSON.parse(match[0]);` |
| HIGH | `backend/lib/icp-agent.js` | 170 | JSON.parse without try/catch | `const data = typeof userIcp.data === 'string' ? JSON.parse(userIcp.data) : userI` |
| HIGH | `backend/lib/lifecycle-emails.js` | 188 | JSON.parse without try/catch | `const userData = (typeof user.data === 'string' ? JSON.parse(user.data) : user.d` |
| MEDIUM | `backend/lib/lifecycle-emails.js` | 190 | new Date() on potentially null value without guard | `const daysSinceSignup = Math.floor((Date.now() - new Date(user.created_at).getTi` |
| HIGH | `backend/lib/lifecycle-emails.js` | 240 | JSON.parse without try/catch | `const userData = (typeof user.data === 'string' ? JSON.parse(user.data) : user.d` |
| MEDIUM | `backend/lib/nurture-engine.js` | 78 | new Date() on potentially null value without guard | `const dealAge = (Date.now() - new Date(deal.createdAt).getTime()) / DAY_MS;` |
| MEDIUM | `backend/lib/nurture-engine.js` | 104 | new Date() on potentially null value without guard | `const lastUpdate = c.update_time ? new Date(c.update_time).getTime() : 0;` |
| MEDIUM | `backend/lib/nurture-engine.js` | 121 | new Date() on potentially null value without guard | `const renewalTime = new Date(o.renewal_date).getTime();` |
| MEDIUM | `backend/lib/nurture-engine.js` | 276 | Empty catch block (swallowed error) | `try { return JSON.parse(jsonMatch[0]); } catch { /* fall through */ }` |
| HIGH | `backend/lib/outreach-deploy.js` | 79 | fetch() without res.ok check before .json() | `const r = await fetch('https://api.apollo.io/v1/emailer_campaigns', {` |
| HIGH | `backend/lib/outreach-deploy.js` | 124 | fetch() without res.ok check before .json() | `const r = await fetch(`https://api.instantly.ai/api/v1/campaign/step/add?api_key` |
| MEDIUM | `backend/lib/reporting-agent.js` | 143 | Empty catch block (swallowed error) | `} catch { /* ignore notification errors */ }` |
| MEDIUM | `backend/lib/response-analysis-agent.js` | 58 | new Date() on potentially null value without guard | `const sentAt = new Date(email.sent_at).getTime();` |
| MEDIUM | `backend/lib/response-analysis-agent.js` | 60 | new Date() on potentially null value without guard | `const actDate = a.dueDate ? new Date(a.dueDate).getTime() : 0;` |
| HIGH | `backend/lib/response-analysis-agent.js` | 272 | JSON.parse without try/catch | `if (match) return JSON.parse(match[0]);` |
| MEDIUM | `backend/lib/response-analysis-agent.js` | 273 | Empty catch block (swallowed error) | `} catch { /* fallback below */ }` |
| HIGH | `backend/lib/template-agent.js` | 169 | JSON.parse without try/catch | `if (match) template = JSON.parse(match[0]);` |
| HIGH | `backend/lib/vector-store.js` | 190 | fetch() without res.ok check before .json() | `const res = await fetch('https://api.voyageai.com/v1/embeddings', {` |
| HIGH | `backend/lib/web-prospect-agent.js` | 169 | JSON.parse without try/catch | `const parsed = JSON.parse(jsonMatch[0]);` |
| HIGH | `backend/api/airtable-crm.js` | 18 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/apollo.js` | 24 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/brave-search.js` | 30 | fetch() without res.ok check before .json() | `const res = await fetch(`${BASE_URL}?${params}`, {` |
| HIGH | `backend/api/folk.js` | 15 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/hubspot.js` | 15 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/informz.js` | 73 | fetch() without res.ok check before .json() | `const res = await fetch(endpoint, {` |
| HIGH | `backend/api/instantly.js` | 28 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/lagrowthmachine.js` | 25 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/lemlist.js` | 15 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| MEDIUM | `backend/api/lemlist.js` | 647 | Empty catch block (swallowed error) | `} catch { /* logger optional */ }` |
| MEDIUM | `backend/api/lemlist.js` | 687 | Empty catch block (swallowed error) | `} catch { /* logger optional */ }` |
| HIGH | `backend/api/lemlist.js` | 749 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/linkedin.js` | 56 | fetch() without res.ok check before .json() | `const res = await fetch(`${VOYAGER_BASE}${endpoint}`, {` |
| HIGH | `backend/api/odoo.js` | 20 | fetch() without res.ok check before .json() | `const res = await fetch(`${url}/jsonrpc`, {` |
| HIGH | `backend/api/pipedrive.js` | 16 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/salesforce.js` | 13 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/waalaxy.js` | 25 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `frontend/src/components/AuthGate.jsx` | 214 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/forgot-password', {` |
| LOW | `frontend/src/components/FieldMappingSettings.jsx` | 47 | Hardcoded CRM provider list (may be incomplete) | `const crmProviders = ['pipedrive', 'hubspot', 'salesforce'];` |
| MEDIUM | `frontend/src/components/ICPInsightsCard.jsx` | 201 | new Date() on potentially null value without guard | `{new Date(data.analyzedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: ` |
| MEDIUM | `frontend/src/components/OnboardingChecklist.jsx` | 47 | Empty catch block (swallowed error) | `} catch { /* checklist won't show */ }` |
| MEDIUM | `frontend/src/components/TeamSettings.jsx` | 53 | Native alert()/prompt() in frontend | `alert(err.message);` |
| MEDIUM | `frontend/src/components/TeamSettings.jsx` | 74 | Native alert()/prompt() in frontend | `alert(err.message);` |
| MEDIUM | `frontend/src/components/TeamSettings.jsx` | 84 | Native alert()/prompt() in frontend | `alert(err.message);` |
| MEDIUM | `frontend/src/components/TeamSettings.jsx` | 93 | Native alert()/prompt() in frontend | `alert(err.message);` |
| HIGH | `frontend/src/components/VariableManager.jsx` | 378 | JSON.parse without try/catch | `initialRegistry ? JSON.parse(JSON.stringify(initialRegistry)) : JSON.parse(JSON.` |
| MEDIUM | `frontend/src/components/campaigns/CampaignDetailLayout.jsx` | 94 | Native alert()/prompt() in frontend | `window.alert(t('campaigns.archiveFailed', { error: err.message \|\| 'erreur inco` |
| MEDIUM | `frontend/src/components/campaigns/tabs/RepliesTab.jsx` | 125 | new Date() on potentially null value without guard | `const happenedAt = a.happened_at ? new Date(a.happened_at) : null;` |
| MEDIUM | `frontend/src/components/editor/__tests__/editor-helpers.test.js` | 14 | Native alert()/prompt() in frontend | `expect(escapeHtml('<script>alert("xss")</script>')).toBe(` |
| MEDIUM | `frontend/src/components/editor/__tests__/editor-helpers.test.js` | 15 | Native alert()/prompt() in frontend | `'&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'` |
| MEDIUM | `frontend/src/pages/CampaignsList.jsx` | 114 | Native alert()/prompt() in frontend | `window.alert(t('campaigns.errorPrefix', { message: err.message }));` |
| MEDIUM | `frontend/src/pages/CampaignsList.jsx` | 132 | Native alert()/prompt() in frontend | `window.alert(t('campaigns.errorPrefix', { message: err.message }));` |
| MEDIUM | `frontend/src/pages/CampaignsList.jsx` | 517 | new Date() on potentially null value without guard | `{en ? 'Sends at:' : 'Envoi à :'} {new Date(q.scheduled_at).toLocaleString(en ? '` |
| MEDIUM | `frontend/src/pages/CampaignsList.jsx` | 551 | new Date() on potentially null value without guard | `{en ? 'Sent:' : 'Envoyé :'} {new Date(q.sent_at).toLocaleString(en ? 'en-US' : '` |
| MEDIUM | `frontend/src/pages/ClientsPage.jsx` | 582 | Native alert()/prompt() in frontend | `const subject = prompt('Objet de l\'email :');` |
| MEDIUM | `frontend/src/pages/ClientsPage.jsx` | 584 | Native alert()/prompt() in frontend | `const body = prompt('Message :');` |
| HIGH | `frontend/src/pages/CopyEditorPage.jsx` | 805 | JSON.parse without try/catch | `const copy = { ...JSON.parse(JSON.stringify(original)), id: tpId + '-copy', labe` |
| MEDIUM | `frontend/src/pages/MembershipPage.jsx` | 136 | new Date() on potentially null value without guard | `<div style={{ fontWeight: 600 }}>{new Date(r.renewal_date).toLocaleDateString(en` |
| MEDIUM | `frontend/src/pages/MemoryExplorerPage.jsx` | 392 | new Date() on potentially null value without guard | `<span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>{e.sen` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 103 | Native alert()/prompt() in frontend | `alert((lang === 'en' ? 'Error: ' : 'Erreur: ') + err.message);` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 166 | Native alert()/prompt() in frontend | `alert((lang === 'en' ? 'Error: ' : 'Erreur: ') + err.message);` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 285 | Native alert()/prompt() in frontend | `alert((lang === 'en' ? 'Error: ' : 'Erreur: ') + err.message);` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 416 | new Date() on potentially null value without guard | `{trigger.last_run && ` \u00B7 ${lang === 'en' ? 'Last run:' : 'Dernier run :'} $` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 473 | Native alert()/prompt() in frontend | `alert((en ? 'Error: ' : 'Erreur: ') + err.message);` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 525 | new Date() on potentially null value without guard | `{email.sent_at && ` \u00B7 ${en ? 'Sent on' : 'Envoy\u00E9 le'} ${new Date(email` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 766 | new Date() on potentially null value without guard | `{e.sent_at ? new Date(e.sent_at).toLocaleDateString(en ? 'en-US' : 'fr-FR', { da` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 1015 | new Date() on potentially null value without guard | `{en ? 'by' : 'par'} {c.created_by_name} {'\u00B7'} {new Date(c.created_at).toLoc` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 1207 | new Date() on potentially null value without guard | `{en ? 'Scheduled:' : 'Planifié :'} {new Date(q.scheduled_at).toLocaleString(lang` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 1243 | new Date() on potentially null value without guard | `{en ? 'Sent:' : 'Envoyé :'} {new Date(q.sent_at).toLocaleString(lang === 'en' ? ` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 1310 | new Date() on potentially null value without guard | `{test.startedAt ? new Date(test.startedAt).toLocaleDateString(en ? 'en-US' : 'fr` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 1501 | new Date() on potentially null value without guard | `{e.to} &middot; {new Date(e.createdAt).toLocaleDateString(en ? 'en-US' : 'fr-FR'` |
| HIGH | `frontend/src/pages/ProfilePage.jsx` | 127 | fetch() without res.ok check before .json() | `const res = await fetch('/api/profile', {` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 256 | Native alert()/prompt() in frontend | `alert((en ? 'Reparse failed for all docs:\n\n' : 'Reparse a échoué pour tous les` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 260 | Native alert()/prompt() in frontend | `alert((en ? 'Error: ' : 'Erreur: ') + err.message);` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 263 | Native alert()/prompt() in frontend | `alert('Auto-fill: ' + err.message);` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 469 | new Date() on potentially null value without guard | `{new Date(doc.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: '` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 476 | Empty catch block (swallowed error) | `} catch {}` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 746 | new Date() on potentially null value without guard | `<span style={{ color: 'var(--text-muted)', fontSize: 10 }}>{new Date(doc.created` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 747 | Empty catch block (swallowed error) | `<button onClick={async () => { try { await request('/documents/' + doc.id, { met` |
| MEDIUM | `frontend/src/pages/RecosPage.jsx` | 67 | new Date() on potentially null value without guard | `date: d.created_at ? new Date(d.created_at).toLocaleDateString('fr-FR', { day: '` |
| HIGH | `frontend/src/pages/ResetPasswordPage.jsx` | 129 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/reset-password', {` |
| MEDIUM | `frontend/src/pages/SignalsPage.jsx` | 308 | new Date() on potentially null value without guard | `<span>{new Date(s.detected_at).toLocaleDateString(en ? 'en-US' : 'fr-FR', { day:` |
| MEDIUM | `frontend/src/pages/SignalsPage.jsx` | 452 | new Date() on potentially null value without guard | `{new Date(s.detected_at).toLocaleDateString(en ? 'en-US' : 'fr-FR', { day: 'nume` |
| MEDIUM | `frontend/src/pages/SignalsPage.jsx` | 585 | new Date() on potentially null value without guard | `{c.last_run && <span>{en ? 'Last scan' : 'Dernier scan'}: {new Date(c.last_run).` |
| HIGH | `frontend/src/services/api-client.js` | 23 | fetch() without res.ok check before .json() | `let res = await fetch(url, { headers, ...opts });` |
| HIGH | `frontend/src/services/api-client.js` | 31 | fetch() without res.ok check before .json() | `res = await fetch(url, { headers, ...opts });` |
| HIGH | `frontend/src/services/api-client.js` | 110 | JSON.parse without try/catch | `? (typeof c.ab_config === 'string' ? JSON.parse(c.ab_config) : c.ab_config)` |
| MEDIUM | `frontend/src/services/api-client.js` | 115 | new Date() on potentially null value without guard | `createdDate: c.created_at ? new Date(c.created_at).toLocaleDateString('fr-FR', {` |
| HIGH | `frontend/src/services/api-client.js` | 716 | fetch() without res.ok check before .json() | `const res = await fetch(url, { method: 'POST', headers, body: formData });` |
| HIGH | `frontend/src/services/auth.js` | 53 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/login', {` |
| HIGH | `frontend/src/services/auth.js` | 77 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/register', {` |
| HIGH | `frontend/src/services/auth.js` | 95 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/resend-verification', {` |
| HIGH | `frontend/src/services/auth.js` | 116 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/refresh', {` |
| HIGH | `frontend/src/services/auth.js` | 144 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/account', {` |
| HIGH | `frontend/src/services/auth.js` | 161 | fetch() without res.ok check before .json() | `await fetch('/api/auth/logout', {` |

### Automated Audit — 2026-06-26

Found 184 potential issue(s):

| Severity | File | Line | Pattern | Code |
|----------|------|------|---------|------|
| HIGH | `backend/routes/ai.js` | 438 | JSON.parse without try/catch | `const data = typeof pattern.data === 'string' ? JSON.parse(pattern.data) : (patt` |
| MEDIUM | `backend/routes/ai.js` | 439 | new Date() on potentially null value without guard | `const age = Math.round((Date.now() - new Date(pattern.date_discovered).getTime()` |
| MEDIUM | `backend/routes/ai.js` | 525 | Empty catch block (swallowed error) | `} catch { /* solo user */ }` |
| MEDIUM | `backend/routes/ai.js` | 703 | Empty catch block (swallowed error) | `try { campaignMap[cid] = await db.campaigns.get(cid); } catch {}` |
| HIGH | `backend/routes/ai.js` | 861 | JSON.parse without try/catch | `const config = typeof campaign.ab_config === 'string' ? JSON.parse(campaign.ab_c` |
| MEDIUM | `backend/routes/analytics.js` | 102 | new Date() on potentially null value without guard | `const updatedAt = opp.updated_at ? new Date(opp.updated_at).getTime() : now;` |
| MEDIUM | `backend/routes/analytics.js` | 103 | new Date() on potentially null value without guard | `const createdAt = opp.created_at ? new Date(opp.created_at).getTime() : now;` |
| MEDIUM | `backend/routes/analytics.js` | 578 | new Date() on potentially null value without guard | `const create = new Date(o.created_at).getTime();` |
| MEDIUM | `backend/routes/analytics.js` | 651 | new Date() on potentially null value without guard | `const updatedAt = opp.updated_at ? new Date(opp.updated_at).getTime() : now;` |
| MEDIUM | `backend/routes/analytics.js` | 742 | new Date() on potentially null value without guard | `const stale = activeOpps.filter(o => { const u = o.updated_at ? new Date(o.updat` |
| MEDIUM | `backend/routes/auth.js` | 270 | Empty catch block (swallowed error) | `} catch { /* no team */ }` |
| MEDIUM | `backend/routes/auth.js` | 497 | Empty catch block (swallowed error) | `} catch { /* no team — ok */ }` |
| MEDIUM | `backend/routes/campaigns.js` | 237 | new Date() on potentially null value without guard | `const lastOpt = campaign.last_optimized_at ? new Date(campaign.last_optimized_at` |
| MEDIUM | `backend/routes/chat.js` | 251 | Empty catch block (swallowed error) | `} catch { /* default to fr */ }` |
| MEDIUM | `backend/routes/chat.js` | 324 | new Date() on potentially null value without guard | `new Date(c.created_at).getTime() > sixtyAgo` |
| LOW | `backend/routes/chat.js` | 450 | Hardcoded CRM provider list (may be incomplete) | `const providers = ['pipedrive', 'hubspot', 'salesforce', 'odoo'];` |
| HIGH | `backend/routes/crm.js` | 318 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| HIGH | `backend/routes/crm.js` | 351 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| HIGH | `backend/routes/crm.js` | 367 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| HIGH | `backend/routes/crm.js` | 715 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| HIGH | `backend/routes/crm.js` | 744 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| LOW | `backend/routes/crm.js` | 1036 | Hardcoded CRM provider list (may be incomplete) | `for (const provider of ['pipedrive', 'salesforce', 'hubspot']) {` |
| MEDIUM | `backend/routes/crm.js` | 1047 | Empty catch block (swallowed error) | `} catch { /* scoring works without deals */ }` |
| HIGH | `backend/routes/crm.js` | 1356 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| HIGH | `backend/routes/crm.js` | 1370 | JSON.parse without try/catch | `const metadata = typeof integration.metadata === 'string' ? JSON.parse(integrati` |
| MEDIUM | `backend/routes/crm.js` | 1400 | Empty catch block (swallowed error) | `} catch { /* skip individual failures */ }` |
| HIGH | `backend/routes/crm.js` | 1569 | fetch() without res.ok check before .json() | `const tokenRes = await fetch('https://login.salesforce.com/services/oauth2/token` |
| HIGH | `backend/routes/crm.js` | 1714 | fetch() without res.ok check before .json() | `const tokenRes = await fetch('https://login.salesforce.com/services/oauth2/token` |
| HIGH | `backend/routes/crm.js` | 1765 | fetch() without res.ok check before .json() | `const tokenRes = await fetch('https://login.salesforce.com/services/oauth2/token` |
| MEDIUM | `backend/routes/documents.js` | 141 | Empty catch block (swallowed error) | `try { fs.unlinkSync(file.path); } catch {}` |
| MEDIUM | `backend/routes/documents.js` | 244 | Empty catch block (swallowed error) | `try { fs.unlinkSync(tempPath); } catch {}` |
| HIGH | `backend/routes/export.js` | 199 | JSON.parse without try/catch | `? JSON.parse(o.score_breakdown \|\| '{}')` |
| MEDIUM | `backend/routes/extension.js` | 62 | Empty catch block (swallowed error) | `} catch { /* optional */ }` |
| HIGH | `backend/routes/extension.js` | 102 | JSON.parse without try/catch | `const data = (typeof opp.data === 'string' ? JSON.parse(opp.data) : opp.data) \|` |
| HIGH | `backend/routes/extension.js` | 143 | JSON.parse without try/catch | `const data = (typeof opp.data === 'string' ? JSON.parse(opp.data) : opp.data) \|` |
| HIGH | `backend/routes/informz.js` | 67 | JSON.parse without try/catch | `if (m) parsed = JSON.parse(m[0]);` |
| HIGH | `backend/routes/informz.js` | 210 | JSON.parse without try/catch | `if (m) parsed = JSON.parse(m[0]);` |
| MEDIUM | `backend/routes/nurture.js` | 346 | Empty catch block (swallowed error) | `} catch { /* optional */ }` |
| MEDIUM | `backend/routes/nurture.js` | 359 | Empty catch block (swallowed error) | `if (m) { try { sampleEmail = JSON.parse(m[0]); } catch { /* malformed JSON */ } ` |
| MEDIUM | `backend/routes/nurture.js` | 361 | Empty catch block (swallowed error) | `} catch { /* skip preview generation */ }` |
| HIGH | `backend/routes/nurture.js` | 432 | fetch() without res.ok check before .json() | `const tokenRes = await fetch('https://oauth2.googleapis.com/token', {` |
| HIGH | `backend/routes/nurture.js` | 522 | fetch() without res.ok check before .json() | `const tokenRes = await fetch('https://login.microsoftonline.com/common/oauth2/v2` |
| HIGH | `backend/routes/settings.js` | 375 | JSON.parse without try/catch | `const currentMeta = typeof existing.metadata === 'string' ? JSON.parse(existing.` |
| HIGH | `backend/routes/signals.js` | 166 | JSON.parse without try/catch | `if (m) email = JSON.parse(m[0]);` |
| HIGH | `backend/routes/signals.js` | 351 | JSON.parse without try/catch | `if (m) sequence = JSON.parse(m[0]);` |
| HIGH | `backend/routes/stats.js` | 23 | fetch() without res.ok check before .json() | `const resp = await fetch(url, options);` |
| HIGH | `backend/routes/team-campaigns.js` | 136 | JSON.parse without try/catch | `if (m) sampleEmail = JSON.parse(m[0]);` |
| MEDIUM | `backend/routes/team-campaigns.js` | 202 | Empty catch block (swallowed error) | `if (m) { try { email = JSON.parse(m[0]); } catch { /* malformed AI response */ }` |
| HIGH | `backend/lib/ab-memory.js` | 187 | JSON.parse without try/catch | `const data = typeof top.data === 'string' ? JSON.parse(top.data) : (top.data \|\` |
| MEDIUM | `backend/lib/agent-chains.js` | 338 | Empty catch block (swallowed error) | `} catch { /* no product lines */ }` |
| MEDIUM | `backend/lib/agent-chains.js` | 360 | Empty catch block (swallowed error) | `} catch { /* ok */ }` |
| MEDIUM | `backend/lib/agents/signal-agent.js` | 125 | Empty catch block (swallowed error) | `} catch { /* enrichment is optional */ }` |
| MEDIUM | `backend/lib/agents/signal-agent.js` | 181 | Empty catch block (swallowed error) | `} catch { /* notifications are optional */ }` |
| MEDIUM | `backend/lib/agents/signal-agent.js` | 206 | Empty catch block (swallowed error) | `} catch { /* skip duplicates */ }` |
| MEDIUM | `backend/lib/agents/signal-agent.js` | 212 | Empty catch block (swallowed error) | `} catch { /* auto-prospecting is optional */ }` |
| HIGH | `backend/lib/agents/signal-agent.js` | 289 | fetch() without res.ok check before .json() | `const res = await fetch('https://api.apollo.io/v1/mixed_people/search', {` |
| MEDIUM | `backend/lib/agents/timing-agent.js` | 99 | new Date() on potentially null value without guard | `const replied = new Date(r.replied_at).getTime();` |
| MEDIUM | `backend/lib/agents/timing-agent.js` | 163 | new Date() on potentially null value without guard | `const sent = new Date(r.sent_at).getTime();` |
| MEDIUM | `backend/lib/agents/timing-agent.js` | 164 | new Date() on potentially null value without guard | `const resp = new Date(r.response_at).getTime();` |
| MEDIUM | `backend/lib/churn-scoring.js` | 85 | new Date() on potentially null value without guard | `const age = (now - new Date(e.created_at).getTime()) / DAY_MS;` |
| MEDIUM | `backend/lib/conversation-autopilot.js` | 190 | Empty catch block (swallowed error) | `try { return JSON.parse(match[0]); } catch { /* fallthrough */ }` |
| MEDIUM | `backend/lib/conversation-autopilot.js` | 319 | new Date() on potentially null value without guard | `return history.sort((a, b) => new Date(a.date) - new Date(b.date));` |
| MEDIUM | `backend/lib/crm-agent.js` | 62 | Empty catch block (swallowed error) | `} catch { /* solo user, no team */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 177 | Empty catch block (swallowed error) | `} catch { /* ok */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 205 | Empty catch block (swallowed error) | `} catch { /* notification is non-blocking */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 283 | Empty catch block (swallowed error) | `} catch { /* owner mapping is optional */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 350 | Empty catch block (swallowed error) | `} catch { /* mapping is optional */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 379 | Empty catch block (swallowed error) | `} catch { /* deal sync is optional */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 548 | Empty catch block (swallowed error) | `} catch { /* fallback to 50/50 */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 637 | Empty catch block (swallowed error) | `} catch { /* patterns optional */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 677 | Empty catch block (swallowed error) | `} catch { /* fallback to single */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 694 | Empty catch block (swallowed error) | `} catch { /* fallback below */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 772 | new Date() on potentially null value without guard | `.map(o => (new Date(o.updated_at).getTime() - new Date(o.created_at).getTime()) ` |
| MEDIUM | `backend/lib/crm-agent.js` | 794 | new Date() on potentially null value without guard | `.map(o => (new Date(o.updated_at).getTime() - new Date(o.created_at).getTime()) ` |
| MEDIUM | `backend/lib/crm-agent.js` | 864 | Empty catch block (swallowed error) | `} catch { /* optional */ }` |
| MEDIUM | `backend/lib/crm-agent.js` | 893 | Empty catch block (swallowed error) | `} catch { /* optional */ }` |
| MEDIUM | `backend/lib/crm-bidirectional-sync.js` | 84 | new Date() on potentially null value without guard | `const lastPush = opp.score_pushed_at ? new Date(opp.score_pushed_at).getTime() :` |
| MEDIUM | `backend/lib/crm-bidirectional-sync.js` | 93 | Empty catch block (swallowed error) | `} catch { /* ignore individual push errors */ }` |
| HIGH | `backend/lib/crm-export.js` | 23 | fetch() without res.ok check before .json() | `const res = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {` |
| HIGH | `backend/lib/crm-export.js` | 51 | fetch() without res.ok check before .json() | `const res = await fetch(`${instanceUrl}/services/data/v62.0/sobjects/Contact`, {` |
| HIGH | `backend/lib/crm-export.js` | 76 | fetch() without res.ok check before .json() | `const res = await fetch(`https://api.pipedrive.com/v1/persons?api_token=${apiKey` |
| HIGH | `backend/lib/crm-export.js` | 90 | fetch() without res.ok check before .json() | `await fetch(`https://api.pipedrive.com/v1/notes?api_token=${apiKey}`, {` |
| MEDIUM | `backend/lib/crm-owner-resolver.js` | 32 | Empty catch block (swallowed error) | `} catch { /* no team = solo user */ }` |
| MEDIUM | `backend/lib/deliverability-agent.js` | 200 | Empty catch block (swallowed error) | `} catch { /* notification is best-effort */ }` |
| HIGH | `backend/lib/email-outbound.js` | 117 | fetch() without res.ok check before .json() | `const res = await fetch(tokenUrl, {` |
| HIGH | `backend/lib/email.js` | 16 | fetch() without res.ok check before .json() | `const res = await fetch('https://api.resend.com/emails', {` |
| MEDIUM | `backend/lib/enrich-agent.js` | 210 | Empty catch block (swallowed error) | `} catch { /* Brave search failed */ }` |
| HIGH | `backend/lib/enrich-agent.js` | 241 | JSON.parse without try/catch | `return JSON.parse(match[0]);` |
| MEDIUM | `backend/lib/enrich-agent.js` | 336 | Empty catch block (swallowed error) | `} catch { /* verification failed, keep the email */ }` |
| MEDIUM | `backend/lib/enrich-agent.js` | 375 | Empty catch block (swallowed error) | `} catch { /* continue */ }` |
| HIGH | `backend/lib/enrich-agent.js` | 411 | JSON.parse without try/catch | `const parsed = JSON.parse(match[0]);` |
| HIGH | `backend/lib/icp-agent.js` | 170 | JSON.parse without try/catch | `const data = typeof userIcp.data === 'string' ? JSON.parse(userIcp.data) : userI` |
| HIGH | `backend/lib/lifecycle-emails.js` | 188 | JSON.parse without try/catch | `const userData = (typeof user.data === 'string' ? JSON.parse(user.data) : user.d` |
| MEDIUM | `backend/lib/lifecycle-emails.js` | 190 | new Date() on potentially null value without guard | `const daysSinceSignup = Math.floor((Date.now() - new Date(user.created_at).getTi` |
| HIGH | `backend/lib/lifecycle-emails.js` | 240 | JSON.parse without try/catch | `const userData = (typeof user.data === 'string' ? JSON.parse(user.data) : user.d` |
| MEDIUM | `backend/lib/nurture-engine.js` | 78 | new Date() on potentially null value without guard | `const dealAge = (Date.now() - new Date(deal.createdAt).getTime()) / DAY_MS;` |
| MEDIUM | `backend/lib/nurture-engine.js` | 104 | new Date() on potentially null value without guard | `const lastUpdate = c.update_time ? new Date(c.update_time).getTime() : 0;` |
| MEDIUM | `backend/lib/nurture-engine.js` | 121 | new Date() on potentially null value without guard | `const renewalTime = new Date(o.renewal_date).getTime();` |
| MEDIUM | `backend/lib/nurture-engine.js` | 276 | Empty catch block (swallowed error) | `try { return JSON.parse(jsonMatch[0]); } catch { /* fall through */ }` |
| HIGH | `backend/lib/outreach-deploy.js` | 79 | fetch() without res.ok check before .json() | `const r = await fetch('https://api.apollo.io/v1/emailer_campaigns', {` |
| HIGH | `backend/lib/outreach-deploy.js` | 124 | fetch() without res.ok check before .json() | `const r = await fetch(`https://api.instantly.ai/api/v1/campaign/step/add?api_key` |
| MEDIUM | `backend/lib/reporting-agent.js` | 143 | Empty catch block (swallowed error) | `} catch { /* ignore notification errors */ }` |
| MEDIUM | `backend/lib/response-analysis-agent.js` | 58 | new Date() on potentially null value without guard | `const sentAt = new Date(email.sent_at).getTime();` |
| MEDIUM | `backend/lib/response-analysis-agent.js` | 60 | new Date() on potentially null value without guard | `const actDate = a.dueDate ? new Date(a.dueDate).getTime() : 0;` |
| HIGH | `backend/lib/response-analysis-agent.js` | 272 | JSON.parse without try/catch | `if (match) return JSON.parse(match[0]);` |
| MEDIUM | `backend/lib/response-analysis-agent.js` | 273 | Empty catch block (swallowed error) | `} catch { /* fallback below */ }` |
| HIGH | `backend/lib/template-agent.js` | 169 | JSON.parse without try/catch | `if (match) template = JSON.parse(match[0]);` |
| HIGH | `backend/lib/vector-store.js` | 190 | fetch() without res.ok check before .json() | `const res = await fetch('https://api.voyageai.com/v1/embeddings', {` |
| HIGH | `backend/lib/web-prospect-agent.js` | 169 | JSON.parse without try/catch | `const parsed = JSON.parse(jsonMatch[0]);` |
| HIGH | `backend/api/airtable-crm.js` | 18 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/apollo.js` | 24 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/brave-search.js` | 30 | fetch() without res.ok check before .json() | `const res = await fetch(`${BASE_URL}?${params}`, {` |
| HIGH | `backend/api/folk.js` | 15 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/hubspot.js` | 15 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/informz.js` | 73 | fetch() without res.ok check before .json() | `const res = await fetch(endpoint, {` |
| HIGH | `backend/api/instantly.js` | 28 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/lagrowthmachine.js` | 25 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/lemlist.js` | 15 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| MEDIUM | `backend/api/lemlist.js` | 647 | Empty catch block (swallowed error) | `} catch { /* logger optional */ }` |
| MEDIUM | `backend/api/lemlist.js` | 687 | Empty catch block (swallowed error) | `} catch { /* logger optional */ }` |
| HIGH | `backend/api/lemlist.js` | 749 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/linkedin.js` | 56 | fetch() without res.ok check before .json() | `const res = await fetch(`${VOYAGER_BASE}${endpoint}`, {` |
| HIGH | `backend/api/odoo.js` | 20 | fetch() without res.ok check before .json() | `const res = await fetch(`${url}/jsonrpc`, {` |
| HIGH | `backend/api/pipedrive.js` | 16 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/salesforce.js` | 13 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `backend/api/waalaxy.js` | 25 | fetch() without res.ok check before .json() | `const res = await fetch(url, {` |
| HIGH | `frontend/src/components/AuthGate.jsx` | 214 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/forgot-password', {` |
| LOW | `frontend/src/components/FieldMappingSettings.jsx` | 47 | Hardcoded CRM provider list (may be incomplete) | `const crmProviders = ['pipedrive', 'hubspot', 'salesforce'];` |
| MEDIUM | `frontend/src/components/ICPInsightsCard.jsx` | 201 | new Date() on potentially null value without guard | `{new Date(data.analyzedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: ` |
| MEDIUM | `frontend/src/components/OnboardingChecklist.jsx` | 47 | Empty catch block (swallowed error) | `} catch { /* checklist won't show */ }` |
| MEDIUM | `frontend/src/components/TeamSettings.jsx` | 53 | Native alert()/prompt() in frontend | `alert(err.message);` |
| MEDIUM | `frontend/src/components/TeamSettings.jsx` | 74 | Native alert()/prompt() in frontend | `alert(err.message);` |
| MEDIUM | `frontend/src/components/TeamSettings.jsx` | 84 | Native alert()/prompt() in frontend | `alert(err.message);` |
| MEDIUM | `frontend/src/components/TeamSettings.jsx` | 93 | Native alert()/prompt() in frontend | `alert(err.message);` |
| HIGH | `frontend/src/components/VariableManager.jsx` | 378 | JSON.parse without try/catch | `initialRegistry ? JSON.parse(JSON.stringify(initialRegistry)) : JSON.parse(JSON.` |
| MEDIUM | `frontend/src/components/campaigns/CampaignDetailLayout.jsx` | 94 | Native alert()/prompt() in frontend | `window.alert(t('campaigns.archiveFailed', { error: err.message \|\| 'erreur inco` |
| MEDIUM | `frontend/src/components/campaigns/tabs/RepliesTab.jsx` | 125 | new Date() on potentially null value without guard | `const happenedAt = a.happened_at ? new Date(a.happened_at) : null;` |
| MEDIUM | `frontend/src/components/editor/__tests__/editor-helpers.test.js` | 14 | Native alert()/prompt() in frontend | `expect(escapeHtml('<script>alert("xss")</script>')).toBe(` |
| MEDIUM | `frontend/src/components/editor/__tests__/editor-helpers.test.js` | 15 | Native alert()/prompt() in frontend | `'&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'` |
| MEDIUM | `frontend/src/pages/CampaignsList.jsx` | 114 | Native alert()/prompt() in frontend | `window.alert(t('campaigns.errorPrefix', { message: err.message }));` |
| MEDIUM | `frontend/src/pages/CampaignsList.jsx` | 132 | Native alert()/prompt() in frontend | `window.alert(t('campaigns.errorPrefix', { message: err.message }));` |
| MEDIUM | `frontend/src/pages/CampaignsList.jsx` | 517 | new Date() on potentially null value without guard | `{en ? 'Sends at:' : 'Envoi à :'} {new Date(q.scheduled_at).toLocaleString(en ? '` |
| MEDIUM | `frontend/src/pages/CampaignsList.jsx` | 551 | new Date() on potentially null value without guard | `{en ? 'Sent:' : 'Envoyé :'} {new Date(q.sent_at).toLocaleString(en ? 'en-US' : '` |
| MEDIUM | `frontend/src/pages/ClientsPage.jsx` | 582 | Native alert()/prompt() in frontend | `const subject = prompt('Objet de l\'email :');` |
| MEDIUM | `frontend/src/pages/ClientsPage.jsx` | 584 | Native alert()/prompt() in frontend | `const body = prompt('Message :');` |
| HIGH | `frontend/src/pages/CopyEditorPage.jsx` | 805 | JSON.parse without try/catch | `const copy = { ...JSON.parse(JSON.stringify(original)), id: tpId + '-copy', labe` |
| MEDIUM | `frontend/src/pages/MembershipPage.jsx` | 136 | new Date() on potentially null value without guard | `<div style={{ fontWeight: 600 }}>{new Date(r.renewal_date).toLocaleDateString(en` |
| MEDIUM | `frontend/src/pages/MemoryExplorerPage.jsx` | 392 | new Date() on potentially null value without guard | `<span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>{e.sen` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 103 | Native alert()/prompt() in frontend | `alert((lang === 'en' ? 'Error: ' : 'Erreur: ') + err.message);` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 166 | Native alert()/prompt() in frontend | `alert((lang === 'en' ? 'Error: ' : 'Erreur: ') + err.message);` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 285 | Native alert()/prompt() in frontend | `alert((lang === 'en' ? 'Error: ' : 'Erreur: ') + err.message);` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 416 | new Date() on potentially null value without guard | `{trigger.last_run && ` \u00B7 ${lang === 'en' ? 'Last run:' : 'Dernier run :'} $` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 473 | Native alert()/prompt() in frontend | `alert((en ? 'Error: ' : 'Erreur: ') + err.message);` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 525 | new Date() on potentially null value without guard | `{email.sent_at && ` \u00B7 ${en ? 'Sent on' : 'Envoy\u00E9 le'} ${new Date(email` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 766 | new Date() on potentially null value without guard | `{e.sent_at ? new Date(e.sent_at).toLocaleDateString(en ? 'en-US' : 'fr-FR', { da` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 1015 | new Date() on potentially null value without guard | `{en ? 'by' : 'par'} {c.created_by_name} {'\u00B7'} {new Date(c.created_at).toLoc` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 1207 | new Date() on potentially null value without guard | `{en ? 'Scheduled:' : 'Planifié :'} {new Date(q.scheduled_at).toLocaleString(lang` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 1243 | new Date() on potentially null value without guard | `{en ? 'Sent:' : 'Envoyé :'} {new Date(q.sent_at).toLocaleString(lang === 'en' ? ` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 1310 | new Date() on potentially null value without guard | `{test.startedAt ? new Date(test.startedAt).toLocaleDateString(en ? 'en-US' : 'fr` |
| MEDIUM | `frontend/src/pages/NurturePage.jsx` | 1501 | new Date() on potentially null value without guard | `{e.to} &middot; {new Date(e.createdAt).toLocaleDateString(en ? 'en-US' : 'fr-FR'` |
| HIGH | `frontend/src/pages/ProfilePage.jsx` | 127 | fetch() without res.ok check before .json() | `const res = await fetch('/api/profile', {` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 256 | Native alert()/prompt() in frontend | `alert((en ? 'Reparse failed for all docs:\n\n' : 'Reparse a échoué pour tous les` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 260 | Native alert()/prompt() in frontend | `alert((en ? 'Error: ' : 'Erreur: ') + err.message);` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 263 | Native alert()/prompt() in frontend | `alert('Auto-fill: ' + err.message);` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 469 | new Date() on potentially null value without guard | `{new Date(doc.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: '` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 476 | Empty catch block (swallowed error) | `} catch {}` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 746 | new Date() on potentially null value without guard | `<span style={{ color: 'var(--text-muted)', fontSize: 10 }}>{new Date(doc.created` |
| MEDIUM | `frontend/src/pages/ProfilePage.jsx` | 747 | Empty catch block (swallowed error) | `<button onClick={async () => { try { await request('/documents/' + doc.id, { met` |
| MEDIUM | `frontend/src/pages/RecosPage.jsx` | 67 | new Date() on potentially null value without guard | `date: d.created_at ? new Date(d.created_at).toLocaleDateString('fr-FR', { day: '` |
| HIGH | `frontend/src/pages/ResetPasswordPage.jsx` | 129 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/reset-password', {` |
| MEDIUM | `frontend/src/pages/SignalsPage.jsx` | 308 | new Date() on potentially null value without guard | `<span>{new Date(s.detected_at).toLocaleDateString(en ? 'en-US' : 'fr-FR', { day:` |
| MEDIUM | `frontend/src/pages/SignalsPage.jsx` | 452 | new Date() on potentially null value without guard | `{new Date(s.detected_at).toLocaleDateString(en ? 'en-US' : 'fr-FR', { day: 'nume` |
| MEDIUM | `frontend/src/pages/SignalsPage.jsx` | 585 | new Date() on potentially null value without guard | `{c.last_run && <span>{en ? 'Last scan' : 'Dernier scan'}: {new Date(c.last_run).` |
| HIGH | `frontend/src/services/api-client.js` | 23 | fetch() without res.ok check before .json() | `let res = await fetch(url, { headers, ...opts });` |
| HIGH | `frontend/src/services/api-client.js` | 31 | fetch() without res.ok check before .json() | `res = await fetch(url, { headers, ...opts });` |
| HIGH | `frontend/src/services/api-client.js` | 110 | JSON.parse without try/catch | `? (typeof c.ab_config === 'string' ? JSON.parse(c.ab_config) : c.ab_config)` |
| MEDIUM | `frontend/src/services/api-client.js` | 115 | new Date() on potentially null value without guard | `createdDate: c.created_at ? new Date(c.created_at).toLocaleDateString('fr-FR', {` |
| HIGH | `frontend/src/services/api-client.js` | 716 | fetch() without res.ok check before .json() | `const res = await fetch(url, { method: 'POST', headers, body: formData });` |
| HIGH | `frontend/src/services/auth.js` | 53 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/login', {` |
| HIGH | `frontend/src/services/auth.js` | 77 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/register', {` |
| HIGH | `frontend/src/services/auth.js` | 95 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/resend-verification', {` |
| HIGH | `frontend/src/services/auth.js` | 116 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/refresh', {` |
| HIGH | `frontend/src/services/auth.js` | 144 | fetch() without res.ok check before .json() | `const res = await fetch('/api/auth/account', {` |
| HIGH | `frontend/src/services/auth.js` | 161 | fetch() without res.ok check before .json() | `await fetch('/api/auth/logout', {` |
