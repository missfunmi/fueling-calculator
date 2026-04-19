# Fueling Calculator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a mobile-first static web app for planning endurance event nutrition, with a product library, per-segment targets, real-time totals, and localStorage persistence.

**Architecture:** Four vanilla JS/HTML/CSS files with no dependencies or build step. `data.js` owns all storage and calculation logic (pure functions, Node.js-testable). `app.js` owns view rendering and user interactions. Views are toggled show/hide; there is no router.

**Tech Stack:** HTML5, CSS3 (custom properties), vanilla ES5-compatible JS, Node.js (for running unit tests only — not shipped)

---

## File Map

| File | Responsibility |
|------|---------------|
| `index.html` | App shell, all view HTML, bottom sheet, tab bar |
| `style.css` | Design tokens, mobile layout, all components |
| `data.js` | localStorage CRUD, factories, calculation helpers — exported for Node.js tests |
| `app.js` | State object, view router, all render + handler functions |
| `tests/data.test.js` | Unit tests for data.js — run with `node tests/data.test.js` |

---

## Task 1: Project Scaffold

**Files:**
- Create: `index.html`
- Create: `style.css`
- Create: `data.js`
- Create: `app.js`
- Create: `tests/data.test.js`
- Create: `.gitignore`

- [ ] **Step 1: Create the project files**

```html
<!-- index.html -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Fuel Planner</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div id="app"><!-- views injected here in Task 8 --></div>
  <script src="data.js"></script>
  <script src="app.js"></script>
</body>
</html>
```

```css
/* style.css */
/* populated in Tasks 6–7 */
```

```js
// data.js — populated in Task 2
```

```js
// app.js — populated in Task 9+
```

```js
// tests/data.test.js — populated in Task 3
```

```
# .gitignore
.superpowers/
node_modules/
```

- [ ] **Step 2: Start dev server**

```bash
cd /Users/funmi/Development/projects/fueling-calculator
python3 -m http.server 8080
```

Open http://localhost:8080 — expect blank page with no console errors.

- [ ] **Step 3: Commit**

```bash
git init
git add index.html style.css data.js app.js tests/data.test.js .gitignore
git commit -m "chore: project scaffold"
```

---

## Task 2: data.js — CRUD, Factories, Exports

**Files:**
- Modify: `data.js`

- [ ] **Step 1: Write the full data.js**

```js
// data.js
(function (exports) {
  'use strict';

  var KEYS = {
    products: 'fuelPlanner.products',
    events: 'fuelPlanner.events',
    recent: 'fuelPlanner.recentProducts'
  };

  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // ── Products ────────────────────────────────────────────────────────────────

  function getProducts() {
    try { return JSON.parse(localStorage.getItem(KEYS.products) || '[]'); }
    catch (e) { return []; }
  }

  function saveProduct(product) {
    var list = getProducts();
    var i = list.findIndex(function (p) { return p.id === product.id; });
    if (i >= 0) list[i] = product; else list.push(product);
    localStorage.setItem(KEYS.products, JSON.stringify(list));
  }

  function deleteProduct(id) {
    localStorage.setItem(KEYS.products, JSON.stringify(
      getProducts().filter(function (p) { return p.id !== id; })
    ));
    // Remove from recents too
    var recent = JSON.parse(localStorage.getItem(KEYS.recent) || '[]')
      .filter(function (i) { return i !== id; });
    localStorage.setItem(KEYS.recent, JSON.stringify(recent));
  }

  // ── Events ──────────────────────────────────────────────────────────────────

  function getEvents() {
    try { return JSON.parse(localStorage.getItem(KEYS.events) || '[]'); }
    catch (e) { return []; }
  }

  function saveEvent(event) {
    var list = getEvents();
    var i = list.findIndex(function (e) { return e.id === event.id; });
    if (i >= 0) list[i] = event; else list.push(event);
    localStorage.setItem(KEYS.events, JSON.stringify(list));
  }

  function deleteEvent(id) {
    localStorage.setItem(KEYS.events, JSON.stringify(
      getEvents().filter(function (e) { return e.id !== id; })
    ));
  }

  // ── Recent products ─────────────────────────────────────────────────────────

  function getRecentProducts() {
    var ids = JSON.parse(localStorage.getItem(KEYS.recent) || '[]');
    var products = getProducts();
    return ids
      .map(function (id) { return products.find(function (p) { return p.id === id; }); })
      .filter(Boolean);
  }

  function recordProductUsed(id) {
    var ids = JSON.parse(localStorage.getItem(KEYS.recent) || '[]');
    var updated = [id].concat(ids.filter(function (i) { return i !== id; })).slice(0, 5);
    localStorage.setItem(KEYS.recent, JSON.stringify(updated));
  }

  // ── Calculations ─────────────────────────────────────────────────────────────

  function calcSegmentTotals(segment) {
    return (segment.items || []).reduce(function (acc, item) {
      return {
        carbs: acc.carbs + (item.carbsPerUnit || 0) * (item.quantity || 0),
        sodium: acc.sodium + (item.sodiumPerUnit || 0) * (item.quantity || 0),
        caffeine: acc.caffeine + (item.caffeinePerUnit || 0) * (item.quantity || 0)
      };
    }, { carbs: 0, sodium: 0, caffeine: 0 });
  }

  function calcSegmentRates(segment) {
    var t = calcSegmentTotals(segment);
    var h = segment.durationHours || 1;
    return { carbs: t.carbs / h, sodium: t.sodium / h, caffeine: t.caffeine / h };
  }

  function calcEventTotals(event) {
    return (event.segments || []).reduce(function (acc, seg) {
      var t = calcSegmentTotals(seg);
      return {
        carbs: acc.carbs + t.carbs,
        sodium: acc.sodium + t.sodium,
        caffeine: acc.caffeine + t.caffeine,
        durationHours: acc.durationHours + (seg.durationHours || 0)
      };
    }, { carbs: 0, sodium: 0, caffeine: 0, durationHours: 0 });
  }

  function calcEventRates(event) {
    var t = calcEventTotals(event);
    var h = t.durationHours || 1;
    return { carbs: t.carbs / h, sodium: t.sodium / h, caffeine: t.caffeine / h };
  }

  // Returns: 'on-target' | 'warning-under' | 'warning-over' | 'under' | 'over' | 'none'
  function rateStatus(actual, target) {
    if (target === undefined || target === null) return 'none';
    if (target === 0) return actual > 0 ? 'over' : 'none';
    var ratio = actual / target;
    if (ratio >= 0.9 && ratio <= 1.1) return 'on-target';
    if (ratio >= 0.75 && ratio < 0.9) return 'warning-under';
    if (ratio > 1.1 && ratio <= 1.25) return 'warning-over';
    return ratio < 0.75 ? 'under' : 'over';
  }

  // ── Factories ─────────────────────────────────────────────────────────────────

  function newSegment(name, durationHours) {
    return {
      id: generateId(),
      name: name || 'Segment',
      durationHours: durationHours || 1,
      targets: { carbsPerHour: 80, sodiumPerHour: 500, caffeinePerHour: 0 },
      items: []
    };
  }

  function newEvent(name) {
    return {
      id: generateId(),
      name: name || 'New Event',
      date: new Date().toISOString().slice(0, 10),
      type: 'ride',
      notes: '',
      segments: [newSegment(name || 'New Event', 1)]
    };
  }

  function itemFromProduct(product) {
    return {
      id: generateId(),
      productId: product.id,
      name: product.name,
      brand: product.brand || '',
      type: product.type,
      carbsPerUnit: product.carbsPerUnit,
      sodiumPerUnit: product.sodiumPerUnit,
      caffeinePerUnit: product.caffeinePerUnit,
      quantity: 1
    };
  }

  function itemFromOneOff(fields) {
    return {
      id: generateId(),
      productId: null,
      name: fields.name,
      brand: fields.brand || '',
      type: fields.type || 'other',
      carbsPerUnit: Number(fields.carbsPerUnit) || 0,
      sodiumPerUnit: Number(fields.sodiumPerUnit) || 0,
      caffeinePerUnit: Number(fields.caffeinePerUnit) || 0,
      quantity: 1
    };
  }

  // ── Exports ──────────────────────────────────────────────────────────────────

  exports.generateId = generateId;
  exports.getProducts = getProducts;
  exports.saveProduct = saveProduct;
  exports.deleteProduct = deleteProduct;
  exports.getEvents = getEvents;
  exports.saveEvent = saveEvent;
  exports.deleteEvent = deleteEvent;
  exports.getRecentProducts = getRecentProducts;
  exports.recordProductUsed = recordProductUsed;
  exports.calcSegmentTotals = calcSegmentTotals;
  exports.calcSegmentRates = calcSegmentRates;
  exports.calcEventTotals = calcEventTotals;
  exports.calcEventRates = calcEventRates;
  exports.rateStatus = rateStatus;
  exports.newSegment = newSegment;
  exports.newEvent = newEvent;
  exports.itemFromProduct = itemFromProduct;
  exports.itemFromOneOff = itemFromOneOff;

})(typeof module !== 'undefined' ? module.exports : (window.Data = window.Data || {}));
```

- [ ] **Step 2: Verify it loads in browser**

Reload http://localhost:8080, open the browser console, type `Data.newEvent('Test')`. Expect to see an event object with one segment.

- [ ] **Step 3: Commit**

```bash
git add data.js
git commit -m "feat: data.js — CRUD, factories, calculation helpers"
```

---

## Task 3: Unit Tests — CRUD and Recent Products

**Files:**
- Modify: `tests/data.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// tests/data.test.js
'use strict';

// Mock localStorage before requiring data.js
global.localStorage = (function () {
  var store = {};
  return {
    getItem: function (k) { return store[k] !== undefined ? store[k] : null; },
    setItem: function (k, v) { store[k] = String(v); },
    removeItem: function (k) { delete store[k]; },
    clear: function () { store = {}; }
  };
})();

var assert = require('assert');
var D = require('../data.js');

var passed = 0, failed = 0;

function test(name, fn) {
  localStorage.clear();
  try {
    fn();
    console.log('  \u2713 ' + name);
    passed++;
  } catch (e) {
    console.error('  \u2717 ' + name + ': ' + e.message);
    failed++;
  }
}

// ── Products ─────────────────────────────────────────────────────────────────

console.log('\nProducts CRUD');

test('getProducts returns [] when empty', function () {
  assert.deepStrictEqual(D.getProducts(), []);
});

test('saveProduct adds a new product', function () {
  var p = { id: 'p1', brand: 'Maurten', name: 'C-160', type: 'drink_powder', carbsPerUnit: 160, sodiumPerUnit: 290, caffeinePerUnit: 0 };
  D.saveProduct(p);
  assert.deepStrictEqual(D.getProducts(), [p]);
});

test('saveProduct updates an existing product', function () {
  var p = { id: 'p1', brand: 'Maurten', name: 'C-160', type: 'drink_powder', carbsPerUnit: 160, sodiumPerUnit: 290, caffeinePerUnit: 0 };
  D.saveProduct(p);
  D.saveProduct(Object.assign({}, p, { carbsPerUnit: 200 }));
  assert.strictEqual(D.getProducts().length, 1);
  assert.strictEqual(D.getProducts()[0].carbsPerUnit, 200);
});

test('deleteProduct removes the product', function () {
  var p = { id: 'p1', brand: 'Maurten', name: 'C-160', type: 'drink_powder', carbsPerUnit: 160, sodiumPerUnit: 290, caffeinePerUnit: 0 };
  D.saveProduct(p);
  D.deleteProduct('p1');
  assert.deepStrictEqual(D.getProducts(), []);
});

// ── Events ────────────────────────────────────────────────────────────────────

console.log('\nEvents CRUD');

test('getEvents returns [] when empty', function () {
  assert.deepStrictEqual(D.getEvents(), []);
});

test('saveEvent adds a new event', function () {
  var e = D.newEvent('Test Ride');
  D.saveEvent(e);
  assert.strictEqual(D.getEvents().length, 1);
  assert.strictEqual(D.getEvents()[0].name, 'Test Ride');
});

test('saveEvent updates an existing event', function () {
  var e = D.newEvent('Test Ride');
  D.saveEvent(e);
  D.saveEvent(Object.assign({}, e, { name: 'Updated' }));
  assert.strictEqual(D.getEvents().length, 1);
  assert.strictEqual(D.getEvents()[0].name, 'Updated');
});

test('deleteEvent removes the event', function () {
  var e = D.newEvent('Test Ride');
  D.saveEvent(e);
  D.deleteEvent(e.id);
  assert.deepStrictEqual(D.getEvents(), []);
});

// ── Recent products ───────────────────────────────────────────────────────────

console.log('\nRecent products');

test('getRecentProducts returns [] when empty', function () {
  assert.deepStrictEqual(D.getRecentProducts(), []);
});

test('recordProductUsed prepends and caps at 5', function () {
  var products = ['1','2','3','4','5','6'].map(function (i) {
    return { id: i, brand: '', name: 'P' + i, type: 'gel', carbsPerUnit: 20, sodiumPerUnit: 0, caffeinePerUnit: 0 };
  });
  products.forEach(D.saveProduct);
  ['1','2','3','4','5','6'].forEach(D.recordProductUsed);
  var recent = D.getRecentProducts();
  assert.strictEqual(recent.length, 5);
  assert.strictEqual(recent[0].id, '6'); // most recent first
  assert.strictEqual(recent[4].id, '2'); // oldest kept
});

test('deleteProduct removes it from recent list', function () {
  var p = { id: 'p1', brand: '', name: 'P1', type: 'gel', carbsPerUnit: 20, sodiumPerUnit: 0, caffeinePerUnit: 0 };
  D.saveProduct(p);
  D.recordProductUsed('p1');
  D.deleteProduct('p1');
  assert.deepStrictEqual(D.getRecentProducts(), []);
});

test('getRecentProducts filters stale ids silently', function () {
  // id in recent list but product deleted externally (simulated by saving without calling deleteProduct)
  localStorage.setItem('fuelPlanner.recentProducts', JSON.stringify(['ghost-id']));
  assert.deepStrictEqual(D.getRecentProducts(), []);
});

// ── newEvent / newSegment factories ───────────────────────────────────────────

console.log('\nFactories');

test('newEvent has one segment named after the event', function () {
  var e = D.newEvent('My Ride');
  assert.strictEqual(e.segments.length, 1);
  assert.strictEqual(e.segments[0].name, 'My Ride');
  assert.strictEqual(e.segments[0].targets.carbsPerHour, 80);
  assert.strictEqual(e.segments[0].targets.sodiumPerHour, 500);
});

test('itemFromProduct snapshots product values', function () {
  var p = { id: 'p1', brand: 'Maurten', name: 'C-160', type: 'drink_powder', carbsPerUnit: 160, sodiumPerUnit: 290, caffeinePerUnit: 0 };
  var item = D.itemFromProduct(p);
  assert.strictEqual(item.productId, 'p1');
  assert.strictEqual(item.carbsPerUnit, 160);
  assert.strictEqual(item.quantity, 1);
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run tests — expect them to fail** (data.js not yet required properly)

```bash
node tests/data.test.js
```

Expected: either a require error or test failures. This confirms the test harness is wired up.

- [ ] **Step 3: Run tests against completed data.js**

After Task 2 is done, run again:

```bash
node tests/data.test.js
```

Expected output:
```
Products CRUD
  ✓ getProducts returns [] when empty
  ✓ saveProduct adds a new product
  ✓ saveProduct updates an existing product
  ✓ deleteProduct removes the product

Events CRUD
  ✓ getEvents returns [] when empty
  ✓ saveEvent adds a new event
  ✓ saveEvent updates an existing event
  ✓ deleteEvent removes the event

Recent products
  ✓ recordProductUsed prepends and caps at 5
  ✓ deleteProduct removes it from recent list
  ✓ getRecentProducts filters stale ids silently

Factories
  ✓ newEvent has one segment named after the event
  ✓ itemFromProduct snapshots product values

13 passed, 0 failed
```

- [ ] **Step 4: Commit**

```bash
git add tests/data.test.js
git commit -m "test: data.js CRUD and factory unit tests"
```

---

## Task 4: Unit Tests — Calculations

**Files:**
- Modify: `tests/data.test.js` (append after existing tests, before the summary line)

- [ ] **Step 1: Add calculation tests** (insert before the final summary `console.log`)

```js
// ── Calculations ──────────────────────────────────────────────────────────────

console.log('\nCalculations');

test('calcSegmentTotals: sums items correctly', function () {
  var seg = {
    durationHours: 3,
    targets: { carbsPerHour: 80, sodiumPerHour: 500, caffeinePerHour: 0 },
    items: [
      { carbsPerUnit: 80, sodiumPerUnit: 400, caffeinePerUnit: 0, quantity: 3 },
      { carbsPerUnit: 22, sodiumPerUnit: 100, caffeinePerUnit: 50, quantity: 2 }
    ]
  };
  var t = D.calcSegmentTotals(seg);
  assert.strictEqual(t.carbs, 284);    // 240 + 44
  assert.strictEqual(t.sodium, 1400);  // 1200 + 200
  assert.strictEqual(t.caffeine, 100); // 0 + 100
});

test('calcSegmentTotals: empty items returns zeros', function () {
  var seg = { durationHours: 2, targets: {}, items: [] };
  var t = D.calcSegmentTotals(seg);
  assert.deepStrictEqual(t, { carbs: 0, sodium: 0, caffeine: 0 });
});

test('calcSegmentRates: divides by duration', function () {
  var seg = {
    durationHours: 2,
    targets: {},
    items: [{ carbsPerUnit: 100, sodiumPerUnit: 500, caffeinePerUnit: 0, quantity: 2 }]
  };
  var r = D.calcSegmentRates(seg);
  assert.strictEqual(r.carbs, 100);   // 200 / 2
  assert.strictEqual(r.sodium, 500);  // 1000 / 2
});

test('calcSegmentRates: uses 1 as fallback when durationHours is 0', function () {
  var seg = { durationHours: 0, targets: {}, items: [{ carbsPerUnit: 80, sodiumPerUnit: 0, caffeinePerUnit: 0, quantity: 1 }] };
  var r = D.calcSegmentRates(seg);
  assert.strictEqual(r.carbs, 80);
});

test('calcEventTotals: sums across segments', function () {
  var event = {
    segments: [
      { durationHours: 3, items: [{ carbsPerUnit: 80, sodiumPerUnit: 400, caffeinePerUnit: 0, quantity: 3 }] },
      { durationHours: 1.5, items: [{ carbsPerUnit: 22, sodiumPerUnit: 100, caffeinePerUnit: 50, quantity: 4 }] }
    ]
  };
  var t = D.calcEventTotals(event);
  assert.strictEqual(t.carbs, 328);    // 240 + 88
  assert.strictEqual(t.sodium, 1600);  // 1200 + 400
  assert.strictEqual(t.caffeine, 200); // 0 + 200
  assert.strictEqual(t.durationHours, 4.5);
});

test('rateStatus: on-target within ±10%', function () {
  assert.strictEqual(D.rateStatus(80, 80), 'on-target');
  assert.strictEqual(D.rateStatus(72, 80), 'on-target');  // exactly 90%
  assert.strictEqual(D.rateStatus(88, 80), 'on-target');  // exactly 110%
});

test('rateStatus: warning-under 10–25% below', function () {
  assert.strictEqual(D.rateStatus(64, 80), 'warning-under'); // 80%
});

test('rateStatus: warning-over 10–25% above', function () {
  assert.strictEqual(D.rateStatus(96, 80), 'warning-over'); // 120%
});

test('rateStatus: under more than 25% below', function () {
  assert.strictEqual(D.rateStatus(40, 80), 'under'); // 50%
});

test('rateStatus: over more than 25% above', function () {
  assert.strictEqual(D.rateStatus(120, 80), 'over'); // 150%
});

test('rateStatus: target 0, actual > 0 is over', function () {
  assert.strictEqual(D.rateStatus(5, 0), 'over');
});

test('rateStatus: both 0 is none', function () {
  assert.strictEqual(D.rateStatus(0, 0), 'none');
});
```

- [ ] **Step 2: Run tests**

```bash
node tests/data.test.js
```

Expected: all tests pass (25 passed, 0 failed).

- [ ] **Step 3: Commit**

```bash
git add tests/data.test.js
git commit -m "test: calculation unit tests"
```

---

## Task 5: style.css — Design Tokens and Base Layout

**Files:**
- Modify: `style.css`

- [ ] **Step 1: Write the design tokens, reset, and layout skeleton**

```css
/* style.css */

/* ── Design tokens ──────────────────────────────────────────────────────────── */
:root {
  --bg: #f2f2f7;
  --surface: #ffffff;
  --surface-2: #f8f8f8;
  --text: #1c1c1e;
  --text-secondary: #6c6c70;
  --text-tertiary: #aeaeb2;
  --border: #e5e5ea;
  --accent: #1a1a2e;
  --accent-fg: #ffffff;

  --green: #34c759;
  --green-bg: #e8f9ed;
  --green-text: #1a7a31;
  --amber: #ff9500;
  --amber-bg: #fff6e0;
  --amber-text: #7a4800;
  --red: #ff3b30;
  --red-bg: #ffebea;
  --red-text: #7a0f00;
  --blue-bg: #e5f1ff;
  --blue-text: #0a52a0;

  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --tab-bar-height: 56px;
  --header-height: 52px;
  --safe-bottom: env(safe-area-inset-bottom, 0px);
}

/* ── Reset ──────────────────────────────────────────────────────────────────── */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: var(--bg);
  color: var(--text);
  font-size: 15px;
  line-height: 1.4;
  -webkit-font-smoothing: antialiased;
  overscroll-behavior: none;
}
button { cursor: pointer; font: inherit; border: none; background: none; }
input, select, textarea { font: inherit; }
a { color: inherit; text-decoration: none; }

/* ── App shell ──────────────────────────────────────────────────────────────── */
#app {
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
  max-width: 480px;
  margin: 0 auto;
}

/* ── Views ──────────────────────────────────────────────────────────────────── */
.view {
  display: none;
  flex-direction: column;
  flex: 1;
  padding-bottom: calc(var(--tab-bar-height) + var(--safe-bottom));
}
.view.active { display: flex; }

/* ── App header ─────────────────────────────────────────────────────────────── */
.app-header {
  position: sticky;
  top: 0;
  z-index: 10;
  height: var(--header-height);
  background: var(--accent);
  color: var(--accent-fg);
  display: flex;
  align-items: center;
  padding: 0 16px;
  gap: 12px;
  flex-shrink: 0;
}
.app-header h1 { font-size: 17px; font-weight: 600; flex: 1; }
.header-title { font-size: 17px; font-weight: 600; flex: 1; }

/* ── Tab bar ────────────────────────────────────────────────────────────────── */
.tab-bar {
  position: fixed;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 100%;
  max-width: 480px;
  height: calc(var(--tab-bar-height) + var(--safe-bottom));
  padding-bottom: var(--safe-bottom);
  background: var(--surface);
  border-top: 1px solid var(--border);
  display: flex;
  z-index: 20;
}
.tab-btn {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  font-size: 11px;
  color: var(--text-tertiary);
  padding: 6px 0;
  transition: color 0.15s;
}
.tab-btn.active { color: var(--accent); }
.tab-icon { font-size: 22px; line-height: 1; }

/* ── Scrollable main content ────────────────────────────────────────────────── */
.view-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* ── Buttons ────────────────────────────────────────────────────────────────── */
.btn-primary {
  display: block;
  width: 100%;
  padding: 14px;
  background: var(--accent);
  color: var(--accent-fg);
  border-radius: var(--radius-md);
  font-size: 16px;
  font-weight: 600;
  text-align: center;
}
.btn-icon {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: rgba(255,255,255,0.15);
  color: #fff;
  font-size: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.btn-back {
  color: #fff;
  font-size: 22px;
  padding: 4px 8px 4px 0;
  display: flex;
  align-items: center;
}
.btn-text {
  color: var(--accent);
  font-size: 14px;
  font-weight: 500;
  padding: 4px;
}
.btn-danger { color: var(--red); }

/* ── Empty state ────────────────────────────────────────────────────────────── */
.empty-state {
  text-align: center;
  color: var(--text-secondary);
  padding: 64px 24px;
  font-size: 15px;
}
.empty-state p { margin-top: 8px; font-size: 13px; color: var(--text-tertiary); }
```

- [ ] **Step 2: Verify in browser**

Reload http://localhost:8080 — expect a dark header area and bottom tab bar visible even on a blank page.

- [ ] **Step 3: Commit**

```bash
git add style.css
git commit -m "feat: CSS design tokens, base layout, header, tab bar"
```

---

## Task 6: style.css — UI Components

**Files:**
- Modify: `style.css` (append)

- [ ] **Step 1: Append component styles**

```css
/* ── Event card (events list) ───────────────────────────────────────────────── */
.event-card {
  background: var(--surface);
  border-radius: var(--radius-md);
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.event-card:active { opacity: 0.75; }
.event-card-row { display: flex; align-items: center; gap: 8px; }
.event-card-name { font-weight: 600; font-size: 16px; flex: 1; }
.event-card-meta { font-size: 13px; color: var(--text-secondary); }
.type-badge {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 2px 7px;
  border-radius: 20px;
  background: var(--blue-bg);
  color: var(--blue-text);
}

/* ── Metric summary cards ───────────────────────────────────────────────────── */
.summary-cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  padding: 16px;
  background: var(--accent);
  flex-shrink: 0;
}
.metric-card {
  background: rgba(255,255,255,0.1);
  border-radius: var(--radius-sm);
  padding: 10px 8px;
  text-align: center;
  color: #fff;
}
.metric-value { font-size: 20px; font-weight: 700; line-height: 1.1; }
.metric-label { font-size: 10px; opacity: 0.7; text-transform: uppercase; letter-spacing: 0.3px; margin-top: 2px; }
.metric-rate { font-size: 11px; opacity: 0.85; margin-top: 4px; }

/* ── Segment section ────────────────────────────────────────────────────────── */
.segment-section {
  background: var(--surface);
  border-radius: var(--radius-md);
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
}
.segment-header {
  background: var(--surface-2);
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}
.segment-title-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 6px;
}
.segment-name {
  font-weight: 600;
  font-size: 15px;
}
.segment-duration {
  font-size: 13px;
  color: var(--text-secondary);
}
.segment-targets-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.target-pill {
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--bg);
  border-radius: 20px;
  padding: 3px 9px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.target-pill:active { background: var(--border); }
.editable {
  border-bottom: 1px dashed var(--text-tertiary);
  cursor: pointer;
  min-width: 20px;
  display: inline-block;
}
.inline-edit {
  border: none;
  border-bottom: 2px solid var(--accent);
  background: transparent;
  font: inherit;
  outline: none;
  min-width: 40px;
  max-width: 120px;
}

/* ── Progress bars ──────────────────────────────────────────────────────────── */
.progress-group {
  padding: 10px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-bottom: 1px solid var(--border);
}
.progress-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.progress-label { font-size: 12px; color: var(--text-secondary); width: 52px; flex-shrink: 0; }
.progress-track {
  flex: 1;
  height: 6px;
  background: var(--border);
  border-radius: 3px;
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  border-radius: 3px;
  width: calc(var(--pct, 0) * 1%);
  max-width: 100%;
  transition: width 0.25s ease;
  background: var(--text-tertiary);
}
.progress-row.status-on-target .progress-fill { background: var(--green); }
.progress-row.status-warning-under .progress-fill,
.progress-row.status-warning-over .progress-fill { background: var(--amber); }
.progress-row.status-under .progress-fill,
.progress-row.status-over .progress-fill { background: var(--red); }
.progress-value { font-size: 12px; color: var(--text-secondary); width: 58px; text-align: right; flex-shrink: 0; }

/* ── Item rows ──────────────────────────────────────────────────────────────── */
.item-list { padding: 0 0 4px; }
.item-row {
  display: flex;
  align-items: center;
  padding: 11px 16px;
  border-bottom: 1px solid var(--border);
  gap: 12px;
}
.item-row:last-child { border-bottom: none; }
.item-info { flex: 1; min-width: 0; }
.item-name { font-weight: 500; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.item-meta { font-size: 12px; color: var(--text-secondary); margin-top: 2px; }

/* ── Quantity stepper ───────────────────────────────────────────────────────── */
.stepper {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}
.stepper-btn {
  width: 36px;
  height: 44px;
  border-radius: var(--radius-sm);
  background: var(--bg);
  color: var(--text);
  font-size: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  -webkit-tap-highlight-color: transparent;
}
.stepper-btn:active { background: var(--border); }
.stepper-qty {
  font-size: 17px;
  font-weight: 600;
  min-width: 28px;
  text-align: center;
}

/* ── Add item button ────────────────────────────────────────────────────────── */
.btn-add-item {
  display: block;
  width: 100%;
  padding: 12px 16px;
  text-align: left;
  color: var(--accent);
  font-weight: 500;
  font-size: 14px;
  border-top: 1px solid var(--border);
  -webkit-tap-highlight-color: transparent;
}
.btn-add-item:active { background: var(--bg); }

/* ── Totals footer ──────────────────────────────────────────────────────────── */
.totals-footer {
  padding: 12px 16px;
  font-size: 13px;
  color: var(--text-tertiary);
  text-align: center;
  border-top: 1px solid var(--border);
  background: var(--surface);
}

/* ── Bottom sheet ───────────────────────────────────────────────────────────── */
.sheet-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.45);
  z-index: 100;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
.sheet-overlay.hidden { display: none; }
.sheet {
  width: 100%;
  max-width: 480px;
  background: var(--surface);
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  max-height: 85dvh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.sheet-handle {
  width: 36px;
  height: 4px;
  background: var(--border);
  border-radius: 2px;
  margin: 10px auto 0;
  flex-shrink: 0;
}
.sheet-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px 8px;
  font-weight: 600;
  font-size: 16px;
  flex-shrink: 0;
}
.sheet-close {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: var(--bg);
  font-size: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.sheet-tabs {
  display: flex;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.sheet-tab-btn {
  flex: 1;
  padding: 10px;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-secondary);
  border-bottom: 2px solid transparent;
  text-align: center;
}
.sheet-tab-btn.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
}
.sheet-tab-content { display: none; flex: 1; overflow-y: auto; padding: 12px 16px; }
.sheet-tab-content.active { display: block; }

/* ── Search input ───────────────────────────────────────────────────────────── */
.search-input {
  width: 100%;
  padding: 10px 12px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 15px;
  outline: none;
  margin-bottom: 12px;
}
.search-input:focus { border-color: var(--accent); }

/* ── Section label ──────────────────────────────────────────────────────────── */
.section-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-tertiary);
  margin-bottom: 6px;
  padding: 0 2px;
}

/* ── Product rows (library and sheet) ──────────────────────────────────────── */
.product-row {
  display: flex;
  align-items: center;
  padding: 11px 0;
  border-bottom: 1px solid var(--border);
  gap: 12px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.product-row:last-child { border-bottom: none; }
.product-row:active { opacity: 0.6; }
.product-row-info { flex: 1; min-width: 0; }
.product-row-name { font-weight: 500; font-size: 15px; }
.product-row-meta { font-size: 12px; color: var(--text-secondary); margin-top: 2px; }
.product-type-chip {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--bg);
  color: var(--text-secondary);
  flex-shrink: 0;
}

/* ── Forms ──────────────────────────────────────────────────────────────────── */
.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.form-group label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.3px;
}
.form-input {
  padding: 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 16px;
  outline: none;
  width: 100%;
}
.form-input:focus { border-color: var(--accent); }
.form-row {
  display: flex;
  gap: 10px;
}
.form-row .form-group { flex: 1; }
.form-card {
  background: var(--surface);
  border-radius: var(--radius-md);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
}
.form-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 4px;
}
.form-section-header h3 { font-size: 15px; font-weight: 600; }

/* ── Toggle ─────────────────────────────────────────────────────────────────── */
.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 0;
}
.toggle-label { font-size: 15px; }
.toggle-input { width: 44px; height: 26px; appearance: none; background: var(--border); border-radius: 13px; cursor: pointer; position: relative; transition: background 0.2s; }
.toggle-input:checked { background: var(--green); }
.toggle-input::after { content: ''; position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: #fff; transition: transform 0.2s; }
.toggle-input:checked::after { transform: translateX(18px); }

/* ── Library grouped list ───────────────────────────────────────────────────── */
.product-group { margin-bottom: 8px; }
.product-group-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: capitalize;
  padding: 12px 0 6px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 2px;
}
```

- [ ] **Step 2: Verify in browser**

Reload http://localhost:8080 — page should still look mostly blank but without CSS errors in the console.

- [ ] **Step 3: Commit**

```bash
git add style.css
git commit -m "feat: CSS components — cards, progress bars, stepper, sheet, forms"
```

---

## Task 7: index.html — Full App Shell

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Write the complete HTML**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Fuel Planner</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>

<div id="app">

  <!-- ── Events list view ───────────────────────────────────────── -->
  <div id="view-events" class="view active">
    <header class="app-header">
      <h1>Events</h1>
      <button id="btn-new-event" class="btn-icon" aria-label="New event">+</button>
    </header>
    <div id="events-list" class="view-body"></div>
  </div>

  <!-- ── Event detail view ──────────────────────────────────────── -->
  <div id="view-detail" class="view">
    <header class="app-header">
      <button id="btn-detail-back" class="btn-back" aria-label="Back">&#8592;</button>
      <span id="detail-event-name" class="header-title editable"></span>
      <button id="btn-edit-event" class="btn-icon" aria-label="Edit event" style="font-size:16px">&#9998;</button>
    </header>
    <div id="detail-summary"></div>
    <div id="detail-body" class="view-body" style="padding-top:0"></div>
  </div>

  <!-- ── Create / edit event view ───────────────────────────────── -->
  <div id="view-create" class="view">
    <header class="app-header">
      <button id="btn-create-back" class="btn-back" aria-label="Back">&#8592;</button>
      <h1 id="create-title">New Event</h1>
      <button id="btn-delete-event" class="btn-icon btn-danger" aria-label="Delete event" style="font-size:18px;display:none">&#128465;</button>
    </header>
    <div class="view-body">
      <form id="event-form" novalidate>
        <div class="form-card">
          <div class="form-group">
            <label for="ef-name">Event Name *</label>
            <input id="ef-name" class="form-input" type="text" placeholder="e.g. 145mi Ride" autocomplete="off" required>
          </div>
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
          <div class="form-group">
            <label for="ef-notes">Notes</label>
            <textarea id="ef-notes" class="form-input" rows="2" placeholder="Optional"></textarea>
          </div>
        </div>

        <div class="form-section-header" style="margin:16px 0 8px">
          <h3>Segments</h3>
          <button type="button" id="btn-add-segment" class="btn-text">+ Add segment</button>
        </div>
        <div id="segments-form-list" style="display:flex;flex-direction:column;gap:12px"></div>

        <button type="submit" class="btn-primary" style="margin-top:24px" id="btn-save-event">Save Event</button>
      </form>
    </div>
  </div>

  <!-- ── Product library view ───────────────────────────────────── -->
  <div id="view-library" class="view">
    <header class="app-header">
      <h1>Library</h1>
      <button id="btn-new-product" class="btn-icon" aria-label="New product">+</button>
    </header>
    <div class="view-body">
      <div id="library-body"></div>
    </div>
  </div>

  <!-- ── Product form view ──────────────────────────────────────── -->
  <div id="view-product-form" class="view">
    <header class="app-header">
      <button id="btn-pf-back" class="btn-back" aria-label="Back">&#8592;</button>
      <h1 id="pf-title">New Product</h1>
      <button id="btn-delete-product" class="btn-icon btn-danger" aria-label="Delete" style="font-size:18px">&#128465;</button>
    </header>
    <div class="view-body">
      <p style="font-size:13px;color:var(--text-secondary);background:var(--amber-bg);color:var(--amber-text);padding:10px 14px;border-radius:var(--radius-sm)">
        Changes won't update existing plans.
      </p>
      <form id="product-form" novalidate>
        <div class="form-card" style="margin-top:12px">
          <div class="form-row">
            <div class="form-group">
              <label for="pf-brand">Brand</label>
              <input id="pf-brand" class="form-input" type="text" placeholder="e.g. Maurten" autocomplete="off">
            </div>
            <div class="form-group">
              <label for="pf-name">Name *</label>
              <input id="pf-name" class="form-input" type="text" placeholder="e.g. C-160" autocomplete="off" required>
            </div>
          </div>
          <div class="form-group">
            <label for="pf-type">Type</label>
            <select id="pf-type" class="form-input">
              <option value="gel">Gel</option>
              <option value="bar">Bar</option>
              <option value="drink_powder">Drink Powder</option>
              <option value="liquid">Liquid</option>
              <option value="chew">Chew</option>
            </select>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label for="pf-carbs">Carbs/unit (g)</label>
              <input id="pf-carbs" class="form-input" type="number" min="0" step="0.5" value="0">
            </div>
            <div class="form-group">
              <label for="pf-sodium">Sodium/unit (mg)</label>
              <input id="pf-sodium" class="form-input" type="number" min="0" step="1" value="0">
            </div>
            <div class="form-group">
              <label for="pf-caffeine">Caff/unit (mg)</label>
              <input id="pf-caffeine" class="form-input" type="number" min="0" step="1" value="0">
            </div>
          </div>
        </div>
        <button type="submit" class="btn-primary" style="margin-top:16px">Save Product</button>
      </form>
    </div>
  </div>

</div><!-- #app -->

<!-- ── Bottom sheet: Add item ──────────────────────────────────── -->
<div id="sheet-overlay" class="sheet-overlay hidden">
  <div id="sheet-add-item" class="sheet">
    <div class="sheet-handle"></div>
    <div class="sheet-header">
      <span>Add item</span>
      <button id="btn-close-sheet" class="sheet-close">&#215;</button>
    </div>
    <div class="sheet-tabs">
      <button class="sheet-tab-btn active" data-sheet-tab="library">Library</button>
      <button class="sheet-tab-btn" data-sheet-tab="oneoff">One-off</button>
    </div>
    <div id="sheet-tab-library" class="sheet-tab-content active">
      <input id="product-search" class="search-input" type="search" placeholder="Search name, brand, type&#8230;">
      <div id="recent-products-section">
        <p class="section-label">Recently used</p>
        <div id="recent-products-list"></div>
      </div>
      <div id="product-search-results"></div>
    </div>
    <div id="sheet-tab-oneoff" class="sheet-tab-content">
      <form id="oneoff-form" novalidate>
        <div style="display:flex;flex-direction:column;gap:12px">
          <div class="form-row">
            <div class="form-group">
              <label for="oo-brand">Brand</label>
              <input id="oo-brand" class="form-input" type="text" placeholder="Optional">
            </div>
            <div class="form-group">
              <label for="oo-name">Name *</label>
              <input id="oo-name" class="form-input" type="text" placeholder="Required" required>
            </div>
          </div>
          <div class="form-group">
            <label for="oo-type">Type</label>
            <select id="oo-type" class="form-input">
              <option value="gel">Gel</option>
              <option value="bar">Bar</option>
              <option value="drink_powder">Drink Powder</option>
              <option value="liquid">Liquid</option>
              <option value="chew">Chew</option>
            </select>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label for="oo-carbs">Carbs/unit (g)</label>
              <input id="oo-carbs" class="form-input" type="number" min="0" value="0">
            </div>
            <div class="form-group">
              <label for="oo-sodium">Sodium/unit (mg)</label>
              <input id="oo-sodium" class="form-input" type="number" min="0" value="0">
            </div>
            <div class="form-group">
              <label for="oo-caffeine">Caff/unit (mg)</label>
              <input id="oo-caffeine" class="form-input" type="number" min="0" value="0">
            </div>
          </div>
          <div class="toggle-row">
            <span class="toggle-label">Save to library</span>
            <input id="oo-save-library" class="toggle-input" type="checkbox">
          </div>
          <button type="submit" class="btn-primary">Add item</button>
        </div>
      </form>
    </div>
  </div>
</div>

<!-- ── Bottom tab bar ──────────────────────────────────────────── -->
<nav class="tab-bar" id="tab-bar">
  <button class="tab-btn active" data-tab-view="events">
    <span class="tab-icon">&#128197;</span>
    <span>Events</span>
  </button>
  <button class="tab-btn" data-tab-view="library">
    <span class="tab-icon">&#128230;</span>
    <span>Library</span>
  </button>
</nav>

<script src="data.js"></script>
<script src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Verify in browser**

Reload http://localhost:8080. Expect: dark header with "Events" title, bottom tab bar with Events/Library tabs, empty white body area. No console errors.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: index.html full app shell and view templates"
```

---

## Task 8: app.js — State, Router, and Utilities

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Write the state, router, and DOM utilities**

```js
// app.js
(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────────────────────
  var state = {
    view: 'events',
    currentEventId: null,
    addingToSegmentId: null,
    editingProductId: null   // null = creating new product
  };

  // ── DOM helpers ────────────────────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }
  function $$(sel, ctx) { return (ctx || document).querySelectorAll(sel); }
  function on(el, evt, fn) { if (el) el.addEventListener(evt, fn); }

  function fmt(n, unit) {
    var rounded = Math.round(n * 10) / 10;
    return rounded + (unit || '');
  }

  var TYPE_LABELS = {
    gel: 'Gel', bar: 'Bar', drink_powder: 'Drink powder',
    liquid: 'Liquid', chew: 'Chew'
  };

  var EVENT_TYPE_LABELS = {
    ride: 'Ride', run: 'Run', triathlon: 'Triathlon',
    swim: 'Swim', other: 'Other'
  };

  // ── Router ─────────────────────────────────────────────────────────────────
  var TAB_VIEWS = { events: true, library: true };

  function navigate(view, params) {
    if (params) Object.assign(state, params);
    state.view = view;

    $$('.view').forEach(function (v) { v.classList.remove('active'); });
    var el = $('view-' + view);
    if (el) el.classList.add('active');

    // Show/hide tab bar (hide on detail and form views)
    var hideTabBar = (view === 'detail' || view === 'create' ||
                      view === 'product-form');
    $('tab-bar').style.display = hideTabBar ? 'none' : '';
    if (hideTabBar) {
      $$('.view.active').forEach(function (v) {
        v.style.paddingBottom = '0';
      });
    } else {
      $$('.view.active').forEach(function (v) {
        v.style.paddingBottom = '';
      });
    }

    // Sync tab bar highlight
    $$('.tab-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.tabView === view);
    });

    // Render the new view
    if (renders[view]) renders[view]();
  }

  // ── Renders (populated in later tasks) ────────────────────────────────────
  var renders = {};

  // ── Segment form HTML helper (used by renderCreate) ────────────────────────
  function segmentFormHTML(seg, idx, total) {
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
        '<div class="form-group">' +
          '<label>Duration (hrs)</label>' +
          '<input class="form-input seg-duration" type="number" min="0.25" step="0.25" value="' + seg.durationHours + '">' +
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

  function escHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  function init() {
    // Tab bar
    $$('.tab-btn').forEach(function (btn) {
      on(btn, 'click', function () { navigate(btn.dataset.tabView); });
    });
    navigate('events');
  }

  document.addEventListener('DOMContentLoaded', init);

  // Expose for later tasks
  window._App = {
    state: state, navigate: navigate, renders: renders,
    $: $, $$: $$, on: on, fmt: fmt, escHtml: escHtml,
    segmentFormHTML: segmentFormHTML,
    TYPE_LABELS: TYPE_LABELS, EVENT_TYPE_LABELS: EVENT_TYPE_LABELS
  };

})();
```

- [ ] **Step 2: Verify in browser**

Reload — expect the app header and tab bar. Clicking Library tab should show the Library view header (empty body). No console errors.

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "feat: app.js state, router, DOM utilities"
```

---

## Task 9: Events List View

**Files:**
- Modify: `app.js` (append inside the IIFE, before `init`)

- [ ] **Step 1: Add the events list render function and create-event handler**

Add these functions inside the `app.js` IIFE, **before** the `init` function:

```js
  // ── Events list ────────────────────────────────────────────────────────────

  function renderEventsList() {
    var events = Data.getEvents().slice().sort(function (a, b) {
      return (b.date || '').localeCompare(a.date || '');
    });
    var $list = $('events-list');
    if (!events.length) {
      $list.innerHTML = '<div class="empty-state"><div style="font-size:48px">🚴</div><p>No events yet.</p><p>Tap + to plan your first one.</p></div>';
      return;
    }
    $list.innerHTML = events.map(function (evt) {
      var totals = Data.calcEventTotals(evt);
      var totalHours = totals.durationHours;
      var hLabel = totalHours === Math.floor(totalHours)
        ? totalHours + 'h'
        : totalHours.toFixed(1) + 'h';
      return '<div class="event-card" data-event-id="' + evt.id + '">' +
        '<div class="event-card-row">' +
          '<span class="event-card-name">' + escHtml(evt.name) + '</span>' +
          '<span class="type-badge">' + (EVENT_TYPE_LABELS[evt.type] || evt.type) + '</span>' +
        '</div>' +
        '<div class="event-card-meta">' +
          (evt.date ? evt.date + ' · ' : '') +
          hLabel + ' · ' +
          Math.round(totals.carbs) + 'g carbs · ' +
          Math.round(totals.sodium) + 'mg Na' +
        '</div>' +
      '</div>';
    }).join('');

    $list.querySelectorAll('.event-card').forEach(function (card) {
      on(card, 'click', function () {
        navigate('detail', { currentEventId: card.dataset.eventId });
      });
    });
  }

  renders.events = renderEventsList;

  on($('btn-new-event'), 'click', function () {
    navigate('create', { currentEventId: null });
  });
```

- [ ] **Step 2: Test in browser**

Open http://localhost:8080. Events list shows empty state with a bicycle emoji. Tap "+" — nothing navigates yet (create view will be wired in Task 10). No console errors.

- [ ] **Step 3: Add a test event via console**

In browser console:
```js
Data.saveEvent(Data.newEvent('Test Ride'));
location.reload();
```

Verify the event card appears with name, date, and totals.

- [ ] **Step 4: Commit**

```bash
git add app.js
git commit -m "feat: events list view — render, sort, empty state"
```

---

## Task 10: Create / Edit Event View

**Files:**
- Modify: `app.js` (append inside IIFE before `init`)

- [ ] **Step 1: Add the create/edit event render and submit handlers**

```js
  // ── Create / Edit event ────────────────────────────────────────────────────

  // draftSegments is rebuilt each time the create view opens
  var draftSegments = [];

  function renderCreate() {
    var isEdit = !!state.currentEventId;
    var evt = isEdit ? Data.getEvents().find(function (e) { return e.id === state.currentEventId; }) : null;

    $('create-title').textContent = isEdit ? 'Edit Event' : 'New Event';
    $('btn-save-event').textContent = isEdit ? 'Save Changes' : 'Save Event';
    $('btn-delete-event').style.display = isEdit ? '' : 'none';

    $('ef-name').value = evt ? evt.name : '';
    $('ef-date').value = evt ? (evt.date || '') : new Date().toISOString().slice(0, 10);
    $('ef-type').value = evt ? evt.type : 'ride';
    $('ef-notes').value = evt ? (evt.notes || '') : '';

    // Seed draftSegments from existing event or a fresh default
    draftSegments = evt
      ? evt.segments.map(function (s) { return JSON.parse(JSON.stringify(s)); })
      : [Data.newSegment('', 1)];

    renderSegmentForms();
  }

  function renderSegmentForms() {
    var $list = $('segments-form-list');
    $list.innerHTML = draftSegments.map(function (seg, i) {
      return segmentFormHTML(seg, i, draftSegments.length);
    }).join('');

    // Wire remove buttons
    $$('.btn-remove-segment').forEach(function (btn) {
      on(btn, 'click', function () {
        var card = btn.closest('[data-seg-draft-id]');
        var id = card.dataset.segDraftId;
        var seg = draftSegments.find(function (s) { return s.id === id; });
        if (seg && seg.items && seg.items.length > 0) {
          if (!confirm('Remove segment "' + seg.name + '"? It has ' + seg.items.length + ' item(s) which will be lost.')) return;
        }
        draftSegments = draftSegments.filter(function (s) { return s.id !== id; });
        renderSegmentForms();
      });
    });
  }

  on($('btn-add-segment'), 'click', function () {
    draftSegments.push(Data.newSegment('', 1));
    renderSegmentForms();
    // Scroll to new segment
    var cards = $$('[data-seg-draft-id]');
    if (cards.length) cards[cards.length - 1].scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  on($('event-form'), 'submit', function (e) {
    e.preventDefault();
    var name = $('ef-name').value.trim();
    if (!name) { $('ef-name').focus(); return; }

    // Read segment values from DOM
    var segCards = $$('[data-seg-draft-id]');
    var segments = Array.from(segCards).map(function (card) {
      var id = card.dataset.segDraftId;
      var existing = draftSegments.find(function (s) { return s.id === id; });
      return {
        id: id,
        name: card.querySelector('.seg-name').value.trim() || name,
        durationHours: parseFloat(card.querySelector('.seg-duration').value) || 1,
        targets: {
          carbsPerHour: parseFloat(card.querySelector('.seg-carbs-target').value) || 0,
          sodiumPerHour: parseFloat(card.querySelector('.seg-sodium-target').value) || 0,
          caffeinePerHour: parseFloat(card.querySelector('.seg-caffeine-target').value) || 0
        },
        items: existing ? (existing.items || []) : []
      };
    });

    var isEdit = !!state.currentEventId;
    var evt = isEdit
      ? Object.assign({}, Data.getEvents().find(function (e) { return e.id === state.currentEventId; }), {
          name: name,
          date: $('ef-date').value,
          type: $('ef-type').value,
          notes: $('ef-notes').value.trim(),
          segments: segments
        })
      : Object.assign(Data.newEvent(name), {
          date: $('ef-date').value,
          type: $('ef-type').value,
          notes: $('ef-notes').value.trim(),
          segments: segments
        });

    Data.saveEvent(evt);

    if (isEdit) {
      navigate('detail', { currentEventId: evt.id });
    } else {
      navigate('detail', { currentEventId: evt.id });
    }
  });

  on($('btn-create-back'), 'click', function () {
    navigate(state.currentEventId ? 'detail' : 'events');
  });

  // Show delete button only when editing an existing event
  // (renderCreate is called before this handler fires, so check state.currentEventId)
  on($('btn-delete-event'), 'click', function () {
    var evt = Data.getEvents().find(function (e) { return e.id === state.currentEventId; });
    if (!evt) return;
    if (!confirm('Delete "' + evt.name + '"? This cannot be undone.')) return;
    Data.deleteEvent(evt.id);
    navigate('events');
  });

  renders.create = renderCreate;
```

- [ ] **Step 2: Test in browser**

1. Tap "+" on events list → New Event form appears.
2. Type a name, tap "Save Event" → navigates to detail view (detail body is empty until Task 11).
3. Verify the event appears on the events list when tapping back.

- [ ] **Step 3: Test editing**

Open console, tap an event card → detail view. Tap the edit (pencil) icon — nothing happens yet (detail handlers wired in Task 11). For now verify the form opens when navigating directly:
```js
_App.navigate('create', { currentEventId: Data.getEvents()[0].id });
```
Confirm the form is pre-filled with the event's existing values.

- [ ] **Step 4: Commit**

```bash
git add app.js
git commit -m "feat: create/edit event form with segment management"
```

---

## Task 11: Event Detail View

**Files:**
- Modify: `app.js` (append inside IIFE before `init`)

- [ ] **Step 1: Add the event detail render function**

```js
  // ── Event detail ───────────────────────────────────────────────────────────

  function renderDetail() {
    var evt = Data.getEvents().find(function (e) { return e.id === state.currentEventId; });
    if (!evt) { navigate('events'); return; }

    // Header name
    $('detail-event-name').textContent = evt.name;

    // Summary cards
    var totals = Data.calcEventTotals(evt);
    var rates = Data.calcEventRates(evt);
    var totalH = totals.durationHours;
    $('detail-summary').innerHTML =
      '<div class="summary-cards">' +
        metricCardHTML('carbs', Math.round(totals.carbs) + 'g', fmt(rates.carbs, 'g/hr avg')) +
        metricCardHTML('sodium', Math.round(totals.sodium) + 'mg', fmt(rates.sodium, 'mg/hr avg')) +
        metricCardHTML('caffeine', Math.round(totals.caffeine) + 'mg', fmt(rates.caffeine, 'mg/hr avg')) +
      '</div>';

    // Segment sections
    var multiSeg = evt.segments.length > 1;
    var $body = $('detail-body');
    $body.innerHTML = evt.segments.map(function (seg) {
      return segmentSectionHTML(seg, multiSeg);
    }).join('') +
    (multiSeg ? totalsFooterHTML(totals, totalH) : '');

    attachDetailHandlers(evt);
  }

  function metricCardHTML(key, value, rate) {
    var labels = { carbs: 'Carbs', sodium: 'Sodium', caffeine: 'Caffeine' };
    return '<div class="metric-card">' +
      '<div class="metric-value">' + value + '</div>' +
      '<div class="metric-label">' + labels[key] + '</div>' +
      '<div class="metric-rate">' + rate + '</div>' +
    '</div>';
  }

  function segmentSectionHTML(seg, showLabel) {
    var totals = Data.calcSegmentTotals(seg);
    var rates = Data.calcSegmentRates(seg);
    var tgt = seg.targets;

    var pctCarbs   = tgt.carbsPerHour   ? Math.min(rates.carbs   / tgt.carbsPerHour   * 100, 150) : 0;
    var pctSodium  = tgt.sodiumPerHour  ? Math.min(rates.sodium  / tgt.sodiumPerHour  * 100, 150) : 0;
    var pctCaff    = tgt.caffeinePerHour ? Math.min(rates.caffeine / tgt.caffeinePerHour * 100, 150) : 0;

    var stCarbs   = Data.rateStatus(rates.carbs,   tgt.carbsPerHour);
    var stSodium  = Data.rateStatus(rates.sodium,  tgt.sodiumPerHour);
    var stCaff    = Data.rateStatus(rates.caffeine, tgt.caffeinePerHour);

    var dh = seg.durationHours;
    var dhLabel = dh === Math.floor(dh) ? dh + 'h' : dh.toFixed(1) + 'h';

    return '<div class="segment-section" data-segment-id="' + seg.id + '">' +
      (showLabel
        ? '<div class="segment-header">' +
            '<div class="segment-title-row">' +
              '<span class="segment-name editable" data-inline="seg-name">' + escHtml(seg.name) + '</span>' +
              '<span class="segment-duration editable" data-inline="seg-duration">&nbsp;· ' + dhLabel + '</span>' +
            '</div>' +
            '<div class="segment-targets-row">' +
              '<span class="target-pill" data-inline="seg-carbs-target">' + tgt.carbsPerHour + 'g carbs/hr</span>' +
              '<span class="target-pill" data-inline="seg-sodium-target">' + tgt.sodiumPerHour + 'mg Na/hr</span>' +
              (tgt.caffeinePerHour ? '<span class="target-pill" data-inline="seg-caff-target">' + tgt.caffeinePerHour + 'mg caff/hr</span>' : '') +
            '</div>' +
          '</div>'
        : '<div class="segment-header">' +
            '<div class="segment-targets-row">' +
              '<span class="target-pill" data-inline="seg-carbs-target">' + tgt.carbsPerHour + 'g carbs/hr</span>' +
              '<span class="target-pill" data-inline="seg-sodium-target">' + tgt.sodiumPerHour + 'mg Na/hr</span>' +
              (tgt.caffeinePerHour ? '<span class="target-pill" data-inline="seg-caff-target">' + tgt.caffeinePerHour + 'mg caff/hr</span>' : '') +
            '</div>' +
          '</div>') +
      '<div class="progress-group">' +
        progressRowHTML('Carbs', fmt(rates.carbs, 'g/hr'), pctCarbs, stCarbs) +
        progressRowHTML('Sodium', fmt(rates.sodium, 'mg/hr'), pctSodium, stSodium) +
        progressRowHTML('Caffeine', fmt(rates.caffeine, 'mg/hr'), pctCaff, stCaff) +
      '</div>' +
      '<div class="item-list">' +
        (seg.items.length
          ? seg.items.map(function (item) { return itemRowHTML(item); }).join('')
          : '<div style="padding:12px 16px;font-size:13px;color:var(--text-tertiary)">No items yet.</div>') +
      '</div>' +
      '<button class="btn-add-item" data-add-segment-id="' + seg.id + '">+ Add item</button>' +
    '</div>';
  }

  function progressRowHTML(label, value, pct, status) {
    return '<div class="progress-row status-' + status + '">' +
      '<span class="progress-label">' + label + '</span>' +
      '<div class="progress-track"><div class="progress-fill" style="--pct:' + pct.toFixed(1) + '"></div></div>' +
      '<span class="progress-value">' + value + '</span>' +
    '</div>';
  }

  function itemRowHTML(item) {
    var metaParts = [TYPE_LABELS[item.type] || item.type];
    if (item.carbsPerUnit) metaParts.push(item.carbsPerUnit + 'g');
    if (item.sodiumPerUnit) metaParts.push(item.sodiumPerUnit + 'mg Na');
    if (item.caffeinePerUnit) metaParts.push(item.caffeinePerUnit + 'mg caff');
    return '<div class="item-row" data-item-id="' + item.id + '">' +
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

  function totalsFooterHTML(totals, durationHours) {
    var dh = durationHours === Math.floor(durationHours) ? durationHours + 'h' : durationHours.toFixed(1) + 'h';
    return '<div class="totals-footer">' +
      'Totals &mdash; ' + Math.round(totals.carbs) + 'g carbs · ' +
      Math.round(totals.sodium) + 'mg Na · ' +
      Math.round(totals.caffeine) + 'mg caffeine · ' + dh +
    '</div>';
  }

  function attachDetailHandlers(evt) {
    // Back button
    on($('btn-detail-back'), 'click', function () { navigate('events'); });

    // Edit event button
    on($('btn-edit-event'), 'click', function () {
      navigate('create', { currentEventId: evt.id });
    });

    // Inline edit: event name in header
    on($('detail-event-name'), 'click', function () {
      makeEditable($('detail-event-name'), function (val) {
        var updated = Object.assign({}, Data.getEvents().find(function (e) { return e.id === evt.id; }), { name: val });
        Data.saveEvent(updated);
        renderDetail();
      });
    });

    // Stepper buttons
    $$('.stepper-btn', $('detail-body')).forEach(function (btn) {
      on(btn, 'click', function () {
        var row = btn.closest('[data-item-id]');
        var segSection = btn.closest('[data-segment-id]');
        var itemId = row.dataset.itemId;
        var segId = segSection.dataset.segmentId;
        updateItemQty(evt.id, segId, itemId, btn.dataset.action === 'inc' ? 1 : -1);
      });
    });

    // Add item buttons
    $$('[data-add-segment-id]', $('detail-body')).forEach(function (btn) {
      on(btn, 'click', function () {
        openAddItemSheet(evt.id, btn.dataset.addSegmentId);
      });
    });

    // Inline editable segment fields
    $$('[data-inline]', $('detail-body')).forEach(function (el) {
      on(el, 'click', function () {
        handleInlineEdit(el, evt.id);
      });
    });
  }

  function updateItemQty(eventId, segId, itemId, delta) {
    var events = Data.getEvents();
    var evt = events.find(function (e) { return e.id === eventId; });
    if (!evt) return;
    var seg = evt.segments.find(function (s) { return s.id === segId; });
    if (!seg) return;
    var item = seg.items.find(function (i) { return i.id === itemId; });
    if (!item) return;
    item.quantity = Math.max(0, item.quantity + delta);
    if (item.quantity === 0) {
      seg.items = seg.items.filter(function (i) { return i.id !== itemId; });
    }
    Data.saveEvent(evt);
    renderDetail();
  }

  renders.detail = renderDetail;
```

- [ ] **Step 2: Test in browser**

1. Create an event via the "+" button. Navigate to detail.
2. Verify summary cards (all zeros for a new event), progress bars, and "+ Add item" button.
3. Add test items via console:
```js
var evts = Data.getEvents();
var e = evts[0];
e.segments[0].items.push(Data.itemFromProduct({ id:'p1', brand:'Maurten', name:'C-160', type:'drink_powder', carbsPerUnit:160, sodiumPerUnit:290, caffeinePerUnit:0 }));
Data.saveEvent(e);
location.reload();
```
4. Verify: item row appears, summary cards update, progress bar shows correct percentage.

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "feat: event detail view — summary cards, segments, progress bars, item rows"
```

---

## Task 12: Add Item Sheet

**Files:**
- Modify: `app.js` (append inside IIFE before `init`)

- [ ] **Step 1: Add the sheet open/close and both tab handlers**

```js
  // ── Add item sheet ─────────────────────────────────────────────────────────

  var _sheetEventId = null;
  var _sheetSegmentId = null;

  function openAddItemSheet(eventId, segmentId) {
    _sheetEventId = eventId;
    _sheetSegmentId = segmentId;
    $('sheet-overlay').classList.remove('hidden');
    $('product-search').value = '';
    renderSheetLibraryTab();
    // Reset to library tab
    $$('.sheet-tab-btn').forEach(function (b) { b.classList.remove('active'); });
    $$('.sheet-tab-content').forEach(function (c) { c.classList.remove('active'); });
    $('sheet-tab-library').classList.add('active');
    document.querySelector('[data-sheet-tab="library"]').classList.add('active');
    // Reset one-off form
    $('oneoff-form').reset();
    $('product-search').focus();
  }

  function closeSheet() {
    $('sheet-overlay').classList.add('hidden');
    _sheetEventId = null;
    _sheetSegmentId = null;
  }

  function renderSheetLibraryTab(query) {
    var products = Data.getProducts();
    var recent = Data.getRecentProducts();

    // Recent section
    var $recentSection = $('recent-products-section');
    if (!query && recent.length) {
      $recentSection.style.display = '';
      $('recent-products-list').innerHTML = recent.map(function (p) {
        return productRowSheetHTML(p);
      }).join('');
      attachSheetProductHandlers($('recent-products-list'));
    } else {
      $recentSection.style.display = 'none';
    }

    // Search results
    var filtered = query
      ? products.filter(function (p) {
          var q = query.toLowerCase();
          return (p.name || '').toLowerCase().includes(q) ||
                 (p.brand || '').toLowerCase().includes(q) ||
                 (TYPE_LABELS[p.type] || p.type || '').toLowerCase().includes(q);
        })
      : products;

    var $results = $('product-search-results');
    if (!query && !products.length) {
      $results.innerHTML = '<div style="padding:16px 0;font-size:14px;color:var(--text-tertiary)">Your library is empty. Add products via the Library tab.</div>';
      return;
    }
    $results.innerHTML = filtered.map(function (p) {
      return productRowSheetHTML(p);
    }).join('');
    attachSheetProductHandlers($results);
  }

  function productRowSheetHTML(p) {
    var meta = [];
    if (p.carbsPerUnit) meta.push(p.carbsPerUnit + 'g carbs');
    if (p.sodiumPerUnit) meta.push(p.sodiumPerUnit + 'mg Na');
    if (p.caffeinePerUnit) meta.push(p.caffeinePerUnit + 'mg caff');
    return '<div class="product-row" data-product-id="' + p.id + '">' +
      '<div class="product-row-info">' +
        '<div class="product-row-name">' + escHtml((p.brand ? p.brand + ' ' : '') + p.name) + '</div>' +
        '<div class="product-row-meta">' + meta.join(' · ') + '</div>' +
      '</div>' +
      '<span class="product-type-chip">' + escHtml(TYPE_LABELS[p.type] || p.type) + '</span>' +
    '</div>';
  }

  function attachSheetProductHandlers($container) {
    $$('.product-row', $container).forEach(function (row) {
      on(row, 'click', function () {
        var productId = row.dataset.productId;
        var product = Data.getProducts().find(function (p) { return p.id === productId; });
        if (!product || !_sheetEventId || !_sheetSegmentId) return;
        addItemToSegment(_sheetEventId, _sheetSegmentId, Data.itemFromProduct(product));
        Data.recordProductUsed(productId);
        closeSheet();
        renderDetail();
      });
    });
  }

  function addItemToSegment(eventId, segmentId, item) {
    var evt = Data.getEvents().find(function (e) { return e.id === eventId; });
    if (!evt) return;
    var seg = evt.segments.find(function (s) { return s.id === segmentId; });
    if (!seg) return;
    seg.items.push(item);
    Data.saveEvent(evt);
  }

  // Sheet overlay close
  on($('sheet-overlay'), 'click', function (e) {
    if (e.target === $('sheet-overlay')) closeSheet();
  });
  on($('btn-close-sheet'), 'click', closeSheet);

  // Sheet tab switching
  $$('.sheet-tab-btn').forEach(function (btn) {
    on(btn, 'click', function () {
      var tab = btn.dataset.sheetTab;
      $$('.sheet-tab-btn').forEach(function (b) { b.classList.remove('active'); });
      $$('.sheet-tab-content').forEach(function (c) { c.classList.remove('active'); });
      btn.classList.add('active');
      $('sheet-tab-' + tab).classList.add('active');
      if (tab === 'library') renderSheetLibraryTab($('product-search').value);
    });
  });

  // Live search
  on($('product-search'), 'input', function () {
    renderSheetLibraryTab($('product-search').value.trim());
  });

  // One-off form submit
  on($('oneoff-form'), 'submit', function (e) {
    e.preventDefault();
    var name = $('oo-name').value.trim();
    if (!name) { $('oo-name').focus(); return; }
    var fields = {
      name: name,
      brand: $('oo-brand').value.trim(),
      type: $('oo-type').value,
      carbsPerUnit: $('oo-carbs').value,
      sodiumPerUnit: $('oo-sodium').value,
      caffeinePerUnit: $('oo-caffeine').value
    };
    var item = Data.itemFromOneOff(fields);
    if ($('oo-save-library').checked) {
      var product = Object.assign({ id: Data.generateId() }, fields, {
        carbsPerUnit: Number(fields.carbsPerUnit) || 0,
        sodiumPerUnit: Number(fields.sodiumPerUnit) || 0,
        caffeinePerUnit: Number(fields.caffeinePerUnit) || 0
      });
      Data.saveProduct(product);
      item.productId = product.id;
      Data.recordProductUsed(product.id);
    }
    addItemToSegment(_sheetEventId, _sheetSegmentId, item);
    closeSheet();
    renderDetail();
  });
```

- [ ] **Step 2: Test in browser**

1. Go to an event detail view.
2. Tap "+ Add item to segment" — bottom sheet slides up.
3. Library tab shows empty state if library is empty; switch to One-off tab.
4. Fill in One-off form (e.g. name "SIS Gel", carbs 22, sodium 100), tap "Add item".
5. Sheet closes, item appears in segment, summary cards update.
6. Add a few products to the library via the Library tab view (Task 13), then return to the event detail and verify recently-used products appear at top of sheet.

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "feat: add item sheet — library search, recently used, one-off form"
```

---

## Task 13: Product Library View

**Files:**
- Modify: `app.js` (append inside IIFE before `init`)

- [ ] **Step 1: Add the library view render and product form handlers**

```js
  // ── Product library ────────────────────────────────────────────────────────

  var TYPE_ORDER = ['gel', 'bar', 'drink_powder', 'liquid', 'chew'];

  function renderLibrary() {
    var products = Data.getProducts();
    var $body = $('library-body');
    if (!products.length) {
      $body.innerHTML = '<div class="empty-state"><div style="font-size:48px">📦</div><p>No products yet.</p><p>Tap + to add your first product.</p></div>';
      return;
    }

    // Group by type
    var groups = {};
    products.forEach(function (p) {
      var key = p.type || 'other';
      if (!groups[key]) groups[key] = [];
      groups[key].push(p);
    });

    var types = TYPE_ORDER.concat(
      Object.keys(groups).filter(function (t) { return TYPE_ORDER.indexOf(t) === -1; })
    ).filter(function (t) { return groups[t]; });

    $body.innerHTML = types.map(function (type) {
      return '<div class="product-group">' +
        '<div class="product-group-title">' + (TYPE_LABELS[type] || type) + 's</div>' +
        groups[type].map(function (p) {
          var meta = [];
          if (p.carbsPerUnit) meta.push(p.carbsPerUnit + 'g carbs');
          if (p.sodiumPerUnit) meta.push(p.sodiumPerUnit + 'mg Na');
          if (p.caffeinePerUnit) meta.push(p.caffeinePerUnit + 'mg caff');
          return '<div class="product-row" data-product-id="' + p.id + '">' +
            '<div class="product-row-info">' +
              '<div class="product-row-name">' + escHtml((p.brand ? p.brand + ' ' : '') + p.name) + '</div>' +
              '<div class="product-row-meta">' + meta.join(' · ') + '</div>' +
            '</div>' +
            '<span style="color:var(--text-tertiary);font-size:20px">&#8250;</span>' +
          '</div>';
        }).join('') +
      '</div>';
    }).join('');

    $$('.product-row', $body).forEach(function (row) {
      on(row, 'click', function () {
        navigate('product-form', { editingProductId: row.dataset.productId });
      });
    });
  }

  renders.library = renderLibrary;

  on($('btn-new-product'), 'click', function () {
    navigate('product-form', { editingProductId: null });
  });

  // ── Product form ───────────────────────────────────────────────────────────

  function renderProductForm() {
    var isEdit = !!state.editingProductId;
    var product = isEdit ? Data.getProducts().find(function (p) { return p.id === state.editingProductId; }) : null;

    $('pf-title').textContent = isEdit ? 'Edit Product' : 'New Product';
    $('btn-delete-product').style.display = isEdit ? '' : 'none';
    $('pf-brand').value    = product ? (product.brand || '') : '';
    $('pf-name').value     = product ? product.name : '';
    $('pf-type').value     = product ? product.type : 'gel';
    $('pf-carbs').value    = product ? product.carbsPerUnit : 0;
    $('pf-sodium').value   = product ? product.sodiumPerUnit : 0;
    $('pf-caffeine').value = product ? product.caffeinePerUnit : 0;
  }

  renders['product-form'] = renderProductForm;

  on($('btn-pf-back'), 'click', function () { navigate('library'); });

  on($('product-form'), 'submit', function (e) {
    e.preventDefault();
    var name = $('pf-name').value.trim();
    if (!name) { $('pf-name').focus(); return; }
    var product = {
      id: state.editingProductId || Data.generateId(),
      brand: $('pf-brand').value.trim(),
      name: name,
      type: $('pf-type').value,
      carbsPerUnit: parseFloat($('pf-carbs').value) || 0,
      sodiumPerUnit: parseFloat($('pf-sodium').value) || 0,
      caffeinePerUnit: parseFloat($('pf-caffeine').value) || 0
    };
    Data.saveProduct(product);
    navigate('library');
  });

  on($('btn-delete-product'), 'click', function () {
    if (!state.editingProductId) return;
    if (!confirm('Delete this product from your library? Existing plans won\'t be affected.')) return;
    Data.deleteProduct(state.editingProductId);
    navigate('library');
  });
```

- [ ] **Step 2: Test in browser**

1. Tap Library tab → empty state with "+" button.
2. Tap "+" → product form. Fill in details (e.g. Maurten / C-160 / drink_powder / 160g carbs / 290mg Na). Tap Save.
3. Verify product appears in library grouped by type.
4. Tap the product → edit form pre-filled. Change a value, save.
5. Tap delete → confirm dialog → product removed from library.

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "feat: product library view and product form — CRUD, grouped by type"
```

---

## Task 14: Inline Editing (Segment Fields on Detail View)

**Files:**
- Modify: `app.js` (append inside IIFE before `init`)

- [ ] **Step 1: Add the makeEditable helper and handleInlineEdit**

```js
  // ── Inline editing ─────────────────────────────────────────────────────────

  function makeEditable(el, onSave) {
    if (el.querySelector('input')) return; // already editing
    var original = el.textContent.trim();
    var input = document.createElement('input');
    input.value = original;
    input.className = 'inline-edit';
    input.style.width = Math.max(60, original.length * 10) + 'px';
    el.textContent = '';
    el.appendChild(input);
    input.focus();
    input.select();

    var committed = false;
    function commit() {
      if (committed) return;
      committed = true;
      var val = input.value.trim() || original;
      onSave(val);
    }
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { input.value = original; input.blur(); }
    });
  }

  function handleInlineEdit(el, eventId) {
    var segSection = el.closest('[data-segment-id]');
    if (!segSection) return;
    var segId = segSection.dataset.segmentId;
    var field = el.dataset.inline;

    function saveSegmentField(value) {
      var evt = Data.getEvents().find(function (e) { return e.id === eventId; });
      if (!evt) return;
      var seg = evt.segments.find(function (s) { return s.id === segId; });
      if (!seg) return;

      if (field === 'seg-name') {
        seg.name = value || seg.name;
      } else if (field === 'seg-duration') {
        var num = parseFloat(value);
        if (num > 0) seg.durationHours = num;
      } else if (field === 'seg-carbs-target') {
        var num = parseFloat(value);
        if (!isNaN(num) && num >= 0) seg.targets.carbsPerHour = num;
      } else if (field === 'seg-sodium-target') {
        var num = parseFloat(value);
        if (!isNaN(num) && num >= 0) seg.targets.sodiumPerHour = num;
      } else if (field === 'seg-caff-target') {
        var num = parseFloat(value);
        if (!isNaN(num) && num >= 0) seg.targets.caffeinePerHour = num;
      }
      Data.saveEvent(evt);
      renderDetail();
    }

    // For duration, strip the "· " prefix before editing
    if (field === 'seg-duration') {
      var evt = Data.getEvents().find(function (e) { return e.id === eventId; });
      var seg = evt ? evt.segments.find(function (s) { return s.id === segId; }) : null;
      if (!seg) return;
      var dh = seg.durationHours;
      // Replace element content with just the number
      el.textContent = dh;
      makeEditable(el, function (val) {
        saveSegmentField(val);
      });
      return;
    }

    // For target pills, extract just the number
    if (field === 'seg-carbs-target' || field === 'seg-sodium-target' || field === 'seg-caff-target') {
      var evt = Data.getEvents().find(function (e) { return e.id === eventId; });
      var seg = evt ? evt.segments.find(function (s) { return s.id === segId; }) : null;
      if (!seg) return;
      var currentVal = field === 'seg-carbs-target' ? seg.targets.carbsPerHour
                     : field === 'seg-sodium-target' ? seg.targets.sodiumPerHour
                     : seg.targets.caffeinePerHour;
      el.textContent = currentVal;
      makeEditable(el, function (val) {
        saveSegmentField(val);
      });
      return;
    }

    makeEditable(el, saveSegmentField);
  }
```

- [ ] **Step 2: Test in browser**

1. Open an event detail with multiple segments (create a triathlon event with Bike/Run segments).
2. Tap the segment name — an input appears. Change it, press Enter. Segment name updates.
3. Tap the duration — enter a new number. Progress bars recalculate.
4. Tap a target pill (e.g. "110g carbs/hr") — edit the number. Progress bars update immediately.
5. Tap the event name in the header — edit it. The name updates.

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "feat: inline editing for segment name, duration, and targets"
```

---

## Task 15: Empty States, Edge Cases, and Final Polish

**Files:**
- Modify: `app.js`, `style.css`

- [ ] **Step 1: Verify the full happy path end-to-end**

Walk through this exact sequence in the browser:

1. Open http://localhost:8080 — Events tab, empty state.
2. Tap "+" → New Event form.
3. Enter name "145mi Ride", set date and type Ride. Tap "Save Event".
4. Event detail opens — one segment, all zeros.
5. Tap "+ Add item to segment" → sheet opens, library tab empty.
6. Switch to One-off tab — add "Maurten 320": carbs 80, sodium 400. Check "Save to library". Tap "Add item".
7. Item appears. Summary cards show 80g carbs, 400mg Na. Progress bar shows vs target.
8. Tap "−" on the stepper to reduce quantity to 0 — item disappears.
9. Tap Library tab — "Maurten 320" is there.
10. Edit it — change carbs to 85, save. Product in library shows 85g, existing event item unchanged.
11. Back to Events tab — event card shows updated totals.
12. Tap event → detail. Open sheet → Library tab shows Maurten 320 in recently used.

- [ ] **Step 2: Verify delete event works on mobile**

Delete is handled via the trash icon in the edit event form header (added in Task 10). Verify:
1. Tap an event card → detail view.
2. Tap the pencil (edit) icon → edit form, trash icon visible in header.
3. Tap trash → confirm dialog → event deleted, navigates to events list.
4. Event no longer appears in the list.

- [ ] **Step 3: Add a subtle active state to the segment header inline editable fields**

Append to `style.css`:

```css
/* ── Misc polish ────────────────────────────────────────────────────────────── */
.segment-header { cursor: default; }
.target-pill:hover { background: var(--border); }
.editable:hover { border-bottom-color: var(--accent); }

/* Smooth view transitions */
.view { animation: none; }
.view.active { animation: fadeIn 0.15s ease; }
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

/* Focus ring for accessibility */
button:focus-visible, input:focus-visible, select:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
```

- [ ] **Step 4: Verify on a real mobile device or DevTools mobile simulation**

In Chrome DevTools, enable mobile simulation (iPhone 12 or similar). Verify:
- All touch targets (stepper buttons, add item button, tab bar) are comfortably tappable
- Bottom sheet doesn't obscure content underneath
- Inline editing works with mobile keyboard open
- Text doesn't overflow card boundaries

- [ ] **Step 5: Run tests one final time**

```bash
node tests/data.test.js
```

Expected: 25 passed, 0 failed.

- [ ] **Step 6: Commit**

```bash
git add app.js style.css
git commit -m "feat: event delete, polish, mobile verification"
```

---

## Self-Review Checklist

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| Events list sorted by date | Task 9 |
| Event card: name, type badge, date, duration, carbs, sodium | Task 9 |
| Create event with name only (defaults) | Task 10 |
| Segment-level targets (carbs/sodium/caffeine per hour) | Task 10, 11 |
| Summary cards: total + weighted avg rate, no color coding | Task 11 |
| Progress bars with green/amber/red status per segment | Task 11 |
| Item rows with brand+name, type, per-unit values, stepper | Task 11 |
| Totals footer for multi-segment events only | Task 11 |
| Add item sheet: library + one-off tabs | Task 12 |
| Recently used products (last 5) at top of sheet | Task 12 |
| Live search in library sheet tab | Task 12 |
| One-off items with "save to library" toggle | Task 12 |
| Product library grouped by type | Task 13 |
| Edit/delete products (no effect on past events) | Task 13 |
| "Changes won't update existing plans" note | Task 13 |
| Inline editing: event name, segment name/duration/targets | Task 14 |
| Item snapshot at add time | Task 2 (itemFromProduct) |
| recentProducts max 5, stale ids filtered | Task 2, 3 |
| Delete product cleans recents list | Task 2, 3 |
| Delete event (mobile-friendly, via edit form) | Task 7, 10 |
| Mobile-first layout, 44px+ touch targets | Tasks 5–6 |
| localStorage persistence, data.js as swappable layer | Task 2 |
