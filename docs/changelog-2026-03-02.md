# Changelog — 2 mars 2026

## Session: Wiring dead buttons across the SaaS mockup

**Branch:** `claude/plan-client-testing-3ypxz`
**Files changed:** `app/campaigns-detail.js`, `app/recos.js`
**Impact:** +360 lines added, 19 removed

---

## Point 2 — Campaign Detail Buttons (campaigns-detail.js)

7 dead buttons across active and prep campaign detail views are now fully functional.

### Active campaign view
| Button | Behavior |
|--------|----------|
| **Pause / Reprendre** | Toggles campaign pause state, dims the title at 50% opacity, persists to localStorage |
| **Exporter** | Downloads full campaign data (KPIs, sequence, diagnostics, history) as a `.json` file |
| **Lancer un test A/B** | Navigates to the Refinement A/B section |

### Prep campaign view
| Button | Behavior |
|--------|----------|
| **Modifier** | Opens the copy editor for the campaign |
| **Lancer la campagne** | Transitions status from prep → active, initializes KPIs to 0, re-renders as active view |

### Pre-launch recommendation
| Button | Behavior |
|--------|----------|
| **Appliquer la suggestion** | Shows "applied" confirmation badge, persists state |
| **Garder tel quel** | Animated collapse + fade-out, persists state |

---

## Point 3 — Variable Generator Buttons (vargen.js)

Already implemented — `acceptVarSuggestion()`, `editVarSuggestion()`, `dismissVarSuggestion()` were confirmed functional with full logic:
- Accept: green border animation, badge swap, registers variable into `variableRegistry.custom`
- Edit: focuses the formula editor or makes description contentEditable
- Dismiss: animated slide-out + collapse with connector removal

---

## Point 4 — A/B Test Launch Button (recos.js)

The "Lancer Variante C" button previously only swapped its own text. Now it performs real actions:

### launchVariantC()
- Inserts a new **Variant C card** after Variant B with placeholder metrics (`—`) and slide-in animation
- Updates card header → "Itération 5 · Lancé à l'instant"
- Increments the **"Variantes testées"** overview stat counter
- Adds a timestamped entry to the **learning memory timeline**
- Records a **v5 history entry** on campaign data and persists to localStorage
- Shows a toast: "Variante C déployée — 250 prospects en cours de contact"

### pauseTest() — improved
- Dims all variant cards to 40% opacity
- **Disables** launch/modify buttons while paused (not just visual)
- Highlights card border with warning color
- Full restore on resume

### New shared helpers
- `updateRefinementStats(addVariants, addTests)` — increments overview counters
- `addRefinementTimeline(icon, action, detail)` — inserts animated timeline entries
- `showRefineToast(message)` — feedback toast for refinement actions

---

## Commits

1. `af944a7` — Wire all campaign detail buttons with working handlers
2. `65f56a2` — Wire A/B test actions with real behavior beyond cosmetic updates
