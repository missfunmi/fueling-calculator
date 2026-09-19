# Portioned Meals — Implementation Plan
**Date:** 2026-09-19

## Tasks

1. **DB migration** — `migrations/0010_batch_meals.sql`
   - ADD COLUMN batch_id UUID, batch_total INT, batch_remaining INT, batch_discarded BOOLEAN
   - Index on batch_id and active-batch lookup

2. **Data layer** — `food-log-data.js`
   - `rowToLog`: read 4 new batch fields
   - `saveLog`: write 4 new batch fields
   - New: `getActiveBatches(userId)` — query origin entries where remaining > 0 and not discarded
   - New: `updateBatchRemaining(userId, id, remaining)` — PATCH single row
   - New: `discardBatch(userId, batchId)` — PATCH all rows with that batch_id
   - Export all three new functions

3. **Styles** — `style.css`
   - `.fl-batch-badge` (amber pill on timeline entries)
   - `.fl-relog-btn` (blue tinted button)
   - `.fl-active-batches`, `.fl-active-batch-row`, `.fl-active-batch-actions`, `.fl-batch-discard`
   - `.fl-servings-row`, `.fl-servings-input`, `.fl-servings-unit`
   - `.fl-per-serving-preview`, `.fl-per-serving-eyebrow`, `.fl-per-serving-nums`, `.fl-ps-macro`, `.fl-ps-macro-lbl`
   - `.fl-mult-chips`, `.fl-mult-chip`, `.fl-mult-custom`, `.fl-serving-preview`, `.fl-ps-box`, `.fl-ps-val`, `.fl-ps-lbl`

4. **UI — entry form** — `food-log.js`
   - `formState`: add `batchServings: 1`
   - `estimatedBlockHTML()`: add servings row + per-serving preview (non-edit, non-library only)
   - `render()`: save button text updates to "Log 1 of N servings" when N > 1; hide "Save to library" row when N > 1
   - `attachHandlers()`: servings input + macro inputs trigger `refreshPerServingPreview()`
   - Save path: divide macros by N, set batch fields when N > 1

5. **UI — food log home** — `food-log.js`
   - `renderFoodLog()`: add `getActiveBatches` to parallel fetch, store in `state.activeBatches`
   - `activeBatchesHTML(batches)`: renders the active batches section
   - Insert section between progressHTML and timelineHTML
   - `timelineHTML()`: add batch badge + re-log button to relevant entries
   - Event handlers for relog + discard buttons
   - `openServingPicker(originEntry)`: serving picker bottom sheet + handlers
   - `servingPickerSheetHTML(entry)`: HTML for the picker
   - `servingPreviewNums(entry, mult)`: live macro preview HTML
