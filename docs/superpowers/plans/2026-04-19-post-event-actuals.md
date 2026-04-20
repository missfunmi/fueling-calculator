# Post-Event Actuals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-segment post-event tracking to the event detail view — actual duration, items consumed, and a free-text event note — visible only for past/today events.

**Architecture:** Two new columns (`actuals JSONB`, `post_event_notes TEXT`) on the `events` table store all post-event data; actuals are saved via a lightweight PATCH call separate from the plan's `save_event` RPC. The event detail view conditionally renders an ACTUAL subsection beneath each planned segment when `event.date ≤ today`, and pre-populates it from the plan on first open.

**Tech Stack:** Vanilla JS/HTML/CSS, Supabase PostgREST (PATCH for partial column updates), Node.js for tests.

---

## File Map

| File | Changes |
|---|---|
| Supabase SQL editor | 2 `ALTER TABLE` statements (Task 1, manual) |
| `data.js` | `dbToEvent` + `eventToDb` + `newEvent` updated; `saveActuals` added; 4 new calc functions added; exports updated |
| `tests/data.test.js` | Tests for `saveActuals`, updated normalisation tests, 4 new calc function tests |
| `style.css` | Actual subsection, planned→actual card, notes textarea styles |
| `app.js` | `renderDetail` updated; `actualSegmentSectionHTML`, `actualItemRowHTML`, `postEventNotesHTML`, `isEventPastOrToday`, `updateActualItemQty`, `addItemToActualSegment` added; `metricCardHTML`, `attachDetailHandlers`, `openAddItemSheet`, `closeSheet`, sheet handlers updated |
| `_mockup.html` | Delete (was a temporary brainstorming file) |

---

## Task 1: Supabase Schema

**Files:**
- Supabase SQL editor (manual)

This task has no code to commit — run SQL in the Supabase dashboard.

- [ ] **Step 1: Open the Supabase SQL editor**

Go to your Supabase project → SQL Editor → New query.

- [ ] **Step 2: Run the ALTER TABLE statements**

```sql
ALTER TABLE events ADD COLUMN post_event_notes TEXT;
ALTER TABLE events ADD COLUMN actuals JSONB DEFAULT NULL;
```

- [ ] **Step 3: Verify the columns exist**

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'events'
ORDER BY ordinal_position;
```

Expected: `post_event_notes` (text) and `actuals` (jsonb) appear in the list alongside the existing columns.

---

## Task 2: data.js — normalisation + saveActuals

**Context:** `data.js` wraps all Supabase calls. `dbToEvent` converts DB rows to JS objects (snake_case → camelCase). `eventToDb` does the reverse for the `save_event` RPC. `newEvent` creates a blank event. `saveActuals` is a new function that PATCHes just the two new columns. The existing `supabaseRequest` helper handles headers and JSON; PATCH with a body will auto-get `Content-Type: application/json`.

**Files:**
- Modify: `data.js`
- Test: `tests/data.test.js`

- [ ] **Step 1: Write failing tests for the new/updated functions**

Add these tests to `tests/data.test.js`, inside the `run()` function, after the existing `getEvents` tests block (around line 180). Add a new section header before them:

```js
  // ── Actuals normalisation ─────────────────────────────────────────────────────

  console.log('\nActuals normalisation');

  await test('dbToEvent maps post_event_notes and actuals from DB row', async function () {
    var actuals = { 'seg-1': { durationHours: 2.5, items: [] } };
    var row = {
      id: 'e1', name: 'Test', date: '2026-04-18', type: 'ride',
      notes: '', post_event_notes: 'Felt good', actuals: actuals,
      segments: []
    };
    mockFetch([{ status: 200, body: JSON.stringify([row]) }]);
    var events = await D.getEvents();
    assert.strictEqual(events[0].postEventNotes, 'Felt good');
    assert.deepStrictEqual(events[0].actuals, actuals);
  });

  await test('dbToEvent defaults postEventNotes to empty string and actuals to {} when absent', async function () {
    var row = {
      id: 'e1', name: 'Test', date: '2026-04-18', type: 'ride',
      notes: '', post_event_notes: null, actuals: null,
      segments: []
    };
    mockFetch([{ status: 200, body: JSON.stringify([row]) }]);
    var events = await D.getEvents();
    assert.strictEqual(events[0].postEventNotes, '');
    assert.deepStrictEqual(events[0].actuals, {});
  });

  await test('newEvent includes postEventNotes and actuals fields', function () {
    var e = D.newEvent('Test');
    assert.strictEqual(e.postEventNotes, '');
    assert.deepStrictEqual(e.actuals, {});
  });

  await test('saveActuals sends PATCH to events endpoint', async function () {
    var actuals = { 'seg-1': { durationHours: 3, items: [] } };
    mockFetch([{ status: 204, body: '' }]);
    await D.saveActuals('event-uuid', actuals, 'Great ride');
    // No assertion needed — would throw on non-ok status
  });

  await test('saveActuals throws on server error', async function () {
    mockFetch([{ status: 500, body: 'Internal Server Error' }]);
    await assert.rejects(
      D.saveActuals('event-uuid', {}, ''),
      /Internal Server Error/
    );
  });
```

- [ ] **Step 2: Run tests — confirm new ones fail**

```
node tests/data.test.js
```

Expected: existing tests pass, new actuals tests fail with errors like "events[0].postEventNotes is not a property" or similar.

- [ ] **Step 3: Update `dbToEvent` in `data.js`**

Find `dbToEvent` (line 61). Add `postEventNotes` and `actuals` to the returned object:

```js
  function dbToEvent(row) {
    return {
      id:             row.id,
      name:           row.name,
      date:           row.date || '',
      type:           row.type || 'other',
      notes:          row.notes || '',
      postEventNotes: row.post_event_notes || '',
      actuals:        row.actuals || {},
      segments: (row.segments || [])
        .slice()
        .sort(function (a, b) { return a.sort_order - b.sort_order; })
        .map(function (seg) {
          return {
            id:            seg.id,
            name:          seg.name,
            durationHours: seg.duration_hours,
            targets: {
              carbsPerHour:    seg.carbs_per_hour    || 0,
              sodiumPerHour:   seg.sodium_per_hour   || 0,
              caffeinePerHour: seg.caffeine_per_hour || 0
            },
            items: (seg.items || [])
              .slice()
              .sort(function (a, b) { return a.sort_order - b.sort_order; })
              .map(function (itm) {
                return {
                  id:              itm.id,
                  productId:       itm.product_id || null,
                  name:            itm.name,
                  brand:           itm.brand || '',
                  type:            itm.type,
                  carbsPerUnit:    itm.carbs_per_unit    || 0,
                  sodiumPerUnit:   itm.sodium_per_unit   || 0,
                  caffeinePerUnit: itm.caffeine_per_unit || 0,
                  quantity:        itm.quantity || 1
                };
              })
          };
        })
    };
  }
```

- [ ] **Step 4: Update `newEvent` in `data.js`**

Find `newEvent` (around line 358). Add `postEventNotes` and `actuals`:

```js
  function newEvent(name) {
    return {
      id:             generateId(),
      name:           name || 'New Event',
      date:           new Date().toISOString().slice(0, 10),
      type:           'ride',
      notes:          '',
      postEventNotes: '',
      actuals:        {},
      segments:       [newSegment(name || 'New Event', 1)]
    };
  }
```

- [ ] **Step 5: Add `saveActuals` to `data.js`**

Add this function after `deleteEvent` (around line 206):

```js
  async function saveActuals(eventId, actuals, postEventNotes) {
    await supabaseRequest(
      'PATCH',
      'events?id=eq.' + eventId,
      { actuals: actuals, post_event_notes: postEventNotes || null },
      'return=minimal'
    );
  }
```

- [ ] **Step 6: Add `saveActuals` to exports in `data.js`**

Find the exports block at the bottom. Add:

```js
  exports.saveActuals      = saveActuals;
```

Place it after `exports.deleteEvent = deleteEvent;`.

- [ ] **Step 7: Run tests — confirm all pass**

```
node tests/data.test.js
```

Expected: all tests pass, 0 failed.

- [ ] **Step 8: Commit**

```bash
git add data.js tests/data.test.js
git commit -m "feat: add saveActuals, postEventNotes + actuals normalisation in data.js"
```

---

## Task 3: data.js — actual calculation functions

**Context:** The existing `calcSegmentTotals`, `calcSegmentRates`, `calcEventTotals`, `calcEventRates` operate on planned segments. The new functions operate on the actuals JSONB structure. An `actualSegment` object has shape `{ durationHours, items: [...] }` where items have the same fields as planned items. `event.actuals` is a plain object keyed by segment UUID.

**Files:**
- Modify: `data.js`
- Test: `tests/data.test.js`

- [ ] **Step 1: Write failing tests**

Add to `tests/data.test.js` inside `run()`, after the `rateStatus` tests (around line 356):

```js
  // ── Actual calculations ───────────────────────────────────────────────────────

  console.log('\nActual calculations');

  await test('calcActualSegmentTotals: sums items correctly', function () {
    var actualSeg = {
      durationHours: 2,
      items: [
        { carbsPerUnit: 80, sodiumPerUnit: 400, caffeinePerUnit: 0, quantity: 3 },
        { carbsPerUnit: 22, sodiumPerUnit: 100, caffeinePerUnit: 50, quantity: 2 }
      ]
    };
    var t = D.calcActualSegmentTotals(actualSeg);
    assert.strictEqual(t.carbs, 284);    // 240 + 44
    assert.strictEqual(t.sodium, 1400);  // 1200 + 200
    assert.strictEqual(t.caffeine, 100); // 0 + 100
  });

  await test('calcActualSegmentTotals: empty items returns zeros', function () {
    var t = D.calcActualSegmentTotals({ durationHours: 2, items: [] });
    assert.deepStrictEqual(t, { carbs: 0, sodium: 0, caffeine: 0 });
  });

  await test('calcActualSegmentRates: divides by durationHours', function () {
    var actualSeg = {
      durationHours: 2,
      items: [{ carbsPerUnit: 100, sodiumPerUnit: 500, caffeinePerUnit: 0, quantity: 2 }]
    };
    var r = D.calcActualSegmentRates(actualSeg);
    assert.strictEqual(r.carbs, 100);   // 200 / 2
    assert.strictEqual(r.sodium, 500);  // 1000 / 2
  });

  await test('calcActualSegmentRates: uses 1 as fallback when durationHours is 0 or null', function () {
    var actualSeg = { durationHours: null, items: [{ carbsPerUnit: 80, sodiumPerUnit: 0, caffeinePerUnit: 0, quantity: 1 }] };
    var r = D.calcActualSegmentRates(actualSeg);
    assert.strictEqual(r.carbs, 80);
  });

  await test('calcActualEventTotals: sums across all actual segments', function () {
    var event = {
      actuals: {
        'seg-1': { durationHours: 3, items: [{ carbsPerUnit: 80, sodiumPerUnit: 400, caffeinePerUnit: 0, quantity: 3 }] },
        'seg-2': { durationHours: 1.5, items: [{ carbsPerUnit: 22, sodiumPerUnit: 100, caffeinePerUnit: 50, quantity: 4 }] }
      }
    };
    var t = D.calcActualEventTotals(event);
    assert.strictEqual(t.carbs, 328);        // 240 + 88
    assert.strictEqual(t.sodium, 1600);      // 1200 + 400
    assert.strictEqual(t.caffeine, 200);     // 0 + 200
    assert.strictEqual(t.durationHours, 4.5);
  });

  await test('calcActualEventTotals: returns zeros when actuals is empty', function () {
    var t = D.calcActualEventTotals({ actuals: {} });
    assert.deepStrictEqual(t, { carbs: 0, sodium: 0, caffeine: 0, durationHours: 0 });
  });

  await test('calcActualEventRates: divides totals by total actual duration', function () {
    var event = {
      actuals: {
        'seg-1': { durationHours: 2, items: [{ carbsPerUnit: 100, sodiumPerUnit: 500, caffeinePerUnit: 0, quantity: 2 }] },
        'seg-2': { durationHours: 2, items: [{ carbsPerUnit: 100, sodiumPerUnit: 500, caffeinePerUnit: 0, quantity: 2 }] }
      }
    };
    var r = D.calcActualEventRates(event);
    assert.strictEqual(r.carbs, 100);   // 400 total / 4h
    assert.strictEqual(r.sodium, 500);  // 2000 total / 4h
  });

  await test('calcActualEventRates: uses 1 as fallback when total duration is 0', function () {
    var event = {
      actuals: {
        'seg-1': { durationHours: 0, items: [{ carbsPerUnit: 80, sodiumPerUnit: 0, caffeinePerUnit: 0, quantity: 1 }] }
      }
    };
    var r = D.calcActualEventRates(event);
    assert.strictEqual(r.carbs, 80);
  });
```

- [ ] **Step 2: Run tests — confirm new ones fail**

```
node tests/data.test.js
```

Expected: new calc tests fail with "D.calcActualSegmentTotals is not a function" or similar.

- [ ] **Step 3: Add the four calculation functions to `data.js`**

Add after `rateStatus` (around line 344), before the factories section:

```js
  function calcActualSegmentTotals(actualSegment) {
    return (actualSegment.items || []).reduce(function (acc, item) {
      return {
        carbs:    acc.carbs    + (item.carbsPerUnit    || 0) * (item.quantity || 0),
        sodium:   acc.sodium   + (item.sodiumPerUnit   || 0) * (item.quantity || 0),
        caffeine: acc.caffeine + (item.caffeinePerUnit || 0) * (item.quantity || 0)
      };
    }, { carbs: 0, sodium: 0, caffeine: 0 });
  }

  function calcActualSegmentRates(actualSegment) {
    var t = calcActualSegmentTotals(actualSegment);
    var h = actualSegment.durationHours || 1;
    return { carbs: t.carbs / h, sodium: t.sodium / h, caffeine: t.caffeine / h };
  }

  function calcActualEventTotals(event) {
    return Object.keys(event.actuals || {}).reduce(function (acc, segId) {
      var actualSeg = event.actuals[segId];
      var t = calcActualSegmentTotals(actualSeg);
      return {
        carbs:         acc.carbs         + t.carbs,
        sodium:        acc.sodium        + t.sodium,
        caffeine:      acc.caffeine      + t.caffeine,
        durationHours: acc.durationHours + (actualSeg.durationHours || 0)
      };
    }, { carbs: 0, sodium: 0, caffeine: 0, durationHours: 0 });
  }

  function calcActualEventRates(event) {
    var t = calcActualEventTotals(event);
    var h = t.durationHours || 1;
    return { carbs: t.carbs / h, sodium: t.sodium / h, caffeine: t.caffeine / h };
  }
```

- [ ] **Step 4: Add the four functions to exports in `data.js`**

Add after `exports.rateStatus = rateStatus;`:

```js
  exports.calcActualSegmentTotals = calcActualSegmentTotals;
  exports.calcActualSegmentRates  = calcActualSegmentRates;
  exports.calcActualEventTotals   = calcActualEventTotals;
  exports.calcActualEventRates    = calcActualEventRates;
```

- [ ] **Step 5: Run tests — confirm all pass**

```
node tests/data.test.js
```

Expected: all tests pass, 0 failed.

- [ ] **Step 6: Commit**

```bash
git add data.js tests/data.test.js
git commit -m "feat: add actual calculation functions to data.js"
```

---

## Task 4: style.css — actual section styles

**Context:** The actual subsection appears below each planned segment section. It uses a blue top-border to visually separate it, an "ACTUAL" pill label, item rows (reusing `.item-row` and `.stepper`), and an amber tint for one-off items. The summary cards need a planned→actual layout. A notes textarea sits at the bottom of the detail view.

**Files:**
- Modify: `style.css`

No tests for CSS. Verify visually in Task 5.

- [ ] **Step 1: Append the new styles to the end of `style.css`**

Append after the existing `@media (min-width: 768px)` toast rule at the very end:

```css
/* ── Post-event actuals ──────────────────────────────────────────────────── */
.actual-section {
  border-top: 2px solid var(--accent);
  background: var(--surface);
  margin-top: 0;
}

.actual-section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px 6px;
}

.actual-pill {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  background: var(--accent);
  color: var(--accent-fg);
  padding: 2px 7px;
  border-radius: 20px;
}

.actual-section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-secondary);
}

.actual-duration-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 16px 8px;
  font-size: 13px;
  color: var(--text-secondary);
}

.actual-duration-value {
  font-weight: 600;
  color: var(--text);
  cursor: pointer;
  border-bottom: 1px dashed var(--border);
}

.actual-section .item-row.is-oneoff {
  background: var(--amber-bg);
}

.actual-section .item-row.is-oneoff .item-name::after {
  content: ' · one-off';
  font-size: 11px;
  font-weight: 400;
  color: var(--amber-text);
}

/* ── Post-event notes ────────────────────────────────────────────────────── */
.post-event-notes-section {
  background: var(--surface);
  margin-top: 8px;
  padding: 14px 16px 20px;
}

.post-event-notes-section label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 8px;
  color: var(--text);
}

.post-event-notes-textarea {
  width: 100%;
  min-height: 80px;
  padding: 10px 12px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 13px;
  color: var(--text);
  resize: vertical;
  line-height: 1.5;
}

.post-event-notes-textarea:focus {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

/* ── Summary cards: planned→actual layout ────────────────────────────────── */
.metric-card.has-actuals .metric-value {
  font-size: 12px;
  color: var(--text-tertiary);
  text-decoration: line-through;
  font-weight: 400;
  margin-bottom: 0;
}

.metric-card.has-actuals .metric-actual {
  font-size: 18px;
  font-weight: 700;
  color: var(--text);
  line-height: 1.2;
}

.metric-card.has-actuals .metric-rate {
  font-size: 11px;
  color: var(--text-tertiary);
  text-decoration: line-through;
}

.metric-card.has-actuals .metric-actual-rate {
  font-size: 11px;
  color: var(--text-secondary);
}
```

- [ ] **Step 2: Commit**

```bash
git add style.css
git commit -m "feat: add actual section, planned→actual card, and notes textarea styles"
```

---

## Task 5: app.js — date check, pre-population, actual section HTML

**Context:** `renderDetail` in `app.js` fetches the event, renders summary cards, then renders each segment via `segmentSectionHTML`. This task adds:
1. `isEventPastOrToday(dateStr)` — returns `true` when the event date ≤ today (string comparison works because ISO dates are lexicographically sortable).
2. Pre-population — when a past event is first opened, `event.actuals[segId]` doesn't exist; we fill it from the planned segment's items (deep-copying with new IDs so actual items are independent) and save once to Supabase.
3. `actualItemRowHTML(item)` — renders one actual item row with `data-actual-item-id` (not `data-item-id`) so handlers can distinguish actual vs planned steppers.
4. `actualSegmentSectionHTML(seg, actualSeg)` — the ACTUAL block rendered after each planned segment.
5. Update `renderDetail` to call these when `showActuals` is true.

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Add `isEventPastOrToday` helper**

Add this function directly after the `escHtml` function (around line 137, after the closing brace of `escHtml`):

```js
  function isEventPastOrToday(dateStr) {
    if (!dateStr) return true; // no date set = treat as past
    return dateStr <= new Date().toISOString().slice(0, 10);
  }
```

- [ ] **Step 2: Add `actualItemRowHTML` helper**

Add this function directly after `itemRowHTML` (around line 489):

```js
  function actualItemRowHTML(item) {
    var metaParts = [TYPE_LABELS[item.type] || escHtml(item.type)];
    if (item.carbsPerUnit)   metaParts.push(item.carbsPerUnit + 'g');
    if (item.sodiumPerUnit)  metaParts.push(item.sodiumPerUnit + 'mg Na');
    if (item.caffeinePerUnit) metaParts.push(item.caffeinePerUnit + 'mg caff');
    var isOneOff = !item.productId;
    return '<div class="item-row' + (isOneOff ? ' is-oneoff' : '') + '" data-actual-item-id="' + item.id + '">' +
      '<div class="item-info">' +
        '<div class="item-name">' + escHtml((item.brand ? item.brand + ' ' : '') + item.name) + '</div>' +
        '<div class="item-meta">' + metaParts.join(' · ') + '</div>' +
      '</div>' +
      '<div class="stepper">' +
        '<button class="stepper-btn" data-action="dec">&#8722;</button>' +
        '<span class="stepper-qty">' + item.quantity + '</span>' +
        '<button class="stepper-btn" data-action="inc">&#43;</button>' +
      '</div>' +
    '</div>';
  }
```

- [ ] **Step 3: Add `postEventNotesHTML` helper**

Add directly after `totalsFooterHTML` (around line 498):

```js
  function postEventNotesHTML(notes) {
    return '<div class="post-event-notes-section">' +
      '<label for="post-event-notes">Post-event notes</label>' +
      '<textarea id="post-event-notes" class="post-event-notes-textarea"' +
        ' placeholder="What worked, what didn\'t\u2026">' +
      escHtml(notes || '') +
      '</textarea>' +
    '</div>';
  }
```

- [ ] **Step 4: Add `actualSegmentSectionHTML` helper**

Add directly after `postEventNotesHTML`:

```js
  function actualSegmentSectionHTML(seg, actualSeg) {
    var dh = actualSeg.durationHours;
    var dhLabel = (dh && dh > 0)
      ? (dh === Math.floor(dh) ? dh + 'h' : dh.toFixed(1) + 'h')
      : '—';
    return '<div class="actual-section" data-actual-segment-id="' + seg.id + '">' +
      '<div class="actual-section-header">' +
        '<span class="actual-pill">ACTUAL</span>' +
        '<span class="actual-section-title">' + escHtml(seg.name) + '</span>' +
      '</div>' +
      '<div class="actual-duration-row">' +
        'Duration: <span class="actual-duration-value editable" data-inline="actual-duration">' +
        dhLabel +
        '</span>' +
      '</div>' +
      '<div class="item-list">' +
        (actualSeg.items.length
          ? actualSeg.items.map(function (item) { return actualItemRowHTML(item); }).join('')
          : '<div style="padding:8px 16px;font-size:13px;color:var(--text-tertiary)">No items logged yet.</div>') +
      '</div>' +
      '<button class="btn-add-item" data-add-actual-segment-id="' + seg.id + '">+ Add item</button>' +
    '</div>';
  }
```

- [ ] **Step 5: Update `renderDetail` to add pre-population and render actual sections**

Replace the entire `renderDetail` function (lines 360–398) with:

```js
  async function renderDetail() {
    showContainerSpinner($('detail-body'));

    var evt;
    try {
      evt = await Data.getEvent(state.currentEventId);
    } catch (e) {
      $('detail-body').innerHTML = '';
      showToast("Couldn't load event — check your connection.");
      return;
    }
    if (!evt) { navigate('events'); return; }

    var showActuals = isEventPastOrToday(evt.date);

    // Pre-populate actuals from plan on first open (silent background save)
    if (showActuals) {
      var needsSave = false;
      evt.segments.forEach(function (seg) {
        if (!evt.actuals[seg.id]) {
          evt.actuals[seg.id] = {
            durationHours: seg.durationHours,
            items: seg.items.map(function (item) {
              return Object.assign({}, item, { id: Data.generateId() });
            })
          };
          needsSave = true;
        }
      });
      if (needsSave) {
        Data.saveActuals(evt.id, evt.actuals, evt.postEventNotes).catch(function (e) {
          console.error('Failed to pre-populate actuals:', e);
        });
      }
    }

    $('detail-event-name').textContent = evt.name;

    var totals = Data.calcEventTotals(evt);
    var rates  = Data.calcEventRates(evt);
    var totalH = totals.durationHours;

    var hasActuals = showActuals && Object.keys(evt.actuals).length > 0;
    var actTotals = hasActuals ? Data.calcActualEventTotals(evt) : null;
    var actRates  = hasActuals ? Data.calcActualEventRates(evt)  : null;

    $('detail-summary').innerHTML =
      '<div class="event-meta-row">' +
        '<span class="type-badge">' + (EVENT_TYPE_LABELS[evt.type] || escHtml(evt.type)) + '</span>' +
        (evt.date ? '<span class="event-meta-date">' + escHtml(evt.date) + '</span>' : '') +
      '</div>' +
      '<div class="summary-cards">' +
        metricCardHTML('carbs',    Math.round(totals.carbs) + 'g',  fmt(rates.carbs, 'g/hr avg'),
          actTotals ? Math.round(actTotals.carbs) + 'g'   : undefined,
          actRates  ? fmt(actRates.carbs, 'g/hr avg')     : undefined) +
        metricCardHTML('sodium',   Math.round(totals.sodium) + 'mg', fmt(rates.sodium, 'mg/hr avg'),
          actTotals ? Math.round(actTotals.sodium) + 'mg' : undefined,
          actRates  ? fmt(actRates.sodium, 'mg/hr avg')   : undefined) +
        metricCardHTML('caffeine', Math.round(totals.caffeine) + 'mg', fmt(rates.caffeine, 'mg/hr avg'),
          actTotals ? Math.round(actTotals.caffeine) + 'mg' : undefined,
          actRates  ? fmt(actRates.caffeine, 'mg/hr avg')   : undefined) +
      '</div>';

    var multiSeg = evt.segments.length > 1;
    var $body = $('detail-body');
    $body.innerHTML =
      evt.segments.map(function (seg) {
        var html = segmentSectionHTML(seg, multiSeg);
        if (showActuals) {
          var actualSeg = evt.actuals[seg.id] || { durationHours: null, items: [] };
          html += actualSegmentSectionHTML(seg, actualSeg);
        }
        return html;
      }).join('') +
      (multiSeg ? totalsFooterHTML(totals, totalH) : '') +
      (showActuals ? postEventNotesHTML(evt.postEventNotes) : '');

    attachDetailHandlers(evt);
  }
```

- [ ] **Step 6: Update `metricCardHTML` to support planned→actual display**

Replace the existing `metricCardHTML` function (around line 400):

```js
  function metricCardHTML(key, value, rate, actualValue, actualRate) {
    var labels = { carbs: 'Carbs', sodium: 'Sodium', caffeine: 'Caffeine' };
    var hasActuals = actualValue !== undefined;
    return '<div class="metric-card' + (hasActuals ? ' has-actuals' : '') + '">' +
      '<div class="metric-value">' + value + '</div>' +
      (hasActuals ? '<div class="metric-actual">' + actualValue + '</div>' : '') +
      '<div class="metric-label">' + labels[key] + '</div>' +
      '<div class="metric-rate">' + rate + '</div>' +
      (hasActuals ? '<div class="metric-actual-rate">' + actualRate + '</div>' : '') +
    '</div>';
  }
```

- [ ] **Step 7: Commit**

```bash
git add app.js
git commit -m "feat: add actual section HTML helpers and pre-population in renderDetail"
```

---

## Task 6: app.js — actual item stepper handlers + duration inline edit

**Context:** Actual item rows use `data-actual-item-id` (not `data-item-id`) and live inside `.actual-section[data-actual-segment-id]`. Steppers for actuals call `updateActualItemQty` which updates `event.actuals[segId].items` and calls `Data.saveActuals`. Duration taps open an inline input via `makeEditable` (same helper used for planned segment fields); the value is saved to `event.actuals[segId].durationHours` via `saveActuals`. All these handlers are wired in `attachDetailHandlers`.

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Add `updateActualItemQty` function**

Add after `updateItemQty` (around line 568), before `renders.detail = renderDetail`:

```js
  async function updateActualItemQty(eventId, segId, itemId, delta) {
    var evt;
    try { evt = await Data.getEvent(eventId); }
    catch (e) { showToast("Couldn't load event — check your connection."); return; }
    if (!evt) return;

    var actualSeg = evt.actuals[segId];
    if (!actualSeg) return;
    var item = actualSeg.items.find(function (i) { return i.id === itemId; });
    if (!item) return;

    item.quantity = Math.max(0, item.quantity + delta);
    if (item.quantity === 0) {
      actualSeg.items = actualSeg.items.filter(function (i) { return i.id !== itemId; });
    }

    try {
      await Data.saveActuals(evt.id, evt.actuals, evt.postEventNotes);
      await renderDetail();
    } catch (e) {
      showToast("Couldn't save — check your connection.");
    }
  }
```

- [ ] **Step 2: Wire actual stepper and duration handlers in `attachDetailHandlers`**

Find `attachDetailHandlers` (around line 500). Add the following block at the end of the function, after the existing `$$('[data-inline]')` handler block:

```js
    // Actual stepper buttons
    $$('.actual-section .stepper-btn', $('detail-body')).forEach(function (btn) {
      on(btn, 'click', function () {
        var row    = btn.closest('[data-actual-item-id]');
        var secEl  = btn.closest('[data-actual-segment-id]');
        if (!row || !secEl) return;
        var itemId = row.dataset.actualItemId;
        var segId  = secEl.dataset.actualSegmentId;
        updateActualItemQty(evt.id, segId, itemId, btn.dataset.action === 'inc' ? 1 : -1);
      });
    });

    // Actual duration inline edit
    $$('[data-inline="actual-duration"]', $('detail-body')).forEach(function (el) {
      on(el, 'click', function () {
        var secEl = el.closest('[data-actual-segment-id]');
        if (!secEl) return;
        var segId = secEl.dataset.actualSegmentId;
        // Strip display label so input shows a plain number
        var raw = el.textContent.trim();
        el.textContent = parseFloat(raw.replace(/[^0-9.]/g, '')) || '';
        makeEditable(el, async function (val) {
          try {
            var evt2 = await Data.getEvent(evt.id);
            if (!evt2) return;
            var num = parseFloat(val);
            if (num > 0) {
              if (!evt2.actuals[segId]) evt2.actuals[segId] = { durationHours: null, items: [] };
              evt2.actuals[segId].durationHours = num;
              await Data.saveActuals(evt2.id, evt2.actuals, evt2.postEventNotes);
              await renderDetail();
            }
          } catch (e) {
            showToast("Couldn't save — check your connection.");
          }
        });
      });
    });
```

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "feat: wire actual item stepper and duration inline edit handlers"
```

---

## Task 7: app.js — add item to actuals (sheet integration)

**Context:** The existing add-item bottom sheet (`openAddItemSheet`) sets `_sheetEventId` and `_sheetSegmentId`, then adds items to planned segments. We need a third boolean `_sheetIsActual` to distinguish planned vs actual. When `_sheetIsActual` is true, clicking a product or submitting the one-off form calls `addItemToActualSegment` (writes to `event.actuals[segId].items` + saves via `saveActuals`) instead of `addItemToSegment` (writes to planned segment + saves via `saveEvent`).

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Add `_sheetIsActual` state variable**

Find the two sheet state variables (around line 574):

```js
  var _sheetEventId = null;
  var _sheetSegmentId = null;
```

Add `_sheetIsActual` directly after:

```js
  var _sheetEventId = null;
  var _sheetSegmentId = null;
  var _sheetIsActual = false;
```

- [ ] **Step 2: Update `openAddItemSheet` to accept `isActual` parameter**

Find `openAddItemSheet` (around line 577). Replace its signature and first three lines:

```js
  function openAddItemSheet(eventId, segmentId, isActual) {
    _sheetEventId   = eventId;
    _sheetSegmentId = segmentId;
    _sheetIsActual  = !!isActual;
    $('sheet-overlay').classList.remove('hidden');
    $('product-search').value = '';
    renderSheetLibraryTab().catch(function (e) {
      showToast("Couldn't load library — check your connection.");
    });
    // Reset to library tab
    $$('.sheet-tab-btn').forEach(function (b) { b.classList.remove('active'); });
    $$('.sheet-tab-content').forEach(function (c) { c.classList.remove('active'); });
    $('sheet-tab-library').classList.add('active');
    document.querySelector('[data-sheet-tab="library"]').classList.add('active');
    // Reset one-off form
    $('oneoff-form').reset();
    $('product-search').focus();
  }
```

- [ ] **Step 3: Update `closeSheet` to reset `_sheetIsActual`**

Find `closeSheet` (around line 595):

```js
  function closeSheet() {
    $('sheet-overlay').classList.add('hidden');
    _sheetEventId   = null;
    _sheetSegmentId = null;
    _sheetIsActual  = false;
  }
```

- [ ] **Step 4: Add `addItemToActualSegment` function**

Add directly after `addItemToSegment` (around line 691):

```js
  async function addItemToActualSegment(eventId, segmentId, item) {
    var evt = await Data.getEvent(eventId);
    if (!evt) return;
    if (!evt.actuals[segmentId]) {
      evt.actuals[segmentId] = { durationHours: null, items: [] };
    }
    evt.actuals[segmentId].items.push(item);
    await Data.saveActuals(evt.id, evt.actuals, evt.postEventNotes);
  }
```

- [ ] **Step 5: Update `attachSheetProductHandlers` to branch on `_sheetIsActual`**

Find `attachSheetProductHandlers` (around line 661). Inside the click handler, replace the `addItemToSegment` call block:

```js
        try {
          if (_sheetIsActual) {
            await addItemToActualSegment(_sheetEventId, _sheetSegmentId, Data.itemFromProduct(product));
          } else {
            await addItemToSegment(_sheetEventId, _sheetSegmentId, Data.itemFromProduct(product));
          }
          Data.recordProductUsed(productId);
          closeSheet();
          await renderDetail();
        } catch (e) {
          showToast("Couldn't add item — check your connection.");
        }
```

- [ ] **Step 6: Update the one-off form submit handler to branch on `_sheetIsActual`**

Find the one-off form submit handler (around line 723). Replace the `addItemToSegment` call inside it:

```js
      try {
        if ($('oo-save-library').checked) {
          var product = Object.assign({ id: Data.generateId() }, fields, {
            carbsPerUnit:    Number(fields.carbsPerUnit)    || 0,
            sodiumPerUnit:   Number(fields.sodiumPerUnit)   || 0,
            caffeinePerUnit: Number(fields.caffeinePerUnit) || 0
          });
          await Data.saveProduct(product);
          item.productId = product.id;
          Data.recordProductUsed(product.id);
        }
        if (_sheetIsActual) {
          await addItemToActualSegment(_sheetEventId, _sheetSegmentId, item);
        } else {
          await addItemToSegment(_sheetEventId, _sheetSegmentId, item);
        }
        closeSheet();
        await renderDetail();
      } catch (e) {
        showToast("Couldn't save — check your connection.");
      }
```

- [ ] **Step 7: Wire actual "Add item" button in `attachDetailHandlers`**

In `attachDetailHandlers`, find the block wiring `[data-add-segment-id]` (around line 532):

```js
    // Add item buttons (planned segments)
    $$('[data-add-segment-id]', $('detail-body')).forEach(function (btn) {
      on(btn, 'click', function () {
        openAddItemSheet(evt.id, btn.dataset.addSegmentId);
      });
    });

    // Add item buttons (actual segments)
    $$('[data-add-actual-segment-id]', $('detail-body')).forEach(function (btn) {
      on(btn, 'click', function () {
        openAddItemSheet(evt.id, btn.dataset.addActualSegmentId, true);
      });
    });
```

Replace the existing `[data-add-segment-id]` block with both blocks above (add the actuals block immediately after the planned block).

- [ ] **Step 8: Commit**

```bash
git add app.js
git commit -m "feat: wire add-item sheet to actual segments via _sheetIsActual flag"
```

---

## Task 8: app.js — post-event notes textarea

**Context:** The notes textarea (`id="post-event-notes"`) is rendered at the bottom of the event detail when `showActuals` is true. It saves on `blur` to avoid saving on every keystroke. The save fetches the latest event from Supabase (to get current `actuals`), updates `postEventNotes` in memory, then calls `saveActuals`.

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Wire the notes textarea blur handler in `attachDetailHandlers`**

Add at the very end of `attachDetailHandlers`, after the actual duration handler block added in Task 6:

```js
    // Post-event notes — save on blur
    var notesTextarea = $('post-event-notes');
    if (notesTextarea) {
      on(notesTextarea, 'blur', async function () {
        try {
          var evt2 = await Data.getEvent(evt.id);
          if (!evt2) return;
          await Data.saveActuals(evt2.id, evt2.actuals, notesTextarea.value);
        } catch (e) {
          showToast("Couldn't save — check your connection.");
        }
      });
    }
```

- [ ] **Step 2: Commit**

```bash
git add app.js
git commit -m "feat: save post-event notes textarea on blur"
```

---

## Task 9: Cleanup

**Files:**
- Delete: `_mockup.html`

- [ ] **Step 1: Delete the temporary mockup file**

```bash
rm /Users/funmi/Development/projects/fueling-calculator/_mockup.html
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "chore: remove temporary brainstorming mockup file"
```

---

## Verification Checklist (manual smoke test)

After all tasks are complete, open the app at `http://localhost:8080` and verify:

- [ ] **Future event**: Create an event dated tomorrow — no ACTUAL section appears on the detail view
- [ ] **Past event**: Open an event dated today or earlier — each segment shows an ACTUAL subsection with pre-populated items from the plan
- [ ] **Summary cards**: For a past event, cards show planned value (struck-through) above actual value
- [ ] **Stepper in actuals**: Tap + / − on an actual item — quantity changes, Supabase `actuals` column updates (verify in Supabase table editor)
- [ ] **Duration edit**: Tap the duration value in an actual section, type a new number, press Enter — value updates and saves
- [ ] **Add item to actuals (library)**: Tap "+ Add item" in the actual section → sheet opens → tap a library product → item appears in ACTUAL section (not planned)
- [ ] **Add item to actuals (one-off)**: In the actual section, open sheet → One-off tab → fill in a name → Add item → appears with amber "one-off" tint
- [ ] **Notes**: Type in the post-event notes textarea, click elsewhere — saving persists across page refresh
- [ ] **Cross-device**: Open the same past event on a second browser — actuals and notes are visible
