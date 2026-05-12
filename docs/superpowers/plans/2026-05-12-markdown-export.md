# Markdown Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Copy plan" button to the event detail page that copies a clean markdown representation of the full fuel plan to the clipboard.

**Architecture:** New `export.js` holds a pure `generateEventMarkdown(evt)` function wrapped in an IIFE that writes to `window.Export`. `app.js` adds the button to `renderDetail`'s HTML and wires the click handler in `attachDetailHandlers` (not `init()` — `detail-body` innerHTML is rebuilt on every `renderDetail` call, so any element within it is a new DOM node each time). Full test coverage via `tests/export.test.js` following the same pattern as `tests/data.test.js`.

**Tech Stack:** Vanilla JS (ES5), no build step, `navigator.clipboard` API, Node.js for tests via `require()`

---

## Files

| File | Change |
|------|--------|
| `tests/export.test.js` | New — 16 unit tests for `generateEventMarkdown` |
| `export.js` | New — IIFE that exports `window.Export.generateEventMarkdown` |
| `app.js` | Add `formatHM` to `window._App`; add "Copy plan" button in `renderDetail`; add click handler in `attachDetailHandlers` |
| `index.html` | Add `<script src="export.js">` before `<script src="app.js">` |

---

## Task 1: TDD — tests/export.test.js + export.js

**Files:**
- Create: `tests/export.test.js`
- Create: `export.js`

- [ ] **Step 1.1 — Write the failing test file**

Create `tests/export.test.js`. At this point `export.js` doesn't exist yet, so `require('../export.js')` will throw and every test will fail.

```js
// tests/export.test.js
'use strict';

// ── Mocks ────────────────────────────────────────────────────────────────────

// localStorage (required by data.js)
global.localStorage = (function () {
  var store = {};
  return {
    getItem:    function (k)    { return store[k] !== undefined ? store[k] : null; },
    setItem:    function (k, v) { store[k] = String(v); },
    removeItem: function (k)    { delete store[k]; },
    clear:      function ()     { store = {}; }
  };
})();

// crypto (required by data.js)
Object.defineProperty(global, 'crypto', {
  configurable: true,
  writable: true,
  value: {
    randomUUID: function () { return 'test-uuid'; },
    getRandomValues: function (arr) { return arr; }
  }
});

// fetch (required by data.js — export.js itself makes no network calls)
global.fetch = async function () {
  return { ok: true, status: 200, text: async function () { return '[]'; } };
};

// ── window globals that export.js reads ──────────────────────────────────────
// export.js accesses window.Data, window._App.
// In Node there is no `window`, so we make window an alias to global.
// Then setting global.Data / global._App makes them accessible as window.Data etc.

global.window = global;

global.Data = require('../data.js');

function fmt(n, unit) {
  var rounded = Math.round(n * 10) / 10;
  return rounded + (unit || '');
}

function formatHM(hours) {
  if (!hours || hours <= 0) return '—';
  var h = Math.floor(hours);
  var rem = (hours - h) * 60;
  var m = Math.floor(rem + 0.0001);
  if (m === 0) return h + 'h';
  return h + 'h' + m + 'm';
}

global._App = {
  fmt: fmt,
  formatHM: formatHM,
  EVENT_TYPE_LABELS: { ride: 'Ride', run: 'Run', triathlon: 'Triathlon', swim: 'Swim', other: 'Other' }
};

// Load export.js — populates window.Export (= global.Export)
require('../export.js');
var Export = global.Export;

// ── Helpers ───────────────────────────────────────────────────────────────────

var assert = require('assert');

function makeSeg(overrides) {
  return Object.assign({
    id: 'seg-1',
    name: 'Bike',
    durationHours: 5,
    targets: { carbsPerHour: 90, sodiumPerHour: 700, caffeinePerHour: 0 },
    items: [
      { brand: 'SiS', name: 'Beta Fuel', quantity: 2, carbsPerUnit: 80, sodiumPerUnit: 0, caffeinePerUnit: 0 }
    ]
  }, overrides);
}

function makeEvent(overrides) {
  return Object.assign({
    name: 'Ironman Wales 2025',
    date: '2026-07-26',
    type: 'ride',
    segments: [ makeSeg() ],
    actuals: {},
    postEventNotes: ''
  }, overrides);
}

var passed = 0, failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log('  ✓ ' + name);
    passed++;
  } catch (e) {
    console.error('  ✗ ' + name + ': ' + e.message);
    failed++;
  }
}

function run() {

  // ── Header ────────────────────────────────────────────────────────────────

  console.log('\nHeader');

  test('header contains event name as h1', function () {
    var md = Export.generateEventMarkdown(makeEvent());
    assert.ok(md.startsWith('# Ironman Wales 2025\n'), 'expected h1 first line');
  });

  test('header contains event type label and date', function () {
    var md = Export.generateEventMarkdown(makeEvent());
    assert.ok(md.includes('Ride \xb7 2026-07-26'), 'expected type and date line');
  });

  // ── Planned section ───────────────────────────────────────────────────────

  console.log('\nPlanned section');

  test('## Planned heading present', function () {
    var md = Export.generateEventMarkdown(makeEvent());
    assert.ok(md.includes('\n## Planned\n'), 'expected ## Planned heading');
  });

  test('segment heading includes name and formatted duration', function () {
    var md = Export.generateEventMarkdown(makeEvent());
    assert.ok(md.includes('### Bike (5h)'), 'expected segment heading with duration');
  });

  test('targets line shows carbs and sodium per hour', function () {
    var md = Export.generateEventMarkdown(makeEvent());
    assert.ok(md.includes('**Targets:** 90g carbs/hr \xb7 700mg Na/hr'), 'expected targets line');
  });

  test('targets line omits caffeine when caffeinePerHour is 0', function () {
    var md = Export.generateEventMarkdown(makeEvent());
    assert.ok(!md.includes('caff/hr'), 'caffeine should not appear in targets');
  });

  test('targets line includes caffeine when caffeinePerHour is non-zero', function () {
    var seg = makeSeg({ targets: { carbsPerHour: 60, sodiumPerHour: 400, caffeinePerHour: 100 } });
    var md = Export.generateEventMarkdown(makeEvent({ segments: [seg] }));
    assert.ok(md.includes('\xb7 100mg caff/hr'), 'expected caffeine in targets');
  });

  test('item row shows brand, name, qty, carbs, sodium', function () {
    var md = Export.generateEventMarkdown(makeEvent());
    assert.ok(md.includes('| SiS Beta Fuel | 2 | 160g | 0mg |'), 'expected item row');
  });

  test('brand omitted in item row when brand is empty string', function () {
    var seg = makeSeg({
      items: [{ brand: '', name: 'Custom Gel', quantity: 1, carbsPerUnit: 40, sodiumPerUnit: 200, caffeinePerUnit: 0 }]
    });
    var md = Export.generateEventMarkdown(makeEvent({ segments: [seg] }));
    assert.ok(md.includes('| Custom Gel | 1 |'), 'expected item row without brand');
  });

  test('totals line appears below item table', function () {
    var md = Export.generateEventMarkdown(makeEvent());
    assert.ok(md.includes('**Totals:** 160g carbs \xb7 0mg Na'), 'expected totals line');
  });

  test('rates line calculated correctly and rounded to 1 decimal place', function () {
    // 160g carbs over 5h = 32g/hr; 0mg Na over 5h = 0mg/hr
    var md = Export.generateEventMarkdown(makeEvent());
    assert.ok(md.includes('**Rates:** 32g carbs/hr \xb7 0mg Na/hr'), 'expected rates line');
  });

  // ── Caffeine column ───────────────────────────────────────────────────────

  console.log('\nCaffeine column');

  test('caffeine column omitted when segment has no caffeine items or target', function () {
    var md = Export.generateEventMarkdown(makeEvent());
    assert.ok(!md.includes('Caffeine'), 'caffeine column should not appear');
  });

  test('caffeine column included when item has caffeinePerUnit > 0', function () {
    var seg = makeSeg({
      items: [{ brand: 'Maurten', name: 'Gel 160 CAF', quantity: 1, carbsPerUnit: 40, sodiumPerUnit: 35, caffeinePerUnit: 100 }]
    });
    var md = Export.generateEventMarkdown(makeEvent({ segments: [seg] }));
    assert.ok(md.includes('Caffeine'), 'caffeine column should appear');
    assert.ok(md.includes('100mg'), 'caffeine amount should appear');
  });

  test('caffeine column included when caffeinePerHour target is non-zero even if items have none', function () {
    var seg = makeSeg({ targets: { carbsPerHour: 60, sodiumPerHour: 400, caffeinePerHour: 50 } });
    var md = Export.generateEventMarkdown(makeEvent({ segments: [seg] }));
    assert.ok(md.includes('Caffeine'), 'caffeine column should appear due to target');
  });

  // ── Actuals section ───────────────────────────────────────────────────────

  console.log('\nActuals section');

  test('actuals section omitted entirely when actuals is empty object', function () {
    var md = Export.generateEventMarkdown(makeEvent({ actuals: {} }));
    assert.ok(!md.includes('## Actual'), 'expected no ## Actual heading');
  });

  test('actuals section present when actuals has entries', function () {
    var actuals = {
      'seg-1': {
        durationHours: 5.2,
        items: [{ brand: 'SiS', name: 'Beta Fuel', quantity: 2, carbsPerUnit: 80, sodiumPerUnit: 0, caffeinePerUnit: 0 }]
      }
    };
    var md = Export.generateEventMarkdown(makeEvent({ actuals: actuals }));
    assert.ok(md.includes('## Actual'), 'expected ## Actual heading');
    assert.ok(md.includes('### Bike (actual:'), 'expected actual segment heading');
  });

  test('actual rates included when durationHours is a positive number', function () {
    var actuals = {
      'seg-1': {
        durationHours: 4,
        items: [{ brand: '', name: 'Gel', quantity: 2, carbsPerUnit: 40, sodiumPerUnit: 0, caffeinePerUnit: 0 }]
      }
    };
    var md = Export.generateEventMarkdown(makeEvent({ actuals: actuals }));
    // 80g carbs / 4h = 20g/hr
    assert.ok(md.includes('**Rates:** 20g carbs/hr'), 'expected rates in actuals');
  });

  test('actual rates omitted when durationHours is null', function () {
    var actuals = { 'seg-1': { durationHours: null, items: [] } };
    var md = Export.generateEventMarkdown(makeEvent({ actuals: actuals }));
    // Should have ## Actual but no Rates line in that section
    assert.ok(md.includes('## Actual'), 'expected ## Actual heading');
    var actualIdx = md.indexOf('## Actual');
    var actualSection = md.slice(actualIdx);
    assert.ok(!actualSection.includes('**Rates:**'), 'expected no rates when durationHours is null');
  });

  // ── Post-event notes ──────────────────────────────────────────────────────

  console.log('\nPost-event notes');

  test('post-event notes rendered as italic when present', function () {
    var actuals = { 'seg-1': { durationHours: 1, items: [] } };
    var md = Export.generateEventMarkdown(makeEvent({ actuals: actuals, postEventNotes: 'Legs felt heavy.' }));
    assert.ok(md.includes('*Legs felt heavy.*'), 'expected italic notes');
  });

  test('post-event notes omitted when empty string', function () {
    var actuals = { 'seg-1': { durationHours: 1, items: [] } };
    var md = Export.generateEventMarkdown(makeEvent({ actuals: actuals, postEventNotes: '' }));
    assert.ok(!md.includes('**'), 'no bold/italic notes line should be present');
    // Check no stray italic markers at end
    assert.ok(!md.trim().endsWith('*'), 'should not end with stray italic marker');
  });

  test('post-event notes omitted when null', function () {
    var actuals = { 'seg-1': { durationHours: 1, items: [] } };
    var md = Export.generateEventMarkdown(makeEvent({ actuals: actuals, postEventNotes: null }));
    assert.ok(!md.trim().endsWith('*'), 'should not end with stray italic marker');
  });

  // ── Summary ───────────────────────────────────────────────────────────────

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) process.exit(1);
}

run();
```

- [ ] **Step 1.2 — Run tests to confirm they fail with module-not-found**

```
node tests/export.test.js
```

Expected output: `Error: Cannot find module '../export.js'`

- [ ] **Step 1.3 — Write export.js**

Create `export.js` in the project root:

```js
// export.js
(function () {
  'use strict';

  // ── Caffeine helpers ────────────────────────────────────────────────────────

  function segmentHasCaffeine(seg) {
    if (seg.targets && seg.targets.caffeinePerHour > 0) return true;
    return (seg.items || []).some(function (item) { return item.caffeinePerUnit > 0; });
  }

  function actualSegHasCaffeine(actualSeg) {
    return (actualSeg.items || []).some(function (item) { return item.caffeinePerUnit > 0; });
  }

  // ── Item helpers ────────────────────────────────────────────────────────────

  function itemLabel(item) {
    return item.brand ? item.brand + ' ' + item.name : item.name;
  }

  function itemContributions(item) {
    return {
      carbs:    (item.carbsPerUnit    || 0) * (item.quantity || 0),
      sodium:   (item.sodiumPerUnit   || 0) * (item.quantity || 0),
      caffeine: (item.caffeinePerUnit || 0) * (item.quantity || 0)
    };
  }

  // ── Planned segment block ───────────────────────────────────────────────────

  function plannedSegmentMd(seg) {
    var showCaff = segmentHasCaffeine(seg);
    var tgt = seg.targets || {};
    var durationLabel = window._App.formatHM(seg.durationHours);

    // Heading
    var lines = ['### ' + seg.name + ' (' + durationLabel + ')'];

    // Targets line
    var targetsLine = '**Targets:** ' + tgt.carbsPerHour + 'g carbs/hr \xb7 ' + tgt.sodiumPerHour + 'mg Na/hr';
    if (showCaff) targetsLine += ' \xb7 ' + (tgt.caffeinePerHour || 0) + 'mg caff/hr';
    lines.push(targetsLine);
    lines.push('');

    // Table header
    var header = '| Item | Qty | Carbs | Sodium |';
    var divider = '|------|-----|-------|--------|';
    if (showCaff) { header += ' Caffeine |'; divider += '-----------|'; }
    lines.push(header);
    lines.push(divider);

    // Item rows
    (seg.items || []).forEach(function (item) {
      var c = itemContributions(item);
      var row = '| ' + itemLabel(item) + ' | ' + item.quantity + ' | ' + Math.round(c.carbs) + 'g | ' + Math.round(c.sodium) + 'mg |';
      if (showCaff) row += ' ' + Math.round(c.caffeine) + 'mg |';
      lines.push(row);
    });
    lines.push('');

    // Totals
    var totals = window.Data.calcSegmentTotals(seg);
    var totalsLine = '**Totals:** ' + Math.round(totals.carbs) + 'g carbs \xb7 ' + Math.round(totals.sodium) + 'mg Na';
    if (showCaff) totalsLine += ' \xb7 ' + Math.round(totals.caffeine) + 'mg caffeine';
    lines.push(totalsLine);

    // Rates
    var rates = window.Data.calcSegmentRates(seg);
    var ratesLine = '**Rates:** ' + window._App.fmt(rates.carbs, 'g carbs/hr') + ' \xb7 ' + window._App.fmt(rates.sodium, 'mg Na/hr');
    if (showCaff) ratesLine += ' \xb7 ' + window._App.fmt(rates.caffeine, 'mg caffeine/hr');
    lines.push(ratesLine);

    return lines.join('\n');
  }

  // ── Actual segment block ────────────────────────────────────────────────────

  function actualSegmentMd(seg, actualSeg) {
    var showCaff = actualSegHasCaffeine(actualSeg);
    var durationLabel = actualSeg.durationHours
      ? window._App.formatHM(actualSeg.durationHours)
      : '—';

    var lines = ['### ' + seg.name + ' (actual: ' + durationLabel + ')'];
    lines.push('');

    // Table header
    var header = '| Item | Qty | Carbs | Sodium |';
    var divider = '|------|-----|-------|--------|';
    if (showCaff) { header += ' Caffeine |'; divider += '-----------|'; }
    lines.push(header);
    lines.push(divider);

    // Item rows
    (actualSeg.items || []).forEach(function (item) {
      var c = itemContributions(item);
      var row = '| ' + itemLabel(item) + ' | ' + item.quantity + ' | ' + Math.round(c.carbs) + 'g | ' + Math.round(c.sodium) + 'mg |';
      if (showCaff) row += ' ' + Math.round(c.caffeine) + 'mg |';
      lines.push(row);
    });
    lines.push('');

    // Totals
    var totals = window.Data.calcActualSegmentTotals(actualSeg);
    var totalsLine = '**Totals:** ' + Math.round(totals.carbs) + 'g carbs \xb7 ' + Math.round(totals.sodium) + 'mg Na';
    if (showCaff) totalsLine += ' \xb7 ' + Math.round(totals.caffeine) + 'mg caffeine';
    lines.push(totalsLine);

    // Rates — only when durationHours is a positive number
    if (actualSeg.durationHours && actualSeg.durationHours > 0) {
      var rates = window.Data.calcActualSegmentRates(actualSeg);
      var ratesLine = '**Rates:** ' + window._App.fmt(rates.carbs, 'g carbs/hr') + ' \xb7 ' + window._App.fmt(rates.sodium, 'mg Na/hr');
      if (showCaff) ratesLine += ' \xb7 ' + window._App.fmt(rates.caffeine, 'mg caffeine/hr');
      lines.push(ratesLine);
    }

    return lines.join('\n');
  }

  // ── Main function ───────────────────────────────────────────────────────────

  function generateEventMarkdown(evt) {
    var typeLabel = (window._App.EVENT_TYPE_LABELS[evt.type] || evt.type);
    var lines = [
      '# ' + evt.name,
      typeLabel + ' \xb7 ' + evt.date,
      '',
      '## Planned'
    ];

    evt.segments.forEach(function (seg) {
      lines.push('');
      lines.push(plannedSegmentMd(seg));
    });

    // Actuals section — omit entirely if no actuals logged
    var actualKeys = Object.keys(evt.actuals || {});
    if (actualKeys.length > 0) {
      lines.push('');
      lines.push('---');
      lines.push('');
      lines.push('## Actual');

      evt.segments.forEach(function (seg) {
        var actualSeg = evt.actuals[seg.id];
        if (!actualSeg) return;
        lines.push('');
        lines.push(actualSegmentMd(seg, actualSeg));
      });

      // Post-event notes — omit if empty/null
      if (evt.postEventNotes && evt.postEventNotes.trim()) {
        lines.push('');
        lines.push('*' + evt.postEventNotes.trim() + '*');
      }
    }

    return lines.join('\n') + '\n';
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  window.Export = {
    generateEventMarkdown: generateEventMarkdown
  };

})();
```

- [ ] **Step 1.4 — Run tests to confirm they all pass**

```
node tests/export.test.js
```

Expected output:
```
Header
  ✓ header contains event name as h1
  ✓ header contains event type label and date

Planned section
  ✓ ## Planned heading present
  ✓ segment heading includes name and formatted duration
  ✓ targets line shows carbs and sodium per hour
  ✓ targets line omits caffeine when caffeinePerHour is 0
  ✓ targets line includes caffeine when caffeinePerHour is non-zero
  ✓ item row shows brand, name, qty, carbs, sodium
  ✓ brand omitted in item row when brand is empty string
  ✓ totals line appears below item table
  ✓ rates line calculated correctly and rounded to 1 decimal place

Caffeine column
  ✓ caffeine column omitted when segment has no caffeine items or target
  ✓ caffeine column included when item has caffeinePerUnit > 0
  ✓ caffeine column included when caffeinePerHour target is non-zero even if items have none

Actuals section
  ✓ actuals section omitted entirely when actuals is empty object
  ✓ actuals section present when actuals has entries
  ✓ actual rates included when durationHours is a positive number
  ✓ actual rates omitted when durationHours is null

Post-event notes
  ✓ post-event notes rendered as italic when present
  ✓ post-event notes omitted when empty string
  ✓ post-event notes omitted when null

21 passed, 0 failed
```

- [ ] **Step 1.5 — Commit**

```bash
git add tests/export.test.js export.js
git commit -m "feat: add generateEventMarkdown with unit tests"
```

---

## Task 2: Wire into app.js and index.html

**Files:**
- Modify: `app.js` (3 locations)
- Modify: `index.html` (1 location)

- [ ] **Step 2.1 — Add formatHM to window._App**

In `app.js` at the `window._App` assignment (currently around line 1616), add `formatHM`:

Current code:
```js
  window._App = {
    state: state, navigate: navigate, renders: renders,
    $: $, $$: $$, on: on, fmt: fmt, escHtml: escHtml,
    segmentFormHTML: segmentFormHTML,
    TYPE_LABELS: TYPE_LABELS, EVENT_TYPE_LABELS: EVENT_TYPE_LABELS
  };
```

Replace with:
```js
  window._App = {
    state: state, navigate: navigate, renders: renders,
    $: $, $$: $$, on: on, fmt: fmt, escHtml: escHtml,
    formatHM: formatHM,
    segmentFormHTML: segmentFormHTML,
    TYPE_LABELS: TYPE_LABELS, EVENT_TYPE_LABELS: EVENT_TYPE_LABELS
  };
```

- [ ] **Step 2.2 — Add "Copy plan" button to renderDetail HTML**

In `app.js`, find the `$body.innerHTML = ...` block in `renderDetail`. It currently ends with:

```js
      (canAddActuals && !showActuals
        ? '<div class="start-actuals-section"><button class="btn-secondary" data-start-actuals>📝 Log post-event data</button></div>'
        : '');
```

Add the "Copy plan" button between the totals footer line and the actuals/notes lines:

```js
      (multiSeg ? totalsFooterHTML(totals, totalH) : '') +
      '<div style="padding:8px 16px"><button id="btn-copy-plan" type="button" class="btn-secondary" style="margin-top:8px">Copy plan</button></div>' +
      (showActuals ? postEventNotesHTML(evt.postEventNotes) : '') +
      (showActuals
        ? '<div class="clear-actuals-section"><button class="btn-clear-actuals" data-clear-actuals>Remove post-event data</button></div>'
        : '') +
      (canAddActuals && !showActuals
        ? '<div class="start-actuals-section"><button class="btn-secondary" data-start-actuals>📝 Log post-event data</button></div>'
        : '');
```

- [ ] **Step 2.3 — Add click handler in attachDetailHandlers**

In `app.js`, find the end of `attachDetailHandlers(evt)`. It currently ends with:

```js
    // Clear actuals button
    var clearActualsBtn = document.querySelector('[data-clear-actuals]');
    if (clearActualsBtn) {
      on(clearActualsBtn, 'click', function () {
        clearActuals(evt.id);
      });
    }
  }
```

Add the "Copy plan" handler just before the closing `}`:

```js
    // Clear actuals button
    var clearActualsBtn = document.querySelector('[data-clear-actuals]');
    if (clearActualsBtn) {
      on(clearActualsBtn, 'click', function () {
        clearActuals(evt.id);
      });
    }

    // Copy plan button
    var copyPlanBtn = $('btn-copy-plan');
    if (copyPlanBtn) {
      on(copyPlanBtn, 'click', function () {
        var md = Export.generateEventMarkdown(evt);
        navigator.clipboard.writeText(md).then(function () {
          showToast('Plan copied!');
        }).catch(function () {
          showToast("Couldn't copy — try again.");
        });
      });
    }
  }
```

- [ ] **Step 2.4 — Add script tag in index.html**

In `index.html`, find:

```html
<script src="data.js"></script>
<script src="app.js"></script>
```

Replace with:

```html
<script src="data.js"></script>
<script src="export.js"></script>
<script src="app.js"></script>
```

- [ ] **Step 2.5 — Manual smoke test**

1. Open the app in a browser
2. Navigate to an event with planned segments
3. Verify the "Copy plan" button appears in the detail body
4. Click "Copy plan" — the toast "Plan copied!" should appear
5. Paste into a text editor — verify the markdown matches the spec format (event name as h1, type and date, `## Planned`, segment headings with duration, targets, table, totals, rates)
6. Navigate to an event that has actuals logged — verify the `## Actual` section appears after a `---` separator
7. Navigate to an event with no actuals — verify the `## Actual` section is absent

- [ ] **Step 2.6 — Commit**

```bash
git add app.js index.html
git commit -m "feat: wire Copy plan button into detail view"
```
