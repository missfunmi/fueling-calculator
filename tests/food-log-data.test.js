// tests/food-log-data.test.js
'use strict';

// ── Mocks ─────────────────────────────────────────────────────────────────────

global.window = global;

global.localStorage = (function () {
  var store = {};
  return {
    getItem:    function (k)    { return store[k] !== undefined ? store[k] : null; },
    setItem:    function (k, v) { store[k] = String(v); },
    removeItem: function (k)    { delete store[k]; },
    clear:      function ()     { store = {}; }
  };
})();

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

// Load the module — it sets window.FoodLogData
require('../food-log-data.js');
var FLD = global.FoodLogData;

var assert = require('assert');
var passed = 0, failed = 0;

async function test(name, fn) {
  _fetchResponses = [];
  try {
    await fn();
    console.log('  ✓ ' + name);
    passed++;
  } catch (e) {
    console.error('  ✗ ' + name + '\n    ' + e.message);
    failed++;
  }
}

async function run() {

  // ── satFatGTarget ─────────────────────────────────────────────────────────────

  console.log('\nsatFatGTarget');

  await test('2000 cal × 5% / 9 = 11.1g', async function () {
    assert.strictEqual(FLD.satFatGTarget({ caloriesTarget: 2000, satFatPct: 5 }), 11.1);
  });

  await test('returns null when caloriesTarget is null', async function () {
    assert.strictEqual(FLD.satFatGTarget({ caloriesTarget: null, satFatPct: 6 }), null);
  });

  await test('returns null when satFatPct is null', async function () {
    assert.strictEqual(FLD.satFatGTarget({ caloriesTarget: 2000, satFatPct: null }), null);
  });

  await test('returns null when targets object is null', async function () {
    assert.strictEqual(FLD.satFatGTarget(null), null);
  });

  await test('returns null when caloriesTarget is 0', async function () {
    assert.strictEqual(FLD.satFatGTarget({ caloriesTarget: 0, satFatPct: 6 }), null);
  });

  await test('1800 cal × 6% / 9 = 12g exactly', async function () {
    assert.strictEqual(FLD.satFatGTarget({ caloriesTarget: 1800, satFatPct: 6 }), 12);
  });

  // ── rowToLog satFat field via getLogs mock ────────────────────────────────────

  console.log('\nrowToLog satFat mapping');

  await test('rowToLog maps sat_fat from DB row', async function () {
    mockFetch([{
      status: 200,
      body: JSON.stringify([{
        id: 'log1', user_id: 'u1', logged_at: new Date().toISOString(),
        name: 'test', category: null, freeform_input: null,
        protein: 10, carbs: 20, fat: 5, calories: 165,
        fiber: null, sodium: null, sat_fat: 3.5,
        library_item_id: null, serving_multiplier: 1, ai_estimated: false,
        ai_notes: null, components: null, log_serving_size: null,
        log_serving_unit: null, batch_id: null, batch_total: null,
        batch_remaining: null, batch_discarded: false, local_date: '2026-10-01',
        created_at: new Date().toISOString()
      }])
    }]);
    var logs = await FLD.getLogs('u1', '2026-10-01');
    assert.strictEqual(logs[0].satFat, 3.5);
  });

  await test('rowToLog maps sat_fat null as null', async function () {
    mockFetch([{
      status: 200,
      body: JSON.stringify([{
        id: 'log2', user_id: 'u1', logged_at: new Date().toISOString(),
        name: 'test', category: null, freeform_input: null,
        protein: 10, carbs: 20, fat: 5, calories: 165,
        fiber: null, sodium: null, sat_fat: null,
        library_item_id: null, serving_multiplier: 1, ai_estimated: false,
        ai_notes: null, components: null, log_serving_size: null,
        log_serving_unit: null, batch_id: null, batch_total: null,
        batch_remaining: null, batch_discarded: false, local_date: '2026-10-01',
        created_at: new Date().toISOString()
      }])
    }]);
    var logs = await FLD.getLogs('u1', '2026-10-01');
    assert.strictEqual(logs[0].satFat, null);
  });

  // ── rowToItem satFatPerServing via getLibrary mock ────────────────────────────

  console.log('\nrowToItem satFatPerServing mapping');

  await test('rowToItem maps sat_fat_per_serving from DB row', async function () {
    mockFetch([{
      status: 200,
      body: JSON.stringify([{
        id: 'item1', user_id: 'u1', name: 'Butter', brand: null,
        category: null, is_fuel: false,
        protein_per_serving: 0, carbs_per_serving: 0, fat_per_serving: 11,
        calories_per_serving: 102, fiber_per_serving: null,
        sodium_per_serving: null, caffeine_per_serving: null,
        sat_fat_per_serving: 7.2, serving_size: 14, serving_unit: 'g',
        created_at: new Date().toISOString()
      }])
    }]);
    var items = await FLD.getLibrary('u1');
    assert.strictEqual(items[0].satFatPerServing, 7.2);
  });

  await test('rowToItem maps sat_fat_per_serving null as null', async function () {
    mockFetch([{
      status: 200,
      body: JSON.stringify([{
        id: 'item2', user_id: 'u1', name: 'Water', brand: null,
        category: null, is_fuel: false,
        protein_per_serving: 0, carbs_per_serving: 0, fat_per_serving: 0,
        calories_per_serving: 0, fiber_per_serving: null,
        sodium_per_serving: null, caffeine_per_serving: null,
        sat_fat_per_serving: null, serving_size: 250, serving_unit: 'ml',
        created_at: new Date().toISOString()
      }])
    }]);
    var items = await FLD.getLibrary('u1');
    assert.strictEqual(items[0].satFatPerServing, null);
  });

  // ── rowToTargets satFatPct via getTargets mock ────────────────────────────────

  console.log('\nrowToTargets satFatPct mapping');

  await test('rowToTargets maps sat_fat_pct from DB row', async function () {
    mockFetch([{
      status: 200,
      body: JSON.stringify([{
        user_id: 'u1', calories_target: 2000, protein_target: 150,
        carbs_target: 250, fat_target: 70, fiber_target: 25,
        sodium_target: 2300, sat_fat_pct: 6, updated_at: new Date().toISOString()
      }])
    }]);
    var targets = await FLD.getTargets('u1');
    assert.strictEqual(targets.satFatPct, 6);
  });

  await test('rowToTargets maps sat_fat_pct null as null', async function () {
    mockFetch([{
      status: 200,
      body: JSON.stringify([{
        user_id: 'u1', calories_target: 2000, protein_target: null,
        carbs_target: null, fat_target: null, fiber_target: null,
        sodium_target: null, sat_fat_pct: null, updated_at: new Date().toISOString()
      }])
    }]);
    var targets = await FLD.getTargets('u1');
    assert.strictEqual(targets.satFatPct, null);
  });

  // ── scaleComponentMacros satFat ───────────────────────────────────────────────

  console.log('\nscaleComponentMacros satFat');

  await test('scaleComponentMacros scales satFatPerServing correctly', async function () {
    var item = {
      servingSize: 100,
      satFatPerServing: 10,
      proteinPerServing: 0, carbsPerServing: 0, fatPerServing: 0,
      caloriesPerServing: 0, fiberPerServing: null, sodiumPerServing: null
    };
    var scaled = FLD.scaleComponentMacros(item, 50);
    assert.strictEqual(scaled.satFat, 5);
  });

  await test('scaleComponentMacros returns null satFat when satFatPerServing is null', async function () {
    var item = {
      servingSize: 100,
      satFatPerServing: null,
      proteinPerServing: 0, carbsPerServing: 0, fatPerServing: 0,
      caloriesPerServing: 0, fiberPerServing: null, sodiumPerServing: null
    };
    var scaled = FLD.scaleComponentMacros(item, 50);
    assert.strictEqual(scaled.satFat, null);
  });

  // ── Summary ───────────────────────────────────────────────────────────────────

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) process.exit(1);
}

run().catch(function (e) { console.error('Test runner error:', e); process.exit(1); });
