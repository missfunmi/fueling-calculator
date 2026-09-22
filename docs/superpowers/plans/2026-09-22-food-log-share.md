# Food Log Share — Implementation Plan

_2026-09-22_

Spec: `docs/superpowers/specs/2026-09-22-food-log-share-design.md`

---

## Task 1 — DB migration

**File:** `migrations/0011_add_local_date_to_food_logs.sql`

```sql
ALTER TABLE food_logs ADD COLUMN IF NOT EXISTS local_date TEXT;

UPDATE food_logs
SET local_date = TO_CHAR(logged_at AT TIME ZONE 'America/New_York', 'YYYY-MM-DD')
WHERE local_date IS NULL;

CREATE INDEX IF NOT EXISTS food_logs_user_local_date_idx ON food_logs (user_id, local_date);
```

Run against Supabase before deploying JS. Spot-check: `local_date` should match the ET calendar date of `logged_at`.

---

## Task 2 — `food-log-data.js`

### 2a. `rowToLog` — add `localDate`

```js
localDate: row.local_date || null,
```

### 2b. `saveLog` — derive `local_date` from entry timestamp

```js
local_date: new Date(entry.loggedAt || Date.now()).toLocaleDateString('en-CA'),
```

Ensures backdated entries land on the correct day, not today.

### 2c. `updateLog` — recompute `local_date` when `loggedAt` changes

```js
if (fields.loggedAt) {
  fields.local_date = new Date(fields.loggedAt).toLocaleDateString('en-CA');
}
```

### 2d. `getLogs` — switch to `local_date` filter

```js
.eq('local_date', date)
```

### 2e. Add `getLogsRange`

```js
async function getLogsRange(userId, startDate, endDate) {
  // filter: local_date >= startDate AND local_date <= endDate, order logged_at desc
}
```

Expose on `window.FoodLogData`.

---

## Task 3 — `export.js`: `Export.generateFoodLogMarkdown`

**Signature:** `generateFoodLogMarkdown(logsByDate, startDate, endDate)`
- `logsByDate`: `{ 'YYYY-MM-DD': Log[] }` — keys only for dates that have entries.

**Steps:**
1. Build `allDates` array from startDate to endDate (inclusive).
2. Find first and last dates with entries → trim outer empty dates.
3. Determine if sodium/fiber columns needed across all entries.
4. For each date in trimmed list:
   - If entries: sort chronologically (asc), render one flat table (`Time | Category | Item | Cal | Protein | Carbs | Fat [| Sodium] [| Fiber]`) + day total.
   - If no entries (interior gap): `*(no entries)*`.
5. Single-date title: `# Food Log — Monday, 22 Sep 2026`.
   Range title: `# Food Log — 20–22 Sep 2026` (same month) or `# Food Log — 20 Sep–3 Oct 2026` (cross-month).
6. Multi-day: `## Weekday, D Mon YYYY` heading per day, `---` after each day total, grand total at end.
7. Grand total only for multi-day.

**Time format:** 12-hour local time (`h:mm AM/PM`) derived from `log.loggedAt`.

**Category label:** first letter capitalised (`Pre-workout`, `Breakfast`, etc.).

---

## Task 4 — `food-log.js`: share buttons + bottom sheet

### 4a. Buttons (appended to rendered body, before FAB)

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

Weekday label: "today" if `state.date === todayStr()`, otherwise full weekday name.

### 4b. `shareOrCopy(md, toastMsg)` helper

`navigator.share({ text: md })` → on fail, `navigator.clipboard.writeText` + `_A.showToast`. Desktop: clipboard + toast directly.

### 4c. Single-day handler

Uses `state.logs` (no network call). Groups as `{ [state.date]: state.logs }`. Calls `Export.generateFoodLogMarkdown` then `shareOrCopy`.

### 4d. Range bottom sheet

Injected into `document.body` using existing `fl-sheet-*` CSS classes. Both inputs default to `state.date`, capped at `todayStr()`. Validates start ≤ end. On confirm: `FoodLogData.getLogsRange` → group by `log.localDate` → `Export.generateFoodLogMarkdown` → clipboard + `_A.showToast` (skips `navigator.share` to avoid iOS activation expiry after async fetch).

### 4e. `app.js` — export `showToast`

Add `showToast: showToast` to the `window._App` export so `food-log.js` can call `_A.showToast(...)`.

---

## Verification

1. Run `0011_add_local_date_to_food_logs.sql` against Supabase.
2. `lsof -ti:8080 | xargs kill -9 2>/dev/null; npx serve . -p 8080`
3. Single-day share: tap button → markdown covers only that date, entries in chronological order, no sheet.
4. Range share: tap "Share date range…" → sheet opens → select range with a gap → interior empty day shown, outer empties trimmed.
5. Backdate test: navigate to yesterday, log an entry → confirm it appears on yesterday, not today.
6. `node tests/data.test.js && node tests/export.test.js` — pass (excluding known off-by-one).
