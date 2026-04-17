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

test('itemFromOneOff sets productId null, coerces numerics, defaults type to other', function () {
  var item = D.itemFromOneOff({ name: 'House Gel', brand: '', type: '', carbsPerUnit: '22', sodiumPerUnit: '100', caffeinePerUnit: '0' });
  assert.strictEqual(item.productId, null);
  assert.strictEqual(item.type, 'other');
  assert.strictEqual(item.carbsPerUnit, 22);
  assert.strictEqual(item.quantity, 1);
});

test('newSegment uses provided name and duration', function () {
  var seg = D.newSegment('Bike', 3);
  assert.strictEqual(seg.name, 'Bike');
  assert.strictEqual(seg.durationHours, 3);
  assert.strictEqual(seg.targets.carbsPerHour, 80);
  assert.deepStrictEqual(seg.items, []);
});

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

test('calcEventRates: divides totals by total duration', function () {
  var event = {
    segments: [
      { durationHours: 2, items: [{ carbsPerUnit: 100, sodiumPerUnit: 500, caffeinePerUnit: 0, quantity: 2 }] },
      { durationHours: 2, items: [{ carbsPerUnit: 100, sodiumPerUnit: 500, caffeinePerUnit: 0, quantity: 2 }] }
    ]
  };
  var r = D.calcEventRates(event);
  assert.strictEqual(r.carbs, 100);   // 400 total / 4h
  assert.strictEqual(r.sodium, 500);  // 2000 total / 4h
});

test('calcEventRates: uses 1 as fallback when total duration is 0', function () {
  var event = {
    segments: [
      { durationHours: 0, items: [{ carbsPerUnit: 80, sodiumPerUnit: 0, caffeinePerUnit: 0, quantity: 1 }] }
    ]
  };
  var r = D.calcEventRates(event);
  assert.strictEqual(r.carbs, 80);
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

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
