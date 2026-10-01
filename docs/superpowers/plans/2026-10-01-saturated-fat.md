# Saturated Fat Macro Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add saturated fat as a nullable macro field across the food library, food log, settings (percentage-based slider), adhoc event form, and LLM meal parser.

**Architecture:** Two DB migrations add the column to `food_library`, `food_logs`, and `daily_targets`. The data layer (`food-log-data.js`) is updated to read/write the field everywhere macros are touched. The UI layer (`food-log.js`, `index.html`, `app.js`) adds the field to every form and tracker it belongs to. The edge function (`supabase/functions/parse-meal/index.ts`) is updated to estimate and return `sat_fat`.

**Tech Stack:** Vanilla JS (no build step), Supabase Postgres (REST + Edge Functions), Deno/TypeScript for the edge function, Anthropic Claude Haiku for LLM parsing.

**Spec:** `docs/superpowers/specs/2026-10-01-saturated-fat-design.md`

## Global Constraints

- All UI label text must read "Saturated Fat" (not "Sat Fat" or "sat fat").
- `sat_fat_per_serving` on `food_library` is REAL nullable — consistent with all other optional macros.
- `sat_fat` on `food_logs` is REAL nullable.
- `sat_fat_pct` on `daily_targets` stores the **slider percentage (0–10)**, not derived grams.
- No build step — plain `.js` files edited directly.
- No `Co-Authored-By` or AI footer in any commit message.
- Do NOT show saturated fat in event plan or log views (only carbs/sodium/caffeine appear there).

## Review Focus

1. **No calorie target set → sat fat slider in settings**: slider must be rendered `disabled` with reduced opacity; live gram label must be absent. Test: render settings with `targets = { satFatPct: 6 }` (no `caloriesTarget`) and assert slider has `disabled` attribute.
2. **Derived target formula**: `(2000 × 5 / 100) / 9 = 11.1g` — one decimal place. Test: call `satFatGTarget({ caloriesTarget: 2000, satFatPct: 5 })` and assert `11.1`.
3. **Food log entry — null vs 0**: `sat_fat` on `food_logs` is nullable; the save path must not coerce a blank `satFat` to `0` (unlike protein/carbs/fat/calories which are NOT NULL). Test in Task 2 verifies `saveLog` passes `null` when `satFat` is not supplied.
4. **parseMeal edge function — sat_fat absent in response**: client code must handle `parsed.sat_fat` being `null` or `undefined` gracefully without crashing. Test: mock response with `sat_fat: null`, assert field populates as empty string.
5. **Settings save via range input**: the existing save handler iterates `[data-key]` inputs generically — a `type="range"` value is always a string; the handler must coerce it to a number. Test: render settings slider at `6`, confirm `saveTargets` is called with `satFatPct: 6` (number, not `"6"`).

---

### Task 1: DB migrations

**Files:**
- Create: `migrations/0016_add_sat_fat_to_food_library.sql`
- Create: `migrations/0017_add_sat_fat_to_food_logs_and_targets.sql`

**Interfaces:**
- Produces: `food_library.sat_fat_per_serving REAL`, `food_logs.sat_fat REAL`, `daily_targets.sat_fat_pct REAL` — all nullable, used by Tasks 2–5.

- [ ] **Step 1: Write migration 0016**

```sql
-- migrations/0016_add_sat_fat_to_food_library.sql
ALTER TABLE food_library
  ADD COLUMN IF NOT EXISTS sat_fat_per_serving REAL;
```

- [ ] **Step 2: Write migration 0017**

```sql
-- migrations/0017_add_sat_fat_to_food_logs_and_targets.sql
ALTER TABLE food_logs
  ADD COLUMN IF NOT EXISTS sat_fat REAL;

ALTER TABLE daily_targets
  ADD COLUMN IF NOT EXISTS sat_fat_pct REAL;
```

- [ ] **Step 3: Apply migrations**

Run each SQL file against your local Supabase instance (via the Supabase dashboard SQL editor or CLI). Verify: `\d food_library`, `\d food_logs`, `\d daily_targets` each show the new column.

- [ ] **Step 4: Commit**

```bash
git add migrations/0016_add_sat_fat_to_food_library.sql migrations/0017_add_sat_fat_to_food_logs_and_targets.sql
git commit -m "feat: add sat_fat_per_serving, sat_fat, sat_fat_pct columns"
```

---

### Task 2: Data layer — food-log-data.js

**Files:**
- Modify: `food-log-data.js`

**Interfaces:**
- Consumes: `food_library.sat_fat_per_serving`, `food_logs.sat_fat`, `daily_targets.sat_fat_pct` from Task 1.
- Produces:
  - `rowToItem(r)` returns object with `satFatPerServing: number | null`
  - `saveLibraryItem(userId, item)` accepts `item.satFatPerServing`
  - `updateLibraryItem(userId, id, fields)` accepts `fields.satFatPerServing`
  - `rowToLog(r)` returns object with `satFat: number | null`
  - `saveLog(userId, entry)` accepts `entry.satFat`
  - `updateLog(userId, id, fields)` accepts `fields.satFat`
  - `rowToTargets(r)` returns object with `satFatPct: number | null`
  - `saveTargets(userId, targets)` accepts `targets.satFatPct`
  - `scaleComponentMacros(item, amountG)` returns object with `satFat: number | null`

- [ ] **Step 1: Write failing tests for rowToItem and rowToLog**

Add to `tests/data.test.js` (or create the file if missing, following existing test patterns):

```js
// satFatPerServing mapped in rowToItem
assert.strictEqual(
  window.FoodLogData._rowToItem({ sat_fat_per_serving: 3.5, protein_per_serving: null, carbs_per_serving: null, fat_per_serving: null, calories_per_serving: null }).satFatPerServing,
  3.5,
  'rowToItem maps sat_fat_per_serving'
);
assert.strictEqual(
  window.FoodLogData._rowToItem({ sat_fat_per_serving: null, protein_per_serving: null, carbs_per_serving: null, fat_per_serving: null, calories_per_serving: null }).satFatPerServing,
  null,
  'rowToItem: sat_fat_per_serving null stays null'
);

// satFat mapped in rowToLog
assert.strictEqual(
  window.FoodLogData._rowToLog({ sat_fat: 2.1 }).satFat,
  2.1,
  'rowToLog maps sat_fat'
);
assert.strictEqual(
  window.FoodLogData._rowToLog({ sat_fat: null }).satFat,
  null,
  'rowToLog: sat_fat null stays null'
);

// satFatGTarget derived correctly
assert.strictEqual(
  window.FoodLogData.satFatGTarget({ caloriesTarget: 2000, satFatPct: 5 }),
  11.1,
  'satFatGTarget: 2000 cal × 5% / 9 = 11.1g'
);
assert.strictEqual(
  window.FoodLogData.satFatGTarget({ caloriesTarget: null, satFatPct: 6 }),
  null,
  'satFatGTarget: null when no caloriesTarget'
);
assert.strictEqual(
  window.FoodLogData.satFatGTarget({ caloriesTarget: 2000, satFatPct: null }),
  null,
  'satFatGTarget: null when no satFatPct'
);
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
node tests/data.test.js
```

Expected: failures referencing `satFatPerServing`, `satFat`, `satFatGTarget`.

- [ ] **Step 3: Update rowToItem**

In `food-log-data.js`, find `function rowToItem(r)` (~line 157). After `caffeinePerServing: r.caffeine_per_serving != null ? r.caffeine_per_serving : null,` add:

```js
satFatPerServing: r.sat_fat_per_serving != null ? r.sat_fat_per_serving : null,
```

- [ ] **Step 4: Update saveLibraryItem**

In `saveLibraryItem` (~line 197), after the `caffeine_per_serving` line add:

```js
sat_fat_per_serving: item.satFatPerServing != null ? item.satFatPerServing : null,
```

- [ ] **Step 5: Update updateLibraryItem**

In `updateLibraryItem` (~line 232), after the `caffeinePerServing` conditional add:

```js
if (fields.satFatPerServing !== undefined) body.sat_fat_per_serving = fields.satFatPerServing;
```

- [ ] **Step 6: Update rowToLog**

In `function rowToLog(r)` (~line 31), after `sodium: r.sodium,` add:

```js
satFat: r.sat_fat != null ? r.sat_fat : null,
```

- [ ] **Step 7: Update saveLog**

In `saveLog` (~line 81), after `sodium: entry.sodium != null ? entry.sodium : null,` add:

```js
sat_fat: entry.satFat != null ? entry.satFat : null,
```

- [ ] **Step 8: Update updateLog**

In `updateLog` (~line 109), after `if (fields.sodium !== undefined) body.sodium = fields.sodium;` add:

```js
if (fields.satFat !== undefined) body.sat_fat = fields.satFat;
```

- [ ] **Step 9: Update rowToTargets**

In `function rowToTargets(r)` (~line 249), after `sodiumTarget: r.sodium_target,` add:

```js
satFatPct: r.sat_fat_pct != null ? r.sat_fat_pct : null,
```

- [ ] **Step 10: Update saveTargets**

In `saveTargets` (~line 275), after `sodium_target: targets.sodiumTarget != null ? targets.sodiumTarget : null,` add:

```js
sat_fat_pct: targets.satFatPct != null ? targets.satFatPct : null,
```

- [ ] **Step 11: Update scaleComponentMacros**

In `scaleComponentMacros` (~line 327), after `sodium: sc(item.sodiumPerServing)` add:

```js
satFat: sc(item.satFatPerServing),
```

- [ ] **Step 12: Export satFatGTarget**

Add `satFatGTarget` as a helper function just before the `// ── Exports` comment block:

```js
function satFatGTarget(targets) {
  if (!targets || targets.satFatPct == null || !targets.caloriesTarget) return null;
  return Math.round(targets.caloriesTarget * targets.satFatPct / 100 / 9 * 10) / 10;
}
```

Then add it to the `window.FoodLogData` exports object:

```js
satFatGTarget: satFatGTarget,
```

- [ ] **Step 13: Run tests — confirm they pass**

```bash
node tests/data.test.js
```

Expected: all tests pass (including the one known pre-existing failure about "distributes 4 gels evenly" — that's a pre-existing off-by-one in the assertion, not a regression).

- [ ] **Step 14: Commit**

```bash
git add food-log-data.js tests/data.test.js
git commit -m "feat: add saturated fat to food-log-data.js data layer"
```

---

### Task 3: Food log tracker + food library form — food-log.js

**Files:**
- Modify: `food-log.js`

**Interfaces:**
- Consumes: `satFatPerServing` from `rowToItem` (Task 2), `satFat` from `rowToLog` (Task 2), `satFatGTarget(targets)` exported on `window.FoodLogData` (Task 2).
- Produces: food log progress row for "Saturated Fat"; food library edit form field for "Saturated Fat".

- [ ] **Step 1: Add --m-sat-fat CSS token**

In `style.css`, find the macro color tokens block (~line 1575):
```css
--m-protein: #0a52a0;
--m-carbs:   #b45309;
--m-fat:     #6d28d9;
--m-fiber:   #1a7a31;
--m-sodium:  #0e6674;
```

Add after `--m-sodium`:
```css
--m-sat-fat: #e8a838;
```

- [ ] **Step 2: Add satFat to macroMetaFromValues**

In `food-log.js`, find `function macroMetaFromValues(v)` (~line 26). After `if (v.sodium != null) ...` add:

```js
if (v.satFat != null) meta.push(Math.round(v.satFat * 10) / 10 + 'g sat fat');
```

- [ ] **Step 3: Add satFat to itemMacroMeta**

In `itemMacroMeta(item)` (~line 38), add `satFat: item.satFatPerServing` to the object passed to `macroMetaFromValues`:

```js
function itemMacroMeta(item) {
  return macroMetaFromValues({
    calories: item.caloriesPerServing,
    protein:  item.proteinPerServing,
    carbs:    item.carbsPerServing,
    fat:      item.fatPerServing,
    fiber:    item.fiberPerServing,
    sodium:   item.sodiumPerServing,
    satFat:   item.satFatPerServing
  });
}
```

- [ ] **Step 4: Add satFat to progressHTML tracker**

In `progressHTML(logs, targets)` (~line 130):

After `var sod = ...` (~line 138), add:
```js
var satFat = logs.some(function (l) { return l.satFat != null; })
             ? Math.round(sumLogs(logs, 'satFat') * 10) / 10 : null;
var satFatTarget = window.FoodLogData.satFatGTarget(t);
```

After the Fat row in the `rows` array (~line 177), add:
```js
if (satFat !== null || satFatTarget) rows.push(macroRowHTML('Saturated Fat', satFat != null ? satFat : 0, satFatTarget, 'var(--m-sat-fat)', 'g'));
```

- [ ] **Step 5: Add satFat to formState initialisation**

In the `formState` initialisation block (~line 784), after `sodium: src ? ... : null,` add:

```js
satFat:      src ? (isLibraryEdit ? src.satFatPerServing : src.satFat) : null,
```

- [ ] **Step 6: Add Saturated Fat field to library edit form**

In `estimatedBlockHTML()`, find the library branch (~line 868):
```js
macroEditRowHTML('Fat',      'fat',      'g') +
macroEditRowHTML('Fiber',    'fiber',    'g') +
```

Change to:
```js
macroEditRowHTML('Fat',           'fat',    'g') +
macroEditRowHTML('Saturated Fat', 'satFat', 'g') +
macroEditRowHTML('Fiber',         'fiber',  'g') +
```

- [ ] **Step 7: Add Saturated Fat field to log entry form**

In the non-library (log entry) branch of `estimatedBlockHTML()` (~line 906):
```js
macroEditRowHTML('Fat',      'fat',      'g') +
macroEditRowHTML('Fiber',    'fiber',    'g') +
```

Change to:
```js
macroEditRowHTML('Fat',           'fat',    'g') +
macroEditRowHTML('Saturated Fat', 'satFat', 'g') +
macroEditRowHTML('Fiber',         'fiber',  'g') +
```

- [ ] **Step 8: Add satFat to the three save paths**

**Save path 1 — updateLibraryItem** (~line 1581):
After `fiberPerServing: formState.fiber, sodiumPerServing: formState.sodium` add:
```js
satFatPerServing: formState.satFat,
```

**Save path 2 — saveLibraryItem (libraryOnlyMode)** (~line 1620):
After `fiberPerServing: formState.fiber, sodiumPerServing: formState.sodium` add:
```js
satFatPerServing: formState.satFat,
```

**Save path 3 — updateLog (isEdit)** (~line 1598):
After `fiber: formState.fiber, sodium: formState.sodium,` add:
```js
satFat: formState.satFat,
```

**Save path 4 — saveLog (new entry)** (~line 1642):
After `sodium: _N > 1 ? _divN(formState.sodium) : formState.sodium,` add:
```js
satFat: _N > 1 ? _divN(formState.satFat) : formState.satFat,
```

**Save path 5 — saveLibraryItem (save-to-library checkbox, ~line 1655)**:
After `fiberPerServing: formState.fiber, sodiumPerServing: formState.sodium,` add:
```js
satFatPerServing: formState.satFat,
```

- [ ] **Step 9: Add satFat to parseMeal result handler in food-log.js**

In the parse button handler (~line 1488), after `formState.sodium = result.sodium;` add:
```js
formState.satFat = result.sat_fat != null ? result.sat_fat : null;
```

- [ ] **Step 10: Smoke test**

Start the dev server:
```bash
lsof -ti:8080 | xargs kill -9 2>/dev/null; npx serve . -p 8080 &
timeout 15 bash -c 'until curl -sf http://localhost:8080 >/dev/null; do sleep 1; done'
```

Run Playwright:
```js
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  await page.goto('http://localhost:8080');
  await page.evaluate(() => { localStorage.setItem('fuelPlanner.userId', 'test-user-id'); });
  await page.goto('http://localhost:8080');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: '/tmp/food-log.png' });
  if (errors.length) console.error('Console errors:', errors);
  await browser.close();
})();
```

Verify: no console errors on load.

- [ ] **Step 11: Commit**

```bash
git add food-log.js style.css
git commit -m "feat: add Saturated Fat to food log tracker and library form"
```

---

### Task 4: Settings slider — food-log.js renderFoodLogTargets

**Files:**
- Modify: `food-log.js` (function `renderFoodLogTargets`, ~line 1712)

**Interfaces:**
- Consumes: `targets.satFatPct` (number | null), `targets.caloriesTarget` (number | null) — from `rowToTargets` (Task 2).
- Produces: `<input type="range" data-key="satFatPct">` saved via existing `[data-key]` save handler; disabled when `caloriesTarget` is null.

- [ ] **Step 1: Add the slider row helper**

Inside `renderFoodLogTargets`, after the `inputRow` helper function definition (~line 1725), add a `sliderRow` helper:

```js
function sliderRow(label, key, pct, caloriesTarget) {
  var val = pct != null ? pct : 6;
  var disabled = !caloriesTarget;
  var derivedG = (!disabled && pct != null)
    ? Math.round(caloriesTarget * pct / 100 / 9 * 10) / 10
    : null;
  var liveLabel = disabled
    ? val + '%'
    : val + '% · ' + (derivedG != null ? derivedG + 'g/day' : '—');
  return '<div class="fl-target-row">' +
    '<span class="fl-targets-label">' + label + '</span>' +
    '<div style="display:flex;align-items:center;gap:8px;flex:1">' +
      '<input class="fl-targets-slider" type="range" min="0" max="10" step="1"' +
        ' data-key="' + key + '"' +
        ' value="' + val + '"' +
        (disabled ? ' disabled style="opacity:0.4"' : '') + '>' +
      '<span class="fl-targets-slider-label" id="fl-slider-sat-fat-label">' + liveLabel + '</span>' +
    '</div>' +
  '</div>';
}
```

- [ ] **Step 2: Replace any existing sat fat inputRow with sliderRow**

In `renderFoodLogTargets`, find the `$body.innerHTML = ...` block (~line 1733). After the Fat row, add the slider row (there is no existing sat fat row — this is new):

Change the `$body.innerHTML` assignment to include the slider after `inputRow('Fat', 'fatTarget', 'g/day')`:

```js
inputRow('Fat',   'fatTarget',  'g/day') +
sliderRow('Saturated Fat', 'satFatPct', targets.satFatPct, targets.caloriesTarget) +
inputRow('Fiber', 'fiberTarget', 'g/day') +
```

- [ ] **Step 3: Wire up live label update on slider input**

After the existing save handler (`_A.on(_A.$('fl-targets-save'), ...)`) but before the back button handler, add:

```js
var sliderEl = $body.querySelector('[data-key="satFatPct"]');
var sliderLabelEl = _A.$('fl-slider-sat-fat-label');
if (sliderEl && sliderLabelEl) {
  _A.on(sliderEl, 'input', function () {
    var pct = parseInt(sliderEl.value, 10);
    var calInput = $body.querySelector('[data-key="caloriesTarget"]');
    var cal = calInput ? parseFloat(calInput.value) : null;
    if (cal && cal > 0) {
      var g = Math.round(cal * pct / 100 / 9 * 10) / 10;
      sliderLabelEl.textContent = pct + '% · ' + g + 'g/day';
    } else {
      sliderLabelEl.textContent = pct + '%';
    }
  });
}
```

- [ ] **Step 4: Ensure save handler coerces range value to number**

Find the existing save handler's `forEach` loop (~line 1753):

```js
_A.$$('[data-key]', $body).forEach(function (input) {
  var val = input.value.trim();
  updated[input.dataset.key] = val !== '' ? Math.max(0, parseFloat(val) || 0) : null;
});
```

`parseFloat` already handles range string values correctly — verify this handles `type="range"` (value is never empty for a range input, so it will always produce a number). No change needed here, but confirm in the smoke test.

- [ ] **Step 5: Smoke test settings slider**

Using Playwright, navigate to the food-log-targets settings view:

```js
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  await page.goto('http://localhost:8080');
  await page.evaluate(() => { localStorage.setItem('fuelPlanner.userId', 'test-user-id'); });
  await page.goto('http://localhost:8080');
  await page.waitForTimeout(1500);
  // Navigate to settings
  await page.evaluate(() => { window._A && window._A.navigate('food-log-targets'); });
  await page.waitForTimeout(800);
  await page.screenshot({ path: '/tmp/settings.png' });
  // Check slider is present
  const slider = await page.$('[data-key="satFatPct"]');
  console.log('Slider present:', !!slider);
  if (errors.length) console.error('Console errors:', errors);
  await browser.close();
})();
```

Verify: slider renders, label shows `6%` when no calorie target, slider is disabled (greyed). With a calorie target set, label shows e.g. `6% · 13.3g/day`.

- [ ] **Step 6: Commit**

```bash
git add food-log.js
git commit -m "feat: add Saturated Fat percentage slider to settings"
```

---

### Task 5: Adhoc item form — index.html + app.js

**Files:**
- Modify: `index.html`
- Modify: `app.js`

**Interfaces:**
- Consumes: `parsed.sat_fat` from parseMeal edge function response (Task 6, but can be wired now — gracefully handles null).
- Produces: `satFatPerServing` field on the saved library item / event item.

- [ ] **Step 1: Add Saturated Fat input to index.html**

In `index.html`, find the Fat/Fiber row (~line 383):

```html
<div class="form-row">
  <div class="form-group">
    <label for="oo-fat">Fat (g)</label>
    <input id="oo-fat" class="form-input" type="number" min="0" placeholder="0">
  </div>
  <div class="form-group">
    <label for="oo-fiber">Fiber (g)</label>
    <input id="oo-fiber" class="form-input" type="number" min="0" placeholder="0">
  </div>
</div>
```

Change to:

```html
<div class="form-row">
  <div class="form-group">
    <label for="oo-fat">Fat (g)</label>
    <input id="oo-fat" class="form-input" type="number" min="0" placeholder="0">
  </div>
  <div class="form-group">
    <label for="oo-sat-fat">Saturated Fat (g)</label>
    <input id="oo-sat-fat" class="form-input" type="number" min="0" placeholder="0">
  </div>
</div>
<div class="form-row">
  <div class="form-group">
    <label for="oo-fiber">Fiber (g)</label>
    <input id="oo-fiber" class="form-input" type="number" min="0" placeholder="0">
  </div>
</div>
```

- [ ] **Step 2: Add satFatPerServing to save handler in app.js**

In `app.js`, find the adhoc form save handler object (~line 3285). After `fiberPerServing: $("oo-fiber").value !== '' ? Number($("oo-fiber").value) : null,` add:

```js
satFatPerServing: $("oo-sat-fat").value !== '' ? Number($("oo-sat-fat").value) : null,
```

- [ ] **Step 3: Populate oo-sat-fat from parseMeal result**

In the adhoc parse button handler (~line 3339), after `$("oo-fiber").value = fiber > 0 ? fiber : '';` add:

```js
var satFat = Math.round(parsed.sat_fat || 0);
$("oo-sat-fat").value = satFat > 0 ? satFat : '';
```

- [ ] **Step 4: Reset oo-sat-fat on sheet close**

Find where other `oo-*` fields are reset on sheet close (search for `$("oo-carbs").value`). Add:

```js
$("oo-sat-fat").value = '';
```

alongside the other resets.

- [ ] **Step 5: Smoke test adhoc form**

```js
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  await page.goto('http://localhost:8080');
  await page.evaluate(() => { localStorage.setItem('fuelPlanner.userId', 'test-user-id'); });
  await page.goto('http://localhost:8080');
  await page.waitForTimeout(1500);
  // Open the sheet overlay manually
  await page.evaluate(() => {
    var sheet = document.getElementById('sheet-overlay');
    if (sheet) sheet.classList.remove('hidden');
    var addSheet = document.getElementById('sheet-add-item');
    if (addSheet) addSheet.classList.remove('hidden');
    var details = document.getElementById('adhoc-manual-details');
    if (details) details.open = true;
  });
  await page.screenshot({ path: '/tmp/adhoc-form.png' });
  const satFatInput = await page.$('#oo-sat-fat');
  console.log('Sat fat input present:', !!satFatInput);
  if (errors.length) console.error('Console errors:', errors);
  await browser.close();
})();
```

Verify: `#oo-sat-fat` is visible in the adhoc form.

- [ ] **Step 6: Commit**

```bash
git add index.html app.js
git commit -m "feat: add Saturated Fat field to adhoc item form"
```

---

### Task 6: LLM edge function — parse-meal/index.ts

**Files:**
- Modify: `supabase/functions/parse-meal/index.ts`

**Interfaces:**
- Produces: `ParseResult.sat_fat: number | null` — consumed by `app.js` adhoc handler (Task 5 step 3) and `food-log.js` parse handler (Task 3 step 9).

- [ ] **Step 1: Add sat_fat to LibraryItem interface**

In `index.ts` (~line 4), add to the `LibraryItem` interface:

```ts
interface LibraryItem {
  id: string;
  name: string;
  calories_per_serving: number;
  protein_per_serving: number;
  carbs_per_serving: number;
  fat_per_serving: number;
  sat_fat_per_serving: number | null;
  fiber_per_serving: number | null;
  sodium_per_serving: number | null;
  serving_unit: string | null;
}
```

- [ ] **Step 2: Add sat_fat to ParseResult interface**

In `index.ts` (~line 16), add to `ParseResult`:

```ts
interface ParseResult {
  name: string;
  protein: number;
  carbs: number;
  fat: number;
  sat_fat: number | null;
  calories: number;
  fiber: number | null;
  sodium: number | null;
  ai_estimated: boolean;
  library_item_id: string | null;
  serving_multiplier: number;
  confidence: 'high' | 'medium' | 'low';
  ai_notes: string | null;
}
```

- [ ] **Step 3: Update system prompt**

In the system prompt string (~line 52), add a rule after the fiber/sodium rule:

```
- sat_fat is saturated fat in grams. Estimate from USDA data when the food is known (e.g. butter ≈ 51g/100g, cheddar cheese ≈ 20g/100g, whole milk ≈ 2.3g/100ml, chicken breast ≈ 0.9g/100g, olive oil ≈ 14g/100g). May be null if the food is unusual or sat fat is genuinely unknown.
```

Update the JSON schema in the prompt (after `"sodium": number | null,`) to add:

```
"sat_fat": number | null,
```

The full updated schema block should read:
```
{
  "name": "string — clean meal name",
  "protein": number,
  "carbs": number,
  "fat": number,
  "sat_fat": number | null,
  "calories": number,
  "fiber": number | null,
  "sodium": number | null,
  "ai_estimated": boolean,
  "library_item_id": string | null,
  "serving_multiplier": number,
  "confidence": "high" | "medium" | "low",
  "ai_notes": string | null
}
```

- [ ] **Step 4: Deploy edge function**

```bash
supabase functions deploy parse-meal
```

- [ ] **Step 5: Manual test**

Use curl or the app's adhoc form to look up "100g cheddar cheese". Verify `sat_fat` is returned (expect roughly 20).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/parse-meal/index.ts
git commit -m "feat: add sat_fat estimation to parse-meal edge function"
```

---

### Task 7: Commit spec + plan, final verification

**Files:**
- Commit: `docs/superpowers/specs/2026-10-01-saturated-fat-design.md`
- Commit: `docs/superpowers/plans/2026-10-01-saturated-fat.md`

- [ ] **Step 1: Run all tests**

```bash
node tests/data.test.js
node tests/export.test.js
```

Expected: all pass (one known pre-existing failure: "distributes 4 gels evenly" — not a regression).

- [ ] **Step 2: End-to-end Playwright verification**

```js
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  await page.goto('http://localhost:8080');
  await page.evaluate(() => { localStorage.setItem('fuelPlanner.userId', 'test-user-id'); });
  await page.goto('http://localhost:8080');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: '/tmp/final-food-log.png' });
  if (errors.length) console.error('Console errors:', errors);
  await browser.close();
})();
```

Verify: no console errors; food log loads without crashing.

- [ ] **Step 3: Commit docs**

```bash
git add docs/superpowers/specs/2026-10-01-saturated-fat-design.md docs/superpowers/plans/2026-10-01-saturated-fat.md
git commit -m "docs: add saturated fat spec and implementation plan"
```

- [ ] **Step 4: Push and open PR**

Follow `superpowers:finishing-a-development-branch` to push the feature branch and open a PR against master.
