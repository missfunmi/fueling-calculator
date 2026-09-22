# Food Log Share — Implementation Plan

_2026-09-22_

Spec: `docs/superpowers/specs/2026-09-22-food-log-share-design.md`

---

## Task 1 — DB migration

**File:** `migrations/20260922_add_local_date_to_food_logs.sql`

```sql
ALTER TABLE food_logs ADD COLUMN local_date TEXT;

UPDATE food_logs
SET local_date = TO_CHAR(logged_at AT TIME ZONE 'America/New_York', 'YYYY-MM-DD')
WHERE local_date IS NULL;

CREATE INDEX food_logs_user_local_date_idx ON food_logs (user_id, local_date);
```

Run against Supabase. Verify spot-check: a few rows should have `local_date` = ET calendar date of `logged_at`.

---

## Task 2 — `food-log-data.js`

### 2a. `saveLog` — add `local_date` to insert payload

```js
local_date: new Date().toLocaleDateString('en-CA'),
```

### 2b. `getLogs` — switch to `local_date` filter

Replace the UTC-boundary `gte`/`lte` filter on `logged_at` with:
```js
.eq('local_date', date)
```

### 2c. Add `getLogsRange`

```js
async function getLogsRange(userId, startDate, endDate) {
  const { data, error } = await supabase
    .from('food_logs')
    .select('*')
    .eq('user_id', userId)
    .gte('local_date', startDate)
    .lte('local_date', endDate)
    .order('logged_at', { ascending: true });
  if (error) throw error;
  return (data || []).map(rowToLog);
}
```

Expose: add `getLogsRange` to `window.FoodLogData`.

---

## Task 3 — `export.js`: `Export.generateFoodLogMarkdown`

Add to the `Export` object alongside `generateEventMarkdown`.

**Signature:** `generateFoodLogMarkdown(logsByDate, startDate, endDate)`
- `logsByDate`: `{ 'YYYY-MM-DD': Log[] }` — keys only for dates that have entries.

**Steps:**
1. Build `allDates` array from startDate to endDate (inclusive).
2. Find `firstLogged` and `lastLogged` — trim outer empty dates.
3. Slice `allDates` to `[firstLogged … lastLogged]`.
4. Determine if sodium/fiber columns needed: `any(log.sodium != null)` / `any(log.fiber != null)` across all entries.
5. For each date in the trimmed list:
   - If entries: group by category (breakfast, lunch, dinner, fuel, snack, pre-workout, post-workout). Render `### Category` + markdown table + day total line.
   - If no entries (interior gap): render `*(no entries)*` block.
6. Single-date title: `# Food Log — Monday, 22 Sep 2026`.
   Multi-date title: `# Food Log — 20–22 Sep 2026` (or `20 Sep–3 Oct 2026` if month spans).
7. Grand total only for multi-day.

**Category order:** breakfast → pre-workout → lunch → snack → dinner → post-workout → fuel → (anything else).

**Table columns:** Item | Cal | Protein | Carbs | Fat [| Sodium] [| Fiber]

---

## Task 4 — `food-log.js`: share buttons + bottom sheet

### 4a. Add buttons to `timelineHTML`

Append after the timeline entries (or `.fl-empty-timeline` block), before the FAB:

```html
<div style="padding:8px 16px 4px">
  <button id="fl-btn-share-day" class="btn-secondary">
    <i class="ti ti-share" style="margin-right:6px;font-size:16px"></i>Share [weekday]'s log
  </button>
  <button id="fl-btn-share-range" class="btn-text" style="margin-top:4px;width:100%;text-align:center">
    Share date range…
  </button>
</div>
```

The weekday label is derived from `state.date` — "today" if `state.date === todayStr()`, otherwise the weekday name.

### 4b. Wire single-day handler

```js
on($('fl-btn-share-day'), 'click', function () {
  var logsByDate = {};
  logsByDate[state.date] = state.logs;
  var md = Export.generateFoodLogMarkdown(logsByDate, state.date, state.date);
  shareOrCopy(md, 'Food log copied!');
});
```

### 4c. Inject + wire bottom sheet

`shareOrCopy(md, toast)` helper (local to `food-log.js`):
```js
function shareOrCopy(md, toastMsg) {
  if (navigator.share) {
    navigator.share({ text: md }).catch(function () {
      navigator.clipboard.writeText(md).catch(function () {});
    });
  } else {
    navigator.clipboard.writeText(md).then(function () {
      showToast(toastMsg);
    }).catch(function () {
      showToast("Couldn't copy — try again.");
    });
  }
}
```

Range button click: inject `#fl-share-sheet` into `document.body`:

```html
<div id="fl-share-sheet" class="bottom-sheet-overlay">
  <div class="bottom-sheet">
    <div class="bottom-sheet-header">
      <span class="bottom-sheet-title">Share date range</span>
      <button id="fl-share-close" class="btn-icon"><i class="ti ti-x"></i></button>
    </div>
    <div class="bottom-sheet-body" style="padding:16px;display:flex;flex-direction:column;gap:12px">
      <label class="fl-share-label">From
        <input type="date" id="fl-share-start" class="fl-share-date-input" max="[todayStr()]">
      </label>
      <label class="fl-share-label">To
        <input type="date" id="fl-share-end" class="fl-share-date-input" max="[todayStr()]">
      </label>
      <p id="fl-share-error" style="color:var(--danger);font-size:13px;display:none">Start must be on or before end date.</p>
      <button id="fl-share-confirm" class="btn-primary">Share</button>
    </div>
  </div>
</div>
```

Both inputs default to `state.date`. Wire close (remove element). Wire confirm:
1. Validate start ≤ end → show error if not.
2. Call `FoodLogData.getLogsRange(userId, start, end)`.
3. Group result by `log.loggedAt.slice(0,10)` → wait, group by `local_date` — need to expose that on the Log object from `rowToLog`. Add `localDate: row.local_date` to `rowToLog`.
4. Call `Export.generateFoodLogMarkdown(logsByDate, start, end)`.
5. `shareOrCopy(md, 'Food log copied!')`.
6. Remove sheet.

### 4d. `rowToLog` — add `localDate`

In `food-log-data.js`, add to the `rowToLog` mapper:
```js
localDate: row.local_date || null,
```

And in the range grouping in step 4c, key by `log.localDate`.

---

## Verification

1. Run migration against Supabase.
2. `lsof -ti:8080 | xargs kill -9 2>/dev/null; npx serve . -p 8080`
3. Single-day share: tap "Share [weekday]'s log" → markdown has that day only, no sheet.
4. Range share: tap "Share date range…" → sheet opens → select range spanning a gap → markdown shows interior blank, outer empties trimmed.
5. Spot-check `local_date` in DB matches ET date of `logged_at`.
6. `node tests/data.test.js && node tests/export.test.js` — pass (excluding known off-by-one).
