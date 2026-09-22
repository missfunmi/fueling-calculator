# Food Log Share — Design Spec

_2026-09-22_

## Problem

The food log has no share/export capability. The events tab already has a one-tap share button producing markdown (via `navigator.share` on mobile, clipboard fallback on desktop). The food log needs the same, in two modes:

- **Single-day share**: one tap, no date picker, shares the currently-viewed day.
- **Multi-day share**: separate UX (date-range sheet), for sharing a week or custom span.

There is also a latent timezone bug: `getLogs` builds UTC boundaries from the device's _current_ timezone. An entry logged at 9 pm ET before a red-eye to London becomes a midnight snack on the wrong day when the device switches to BST. Fix: store the calendar date _at log time_ as an immutable `local_date` column and filter by it.

---

## Goals

1. One-tap share of the currently-viewed day's food log.
2. Date-range share (start/end date picker) with smart empty-day handling.
3. Fix timezone correctness for all log reads (existing and new).

---

## Non-goals

- Storing the original timezone (not needed — `local_date` is the semantic truth).
- Sharing library items or targets.
- Sharing sub-components of assembled meals (totals are the useful signal).
- Any authentication or recipient-specific sharing.

---

## Timezone fix

### DB migration

Add `local_date TEXT` (`YYYY-MM-DD`) to `food_logs` (`0011_add_local_date_to_food_logs.sql`):

```sql
ALTER TABLE food_logs ADD COLUMN IF NOT EXISTS local_date TEXT;

UPDATE food_logs
SET local_date = TO_CHAR(logged_at AT TIME ZONE 'America/New_York', 'YYYY-MM-DD')
WHERE local_date IS NULL;

CREATE INDEX IF NOT EXISTS food_logs_user_local_date_idx ON food_logs (user_id, local_date);
```

Backfill uses ET (America/New_York) — all historical data was logged in Eastern time.

**Deploy order:** run the migration before deploying the JS. `getLogs` now filters by `local_date`; deploying the JS first makes the food log appear empty until the migration runs.

### Write path

`saveLog` derives `local_date` from the entry's own timestamp: `new Date(entry.loggedAt || Date.now()).toLocaleDateString('en-CA')`. This ensures backdated entries (logged while viewing a past date) land on the correct calendar day, not today.

`updateLog` recomputes `local_date` when `loggedAt` is changed.

`en-CA` locale reliably produces `YYYY-MM-DD` in the device's local timezone across all browsers.

### Read path

`getLogs(userId, date)` filters by `.eq('local_date', date)` instead of UTC boundaries.

`getLogsRange(userId, startDate, endDate)` filters `.gte('local_date', startDate).lte('local_date', endDate)`, ordered `logged_at DESC` (matching `getLogs`).

---

## Share UX

### Single-day button

`btn-secondary` button at the bottom of the food log body (below timeline). Label: "Share today's log" or "Share [weekday]'s log". Uses `state.logs` already in memory — no extra network call. Fires `navigator.share` (mobile share sheet) with clipboard fallback.

### Multi-day entry point

`btn-text` link "Share date range…" directly below the single-day button. Opens a bottom sheet (using existing `fl-sheet-*` CSS classes) with:
- Start date input (default: `state.date`)
- End date input (default: `state.date`)
- "Share" `btn-primary` button

Both inputs cap at today. Validation: start ≤ end (inline error if not).

Range share goes straight to clipboard (skips `navigator.share`) to avoid iOS activation-window expiry after the async `getLogsRange` fetch.

---

## Markdown format

Entries within a day are sorted chronologically (ascending) regardless of query order.

### Single day

```markdown
# Food Log — Monday, 22 Sep 2026

| Time | Category | Item | Cal | Protein | Carbs | Fat |
|------|----------|------|-----|---------|-------|-----|
| 7:30 AM | Breakfast | Overnight Oats | 420 | 18g | 65g | 9g |
| 12:15 PM | Lunch | Chicken & Rice | 610 | 52g | 70g | 8g |
| 9:00 PM | Dinner | Salmon + Veg | 490 | 44g | 30g | 18g |

**Total:** 1,520 kcal · 114g protein · 165g carbs · 35g fat
```

### Multi-day (with gap)

```markdown
# Food Log — 20–22 Sep 2026

## Saturday, 20 Sep 2026
| Time | Category | Item | ... |
...
**Day total:** ...

---

## Sunday, 21 Sep 2026
*(no entries)*

---

## Monday, 22 Sep 2026
...
**Day total:** ...

---
**Total:** 6,300 kcal · 435g protein · 690g carbs · 216g fat
```

Empty-day rules:
- **Trim** leading/trailing days with no entries.
- **Blank** interior empty days — shown as `*(no entries)*`.

Sodium/fiber columns appear only when at least one entry in the range has a non-null value.

---

## Files changed

| File | Change |
|------|--------|
| `migrations/0011_add_local_date_to_food_logs.sql` | New migration |
| `food-log-data.js` | `saveLog` + `updateLog` + `getLogs` + `getLogsRange` + `rowToLog` |
| `export.js` | New `Export.generateFoodLogMarkdown` |
| `food-log.js` | Share buttons + bottom sheet + handlers |
| `app.js` | Export `showToast` on `window._App` |
