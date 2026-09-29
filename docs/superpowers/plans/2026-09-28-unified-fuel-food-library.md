# Unified fuel + food library — implementation plan

**Spec:** `docs/superpowers/specs/2026-09-28-unified-fuel-food-library-design.md`
**Branch:** `feature/unified-fuel-food-library`

## Tasks

### Task 1 — DB migration
File: `migrations/0013_unified_library.sql`

- `ALTER TABLE food_library ADD COLUMN IF NOT EXISTS is_fuel BOOLEAN NOT NULL DEFAULT false`
- `ALTER TABLE food_library ADD COLUMN IF NOT EXISTS caffeine_per_serving REAL`
- No `fuel_type` column — `category` already exists and holds the subtype (gel, bar, etc.)
- Pre-flight DO block: raises an exception if any `products.id` already exists in `food_library` (catches silent-skip risk; UUID collisions are near-impossible but better to fail loudly)
- `INSERT INTO food_library ... SELECT ... FROM products` (no ON CONFLICT — the pre-flight block guarantees clean state)
  - Map: `type → category`, `carbs_per_unit → carbs_per_serving`, `sodium_per_unit → sodium_per_serving`, `caffeine_per_unit → caffeine_per_serving`, `is_fuel = true`, `calories_per_serving = ROUND((carbs_per_unit * 4)::numeric, 1)`, `protein_per_serving = 0`, `fat_per_serving = 0`

### Task 2 — food-log-data.js
- `rowToItem`: add `isFuel: r.is_fuel || false`, `caffeinePerServing: r.caffeine_per_serving ?? null`, `fuelType: r.is_fuel ? (r.category || null) : null` (reads from `category`, not a separate column)
- `saveLibraryItem`: add `is_fuel`, `caffeine_per_serving` to INSERT body; `category` key resolves to `item.isFuel ? (item.fuelType || null) : (item.category || null)` (single key, no duplicate)
- `updateLibraryItem`: add `isFuel → is_fuel`, `caffeinePerServing → caffeine_per_serving`, `fuelType → category` (writes fuel subtype back into `category`)
- Add exported `getFuelItems(userId)`: queries `food_library?user_id=eq.&is_fuel=eq.true&order=name.asc`
- `itemMetaLine` in `food-log.js`: append `caffeinePerServing` if > 0 (e.g. `50mg caffeine`)

### Task 3 — data.js
- `dbToProduct(row)` → reads from food_library column names: `type: normalizeItemType(row.category || 'other')` (no `fuel_type`), `carbsPerUnit: row.carbs_per_serving || 0`, `sodiumPerUnit: row.sodium_per_serving || 0`, `caffeinePerUnit: row.caffeine_per_serving || 0`
- `getProducts()` → redirect to query `food_library?user_id=eq.&is_fuel=eq.true&order=name.asc` using the Supabase URL/key from the existing `supabaseRequest` helper. Map rows with `fuelItemFromRow`.
- `saveProduct(product)` → upsert into `food_library` with `is_fuel=true`, `category: product.type` (fuel subtype into category). Must also set `protein_per_serving=0`, `fat_per_serving=0`, `calories_per_serving=(carbsPerUnit*4)` when values are absent. No `fuel_type` key.
- `deleteProduct(id)` → DELETE from `food_library` (same endpoint pattern).
- `itemFromProduct(product)` → unchanged functionally (already copies values).

### Task 4 — index.html: sheet tab restructure
Replace the two `Library | One-off` sheet tabs with three: `Fuel | Food | Ad-hoc`.

```html
<div class="sheet-tabs">
  <button class="sheet-tab-btn active" data-sheet-tab="fuel">Fuel</button>
  <button class="sheet-tab-btn" data-sheet-tab="food">Food</button>
  <button class="sheet-tab-btn" data-sheet-tab="adhoc">Ad-hoc</button>
</div>
<div id="sheet-tab-fuel" class="sheet-tab-content active">
  <!-- existing search + product list markup, ids unchanged -->
  <input id="product-search" ...>
  <div id="recent-products-section">...</div>
  <div id="product-search-results"></div>
</div>
<div id="sheet-tab-food" class="sheet-tab-content">
  <input id="food-search" class="search-input" type="search" placeholder="Search food…">
  <div id="food-search-results"></div>
</div>
<div id="sheet-tab-adhoc" class="sheet-tab-content">
  <!-- LLM freeform field + fallback manual fields (carbs/sodium/caffeine) -->
</div>
```

Ad-hoc tab content:
```html
<div style="display:flex;flex-direction:column;gap:12px;padding:12px 16px">
  <div class="form-group">
    <label for="adhoc-freeform">Describe the item</label>
    <input id="adhoc-freeform" class="form-input" type="text" placeholder="e.g. 1 banana, half a Clif Bar">
  </div>
  <button id="adhoc-parse-btn" class="btn-primary" type="button">Look up</button>
  <div id="adhoc-result" style="display:none">
    <!-- populated after parse: name, macros preview, Add button -->
  </div>
  <details id="adhoc-manual-details">
    <summary style="cursor:pointer;font-size:13px;color:var(--text-secondary)">Enter manually instead</summary>
    <form id="oneoff-form" novalidate>
      <!-- existing one-off form fields -->
    </form>
  </details>
</div>
```

Remove old `sheet-tab-oneoff` div. Keep `oneoff-form` id inside the `adhoc-manual-details` so existing JS event handlers still bind.

### Task 5 — app.js: sheet logic
- `openAddItemSheet`: reset to `fuel` tab instead of `library`; update `classList` targets to new ids.
- `renderSheetLibraryTab` → rename to `renderSheetFuelTab`, no logic change (already queries products = now food_library fuel items).
- Add `renderSheetFoodTab(query)`: loads `FoodLogData.getLibrary` (all items), filters to `!item.isFuel`, renders rows with `foodRowSheetHTML(item)`. Search across name, brand, category.
- `foodRowSheetHTML(item)`: similar to `productRowSheetHTML` but shows `kcal · carbs · protein` meta instead of type chip.
- `attachSheetFoodHandlers($container)`: on row click → call `addItemFromFood(item)`.
- `addItemFromFood(item)`: creates segment item mapping `carbsPerServing → carbsPerUnit`, `sodiumPerServing → sodiumPerUnit`, `caffeinePerServing → caffeinePerUnit` (default 0). Calls `Data.addItemToSegment` / `closeSheet` flow same as product add.
- Sheet tab switch handler: add `food` case → `renderSheetFoodTab`.
- Ad-hoc tab:
  - `adhoc-parse-btn` click handler: read `adhoc-freeform` value, call `FoodLogData.parseMeal(input, [])`, populate `adhoc-result` with parsed name + macro preview + "Add" button.
  - `adhoc-result` "Add" button: build segment item from parsed macros, add to segment, `closeSheet`.
  - `oneoff-form` submit (inside manual details) stays unchanged.
- `productSortKey` / `TYPE_LABELS` / `normalizeItemType` — no change.

### Task 6 — app.js: renderLibrary + unified item form
- `renderLibrary()`: remove Fuel/Food sub-tabs entirely. Fetch all items via `FoodLogData.getLibrary(userId)`. Render single alphabetical list with search bar. Each row shows a category chip (fuel subtype or food category). Row click → `navigate('product-form')` with `state.editingLibraryItemId`.
- `renderProductForm()`: load item by `state.editingLibraryItemId` from `FoodLogData.getLibrary()`. Populate `is_fuel` toggle + fuel or food fields based on `item.isFuel`. Default to fuel (checked) for new items.
- `product-form submit`: build fuel or food payload based on `pf-is-fuel` checked state. New items → `FoodLogData.saveLibraryItem`; edits → `FoodLogData.updateLibraryItem`.
- `btn-delete-product click`: `FoodLogData.deleteLibraryItem(userId, itemId)` for all item types.
- `pf-is-fuel change`: show/hide `#pf-fuel-fields` / `#pf-food-fields`.
- `index.html product-form`: add `is_fuel` toggle (`.toggle-row` / `.toggle-input`); wrap fuel fields in `#pf-fuel-fields`; add food macro fields in `#pf-food-fields` (initially `display:none`).

### Task 7 — food-log.js: fuel item display in picker
In `itemMetaLine(item)`: if `item.caffeinePerServing && item.caffeinePerServing > 0`, append `${item.caffeinePerServing}mg caffeine` to the meta parts array.

### Task 8 — style.css
- `.fuel-type-chip` already exists for fuel items in the sheet.
- Add `.sheet-food-row` mirroring `.product-row` (or reuse `.product-row` with a modifier).
- No major new styles; ad-hoc result block uses existing form/button classes.

## Order of implementation
1 → 2 → 3 → 4 → 5 → 6 → 7 → 8

Tasks 2 and 3 can be done in parallel. Tasks 4 and 5 are sequential (HTML must exist before JS wires it). Task 7 is independent and small.
