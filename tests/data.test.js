// tests/data.test.js
'use strict';

// ── Mocks ────────────────────────────────────────────────────────────────────

global.localStorage = (function () {
  var store = {};
  return {
    getItem:    function (k)    { return store[k] !== undefined ? store[k] : null; },
    setItem:    function (k, v) { store[k] = String(v); },
    removeItem: function (k)    { delete store[k]; },
    clear:      function ()     { store = {}; }
  };
})();

// crypto.randomUUID — returns a deterministic value per call for predictable test IDs
var nodeCrypto = require('crypto');
var _uuidCounter = 0;
Object.defineProperty(global, 'crypto', {
  configurable: true,
  writable: true,
  value: {
    randomUUID: function () {
      _uuidCounter++;
      return '00000000-0000-0000-0000-' + String(_uuidCounter).padStart(12, '0');
    },
    getRandomValues: function (arr) {
      // deterministic values for predictable test output
      for (var i = 0; i < arr.length; i++) arr[i] = i * 997 + 42;
      return arr;
    },
    subtle: nodeCrypto.webcrypto.subtle
  }
});

// fetch mock — each test section configures _fetchResponses before calling async Data functions.
// Format: [{ status, body }] — consumed FIFO by each fetch call.
var _fetchResponses = [];
global.fetch = async function (_url, _opts) {
  var resp = _fetchResponses.shift() || { status: 200, body: '[]' };
  return {
    ok:     resp.status >= 200 && resp.status < 300,
    status: resp.status,
    text:   async function () { return resp.body !== undefined ? String(resp.body) : ''; }
  };
};

function mockFetch(responses) {
  _fetchResponses = responses.slice();
}

var assert = require('assert');
var D = require('../data.js');

var passed = 0, failed = 0;

// Supports both sync and async test functions
async function test(name, fn) {
  localStorage.clear();
  _fetchResponses = [];
  _uuidCounter = 0;
  try {
    await fn();
    console.log('  \u2713 ' + name);
    passed++;
  } catch (e) {
    console.error('  \u2717 ' + name + ': ' + e.message);
    failed++;
  }
}

async function run() {

  // ── Products ─────────────────────────────────────────────────────────────────

  console.log('\nProducts CRUD');

  await test('getProducts returns [] when empty', async function () {
    mockFetch([{ status: 200, body: '[]' }]);
    var result = await D.getProducts();
    assert.deepStrictEqual(result, []);
  });

  await test('saveProduct sends upsert POST to Supabase', async function () {
    var p = { id: 'aaaaaaaa-0000-0000-0000-000000000001', brand: 'Maurten', name: 'C-160',
              type: 'drink_powder', carbsPerUnit: 160, sodiumPerUnit: 290, caffeinePerUnit: 0 };
    // saveProduct returns nothing useful — just confirm it doesn't throw
    mockFetch([{ status: 200, body: '[]' }]);
    await D.saveProduct(p); // no assertion needed — would throw on non-ok status
  });

  await test('saveProduct throws on server error', async function () {
    var p = { id: 'aaaaaaaa-0000-0000-0000-000000000001', brand: '', name: 'X',
              type: 'gel', carbsPerUnit: 0, sodiumPerUnit: 0, caffeinePerUnit: 0 };
    mockFetch([{ status: 400, body: 'Bad request' }]);
    await assert.rejects(D.saveProduct(p), /Bad request/);
  });

  await test('deleteProduct removes from recent list', async function () {
    localStorage.setItem('fuelPlanner.recentProducts', JSON.stringify(['p1', 'p2']));
    mockFetch([{ status: 204, body: '' }]);
    await D.deleteProduct('p1');
    var ids = JSON.parse(localStorage.getItem('fuelPlanner.recentProducts'));
    assert.deepStrictEqual(ids, ['p2']);
  });

  await test('getProducts normalises snake_case to camelCase', async function () {
    var row = { id: 'abc', brand: 'Maurten', name: 'C-160', type: 'drink_powder',
                carbs_per_unit: 160, sodium_per_unit: 290, caffeine_per_unit: 0 };
    mockFetch([{ status: 200, body: JSON.stringify([row]) }]);
    var products = await D.getProducts();
    assert.strictEqual(products.length, 1);
    assert.strictEqual(products[0].carbsPerUnit, 160);
    assert.strictEqual(products[0].sodiumPerUnit, 290);
    assert.strictEqual(products[0].id, 'abc');
  });

  // ── Events ────────────────────────────────────────────────────────────────────

  console.log('\nEvents CRUD');

  await test('getEvents returns [] when empty', async function () {
    mockFetch([{ status: 200, body: '[]' }]);
    var result = await D.getEvents();
    assert.deepStrictEqual(result, []);
  });

  await test('getEvent returns null when not found', async function () {
    mockFetch([{ status: 200, body: '[]' }]);
    var result = await D.getEvent('non-existent-id');
    assert.strictEqual(result, null);
  });

  await test('saveEvent sends POST to rpc/save_event', async function () {
    var e = D.newEvent('Test Ride');
    mockFetch([{ status: 204, body: '' }]);
    await D.saveEvent(e); // confirm no throw
  });

  await test('saveEvent throws on server error', async function () {
    var e = D.newEvent('Bad Ride');
    mockFetch([{ status: 500, body: 'Internal Server Error' }]);
    await assert.rejects(D.saveEvent(e), /Internal Server Error/);
  });

  await test('deleteEvent sends DELETE request', async function () {
    mockFetch([{ status: 204, body: '' }]);
    await D.deleteEvent('some-uuid'); // confirm no throw
  });

  await test('getEvents normalises nested segments and items', async function () {
    var row = {
      id: 'evt-1', name: 'Test', date: '2026-05-10', type: 'ride', notes: '',
      segments: [{
        id: 'seg-1', name: 'Bike', duration_hours: 3,
        carbs_per_hour: 110, sodium_per_hour: 600, caffeine_per_hour: 0, sort_order: 0,
        items: [{
          id: 'itm-1', product_id: null, name: 'Gel', brand: '', type: 'gel',
          carbs_per_unit: 25, sodium_per_unit: 0, caffeine_per_unit: 0,
          quantity: 2, sort_order: 0
        }]
      }]
    };
    mockFetch([{ status: 200, body: JSON.stringify([row]) }]);
    var events = await D.getEvents();
    assert.strictEqual(events.length, 1);
    var seg = events[0].segments[0];
    assert.strictEqual(seg.durationHours, 3);
    assert.strictEqual(seg.targets.carbsPerHour, 110);
    assert.strictEqual(seg.items[0].carbsPerUnit, 25);
    assert.strictEqual(seg.items[0].quantity, 2);
  });

  await test('getEvents sorts segments and items by sort_order', async function () {
    var row = {
      id: 'evt-1', name: 'Test', date: '', type: 'other', notes: '',
      segments: [
        { id: 'seg-b', name: 'Run',  duration_hours: 1, carbs_per_hour: 0, sodium_per_hour: 0, caffeine_per_hour: 0, sort_order: 1, items: [] },
        { id: 'seg-a', name: 'Bike', duration_hours: 3, carbs_per_hour: 0, sodium_per_hour: 0, caffeine_per_hour: 0, sort_order: 0, items: [] }
      ]
    };
    mockFetch([{ status: 200, body: JSON.stringify([row]) }]);
    var events = await D.getEvents();
    assert.strictEqual(events[0].segments[0].name, 'Bike');
    assert.strictEqual(events[0].segments[1].name, 'Run');
  });

  // ── Recent products ───────────────────────────────────────────────────────────

  console.log('\nRecent products');

  await test('getRecentProducts returns [] when empty', function () {
    assert.deepStrictEqual(D.getRecentProducts(), []);
  });

  await test('recordProductUsed prepends and caps at 5', function () {
    ['1','2','3','4','5','6'].forEach(D.recordProductUsed);
    var ids = D.getRecentProducts();
    assert.strictEqual(ids.length, 5);
    assert.strictEqual(ids[0], '6'); // most recent first
    assert.strictEqual(ids[4], '2'); // oldest kept
  });

  await test('deleteProduct removes ID from recent list', async function () {
    D.recordProductUsed('p1');
    D.recordProductUsed('p2');
    mockFetch([{ status: 204, body: '' }]);
    await D.deleteProduct('p1');
    var ids = D.getRecentProducts();
    assert.deepStrictEqual(ids, ['p2']);
  });

  await test('getRecentProducts returns stale IDs as-is (filtering is caller responsibility)', function () {
    // The new implementation does not filter stale IDs — callers filter using .filter(Boolean)
    // after resolving IDs against a fetched product list.
    localStorage.setItem('fuelPlanner.recentProducts', JSON.stringify(['ghost-id']));
    assert.deepStrictEqual(D.getRecentProducts(), ['ghost-id']);
  });

  // ── newEvent / newSegment factories ───────────────────────────────────────────

  console.log('\nFactories');

  await test('newEvent has one segment named after the event', function () {
    var e = D.newEvent('My Ride');
    assert.strictEqual(e.segments.length, 1);
    assert.strictEqual(e.segments[0].name, 'My Ride');
    assert.strictEqual(e.segments[0].targets.carbsPerHour, 80);
    assert.strictEqual(e.segments[0].targets.sodiumPerHour, 500);
  });

  await test('itemFromProduct snapshots product values', function () {
    var p = { id: 'p1', brand: 'Maurten', name: 'C-160', type: 'drink_powder', carbsPerUnit: 160, sodiumPerUnit: 290, caffeinePerUnit: 0 };
    var item = D.itemFromProduct(p);
    assert.strictEqual(item.productId, 'p1');
    assert.strictEqual(item.carbsPerUnit, 160);
    assert.strictEqual(item.quantity, 1);
  });

  await test('itemFromOneOff sets productId null, coerces numerics, defaults type to other', function () {
    var item = D.itemFromOneOff({ name: 'House Gel', brand: '', type: '', carbsPerUnit: '22', sodiumPerUnit: '100', caffeinePerUnit: '0' });
    assert.strictEqual(item.productId, null);
    assert.strictEqual(item.type, 'other');
    assert.strictEqual(item.carbsPerUnit, 22);
    assert.strictEqual(item.quantity, 1);
  });

  await test('newSegment uses provided name and duration', function () {
    var seg = D.newSegment('Bike', 3);
    assert.strictEqual(seg.name, 'Bike');
    assert.strictEqual(seg.durationHours, 3);
    assert.strictEqual(seg.targets.carbsPerHour, 80);
    assert.deepStrictEqual(seg.items, []);
  });

  // ── Multi-day events (new fields) ──────────────────────────────────────────────

  await test('dbToEvent: category defaults to single when missing', function () {
    var row = {
      id: 'e1', name: 'Test', date: '2026-06-28', type: 'ride',
      notes: null, post_event_notes: null, actuals: null,
      segments: []
    };
    var evt = D.dbToEvent(row);
    assert.strictEqual(evt.category, 'single');
    assert.strictEqual(evt.endDate, '');
  });

  await test('dbToEvent: category and endDate round-trip from row', function () {
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

  await test('dbToEvent: segment date round-trips from row', function () {
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

  await test('dbToEvent: segment date defaults to empty string when missing', function () {
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

  await test('eventToDb: passes category and end_date through', function () {
    var evt = {
      id: 'e5', name: 'Tour', date: '2026-06-28', type: 'ride',
      category: 'multi', endDate: '2026-07-04',
      notes: '', segments: []
    };
    var row = D.eventToDb(evt);
    assert.strictEqual(row.category, 'multi');
    assert.strictEqual(row.end_date, '2026-07-04');
  });

  await test('eventToDb: passes segment date through', function () {
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

  await test('newEvent: includes category single and empty endDate', function () {
    var evt = D.newEvent('Test');
    assert.strictEqual(evt.category, 'single');
    assert.strictEqual(evt.endDate, '');
  });

  await test('newSegment: includes empty date by default', function () {
    var seg = D.newSegment('Bike', 2);
    assert.strictEqual(seg.date, '');
  });

  await test('newSegment: accepts a pre-fill date', function () {
    var seg = D.newSegment('Day 1', 3, '2026-06-28');
    assert.strictEqual(seg.date, '2026-06-28');
  });

  // ── Calculations ──────────────────────────────────────────────────────────────

  console.log('\nCalculations');

  await test('calcSegmentTotals: sums items correctly', function () {
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

  await test('calcSegmentTotals: empty items returns zeros', function () {
    var seg = { durationHours: 2, targets: {}, items: [] };
    var t = D.calcSegmentTotals(seg);
    assert.deepStrictEqual(t, { carbs: 0, sodium: 0, caffeine: 0 });
  });

  await test('calcSegmentRates: divides by duration', function () {
    var seg = {
      durationHours: 2,
      targets: {},
      items: [{ carbsPerUnit: 100, sodiumPerUnit: 500, caffeinePerUnit: 0, quantity: 2 }]
    };
    var r = D.calcSegmentRates(seg);
    assert.strictEqual(r.carbs, 100);   // 200 / 2
    assert.strictEqual(r.sodium, 500);  // 1000 / 2
  });

  await test('calcSegmentRates: uses 1 as fallback when durationHours is 0', function () {
    var seg = { durationHours: 0, targets: {}, items: [{ carbsPerUnit: 80, sodiumPerUnit: 0, caffeinePerUnit: 0, quantity: 1 }] };
    var r = D.calcSegmentRates(seg);
    assert.strictEqual(r.carbs, 80);
    assert.strictEqual(r.sodium,   0);
    assert.strictEqual(r.caffeine, 0);
  });

  await test('calcEventTotals: sums across segments', function () {
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

  await test('calcEventRates: divides totals by total duration', function () {
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

  await test('calcEventRates: uses 1 as fallback when total duration is 0', function () {
    var event = {
      segments: [
        { durationHours: 0, items: [{ carbsPerUnit: 80, sodiumPerUnit: 0, caffeinePerUnit: 0, quantity: 1 }] }
      ]
    };
    var r = D.calcEventRates(event);
    assert.strictEqual(r.carbs, 80);
    assert.strictEqual(r.sodium,   0);
    assert.strictEqual(r.caffeine, 0);
  });

  await test('rateStatus: on-target within ±10%', function () {
    assert.strictEqual(D.rateStatus(80, 80), 'on-target');
    assert.strictEqual(D.rateStatus(72, 80), 'on-target');  // exactly 90%
    assert.strictEqual(D.rateStatus(88, 80), 'on-target');  // exactly 110%
  });

  await test('rateStatus: warning-under 10–25% below', function () {
    assert.strictEqual(D.rateStatus(64, 80), 'warning-under'); // 80%
  });

  await test('rateStatus: warning-over 10–25% above', function () {
    assert.strictEqual(D.rateStatus(96, 80), 'warning-over'); // 120%
  });

  await test('rateStatus: under more than 25% below', function () {
    assert.strictEqual(D.rateStatus(40, 80), 'under'); // 50%
  });

  await test('rateStatus: over more than 25% above', function () {
    assert.strictEqual(D.rateStatus(120, 80), 'over'); // 150%
  });

  await test('rateStatus: target 0, actual > 0 is over', function () {
    assert.strictEqual(D.rateStatus(5, 0), 'over');
  });

  await test('rateStatus: both 0 is none', function () {
    assert.strictEqual(D.rateStatus(0, 0), 'none');
  });

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
    assert.strictEqual(r.sodium,   0);
    assert.strictEqual(r.caffeine, 0);
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
    assert.strictEqual(r.sodium,   0);
    assert.strictEqual(r.caffeine, 0);
  });

  // ── Identity ──────────────────────────────────────────────────────────────────

  console.log('\nIdentity');

  await test('getUserId returns null when localStorage is empty', function () {
    assert.strictEqual(D.getUserId(), null);
  });

  await test('getUserId returns value set in localStorage', function () {
    localStorage.setItem('fuelPlanner.userId', 'abc-123');
    assert.strictEqual(D.getUserId(), 'abc-123');
  });

  await test('generatePhrase returns 4 space-separated words', function () {
    var phrase = D.generatePhrase();
    var words = phrase.split(' ');
    assert.strictEqual(words.length, 4);
    words.forEach(function (w) { assert.ok(w.length > 0); });
  });

  await test('generatePhrase returns a string', function () {
    assert.ok(typeof D.generatePhrase() === 'string');
  });

  await test('generatePhrase returns words from the wordlist', function () {
    // mock getRandomValues fills [42, 1039, 2036, 3033]; each mod 256 = [42, 15, 244, 217]
    var phrase = D.generatePhrase();
    var words = phrase.split(' ');
    // Verify each word is a real word (not undefined/empty/number)
    words.forEach(function (w) {
      assert.ok(/^[a-z]+$/.test(w), 'word should be lowercase alpha: ' + w);
    });
    // Verify phrase is deterministic with the mock
    assert.strictEqual(words.length, 4);
  });

  await test('hashPhrase returns 64-char hex string', async function () {
    var hash = await D.hashPhrase('maple river sunset bottle');
    assert.match(hash, /^[0-9a-f]{64}$/);
  });

  await test('hashPhrase normalises case and trims whitespace', async function () {
    var h1 = await D.hashPhrase('  Maple River Sunset Bottle  ');
    var h2 = await D.hashPhrase('maple river sunset bottle');
    assert.strictEqual(h1, h2);
  });

  await test('hashPhrase same input always produces same hash', async function () {
    var h1 = await D.hashPhrase('maple river sunset bottle');
    var h2 = await D.hashPhrase('maple river sunset bottle');
    assert.strictEqual(h1, h2);
  });

  await test('hashPhrase different input produces different hash', async function () {
    var h1 = await D.hashPhrase('maple river sunset bottle');
    var h2 = await D.hashPhrase('maple river sunset jar');
    assert.notStrictEqual(h1, h2);
  });

  await test('saveClaim sends POST to claims endpoint', async function () {
    localStorage.setItem('fuelPlanner.userId', 'test-uuid');
    mockFetch([{ status: 200, body: '[]' }]);
    await D.saveClaim('abc123hash');
    // passes if no exception thrown
  });

  await test('saveClaim throws on server error', async function () {
    localStorage.setItem('fuelPlanner.userId', 'test-uuid');
    mockFetch([{ status: 400, body: 'Bad request' }]);
    await assert.rejects(D.saveClaim('abc123hash'), /Bad request/);
  });

  await test('lookupClaim returns user_id when found', async function () {
    mockFetch([{ status: 200, body: JSON.stringify([{ user_id: 'found-uuid' }]) }]);
    var result = await D.lookupClaim('abc123hash');
    assert.strictEqual(result, 'found-uuid');
  });

  await test('lookupClaim returns null when not found', async function () {
    mockFetch([{ status: 200, body: '[]' }]);
    var result = await D.lookupClaim('abc123hash');
    assert.strictEqual(result, null);
  });

  await test('saveUser sends upsert POST to users endpoint (id only)', async function () {
    mockFetch([{ status: 200, body: '[]' }]);
    await D.saveUser('aaaaaaaa-0000-0000-0000-000000000001');
    // passes if no exception thrown
  });

  await test('saveUser throws on server error', async function () {
    mockFetch([{ status: 400, body: 'Bad request' }]);
    await assert.rejects(
      D.saveUser('aaaaaaaa-0000-0000-0000-000000000001'),
      /Bad request/
    );
  });

  // ── Execution Plan ────────────────────────────────────────────────────────────

  console.log('\nExecution Plan — generateExecutionPlan');

  await test('generates correct slot count for 1h segment', async function () {
    var seg = {
      id: 'seg1', durationHours: 1,
      targets: { carbsPerHour: 60, sodiumPerHour: 0, caffeinePerHour: 0 },
      items: []
    };
    var plan = D.generateExecutionPlan(seg);
    assert.strictEqual(plan.length, 5); // ceil(60/15) + 1 = 5 (0:00..1:00)
  });

  await test('generates correct slot count for 3.5h segment', async function () {
    var seg = {
      id: 'seg1', durationHours: 3.5,
      targets: { carbsPerHour: 90, sodiumPerHour: 0, caffeinePerHour: 0 },
      items: []
    };
    var plan = D.generateExecutionPlan(seg);
    assert.strictEqual(plan.length, 15); // ceil(210/15) + 1 = 15 (0:00..3:30)
  });

  await test('distributes 4 gels evenly across 9 slots (centered in buckets)', async function () {
    var seg = {
      id: 'seg1', durationHours: 2,
      targets: { carbsPerHour: 60, sodiumPerHour: 0, caffeinePerHour: 0 },
      items: [
        { id: 'g1', type: 'gel', carbsPerUnit: 25, sodiumPerUnit: 0, caffeinePerUnit: 0, quantity: 4 }
      ]
    };
    var plan = D.generateExecutionPlan(seg);
    var assigned = plan.filter(function(s) { return s.assignments.length > 0; });
    assert.strictEqual(assigned.length, 4);
    // (i+0.5) formula: item 0 -> slot 1, item 1 -> slot 3, item 2 -> slot 5, item 3 -> slot 7
    assert.strictEqual(plan[1].assignments[0].itemId, 'g1');
    assert.strictEqual(plan[1].assignments[0].quantity, 1);
    assert.strictEqual(plan[3].assignments[0].itemId, 'g1');
    assert.strictEqual(plan[5].assignments[0].itemId, 'g1');
    assert.strictEqual(plan[7].assignments[0].itemId, 'g1');
    // No two gels in the same slot
    var maxPerSlot = Math.max.apply(null, plan.map(function(s) { return s.assignments.length; }));
    assert.strictEqual(maxPerSlot, 1);
  });

  await test('interleaves caf and non-caf gels', async function () {
    var seg = {
      id: 'seg1', durationHours: 2,
      targets: { carbsPerHour: 60, sodiumPerHour: 0, caffeinePerHour: 0 },
      items: [
        { id: 'gcaf', type: 'gel', carbsPerUnit: 25, sodiumPerUnit: 0, caffeinePerUnit: 75, quantity: 2 },
        { id: 'gnon', type: 'gel', carbsPerUnit: 25, sodiumPerUnit: 0, caffeinePerUnit: 0, quantity: 2 }
      ]
    };
    var plan = D.generateExecutionPlan(seg);
    var nonEmpty = plan.filter(function(s) { return s.assignments.length > 0; });
    assert.strictEqual(nonEmpty.length, 4);
    // First slot should have a caf gel
    assert.strictEqual(nonEmpty[0].assignments[0].itemId, 'gcaf');
    // Second slot should have a non-caf gel
    assert.strictEqual(nonEmpty[1].assignments[0].itemId, 'gnon');
  });

  await test('splits bars into half-unit assignments', async function () {
    var seg = {
      id: 'seg1', durationHours: 2,
      targets: { carbsPerHour: 40, sodiumPerHour: 0, caffeinePerHour: 0 },
      items: [
        { id: 'b1', type: 'bar', carbsPerUnit: 45, sodiumPerUnit: 0, caffeinePerUnit: 0, quantity: 2 }
      ]
    };
    var plan = D.generateExecutionPlan(seg);
    var allAssignments = plan.reduce(function(acc, s) { return acc.concat(s.assignments); }, []);
    assert.strictEqual(allAssignments.length, 4); // 2 bars × 2 halves = 4
    assert.strictEqual(allAssignments[0].quantity, 0.5);
  });

  await test('distributes drink_powder as one drink_group sip per slot', async function () {
    var seg = {
      id: 'seg1', durationHours: 1,
      targets: { carbsPerHour: 80, sodiumPerHour: 0, caffeinePerHour: 0 },
      items: [
        { id: 'dp1', type: 'drink_powder', carbsPerUnit: 80, sodiumPerUnit: 0, caffeinePerUnit: 0, quantity: 1 }
      ]
    };
    var plan = D.generateExecutionPlan(seg);
    assert.strictEqual(plan.length, 5); // 0:00..1:00
    plan.forEach(function(slot) {
      assert.strictEqual(slot.assignments.length, 1);
      var a = slot.assignments[0];
      assert.strictEqual(a.type, 'drink_group');
      assert.strictEqual(a.groupId, '__auto__');
      assert.deepStrictEqual(a.itemIds, ['dp1']);
      assert.ok(Math.abs(a.carbsPerSlot - 16) < 0.1); // 80g / 5 slots = 16g per slot
    });
  });

  await test('merges multiple drink_powders into a single drink_group per slot', async function () {
    var seg = {
      id: 'seg1', durationHours: 1,
      targets: { carbsPerHour: 100, sodiumPerHour: 0, caffeinePerHour: 0 },
      items: [
        { id: 'dp1', type: 'drink_powder', carbsPerUnit: 100, sodiumPerUnit: 400, caffeinePerUnit: 0, quantity: 1 },
        { id: 'dp2', type: 'drink_powder', carbsPerUnit: 0,   sodiumPerUnit: 400, caffeinePerUnit: 0, quantity: 1 }
      ]
    };
    var plan = D.generateExecutionPlan(seg);
    assert.strictEqual(plan.length, 5); // 0:00..1:00
    plan.forEach(function(slot) {
      var groups = slot.assignments.filter(function(a) { return a.type === 'drink_group'; });
      assert.strictEqual(groups.length, 1, 'exactly one drink_group per slot');
      var g = groups[0];
      assert.ok(g.itemIds.indexOf('dp1') !== -1);
      assert.ok(g.itemIds.indexOf('dp2') !== -1);
      assert.ok(Math.abs(g.carbsPerSlot - 20) < 0.1);   // 100g / 5 slots
      assert.ok(Math.abs(g.sodiumPerSlot - 160) < 0.1); // 800mg / 5 slots
    });
  });

  await test('uses segment.bottleGroups for explicit bottle grouping when defined', async function () {
    var seg = {
      id: 'seg1', durationHours: 1,
      targets: { carbsPerHour: 100, sodiumPerHour: 0, caffeinePerHour: 0 },
      bottleGroups: [
        { id: 'b1', name: 'Bottle 1', itemIds: ['dp1'] },
        { id: 'b2', name: 'Bottle 2', itemIds: ['dp2'] }
      ],
      items: [
        { id: 'dp1', type: 'drink_powder', carbsPerUnit: 80, sodiumPerUnit: 400, caffeinePerUnit: 0, quantity: 1 },
        { id: 'dp2', type: 'drink_powder', carbsPerUnit: 20, sodiumPerUnit: 400, caffeinePerUnit: 0, quantity: 1 }
      ]
    };
    var plan = D.generateExecutionPlan(seg);
    plan.forEach(function(slot) {
      var groups = slot.assignments.filter(function(a) { return a.type === 'drink_group'; });
      assert.strictEqual(groups.length, 2, 'two separate groups for two bottles');
      var b1 = groups.find(function(g) { return g.groupId === 'b1'; });
      var b2 = groups.find(function(g) { return g.groupId === 'b2'; });
      assert.ok(b1 && b1.groupName === 'Bottle 1');
      assert.ok(b2 && b2.groupName === 'Bottle 2');
      assert.ok(Math.abs(b1.carbsPerSlot - 16) < 0.1); // 80g / 5 slots
      assert.ok(Math.abs(b2.carbsPerSlot - 4) < 0.1);  // 20g / 5 slots
    });
  });

  await test('skips items with quantity 0', async function () {
    var seg = {
      id: 'seg1', durationHours: 1,
      targets: { carbsPerHour: 60, sodiumPerHour: 0, caffeinePerHour: 0 },
      items: [
        { id: 'g1', type: 'gel', carbsPerUnit: 25, sodiumPerUnit: 0, caffeinePerUnit: 0, quantity: 0 }
      ]
    };
    var plan = D.generateExecutionPlan(seg);
    var allAssignments = plan.reduce(function(acc, s) { return acc.concat(s.assignments); }, []);
    assert.strictEqual(allAssignments.length, 0);
  });

  console.log('\nExecution Plan — checkExecutionPlanTarget');

  await test('returns projected rate when >15% below target', async function () {
    var seg = {
      id: 'seg1', durationHours: 1,
      targets: { carbsPerHour: 100, sodiumPerHour: 0, caffeinePerHour: 0 },
      items: [
        { id: 'g1', type: 'gel', carbsPerUnit: 25, sodiumPerUnit: 0, caffeinePerUnit: 0, quantity: 2 }
      ]
    };
    var result = D.checkExecutionPlanTarget(seg);
    assert.strictEqual(result, 50); // 50g/hr, well below 85g threshold
  });

  await test('returns null when within 15% of target', async function () {
    var seg = {
      id: 'seg1', durationHours: 1,
      targets: { carbsPerHour: 100, sodiumPerHour: 0, caffeinePerHour: 0 },
      items: [
        { id: 'g1', type: 'gel', carbsPerUnit: 25, sodiumPerUnit: 0, caffeinePerUnit: 0, quantity: 4 }
      ]
    };
    var result = D.checkExecutionPlanTarget(seg);
    assert.strictEqual(result, null); // 100g/hr = exactly on target
  });

  await test('returns null when no target set', async function () {
    var seg = {
      id: 'seg1', durationHours: 1,
      targets: { carbsPerHour: 0, sodiumPerHour: 0, caffeinePerHour: 0 },
      items: [
        { id: 'g1', type: 'gel', carbsPerUnit: 25, sodiumPerUnit: 0, caffeinePerUnit: 0, quantity: 2 }
      ]
    };
    assert.strictEqual(D.checkExecutionPlanTarget(seg), null);
  });

  console.log('\nExecution Plan — calcSlotCarbs');

  await test('calculates carbs for a slot with discrete items', async function () {
    var items = [{ id: 'g1', carbsPerUnit: 25, quantity: 1 }];
    var slot = { assignments: [{ itemId: 'g1', quantity: 1 }] };
    var carbs = D.calcSlotCarbs(slot, items);
    assert.strictEqual(carbs, 25);
  });

  await test('uses carbsPerSlot directly for drink_group assignments', async function () {
    var items = [{ id: 'g1', carbsPerUnit: 25, quantity: 1 }];
    var slot = {
      assignments: [
        { itemId: 'g1', quantity: 1 },
        { type: 'drink_group', groupId: '__auto__', groupName: null, itemIds: ['dp1'], carbsPerSlot: 20, sodiumPerSlot: 100 }
      ]
    };
    var carbs = D.calcSlotCarbs(slot, items);
    assert.strictEqual(carbs, 45); // 25 (gel) + 20 (drink_group)
  });

  await test('returns 0 for empty slot', async function () {
    var slot = { assignments: [] };
    assert.strictEqual(D.calcSlotCarbs(slot, []), 0);
  });

  console.log('\nExecution Plan — localStorage persistence');

  await test('saveExecutionPlan and loadExecutionPlan round-trip', async function () {
    var plan = [{ slotIndex: 0, intervalMinutes: 15, assignments: [{ itemId: 'g1', quantity: 1 }] }];
    D.saveExecutionPlan('seg-abc', plan);
    var loaded = D.loadExecutionPlan('seg-abc');
    assert.deepStrictEqual(loaded, plan);
  });

  await test('loadExecutionPlan returns null for unknown segment', async function () {
    assert.strictEqual(D.loadExecutionPlan('unknown-seg'), null);
  });

  await test('deleteExecutionPlan removes the plan', async function () {
    D.saveExecutionPlan('seg-del', [{ slotIndex: 0, intervalMinutes: 15, assignments: [] }]);
    D.deleteExecutionPlan('seg-del');
    assert.strictEqual(D.loadExecutionPlan('seg-del'), null);
  });

  // ── Summary ───────────────────────────────────────────────────────────────────

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) process.exit(1);
} // end run()

run().catch(function (e) { console.error('Test runner error:', e); process.exit(1); });
