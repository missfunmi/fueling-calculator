# Food Library Enhancements — Design Spec

**Date:** 2026-09-16
**Branch:** `docs/food-library-enhancements`

## Overview

Three related features that build on each other:

1. **Brand names** — add an optional brand field to food library items
2. **Unified library UX** — make the food library list and forms look and behave like the fuel library
3. **Multi-item meal logging** — a "Build" mode in Log Meal that lets the user combine multiple food library items (with gram-accurate scaling) alongside freeform items in a single meal log entry

---

## Feature 1 — Brand names on food library items

### What changes

- Add an optional `Brand` text field to the food item form (above `Name`)
- Display as `"Brand Name"` in the library list row (same pattern as fuel: `(item.brand ? item.brand + ' ' : '') + item.name`)
- Brand is stored on `food_library.brand` (new column)

### Data

`food_library` gains one nullable column:

```sql
ALTER TABLE food_library ADD COLUMN brand TEXT;
```

### UI

- **New / Edit Food Item form**: `Brand (optional)` input above `Name`
- **Library list row**: `product-row-name` renders `Brand Name` if brand present, just `Name` otherwise
- **Picker sheet** (inside Build mode): same — `picker-name` + `picker-brand` sub-line

---

## Feature 2 — Unified food library UX

### What changes

The food library currently uses a flat `fl-lib-item` list with a `Use` button. It should match the fuel library's style: grouped by category, `product-row` rows with name, meta line, and a chevron that opens an edit form.

#### Library list

- Group food items by `category` (same grouping logic as fuel uses for `type`)
- Each row: `product-row-name` = brand + name, `product-row-meta` = key macros + serving size, chevron `›`
- Tapping a row opens the food item edit form (existing path via `state.editingLibraryItem`)
- The `Use` button is removed from the library list; "use" now only appears in the picker sheet inside Build mode

#### Food item form

The current food item form is embedded inside `food-log-entry` via `libraryOnlyMode`. This stays as-is structurally (no new route needed), but the form fields change:

| Field | Notes |
|-------|-------|
| Brand (optional) | New — plain text input |
| Name | Existing |
| Category (optional) | Free text input; case-normalised on save (stored lowercase, displayed title-case); used for library grouping |
| Serving size | New — numeric input + fixed `g` label (not editable); stored as `food_library.serving_size REAL` |
| Calories / Protein / Carbs / Fat / Fiber / Sodium | Existing macro fields, laid out in a 2-column grid |

**Category normalisation rule:** strip whitespace, lowercase for storage; display with `toUpperCase()` on first letter of each word. Items with no category fall into an "Other" group at the bottom of the library list.

#### Serving size

`serving_size` is always in grams. The existing `serving_unit` TEXT column is kept as a display-only label (e.g. "1 cup") but is not shown in the form — only the numeric gram value matters for macro scaling. If `serving_size` is null, the amount input in Build mode defaults to blank rather than pre-filling.

### Data

```sql
ALTER TABLE food_library ADD COLUMN serving_size REAL;
-- brand column added in Feature 1 migration (same migration file)
```

---

## Feature 3 — Multi-item meal logging (Build mode)

### Overview

Log Meal gains a **Describe / Build** toggle. Describe is the existing freeform-text flow. Build is new: the user assembles a meal from food library items + optional freeform text, hits Calculate, reviews the estimated totals, then saves.

### Build mode flow

1. **Compose** — user taps `+ Add from library`, picks items in a bottom-sheet picker, enters gram amounts for each. An optional freeform textarea captures any non-library items (honey, almonds, blueberries).
2. **Calculate** — tapping Calculate:
   - Computes library-item macros exactly (scales `*_per_serving` fields by `amount_g / serving_size`)
   - Sends the freeform textarea content to the existing `parseMeal` edge function for estimation (library context still passed so it can match any items the user typed rather than picked)
   - Merges both sets of macros into a total
   - Generates a suggested meal name (first library item name, truncated + " with…" if multiple)
   - Renders the **Estimated totals** block: editable name input + 4-up macro summary (kcal / protein / carbs / fat)
3. **Review** — user can edit the name and the macro values before saving
4. **Save** — saves one `food_logs` row with aggregated totals in the top-level macro columns and a `components` JSON array

### Picker sheet

- Bottom sheet, slides up over the Build mode screen
- Search input filters library items by brand + name
- Each row: checkmark circle (filled = selected), name, brand sub-line, macros
- "Add N items →" confirm button (disabled at 0 selections)
- Tapping a row toggles its selection
- On confirm: selected items are appended to the component list with `amount_g` defaulting to `serving_size` (or blank if null)

### Component list

Each added library item shows:

- Colour stripe (assigned sequentially from a fixed palette, cycling): `#5b9bd5`, `#e8a04b`, `#6abf69`, `#e8585e`, `#9b7dd4`, `#4bbfbf`
- Name + macro summary sub-line (from library)
- Gram amount input (editable; recalculation only happens on Calculate, not live)

Remove button (×) removes the item from the list.

### Timeline entry

A saved Build-mode meal entry shows:

- Name, category badge, total macros (same as today)
- **Component pills**: one pill per library item (coloured dot + "190g Chobani yogurt"), one combined pill for freeform items ("21g honey · 23g almonds · 82g blueberries")
- Tapping "▲ Collapse" hides the pills; "▼ Show components" restores them (state is per-session, not persisted)

A Describe-mode entry (single-item or plain freeform) shows no pills — existing behaviour unchanged.

### Data

`food_logs` gains one nullable column:

```sql
ALTER TABLE food_logs ADD COLUMN components JSONB;
```

Each element in the array:

```json
{
  "library_item_id": "uuid | null",
  "name": "string",
  "amount_g": 190,
  "protein": 17.9,
  "carbs": 6.7,
  "fat": 0,
  "calories": 100.6,
  "fiber": null,
  "sodium": null
}
```

Macros in each component are pre-scaled (i.e. already reflect the actual `amount_g`, not the per-serving values). The top-level `food_logs.protein` / `carbs` / `fat` / `calories` / `fiber` / `sodium` columns continue to hold aggregated totals so `getLogs` and the progress bar query need no changes.

`food_logs.library_item_id` and `serving_multiplier` are kept for backwards compatibility with single-item entries saved via the existing Describe flow.

---

## Migration

One new file: `migrations/0007_food_library_enhancements.sql`

```sql
ALTER TABLE food_library ADD COLUMN brand TEXT;
ALTER TABLE food_library ADD COLUMN serving_size REAL;
ALTER TABLE food_logs    ADD COLUMN components JSONB;
```

---

## Files touched

| File | Changes |
|------|---------|
| `migrations/0007_food_library_enhancements.sql` | New — 3 ALTER TABLE statements |
| `food-log-data.js` | `rowToItem`: add `brand`, `servingSize`; `saveLibraryItem` / `updateLibraryItem`: include new fields; `saveLog` / `rowToLog`: include `components` |
| `food-log.js` | `renderFoodLibraryPane`: replace flat list with grouped `product-row` style; `renderFoodLogEntry`: add brand + serving size fields to library form, add Build mode tab + composer + picker sheet + post-Calculate block; `timelineHTML`: render component pills when `log.components` present |
| `style.css` | New component: `component-row`, `component-pill`, `component-dot`, `picker-row`, picker sheet, estimated totals block — all following existing token conventions |

No changes to `data.js`, `app.js` (beyond `renderFoodLibraryPane` which already lives in `food-log.js`), or `export.js`.

---

## Out of scope

- Editing individual components on an already-saved multi-item entry (re-open and re-calculate instead)
- Syncing component colours across different renders (colours are positional, not stored)
- Liquid-unit serving sizes (ml, oz) — grams only for now
