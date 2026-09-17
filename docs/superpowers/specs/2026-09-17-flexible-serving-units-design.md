# Flexible Serving Size Units — Design Spec

**Date:** 2026-09-17
**Status:** Approved for implementation

---

## Problem

The food library and food log hardcode `g` (grams) as the only serving unit. Real foods are naturally expressed in other units: "1 slice" of bread, "2 oz" of juice, "5 pieces" of pretzels, "1 plate" of takeout. Users cannot:

1. Save a library item with a non-gram unit.
2. Change a serving label (e.g., `26 g` → `1 slice`) on an existing library item or log entry without also re-entering macros.

---

## Goals

1. Let users express any serving unit when creating or editing food library items.
2. Let users express any serving unit when saving a new item from the food log to the library.
3. Let users **change the serving unit of an existing library item without touching macros**.
4. Let users **change the serving unit of an existing log entry without touching macros**.
5. Show the correct unit wherever a serving size is displayed (library list, log entry, edit form).

---

## Non-Goals

- Unit conversion math (e.g., "26 g = 1 slice"). Units are labels only.
- Changing the scaling math in build mode (`scaleComponentMacros`). It continues to divide by `serving_size` numerically; unit is display-only.
- Retroactively updating old log entries when a library item's unit changes.

---

## Data Model

### `food_library` — no migration needed

Both columns already exist:

| Column | Type | Notes |
|--------|------|-------|
| `serving_size` | REAL | Numeric portion of one serving |
| `serving_unit` | TEXT | Label, e.g. `"g"`, `"slice"`, `"oz"` |

### `food_logs` — new migration `0009_food_log_serving_unit.sql`

| Column | Type | Notes |
|--------|------|-------|
| `log_serving_size` | REAL nullable | Numeric portion as logged |
| `log_serving_unit` | TEXT nullable | Label as logged |

These are display/reference fields. They do **not** affect the stored macro values. `NULL` = not specified (no backfill needed).

---

## UX: Unit Input

**Pattern:** A short free-text `<input type="text">` (~50 px wide) placed immediately after the numeric serving-size input, replacing the hardcoded `<span>g</span>`. Placeholder is `"g"`. A `<datalist>` provides autocomplete suggestions without forcing selection:

```
g  oz  ml  tsp  tbsp  cup  slice  piece  serving
```

Rationale: the unit space is unbounded ("plate", "can", "5 pieces"). A dropdown cannot cover it; a free-text field with autocomplete hints covers both the common case (fast) and the custom case (flexible).

---

## Affected UI Areas (all in `food-log.js`)

### 1. Library item "Size" field — `estimatedBlockHTML()` (~line 508)

Currently:
```html
<input type="number" data-macro="servingSize" ...>
<span class="fl-macro-edit-unit">g</span>
```

Becomes:
```html
<input type="number" class="fl-macro-edit-value" data-macro="servingSize" ...>
<input type="text"   class="fl-macro-edit-unit fl-unit-input"
       data-macro="servingUnit" value="${formState.servingUnit ?? ''}" placeholder="g"
       list="fl-unit-suggestions" autocomplete="off">
<datalist id="fl-unit-suggestions">
  <option value="g"><option value="oz"><option value="ml">
  <option value="tsp"><option value="tbsp"><option value="cup">
  <option value="slice"><option value="piece"><option value="serving">
</datalist>
```

`servingUnit` is added to `formState`. The existing `input[data-macro]` change handler picks it up automatically because it reads `data-macro` attribute names into `formState`.

### 2. Save-to-library row (~line 687)

Currently the label text says `"Serving size (g)"` and the unit is baked in.

Becomes: a number input + unit text input (same pattern as above), with `id="fl-save-library-unit"` alongside the existing `id="fl-save-library-size"`. The unit value is passed to `saveLibraryItem`.

### 3. Edit log entry form (`isEdit === true`)

Add a "Serving" row (number + unit inputs) to the edit block. On save, patch via `updateLog({ logServingSize, logServingUnit })` — macro fields are untouched unless the user changes them.

### 4. Edit library item form (`isLibraryEdit === true`)

Pre-fill `servingUnit` from `state.editingLibraryItem.servingUnit`. Saving patches only `{ servingSize, servingUnit }` when only those changed — macros remain untouched.

---

## Affected Files

| File | Change |
|------|--------|
| `migrations/0009_food_log_serving_unit.sql` | New: add `log_serving_size`, `log_serving_unit` to `food_logs` |
| `food-log-data.js` | `rowToLog` + `saveLog` + `updateLog` — wire new fields |
| `food-log.js` | UI changes in 4 areas above + `formState` update |
| `style.css` | `.fl-unit-input` — short text input, visually consistent with `.fl-macro-edit-unit` |

---

## Styling Token (`.fl-unit-input`)

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

The design should make it look like an editable slot rather than a full form field — it reads as a suffix that happens to be editable.

---

## Verification

1. Start dev server: `lsof -ti:8080 | xargs kill -9 2>/dev/null; npx serve . -p 8080`
2. Add a new library item with unit `"oz"` — confirm it saves and shows `per 4 oz` in the library list.
3. Add a library item with unit `"slice"` — log it with multiplier `2`, confirm macros are doubled.
4. Edit an existing library item's unit from `"g"` to `"piece"` — confirm macros unchanged.
5. Edit a logged entry — change serving unit — confirm macros unchanged.
6. Run `node tests/data.test.js` and `node tests/export.test.js` — no regressions.

---

## Global Constraints

- No npm install / build step — vanilla JS only.
- Design tokens from `style.css` only — no hardcoded colour values.
- Never surface "AI-estimated" labels in the UI.
- New DB columns: nullable, no backfill.
- Unit is always a display-only label — no conversion math.
