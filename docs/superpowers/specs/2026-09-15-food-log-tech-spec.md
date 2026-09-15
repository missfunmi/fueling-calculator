# Food Log + Macro Tracker — Technical Specification

**Date:** 2026-09-15
**Status:** Draft — awaiting approval
**Phase:** 1 of N
**Branch:** `feature/food-logging-macro-tracking`

---

## Architecture overview

New feature is implemented as isolated modules that hook into the existing app via `window._App` without modifying core files beyond:
- `app.js`: two small changes — register the food-log nav tab, and add the "Food" sub-tab to `renderLibrary()`
- `index.html`: include the two new script tags and the food-log view div

All other logic lives in `food-log.js` (UI layer) and `food-log-data.js` (data layer).

---

## New files

| File | Role |
|------|------|
| `food-log.js` | UI: render food log view, entry form, progress section, timeline |
| `food-log-data.js` | Data: all Supabase reads/writes for food_logs, food_library, daily_targets |
| `supabase/functions/parse-meal/index.ts` | Edge Function: AI macro parsing via Claude Haiku |
| `migrations/0005_food_log.sql` | DB migration: three new tables |

---

## Database schema

```sql
-- food_library: saved meals with per-serving macros
CREATE TABLE food_library (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL,
  name                TEXT NOT NULL,
  category            TEXT,
  protein_per_serving REAL NOT NULL DEFAULT 0,
  carbs_per_serving   REAL NOT NULL DEFAULT 0,
  fat_per_serving     REAL NOT NULL DEFAULT 0,
  calories_per_serving REAL NOT NULL DEFAULT 0,
  fiber_per_serving   REAL,      -- NULL = not tracked
  sodium_per_serving  REAL,      -- NULL = not tracked
  serving_unit        TEXT,
  created_at          TIMESTAMPTZ DEFAULT now()
);

-- food_logs: daily log entries
CREATE TABLE food_logs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL,
  logged_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  name             TEXT NOT NULL,
  category         TEXT,
  freeform_input   TEXT,
  protein          REAL NOT NULL DEFAULT 0,
  carbs            REAL NOT NULL DEFAULT 0,
  fat              REAL NOT NULL DEFAULT 0,
  calories         REAL NOT NULL DEFAULT 0,
  fiber            REAL,          -- NULL = not tracked, 0 = explicitly zero
  sodium           REAL,          -- NULL = not tracked, 0 = explicitly zero
  library_item_id  UUID REFERENCES food_library(id),
  serving_multiplier REAL DEFAULT 1.0,
  ai_estimated     BOOLEAN DEFAULT false,
  ai_notes         TEXT,
  created_at       TIMESTAMPTZ DEFAULT now()
);

-- daily_targets: one row per user, all nullable (no target = field hidden)
CREATE TABLE daily_targets (
  user_id         UUID PRIMARY KEY,
  calories_target REAL,
  protein_target  REAL,
  carbs_target    REAL,
  fat_target      REAL,
  fiber_target    REAL,
  sodium_target   REAL,
  updated_at      TIMESTAMPTZ DEFAULT now()
);
```

RLS: each table has `user_id = auth.uid()` row-level policy. Since the app uses `user_id` from localStorage rather than Supabase Auth sessions, pass `user_id` as a query parameter in all REST requests (matching the existing pattern in `data.js`).

---

## Supabase Edge Function: `parse-meal`

**File:** `supabase/functions/parse-meal/index.ts`

**Request:**
```json
POST /functions/v1/parse-meal
{
  "input": "chicken rice bowl with broccoli, probably medium portion",
  "library": [
    { "id": "...", "name": "Post-workout shake", "calories_per_serving": 280, ... }
  ]
}
```

**Response:**
```json
{
  "name": "Chicken rice bowl with broccoli",
  "protein": 38,
  "carbs": 65,
  "fat": 9,
  "calories": 490,
  "fiber": 5,
  "sodium": 620,
  "ai_estimated": true,
  "library_item_id": null,
  "serving_multiplier": 1.0,
  "confidence": "medium",
  "ai_notes": "Assumed ~150g chicken breast, ~200g cooked rice, 80g broccoli"
}
```

**Model:** `claude-haiku-4-5-20251001`

**Prompt strategy:**
- System: you are a nutrition expert; return JSON only; use the provided library items to resolve named references
- Library items injected in the system message as a JSON block
- Freeform input in the user message
- JSON schema enforced via structured output or prompt instruction
- If input matches a library item, set `library_item_id` to that item's UUID; include any serving fraction in `serving_multiplier`
- `confidence`: `high` = direct label values provided; `medium` = known meal with reasonable estimates; `low` = vague input

**Error handling:** non-200 from Claude API returns `{ error: "..." }` to the client; client shows "Could not parse — enter values manually."

---

## View routing

New nav tab: `food-log`. Added alongside existing tabs in `app.js`'s nav render and wired to `navigate('food-log')`.

Sub-views within food-log (no separate nav entries; handled internally):
- `food-log` — main log view (progress + timeline)
- `food-log-entry` — new/edit entry form (shown as modal or inline replacement)
- `food-log-targets` — daily targets settings (accessed via gear icon)

Library sub-tab added to existing `library` view. `renderLibrary()` in `app.js` gets a two-tab header: "Fuel" (existing content) and "Food" (new food library list from `food-log.js`).

---

## `food-log-data.js` — API surface

```js
FoodLogData.getTodayLogs(userId, date)          // → food_logs[] for that date
FoodLogData.saveLog(userId, entry)               // → saved food_log row
FoodLogData.updateLog(userId, id, fields)        // → updated row
FoodLogData.deleteLog(userId, id)               // → void

FoodLogData.getLibrary(userId)                   // → food_library[] sorted by name
FoodLogData.saveLibraryItem(userId, item)        // → saved row
FoodLogData.updateLibraryItem(userId, id, fields)
FoodLogData.deleteLibraryItem(userId, id)

FoodLogData.getTargets(userId)                   // → daily_targets row or null
FoodLogData.saveTargets(userId, targets)         // → upsert

FoodLogData.parseMeal(input, library)            // → calls edge function, returns parsed object
```

Pattern: same raw `fetch` to Supabase REST as `data.js`, using the same `SUPABASE_URL` / `SUPABASE_ANON_KEY` constants.

---

## `food-log.js` — View structure

### Main view: `renderFoodLog(date)`

```
┌─────────────────────────────────────────┐
│  Food Log              [⚙]             │
│  ← Aug 14   ▼ Today · Sep 15   Aug 16 → │
├─────────────────────────────────────────┤
│  Progress                               │
│  ● 1,840 / 2,200 cal  [████████░░░]    │
│  · Protein  142 / 180g [███████░░░]    │
│  · Carbs    220 / 270g [████████░░]    │
│  · Fat       54 /  70g [███████░░░]    │
│  · Fiber     28g       [████████░░]    │
│  · Sodium  1,420mg                     │  ← no target: no bar
├─────────────────────────────────────────┤
│  7:30am ─────────────────────────────  │
│       │ Oats + banana + protein powder  │
│       │ Breakfast · 540 cal · 34g pro   │
│  9:45am ─────────────────────────────  │
│       │ Espresso                        │
│       │ Snack · 10 cal · 0g pro         │
│  ...                                   │
├─────────────────────────────────────────┤
│                         [+]            │
└─────────────────────────────────────────┘
```

### Entry form: `renderFoodLogEntry(entry?)`

```
  What did you eat?
  ┌──────────────────────────────────────┐
  │ chicken rice bowl with broccoli      │
  └──────────────────────────────────────┘
  [Calculating…]  ← button state during AI call

  Estimated Macros
  ─────────────────────
  Chicken rice bowl with broccoli     [editable name]
  Protein   38 g     ← tap to edit
  Carbs     65 g
  Fat        9 g
  Calories  490 kcal
  Fiber      5 g
  Sodium   620 mg

  AI notes: Assumed ~150g chicken breast, ~200g cooked rice

  Category:  [Breakfast] [Lunch] [Dinner] [Fuel] [Snack]
  Time:       9:30 AM  [editable]

  [ ] Save to library

  [Save]   [Cancel]
```

### Targets settings: `renderFoodLogTargets()`

Simple form: one row per metric with a numeric input. "Save" upserts to `daily_targets`.

### Library food sub-tab: `renderFoodLibrary()`

Alphabetical list of `food_library` items, each with name, per-serving macros summary, and "Use" / "Edit" / "Delete" controls.

---

## Design tokens

Reuse all existing tokens from `style.css`. New macro colour tokens:

```css
--m-cal:     #1a1a2e;  /* dark navy — matches --accent */
--m-protein: #0a52a0;  /* blue — matches --blue-text */
--m-carbs:   #b45309;  /* amber-brown */
--m-fat:     #6d28d9;  /* purple */
--m-fiber:   #1a7a31;  /* green — matches --green-text */
--m-sodium:  #0e6674;  /* teal */
```

Add these to `style.css`. All other layout and component styles go in `style.css` under a `/* Food Log */` section.

---

## Modified files — minimal changes

### `index.html`

Add below existing scripts:
```html
<script src="food-log-data.js"></script>
<script src="food-log.js"></script>
```

Add hidden div for food-log view:
```html
<div id="food-log-view" class="view" hidden></div>
```

### `app.js` — two additions only

1. Register food-log in the nav tab list (1–2 lines in the tab render loop)
2. In `renderLibrary()`: wrap existing content in a "Fuel" tab pane, add "Food" sub-tab header, call `FoodLog.renderFoodLibrary()` in the Food pane

---

## Data flow: log a meal

```
User types freeform input
  → tap "Calculate"
    → food-log.js calls FoodLogData.parseMeal(input, library)
      → POST /functions/v1/parse-meal
        → Edge Function calls Claude Haiku
        → returns parsed macros JSON
      → food-log.js populates "Estimated Macros" block
  → User edits values (optional)
  → User taps "Save"
    → food-log.js assembles entry object
    → FoodLogData.saveLog(userId, entry)
      → POST /rest/v1/food_logs
    → if "Save to library" checked: FoodLogData.saveLibraryItem(userId, item)
    → navigate back to food-log view
    → renderFoodLog() refreshes progress + timeline
```

---

## Testing approach

Manual smoke tests (no test runner for UI):

1. Log a freeform meal → AI parses macros → values appear editable → save → timeline shows new entry
2. Edit a saved entry → values pre-filled → save → timeline updates
3. Delete an entry → confirmation prompt → entry removed → progress updates
4. Set daily targets → progress bars appear for set metrics, hidden for unset
5. Library: save a meal from the entry form → appears in Food library tab alphabetically
6. Library: tap "Use" → entry form pre-filled → type serving fraction → AI adjusts macros → save
7. Date nav: navigate to yesterday → different entries shown → progress reflects that day

Existing tests (`tests/data.test.js`, `tests/export.test.js`) are not affected — no changes to `data.js` or `export.js`.

---

## Implementation order

1. DB migration (`0005_food_log.sql`) — run against Supabase project
2. Edge Function (`parse-meal`) — deploy and smoke test
3. `food-log-data.js` — data layer with all CRUD functions
4. `food-log.js` — UI: main view, entry form, targets settings, library sub-tab
5. `style.css` — macro tokens + food log component styles
6. `index.html` + `app.js` minimal changes — wire up nav tab and library sub-tab
7. Manual QA against smoke test checklist above
