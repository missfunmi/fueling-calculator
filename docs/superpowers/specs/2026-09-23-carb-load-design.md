# Pre-race carb load event type — design spec

**Date:** 2026-09-23

## Problem

Athletes carb-load before long events (marathons, long rides) by eating high-carb meals over 1–4 days. The existing event model is built around hourly race segments with per-hour rate targets and execution plan slot timelines. Neither concept applies to carb loading, where the planning unit is a day and progress is measured by food log intake rather than an in-race schedule.

## Solution

Add `type = 'carb_load'` as a new event type. Carb load events use segments with `mode = 'daily'`: targets are expressed as g/day instead of g/hr, execution plans are omitted, and each day card surfaces food log actuals (from the existing food_logs table) as progress bars alongside the planned items.

The detail page is visually identical to the existing multi-day event view — same component hierarchy, same card structure, same progress bars. Three diffs only: unit label strings, no execution plan row, food log actuals block appended inside each day card.

## Data model

### New DB column

```sql
ALTER TABLE segments ADD COLUMN mode TEXT NOT NULL DEFAULT 'hourly';
```

No other schema changes. The `carbs_per_hour` and `sodium_per_hour` columns are reused on daily segments to store the per-day target values — the column semantics shift with `mode`.

The `save_event` stored procedure is updated to include `mode` in segment INSERT/SELECT, following the same pattern as `exec_interval`.

### Event fields (unchanged)

- `type = 'carb_load'` — free-text, no migration needed for events table
- `category = 'single'` or `'multi'` — user-controlled; single-day carb loads are valid

### Segment fields for `mode = 'daily'`

| Field | Meaning for daily mode |
|---|---|
| `mode` | `'daily'` |
| `date` | mandatory — which calendar day this segment covers |
| `carbs_per_hour` | **daily carb target in g** (not per-hour) |
| `sodium_per_hour` | **daily sodium target in mg** (not per-hour) |
| `caffeine_per_hour` | unused, 0 |
| `duration_hours` | unused, 0 |
| `execution_plan` | unused, null |

Items on daily segments use existing structure unchanged — `carbsPerUnit × quantity` accumulates toward the daily target.

## Food log integration

New function `getFoodLogTotalsForDates(dates)` in `food-log-data.js`:
- Queries `food_logs WHERE local_date IN (dates)` for the current user
- Groups by `local_date`, sums the carb and sodium macro fields
- Returns `{ 'YYYY-MM-DD': { carbs, sodium } }`

Called in `renderDetail()` before rendering when `evt.type === 'carb_load'`. Results passed into `segmentSectionHTML` as a third `actuals` parameter and rendered as a food log actuals block below the item list.

## UI

### Creation

- New `<option value="carb_load">Pre-race carb load</option>` in the type select
- Multi-day: segments auto-generated one per calendar day from the date range (user cannot manually add/remove)
- Single-day: one segment auto-created with `date` = event date
- Segment form shows "Carbs/day (g)" and "Sodium/day (mg)" instead of Duration / Carbs/hr / Na/hr / Caffeine/hr

### Detail view diffs from a regular event

1. **Target pills**: "500g carbs/day", "1200mg Na/day" (not /hr)
2. **Progress bar labels**: "Ng/day", "Nmg/day"
3. **Summary strip card 3**: "TARGET" showing total planned carbs across all days (replaces Caffeine)
4. **No execution plan row** in any day card
5. **Food log actuals block** (new) after item list in each day card:
   - Header: "Food log · [date]" + "View ›" link
   - Carbs progress bar: logged vs daily target
   - Sodium progress bar: logged vs daily target
   - "No entries" state for future days with no food log data

### Styles

One new CSS block `.food-log-actuals`:
- `background: var(--surface-2)`, `border-top: 1px solid var(--border)`
- Inner progress bars reuse existing `.progress-row` / `.progress-track` / `.progress-fill` classes

## Out of scope

- Per-day fiber/protein/fat targets (belong to food log, not event planning)
- Food library integration for segment items (existing manual item entry is sufficient)
- Food log tab changes (food log tab is completely untouched)
