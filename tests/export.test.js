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
    assert.ok(md.includes('Ride · 2026-07-26'), 'expected type and date line');
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
    assert.ok(md.includes('**Targets:** 90g carbs/hr · 700mg Na/hr'), 'expected targets line');
  });

  test('targets line omits caffeine when caffeinePerHour is 0', function () {
    var md = Export.generateEventMarkdown(makeEvent());
    assert.ok(!md.includes('caff/hr'), 'caffeine should not appear in targets');
  });

  test('targets line includes caffeine when caffeinePerHour is non-zero', function () {
    var seg = makeSeg({ targets: { carbsPerHour: 60, sodiumPerHour: 400, caffeinePerHour: 100 } });
    var md = Export.generateEventMarkdown(makeEvent({ segments: [seg] }));
    assert.ok(md.includes('· 100mg caff/hr'), 'expected caffeine in targets');
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
    assert.ok(md.includes('**Totals:** 160g carbs · 0mg Na'), 'expected totals line');
  });

  test('rates line calculated correctly and rounded to 1 decimal place', function () {
    // 160g carbs over 5h = 32g/hr; 0mg Na over 5h = 0mg/hr
    var md = Export.generateEventMarkdown(makeEvent());
    assert.ok(md.includes('**Rates:** 32g carbs/hr · 0mg Na/hr'), 'expected rates line');
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
    // Check no stray italic markers at end
    assert.ok(!md.trim().endsWith('*'), 'should not end with stray italic marker');
  });

  test('post-event notes omitted when null', function () {
    var actuals = { 'seg-1': { durationHours: 1, items: [] } };
    var md = Export.generateEventMarkdown(makeEvent({ actuals: actuals, postEventNotes: null }));
    assert.ok(!md.trim().endsWith('*'), 'should not end with stray italic marker');
  });

  // ── Execution Plan ────────────────────────────────────────────────────────

  console.log('\nExecution Plan — generateExecutionPlanText');

  test('formats execution plan as readable text', function () {
    var seg = {
      name: 'Bike',
      items: [
        { id: 'g1', brand: 'Maurten', name: 'Gel 100', type: 'gel', carbsPerUnit: 25, quantity: 1 },
        { id: 'dp1', brand: 'Skratch', name: 'Superfuel', type: 'drink_powder', carbsPerUnit: 100, quantity: 1 }
      ]
    };
    var plan = [
      { slotIndex: 0, intervalMinutes: 15, assignments: [{ itemId: 'g1', quantity: 1 }, { itemId: 'dp1', quantity: 0.25 }] },
      { slotIndex: 1, intervalMinutes: 15, assignments: [{ itemId: 'dp1', quantity: 0.25 }] },
      { slotIndex: 2, intervalMinutes: 15, assignments: [] },
      { slotIndex: 3, intervalMinutes: 15, assignments: [{ itemId: 'dp1', quantity: 0.25 }] }
    ];
    var text = Export.generateExecutionPlanText(seg, plan);
    assert.ok(text.includes('Bike — Execution Plan'));
    assert.ok(text.includes('0:15'));
    assert.ok(text.includes('Maurten Gel 100'));
    assert.ok(text.includes('Sip Skratch Superfuel'));
    assert.ok(text.includes('~50g carbs')); // 25 + 100*0.25 = 50
    // Empty slot (0:45) should not appear
    assert.ok(!text.includes('0:45'));
  });

  test('formats half-bar correctly', function () {
    var seg = {
      name: 'Bike',
      items: [{ id: 'b1', brand: 'Maurten', name: 'Solid Bar', type: 'bar', carbsPerUnit: 45, quantity: 1 }]
    };
    var plan = [
      { slotIndex: 0, intervalMinutes: 15, assignments: [{ itemId: 'b1', quantity: 0.5 }] }
    ];
    var text = Export.generateExecutionPlanText(seg, plan);
    assert.ok(text.includes('½ Maurten Solid Bar'));
  });

  // ── Summary ───────────────────────────────────────────────────────────────

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) process.exit(1);
}

run();
