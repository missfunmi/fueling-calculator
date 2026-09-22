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
- Any authentication or recipient-specific sharing.

---

## Timezone fix

### DB migration

Add `local_date TEXT` (`YYYY-MM-DD`) to `food_logs`:

```sql
ALTER TABLE food_logs ADD COLUMN local_date TEXT;

UPDATE food_logs
SET local_date = TO_CHAR(logged_at AT TIME ZONE 'America/New_York', 'YYYY-MM-DD')
WHERE local_date IS NULL;

CREATE INDEX food_logs_user_local_date_idx ON food_logs (user_id, local_date);
```

Backfill uses ET (America/New_York) — all historical data was logged in Eastern time.

### Write path

`saveLog` adds `local_date: new Date().toLocaleDateString('en-CA')` to the insert payload. `en-CA` locale reliably produces `YYYY-MM-DD` in the device's local timezone across all browsers.

### Read path

`getLogs(userId, date)` switches from UTC-boundary filtering to `.eq('local_date', date)`. New `getLogsRange(userId, startDate, endDate)` filters `.gte('local_date', startDate).lte('local_date', endDate)`.

---

## Share UX

### Single-day button

`btn-secondary` button at the bottom of the food log body (below timeline, same placement as the events share button). Label: "Share [weekday]'s log" (e.g. "Share Monday's log"). Uses `state.logs` already in memory — no extra network call.

### Multi-day entry point

`btn-text` link "Share date range…" directly below the single-day button. Opens a bottom sheet with:
- Start date input (default: `state.date`)
- End date input (default: `state.date`)
- "Share" `btn-primary` button

Both inputs cap at today. Validation: start ≤ end (inline error if not).

---

## Markdown format

### Single day

```markdown
# Food Log — Monday, 22 Sep 2026

### Breakfast
| Item | Cal | Protein | Carbs | Fat |
|------|-----|---------|-------|-----|
| Oats | 350 kcal | 12 g | 60 g | 6 g |

**Total:** 2,100 kcal · 145 g protein · 230 g carbs · 72 g fat
```

### Multi-day (with gap)

```markdown
# Food Log — 20–22 Sep 2026

## Saturday, 20 Sep 2026
### Breakfast
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
**Total (3 days):** 6,300 kcal · 435 g protein · 690 g carbs · 216 g fat
```

Empty-day rules:
- **Trim** leading/trailing days with no entries.
- **Blank** interior empty days (between two days that have entries) — shown as `*(no entries)*`.

Sodium / fiber columns appear only when at least one entry in the range has a non-null value.

---

## Files changed

| File | Change |
|------|--------|
| `migrations/20260922_add_local_date_to_food_logs.sql` | New migration |
| `food-log-data.js` | `saveLog` + `getLogs` + new `getLogsRange` |
| `export.js` | New `Export.generateFoodLogMarkdown` |
| `food-log.js` | Share buttons + bottom sheet + handlers |
