# Unified fuel + food library — design spec

**Date:** 2026-09-28

## Problem

Two separate item libraries exist in the app:

- **Fuel library** (`products` table): gel, bar, drink powder items with `carbs/sodium/caffeine per unit`. Powers the event segment item picker.
- **Food library** (`food_library` table): meals, snacks with full macros (protein, carbs, fat, calories, fiber, sodium per serving). Powers the food log item picker.

The user's nutritionist requires fuel items (gels, bars, drink mixes) to be loggable in the daily food log alongside regular food. Currently this is impossible because the two libraries are siloed.

Additionally, when planning events, users sometimes want to add food items (e.g. a banana at a checkpoint) — today there is no way to do that without using the manual one-off form.

## Solution

Unify both libraries into a single `food_library` table. Fuel items become `food_library` rows with `is_fuel = true`, gaining two new columns: `caffeine_per_serving` and `fuel_type` (gel, bar, etc.). Existing products are migrated in.

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
  ADD COLUMN caffeine_per_serving REAL,
  ADD COLUMN fuel_type            TEXT;
```

### Products → food_library migration

```sql
INSERT INTO food_library (
  id, user_id, name, brand, category, is_fuel, fuel_type,
  carbs_per_serving, sodium_per_serving, caffeine_per_serving,
  protein_per_serving, fat_per_serving, calories_per_serving,
  created_at
)
SELECT
  id, user_id, name, brand, 'fuel', true, type,
  carbs_per_unit, sodium_per_unit, caffeine_per_unit,
  0, 0, ROUND((carbs_per_unit * 4)::numeric, 1),
  created_at
FROM products
ON CONFLICT (id) DO NOTHING;
```

Calories estimated as `carbs × 4` (carbs-only fuel approximation). Users can edit to add protein/fat/exact calories later.

### Unified food_library row shape

| Column | Role |
|---|---|
| `is_fuel` | `true` = fuel item; `false` = food item |
| `fuel_type` | gel, bar, drink_powder, liquid, other (nullable; only on fuel items) |
| `caffeine_per_serving` | mg; fuel items only |
| `carbs_per_serving` | g; acts as carbs-per-unit for fuel items |
| `sodium_per_serving` | mg; same dual role |
| `protein_per_serving` | g; 0 for migrated fuel items |
| `fat_per_serving` | g; 0 for migrated fuel items |
| `calories_per_serving` | kcal; estimated for migrated fuel items |

## UI

### Event item picker sheet

Tabs change from `Library | One-off` to `Fuel | Food | Ad-hoc`.

**Fuel tab** (default): queries `food_library WHERE is_fuel = true`, ordered by `name`. Search works across name, brand, fuel_type. Behaviour identical to today's Library tab.

**Food tab**: queries `food_library WHERE is_fuel = false`. Same list/search behaviour. Selecting a food item maps `carbsPerServing → carbsPerUnit`, `sodiumPerServing → sodiumPerUnit`, `caffeinePerServing → caffeinePerUnit` (0 for food items). Item added to segment with `quantity = 1`.

**Ad-hoc tab**: replaces today's "One-off" tab. Contains a freeform text input. On submit, calls `parseMeal` (same LLM function the food log uses), maps the result to a segment item:
- `carbsPerUnit = result.carbs`
- `sodiumPerUnit = result.sodium`
- `caffeinePerUnit = result.caffeine || 0`
- Manual fallback fields remain for when LLM is skipped or network fails

"Save to library" checkbox saves the parsed item to `food_library` (as `is_fuel` togglable, defaulting to `true` in this context).

### Library tab (app.js renderLibrary)

Library tab keeps Fuel / Food sub-tabs. Both now draw from `food_library` filtered by `is_fuel`. Fuel items display `carbs · sodium · caffeine` metadata. Food items display `kcal · protein · carbs · fat`. The new-item FAB context stays (Fuel tab → fuel form; Food tab → food form).

New/edit forms merge into one: a `Fuel item` toggle at the top switches between fuel-specific fields (fuel type, carbs/sodium/caffeine per unit) and food-specific fields (full macro form). Both share name, brand, and serving size.

### Food log item picker

No UI change required. Fuel items appear automatically (they are now `food_library` rows). In the picker row, if `caffeinePerServing > 0`, caffeine is appended to the meta line.

## Backward compatibility

Segment items copy field values at creation time (not FK references), so existing event data is unaffected. The `products` table is preserved and left in place; `data.js` redirects reads/writes to `food_library`.

`data.js` helper `itemFromProduct` is updated to accept a food_library fuel row and map `carbsPerServing → carbsPerUnit` etc.
