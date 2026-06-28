# Multi-Day Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multi-day event support — a Category field (Single-day / Multi-day), two new event types, date range display, per-segment dates on multi-day events, and updated past-event archiving.

**Architecture:** Four files change in concert: `data.js` gains new fields in its mapping/factory functions; `index.html` gains new form elements; `app.js` gains the toggle logic, updated renderers, and updated past/upcoming split; `style.css` gains the end-date reveal transition. The DB migration is a separate SQL file already committed. No new files are created.

**Tech Stack:** Vanilla HTML/CSS/JS. Tests use Node.js `assert` with a custom `test()` runner in `tests/data.test.js`. Run tests with `node tests/data.test.js`.

## Global Constraints

- No build step, no dependencies — plain ES5-compatible JS only (no `let`, `const`, arrow functions, template literals, destructuring, spread in production code)
- `data.js` wraps everything in `(function(exports){...})(...)` — all new code goes inside that IIFE
- `app.js` wraps everything in `(function(){...})()` — all new code goes inside that IIFE
- Event types are stored as snake_case strings: `vacation`, `training_camp`
- Dates are stored as `"YYYY-MM-DD"` strings or `""`
- `category` field: `"single"` | `"multi"` — default `"single"`
- Feature branch: `feature/multi-day-events`

---

### Task 1: Data layer — new fields in dbToEvent, eventToDb, newEvent, newSegment

**Files:**
- Modify: `data.js:145-225` (dbToEvent, eventToDb)
- Modify: `data.js:490-510` (newEvent, newSegment factories)
- Test: `tests/data.test.js`

**Interfaces:**
- Produces: `evt.category` (`"single"` | `"multi"`), `evt.endDate` (`"YYYY-MM-DD"` | `""`), `seg.date` (`"YYYY-MM-DD"` | `""`) on all event/segment objects from `dbToEvent` and `newEvent`/`newSegment`

- [ ] **Step 1: Write failing tests**

Add these tests to `tests/data.test.js`, after the existing tests:

```js
test('dbToEvent: category defaults to single when missing', function () {
  var row = {
    id: 'e1', name: 'Test', date: '2026-06-28', type: 'ride',
    notes: null, post_event_notes: null, actuals: null,
    segments: []
  };
  var evt = D.dbToEvent(row);
  assert.strictEqual(evt.category, 'single');
  assert.strictEqual(evt.endDate, '');
});

test('dbToEvent: category and endDate round-trip from row', function () {
  var row = {
    id: 'e2', name: 'Tour', date: '2026-06-28', type: 'ride',
    category: 'multi', end_date: '2026-07-04',
    notes: null, post_event_notes: null, actuals: null,
    segments: []
  };
  var evt = D.dbToEvent(row);
  assert.strictEqual(evt.category, 'multi');
  assert.strictEqual(evt.endDate, '2026-07-04');
});

test('dbToEvent: segment date round-trips from row', function () {
  var row = {
    id: 'e3', name: 'Camp', date: '2026-06-28', type: 'training_camp',
    category: 'multi', end_date: '2026-07-02',
    notes: null, post_event_notes: null, actuals: null,
    segments: [{
      id: 's1', name: 'Day 1', duration_hours: 3, sort_order: 0,
      date: '2026-06-28',
      carbs_per_hour: 80, sodium_per_hour: 500, caffeine_per_hour: 0,
      items: []
    }]
  };
  var evt = D.dbToEvent(row);
  assert.strictEqual(evt.segments[0].date, '2026-06-28');
});

test('dbToEvent: segment date defaults to empty string when missing', function () {
  var row = {
    id: 'e4', name: 'Ride', date: '2026-06-28', type: 'ride',
    notes: null, post_event_notes: null, actuals: null,
    segments: [{
      id: 's1', name: 'Bike', duration_hours: 2, sort_order: 0,
      carbs_per_hour: 80, sodium_per_hour: 500, caffeine_per_hour: 0,
      items: []
    }]
  };
  var evt = D.dbToEvent(row);
  assert.strictEqual(evt.segments[0].date, '');
});

test('eventToDb: passes category and end_date through', function () {
  var evt = {
    id: 'e5', name: 'Tour', date: '2026-06-28', type: 'ride',
    category: 'multi', endDate: '2026-07-04',
    notes: '', segments: []
  };
  var row = D.eventToDb(evt);
  assert.strictEqual(row.category, 'multi');
  assert.strictEqual(row.end_date, '2026-07-04');
});

test('eventToDb: passes segment date through', function () {
  var seg = {
    id: 's1', name: 'Day 1', durationHours: 3, date: '2026-06-28',
    targets: { carbsPerHour: 80, sodiumPerHour: 500, caffeinePerHour: 0 },
    items: []
  };
  var evt = {
    id: 'e6', name: 'Camp', date: '2026-06-28', type: 'training_camp',
    category: 'multi', endDate: '2026-07-02', notes: '', segments: [seg]
  };
  var row = D.eventToDb(evt);
  assert.strictEqual(row.segments[0].date, '2026-06-28');
});

test('newEvent: includes category single and empty endDate', function () {
  var evt = D.newEvent('Test');
  assert.strictEqual(evt.category, 'single');
  assert.strictEqual(evt.endDate, '');
});

test('newSegment: includes empty date by default', function () {
  var seg = D.newSegment('Bike', 2);
  assert.strictEqual(seg.date, '');
});

test('newSegment: accepts a pre-fill date', function () {
  var seg = D.newSegment('Day 1', 3, '2026-06-28');
  assert.strictEqual(seg.date, '2026-06-28');
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
node tests/data.test.js
```

Expected: failures on the new tests (functions don't return category/endDate/date yet).

- [ ] **Step 3: Update dbToEvent**

In `data.js`, update `dbToEvent` (around line 145):

```js
function dbToEvent(row) {
  return {
    id:             row.id,
    name:           row.name,
    date:           row.date || '',
    endDate:        row.end_date || '',
    category:       row.category || 'single',
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
          date:          seg.date || '',
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

- [ ] **Step 4: Update eventToDb**

In `data.js`, update `eventToDb` (around line 189):

```js
function eventToDb(evt) {
  return {
    id:       evt.id,
    user_id:  getUserId(),
    name:     evt.name,
    date:     evt.date || '',
    end_date: evt.endDate || null,
    category: evt.category || 'single',
    type:     evt.type || 'other',
    notes:    evt.notes || null,
    segments: (evt.segments || []).map(function (seg, si) {
      return {
        id:            seg.id,
        name:          seg.name,
        date:          seg.date || null,
        durationHours: seg.durationHours,
        sortOrder:     si,
        targets: {
          carbsPerHour:    (seg.targets && seg.targets.carbsPerHour)    || 0,
          sodiumPerHour:   (seg.targets && seg.targets.sodiumPerHour)   || 0,
          caffeinePerHour: (seg.targets && seg.targets.caffeinePerHour) || 0
        },
        items: (seg.items || []).map(function (itm, ii) {
          return {
            id:              itm.id,
            productId:       itm.productId || null,
            name:            itm.name,
            brand:           itm.brand || null,
            type:            itm.type,
            carbsPerUnit:    itm.carbsPerUnit    || 0,
            sodiumPerUnit:   itm.sodiumPerUnit   || 0,
            caffeinePerUnit: itm.caffeinePerUnit || 0,
            quantity:        itm.quantity || 1,
            sortOrder:       ii
          };
        })
      };
    })
  };
}
```

- [ ] **Step 5: Update newEvent and newSegment factories**

In `data.js`, update `newSegment` (around line 490) and `newEvent` (around line 500):

```js
function newSegment(name, durationHours, date) {
  return {
    id:            generateId(),
    name:          name || 'Segment',
    date:          date || '',
    durationHours: durationHours || 1,
    targets:       { carbsPerHour: 80, sodiumPerHour: 500, caffeinePerHour: 0 },
    items:         []
  };
}

function newEvent(name) {
  return {
    id:             generateId(),
    name:           name || 'New Event',
    date:           new Date().toISOString().slice(0, 10),
    endDate:        '',
    category:       'single',
    type:           'ride',
    notes:          '',
    postEventNotes: '',
    actuals:        {},
    segments:       [newSegment(name || 'New Event', 1)]
  };
}
```

- [ ] **Step 6: Export dbToEvent** (it's already exported as a private helper — confirm it's exposed in tests via `D.dbToEvent`)

In `data.js`, add to exports at the bottom:

```js
exports.dbToEvent  = dbToEvent;
exports.eventToDb  = eventToDb;
```

- [ ] **Step 7: Run tests and confirm they pass**

```bash
node tests/data.test.js
```

Expected: all tests PASS, summary line shows 0 failures.

- [ ] **Step 8: Commit**

```bash
git add data.js tests/data.test.js
git commit -m "feat: add category, endDate, and segment date to data model"
```

---

### Task 2: HTML form — Category select, Type additions, date range row

**Files:**
- Modify: `index.html:128-142` (event form date/type row)

**Interfaces:**
- Produces: `#ef-category` select, `#ef-end-date` date input, updated `#ef-type` options
- Consumed by: Task 3 (app.js renderCreate, form submit)

- [ ] **Step 1: Update the form rows in index.html**

Find the existing form rows (around line 128):

```html
          <div class="form-row">
            <div class="form-group">
              <label for="ef-date">Date</label>
              <input id="ef-date" class="form-input" type="date">
            </div>
            <div class="form-group">
              <label for="ef-type">Type</label>
              <select id="ef-type" class="form-input">
                <option value="ride">Ride</option>
                <option value="run">Run</option>
                <option value="triathlon">Triathlon</option>
                <option value="swim">Swim</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>
```

Replace with:

```html
          <div class="form-row">
            <div class="form-group">
              <label for="ef-category">Category</label>
              <select id="ef-category" class="form-input">
                <option value="single">Single-day</option>
                <option value="multi">Multi-day</option>
              </select>
            </div>
            <div class="form-group">
              <label for="ef-type">Type</label>
              <select id="ef-type" class="form-input">
                <option value="ride">Ride</option>
                <option value="run">Run</option>
                <option value="triathlon">Triathlon</option>
                <option value="swim">Swim</option>
                <option value="vacation">Vacation</option>
                <option value="training_camp">Training Camp</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>
          <div class="form-row ef-date-row">
            <div class="form-group">
              <label for="ef-date">Date</label>
              <div class="date-range-wrap">
                <input id="ef-date" class="form-input" type="date">
                <span class="date-range-sep" aria-hidden="true">—</span>
                <input id="ef-end-date" class="form-input ef-end-date-hidden" type="date">
              </div>
            </div>
          </div>
```

- [ ] **Step 2: Verify index.html parses correctly**

Open `index.html` in a browser (or `node -e "require('fs').readFileSync('./index.html','utf8')"`) and confirm no JS errors on load.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: add Category select, Vacation/Training Camp types, date range inputs to form"
```

---

### Task 3: app.js — renderCreate, toggle logic, form submit, segment date in form

**Files:**
- Modify: `app.js:116-119` (EVENT_TYPE_LABELS)
- Modify: `app.js:176-210` (segmentFormHTML)
- Modify: `app.js:336-491` (renderCreate, syncDraftSegmentsFromDOM, form submit, btn-add-segment)

**Interfaces:**
- Consumes: `#ef-category`, `#ef-end-date` from Task 2; `evt.category`, `evt.endDate`, `seg.date` from Task 1
- Produces: populated form on load, end-date reveal on category change, segment dates in submit payload

- [ ] **Step 1: Update EVENT_TYPE_LABELS**

In `app.js`, find (around line 116):

```js
  var EVENT_TYPE_LABELS = {
    ride: 'Ride', run: 'Run', triathlon: 'Triathlon',
    swim: 'Swim', other: 'Other'
  };
```

Replace with:

```js
  var EVENT_TYPE_LABELS = {
    ride: 'Ride', run: 'Run', triathlon: 'Triathlon',
    swim: 'Swim', vacation: 'Vacation', training_camp: 'Training Camp', other: 'Other'
  };
```

- [ ] **Step 2: Update segmentFormHTML to accept isMultiDay and render segment date**

In `app.js`, find `function segmentFormHTML(seg, idx, total)` (around line 176) and replace the entire function:

```js
  function segmentFormHTML(seg, idx, total, isMultiDay) {
    var canDelete = total > 1;
    return '<div class="form-card" data-seg-draft-id="' + seg.id + '">' +
      '<div class="form-section-header" style="margin-bottom:10px">' +
        '<span style="font-size:13px;font-weight:600;color:var(--text-secondary)">SEGMENT ' + (idx + 1) + '</span>' +
        (canDelete
          ? '<button type="button" class="btn-text btn-danger btn-remove-segment" style="font-size:13px">Remove</button>'
          : '') +
      '</div>' +
      '<div class="form-group">' +
        '<label>Name</label>' +
        '<input class="form-input seg-name" type="text" value="' + escHtml(seg.name) + '" placeholder="e.g. Bike">' +
      '</div>' +
      '<div class="form-row">' +
        (isMultiDay
          ? '<div class="form-group">' +
              '<label>Date</label>' +
              '<input class="form-input seg-date" type="date" value="' + escHtml(seg.date || '') + '">' +
            '</div>'
          : '') +
        '<div class="form-group">' +
          '<label>Duration</label>' +
          '<input class="form-input seg-duration" type="text" inputmode="text" value="' + formatDuration(seg.durationHours) + '" placeholder="e.g. 1:45 or 1h45m">' +
        '</div>' +
      '</div>' +
      '<div class="form-row">' +
        '<div class="form-group">' +
          '<label>Carbs/hr (g)</label>' +
          '<input class="form-input seg-carbs-target" type="number" min="0" value="' + seg.targets.carbsPerHour + '">' +
        '</div>' +
        '<div class="form-group">' +
          '<label>Na/hr (mg)</label>' +
          '<input class="form-input seg-sodium-target" type="number" min="0" value="' + seg.targets.sodiumPerHour + '">' +
        '</div>' +
        '<div class="form-group">' +
          '<label>Caff/hr (mg)</label>' +
          '<input class="form-input seg-caffeine-target" type="number" min="0" value="' + seg.targets.caffeinePerHour + '">' +
        '</div>' +
      '</div>' +
    '</div>';
  }
```

- [ ] **Step 3: Update renderSegmentForms to pass isMultiDay**

In `app.js`, find `function renderSegmentForms()` (around line 383):

```js
  function renderSegmentForms() {
    var $list = $('segments-form-list');
    $list.innerHTML = draftSegments.map(function (seg, i) {
      return segmentFormHTML(seg, i, draftSegments.length);
    }).join('');
```

Replace the innerHTML assignment line with:

```js
  function renderSegmentForms() {
    var $list = $('segments-form-list');
    var isMultiDay = $('ef-category') && $('ef-category').value === 'multi';
    $list.innerHTML = draftSegments.map(function (seg, i) {
      return segmentFormHTML(seg, i, draftSegments.length, isMultiDay);
    }).join('');
```

- [ ] **Step 4: Update syncDraftSegmentsFromDOM to read segment date**

In `app.js`, find `function syncDraftSegmentsFromDOM()` (around line 365). After the existing field reads, add:

```js
      var segDateEl = card.querySelector('.seg-date');
      if (segDateEl) seg.date = segDateEl.value;
```

The full function body should be:

```js
  function syncDraftSegmentsFromDOM() {
    var segCards = $$('[data-seg-draft-id]');
    segCards.forEach(function (card) {
      var id = card.dataset.segDraftId;
      var seg = draftSegments.find(function (s) { return s.id === id; });
      if (!seg) return;
      seg.name = card.querySelector('.seg-name').value.trim();
      var dur = parseDuration(card.querySelector('.seg-duration').value);
      if (dur > 0) seg.durationHours = dur;
      var carbs = parseFloat(card.querySelector('.seg-carbs-target').value);
      if (!isNaN(carbs)) seg.targets.carbsPerHour = carbs;
      var sodium = parseFloat(card.querySelector('.seg-sodium-target').value);
      if (!isNaN(sodium)) seg.targets.sodiumPerHour = sodium;
      var caff = parseFloat(card.querySelector('.seg-caffeine-target').value);
      if (!isNaN(caff)) seg.targets.caffeinePerHour = caff;
      var segDateEl = card.querySelector('.seg-date');
      if (segDateEl) seg.date = segDateEl.value;
    });
  }
```

- [ ] **Step 5: Update renderCreate to populate category and end date, and wire toggle**

In `app.js`, find `async function renderCreate()` (around line 336). Replace the field-population block (lines 353-356 area):

```js
    $('ef-name').value     = evt ? evt.name : '';
    $('ef-date').value     = evt ? (evt.date || '') : new Date().toISOString().slice(0, 10);
    $('ef-type').value     = evt ? evt.type : 'ride';
    $('ef-notes').value    = evt ? (evt.notes || '') : '';
```

With:

```js
    $('ef-name').value     = evt ? evt.name : '';
    $('ef-date').value     = evt ? (evt.date || '') : new Date().toISOString().slice(0, 10);
    $('ef-category').value = evt ? (evt.category || 'single') : 'single';
    $('ef-type').value     = evt ? evt.type : 'ride';
    $('ef-notes').value    = evt ? (evt.notes || '') : '';

    var endDateInput = $('ef-end-date');
    endDateInput.value = evt ? (evt.endDate || '') : '';
    _applyMultiDayToggle($('ef-category').value === 'multi');

    $('ef-category').onchange = function () {
      syncDraftSegmentsFromDOM();
      _applyMultiDayToggle(this.value === 'multi');
      renderSegmentForms();
    };
```

Also add the helper function `_applyMultiDayToggle` in `app.js` just before `renderCreate` (or anywhere inside the IIFE before it's used):

```js
  function _applyMultiDayToggle(isMulti) {
    var endDateInput = $('ef-end-date');
    if (!endDateInput) return;
    if (isMulti) {
      endDateInput.classList.remove('ef-end-date-hidden');
    } else {
      endDateInput.classList.add('ef-end-date-hidden');
      endDateInput.value = '';
    }
  }
```

- [ ] **Step 6: Update btn-add-segment handler to pre-fill segment date**

In `app.js`, find the `on($('btn-add-segment'), 'click', ...)` handler (around line 405):

```js
  on($('btn-add-segment'), 'click', function () {
    syncDraftSegmentsFromDOM();
    draftSegments.push(Data.newSegment('', 1));
    renderSegmentForms();
```

Replace with:

```js
  on($('btn-add-segment'), 'click', function () {
    syncDraftSegmentsFromDOM();
    var isMulti = $('ef-category') && $('ef-category').value === 'multi';
    var startDate = isMulti ? ($('ef-date').value || '') : '';
    draftSegments.push(Data.newSegment('', 1, startDate));
    renderSegmentForms();
```

- [ ] **Step 7: Update form submit handler to include category and endDate**

In `app.js`, find the `on($('event-form'), 'submit', ...)` handler (around line 414). Update the segment-building block to read `seg-date`:

```js
    var segCards = $$('[data-seg-draft-id]');
    var segments = Array.from(segCards).map(function (card) {
      var id = card.dataset.segDraftId;
      var existing = draftSegments.find(function (s) { return s.id === id; });
      var segDateEl = card.querySelector('.seg-date');
      return {
        id:            id,
        name:          card.querySelector('.seg-name').value.trim() || name,
        date:          segDateEl ? segDateEl.value : '',
        durationHours: parseDuration(card.querySelector('.seg-duration').value) || 1,
        targets: {
          carbsPerHour:    parseFloat(card.querySelector('.seg-carbs-target').value)    || 0,
          sodiumPerHour:   parseFloat(card.querySelector('.seg-sodium-target').value)   || 0,
          caffeinePerHour: parseFloat(card.querySelector('.seg-caffeine-target').value) || 0
        },
        items: existing ? (existing.items || []) : []
      };
    });
```

Then update the `evt = Object.assign(...)` calls to include `category` and `endDate`. For the edit path (around line 443):

```js
      evt = Object.assign({}, base, {
        name:     name,
        date:     $('ef-date').value,
        endDate:  $('ef-end-date').value,
        category: $('ef-category').value,
        type:     $('ef-type').value,
        notes:    $('ef-notes').value.trim(),
        segments: segments
      });
```

For the create path (around line 451):

```js
      evt = Object.assign(Data.newEvent(name), {
        date:     $('ef-date').value,
        endDate:  $('ef-end-date').value,
        category: $('ef-category').value,
        type:     $('ef-type').value,
        notes:    $('ef-notes').value.trim(),
        segments: segments
      });
```

Also add end-date validation before the saveBtn.disabled block:

```js
    var category = $('ef-category').value;
    var endDate  = $('ef-end-date').value;
    if (category === 'multi' && endDate && endDate < $('ef-date').value) {
      showToast('End date must be on or after the start date.');
      return;
    }
```

- [ ] **Step 8: Manual smoke test**

Open `index.html` in a browser. Create a new event:
- Set Category to Multi-day → end date input should appear
- Set Category back to Single-day → end date input should disappear with no layout jump
- Set Category to Multi-day, fill both dates, save → event should save without error
- Confirm segment cards show a Date field when multi-day, and not when single-day

- [ ] **Step 9: Commit**

```bash
git add app.js
git commit -m "feat: wire multi-day category toggle, segment date, and new event types in form"
```

---

### Task 4: Events list — past/upcoming split and date display

**Files:**
- Modify: `app.js:225-288` (eventCardHTML, renderEventsList)

**Interfaces:**
- Consumes: `evt.category`, `evt.endDate` from Task 1

- [ ] **Step 1: Update eventCardHTML to show date range for multi-day events**

In `app.js`, find `function eventCardHTML(evt)` (around line 225). Replace the date part in the card meta:

```js
      '<div class="event-card-meta">' +
        (evt.date ? escHtml(evt.date) + ' · ' : '') +
```

With:

```js
      '<div class="event-card-meta">' +
        (evt.date
          ? (evt.category === 'multi' && evt.endDate
              ? escHtml(evt.date) + ' — ' + escHtml(evt.endDate)
              : escHtml(evt.date)) + ' · '
          : '') +
```

- [ ] **Step 2: Update renderEventsList past/upcoming split**

In `app.js`, find (around line 265):

```js
    var today = new Date().toISOString().slice(0, 10);
    var upcoming = events.filter(function (evt) { return !evt.date || evt.date >= today; });
    var past     = events.filter(function (evt) { return evt.date && evt.date < today; });
```

Replace with:

```js
    var today = new Date().toISOString().slice(0, 10);
    function eventArchiveDate(evt) {
      return (evt.category === 'multi' && evt.endDate) ? evt.endDate : evt.date;
    }
    var upcoming = events.filter(function (evt) {
      var d = eventArchiveDate(evt);
      return !d || d >= today;
    });
    var past = events.filter(function (evt) {
      var d = eventArchiveDate(evt);
      return d && d < today;
    });
```

- [ ] **Step 3: Manual smoke test**

Create a multi-day event ending yesterday → confirm it appears in Past Events.
Create a multi-day event ending tomorrow → confirm it stays in Upcoming.

- [ ] **Step 4: Commit**

```bash
git add app.js
git commit -m "feat: update events list date display and past/upcoming split for multi-day events"
```

---

### Task 5: Event detail — date range display and segment date in actuals

**Files:**
- Modify: `app.js:495-565` (renderDetail, detail-summary meta row)
- Modify: `app.js:700-740` (actualSegmentSectionHTML)

**Interfaces:**
- Consumes: `evt.category`, `evt.endDate`, `seg.date` from Task 1

- [ ] **Step 1: Update date display in the detail summary meta row**

In `app.js`, find in `renderDetail` (around line 526):

```js
        (evt.date ? '<span class="event-meta-date">' + escHtml(evt.date) + '</span>' : '') +
```

Replace with:

```js
        (evt.date
          ? '<span class="event-meta-date">' +
              (evt.category === 'multi' && evt.endDate
                ? escHtml(evt.date) + ' — ' + escHtml(evt.endDate)
                : escHtml(evt.date)) +
            '</span>'
          : '') +
```

- [ ] **Step 2: Update canAddActuals to use endDate for multi-day events**

In `app.js`, find in `renderDetail` (around line 510):

```js
    var canAddActuals = isEventPastOrToday(evt.date);
```

Replace with:

```js
    var archiveDate = (evt.category === 'multi' && evt.endDate) ? evt.endDate : evt.date;
    var canAddActuals = isEventPastOrToday(archiveDate);
```

Also update the same logic in `refreshSummaryCards` (around line 889):

```js
    var showAct = isEventPastOrToday(evt.date) && Object.keys(evt.actuals || {}).length > 0;
```

Replace with:

```js
    var archiveDate = (evt.category === 'multi' && evt.endDate) ? evt.endDate : evt.date;
    var showAct = isEventPastOrToday(archiveDate) && Object.keys(evt.actuals || {}).length > 0;
```

- [ ] **Step 3: Update actualSegmentSectionHTML to show segment date for multi-day events**

In `app.js`, find `function actualSegmentSectionHTML(seg, actualSeg)` (around line 700). Update the function signature and add the date row after the actual-section-header:

```js
  function actualSegmentSectionHTML(seg, actualSeg, isMultiDay) {
```

Then inside the returned HTML, after the `actual-section-header` div, add:

```js
      (isMultiDay && seg.date
        ? '<div class="actual-duration-row">Date: <span>' + escHtml(seg.date) + '</span></div>'
        : '') +
```

The full return block should become:

```js
    return '<div class="actual-section" data-actual-segment-id="' + seg.id + '">' +
      '<div class="actual-section-header">' +
        '<span class="actual-pill">ACTUAL</span>' +
        '<span class="actual-section-title">' + escHtml(seg.name) + '</span>' +
      '</div>' +
      (isMultiDay && seg.date
        ? '<div class="actual-duration-row">Date: <span>' + escHtml(seg.date) + '</span></div>'
        : '') +
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
      gaugesHTML +
    '</div>';
```

- [ ] **Step 4: Update the renderDetail call site to pass isMultiDay**

In `renderDetail`, find the segment mapping (around line 546):

```js
      evt.segments.map(function (seg) {
        var html = segmentSectionHTML(seg, multiSeg);
        if (showActuals) {
          var actualSeg = evt.actuals[seg.id] || { durationHours: null, items: [] };
          html += actualSegmentSectionHTML(seg, actualSeg);
        }
        return html;
      }).join('') +
```

Replace with:

```js
      evt.segments.map(function (seg) {
        var html = segmentSectionHTML(seg, multiSeg);
        if (showActuals) {
          var actualSeg = evt.actuals[seg.id] || { durationHours: null, items: [] };
          html += actualSegmentSectionHTML(seg, actualSeg, evt.category === 'multi');
        }
        return html;
      }).join('') +
```

- [ ] **Step 5: Manual smoke test**

Open a multi-day event in detail view:
- Confirm the date shows as a range in the meta row
- Enable actuals and confirm the segment date appears in the actual section

- [ ] **Step 6: Commit**

```bash
git add app.js
git commit -m "feat: show date range in event detail and segment date in actuals for multi-day events"
```

---

### Task 6: CSS — end date reveal transition and date range display

**Files:**
- Modify: `style.css`

**Interfaces:**
- Consumes: `.ef-end-date-hidden`, `.date-range-wrap`, `.date-range-sep` from Task 2/3

- [ ] **Step 1: Add styles**

In `style.css`, append at the end:

```css
/* ── Multi-day date range ─────────────────────────────────────────────────── */
.date-range-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
}

.date-range-wrap .form-input {
  flex: 1;
  min-width: 0;
}

.date-range-sep {
  flex-shrink: 0;
  color: var(--text-secondary);
  font-size: 14px;
  display: none;
}

.ef-end-date-hidden {
  display: none;
}

/* When end date is visible, show the separator */
.date-range-wrap:has(#ef-end-date:not(.ef-end-date-hidden)) .date-range-sep {
  display: block;
}
```

- [ ] **Step 2: Manual smoke test**

In the create/edit form, toggle Category between Single-day and Multi-day several times. Confirm:
- No layout jump above or below the date row
- The end date input and `—` separator appear and disappear cleanly
- Both date inputs are same height and width as each other

- [ ] **Step 3: Commit**

```bash
git add style.css
git commit -m "feat: add CSS for multi-day date range reveal"
```

---

### Task 7: Run all tests and final verification

**Files:** none modified

- [ ] **Step 1: Run full test suite**

```bash
node tests/data.test.js && node tests/export.test.js
```

Expected: all tests PASS, 0 failures.

- [ ] **Step 2: End-to-end manual smoke test**

1. Create a **single-day** Ride event — confirm no end date, no segment date, archives correctly
2. Create a **multi-day** Vacation event (start today, end in 3 days) — confirm date range shows in card and detail, segment date shows in form and actuals, stays in Upcoming
3. Edit the multi-day event to switch Category back to Single-day — confirm end date clears, segment dates hidden
4. Create a **multi-day** Training Camp event that ended yesterday — confirm it appears in Past Events

- [ ] **Step 3: Commit if any fixes were needed, then summarize**

```bash
git log --oneline feature/multi-day-events ^master
```

Confirm all feature commits are on the branch and master is clean.
