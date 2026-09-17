# Flexible Serving Size Units Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to save and display food items with any serving unit (g, oz, slice, piece, etc.) in both the food library and food log, and to change the unit of an existing item without altering its macros.

**Architecture:** The DB already has `serving_unit` on `food_library`; a new migration adds `log_serving_size` / `log_serving_unit` to `food_logs`. The data layer in `food-log-data.js` is updated to read/write these fields. The UI in `food-log.js` replaces hardcoded `g` spans with editable text inputs backed by a `<datalist>` for common-unit autocomplete. Unit is a display label only — no conversion math anywhere.

**Tech Stack:** Vanilla JS (no build step), Supabase REST API, CSS design tokens from `style.css`.

**Spec:** `docs/superpowers/specs/2026-09-17-flexible-serving-units-design.md`

## Global Constraints

- No npm install or build step — plain JS files only.
- All colours via CSS custom properties from `style.css` (`var(--text-2)`, `var(--border)`, `var(--accent)`) — no hardcoded hex/rgb values.
- Never surface "AI-estimated" or "AI-generated" labels in the UI.
- New DB columns must be nullable with no backfill SQL.
- Unit is a display-only label — no unit-conversion math anywhere in the codebase.
- The project runs tests with `node tests/data.test.js` and `node tests/export.test.js` (no npm needed).
- Dev server: `lsof -ti:8080 | xargs kill -9 2>/dev/null; npx serve . -p 8080`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `migrations/0009_food_log_serving_unit.sql` | Create | Adds `log_serving_size REAL` and `log_serving_unit TEXT` to `food_logs` |
| `food-log-data.js` | Modify | `rowToLog`, `saveLog`, `updateLog` — wire new log fields |
| `food-log.js` | Modify | Unit text input in 4 UI areas; `formState` for `servingUnit`/`logServingUnit` |
| `style.css` | Modify | `.fl-unit-input` rule |

---

### Task 1: DB Migration — add `log_serving_size` and `log_serving_unit` to `food_logs`

**Files:**
- Create: `migrations/0009_food_log_serving_unit.sql`

**Interfaces:**
- Produces: two nullable columns (`log_serving_size REAL`, `log_serving_unit TEXT`) on `food_logs`; Task 2 reads these column names.

- [ ] **Step 1: Create the migration file**

```sql
-- migrations/0009_food_log_serving_unit.sql
ALTER TABLE food_logs ADD COLUMN IF NOT EXISTS log_serving_size REAL;
ALTER TABLE food_logs ADD COLUMN IF NOT EXISTS log_serving_unit TEXT;
```

`IF NOT EXISTS` is safe to re-run; both columns are nullable with no default — no backfill needed.

- [ ] **Step 2: Apply to local Supabase (if running locally) or note for manual apply**

The project applies migrations manually via the Supabase dashboard or CLI. Confirm the file is present and correct — no automated test runner for migrations.

- [ ] **Step 3: Verify the migration file is syntactically valid**

```bash
# Simple check: no syntax errors, correct table name
grep -q "food_logs" migrations/0009_food_log_serving_unit.sql && echo "OK"
```

- [ ] **Step 4: Commit**

```bash
git add migrations/0009_food_log_serving_unit.sql
git commit -m "feat: migration — add log_serving_size and log_serving_unit to food_logs"
```

---

### Task 2: Data layer — wire `log_serving_size` / `log_serving_unit` in `food-log-data.js`

**Files:**
- Modify: `food-log-data.js`

**Interfaces:**
- Consumes: column names `log_serving_size`, `log_serving_unit` from Task 1.
- Produces:
  - `rowToLog(row)` returns `{ ..., logServingSize: number|null, logServingUnit: string|null }`
  - `saveLog(userId, entry)` writes `log_serving_size` and `log_serving_unit` when present on `entry`
  - `updateLog(userId, id, fields)` already does a partial PATCH — no structural change needed, just verify the two new camelCase keys map to snake_case column names correctly.

- [ ] **Step 1: Read the current `food-log-data.js`**

Open `food-log-data.js` and locate `rowToLog`, `saveLog`, and `updateLog`.

- [ ] **Step 2: Update `rowToLog` to include the two new fields**

Find the `rowToLog` function (maps a raw DB row to a JS object). Add:

```js
logServingSize: row.log_serving_size ?? null,
logServingUnit: row.log_serving_unit ?? null,
```

alongside the existing fields.

- [ ] **Step 3: Update `saveLog` to write the new fields**

In `saveLog`, in the object passed to the Supabase POST, add:

```js
log_serving_size: entry.logServingSize != null ? entry.logServingSize : null,
log_serving_unit: entry.logServingUnit != null ? entry.logServingUnit : null,
```

- [ ] **Step 4: Verify `updateLog` handles the new fields**

`updateLog` does a PATCH with only the keys passed in `fields`. Confirm that if a caller passes `{ logServingSize: 2, logServingUnit: 'slice' }`, those keys are translated to snake_case before the PATCH. If the function translates camelCase → snake_case generically, it already works. If it has an explicit allowlist, add the two new keys.

Look for the translation logic and add if needed:

```js
if (fields.logServingSize !== undefined) body.log_serving_size = fields.logServingSize;
if (fields.logServingUnit !== undefined) body.log_serving_unit = fields.logServingUnit;
```

- [ ] **Step 5: Run the existing tests to confirm no regressions**

```bash
node tests/data.test.js
```

Expected: same pass/fail as before (one known pre-existing failure is acceptable — see CLAUDE.md).

- [ ] **Step 6: Commit**

```bash
git add food-log-data.js
git commit -m "feat: wire log_serving_size and log_serving_unit through data layer"
```

---

### Task 3: Unit input in library add/edit form and save-to-library row (`food-log.js` + `style.css`)

This task adds the unit text input to two places in `renderFoodLogEntry()`:
1. The library item "Size" field (`estimatedBlockHTML()`, ~line 508).
2. The "Save to library" serving size row (~line 687).

It also adds the `.fl-unit-input` CSS rule.

**Files:**
- Modify: `food-log.js`
- Modify: `style.css`

**Interfaces:**
- Consumes: `formState.servingUnit` (string) — must be added to `formState` init alongside `servingSize`.
- Produces:
  - `formState.servingUnit` is read/written by the existing `input[data-macro]` handler (which already sets `formState[el.dataset.macro] = el.value`).
  - When saving to library, `servingUnit` from either the "save-to-library" unit field or `formState.servingUnit` is passed to `saveLibraryItem`.

- [ ] **Step 1: Open `food-log.js` and locate `estimatedBlockHTML()`**

Find the block around line 508 that renders the "Size" row for library mode:

```html
<input class="fl-macro-edit-value" type="number" min="0"
       data-macro="servingSize" value="${formState.servingSize ?? ''}" placeholder="—">
<span class="fl-macro-edit-unit">g</span>
```

- [ ] **Step 2: Replace the hardcoded `g` span with a text input + datalist**

Replace ONLY the `<span class="fl-macro-edit-unit">g</span>` and its containing structure with:

```html
<input type="text" class="fl-macro-edit-unit fl-unit-input"
       data-macro="servingUnit"
       value="${formState.servingUnit ?? ''}"
       placeholder="g"
       list="fl-unit-suggestions"
       autocomplete="off">
<datalist id="fl-unit-suggestions">
  <option value="g">
  <option value="oz">
  <option value="ml">
  <option value="tsp">
  <option value="tbsp">
  <option value="cup">
  <option value="slice">
  <option value="piece">
  <option value="serving">
</datalist>
```

The `data-macro="servingUnit"` attribute means the existing `input[data-macro]` change handler in the form will automatically update `formState.servingUnit` — no new handler needed.

- [ ] **Step 3: Add `servingUnit` to `formState` initialisation**

Find where `formState` is initialised (will include `servingSize`). Add `servingUnit` alongside it:

```js
servingUnit: editingItem?.servingUnit ?? '',
```

When editing an existing library item, pre-fill from `state.editingLibraryItem.servingUnit`. When creating new, start empty (placeholder `"g"` shows the default).

- [ ] **Step 4: Locate the save-to-library row (~line 687) and update it**

Find this block:

```html
<div id="fl-save-library-size-row" style="display:none;...">
  <label style="...">
    Serving size (g)
    <input class="fl-macro-edit-value" type="number" min="0"
           id="fl-save-library-size" style="width:80px">
  </label>
</div>
```

Replace with (keeping the same outer `div` id and styles):

```html
<div id="fl-save-library-size-row" style="display:none;margin-top:6px;padding-left:2px">
  <label style="font-size:13px;color:var(--text-2);display:flex;align-items:center;gap:8px">
    Serving size
    <input class="fl-macro-edit-value" type="number" min="0"
           id="fl-save-library-size" style="width:80px" placeholder="—">
    <input type="text" class="fl-unit-input"
           id="fl-save-library-unit"
           placeholder="g"
           list="fl-unit-suggestions"
           autocomplete="off">
  </label>
</div>
```

The `<datalist id="fl-unit-suggestions">` rendered in Step 2 is shared — it only needs to exist once per page render, so no duplication needed here.

- [ ] **Step 5: Wire the unit field when saving to library**

Find the handler that reads `fl-save-library-size` and calls `saveLibraryItem`. Add:

```js
const servingUnit = document.getElementById('fl-save-library-unit')?.value.trim() || null;
```

Pass `servingUnit` into the `saveLibraryItem` call alongside `servingSize`.

- [ ] **Step 6: Add `.fl-unit-input` to `style.css`**

Find the section with `.fl-macro-edit-unit` rules in `style.css`. After them, add:

```css
.fl-unit-input {
  width: 54px;
  font-size: inherit;
  color: var(--text-2);
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--border);
  outline: none;
  padding: 0 2px;
  text-align: left;
}
.fl-unit-input:focus {
  border-bottom-color: var(--accent);
}
```

- [ ] **Step 7: Manual smoke test**

Start dev server (`lsof -ti:8080 | xargs kill -9 2>/dev/null; npx serve . -p 8080`). Open the app, navigate to the food library, and:
- Add a new item with unit `"slice"` — confirm it saves and shows `per 1 slice` in the list.
- Edit that item, change unit to `"piece"` — confirm macros are unchanged.
- Navigate to food log, check a meal, check "Save to library", enter a serving size and type `"oz"` — confirm the library item is saved with unit `"oz"`.

- [ ] **Step 8: Run tests**

```bash
node tests/data.test.js && node tests/export.test.js
```

- [ ] **Step 9: Commit**

```bash
git add food-log.js style.css
git commit -m "feat: replace hardcoded 'g' unit with editable unit input in library forms"
```

---

### Task 4: Unit field in edit log entry form + log entry display

This task covers two areas:
1. The "edit log entry" form (`isEdit === true`) — show and allow editing `logServingSize` / `logServingUnit` without touching macros.
2. Display the serving unit on log entries in the log list wherever a serving size is shown.

**Files:**
- Modify: `food-log.js`

**Interfaces:**
- Consumes:
  - `logEntry.logServingSize` and `logEntry.logServingUnit` from Task 2's `rowToLog`.
  - `updateLog(userId, id, { logServingSize, logServingUnit })` from Task 2.
  - `formState.servingUnit`-style pattern from Task 3 (same `data-macro` handler approach).
  - `fl-unit-suggestions` datalist from Task 3 (shared, already in the DOM when this form renders).
- Produces: edited log entries with updated serving unit stored in DB, macros unchanged.

- [ ] **Step 1: Open `food-log.js` and locate the edit log entry form block (`isEdit === true`)**

Find where the "Estimated Macros" edit layout is rendered when `isEdit` is true (around lines 524–539). This block renders macro inputs (protein, carbs, etc.) pre-populated from the log entry.

- [ ] **Step 2: Add a "Serving" row to the edit log entry form**

After the existing macro rows (protein, carbs, fat, calories, fiber, sodium), add a serving row using the same `macroEditRowHTML` pattern or inline markup:

```html
<div class="fl-macro-edit-row">
  <span class="fl-macro-edit-label">Serving</span>
  <div class="fl-macro-edit-value-wrap">
    <input class="fl-macro-edit-value" type="number" min="0"
           data-macro="logServingSize"
           value="${formState.logServingSize ?? ''}" placeholder="—">
    <input type="text" class="fl-macro-edit-unit fl-unit-input"
           data-macro="logServingUnit"
           value="${formState.logServingUnit ?? ''}"
           placeholder="g"
           list="fl-unit-suggestions"
           autocomplete="off">
  </div>
</div>
```

- [ ] **Step 3: Add `logServingSize` and `logServingUnit` to `formState` initialisation (edit path)**

In the `formState` init for the edit path, alongside the macro fields, add:

```js
logServingSize: editingEntry?.logServingSize ?? null,
logServingUnit: editingEntry?.logServingUnit ?? '',
```

The existing `data-macro` change handler will update these automatically.

- [ ] **Step 4: Patch serving fields on save**

Find the save handler for the edit log entry form. When building the update payload, add:

```js
if (formState.logServingSize !== null || formState.logServingUnit) {
  updatePayload.logServingSize = formState.logServingSize != null
    ? Number(formState.logServingSize) : null;
  updatePayload.logServingUnit = formState.logServingUnit?.trim() || null;
}
```

This patches only the serving fields — macro fields in the payload are only included if the user changed them (existing behaviour).

- [ ] **Step 5: Show serving unit in the log entry display (log list)**

Find where a log entry is rendered in the food log list (the card/row that shows after logging). If the entry has `logServingSize` and `logServingUnit`, add a small meta line:

```js
// In the log entry card HTML:
const servingMeta = entry.logServingSize != null
  ? `${entry.logServingSize}${entry.logServingUnit ? ' ' + entry.logServingUnit : ''}`
  : null;
// Render servingMeta alongside the entry name if present
```

Render it only when present — no change to the display for existing entries without a unit.

- [ ] **Step 6: Manual smoke test**

- Log a meal (freeform). Open the edit form — confirm "Serving" row appears, empty.
- Enter `1` and `plate` in the Serving row. Save. Confirm the log entry shows `1 plate` and macros are unchanged.
- Open edit form again. Change unit to `serving`. Save. Confirm macros still unchanged.

- [ ] **Step 7: Run tests**

```bash
node tests/data.test.js && node tests/export.test.js
```

- [ ] **Step 8: Commit**

```bash
git add food-log.js
git commit -m "feat: add editable serving unit to log entry edit form and display"
```
