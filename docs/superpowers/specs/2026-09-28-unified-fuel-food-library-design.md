# Unified fuel + food library — design spec

**Date:** 2026-09-28

## Problem

Two separate item libraries exist in the app:

- **Fuel library** (`products` table): gel, bar, drink powder items with `carbs/sodium/caffeine per unit`. Powers the event segment item picker.
- **Food library** (`food_library` table): meals, snacks with full macros (protein, carbs, fat, calories, fiber, sodium per serving). Powers the food log item picker.

The user's nutritionist requires fuel items (gels, bars, drink mixes) to be loggable in the daily food log alongside regular food. Currently this is impossible because the two libraries are siloed.

Additionally, when planning events, users sometimes want to add food items (e.g. a banana at a checkpoint) — today there is no way to do that without using the manual one-off form.

## Solution

Unify both libraries into a single `food_library` table. Fuel items become `food_library` rows with `is_fuel = true`, gaining one new column: `caffeine_per_serving`. The existing `category` column doubles as the fuel subtype (gel, bar, drink_powder, etc.) — no separate `fuel_type` column needed. Existing products are migrated in.

The event item picker gains three tabs:
1. **Fuel** (default) — `food_library WHERE is_fuel = true`
2. **Food** — `food_library WHERE is_fuel = false`
3. **Ad-hoc** — LLM lookup (freeform natural language, same as food log) + manual entry

The food log picker already uses `food_library`, so fuel items appear there automatically after migration.

## Data model

### Schema migration

```sql
ALTER TABLE food_library
  ADD COLUMN is_fuel             BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN caffeine_per_serving REAL;
```

No `fuel_type` column. The existing `category` column already exists and holds the subtype (gel, bar, drink_powder, liquid, etc.) for fuel items, just as it holds the meal category for food items.

### Products → food_library migration

```sql
-- Fail loudly on any ID collision (should be impossible with UUIDs,
-- but silent data loss from ON CONFLICT DO NOTHING is worse).
DO $$ ... RAISE EXCEPTION IF conflicts > 0 ... END $$;

INSERT INTO food_library (
  id, user_id, name, brand, category, is_fuel,
  carbs_per_serving, sodium_per_serving, caffeine_per_serving,
  protein_per_serving, fat_per_serving, calories_per_serving,
  created_at
)
SELECT
  id, user_id, name, NULLIF(brand,''), type, true,
  carbs_per_unit, sodium_per_unit,
  CASE WHEN caffeine_per_unit > 0 THEN caffeine_per_unit ELSE NULL END,
  0, 0, ROUND((carbs_per_unit * 4)::numeric, 1),
  created_at
FROM products;
```

`products.type` (gel, bar, etc.) maps directly to `food_library.category`. Calories estimated as `carbs × 4`. Users can edit to add protein/fat/exact calories later.

### Unified food_library row shape

| Column | Role |
|---|---|
| `is_fuel` | `true` = fuel item; `false` = food item |
| `category` | meal category for food items; fuel subtype (gel, bar, drink_powder, liquid) for fuel items |
| `caffeine_per_serving` | mg; fuel items only (nullable) |
| `carbs_per_serving` | g; acts as carbs-per-unit for fuel items |
| `sodium_per_serving` | mg; same dual role |
| `protein_per_serving` | g; 0 for migrated fuel items |
| `fat_per_serving` | g; 0 for migrated fuel items |
| `calories_per_serving` | kcal; estimated for migrated fuel items |

## UI

### Event item picker sheet

Tabs change from `Library | One-off` to `Fuel | Food | Ad-hoc`.

**Fuel tab** (default): queries `food_library WHERE is_fuel = true`, ordered by `name`. Search works across name, brand, category. Behaviour identical to today's Library tab.

**Food tab**: queries `food_library WHERE is_fuel = false`. Same list/search behaviour. Selecting a food item maps `carbsPerServing → carbsPerUnit`, `sodiumPerServing → sodiumPerUnit`, `caffeinePerServing → caffeinePerUnit` (0 for food items). Item added to segment with `quantity = 1`.

**Ad-hoc tab**: replaces today's "One-off" tab. Contains a freeform text input. On submit, calls `parseMeal` (same LLM function the food log uses), maps the result to a segment item:
- `carbsPerUnit = result.carbs`
- `sodiumPerUnit = result.sodium`
- `caffeinePerUnit = result.caffeine || 0`
- Manual fallback fields remain for when LLM is skipped or network fails

"Save to library" checkbox saves the parsed item to `food_library` (as `is_fuel` togglable, defaulting to `true` in this context).

### Library tab (app.js renderLibrary)

Single scrollable list of all `food_library` items — fuel and food together, sorted alphabetically. A search bar filters across name, brand, and category. Each row shows a chip with the fuel subtype (Gel, Bar, etc.) or food category (Breakfast, Snack, etc.) so items are distinguishable at a glance. No sub-tabs.

One "+" FAB opens a unified form with a "Fuel item" toggle at the top (checked by default for new items). The toggle shows/hides the appropriate field set:
- **Fuel**: subtype (category), carbs/sodium/caffeine per unit
- **Food**: category, serving size/unit, full macros (calories, protein, carbs, fat, fiber, sodium)

Both paths share name and brand fields. Saves and deletes route through `FoodLogData.saveLibraryItem` / `updateLibraryItem` / `deleteLibraryItem` for all item types.

### Library list UI

Each row carries a right-aligned **Fuel** badge (`.lib-fuel-badge`) for fuel items and a category chip for food items, so they are distinguishable at a glance without sub-tabs. Items are grouped by category/subtype within the list. The edit form uses the label "Category" (not "Category/Type") for both item types.

### Food log item picker

Fuel items appear automatically (they are now `food_library` rows). In the picker row, if `caffeinePerServing > 0`, caffeine is appended to the meta line.

Picker groups are wrapped in `.picker-group` divs so the search filter can hide the group header when all its rows are filtered out. A × clear button appears inside the search bar when text is present.

### Search bars

All four search bars (food log picker, library filter, event sheet Fuel tab, event sheet Food tab) use a `.search-wrap` / `.search-clear` pattern:
- `.search-clear` is an 18×18 px grey circle (iOS spotlight style), visible only when the input has text.
- Clicking it clears the field and re-fires the `input` event.
- The native browser `type="search"` cancel button is hidden via `::-webkit-search-cancel-button { display: none }`.

### Food log block on all dated events

All event detail views that have at least one dated segment (or an event-level `evt.date`) show a food log block at the bottom of each segment, not just carb-load (daily-mode) events. For hourly segments the date falls back to `evt.date`. The block shows the date, a "View ›" link, and a carbs/sodium summary line (or "No entries" / "Not yet logged"). No progress bars are shown for hourly segments since they have per-hour targets, not daily totals.

## Backward compatibility

Segment items copy field values at creation time (not FK references), so existing event data is unaffected. The `products` table is preserved and left in place; `data.js` redirects reads/writes to `food_library`.

`data.js` helper `itemFromProduct` is updated to accept a food_library fuel row and map `carbsPerServing → carbsPerUnit` etc.
