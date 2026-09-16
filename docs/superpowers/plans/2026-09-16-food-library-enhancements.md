# Food Library Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add brand names and serving sizes to the food library, unify the food library UI with the fuel library, and introduce a Build mode for logging multi-item meals.

**Architecture:** One Supabase migration adds three columns. Data-layer changes in `food-log-data.js` (pure transforms + save functions). All UI changes in `food-log.js` — the library list, food item form, and the new Build mode entry flow. New CSS classes in `style.css`.

**Tech Stack:** Vanilla JS (no build step), Supabase REST API, plain Node.js tests.

**Spec:** `docs/superpowers/specs/2026-09-16-food-library-enhancements-design.md`

## Global Constraints

- No npm install, no build step — vanilla JS only
- Branch: `feature/food-library-enhancements` off `master` (create fresh; this docs branch is not for implementation)
- One feature per branch, one PR per feature
- Run tests with `node tests/data.test.js` and `node tests/export.test.js` and `node tests/food-log-data.test.js` — all must pass before any commit
- Never label anything "AI-estimated", "(AI)", or similar in UI copy — see CLAUDE.md
- Colours for component stripes (cycle by index): `['#5b9bd5', '#e8a04b', '#6abf69', '#e8585e', '#9b7dd4', '#4bbfbf']`
- `serving_size` is always grams; no unit field
- Category stored lowercase-trimmed; displayed title-case (first letter of each word capitalised)

---

### Task 1: Migration

**Files:**
- Create: `migrations/0007_food_library_enhancements.sql`

**Interfaces:**
- Produces: `food_library.brand TEXT`, `food_library.serving_size REAL`, `food_logs.components JSONB` — consumed by every subsequent task

- [ ] **Step 1: Write the migration file**

```sql
-- migrations/0007_food_library_enhancements.sql
ALTER TABLE food_library ADD COLUMN brand        TEXT;
ALTER TABLE food_library ADD COLUMN serving_size REAL;
ALTER TABLE food_logs    ADD COLUMN components   JSONB;
```

- [ ] **Step 2: Apply the migration to Supabase**

Open the Supabase dashboard → SQL Editor → paste and run the three statements. Verify each column appears in Table Editor for `food_library` and `food_logs`.

- [ ] **Step 3: Commit**

```bash
git add migrations/0007_food_library_enhancements.sql
git commit -m "Add migration: brand, serving_size on food_library; components on food_logs"
```

---

### Task 2: Data layer — food_library read/write (brand + serving_size)

**Files:**
- Modify: `food-log-data.js`
- Create: `tests/food-log-data.test.js`

**Interfaces:**
- Consumes: migration from Task 1 (columns exist in DB)
- Produces:
  - `FoodLogData.getLibrary(userId)` → array of items, each now including `brand: string|null` and `servingSize: number|null`
  - `FoodLogData.saveLibraryItem(userId, item)` and `FoodLogData.updateLibraryItem(userId, id, fields)` accept `brand` and `servingSize`
  - `FoodLogData.scaleComponentMacros(item, amountG)` → `{protein, carbs, fat, calories, fiber, sodium}` — pure function, exported for testing

- [ ] **Step 1: Write failing tests in `tests/food-log-data.test.js`**

```js
// tests/food-log-data.test.js
'use strict';

global.window = global;
global.localStorage = (function () {
  var store = {};
  return {
    getItem:    function (k)    { return store[k] !== undefined ? store[k] : null; },
    setItem:    function (k, v) { store[k] = String(v); },
    removeItem: function (k)    { delete store[k]; },
    clear:      function ()     { store = {}; }
  };
})();

var _fetchResponses = [];
global.fetch = async function (_url, _opts) {
  var resp = _fetchResponses.shift() || { status: 200, body: '[]' };
  return {
    ok:     resp.status >= 200 && resp.status < 300,
    status: resp.status,
    text:   async function () { return resp.body !== undefined ? String(resp.body) : ''; }
  };
};
function mockFetch(responses) { _fetchResponses = responses.slice(); }

require('../food-log-data.js');
var FLD = global.window.FoodLogData;

var assert = require('assert');
var passed = 0, failed = 0;

async function test(name, fn) {
  _fetchResponses = [];
  try {
    await fn();
    console.log('  ✓ ' + name);
    passed++;
  } catch (e) {
    console.error('  ✗ ' + name + ': ' + e.message);
    failed++;
  }
}

async function run() {

  console.log('\nrowToItem — brand and servingSize');

  await test('rowToItem maps brand and serving_size', async function () {
    mockFetch([{ status: 200, body: JSON.stringify([{
      id: 'abc', user_id: 'u1', name: 'Granola', brand: 'Cascadian Farm',
      category: 'grains', protein_per_serving: 5, carbs_per_serving: 36,
      fat_per_serving: 18, calories_per_serving: 330, fiber_per_serving: 4,
      sodium_per_serving: 85, serving_size: 63, serving_unit: null, created_at: '2026-01-01'
    }]) }]);
    var items = await FLD.getLibrary('u1');
    assert.strictEqual(items[0].brand, 'Cascadian Farm');
    assert.strictEqual(items[0].servingSize, 63);
  });

  await test('rowToItem sets brand null when absent', async function () {
    mockFetch([{ status: 200, body: JSON.stringify([{
      id: 'abc', user_id: 'u1', name: 'Almonds', brand: null,
      category: null, protein_per_serving: 6, carbs_per_serving: 6,
      fat_per_serving: 14, calories_per_serving: 170, fiber_per_serving: null,
      sodium_per_serving: null, serving_size: null, serving_unit: null, created_at: '2026-01-01'
    }]) }]);
    var items = await FLD.getLibrary('u1');
    assert.strictEqual(items[0].brand, null);
    assert.strictEqual(items[0].servingSize, null);
  });

  console.log('\nscaleComponentMacros');

  await test('scales macros proportionally', function () {
    var item = {
      proteinPerServing: 16, carbsPerServing: 6, fatPerServing: 0,
      caloriesPerServing: 90, fiberPerServing: null, sodiumPerServing: 65,
      servingSize: 170
    };
    // 190g / 170g = 1.1176…
    var result = FLD.scaleComponentMacros(item, 190);
    assert.strictEqual(result.protein,  Math.round(16  * (190/170) * 10) / 10);
    assert.strictEqual(result.carbs,    Math.round(6   * (190/170) * 10) / 10);
    assert.strictEqual(result.calories, Math.round(90  * (190/170) * 10) / 10);
    assert.strictEqual(result.fiber,    null);
    assert.strictEqual(result.sodium,   Math.round(65  * (190/170) * 10) / 10);
  });

  await test('scaleComponentMacros with servingSize null uses amount as-is (ratio 1)', function () {
    var item = {
      proteinPerServing: 10, carbsPerServing: 20, fatPerServing: 5,
      caloriesPerServing: 150, fiberPerServing: 2, sodiumPerServing: null,
      servingSize: null
    };
    var result = FLD.scaleComponentMacros(item, 100);
    assert.strictEqual(result.protein,  10);
    assert.strictEqual(result.carbs,    20);
    assert.strictEqual(result.calories, 150);
    assert.strictEqual(result.fiber,    2);
    assert.strictEqual(result.sodium,   null);
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) process.exit(1);
}

run().catch(function (e) { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
node tests/food-log-data.test.js
```

Expected: errors like `TypeError: FLD.scaleComponentMacros is not a function`

- [ ] **Step 3: Update `rowToItem` in `food-log-data.js`**

Find `function rowToItem(r)` and add `brand` and `servingSize`:

```js
function rowToItem(r) {
  return {
    id: r.id, userId: r.user_id, name: r.name,
    brand:             r.brand || null,
    category:          r.category || '',
    proteinPerServing: r.protein_per_serving,
    carbsPerServing:   r.carbs_per_serving,
    fatPerServing:     r.fat_per_serving,
    caloriesPerServing: r.calories_per_serving,
    fiberPerServing:   r.fiber_per_serving,
    sodiumPerServing:  r.sodium_per_serving,
    servingSize:       r.serving_size != null ? r.serving_size : null,
    servingUnit:       r.serving_unit || null,
    createdAt:         r.created_at
  };
}
```

- [ ] **Step 4: Update `saveLibraryItem` to send brand and serving_size**

Find the `req('POST', 'food_library', {...})` call and add the two fields:

```js
brand:        item.brand        || null,
serving_size: item.servingSize  != null ? item.servingSize : null,
```

- [ ] **Step 5: Update `updateLibraryItem` to handle brand and servingSize**

In the `var body = {};` block, add:

```js
if (fields.brand       !== undefined) body.brand        = fields.brand;
if (fields.servingSize !== undefined) body.serving_size = fields.servingSize;
```

- [ ] **Step 6: Add `scaleComponentMacros` as a named exported function**

Add this function before the `// ── Exports ──` comment block:

```js
function scaleComponentMacros(item, amountG) {
  var ratio = item.servingSize ? amountG / item.servingSize : 1;
  function sc(val) { return val != null ? Math.round(val * ratio * 10) / 10 : null; }
  return {
    protein:  sc(item.proteinPerServing),
    carbs:    sc(item.carbsPerServing),
    fat:      sc(item.fatPerServing),
    calories: sc(item.caloriesPerServing),
    fiber:    sc(item.fiberPerServing),
    sodium:   sc(item.sodiumPerServing)
  };
}
```

Then add it to the `window.FoodLogData` export object:

```js
scaleComponentMacros: scaleComponentMacros
```

And at the very end of `food-log-data.js`, after the closing `})();`, add:

```js
if (typeof module !== 'undefined') module.exports = window.FoodLogData;
```

- [ ] **Step 7: Run tests — confirm they pass**

```bash
node tests/food-log-data.test.js
```

Expected: all green

- [ ] **Step 8: Run existing test suites — confirm no regressions**

```bash
node tests/data.test.js && node tests/export.test.js
```

Expected: same results as before this task

- [ ] **Step 9: Commit**

```bash
git add food-log-data.js tests/food-log-data.test.js
git commit -m "Data layer: brand + serving_size on food_library, scaleComponentMacros helper"
```

---

### Task 3: Data layer — food_logs components field

**Files:**
- Modify: `food-log-data.js`
- Modify: `tests/food-log-data.test.js`

**Interfaces:**
- Consumes: `scaleComponentMacros` from Task 2
- Produces:
  - `FoodLogData.getLogs(userId, date)` → log entries now include `components: array|null`
  - `FoodLogData.saveLog(userId, entry)` accepts `entry.components`

- [ ] **Step 1: Add failing tests for `rowToLog` components mapping**

Append to the `run()` function in `tests/food-log-data.test.js`, before the final `console.log`:

```js
console.log('\nrowToLog — components');

await test('rowToLog maps components when present', async function () {
  var fakeComponents = [
    { library_item_id: 'lib-1', name: 'Chobani yogurt', amount_g: 190,
      protein: 17.9, carbs: 6.7, fat: 0, calories: 100.6, fiber: null, sodium: 72.6 }
  ];
  mockFetch([{ status: 200, body: JSON.stringify([{
    id: 'log-1', user_id: 'u1', logged_at: '2026-09-16T07:42:00Z',
    name: 'Yogurt bowl', category: 'Breakfast',
    freeform_input: null, protein: 17.9, carbs: 6.7, fat: 0, calories: 100.6,
    fiber: null, sodium: 72.6, library_item_id: null, serving_multiplier: 1,
    ai_estimated: false, ai_notes: null, created_at: '2026-09-16T07:42:00Z',
    components: fakeComponents
  }]) }]);
  var logs = await FLD.getLogs('u1', '2026-09-16');
  assert.deepStrictEqual(logs[0].components, fakeComponents);
});

await test('rowToLog sets components null when absent', async function () {
  mockFetch([{ status: 200, body: JSON.stringify([{
    id: 'log-2', user_id: 'u1', logged_at: '2026-09-16T12:00:00Z',
    name: 'Lunch', category: 'Lunch', freeform_input: null,
    protein: 30, carbs: 45, fat: 10, calories: 380,
    fiber: null, sodium: null, library_item_id: null, serving_multiplier: 1,
    ai_estimated: false, ai_notes: null, created_at: '2026-09-16T12:00:00Z',
    components: null
  }]) }]);
  var logs = await FLD.getLogs('u1', '2026-09-16');
  assert.strictEqual(logs[0].components, null);
});
```

- [ ] **Step 2: Run tests — confirm new tests fail**

```bash
node tests/food-log-data.test.js
```

Expected: new `rowToLog` tests fail; earlier tests still pass

- [ ] **Step 3: Update `rowToLog` in `food-log-data.js`**

Find `function rowToLog(r)` and add `components`:

```js
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
    components: r.components || null,
    createdAt: r.created_at
  };
}
```

- [ ] **Step 4: Update `saveLog` to send components**

In the `req('POST', 'food_logs', {...})` body object, add:

```js
components: entry.components || null,
```

- [ ] **Step 5: Run all tests**

```bash
node tests/food-log-data.test.js && node tests/data.test.js && node tests/export.test.js
```

Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add food-log-data.js tests/food-log-data.test.js
git commit -m "Data layer: components field on food_logs"
```

---

### Task 4: CSS — new component styles

**Files:**
- Modify: `style.css`

**Interfaces:**
- Produces: class names used by Tasks 5–7:
  - `.component-row`, `.component-color` — Build mode list
  - `.component-pill`, `.component-pill-dot` — timeline entry
  - `.entry-components`, `.entry-expand` — timeline entry
  - `.mode-tabs`, `.mode-tab`, `.mode-tab.active` — Describe/Build toggle
  - `.sheet-overlay`, `.sheet`, `.sheet-handle`, `.sheet-list`, `.sheet-search`, `.sheet-confirm-btn` — picker sheet
  - `.picker-row`, `.picker-check`, `.picker-check.checked`, `.picker-info` — picker items
  - `.estimated-block`, `.estimated-title`, `.estimated-name-row`, `.estimated-name-input`, `.estimated-macros`, `.estimated-macro`, `.estimated-macro-val`, `.estimated-macro-label` — post-calculate block

- [ ] **Step 1: Append new classes to `style.css`**

Add the following block at the end of `style.css`:

```css
/* ── Food log: Build mode ───────────────────────────────────────────────────── */
.fl-mode-tabs {
  display: flex;
  background: var(--surface-2);
  border-radius: var(--radius-md);
  padding: 3px;
  margin: 10px 16px 0;
  gap: 2px;
}
.fl-mode-tab {
  flex: 1;
  padding: 7px 8px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 600;
  text-align: center;
  color: var(--text-secondary);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.fl-mode-tab.active {
  background: var(--surface);
  color: var(--text);
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
}

/* ── Build mode: component list ─────────────────────────────────────────────── */
.fl-component-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0 16px;
}
.fl-component-row {
  background: var(--surface);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.fl-component-color {
  width: 3px;
  height: 28px;
  border-radius: 2px;
  flex-shrink: 0;
}
.fl-component-info { flex: 1; min-width: 0; }
.fl-component-name {
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.fl-component-sub { font-size: 11px; color: var(--text-tertiary); margin-top: 1px; }
.fl-component-amount-wrap { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
.fl-component-amount {
  width: 56px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px 6px;
  font-size: 12px;
  text-align: right;
  color: var(--text);
}
.fl-component-unit { font-size: 11px; color: var(--text-tertiary); }
.fl-component-remove {
  font-size: 18px;
  color: var(--text-tertiary);
  flex-shrink: 0;
  padding: 0 2px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.fl-add-from-lib-btn {
  margin: 6px 16px 0;
  background: var(--accent-light);
  color: var(--accent);
  border-radius: var(--radius-sm);
  padding: 9px 12px;
  font-size: 13px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

/* ── Build mode: estimated totals ───────────────────────────────────────────── */
.fl-estimated-block {
  margin: 8px 16px 0;
  background: var(--surface);
  border-radius: var(--radius-md);
  padding: 12px;
}
.fl-estimated-title {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-tertiary);
  margin-bottom: 10px;
}
.fl-estimated-name-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.fl-estimated-name-label { font-size: 12px; color: var(--text-secondary); flex-shrink: 0; width: 40px; }
.fl-estimated-name-input {
  flex: 1;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 8px;
  font-size: 13px;
  color: var(--text);
}
.fl-estimated-macros {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
}
.fl-estimated-macro { text-align: center; }
.fl-estimated-macro-val {
  font-size: 15px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.fl-estimated-macro-label {
  font-size: 9px;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-top: 1px;
}

/* ── Picker sheet ───────────────────────────────────────────────────────────── */
.fl-sheet-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0,0,0,0.4);
  z-index: 50;
  display: flex;
  align-items: flex-end;
}
.fl-sheet {
  background: var(--bg);
  border-radius: 20px 20px 0 0;
  width: 100%;
  max-height: 75%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.fl-sheet-handle {
  width: 36px;
  height: 4px;
  background: var(--border);
  border-radius: 2px;
  margin: 10px auto 0;
  flex-shrink: 0;
}
.fl-sheet-header {
  padding: 10px 16px 8px;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.fl-sheet-title { font-size: 15px; font-weight: 600; flex: 1; }
.fl-sheet-count { font-size: 12px; color: var(--text-tertiary); }
.fl-sheet-search {
  margin: 0 16px 8px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  font-size: 13px;
  color: var(--text);
  width: calc(100% - 32px);
  flex-shrink: 0;
}
.fl-sheet-list {
  overflow-y: auto;
  flex: 1;
  padding: 0 16px 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.fl-sheet-list::-webkit-scrollbar { display: none; }
.fl-picker-row {
  background: var(--surface);
  border-radius: var(--radius-sm);
  padding: 10px;
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.fl-picker-check {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 1.5px solid var(--border);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.fl-picker-check.checked { background: var(--accent); border-color: var(--accent); }
.fl-picker-check.checked::after {
  content: '✓';
  font-size: 12px;
  font-weight: 700;
  color: var(--accent-fg);
}
.fl-picker-info { flex: 1; min-width: 0; }
.fl-picker-name { font-size: 13px; font-weight: 500; }
.fl-picker-brand { font-size: 11px; color: var(--text-tertiary); }
.fl-picker-macros { font-size: 11px; color: var(--text-secondary); margin-top: 2px; }
.fl-sheet-confirm-btn {
  margin: 4px 16px 12px;
  background: var(--accent);
  color: var(--accent-fg);
  border-radius: var(--radius-md);
  padding: 12px;
  font-size: 15px;
  font-weight: 600;
  text-align: center;
  flex-shrink: 0;
  cursor: pointer;
}
.fl-sheet-confirm-btn:disabled,
.fl-sheet-confirm-btn[disabled] { opacity: 0.4; pointer-events: none; }

/* ── Timeline: component pills ──────────────────────────────────────────────── */
.fl-entry-components {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 5px;
}
.fl-component-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: var(--surface);
  border-radius: 6px;
  padding: 3px 7px;
  font-size: 11px;
  color: var(--text-secondary);
  border: 1px solid var(--border);
}
.fl-component-pill-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}
.fl-entry-expand {
  font-size: 11px;
  color: var(--accent);
  margin-top: 4px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
```

- [ ] **Step 2: Verify no visual regressions**

Start the dev server and open the app:

```bash
lsof -ti:8080 | xargs kill -9 2>/dev/null; npx serve . -p 8080
```

Navigate to the Library tab → Food sub-tab and the Food Log tab. Confirm existing items look unchanged.

- [ ] **Step 3: Commit**

```bash
git add style.css
git commit -m "CSS: component list, picker sheet, estimated totals, timeline pill styles"
```

---

### Task 5: Unified food library list (renderFoodLibraryPane)

**Files:**
- Modify: `food-log.js` — `renderFoodLibraryPane` function only

**Interfaces:**
- Consumes: `item.brand`, `item.servingSize` from Task 2; CSS classes from Task 4
- Produces: grouped `product-row` library list; tapping a row opens edit form; no `Use` button

- [ ] **Step 1: Replace `renderFoodLibraryPane` in `food-log.js`**

Find the `async function renderFoodLibraryPane(paneEl)` block (lines ~261–321) and replace it entirely:

```js
function _titleCase(str) {
  return str.split(' ').map(function (w) {
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(' ');
}

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

  if (!items.length) {
    paneEl.innerHTML = '<div style="padding:32px 16px;text-align:center;color:var(--text-tertiary);font-size:14px">No food items yet. Tap + to add your first item.</div>';
    return;
  }

  // Group by category (title-cased); uncategorised → 'Other' (sorted last)
  var groups = {};
  items.forEach(function (item) {
    var key = item.category ? _titleCase(item.category) : 'Other';
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  });
  var sortedKeys = Object.keys(groups).filter(function (k) { return k !== 'Other'; }).sort();
  if (groups['Other']) sortedKeys.push('Other');

  paneEl.innerHTML = sortedKeys.map(function (key) {
    return '<div class="product-group">' +
      '<div class="product-group-title">' + _A.escHtml(key) + '</div>' +
      groups[key].map(function (item) {
        var fullName = (item.brand ? item.brand + ' ' : '') + item.name;
        var meta = [];
        if (item.caloriesPerServing) meta.push(item.caloriesPerServing + ' kcal');
        if (item.proteinPerServing)  meta.push(item.proteinPerServing  + 'g protein');
        if (item.carbsPerServing)    meta.push(item.carbsPerServing    + 'g carbs');
        var suffix = item.servingSize
          ? ' per ' + item.servingSize + 'g'
          : (item.servingUnit ? ' per ' + _A.escHtml(item.servingUnit) : '');
        return '<div class="product-row" data-lib-id="' + item.id + '">' +
          '<div class="product-row-info">' +
            '<div class="product-row-name">' + _A.escHtml(fullName) + '</div>' +
            '<div class="product-row-meta">' + meta.join(' · ') + suffix + '</div>' +
          '</div>' +
          '<span style="color:var(--text-tertiary);font-size:20px">&#8250;</span>' +
        '</div>';
      }).join('') +
    '</div>';
  }).join('');

  _A.$$('.product-row', paneEl).forEach(function (row) {
    _A.on(row, 'click', function () {
      var id = row.dataset.libId;
      var item = items.filter(function (i) { return i.id === id; })[0];
      if (!item) return;
      state.editingEntry = null;
      state.editingLibraryItem = item;
      _A.navigate('food-log-entry');
    });
  });
}
```

- [ ] **Step 2: Verify in the browser**

Open Library → Food tab. Confirm:
- Items appear grouped under category headings
- Each row shows brand + name and a meta line with kcal/macros + "per Xg"
- Tapping a row navigates to the edit form
- No `Use` button

- [ ] **Step 3: Commit**

```bash
git add food-log.js
git commit -m "Food library list: grouped product-row style with brand and serving size"
```

---

### Task 6: Food item form — brand, serving_size, free-text category

**Files:**
- Modify: `food-log.js` — `renderFoodLogEntry` function, library form section only

**Interfaces:**
- Consumes: `item.brand`, `item.servingSize` from Task 2
- Produces: food item form with Brand, Name, Category (free text), Serving size (number + fixed `g`), macros grid

- [ ] **Step 1: Update `formState` initialisation in `renderFoodLogEntry`**

Find the `var formState = {` block (~line 345). Add `brand` and `servingSize` to it:

```js
var formState = {
  name:       src ? (isLibraryEdit ? src.name               : src.name)               : '',
  brand:      src ? (isLibraryEdit ? (src.brand || '')       : '')                     : '',
  category:   src ? (src.category || '')                                               : '',
  servingSize: src ? (isLibraryEdit ? (src.servingSize != null ? src.servingSize : '') : '') : '',
  protein:    src ? (isLibraryEdit ? src.proteinPerServing   : src.protein)   : (libraryOnlyMode ? null : 0),
  carbs:      src ? (isLibraryEdit ? src.carbsPerServing     : src.carbs)     : (libraryOnlyMode ? null : 0),
  fat:        src ? (isLibraryEdit ? src.fatPerServing       : src.fat)       : (libraryOnlyMode ? null : 0),
  calories:   src ? (isLibraryEdit ? src.caloriesPerServing  : src.calories)  : (libraryOnlyMode ? null : 0),
  fiber:      src ? (isLibraryEdit ? src.fiberPerServing     : src.fiber)     : null,
  sodium:     src ? (isLibraryEdit ? src.sodiumPerServing    : src.sodium)    : null,
  loggedAt:   isEdit ? entry.loggedAt : (state.date === todayStr() ? new Date().toISOString() : new Date(state.date + 'T12:00:00').toISOString()),
  aiEstimated: isEdit ? entry.aiEstimated : false,
  aiNotes:    isEdit ? entry.aiNotes    : null,
  libraryItemId:     isEdit ? entry.libraryItemId     : (prefill ? prefill.libraryItemId     : null),
  servingMultiplier: isEdit ? entry.servingMultiplier : (prefill ? prefill.servingMultiplier : 1.0)
};
```

- [ ] **Step 2: Update `estimatedBlockHTML()` for the library form**

Find `function estimatedBlockHTML()` inside `renderFoodLogEntry`. Replace the entire function:

```js
function estimatedBlockHTML() {
  if (!parsed) return '';

  function macroRow(label, key, unit) {
    var val = formState[key];
    var display = val != null ? val : '';
    return '<div class="fl-macro-edit-row">' +
      '<span class="fl-macro-edit-label">' + label + '</span>' +
      '<div class="fl-macro-edit-value-wrap">' +
        '<input class="fl-macro-edit-value" type="number" min="0" data-macro="' + key + '" value="' + display + '" placeholder="—">' +
        '<span class="fl-macro-edit-unit">' + unit + '</span>' +
      '</div>' +
    '</div>';
  }

  if (isLibraryForm) {
    return '<div class="fl-estimated">' +
      '<div class="fl-estimated-title">Item Details</div>' +
      // Brand
      '<div class="fl-macro-edit-row">' +
        '<span class="fl-macro-edit-label">Brand</span>' +
        '<div class="fl-macro-edit-value-wrap" style="flex:1;margin-left:16px">' +
          '<input class="fl-macro-edit-value" type="text" data-macro="brand" value="' + _A.escHtml(formState.brand) + '" placeholder="optional" style="width:100%;text-align:left">' +
        '</div>' +
      '</div>' +
      // Name
      '<div class="fl-macro-edit-row">' +
        '<span class="fl-macro-edit-label">Name</span>' +
        '<div class="fl-macro-edit-value-wrap" style="flex:1;margin-left:16px">' +
          '<input class="fl-macro-edit-value" type="text" data-macro="name" value="' + _A.escHtml(formState.name) + '" style="width:100%;text-align:left">' +
        '</div>' +
      '</div>' +
      // Category
      '<div class="fl-macro-edit-row">' +
        '<span class="fl-macro-edit-label">Category</span>' +
        '<div class="fl-macro-edit-value-wrap" style="flex:1;margin-left:16px">' +
          '<input class="fl-macro-edit-value" type="text" data-macro="category" value="' + _A.escHtml(formState.category) + '" placeholder="optional" style="width:100%;text-align:left">' +
        '</div>' +
      '</div>' +
      // Per serving block
      '<div style="margin-top:8px;font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-tertiary);margin-bottom:6px">Per Serving</div>' +
      // Serving size
      '<div class="fl-macro-edit-row">' +
        '<span class="fl-macro-edit-label">Size</span>' +
        '<div class="fl-macro-edit-value-wrap">' +
          '<input class="fl-macro-edit-value" type="number" min="0" data-macro="servingSize" value="' + (formState.servingSize !== '' ? formState.servingSize : '') + '" placeholder="—">' +
          '<span class="fl-macro-edit-unit">g</span>' +
        '</div>' +
      '</div>' +
      macroRow('Calories', 'calories', 'kcal') +
      macroRow('Protein',  'protein',  'g') +
      macroRow('Carbs',    'carbs',    'g') +
      macroRow('Fat',      'fat',      'g') +
      macroRow('Fiber',    'fiber',    'g') +
      macroRow('Sodium',   'sodium',   'mg') +
    '</div>';
  }

  // Non-library (log entry) form — unchanged layout
  return '<div class="fl-estimated">' +
    '<div class="fl-estimated-title">Estimated Macros</div>' +
    '<div class="fl-macro-edit-row">' +
      '<span class="fl-macro-edit-label">Name</span>' +
      '<div class="fl-macro-edit-value-wrap" style="flex:1;margin-left:16px">' +
        '<input class="fl-macro-edit-value" type="text" data-macro="name" value="' + _A.escHtml(formState.name) + '" style="width:100%;text-align:left">' +
      '</div>' +
    '</div>' +
    macroRow('Calories', 'calories', 'kcal') +
    macroRow('Protein',  'protein',  'g') +
    macroRow('Carbs',    'carbs',    'g') +
    macroRow('Fat',      'fat',      'g') +
    macroRow('Fiber',    'fiber',    'g') +
    macroRow('Sodium',   'sodium',   'mg') +
  '</div>';
}
```

- [ ] **Step 3: Wire `brand`, `category`, `servingSize` inputs in `attachHandlers`**

The existing `[data-macro]` handler already updates `formState[key]` for any input with that attribute. The only change needed: `brand` and `category` are strings (not numbers), and `servingSize` is numeric. Update the handler:

```js
_A.$$('[data-macro]', $body).forEach(function (input) {
  _A.on(input, 'input', function () {
    var key = input.dataset.macro;
    var strKeys = ['name', 'brand', 'category'];
    formState[key] = strKeys.indexOf(key) !== -1
      ? input.value
      : (input.value === '' ? null : parseFloat(input.value));
  });
});
```

- [ ] **Step 4: Normalise category on save (library path)**

In the save handler, find the `isLibraryEdit` branch and the `libraryOnlyMode` branch. In both, normalise category before sending:

```js
var normCategory = formState.category ? formState.category.trim().toLowerCase() : null;
```

Then pass `category: normCategory` instead of `category: formState.category`.

Do the same in both `FoodLogData.updateLibraryItem(...)` and `FoodLogData.saveLibraryItem(...)` calls.

- [ ] **Step 5: Pass `brand` and `servingSize` in save calls**

In the `isLibraryEdit` `updateLibraryItem` call, add:

```js
brand: formState.brand || null,
servingSize: formState.servingSize !== '' && formState.servingSize != null
  ? parseFloat(formState.servingSize) : null,
```

In the `libraryOnlyMode` `saveLibraryItem` call, add the same two fields.

- [ ] **Step 6: Verify in the browser**

- Open Library → Food → tap an existing item → confirm Brand, Category, Serving size fields appear
- Tap + → New Food Item → fill in all fields → Save → confirm item appears in grouped list
- Edit the item → confirm values pre-fill correctly

- [ ] **Step 7: Commit**

```bash
git add food-log.js
git commit -m "Food item form: brand, serving size, free-text category with normalisation"
```

---

### Task 7: Build mode — full flow

**Files:**
- Modify: `food-log.js` — `renderFoodLogEntry`, new `renderBuildMode` helper

**Interfaces:**
- Consumes: `FoodLogData.scaleComponentMacros` (Task 2), `FoodLogData.parseMeal` (existing), `FoodLogData.saveLog` with `components` (Task 3), CSS classes (Task 4)
- Produces: Build tab in Log Meal; picker sheet; Calculate → estimated block; Save with `components` array

**Implementation notes:**
- Build mode state lives in `formState` within `renderFoodLogEntry`'s closure — no new module-level state
- The picker sheet is injected as a sibling element inside `$body`; the form body uses `position: relative` to let the sheet overlay position correctly
- Component amounts are stored as numeric grams; the input shows the value with a "g" suffix label, not concatenated into the value
- `parseMeal` is only called if the freeform textarea has non-empty content; if it's empty, freeform contributes zero macros

- [ ] **Step 1: Add build-mode state variables to `formState`**

After the existing `formState` object (inside `renderFoodLogEntry`), add:

```js
var buildComponents = []; // [{item, amountG}]
var buildMode = false;    // true = Build tab active
var postCalculate = null; // {name, protein, carbs, fat, calories, fiber, sodium, components} | null
var COMPONENT_COLORS = ['#5b9bd5', '#e8a04b', '#6abf69', '#e8585e', '#9b7dd4', '#4bbfbf'];
```

- [ ] **Step 2: Add mode toggle HTML to `render()`**

In the `render()` function, add the mode toggle just before the freeform section. The toggle only shows in new-entry mode (not edit, not library form):

```js
var modeToggleHTML = (!isEdit && !isLibraryForm)
  ? '<div class="fl-mode-tabs">' +
      '<div class="fl-mode-tab' + (!buildMode ? ' active' : '') + '" data-mode="describe">Describe</div>' +
      '<div class="fl-mode-tab' + ( buildMode ? ' active' : '') + '" data-mode="build">Build</div>' +
    '</div>'
  : '';
```

Then in the `$body.innerHTML = ...` template, replace the freeform block:

```js
$body.innerHTML =
  '<div style="padding:16px;position:relative">' +
    modeToggleHTML +
    (!isEdit && !isLibraryForm && !buildMode
      ? '<div style="margin-top:12px"><label ...>What did you eat?</label>' +
        '<textarea ...></textarea>' +
        '<button id="fl-parse-btn">Calculate</button></div>'
      : '') +
    (!isEdit && !isLibraryForm && buildMode ? buildModeHTML() : '') +
    (!buildMode ? estimatedBlockHTML() : (postCalculate ? calculatedTotalsHTML() : '')) +
    // category, time, save-to-library, save button — same as before, but hidden in build mode pre-calculate
    ...
```

The exact structure is shown fully in Step 4 below.

- [ ] **Step 3: Write `buildModeHTML()` helper**

Add this function inside `renderFoodLogEntry`, alongside the existing `estimatedBlockHTML` helper:

```js
function buildModeHTML() {
  var componentRows = buildComponents.map(function (bc, i) {
    var color = COMPONENT_COLORS[i % COMPONENT_COLORS.length];
    var sub = [
      bc.item.caloriesPerServing + ' kcal',
      bc.item.proteinPerServing + 'g P'
    ];
    if (bc.item.servingSize) sub.push('per ' + bc.item.servingSize + 'g');
    return '<div class="fl-component-row" data-build-idx="' + i + '">' +
      '<div class="fl-component-color" style="background:' + color + '"></div>' +
      '<div class="fl-component-info">' +
        '<div class="fl-component-name">' + _A.escHtml((bc.item.brand ? bc.item.brand + ' ' : '') + bc.item.name) + '</div>' +
        '<div class="fl-component-sub">' + sub.join(' · ') + '</div>' +
      '</div>' +
      '<div class="fl-component-amount-wrap">' +
        '<input class="fl-component-amount" type="number" min="0" data-build-amount="' + i + '" value="' + bc.amountG + '">' +
        '<span class="fl-component-unit">g</span>' +
      '</div>' +
      '<div class="fl-component-remove" data-build-remove="' + i + '">×</div>' +
    '</div>';
  }).join('');

  return '<div style="margin-top:10px">' +
    '<div style="font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-tertiary);padding:0 0 5px">Library items</div>' +
    '<div class="fl-component-list">' + (componentRows || '<div style="font-size:13px;color:var(--text-tertiary);padding:8px 0">No items yet — tap below to add.</div>') + '</div>' +
    '<div class="fl-add-from-lib-btn" id="fl-build-add-btn">+ Add from library</div>' +
    '<div style="margin-top:10px">' +
      '<div style="font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-tertiary);margin-bottom:4px">Other items</div>' +
      '<textarea class="fl-freeform-area" id="fl-build-freeform" placeholder="21g honey, 23g slivered almonds…" style="margin-top:0">' + _A.escHtml(formState.buildFreeform || '') + '</textarea>' +
    '</div>' +
  '</div>';
}
```

Also add `buildFreeform: ''` to `formState`.

- [ ] **Step 4: Write `calculatedTotalsHTML()` helper**

```js
function calculatedTotalsHTML() {
  if (!postCalculate) return '';
  var pc = postCalculate;
  return '<div class="fl-estimated-block">' +
    '<div class="fl-estimated-title">Estimated Totals</div>' +
    '<div class="fl-estimated-name-row">' +
      '<span class="fl-estimated-name-label">Name</span>' +
      '<input class="fl-estimated-name-input" type="text" id="fl-build-name" value="' + _A.escHtml(pc.name) + '">' +
    '</div>' +
    '<div class="fl-estimated-macros">' +
      '<div class="fl-estimated-macro"><div class="fl-estimated-macro-val">' + Math.round(pc.calories) + '</div><div class="fl-estimated-macro-label">kcal</div></div>' +
      '<div class="fl-estimated-macro"><div class="fl-estimated-macro-val">' + Math.round(pc.protein) + 'g</div><div class="fl-estimated-macro-label">protein</div></div>' +
      '<div class="fl-estimated-macro"><div class="fl-estimated-macro-val">' + Math.round(pc.carbs) + 'g</div><div class="fl-estimated-macro-label">carbs</div></div>' +
      '<div class="fl-estimated-macro"><div class="fl-estimated-macro-val">' + Math.round(pc.fat) + 'g</div><div class="fl-estimated-macro-label">fat</div></div>' +
    '</div>' +
  '</div>';
}
```

- [ ] **Step 5: Write picker sheet HTML helper**

```js
function pickerSheetHTML(library, selectedIds) {
  var rows = library.map(function (item) {
    var checked = selectedIds.indexOf(item.id) !== -1;
    var meta = [item.caloriesPerServing + ' kcal', item.proteinPerServing + 'g P'];
    if (item.servingSize) meta.push('per ' + item.servingSize + 'g');
    return '<div class="fl-picker-row" data-picker-id="' + item.id + '">' +
      '<div class="fl-picker-check' + (checked ? ' checked' : '') + '"></div>' +
      '<div class="fl-picker-info">' +
        '<div class="fl-picker-name">' + _A.escHtml((item.brand ? item.brand + ' ' : '') + item.name) + '</div>' +
        (item.brand ? '<div class="fl-picker-brand">' + _A.escHtml(item.brand) + '</div>' : '') +
        '<div class="fl-picker-macros">' + meta.join(' · ') + '</div>' +
      '</div>' +
    '</div>';
  }).join('');

  var n = selectedIds.length;
  return '<div class="fl-sheet-overlay" id="fl-picker-overlay">' +
    '<div class="fl-sheet">' +
      '<div class="fl-sheet-handle"></div>' +
      '<div class="fl-sheet-header">' +
        '<div class="fl-sheet-title">Add from Library</div>' +
        '<span class="fl-sheet-count" id="fl-picker-count">' + (n ? n + ' selected' : '') + '</span>' +
      '</div>' +
      '<input class="fl-sheet-search" id="fl-picker-search" placeholder="Search…" type="search">' +
      '<div class="fl-sheet-list" id="fl-picker-list">' + rows + '</div>' +
      '<div class="fl-sheet-confirm-btn' + (n === 0 ? '" style="opacity:0.4;pointer-events:none' : '') + '" id="fl-picker-confirm">Add ' + (n || '') + ' item' + (n !== 1 ? 's' : '') + ' →</div>' +
    '</div>' +
  '</div>';
}
```

- [ ] **Step 6: Update `render()` to include the full Build mode template**

Replace the `$body.innerHTML = ...` block in `render()` with:

```js
function render() {
  var modeToggle = (!isEdit && !isLibraryForm)
    ? '<div class="fl-mode-tabs">' +
        '<div class="fl-mode-tab' + (!buildMode ? ' active' : '') + '" data-mode="describe">Describe</div>' +
        '<div class="fl-mode-tab' + ( buildMode ? ' active' : '') + '" data-mode="build">Build</div>' +
      '</div>'
    : '';

  var formBody;
  if (buildMode) {
    var showSave = !!postCalculate;
    formBody =
      modeToggle +
      '<div style="margin-top:12px">' + buildModeHTML() + '</div>' +
      (postCalculate ? calculatedTotalsHTML() : '') +
      (!isLibraryForm
        ? '<div style="margin-top:12px">' +
            '<div style="font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-tertiary);margin-bottom:6px">Category</div>' +
            categoryChipsHTML() +
          '</div>'
        : '') +
      (!postCalculate
        ? '<button class="fl-parse-btn" id="fl-calc-btn" style="margin-top:12px">Calculate</button>'
        : '<div style="display:flex;gap:8px;margin-top:16px"><button id="fl-save-btn" class="btn-primary" style="flex:1">Save</button></div>');
  } else {
    formBody =
      modeToggle +
      (!isEdit && !isLibraryForm
        ? '<div style="margin-top:12px"><label style="display:block;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-tertiary);margin-bottom:6px">What did you eat?</label>' +
          '<textarea class="fl-freeform-area" id="fl-freeform" placeholder="e.g. chicken rice bowl, 2 eggs and toast…"></textarea>' +
          '<button class="fl-parse-btn" id="fl-parse-btn">Calculate</button>'
        : '') +
      estimatedBlockHTML() +
      (!isLibraryForm
        ? '<div style="margin-top:16px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-tertiary);margin-bottom:6px">Category</div>' +
          categoryChipsHTML() +
          '<div style="margin-top:12px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-tertiary);margin-bottom:6px">Time</div>' +
          '<input id="fl-time-input" type="time" value="' + fmtInputTime(formState.loggedAt) + '" style="padding:6px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);color:var(--text);font-size:14px">'
        : '') +
      (parsed && !isEdit && !isLibraryForm ? '<label class="fl-save-library-row"><input type="checkbox" id="fl-save-library"> Save to library</label>' : '') +
      (parsed || isEdit || isLibraryForm
        ? '<div style="display:flex;gap:8px;margin-top:24px"><button id="fl-save-btn" class="btn-primary" style="flex:1">Save</button></div>'
        : '');
  }

  $body.innerHTML = '<div style="padding:16px;position:relative">' + formBody + '</div>';
  attachHandlers();
}
```

- [ ] **Step 7: Wire mode toggle in `attachHandlers`**

Add at the start of `attachHandlers`:

```js
_A.$$('.fl-mode-tab', $body).forEach(function (tab) {
  _A.on(tab, 'click', function () {
    var newMode = tab.dataset.mode === 'build';
    if (newMode === buildMode) return;
    buildMode = newMode;
    postCalculate = null;
    render();
    if (_A.$('fl-freeform')) _A.$('fl-freeform').value = formState.buildFreeform || '';
  });
});
```

- [ ] **Step 8: Wire Build mode amount inputs and remove buttons in `attachHandlers`**

```js
// Amount inputs
_A.$$('[data-build-amount]', $body).forEach(function (input) {
  _A.on(input, 'change', function () {
    var idx = parseInt(input.dataset.buildAmount, 10);
    buildComponents[idx].amountG = parseFloat(input.value) || 0;
  });
});

// Remove buttons
_A.$$('[data-build-remove]', $body).forEach(function (btn) {
  _A.on(btn, 'click', function () {
    var idx = parseInt(btn.dataset.buildRemove, 10);
    buildComponents.splice(idx, 1);
    postCalculate = null;
    render();
  });
});

// Freeform textarea in build mode
var buildFreeformEl = _A.$('fl-build-freeform');
if (buildFreeformEl) {
  _A.on(buildFreeformEl, 'input', function () {
    formState.buildFreeform = buildFreeformEl.value;
  });
}
```

- [ ] **Step 9: Wire the picker sheet**

```js
var addBtn = _A.$('fl-build-add-btn');
if (addBtn) {
  _A.on(addBtn, 'click', function () {
    var selectedIds = buildComponents.map(function (bc) { return bc.item.id; });
    var sheetEl = document.createElement('div');
    sheetEl.innerHTML = pickerSheetHTML(state.library, selectedIds);
    var overlay = sheetEl.firstChild;
    $body.appendChild(overlay);

    var currentSelected = selectedIds.slice();

    function updateConfirm() {
      var n = currentSelected.length;
      var confirmBtn = _A.$('fl-picker-confirm');
      if (!confirmBtn) return;
      confirmBtn.textContent = 'Add ' + (n || '') + ' item' + (n !== 1 ? 's' : '') + ' →';
      confirmBtn.style.opacity = n === 0 ? '0.4' : '';
      confirmBtn.style.pointerEvents = n === 0 ? 'none' : '';
      var countEl = _A.$('fl-picker-count');
      if (countEl) countEl.textContent = n ? n + ' selected' : '';
    }

    // Toggle selection
    _A.$$('.fl-picker-row', overlay).forEach(function (row) {
      _A.on(row, 'click', function () {
        var id = row.dataset.pickerId;
        var idx = currentSelected.indexOf(id);
        if (idx === -1) {
          currentSelected.push(id);
          row.querySelector('.fl-picker-check').classList.add('checked');
        } else {
          currentSelected.splice(idx, 1);
          row.querySelector('.fl-picker-check').classList.remove('checked');
        }
        updateConfirm();
      });
    });

    // Search filter
    var searchEl = _A.$('fl-picker-search');
    if (searchEl) {
      _A.on(searchEl, 'input', function () {
        var q = searchEl.value.toLowerCase();
        _A.$$('.fl-picker-row', overlay).forEach(function (row) {
          var id = row.dataset.pickerId;
          var item = state.library.filter(function (i) { return i.id === id; })[0];
          if (!item) return;
          var text = ((item.brand || '') + ' ' + item.name).toLowerCase();
          row.style.display = text.includes(q) ? '' : 'none';
        });
      });
    }

    // Confirm
    var confirmBtn = _A.$('fl-picker-confirm');
    if (confirmBtn) {
      _A.on(confirmBtn, 'click', function () {
        var existingIds = buildComponents.map(function (bc) { return bc.item.id; });
        currentSelected.forEach(function (id) {
          if (existingIds.indexOf(id) !== -1) return; // already in list
          var item = state.library.filter(function (i) { return i.id === id; })[0];
          if (!item) return;
          buildComponents.push({ item: item, amountG: item.servingSize || 100 });
        });
        // Remove deselected items
        buildComponents = buildComponents.filter(function (bc) {
          return currentSelected.indexOf(bc.item.id) !== -1;
        });
        postCalculate = null;
        overlay.parentNode.removeChild(overlay);
        render();
      });
    }

    // Close on overlay backdrop tap
    _A.on(overlay, 'click', function (e) {
      if (e.target === overlay) overlay.parentNode.removeChild(overlay);
    });
  });
}
```

- [ ] **Step 10: Wire the Calculate button in Build mode**

```js
var calcBtn = _A.$('fl-calc-btn');
if (calcBtn) {
  _A.on(calcBtn, 'click', async function () {
    if (!buildComponents.length && !formState.buildFreeform.trim()) return;
    calcBtn.disabled = true;
    calcBtn.textContent = 'Calculating…';

    // Sum library components
    var totals = { protein: 0, carbs: 0, fat: 0, calories: 0, fiber: null, sodium: null };
    var componentRecords = buildComponents.map(function (bc, i) {
      var scaled = FoodLogData.scaleComponentMacros(bc.item, bc.amountG);
      totals.protein  += scaled.protein  || 0;
      totals.carbs    += scaled.carbs    || 0;
      totals.fat      += scaled.fat      || 0;
      totals.calories += scaled.calories || 0;
      if (scaled.fiber  != null) { if (totals.fiber  == null) totals.fiber  = 0; totals.fiber  += scaled.fiber; }
      if (scaled.sodium != null) { if (totals.sodium == null) totals.sodium = 0; totals.sodium += scaled.sodium; }
      return {
        library_item_id: bc.item.id,
        name:     (bc.item.brand ? bc.item.brand + ' ' : '') + bc.item.name,
        amount_g: bc.amountG,
        protein:  scaled.protein,  carbs:    scaled.carbs,
        fat:      scaled.fat,      calories: scaled.calories,
        fiber:    scaled.fiber,    sodium:   scaled.sodium
      };
    });

    // Parse freeform items
    var freeText = formState.buildFreeform.trim();
    var freeComponents = [];
    if (freeText) {
      try {
        var userId = localStorage.getItem('fuelPlanner.userId');
        var parsed_result = await FoodLogData.parseMeal(freeText, state.library);
        totals.protein  += parsed_result.protein  || 0;
        totals.carbs    += parsed_result.carbs     || 0;
        totals.fat      += parsed_result.fat       || 0;
        totals.calories += parsed_result.calories  || 0;
        if (parsed_result.fiber  != null) { if (totals.fiber  == null) totals.fiber  = 0; totals.fiber  += parsed_result.fiber; }
        if (parsed_result.sodium != null) { if (totals.sodium == null) totals.sodium = 0; totals.sodium += parsed_result.sodium; }
        // Store freeform as a single component record (no library_item_id)
        freeComponents.push({
          library_item_id: null, name: freeText, amount_g: null,
          protein: parsed_result.protein, carbs: parsed_result.carbs,
          fat: parsed_result.fat, calories: parsed_result.calories,
          fiber: parsed_result.fiber, sodium: parsed_result.sodium
        });
      } catch (e) {
        calcBtn.disabled = false;
        calcBtn.textContent = 'Calculate';
        return;
      }
    }

    // Suggest name from first library item
    var suggestedName = buildComponents.length
      ? (buildComponents[0].item.brand
          ? buildComponents[0].item.brand + ' ' + buildComponents[0].item.name
          : buildComponents[0].item.name)
      : (freeText.split(',')[0].replace(/^\d+g?\s*/i, '').trim() || 'Meal');

    postCalculate = {
      name:     suggestedName,
      protein:  Math.round(totals.protein  * 10) / 10,
      carbs:    Math.round(totals.carbs    * 10) / 10,
      fat:      Math.round(totals.fat      * 10) / 10,
      calories: Math.round(totals.calories * 10) / 10,
      fiber:    totals.fiber  != null ? Math.round(totals.fiber  * 10) / 10 : null,
      sodium:   totals.sodium != null ? Math.round(totals.sodium * 10) / 10 : null,
      components: componentRecords.concat(freeComponents)
    };

    render();
  });
}
```

- [ ] **Step 11: Wire Save in Build mode**

In the existing `saveBtn` click handler, add a `buildMode` branch before the `isEdit` check:

```js
if (buildMode && postCalculate) {
  var nameInput = _A.$('fl-build-name');
  var finalName = (nameInput ? nameInput.value.trim() : '') || postCalculate.name;
  try {
    var userId = localStorage.getItem('fuelPlanner.userId');
    await FoodLogData.saveLog(userId, {
      name:              finalName,
      category:          formState.category || 'Breakfast',
      loggedAt:          formState.loggedAt,
      freeformInput:     formState.buildFreeform || null,
      protein:           postCalculate.protein,
      carbs:             postCalculate.carbs,
      fat:               postCalculate.fat,
      calories:          postCalculate.calories,
      fiber:             postCalculate.fiber,
      sodium:            postCalculate.sodium,
      libraryItemId:     null,
      servingMultiplier: 1.0,
      aiEstimated:       false,
      aiNotes:           null,
      components:        postCalculate.components
    });
    state.editingEntry = null;
    _A.navigate('food-log');
  } catch (e) {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save';
    alert('Could not save — check your connection.');
  }
  return;
}
```

- [ ] **Step 12: Verify the full Build mode flow in the browser**

1. Open Food Log → tap + → confirm "Describe / Build" toggle appears
2. Switch to Build → tap "Add from library" → picker opens with library items
3. Select 2 items → confirm → items appear in component list with correct amounts
4. Search in picker → confirm filter works
5. Edit an amount → tap Calculate → confirm estimated totals block shows
6. Edit the name → tap Save → confirm entry appears in timeline
7. Switch back to Describe → confirm existing flow still works

- [ ] **Step 13: Commit**

```bash
git add food-log.js
git commit -m "Build mode: multi-item meal composer with library picker and Calculate → Save flow"
```

---

### Task 8: Timeline — component pills

**Files:**
- Modify: `food-log.js` — `timelineHTML` and `renderFoodLog` handlers

**Interfaces:**
- Consumes: `log.components` array from Task 3; CSS classes from Task 4
- Produces: component pills on multi-item timeline entries; collapse/expand toggle

- [ ] **Step 1: Update `timelineHTML` in `food-log.js`**

Find `function timelineHTML(logs)`. Inside the `logs.map(function (log) {` block, add component pills after `fl-entry-meta`:

```js
var COMPONENT_COLORS = ['#5b9bd5', '#e8a04b', '#6abf69', '#e8585e', '#9b7dd4', '#4bbfbf'];

var pillsHTML = '';
if (log.components && log.components.length) {
  var libItems  = log.components.filter(function (c) { return c.library_item_id; });
  var freeItems = log.components.filter(function (c) { return !c.library_item_id; });
  var pills = libItems.map(function (c, i) {
    var color = COMPONENT_COLORS[i % COMPONENT_COLORS.length];
    var label = (c.amount_g != null ? c.amount_g + 'g ' : '') + c.name;
    return '<span class="fl-component-pill">' +
      '<span class="fl-component-pill-dot" style="background:' + color + '"></span>' +
      _A.escHtml(label) +
    '</span>';
  });
  if (freeItems.length) {
    var freeLabel = freeItems.map(function (c) { return c.name; }).join(' · ');
    pills.push('<span class="fl-component-pill">' + _A.escHtml(freeLabel) + '</span>');
  }
  pillsHTML =
    '<div class="fl-entry-components" id="fl-ec-' + log.id + '">' + pills.join('') + '</div>' +
    '<div class="fl-entry-expand" data-ec-id="' + log.id + '">▲ Collapse</div>';
}
```

Then add `pillsHTML` after the `fl-entry-meta` div in the returned HTML:

```js
return '<div class="fl-timeline-entry">' +
  '<div class="fl-time-col"><span class="fl-time-text">' + fmtTime(log.loggedAt) + '</span></div>' +
  '<div class="fl-entry-body" data-entry-id="' + log.id + '">' +
    '<div class="fl-entry-name">' + _A.escHtml(log.name) + '</div>' +
    '<div class="fl-entry-meta">' +
      '<span class="fl-category-badge">' + _A.escHtml(log.category || 'Other') + '</span>' +
      macroHTML +
    '</div>' +
    pillsHTML +
  '</div>' +
'</div>';
```

- [ ] **Step 2: Attach collapse/expand handlers in `renderFoodLog`**

After the line that sets `$body.innerHTML`, and after the existing `_A.$$('.fl-entry-body')` handler block, add:

```js
_A.$$('.fl-entry-expand', $body).forEach(function (btn) {
  _A.on(btn, 'click', function (e) {
    e.stopPropagation(); // don't open edit form
    var ecEl = _A.$('fl-ec-' + btn.dataset.ecId);
    if (!ecEl) return;
    var isVisible = ecEl.style.display !== 'none';
    ecEl.style.display = isVisible ? 'none' : '';
    btn.textContent = isVisible ? '▼ Show components' : '▲ Collapse';
  });
});
```

- [ ] **Step 3: Verify in the browser**

1. Log a Build-mode meal (from Task 7)
2. Return to Food Log timeline → confirm component pills appear under the entry
3. Tap "▲ Collapse" → pills hide, button reads "▼ Show components"
4. Tap again → pills reappear
5. Tap the entry body itself → edit form opens (collapse button does not also trigger it)
6. Confirm Describe-mode entries show no pills

- [ ] **Step 4: Run all tests**

```bash
node tests/data.test.js && node tests/export.test.js && node tests/food-log-data.test.js
```

Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add food-log.js
git commit -m "Timeline: component pills for multi-item meal entries with collapse/expand"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| `brand TEXT` on `food_library` | Task 1 (migration), Task 2 (data), Task 6 (form) |
| `serving_size REAL` on `food_library` | Task 1 (migration), Task 2 (data), Task 6 (form) |
| `components JSONB` on `food_logs` | Task 1 (migration), Task 3 (data) |
| `scaleComponentMacros` helper | Task 2 |
| Unified library list (grouped, product-row style) | Task 5 |
| Brand in library list row | Task 5 |
| Category free text, normalised | Task 6 |
| Serving size fixed `g` label | Task 6 |
| Food item form brand + serving_size fields | Task 6 |
| Mode toggle Describe/Build | Task 7 |
| Component list with amount inputs | Task 7 |
| Picker sheet with multi-select + search | Task 7 |
| Calculate: scale library macros + parseMeal freeform | Task 7 |
| Post-Calculate block: editable name + macro summary | Task 7 |
| Save with `components` array | Task 7 |
| Component colour palette cycling | Task 7 |
| Component pills in timeline | Task 8 |
| Collapse/expand pills | Task 8 |
| No "AI-estimated" labels | enforced throughout |

**All spec requirements covered.**

**Placeholder scan:** None found.

**Type consistency:**
- `scaleComponentMacros(item, amountG)` defined in Task 2, called in Task 7 as `FoodLogData.scaleComponentMacros(bc.item, bc.amountG)` ✓
- `item.brand`, `item.servingSize` defined in Task 2 `rowToItem`, used in Tasks 5, 6, 7 ✓
- `log.components` defined in Task 3 `rowToLog`, used in Task 8 ✓
- `COMPONENT_COLORS` defined in both Task 7 (`buildModeHTML`) and Task 8 (`timelineHTML`) — these are two separate function scopes. Define it once as a module-level constant near the top of `food-log.js`'s IIFE, before any function that uses it, and remove the local definitions in each function.
