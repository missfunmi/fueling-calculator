# Food Log + Macro Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a food logging and macro tracking section to the fueling calculator app — freeform AI-powered meal entry, daily progress against targets, chronological timeline, and a personal food library.

**Architecture:** Three new files (`food-log-data.js`, `food-log.js`, `migrations/0005_food_log.sql`) plus a Supabase Edge Function (`parse-meal`). The UI module hooks into the existing app via `window._App` with minimal surgical changes to `app.js` and `index.html`. No new dependencies; same vanilla-JS/raw-fetch pattern throughout.

**Tech Stack:** Vanilla JS (ES5-compatible), Supabase REST API (raw fetch), Supabase Edge Function (Deno + TypeScript), Claude Haiku for AI macro parsing.

**Spec:** `docs/superpowers/specs/2026-09-15-food-log-tech-spec.md` (PRD: `docs/superpowers/specs/2026-09-15-food-log-prd.md`, Mockup: `docs/superpowers/specs/food-log-mockup.html`)

## Global Constraints

- No build step. All JS is ES5-compatible (no arrow functions in module scope, no `const`/`let` at module level if targeting old Safari; `var` is safe).
- Supabase URL: `https://jcrmkxlzqewwqugkwlww.supabase.co`
- Supabase anon key: `sb_publishable_VArDAA7V8Gg-Xi20vj7zkw_NiidAk_Q`
- `getUserId()` reads `localStorage.getItem('fuelPlanner.userId')` — no Supabase Auth session.
- All Supabase REST requests must pass `apikey` header. No RLS for now (add later with user policy).
- Script load order: `data.js` → `export.js` → `app.js` → `food-log-data.js` → `food-log.js`
- Design tokens from `style.css`: `--bg`, `--surface`, `--surface-2`, `--text`, `--text-secondary`, `--text-tertiary`, `--border`, `--accent`, `--green`, `--green-bg`, `--green-text`, `--amber`, `--amber-bg`, `--amber-text`, `--blue-bg`, `--blue-text`, `--radius-sm`, `--radius-md`, `--radius-lg`.
- Claude model for edge function: `claude-haiku-4-5-20251001`
- `navigate(view, params)` is accessed via `window._App.navigate`; `renders` registry via `window._App.renders`.
- Dev server: `lsof -ti:8080 | xargs kill -9 2>/dev/null; npx serve . -p 8080`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `migrations/0005_food_log.sql` | Create | Three new tables: food_library, food_logs, daily_targets |
| `supabase/functions/parse-meal/index.ts` | Create | Edge Function: AI macro parsing via Claude Haiku |
| `food-log-data.js` | Create | All Supabase CRUD for food_logs, food_library, daily_targets + parseMeal() |
| `food-log.js` | Create | All UI: main view, progress, timeline, entry form, targets, food library sub-tab |
| `style.css` | Modify | Add macro colour tokens + food log component styles |
| `index.html` | Modify | Add Food Log tab button, `view-food-log` div, two new script tags, top-nav link |
| `app.js` | Modify | Add `food-log-entry` and `food-log-targets` to hideTabBar list; add library sub-tab wrapper in `renderLibrary()` |
| `tests/food-log-data.test.js` | Create | Node integration tests for the data layer |

---

## Task 1: DB Migration

**Files:**
- Create: `migrations/0005_food_log.sql`

**Interfaces:**
- Produces: tables `food_library`, `food_logs`, `daily_targets` in Supabase

- [ ] **Step 1: Write the migration file**

```sql
-- migrations/0005_food_log.sql
-- Food library: saved meals with per-serving macros
CREATE TABLE IF NOT EXISTS food_library (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL,
  name                 TEXT NOT NULL,
  category             TEXT,
  protein_per_serving  REAL NOT NULL DEFAULT 0,
  carbs_per_serving    REAL NOT NULL DEFAULT 0,
  fat_per_serving      REAL NOT NULL DEFAULT 0,
  calories_per_serving REAL NOT NULL DEFAULT 0,
  fiber_per_serving    REAL,
  sodium_per_serving   REAL,
  serving_unit         TEXT,
  created_at           TIMESTAMPTZ DEFAULT now()
);

-- Daily food log entries
CREATE TABLE IF NOT EXISTS food_logs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL,
  logged_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  name               TEXT NOT NULL,
  category           TEXT,
  freeform_input     TEXT,
  protein            REAL NOT NULL DEFAULT 0,
  carbs              REAL NOT NULL DEFAULT 0,
  fat                REAL NOT NULL DEFAULT 0,
  calories           REAL NOT NULL DEFAULT 0,
  fiber              REAL,
  sodium             REAL,
  library_item_id    UUID REFERENCES food_library(id),
  serving_multiplier REAL DEFAULT 1.0,
  ai_estimated       BOOLEAN DEFAULT false,
  ai_notes           TEXT,
  created_at         TIMESTAMPTZ DEFAULT now()
);

-- Per-user daily targets (all nullable = no target set)
CREATE TABLE IF NOT EXISTS daily_targets (
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

- [ ] **Step 2: Run the migration**

Go to [Supabase dashboard](https://supabase.com/dashboard) → project `jcrmkxlzqewwqugkwlww` → SQL Editor → paste and run the migration.

- [ ] **Step 3: Verify tables exist**

In Supabase dashboard → Table Editor: confirm `food_library`, `food_logs`, and `daily_targets` all appear with the correct columns.

- [ ] **Step 4: Commit**

```bash
git add migrations/0005_food_log.sql
git commit -m "Add food log DB migration (food_library, food_logs, daily_targets)"
```

---

## Task 2: Edge Function — AI Macro Parser

**Files:**
- Create: `supabase/functions/parse-meal/index.ts`

**Interfaces:**
- Consumes: `POST` with body `{ input: string, library: Array<{ id, name, calories_per_serving, protein_per_serving, carbs_per_serving, fat_per_serving, fiber_per_serving, sodium_per_serving, serving_unit }> }`
- Produces: `{ name, protein, carbs, fat, calories, fiber, sodium, ai_estimated, library_item_id, serving_multiplier, confidence, ai_notes }` — or `{ error: string }` on failure

- [ ] **Step 1: Create the directory**

```bash
mkdir -p supabase/functions/parse-meal
```

- [ ] **Step 2: Write the edge function**

```typescript
// supabase/functions/parse-meal/index.ts
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

interface LibraryItem {
  id: string;
  name: string;
  calories_per_serving: number;
  protein_per_serving: number;
  carbs_per_serving: number;
  fat_per_serving: number;
  fiber_per_serving: number | null;
  sodium_per_serving: number | null;
  serving_unit: string | null;
}

interface ParseResult {
  name: string;
  protein: number;
  carbs: number;
  fat: number;
  calories: number;
  fiber: number | null;
  sodium: number | null;
  ai_estimated: boolean;
  library_item_id: string | null;
  serving_multiplier: number;
  confidence: 'high' | 'medium' | 'low';
  ai_notes: string | null;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const { input, library } = await req.json() as { input: string; library: LibraryItem[] };

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

    const libraryBlock = library.length > 0
      ? '\n\nUser\'s saved food library (use these when the input references a saved item by name):\n' +
        JSON.stringify(library, null, 2)
      : '';

    const systemPrompt = `You are a nutrition expert. Given a meal description (free text, a nutrition label paste, or a reference to a saved library item), return a JSON object with the nutritional content.

Rules:
- If the input references a library item by name, use that item's data (adjusting for any serving fraction mentioned). Set library_item_id to the matching item's id and serving_multiplier to the fraction used (e.g. 0.75 for "¾").
- If the input contains explicit nutrition label values (e.g. "250 cal, 30g protein"), use those values directly and set confidence to "high" and ai_estimated to false.
- Otherwise estimate based on typical nutritional data and set ai_estimated to true.
- Round all numbers to the nearest whole number.
- fiber and sodium may be null if not known.
- ai_notes: brief note on key assumptions made (max 80 chars). null if none.

Return ONLY valid JSON matching this schema (no markdown, no explanation):
{
  "name": "string — clean meal name",
  "protein": number,
  "carbs": number,
  "fat": number,
  "calories": number,
  "fiber": number | null,
  "sodium": number | null,
  "ai_estimated": boolean,
  "library_item_id": string | null,
  "serving_multiplier": number,
  "confidence": "high" | "medium" | "low",
  "ai_notes": string | null
}${libraryBlock}`;

    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        system: systemPrompt,
        messages: [{ role: 'user', content: input }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Anthropic API error: ${response.status} ${err}`);
    }

    const data = await response.json();
    const text = data.content[0].text.trim();
    const result: ParseResult = JSON.parse(text);

    return new Response(JSON.stringify(result), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown error' }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  }
});
```

- [ ] **Step 3: Set the Anthropic API key secret in Supabase**

Go to Supabase dashboard → Edge Functions → Secrets → add `ANTHROPIC_API_KEY` with your Anthropic API key value.

- [ ] **Step 4: Deploy the edge function**

In the Supabase dashboard → Edge Functions → Deploy function from the file, or use the Supabase CLI:
```bash
# if you have supabase CLI installed:
supabase functions deploy parse-meal --project-ref jcrmkxlzqewwqugkwlww
```
Alternatively, paste the function code via the dashboard editor.

- [ ] **Step 5: Smoke test the deployed function**

Replace `YOUR_ANON_KEY` with `sb_publishable_VArDAA7V8Gg-Xi20vj7zkw_NiidAk_Q`:

```bash
curl -X POST \
  'https://jcrmkxlzqewwqugkwlww.supabase.co/functions/v1/parse-meal' \
  -H 'apikey: sb_publishable_VArDAA7V8Gg-Xi20vj7zkw_NiidAk_Q' \
  -H 'Content-Type: application/json' \
  -d '{"input": "two scrambled eggs with toast", "library": []}'
```

Expected: JSON with `calories` ~350, `protein` ~20, `ai_estimated: true`.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/parse-meal/index.ts
git commit -m "Add parse-meal edge function for AI macro parsing"
```

---

## Task 3: Data Layer

**Files:**
- Create: `food-log-data.js`
- Create: `tests/food-log-data.test.js`

**Interfaces:**
- Produces: global `FoodLogData` with methods:
  - `FoodLogData.getLogs(userId, date)` → `Promise<LogEntry[]>` — all logs for `date` (YYYY-MM-DD string)
  - `FoodLogData.saveLog(userId, entry)` → `Promise<LogEntry>`
  - `FoodLogData.updateLog(userId, id, fields)` → `Promise<LogEntry>`
  - `FoodLogData.deleteLog(userId, id)` → `Promise<void>`
  - `FoodLogData.getLibrary(userId)` → `Promise<LibraryItem[]>` (sorted by name)
  - `FoodLogData.saveLibraryItem(userId, item)` → `Promise<LibraryItem>`
  - `FoodLogData.updateLibraryItem(userId, id, fields)` → `Promise<LibraryItem>`
  - `FoodLogData.deleteLibraryItem(userId, id)` → `Promise<void>`
  - `FoodLogData.getTargets(userId)` → `Promise<Targets|null>`
  - `FoodLogData.saveTargets(userId, targets)` → `Promise<Targets>`
  - `FoodLogData.parseMeal(input, library)` → `Promise<ParseResult>`

- [ ] **Step 1: Write food-log-data.js**

```js
// food-log-data.js
(function () {
  'use strict';

  var SUPABASE_URL      = 'https://jcrmkxlzqewwqugkwlww.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_VArDAA7V8Gg-Xi20vj7zkw_NiidAk_Q';

  async function req(method, path, body, prefer) {
    var defaultPrefer = method === 'POST' ? 'return=representation' : '';
    var preferValue   = prefer !== undefined ? prefer : defaultPrefer;
    var headers = { 'apikey': SUPABASE_ANON_KEY };
    if (body)         headers['Content-Type'] = 'application/json';
    if (preferValue)  headers['Prefer'] = preferValue;
    var res = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
      method: method, headers: headers,
      body: body ? JSON.stringify(body) : undefined
    });
    var text = await res.text();
    if (!res.ok) throw new Error(res.status + ' ' + (text || res.statusText));
    if (res.status === 204 || !text) return null;
    return JSON.parse(text);
  }

  // ── Log entries ─────────────────────────────────────────────────────────────

  function rowToLog(r) {
    return {
      id: r.id, userId: r.user_id, loggedAt: r.logged_at,
      name: r.name, category: r.category || '',
      freeformInput: r.freeform_input || null,
      protein: r.protein, carbs: r.carbs, fat: r.fat, calories: r.calories,
      fiber: r.fiber, sodium: r.sodium,
      libraryItemId: r.library_item_id || null,
      servingMultiplier: r.serving_multiplier || 1,
      aiEstimated: r.ai_estimated || false,
      aiNotes: r.ai_notes || null,
      createdAt: r.created_at
    };
  }

  async function getLogs(userId, date) {
    // date: 'YYYY-MM-DD'
    var from = date + 'T00:00:00.000Z';
    var to   = date + 'T23:59:59.999Z';
    var rows = await req('GET',
      'food_logs?user_id=eq.' + encodeURIComponent(userId) +
      '&logged_at=gte.' + encodeURIComponent(from) +
      '&logged_at=lte.' + encodeURIComponent(to) +
      '&order=logged_at.desc'
    );
    return (rows || []).map(rowToLog);
  }

  async function saveLog(userId, entry) {
    var rows = await req('POST', 'food_logs', {
      user_id:           userId,
      logged_at:         entry.loggedAt || new Date().toISOString(),
      name:              entry.name,
      category:          entry.category || null,
      freeform_input:    entry.freeformInput || null,
      protein:           entry.protein || 0,
      carbs:             entry.carbs   || 0,
      fat:               entry.fat     || 0,
      calories:          entry.calories || 0,
      fiber:             entry.fiber   != null ? entry.fiber  : null,
      sodium:            entry.sodium  != null ? entry.sodium : null,
      library_item_id:   entry.libraryItemId   || null,
      serving_multiplier: entry.servingMultiplier || 1.0,
      ai_estimated:      entry.aiEstimated || false,
      ai_notes:          entry.aiNotes || null
    });
    return rowToLog(rows[0]);
  }

  async function updateLog(userId, id, fields) {
    var body = {};
    if (fields.name      !== undefined) body.name      = fields.name;
    if (fields.category  !== undefined) body.category  = fields.category;
    if (fields.loggedAt  !== undefined) body.logged_at = fields.loggedAt;
    if (fields.protein   !== undefined) body.protein   = fields.protein;
    if (fields.carbs     !== undefined) body.carbs     = fields.carbs;
    if (fields.fat       !== undefined) body.fat       = fields.fat;
    if (fields.calories  !== undefined) body.calories  = fields.calories;
    if (fields.fiber     !== undefined) body.fiber     = fields.fiber;
    if (fields.sodium    !== undefined) body.sodium    = fields.sodium;
    if (fields.aiNotes   !== undefined) body.ai_notes  = fields.aiNotes;
    if (fields.aiEstimated !== undefined) body.ai_estimated = fields.aiEstimated;
    var rows = await req('PATCH',
      'food_logs?id=eq.' + encodeURIComponent(id) + '&user_id=eq.' + encodeURIComponent(userId),
      body, 'return=representation'
    );
    return rowToLog(rows[0]);
  }

  async function deleteLog(userId, id) {
    await req('DELETE',
      'food_logs?id=eq.' + encodeURIComponent(id) + '&user_id=eq.' + encodeURIComponent(userId)
    );
  }

  // ── Food library ─────────────────────────────────────────────────────────────

  function rowToItem(r) {
    return {
      id: r.id, userId: r.user_id, name: r.name, category: r.category || '',
      proteinPerServing: r.protein_per_serving,
      carbsPerServing:   r.carbs_per_serving,
      fatPerServing:     r.fat_per_serving,
      caloriesPerServing: r.calories_per_serving,
      fiberPerServing:   r.fiber_per_serving,
      sodiumPerServing:  r.sodium_per_serving,
      servingUnit:       r.serving_unit || null,
      createdAt:         r.created_at
    };
  }

  async function getLibrary(userId) {
    var rows = await req('GET',
      'food_library?user_id=eq.' + encodeURIComponent(userId) + '&order=name.asc'
    );
    return (rows || []).map(rowToItem);
  }

  async function saveLibraryItem(userId, item) {
    var rows = await req('POST', 'food_library', {
      user_id:             userId,
      name:                item.name,
      category:            item.category || null,
      protein_per_serving: item.proteinPerServing || 0,
      carbs_per_serving:   item.carbsPerServing   || 0,
      fat_per_serving:     item.fatPerServing      || 0,
      calories_per_serving: item.caloriesPerServing || 0,
      fiber_per_serving:   item.fiberPerServing  != null ? item.fiberPerServing  : null,
      sodium_per_serving:  item.sodiumPerServing != null ? item.sodiumPerServing : null,
      serving_unit:        item.servingUnit || null
    });
    return rowToItem(rows[0]);
  }

  async function updateLibraryItem(userId, id, fields) {
    var body = {};
    if (fields.name               !== undefined) body.name                = fields.name;
    if (fields.category           !== undefined) body.category            = fields.category;
    if (fields.proteinPerServing  !== undefined) body.protein_per_serving = fields.proteinPerServing;
    if (fields.carbsPerServing    !== undefined) body.carbs_per_serving   = fields.carbsPerServing;
    if (fields.fatPerServing      !== undefined) body.fat_per_serving     = fields.fatPerServing;
    if (fields.caloriesPerServing !== undefined) body.calories_per_serving = fields.caloriesPerServing;
    if (fields.fiberPerServing    !== undefined) body.fiber_per_serving   = fields.fiberPerServing;
    if (fields.sodiumPerServing   !== undefined) body.sodium_per_serving  = fields.sodiumPerServing;
    if (fields.servingUnit        !== undefined) body.serving_unit        = fields.servingUnit;
    var rows = await req('PATCH',
      'food_library?id=eq.' + encodeURIComponent(id) + '&user_id=eq.' + encodeURIComponent(userId),
      body, 'return=representation'
    );
    return rowToItem(rows[0]);
  }

  async function deleteLibraryItem(userId, id) {
    await req('DELETE',
      'food_library?id=eq.' + encodeURIComponent(id) + '&user_id=eq.' + encodeURIComponent(userId)
    );
  }

  // ── Daily targets ────────────────────────────────────────────────────────────

  function rowToTargets(r) {
    return {
      userId:          r.user_id,
      caloriesTarget:  r.calories_target,
      proteinTarget:   r.protein_target,
      carbsTarget:     r.carbs_target,
      fatTarget:       r.fat_target,
      fiberTarget:     r.fiber_target,
      sodiumTarget:    r.sodium_target,
      updatedAt:       r.updated_at
    };
  }

  async function getTargets(userId) {
    var rows = await req('GET', 'daily_targets?user_id=eq.' + encodeURIComponent(userId));
    return rows && rows.length ? rowToTargets(rows[0]) : null;
  }

  async function saveTargets(userId, targets) {
    var rows = await req('POST', 'daily_targets', {
      user_id:         userId,
      calories_target: targets.caloriesTarget != null ? targets.caloriesTarget : null,
      protein_target:  targets.proteinTarget  != null ? targets.proteinTarget  : null,
      carbs_target:    targets.carbsTarget    != null ? targets.carbsTarget    : null,
      fat_target:      targets.fatTarget      != null ? targets.fatTarget      : null,
      fiber_target:    targets.fiberTarget    != null ? targets.fiberTarget    : null,
      sodium_target:   targets.sodiumTarget   != null ? targets.sodiumTarget   : null,
      updated_at:      new Date().toISOString()
    }, 'return=representation,resolution=merge-duplicates');
    return rowToTargets(rows[0]);
  }

  // ── AI parsing ───────────────────────────────────────────────────────────────

  async function parseMeal(input, library) {
    var res = await fetch(SUPABASE_URL + '/functions/v1/parse-meal', {
      method: 'POST',
      headers: {
        'apikey':        SUPABASE_ANON_KEY,
        'Content-Type':  'application/json'
      },
      body: JSON.stringify({ input: input, library: library || [] })
    });
    var data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'Parse failed');
    return data;
  }

  // ── Exports ──────────────────────────────────────────────────────────────────

  window.FoodLogData = {
    getLogs: getLogs, saveLog: saveLog, updateLog: updateLog, deleteLog: deleteLog,
    getLibrary: getLibrary, saveLibraryItem: saveLibraryItem,
    updateLibraryItem: updateLibraryItem, deleteLibraryItem: deleteLibraryItem,
    getTargets: getTargets, saveTargets: saveTargets,
    parseMeal: parseMeal
  };
})();
```

- [ ] **Step 2: Write the tests**

```js
// tests/food-log-data.test.js
// Run: node tests/food-log-data.test.js
// Requires: DB tables from migration 0005 to exist.
// Creates and cleans up its own rows — safe to run against the real DB.

const SUPABASE_URL      = 'https://jcrmkxlzqewwqugkwlww.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_VArDAA7V8Gg-Xi20vj7zkw_NiidAk_Q';

// Inline the fetch helper so we can test the DB layer directly without a browser.
async function req(method, path, body, prefer) {
  const defaultPrefer = method === 'POST' ? 'return=representation' : '';
  const preferValue   = prefer !== undefined ? prefer : defaultPrefer;
  const headers = { 'apikey': SUPABASE_ANON_KEY };
  if (body)        headers['Content-Type'] = 'application/json';
  if (preferValue) headers['Prefer'] = preferValue;
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    method, headers, body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  if (!res.ok) throw new Error(res.status + ' ' + (text || res.statusText));
  if (res.status === 204 || !text) return null;
  return JSON.parse(text);
}

const TEST_USER = '00000000-0000-0000-0000-000000000099'; // sentinel test user id

async function cleanup() {
  await req('DELETE', 'food_logs?user_id=eq.' + TEST_USER);
  await req('DELETE', 'food_library?user_id=eq.' + TEST_USER);
  await req('DELETE', 'daily_targets?user_id=eq.' + TEST_USER);
}

let passed = 0, failed = 0;
function assert(label, condition) {
  if (condition) { console.log('  PASS', label); passed++; }
  else { console.error('  FAIL', label); failed++; }
}

async function run() {
  await cleanup();
  console.log('\n── food_library ────────────────────────────────────');

  // Save a library item
  const [saved] = await req('POST', 'food_library', {
    user_id: TEST_USER, name: 'Test Shake',
    protein_per_serving: 25, carbs_per_serving: 10,
    fat_per_serving: 3, calories_per_serving: 167,
    fiber_per_serving: null, sodium_per_serving: null, serving_unit: 'scoop'
  });
  assert('save library item returns a row',  saved && saved.id);
  assert('name is correct',                  saved.name === 'Test Shake');
  assert('calories correct',                 saved.calories_per_serving === 167);

  // List library — should contain the saved item
  const library = await req('GET', 'food_library?user_id=eq.' + TEST_USER + '&order=name.asc');
  assert('getLibrary returns 1 item',        library.length === 1);

  // Update
  await req('PATCH', 'food_library?id=eq.' + saved.id + '&user_id=eq.' + TEST_USER,
    { name: 'Updated Shake' }, 'return=representation');
  const [updated] = await req('GET', 'food_library?id=eq.' + saved.id);
  assert('updateLibraryItem renames',        updated.name === 'Updated Shake');

  console.log('\n── food_logs ───────────────────────────────────────');

  const today = new Date().toISOString().slice(0, 10);
  const [log] = await req('POST', 'food_logs', {
    user_id: TEST_USER, logged_at: new Date().toISOString(),
    name: 'Scrambled eggs', category: 'Breakfast',
    protein: 18, carbs: 2, fat: 14, calories: 210,
    fiber: null, sodium: 340, ai_estimated: false
  });
  assert('save log returns row',             log && log.id);
  assert('log name correct',                 log.name === 'Scrambled eggs');
  assert('sodium stored',                    log.sodium === 340);

  const from = today + 'T00:00:00.000Z';
  const to   = today + 'T23:59:59.999Z';
  const logs = await req('GET',
    'food_logs?user_id=eq.' + TEST_USER +
    '&logged_at=gte.' + encodeURIComponent(from) +
    '&logged_at=lte.' + encodeURIComponent(to) +
    '&order=logged_at.desc'
  );
  assert('getLogs returns today\'s entries', logs.length === 1);

  // Update
  await req('PATCH', 'food_logs?id=eq.' + log.id + '&user_id=eq.' + TEST_USER,
    { calories: 220 }, 'return=representation');
  const [updatedLog] = await req('GET', 'food_logs?id=eq.' + log.id);
  assert('updateLog updates calories',       updatedLog.calories === 220);

  // Delete
  await req('DELETE', 'food_logs?id=eq.' + log.id + '&user_id=eq.' + TEST_USER);
  const after = await req('GET', 'food_logs?id=eq.' + log.id);
  assert('deleteLog removes entry',          after.length === 0);

  console.log('\n── daily_targets ───────────────────────────────────');

  // Upsert targets
  const [targets] = await req('POST', 'daily_targets', {
    user_id: TEST_USER, calories_target: 2200, protein_target: 180,
    carbs_target: 270, fat_target: 70, fiber_target: 30, sodium_target: null,
    updated_at: new Date().toISOString()
  }, 'return=representation,resolution=merge-duplicates');
  assert('saveTargets returns row',          targets && targets.user_id === TEST_USER);
  assert('calories_target stored',           targets.calories_target === 2200);
  assert('sodium_target is null',            targets.sodium_target === null);

  // Re-upsert to update
  await req('POST', 'daily_targets', {
    user_id: TEST_USER, calories_target: 2400, protein_target: 180,
    carbs_target: 270, fat_target: 70, fiber_target: 30, sodium_target: null,
    updated_at: new Date().toISOString()
  }, 'return=representation,resolution=merge-duplicates');
  const [reread] = await req('GET', 'daily_targets?user_id=eq.' + TEST_USER);
  assert('saveTargets upserts (updates)',    reread.calories_target === 2400);

  await cleanup();
  console.log('\n────────────────────────────────────────────────────');
  console.log(passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
}

run().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Run the tests to verify they pass**

```bash
node tests/food-log-data.test.js
```

Expected: all `PASS`, exit code 0.

- [ ] **Step 4: Commit**

```bash
git add food-log-data.js tests/food-log-data.test.js
git commit -m "Add food log data layer and integration tests"
```

---

## Task 4: Styles + App Wiring

**Files:**
- Modify: `style.css` (append new section)
- Modify: `index.html` (add tab button, view div, script tags)
- Modify: `app.js` (hideTabBar list, renderLibrary sub-tabs)

**Interfaces:**
- Produces: `--m-cal`, `--m-protein`, `--m-carbs`, `--m-fat`, `--m-fiber`, `--m-sodium` CSS tokens; `view-food-log`, `view-food-log-entry`, `view-food-log-targets` divs; `renders['food-log']` hook point ready for Task 5.

- [ ] **Step 1: Add macro colour tokens and food log styles to style.css**

Append to the bottom of `style.css`:

```css
/* ── Food Log ─────────────────────────────────────────────────────────────── */

:root {
  --m-cal:     #1a1a2e;
  --m-protein: #0a52a0;
  --m-carbs:   #b45309;
  --m-fat:     #6d28d9;
  --m-fiber:   #1a7a31;
  --m-sodium:  #0e6674;
}

/* Date navigation */
.fl-date-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}
.fl-date-nav-btn {
  background: none;
  border: none;
  font-size: 20px;
  color: var(--text-secondary);
  padding: 4px 8px;
  cursor: pointer;
  border-radius: var(--radius-sm);
}
.fl-date-nav-btn:hover { background: var(--surface-2); }
.fl-date-center {
  display: flex;
  flex-direction: column;
  align-items: center;
  cursor: pointer;
  gap: 2px;
}
.fl-today-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--accent);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.fl-date-label {
  font-size: 15px;
  font-weight: 500;
  color: var(--text);
}
.fl-date-caret { font-size: 11px; color: var(--text-tertiary); }

/* Progress section */
.fl-progress {
  padding: 16px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}
.fl-cal-row {
  display: flex;
  align-items: baseline;
  gap: 4px;
  margin-bottom: 8px;
}
.fl-cal-number {
  font-size: 28px;
  font-weight: 700;
  color: var(--m-cal);
  font-variant-numeric: tabular-nums;
}
.fl-cal-target {
  font-size: 14px;
  color: var(--text-secondary);
}
.fl-cal-bar-track {
  height: 6px;
  background: var(--surface-2);
  border-radius: 3px;
  margin-bottom: 12px;
  overflow: hidden;
}
.fl-cal-bar-fill {
  height: 100%;
  border-radius: 3px;
  background: var(--m-cal);
  transition: width 0.3s;
}
.fl-macro-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 0;
}
.fl-macro-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.fl-macro-label {
  font-size: 13px;
  color: var(--text-secondary);
  width: 56px;
  flex-shrink: 0;
}
.fl-macro-bar-track {
  flex: 1;
  height: 4px;
  background: var(--surface-2);
  border-radius: 2px;
  overflow: hidden;
}
.fl-macro-bar-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.3s;
}
.fl-macro-value {
  font-size: 13px;
  color: var(--text);
  font-variant-numeric: tabular-nums;
  min-width: 72px;
  text-align: right;
}

/* Timeline */
.fl-timeline {
  padding: 16px 0;
}
.fl-timeline-entry {
  display: flex;
  gap: 0;
  padding: 0 0 16px 0;
}
.fl-time-col {
  width: 56px;
  flex-shrink: 0;
  padding-top: 2px;
  padding-right: 12px;
  text-align: right;
  position: relative;
}
.fl-time-col::after {
  content: '';
  position: absolute;
  right: 0;
  top: 8px;
  bottom: -16px;
  width: 1px;
  background: var(--border);
}
.fl-timeline-entry:last-child .fl-time-col::after { display: none; }
.fl-time-text {
  font-size: 12px;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}
.fl-entry-body {
  flex: 1;
  padding: 0 16px;
  cursor: pointer;
}
.fl-entry-name {
  font-size: 15px;
  font-weight: 500;
  color: var(--text);
  margin-bottom: 2px;
}
.fl-entry-meta {
  font-size: 13px;
  color: var(--text-secondary);
}
.fl-category-badge {
  display: inline-block;
  font-size: 11px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 4px;
  margin-right: 6px;
  background: var(--surface-2);
  color: var(--text-secondary);
}
.fl-empty-timeline {
  padding: 32px 16px;
  text-align: center;
  color: var(--text-tertiary);
  font-size: 14px;
}

/* Floating + button */
.fl-fab {
  position: fixed;
  bottom: calc(var(--tab-bar-height) + 16px);
  right: 16px;
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: var(--accent);
  color: #fff;
  border: none;
  font-size: 26px;
  line-height: 1;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0,0,0,0.2);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}

/* Entry form */
.fl-freeform-area {
  width: 100%;
  min-height: 80px;
  padding: 12px;
  font-size: 15px;
  font-family: inherit;
  border: 1.5px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface);
  color: var(--text);
  resize: vertical;
  box-sizing: border-box;
}
.fl-freeform-area:focus { outline: none; border-color: var(--accent); }
.fl-parse-btn {
  width: 100%;
  padding: 12px;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: var(--radius-md);
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  margin-top: 8px;
}
.fl-parse-btn:disabled { opacity: 0.6; cursor: default; }

/* Estimated macros block */
.fl-estimated {
  background: var(--surface);
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
  padding: 12px 16px;
  margin-top: 16px;
}
.fl-estimated-title {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-tertiary);
  margin-bottom: 10px;
}
.fl-macro-edit-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 0;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
}
.fl-macro-edit-row:last-child { border-bottom: none; }
.fl-macro-edit-label { font-size: 14px; color: var(--text-secondary); }
.fl-macro-edit-value {
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
  font-variant-numeric: tabular-nums;
  border: none;
  background: none;
  text-align: right;
  width: 80px;
  padding: 0;
  font-family: inherit;
}
.fl-macro-edit-value:focus { outline: 2px solid var(--accent); border-radius: 4px; }
.fl-ai-notes {
  font-size: 12px;
  color: var(--text-tertiary);
  font-style: italic;
  margin-top: 8px;
}

/* Category chips */
.fl-category-chips {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin: 12px 0;
}
.fl-chip {
  padding: 5px 12px;
  border-radius: 16px;
  border: 1.5px solid var(--border);
  background: var(--surface);
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
}
.fl-chip.active {
  border-color: var(--accent);
  background: var(--accent);
  color: #fff;
}

/* Save-to-library checkbox row */
.fl-save-library-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 12px 0;
  font-size: 14px;
  color: var(--text-secondary);
  cursor: pointer;
}

/* Targets form */
.fl-targets-grid {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px 16px;
  align-items: center;
  padding: 16px;
}
.fl-targets-label { font-size: 14px; color: var(--text); }
.fl-targets-input {
  width: 88px;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--text);
  font-size: 14px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.fl-targets-input:focus { outline: none; border-color: var(--accent); }

/* Library sub-tab toggle */
.fl-lib-tabs {
  display: flex;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  margin-bottom: 0;
}
.fl-lib-tab {
  flex: 1;
  padding: 10px;
  text-align: center;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-secondary);
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
}
.fl-lib-tab.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
}

/* Food library list */
.fl-lib-item {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  gap: 12px;
}
.fl-lib-item-info { flex: 1; }
.fl-lib-item-name { font-size: 15px; font-weight: 500; color: var(--text); }
.fl-lib-item-meta { font-size: 13px; color: var(--text-secondary); margin-top: 2px; }
.fl-lib-use-btn {
  padding: 5px 12px;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
```

- [ ] **Step 2: Add the food-log view divs to index.html**

After the closing `</div>` of `view-settings` (line ~247 in index.html), add:

```html
<!-- ── Food Log view ──────────────────────────────────────────── -->
<div id="view-food-log" class="view">
  <header class="app-header">
    <h1>Food Log</h1>
    <button id="btn-food-log-targets" class="btn-icon" aria-label="Targets"><i class="ti ti-settings"></i></button>
  </header>
  <div class="view-body" style="padding:0" id="food-log-body"></div>
</div>

<!-- ── Food log entry form ────────────────────────────────────── -->
<div id="view-food-log-entry" class="view">
  <header class="app-header">
    <button id="btn-fle-back" class="btn-back" aria-label="Back"><i class="ti ti-arrow-left"></i></button>
    <h1 id="fle-title">Log Meal</h1>
    <button id="btn-fle-delete" class="btn-icon btn-danger" aria-label="Delete" style="display:none"><i class="ti ti-trash"></i></button>
  </header>
  <div class="view-body" id="food-log-entry-body"></div>
</div>

<!-- ── Food log targets settings ─────────────────────────────── -->
<div id="view-food-log-targets" class="view">
  <header class="app-header">
    <button id="btn-flt-back" class="btn-back" aria-label="Back"><i class="ti ti-arrow-left"></i></button>
    <h1>Daily Targets</h1>
  </header>
  <div class="view-body" id="food-log-targets-body"></div>
</div>
```

- [ ] **Step 3: Add Food Log tab button to the tab bar and top nav in index.html**

In the `<nav class="tab-bar">` block, add after the Library button:
```html
<button class="tab-btn" data-tab-view="food-log">Food Log</button>
```

In the `<div class="top-nav-links">` block, add after the Library link:
```html
<button class="tab-btn top-nav-link" data-tab-view="food-log">Food Log</button>
```

- [ ] **Step 4: Add new script tags to index.html**

Before `</body>`, after `<script src="app.js"></script>`, add:
```html
<script src="food-log-data.js"></script>
<script src="food-log.js"></script>
```

- [ ] **Step 5: Update app.js hideTabBar list**

Find (around line 138):
```js
var hideTabBar = (view === 'detail' || view === 'create' ||
                  view === 'product-form' || view === 'landing' ||
                  view === 'claim' || view === 'recovery' || view === 'settings');
```

Change to:
```js
var hideTabBar = (view === 'detail' || view === 'create' ||
                  view === 'product-form' || view === 'landing' ||
                  view === 'claim' || view === 'recovery' || view === 'settings' ||
                  view === 'food-log-entry' || view === 'food-log-targets');
```

- [ ] **Step 6: Wrap renderLibrary() body with Fuel/Food sub-tabs**

In `app.js`, replace the start of `renderLibrary()` (the `var $body = $('library-body'); showContainerSpinner($body);` lines) to wrap the existing content in a "Fuel" tab pane and add a "Food" tab pane hook:

```js
async function renderLibrary() {
  var $body = $('library-body');

  // Sub-tab header
  $body.innerHTML =
    '<div class="fl-lib-tabs" id="lib-subtab-bar">' +
      '<button class="fl-lib-tab active" data-lib-tab="fuel">Fuel</button>' +
      '<button class="fl-lib-tab"        data-lib-tab="food">Food</button>' +
    '</div>' +
    '<div id="lib-pane-fuel"></div>' +
    '<div id="lib-pane-food" style="display:none"></div>';

  // Wire sub-tab switching
  $$('.fl-lib-tab', $body).forEach(function (btn) {
    on(btn, 'click', function () {
      $$('.fl-lib-tab', $body).forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      $('lib-pane-fuel').style.display = btn.dataset.libTab === 'fuel' ? '' : 'none';
      $('lib-pane-food').style.display = btn.dataset.libTab === 'food' ? '' : 'none';
    });
  });

  // Render food library pane (food-log.js registers this)
  if (window.FoodLog && window.FoodLog.renderFoodLibraryPane) {
    window.FoodLog.renderFoodLibraryPane($('lib-pane-food'));
  }

  // Render fuel pane (existing logic, targeting lib-pane-fuel)
  var $fuel = $('lib-pane-fuel');
  showContainerSpinner($fuel);
  // … rest of existing renderLibrary code, but targeting $fuel instead of $body …
```

> **Note for implementer:** The existing `renderLibrary` function writes into `$body`. This change adds sub-tab scaffolding first, then runs the existing logic against `$('lib-pane-fuel')` by replacing every `$body.innerHTML =` with `$fuel.innerHTML =` and every `$$(..., $body)` with `$$(..., $fuel)` within this function only.

- [ ] **Step 7: Start dev server and verify the Food Log tab appears**

```bash
lsof -ti:8080 | xargs kill -9 2>/dev/null; npx serve . -p 8080
```

Open `http://localhost:8080`. Verify:
- "Food Log" tab appears in the bottom tab bar
- Tapping it shows the `view-food-log` div (empty body for now — that's fine)
- Library sub-tabs "Fuel" and "Food" are visible when Library tab is open
- Existing Library (fuel) content still loads correctly in the "Fuel" pane

- [ ] **Step 8: Commit**

```bash
git add style.css index.html app.js
git commit -m "Add food log styles, view scaffolding, and tab wiring"
```

---

## Task 5: Main Log View — Progress + Date Nav

**Files:**
- Create: `food-log.js` (initial scaffold)

**Interfaces:**
- Consumes: `FoodLogData.getLogs(userId, date)`, `FoodLogData.getTargets(userId)` from Task 3
- Produces: `window.FoodLog.renderFoodLog()` registered as `window._App.renders['food-log']`; `window.FoodLog.renderFoodLibraryPane(el)` (stub for now)

- [ ] **Step 1: Create food-log.js with the main view scaffold**

```js
// food-log.js
(function () {
  'use strict';

  var _A = window._App; // navigate, renders, $, $$, on, escHtml

  // Module state
  var state = {
    date: todayStr(),
    logs: [],
    targets: null,
    library: []
  };

  function todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  function fmtDate(str) {
    var d = new Date(str + 'T12:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function prevDate(str) {
    var d = new Date(str + 'T12:00:00');
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  }

  function nextDate(str) {
    var d = new Date(str + 'T12:00:00');
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }

  function pct(val, target) {
    if (!target || !val) return 0;
    return Math.min(100, Math.round((val / target) * 100));
  }

  function sumLogs(logs, key) {
    return logs.reduce(function (acc, l) { return acc + (l[key] || 0); }, 0);
  }

  // ── Progress section ─────────────────────────────────────────────────────────

  function progressHTML(logs, targets) {
    var cal  = Math.round(sumLogs(logs, 'calories'));
    var pro  = Math.round(sumLogs(logs, 'protein'));
    var carb = Math.round(sumLogs(logs, 'carbs'));
    var fat  = Math.round(sumLogs(logs, 'fat'));
    var fib  = logs.some(function (l) { return l.fiber != null; })
               ? Math.round(sumLogs(logs, 'fiber')) : null;
    var sod  = logs.some(function (l) { return l.sodium != null; })
               ? Math.round(sumLogs(logs, 'sodium')) : null;

    var t = targets || {};
    var calTarget  = t.caloriesTarget;
    var proTarget  = t.proteinTarget;
    var carbTarget = t.carbsTarget;
    var fatTarget  = t.fatTarget;
    var fibTarget  = t.fiberTarget;

    function calBarHTML() {
      if (!calTarget) {
        return '<div class="fl-cal-row"><span class="fl-cal-number">' + cal + '</span>' +
               '<span class="fl-cal-target"> kcal</span></div>';
      }
      return '<div class="fl-cal-row"><span class="fl-cal-number">' + cal + '</span>' +
             '<span class="fl-cal-target"> / ' + calTarget + ' kcal</span></div>' +
             '<div class="fl-cal-bar-track"><div class="fl-cal-bar-fill" style="width:' + pct(cal, calTarget) + '%;background:var(--m-cal)"></div></div>';
    }

    function macroRowHTML(label, value, target, color, unit) {
      var valStr = value + (unit || 'g');
      if (!target) {
        return '<div class="fl-macro-row">' +
               '<span class="fl-macro-dot" style="background:' + color + '"></span>' +
               '<span class="fl-macro-label">' + label + '</span>' +
               '<span class="fl-macro-value">' + valStr + '</span>' +
               '</div>';
      }
      return '<div class="fl-macro-row">' +
             '<span class="fl-macro-dot" style="background:' + color + '"></span>' +
             '<span class="fl-macro-label">' + label + '</span>' +
             '<div class="fl-macro-bar-track"><div class="fl-macro-bar-fill" style="width:' + pct(value, target) + '%;background:' + color + '"></div></div>' +
             '<span class="fl-macro-value">' + valStr + ' / ' + target + '</span>' +
             '</div>';
    }

    var rows = [
      macroRowHTML('Protein', pro,  proTarget,  'var(--m-protein)', 'g'),
      macroRowHTML('Carbs',   carb, carbTarget, 'var(--m-carbs)',   'g'),
      macroRowHTML('Fat',     fat,  fatTarget,  'var(--m-fat)',     'g')
    ];
    if (fib !== null) rows.push(macroRowHTML('Fiber', fib, fibTarget, 'var(--m-fiber)', 'g'));
    if (sod !== null) rows.push(macroRowHTML('Sodium', sod, null, 'var(--m-sodium)', 'mg'));

    return '<div class="fl-progress">' + calBarHTML() + rows.join('') + '</div>';
  }

  // ── Date navigation ──────────────────────────────────────────────────────────

  function dateNavHTML(date) {
    var isToday = date === todayStr();
    return '<div class="fl-date-nav">' +
      '<button class="fl-date-nav-btn" id="fl-btn-prev">&#8249;</button>' +
      '<div class="fl-date-center" id="fl-btn-today">' +
        (isToday ? '<span class="fl-today-label">Today</span>' : '<span class="fl-today-label" style="color:var(--text-tertiary)">Jump to today</span>') +
        '<span class="fl-date-label">' + _A.escHtml(fmtDate(date)) + '</span>' +
        '<span class="fl-date-caret">&#9662;</span>' +
      '</div>' +
      '<button class="fl-date-nav-btn" id="fl-btn-next" ' + (isToday ? 'disabled style="opacity:0.3"' : '') + '>&#8250;</button>' +
    '</div>';
  }

  // ── Main render ──────────────────────────────────────────────────────────────

  async function renderFoodLog() {
    var $body = _A.$('food-log-body');
    $body.innerHTML = '<div style="padding:32px;text-align:center;color:var(--text-tertiary)">Loading…</div>';

    var userId = localStorage.getItem('fuelPlanner.userId');
    if (!userId) {
      $body.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-secondary)">Set up your account first.</div>';
      return;
    }

    try {
      var results = await Promise.all([
        FoodLogData.getLogs(userId, state.date),
        FoodLogData.getTargets(userId),
        FoodLogData.getLibrary(userId)
      ]);
      state.logs    = results[0];
      state.targets = results[1];
      state.library = results[2];
    } catch (e) {
      $body.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-secondary)">Couldn\'t load — check your connection.</div>';
      return;
    }

    $body.innerHTML =
      dateNavHTML(state.date) +
      progressHTML(state.logs, state.targets) +
      timelineHTML(state.logs) +
      '<button class="fl-fab" id="fl-fab">+</button>';

    // Date nav handlers
    _A.on(_A.$('fl-btn-prev'), 'click', function () {
      state.date = prevDate(state.date);
      renderFoodLog();
    });
    _A.on(_A.$('fl-btn-next'), 'click', function () {
      if (state.date < todayStr()) {
        state.date = nextDate(state.date);
        renderFoodLog();
      }
    });
    _A.on(_A.$('fl-btn-today'), 'click', function () {
      state.date = todayStr();
      renderFoodLog();
    });

    // Gear icon → targets
    _A.on(_A.$('btn-food-log-targets'), 'click', function () {
      _A.navigate('food-log-targets');
    });

    // FAB → new entry
    _A.on(_A.$('fl-fab'), 'click', function () {
      state.editingEntry = null;
      _A.navigate('food-log-entry');
    });

    // Timeline entry taps
    _A.$$('.fl-entry-body', $body).forEach(function (el) {
      _A.on(el, 'click', function () {
        var id = el.dataset.entryId;
        state.editingEntry = state.logs.filter(function (l) { return l.id === id; })[0] || null;
        _A.navigate('food-log-entry');
      });
    });
  }

  // Placeholder for timeline — implemented in Task 6
  function timelineHTML() { return '<div class="fl-timeline" id="fl-timeline"></div>'; }

  // Placeholder for food library pane — implemented in Task 9
  function renderFoodLibraryPane() {}

  // ── Register ─────────────────────────────────────────────────────────────────

  _A.renders['food-log'] = renderFoodLog;
  _A.renders['food-log-entry']   = function () {}; // stub — Task 7
  _A.renders['food-log-targets'] = function () {}; // stub — Task 8

  window.FoodLog = {
    renderFoodLog: renderFoodLog,
    renderFoodLibraryPane: renderFoodLibraryPane
  };
})();
```

- [ ] **Step 2: Start dev server and verify progress renders**

```bash
lsof -ti:8080 | xargs kill -9 2>/dev/null; npx serve . -p 8080
```

Open `http://localhost:8080`, tap Food Log tab. Verify:
- Date navigation bar renders with today's date
- Prev arrow navigates to yesterday; today label shows/hides correctly
- Progress section renders (may show 0 values if no logs yet — that's correct)
- "+ " FAB is visible in the bottom-right corner

- [ ] **Step 3: Commit**

```bash
git add food-log.js
git commit -m "Add food log main view: progress section and date navigation"
```

---

## Task 6: Timeline

**Files:**
- Modify: `food-log.js` (replace `timelineHTML` stub)

**Interfaces:**
- Consumes: `state.logs` array of `{ id, name, category, loggedAt, calories, protein, carbs, fat, fiber, sodium, aiEstimated }`
- Produces: rendered time-axis timeline HTML; tap on entry sets `state.editingEntry` and navigates to `food-log-entry`

- [ ] **Step 1: Replace the timelineHTML stub in food-log.js**

Find and replace:
```js
// Placeholder for timeline — implemented in Task 6
function timelineHTML() { return '<div class="fl-timeline" id="fl-timeline"></div>'; }
```

With:
```js
function fmtTime(isoStr) {
  var d = new Date(isoStr);
  var h = d.getHours(), m = d.getMinutes();
  var ampm = h >= 12 ? 'pm' : 'am';
  var hh = h % 12 || 12;
  return hh + ':' + (m < 10 ? '0' : '') + m + ampm;
}

function timelineHTML(logs) {
  if (!logs || !logs.length) {
    return '<div class="fl-empty-timeline">No entries yet — tap + to log a meal.</div>';
  }
  return '<div class="fl-timeline">' +
    logs.map(function (log) {
      var macroStr = Math.round(log.calories) + ' kcal';
      if (log.protein) macroStr += ' · ' + Math.round(log.protein) + 'g protein';
      return '<div class="fl-timeline-entry">' +
        '<div class="fl-time-col"><span class="fl-time-text">' + fmtTime(log.loggedAt) + '</span></div>' +
        '<div class="fl-entry-body" data-entry-id="' + log.id + '">' +
          '<div class="fl-entry-name">' + _A.escHtml(log.name) + '</div>' +
          '<div class="fl-entry-meta">' +
            '<span class="fl-category-badge">' + _A.escHtml(log.category || 'Other') + '</span>' +
            _A.escHtml(macroStr) +
            (log.aiEstimated ? ' <span style="color:var(--text-tertiary);font-size:11px">~est</span>' : '') +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('') +
  '</div>';
}
```

- [ ] **Step 2: Update the timelineHTML call inside renderFoodLog**

Find `timelineHTML(state.logs)` (should already be called correctly in step 1 of Task 5 — confirm it passes the logs argument).

- [ ] **Step 3: Verify timeline renders**

With the dev server running, navigate to yesterday (to see a date with no entries). Verify the empty state message shows. Then tap the FAB, save a test entry (once Task 7 is done). For now, test with a seeded entry directly in Supabase if desired.

- [ ] **Step 4: Commit**

```bash
git add food-log.js
git commit -m "Add food log timeline with time-axis layout"
```

---

## Task 7: Entry Form — AI Parsing + Save

**Files:**
- Modify: `food-log.js` (replace `renders['food-log-entry']` stub)

**Interfaces:**
- Consumes: `state.editingEntry` (null = new, object = edit), `state.library`, `FoodLogData.parseMeal()`, `FoodLogData.saveLog()`, `FoodLogData.updateLog()`, `FoodLogData.deleteLog()`, `FoodLogData.saveLibraryItem()`
- Produces: saves/updates/deletes a log entry; navigates back to `food-log` and calls `renderFoodLog()`

- [ ] **Step 1: Add renderFoodLogEntry to food-log.js**

Replace the stub:
```js
_A.renders['food-log-entry'] = function () {}; // stub — Task 7
```

With:
```js
_A.renders['food-log-entry'] = renderFoodLogEntry;
```

And add the function before the `// ── Register` block:

```js
// ── Entry form ───────────────────────────────────────────────────────────────

function renderFoodLogEntry() {
  var entry = state.editingEntry;
  var isEdit = !!entry;
  var $body = _A.$('food-log-entry-body');

  // Title and delete button
  _A.$('fle-title').textContent = isEdit ? 'Edit Meal' : 'Log Meal';
  var delBtn = _A.$('btn-fle-delete');
  delBtn.style.display = isEdit ? '' : 'none';

  // Form state
  var formState = {
    name:     isEdit ? entry.name      : '',
    protein:  isEdit ? entry.protein   : 0,
    carbs:    isEdit ? entry.carbs     : 0,
    fat:      isEdit ? entry.fat       : 0,
    calories: isEdit ? entry.calories  : 0,
    fiber:    isEdit ? entry.fiber     : null,
    sodium:   isEdit ? entry.sodium    : null,
    category: isEdit ? (entry.category || 'Breakfast') : 'Breakfast',
    loggedAt: isEdit ? entry.loggedAt  : new Date().toISOString(),
    aiEstimated: isEdit ? entry.aiEstimated : false,
    aiNotes:  isEdit ? entry.aiNotes   : null,
    libraryItemId: isEdit ? entry.libraryItemId : null,
    servingMultiplier: isEdit ? entry.servingMultiplier : 1.0
  };
  var parsed = isEdit; // if editing, macros already shown

  function macroEditRowHTML(label, key, unit) {
    var val = formState[key];
    var display = val != null ? Math.round(val) : '';
    return '<div class="fl-macro-edit-row">' +
      '<span class="fl-macro-edit-label">' + label + '</span>' +
      '<input class="fl-macro-edit-value" type="number" data-macro="' + key + '" value="' + display + '" placeholder="—">' +
      '<span style="font-size:12px;color:var(--text-tertiary);margin-left:4px">' + unit + '</span>' +
    '</div>';
  }

  function estimatedBlockHTML() {
    if (!parsed) return '';
    return '<div class="fl-estimated">' +
      '<div class="fl-estimated-title">Estimated Macros</div>' +
      '<div class="fl-macro-edit-row">' +
        '<span class="fl-macro-edit-label">Name</span>' +
        '<input class="fl-macro-edit-value" type="text" data-macro="name" value="' + _A.escHtml(formState.name) + '" style="width:180px">' +
      '</div>' +
      macroEditRowHTML('Calories', 'calories', 'kcal') +
      macroEditRowHTML('Protein',  'protein',  'g') +
      macroEditRowHTML('Carbs',    'carbs',    'g') +
      macroEditRowHTML('Fat',      'fat',      'g') +
      macroEditRowHTML('Fiber',    'fiber',    'g') +
      macroEditRowHTML('Sodium',   'sodium',   'mg') +
      (formState.aiNotes ? '<div class="fl-ai-notes">AI note: ' + _A.escHtml(formState.aiNotes) + '</div>' : '') +
    '</div>';
  }

  var categories = ['Breakfast', 'Lunch', 'Dinner', 'Fuel', 'Snack'];

  function categoryChipsHTML() {
    return '<div class="fl-category-chips">' +
      categories.map(function (c) {
        return '<button class="fl-chip' + (formState.category === c ? ' active' : '') + '" data-category="' + c + '">' + c + '</button>';
      }).join('') +
    '</div>';
  }

  function fmtInputTime(isoStr) {
    var d = new Date(isoStr);
    var hh = String(d.getHours()).padStart(2, '0');
    var mm = String(d.getMinutes()).padStart(2, '0');
    return hh + ':' + mm;
  }

  function render() {
    $body.innerHTML =
      '<div style="padding:16px">' +
        (!isEdit ? '<label style="display:block;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-tertiary);margin-bottom:6px">What did you eat?</label>' : '') +
        (!isEdit ? '<textarea class="fl-freeform-area" id="fl-freeform" placeholder="e.g. chicken rice bowl, 2 eggs and toast, post-workout shake ×1.5…"></textarea>' : '') +
        (!isEdit ? '<button class="fl-parse-btn" id="fl-parse-btn">Calculate</button>' : '') +
        estimatedBlockHTML() +
        '<div style="margin-top:16px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-tertiary);margin-bottom:6px">Category</div>' +
        categoryChipsHTML() +
        '<div style="margin-top:12px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-tertiary);margin-bottom:6px">Time</div>' +
        '<input id="fl-time-input" type="time" value="' + fmtInputTime(formState.loggedAt) + '" style="padding:6px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);color:var(--text);font-size:14px">' +
        (!isEdit ? '<label class="fl-save-library-row"><input type="checkbox" id="fl-save-library"> Save to library</label>' : '') +
        '<div style="display:flex;gap:8px;margin-top:24px">' +
          '<button id="fl-save-btn" class="btn-primary" style="flex:1" ' + (!parsed ? 'disabled' : '') + '>Save</button>' +
        '</div>' +
      '</div>';

    attachHandlers();
  }

  function attachHandlers() {
    // Category chips
    _A.$$('.fl-chip', $body).forEach(function (chip) {
      _A.on(chip, 'click', function () {
        formState.category = chip.dataset.category;
        _A.$$('.fl-chip', $body).forEach(function (c) { c.classList.remove('active'); });
        chip.classList.add('active');
      });
    });

    // Time input
    var timeInput = _A.$('fl-time-input');
    if (timeInput) {
      _A.on(timeInput, 'change', function () {
        var parts = timeInput.value.split(':');
        var d = new Date(formState.loggedAt);
        d.setHours(parseInt(parts[0], 10), parseInt(parts[1], 10), 0, 0);
        formState.loggedAt = d.toISOString();
      });
    }

    // Macro edit inputs
    _A.$$('[data-macro]', $body).forEach(function (input) {
      _A.on(input, 'input', function () {
        var key = input.dataset.macro;
        formState[key] = key === 'name' ? input.value : (parseFloat(input.value) || 0);
      });
    });

    // Parse button
    var parseBtn = _A.$('fl-parse-btn');
    if (parseBtn) {
      _A.on(parseBtn, 'click', async function () {
        var freeform = (_A.$('fl-freeform').value || '').trim();
        if (!freeform) return;
        parseBtn.disabled = true;
        parseBtn.textContent = 'Calculating…';
        try {
          var result = await FoodLogData.parseMeal(freeform, state.library);
          formState.name             = result.name;
          formState.protein          = result.protein;
          formState.carbs            = result.carbs;
          formState.fat              = result.fat;
          formState.calories         = result.calories;
          formState.fiber            = result.fiber;
          formState.sodium           = result.sodium;
          formState.aiEstimated      = result.ai_estimated;
          formState.aiNotes          = result.ai_notes;
          formState.libraryItemId    = result.library_item_id;
          formState.servingMultiplier = result.serving_multiplier || 1.0;
          parsed = true;
          var saveBtn = _A.$('fl-save-btn');
          if (saveBtn) saveBtn.disabled = false;
          render();
        } catch (e) {
          parseBtn.disabled = false;
          parseBtn.textContent = 'Calculate';
          var saveBtn = _A.$('fl-save-btn');
          if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Enter values manually';
          }
          // Show estimated block with zeros so user can type manually
          parsed = true;
          render();
        }
      });
    }

    // Save
    var saveBtn = _A.$('fl-save-btn');
    if (saveBtn) {
      _A.on(saveBtn, 'click', async function () {
        if (!formState.name) { alert('Please enter a name.'); return; }
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving…';
        var userId = localStorage.getItem('fuelPlanner.userId');
        try {
          if (isEdit) {
            await FoodLogData.updateLog(userId, entry.id, {
              name: formState.name, category: formState.category,
              loggedAt: formState.loggedAt,
              protein: formState.protein, carbs: formState.carbs,
              fat: formState.fat, calories: formState.calories,
              fiber: formState.fiber, sodium: formState.sodium,
              aiEstimated: formState.aiEstimated, aiNotes: formState.aiNotes
            });
          } else {
            await FoodLogData.saveLog(userId, {
              name: formState.name, category: formState.category,
              loggedAt: formState.loggedAt, freeformInput: (_A.$('fl-freeform') && _A.$('fl-freeform').value) || null,
              protein: formState.protein, carbs: formState.carbs,
              fat: formState.fat, calories: formState.calories,
              fiber: formState.fiber, sodium: formState.sodium,
              libraryItemId: formState.libraryItemId,
              servingMultiplier: formState.servingMultiplier,
              aiEstimated: formState.aiEstimated, aiNotes: formState.aiNotes
            });
            // Optionally save to library
            var saveLibCb = _A.$('fl-save-library');
            if (saveLibCb && saveLibCb.checked) {
              await FoodLogData.saveLibraryItem(userId, {
                name: formState.name, category: formState.category,
                proteinPerServing: formState.protein, carbsPerServing: formState.carbs,
                fatPerServing: formState.fat, caloriesPerServing: formState.calories,
                fiberPerServing: formState.fiber, sodiumPerServing: formState.sodium
              });
            }
          }
          state.editingEntry = null;
          _A.navigate('food-log');
        } catch (e) {
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save';
          alert('Could not save — check your connection.');
        }
      });
    }
  }

  // Delete handler (on back button of entry form)
  _A.on(_A.$('btn-fle-back'), 'click', function () {
    state.editingEntry = null;
    _A.navigate('food-log');
  });

  _A.on(_A.$('btn-fle-delete'), 'click', async function () {
    if (!confirm('Delete this entry?')) return;
    var userId = localStorage.getItem('fuelPlanner.userId');
    try {
      await FoodLogData.deleteLog(userId, entry.id);
      state.editingEntry = null;
      _A.navigate('food-log');
    } catch (e) {
      alert('Could not delete — check your connection.');
    }
  });

  render();
}
```

- [ ] **Step 2: Test the entry form manually**

With dev server running:
1. Tap Food Log → tap `+` → entry form opens
2. Type "two scrambled eggs and toast" → tap Calculate → verify macros appear in Estimated Macros block
3. Edit a macro value by tapping the field → change the number → verify it updates
4. Select a category chip → verify it highlights
5. Tap Save → verify you land back on the food log view with the new entry in the timeline

- [ ] **Step 3: Test editing**

Tap an existing entry in the timeline → verify form pre-fills with existing values → change a value → Save → verify timeline reflects the update.

- [ ] **Step 4: Test delete**

Tap an existing entry → tap the trash icon → confirm → verify entry is gone from the timeline and progress updates.

- [ ] **Step 5: Commit**

```bash
git add food-log.js
git commit -m "Add food log entry form with AI parsing, edit, and delete"
```

---

## Task 8: Targets Settings

**Files:**
- Modify: `food-log.js` (replace `renders['food-log-targets']` stub)

**Interfaces:**
- Consumes: `FoodLogData.getTargets(userId)`, `FoodLogData.saveTargets(userId, targets)`
- Produces: saves updated targets; navigates back to `food-log` and re-renders

- [ ] **Step 1: Replace the targets stub in food-log.js**

Replace:
```js
_A.renders['food-log-targets'] = function () {}; // stub — Task 8
```

With:
```js
_A.renders['food-log-targets'] = renderFoodLogTargets;
```

Add the function before the `// ── Register` block:

```js
// ── Targets settings ─────────────────────────────────────────────────────────

async function renderFoodLogTargets() {
  var $body = _A.$('food-log-targets-body');
  $body.innerHTML = '<div style="padding:32px;text-align:center;color:var(--text-tertiary)">Loading…</div>';

  var userId = localStorage.getItem('fuelPlanner.userId');
  var targets;
  try {
    targets = await FoodLogData.getTargets(userId) || {};
  } catch (e) {
    $body.innerHTML = '<div style="padding:24px;color:var(--text-secondary)">Couldn\'t load targets.</div>';
    return;
  }

  function inputRow(label, key, placeholder) {
    var val = targets[key] != null ? targets[key] : '';
    return '<div style="display:contents">' +
      '<span class="fl-targets-label">' + label + '</span>' +
      '<input class="fl-targets-input" type="number" min="0" data-key="' + key + '" value="' + val + '" placeholder="' + placeholder + '">' +
    '</div>';
  }

  $body.innerHTML =
    '<p style="padding:16px 16px 0;font-size:14px;color:var(--text-secondary)">Leave a field blank to hide its progress bar.</p>' +
    '<div class="fl-targets-grid">' +
      inputRow('Calories', 'caloriesTarget', 'kcal/day') +
      inputRow('Protein',  'proteinTarget',  'g/day') +
      inputRow('Carbs',    'carbsTarget',    'g/day') +
      inputRow('Fat',      'fatTarget',      'g/day') +
      inputRow('Fiber',    'fiberTarget',    'g/day') +
      inputRow('Sodium',   'sodiumTarget',   'mg/day') +
    '</div>' +
    '<div style="padding:16px">' +
      '<button id="fl-targets-save" class="btn-primary" style="width:100%">Save</button>' +
    '</div>';

  _A.on(_A.$('fl-targets-save'), 'click', async function () {
    var btn = _A.$('fl-targets-save');
    btn.disabled = true;
    btn.textContent = 'Saving…';

    var updated = {};
    _A.$$('[data-key]', $body).forEach(function (input) {
      var val = input.value.trim();
      updated[input.dataset.key] = val !== '' ? parseFloat(val) : null;
    });

    try {
      await FoodLogData.saveTargets(userId, updated);
      state.targets = updated;
      _A.navigate('food-log');
    } catch (e) {
      btn.disabled = false;
      btn.textContent = 'Save';
      alert('Could not save targets — check your connection.');
    }
  });

  _A.on(_A.$('btn-flt-back'), 'click', function () {
    _A.navigate('food-log');
  });
}
```

- [ ] **Step 2: Test targets settings manually**

With dev server running:
1. Tap the gear icon on the Food Log header → targets form opens
2. Enter `2200` for Calories, `180` for Protein, leave Sodium blank → Save
3. Verify you land back on Food Log and the progress bars appear for set metrics, no bar for Sodium
4. Re-open targets → verify saved values are pre-filled

- [ ] **Step 3: Commit**

```bash
git add food-log.js
git commit -m "Add daily targets settings for food log"
```

---

## Task 9: Food Library Sub-tab

**Files:**
- Modify: `food-log.js` (replace `renderFoodLibraryPane` stub)

**Interfaces:**
- Consumes: `FoodLogData.getLibrary(userId)`, `FoodLogData.deleteLibraryItem(userId, id)`; `state.editingEntry` and `_A.navigate('food-log-entry')` for the "Use" flow
- Produces: alphabetical food library list rendered into the Food pane of the Library view; Use flow pre-populates entry form

- [ ] **Step 1: Replace the renderFoodLibraryPane stub in food-log.js**

Find and replace:
```js
// Placeholder for food library pane — implemented in Task 9
function renderFoodLibraryPane() {}
```

With:

```js
async function renderFoodLibraryPane(paneEl) {
  if (!paneEl) return;
  paneEl.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-tertiary)">Loading…</div>';

  var userId = localStorage.getItem('fuelPlanner.userId');
  var items;
  try {
    items = await FoodLogData.getLibrary(userId);
  } catch (e) {
    paneEl.innerHTML = '<div style="padding:24px;color:var(--text-secondary)">Couldn\'t load food library.</div>';
    return;
  }

  var addBtn = '<button id="fl-lib-add-btn" style="margin:16px;padding:10px 16px;background:var(--accent);color:#fff;border:none;border-radius:var(--radius-md);font-size:14px;font-weight:600;cursor:pointer;width:calc(100% - 32px)">+ Add food item</button>';

  if (!items.length) {
    paneEl.innerHTML = addBtn + '<div style="padding:32px 16px;text-align:center;color:var(--text-tertiary);font-size:14px">No food items yet.</div>';
    _A.on(_A.$('fl-lib-add-btn'), 'click', function () {
      state.editingEntry = null;
      state.libraryOnlyMode = true;
      _A.navigate('food-log-entry');
    });
    return;
  }

  paneEl.innerHTML = addBtn + items.map(function (item) {
    var meta = [item.caloriesPerServing + ' kcal', item.proteinPerServing + 'g pro'];
    if (item.fiberPerServing != null) meta.push(item.fiberPerServing + 'g fiber');
    return '<div class="fl-lib-item" data-lib-id="' + item.id + '">' +
      '<div class="fl-lib-item-info">' +
        '<div class="fl-lib-item-name">' + _A.escHtml(item.name) + '</div>' +
        '<div class="fl-lib-item-meta">' + meta.join(' · ') + (item.servingUnit ? ' per ' + _A.escHtml(item.servingUnit) : '') + '</div>' +
      '</div>' +
      '<button class="fl-lib-use-btn" data-use-id="' + item.id + '">Use</button>' +
    '</div>';
  }).join('');

  _A.on(_A.$('fl-lib-add-btn'), 'click', function () {
    state.editingEntry = null;
    state.libraryOnlyMode = true;
    _A.navigate('food-log-entry');
  });

  _A.$$('.fl-lib-use-btn', paneEl).forEach(function (btn) {
    _A.on(btn, 'click', function (e) {
      e.stopPropagation();
      var id = btn.dataset.useId;
      var item = items.filter(function (i) { return i.id === id; })[0];
      if (!item) return;
      // Pre-fill entry form from library item
      state.editingEntry = null;
      state.prefillFromLibrary = {
        name: item.name, category: item.category || 'Snack',
        protein: item.proteinPerServing, carbs: item.carbsPerServing,
        fat: item.fatPerServing, calories: item.caloriesPerServing,
        fiber: item.fiberPerServing, sodium: item.sodiumPerServing,
        libraryItemId: item.id, servingMultiplier: 1.0,
        aiEstimated: false, aiNotes: null
      };
      _A.navigate('food-log-entry');
    });
  });
}
```

- [ ] **Step 2: Update renderFoodLogEntry to handle library prefill**

At the top of the `renderFoodLogEntry` function, after the `var entry = state.editingEntry;` line, add:

```js
// Pre-fill from library "Use" flow
if (!isEdit && state.prefillFromLibrary) {
  var prefill = state.prefillFromLibrary;
  state.prefillFromLibrary = null;
  // Populate formState with prefill values but show freeform so user can add a serving hint
  entry = null; isEdit = false;
  // Inject prefill values into initial formState after it's declared
}
```

Then update the `formState` initial declaration to check for the prefill:

```js
var prefill = state.prefillFromLibrary;
if (!isEdit && prefill) state.prefillFromLibrary = null;

var formState = {
  name:     isEdit ? entry.name      : (prefill ? prefill.name      : ''),
  protein:  isEdit ? entry.protein   : (prefill ? prefill.protein   : 0),
  carbs:    isEdit ? entry.carbs     : (prefill ? prefill.carbs     : 0),
  fat:      isEdit ? entry.fat       : (prefill ? prefill.fat       : 0),
  calories: isEdit ? entry.calories  : (prefill ? prefill.calories  : 0),
  fiber:    isEdit ? entry.fiber     : (prefill ? prefill.fiber     : null),
  sodium:   isEdit ? entry.sodium    : (prefill ? prefill.sodium    : null),
  category: isEdit ? (entry.category || 'Breakfast') : (prefill ? (prefill.category || 'Breakfast') : 'Breakfast'),
  loggedAt: isEdit ? entry.loggedAt  : new Date().toISOString(),
  aiEstimated: isEdit ? entry.aiEstimated : (prefill ? false : false),
  aiNotes:  isEdit ? entry.aiNotes   : null,
  libraryItemId: isEdit ? entry.libraryItemId : (prefill ? prefill.libraryItemId : null),
  servingMultiplier: isEdit ? entry.servingMultiplier : (prefill ? prefill.servingMultiplier : 1.0)
};
var parsed = isEdit || !!prefill;
```

Also add `state.libraryOnlyMode` cleanup at the top of `renderFoodLogEntry`:
```js
var libraryOnlyMode = state.libraryOnlyMode || false;
state.libraryOnlyMode = false;
```

And in the save handler, when `libraryOnlyMode` is true, save directly to `food_library` without creating a log entry:
```js
if (libraryOnlyMode) {
  await FoodLogData.saveLibraryItem(userId, {
    name: formState.name, category: formState.category,
    proteinPerServing: formState.protein, carbsPerServing: formState.carbs,
    fatPerServing: formState.fat, caloriesPerServing: formState.calories,
    fiberPerServing: formState.fiber, sodiumPerServing: formState.sodium
  });
  _A.navigate('library');
  return;
}
```

- [ ] **Step 3: Test food library manually**

1. Open Library tab → Food sub-tab → "+ Add food item" → fill in macros → Save → verify it appears in the Food library list alphabetically
2. Tap "Use" on a library item → entry form opens pre-filled with that item's macros → Save → verify timeline shows the entry
3. Tap "Use" on a library item → change the freeform description to "1.5 servings" → Calculate → verify macros scale correctly (because the AI will see the library item in the prompt)

- [ ] **Step 4: Commit**

```bash
git add food-log.js
git commit -m "Add food library sub-tab with Use flow and add-item support"
```

---

## Final Smoke Test Checklist

Run the dev server (`lsof -ti:8080 | xargs kill -9 2>/dev/null; npx serve . -p 8080`) and verify:

- [ ] Log a freeform meal → AI parses macros → values appear editable → save → timeline shows entry
- [ ] Edit a saved entry → values pre-filled → save → timeline updates
- [ ] Delete an entry → confirmation prompt → entry removed → progress totals update
- [ ] Set daily targets → progress bars appear for set metrics, hidden for unset; Sodium with no target shows value only
- [ ] Library: save a meal from entry form ("Save to library" checkbox) → appears in Food library tab alphabetically
- [ ] Library: tap "Use" → entry form pre-filled → save → timeline shows entry
- [ ] Date nav: navigate to yesterday → different entries shown, correct progress totals
- [ ] Jump to today label → returns to current date
- [ ] Existing tests still pass: `node tests/data.test.js && node tests/export.test.js`
- [ ] New data layer tests pass: `node tests/food-log-data.test.js`
