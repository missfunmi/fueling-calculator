# Saturated Fat Macro — Design Spec

**Date:** 2026-10-01

## Context

The app tracks protein, carbs, fat, fiber, sodium, and caffeine. Users want to also monitor saturated fat intake. This adds saturated fat as a first-class nullable macro across the food library, food log, settings targets, the adhoc item form, and the LLM meal parser.

Saturated fat target is configured as a percentage of daily calories rather than an absolute gram value, because the clinical recommendation (≤ ~6–10% of daily calories) is percentage-based. The derived gram target is `(caloriesTarget × pct / 100) / 9`.

## Scope

- DB: two new migrations (food_library, food_logs, daily_targets)
- Data layer: `food-log-data.js` — rowToItem, saveLibraryItem, updateLibraryItem, rowToLog, saveLog, updateLog, rowToTargets, saveTargets, scaleComponentMacros
- Food log tracker: `food-log.js` `progressHTML`
- Settings slider: `food-log.js` `renderFoodLogTargets`
- Food library edit form: `food-log.js` `estimatedBlockHTML` and its three save paths
- Adhoc form: `index.html` + `app.js`
- LLM edge function: `supabase/functions/parse-meal/index.ts`
- CSS: new `--m-sat-fat` color token in `style.css`

**Out of scope:** event plan/log views (only carbs/sodium/caffeine shown there, by design).

## Data Model

### `food_library` (migration 0016)
New column: `sat_fat_per_serving REAL` (nullable — consistent with all other optional macros).

### `food_logs` (migration 0017)
New column: `sat_fat REAL` (nullable).

### `daily_targets` (migration 0017)
New column: `sat_fat_pct REAL` (nullable) — stores the slider percentage (0–10), **not** derived grams. This way the derived gram target auto-updates if the user later changes their calorie target.

## Derived Target

```
satFatGTarget(targets) = (targets.caloriesTarget × targets.satFatPct / 100) / 9
```

Returns `null` if either `caloriesTarget` or `satFatPct` is null. Rounded to one decimal place. This helper lives in `food-log-data.js` (or inline where needed in `food-log.js`).

## Data Layer Changes — `food-log-data.js`

| Function | Change |
|---|---|
| `rowToItem` | Add `satFatPerServing: r.sat_fat_per_serving ?? null` |
| `saveLibraryItem` | Add `sat_fat_per_serving` to the POST body |
| `updateLibraryItem` | Add `sat_fat_per_serving` to the conditional patch |
| `rowToLog` | Add `satFat: r.sat_fat ?? null` |
| `saveLog` | Add `sat_fat` to the POST body |
| `updateLog` | Add `sat_fat` to the conditional patch |
| `rowToTargets` | Add `satFatPct: r.sat_fat_pct ?? null` |
| `saveTargets` | Add `sat_fat_pct` to the upsert body |
| `scaleComponentMacros` | Add `satFat: sc(item.satFatPerServing)` |

## Food Log Tracker — `progressHTML`

Condition for showing the row: same pattern as Fiber (`any log has a value OR a target exists`).

```js
var satFat = logs.some(l => l.satFat != null)
  ? Math.round(sumLogs(logs, 'satFat') * 10) / 10 : null;
var satFatTarget = satFatGTarget(t);  // derived from caloriesTarget × satFatPct / 9
```

Row renders after Fat, before Fiber. Color: `var(--m-sat-fat)`. Unit: `g`. Label: "Saturated Fat".

When no calorie target is set: `satFatTarget` is null → row shows absolute value with no progress bar (same no-target rendering used by Sodium today).

## Settings Slider — `renderFoodLogTargets`

Replaces the existing plain `inputRow` pattern for sat fat with a slider row:

- Label: "Saturated Fat"
- `<input type="range" min="0" max="10" step="1" data-key="satFatPct">`
- Live derived label beside the handle: `6% · 13.3g/day` (updates on `input` event)
- When `caloriesTarget` is null/blank: slider rendered with `disabled` attribute and reduced opacity; live label shows only the percentage with no gram derivation
- Default value when no prior value exists: `6`

The existing save handler iterates `[data-key]` inputs generically — it will pick up the range input without modification.

## Food Library Edit Form — `food-log.js`

In `estimatedBlockHTML()`, add after the Fat row:
```js
macroEditRowHTML('Saturated Fat', 'satFat', 'g')
```

In all three save-from-form paths (~lines 1586, 1620, 1655), add:
```js
satFatPerServing: $('oo-entry-satFat') !== '' ? Number($('oo-entry-satFat').value) : null,
```
(following the existing null-coercion pattern used by fiber and sodium).

## Adhoc Form — `index.html` + `app.js`

**`index.html`**: add after the Fat field block, before Fiber:
```html
<label for="oo-sat-fat">Saturated Fat (g)</label>
<input id="oo-sat-fat" class="form-input" type="number" min="0" placeholder="0">
```

**`app.js`** parseMeal result handler: populate `$('oo-sat-fat').value = satFat > 0 ? satFat : ''`

**`app.js`** save handler: add `satFatPerServing: $('oo-sat-fat').value !== '' ? Number($('oo-sat-fat').value) : null` to the item object.

## LLM Edge Function — `parse-meal/index.ts`

**`LibraryItem` interface**: add `sat_fat_per_serving: number | null`

**`ParseResult` interface**: add `sat_fat: number | null`

**System prompt additions:**
- In the rules, add: `sat_fat` is saturated fat in grams; estimate from USDA data when the food is known (e.g. butter ≈ 51g/100g, whole milk ≈ 2.3g/100ml, chicken breast ≈ 0.9g/100g). May be null if unknown.
- In the JSON schema, add `"sat_fat": number | null`

## CSS — `style.css`

Add to the macro color tokens block:
```css
--m-sat-fat: #e8a838;   /* warm amber — distinct from --m-fat (yellowish-green) */
```

## Verification

1. Run both migrations against local Supabase
2. `node tests/data.test.js` and `node tests/export.test.js` — no regressions
3. Start dev server; Playwright:
   - Food library edit form shows "Saturated Fat (g)" field
   - Save a library item with sat fat; confirm value persists and appears in item row meta
   - Food log: log an entry with sat fat; confirm tracker row appears
   - Settings: slider defaults to 6%, live label updates, greys when calorie target is cleared
   - Adhoc form: "Look up" a food, confirm sat fat populates; save and confirm it logs correctly
4. Deploy edge function; test parseMeal with a food known to have sat fat (e.g. "100g cheddar cheese") and confirm `sat_fat` is returned
