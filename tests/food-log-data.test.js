// tests/food-log-data.test.js
'use strict';

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
function mockFetch(responses) { _fetchResponses = responses.slice(); }

require('../food-log-data.js');
var FLD = global.window.FoodLogData;

var assert = require('assert');
var passed = 0, failed = 0;

async function test(name, fn) {
  _fetchResponses = [];
  try {
    await fn();
    console.log('  ✓ ' + name);
    passed++;
  } catch (e) {
    console.error('  ✗ ' + name + ': ' + e.message);
    failed++;
  }
}

async function run() {

  console.log('\nrowToItem — brand and servingSize');

  await test('rowToItem maps brand and serving_size', async function () {
    mockFetch([{ status: 200, body: JSON.stringify([{
      id: 'abc', user_id: 'u1', name: 'Granola', brand: 'Cascadian Farm',
      category: 'grains', protein_per_serving: 5, carbs_per_serving: 36,
      fat_per_serving: 18, calories_per_serving: 330, fiber_per_serving: 4,
      sodium_per_serving: 85, serving_size: 63, serving_unit: null, created_at: '2026-01-01'
    }]) }]);
    var items = await FLD.getLibrary('u1');
    assert.strictEqual(items[0].brand, 'Cascadian Farm');
    assert.strictEqual(items[0].servingSize, 63);
  });

  await test('rowToItem sets brand null when absent', async function () {
    mockFetch([{ status: 200, body: JSON.stringify([{
      id: 'abc', user_id: 'u1', name: 'Almonds', brand: null,
      category: null, protein_per_serving: 6, carbs_per_serving: 6,
      fat_per_serving: 14, calories_per_serving: 170, fiber_per_serving: null,
      sodium_per_serving: null, serving_size: null, serving_unit: null, created_at: '2026-01-01'
    }]) }]);
    var items = await FLD.getLibrary('u1');
    assert.strictEqual(items[0].brand, null);
    assert.strictEqual(items[0].servingSize, null);
  });

  console.log('\nscaleComponentMacros');

  await test('scales macros proportionally', function () {
    var item = {
      proteinPerServing: 16, carbsPerServing: 6, fatPerServing: 0,
      caloriesPerServing: 90, fiberPerServing: null, sodiumPerServing: 65,
      servingSize: 170
    };
    // 190g / 170g = 1.1176…
    var result = FLD.scaleComponentMacros(item, 190);
    assert.strictEqual(result.protein,  Math.round(16  * (190/170) * 10) / 10);
    assert.strictEqual(result.carbs,    Math.round(6   * (190/170) * 10) / 10);
    assert.strictEqual(result.calories, Math.round(90  * (190/170) * 10) / 10);
    assert.strictEqual(result.fiber,    null);
    assert.strictEqual(result.sodium,   Math.round(65  * (190/170) * 10) / 10);
  });

  await test('scaleComponentMacros with servingSize null uses amount as-is (ratio 1)', function () {
    var item = {
      proteinPerServing: 10, carbsPerServing: 20, fatPerServing: 5,
      caloriesPerServing: 150, fiberPerServing: 2, sodiumPerServing: null,
      servingSize: null
    };
    var result = FLD.scaleComponentMacros(item, 100);
    assert.strictEqual(result.protein,  10);
    assert.strictEqual(result.carbs,    20);
    assert.strictEqual(result.calories, 150);
    assert.strictEqual(result.fiber,    2);
    assert.strictEqual(result.sodium,   null);
  });

  console.log('\nrowToLog — components');

  await test('rowToLog maps components when present', async function () {
    var fakeComponents = [
      { library_item_id: 'lib-1', name: 'Chobani yogurt', amount_g: 190,
        protein: 17.9, carbs: 6.7, fat: 0, calories: 100.6, fiber: null, sodium: 72.6 }
    ];
    mockFetch([{ status: 200, body: JSON.stringify([{
      id: 'log-1', user_id: 'u1', logged_at: '2026-09-16T07:42:00Z',
      name: 'Yogurt bowl', category: 'Breakfast',
      freeform_input: null, protein: 17.9, carbs: 6.7, fat: 0, calories: 100.6,
      fiber: null, sodium: 72.6, library_item_id: null, serving_multiplier: 1,
      ai_estimated: false, ai_notes: null, created_at: '2026-09-16T07:42:00Z',
      components: fakeComponents
    }]) }]);
    var logs = await FLD.getLogs('u1', '2026-09-16');
    assert.deepStrictEqual(logs[0].components, fakeComponents);
  });

  await test('rowToLog sets components null when absent', async function () {
    mockFetch([{ status: 200, body: JSON.stringify([{
      id: 'log-2', user_id: 'u1', logged_at: '2026-09-16T12:00:00Z',
      name: 'Lunch', category: 'Lunch', freeform_input: null,
      protein: 30, carbs: 45, fat: 10, calories: 380,
      fiber: null, sodium: null, library_item_id: null, serving_multiplier: 1,
      ai_estimated: false, ai_notes: null, created_at: '2026-09-16T12:00:00Z',
      components: null
    }]) }]);
    var logs = await FLD.getLogs('u1', '2026-09-16');
    assert.strictEqual(logs[0].components, null);
  });

  console.log('\nsaveLibraryItem — CRUD round-trip');

  await test('saveLibraryItem posts correct columns and returns mapped item', async function () {
    var returnedRow = {
      id: 'new-id', user_id: 'u1', name: 'Granola', brand: 'Nature Valley',
      category: 'breakfast', protein_per_serving: 5, carbs_per_serving: 36,
      fat_per_serving: 18, calories_per_serving: 330, fiber_per_serving: 4,
      sodium_per_serving: 85, serving_size: 63, serving_unit: null, created_at: '2026-01-01'
    };
    var capturedBody;
    var _origFetch = global.fetch;
    global.fetch = async function (url, opts) {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, status: 201, text: async function () { return JSON.stringify([returnedRow]); } };
    };
    var result = await FLD.saveLibraryItem('u1', {
      name: 'Granola', category: 'breakfast', brand: 'Nature Valley',
      proteinPerServing: 5, carbsPerServing: 36, fatPerServing: 18,
      caloriesPerServing: 330, fiberPerServing: 4, sodiumPerServing: 85,
      servingSize: 63, servingUnit: null
    });
    global.fetch = _origFetch;
    assert.strictEqual(capturedBody.name,                  'Granola');
    assert.strictEqual(capturedBody.brand,                 'Nature Valley');
    assert.strictEqual(capturedBody.serving_size,          63);
    assert.strictEqual(capturedBody.protein_per_serving,   5);
    assert.strictEqual(capturedBody.calories_per_serving,  330);
    assert.strictEqual(result.name,        'Granola');
    assert.strictEqual(result.brand,       'Nature Valley');
    assert.strictEqual(result.servingSize, 63);
  });

  await test('updateLibraryItem patches correct snake_case columns', async function () {
    var returnedRow = {
      id: 'item-1', user_id: 'u1', name: 'Granola Bar', brand: 'Clif',
      category: 'snack', protein_per_serving: 10, carbs_per_serving: 45,
      fat_per_serving: 6, calories_per_serving: 250, fiber_per_serving: 4,
      sodium_per_serving: 200, serving_size: 68, serving_unit: null, created_at: '2026-01-01'
    };
    var capturedBody;
    var _origFetch = global.fetch;
    global.fetch = async function (url, opts) {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, status: 200, text: async function () { return JSON.stringify([returnedRow]); } };
    };
    var result = await FLD.updateLibraryItem('u1', 'item-1', {
      name: 'Granola Bar', brand: 'Clif', servingSize: 68,
      caloriesPerServing: 250, proteinPerServing: 10
    });
    global.fetch = _origFetch;
    assert.strictEqual(capturedBody.name,                 'Granola Bar');
    assert.strictEqual(capturedBody.brand,                'Clif');
    assert.strictEqual(capturedBody.serving_size,         68);
    assert.strictEqual(capturedBody.calories_per_serving, 250);
    assert.strictEqual(capturedBody.protein_per_serving,  10);
    assert.strictEqual(result.name,        'Granola Bar');
    assert.strictEqual(result.servingSize, 68);
  });

  console.log('\nsaveLog — CRUD round-trip');

  await test('saveLog posts correct columns including components and returns mapped log', async function () {
    var fakeComponents = [
      { library_item_id: 'lib-1', name: 'Yogurt', amount_g: 190,
        protein: 17.9, carbs: 6.7, fat: 0, calories: 100.6, fiber: null, sodium: null }
    ];
    var returnedRow = {
      id: 'log-new', user_id: 'u1', logged_at: '2026-09-16T07:00:00Z',
      name: 'Yogurt bowl', category: 'Breakfast', freeform_input: null,
      protein: 17.9, carbs: 6.7, fat: 0, calories: 100.6,
      fiber: null, sodium: null, library_item_id: null, serving_multiplier: 1,
      ai_estimated: false, ai_notes: null, created_at: '2026-09-16T07:00:00Z',
      components: fakeComponents
    };
    var capturedBody;
    var _origFetch = global.fetch;
    global.fetch = async function (url, opts) {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, status: 201, text: async function () { return JSON.stringify([returnedRow]); } };
    };
    var result = await FLD.saveLog('u1', {
      name: 'Yogurt bowl', category: 'Breakfast',
      loggedAt: '2026-09-16T07:00:00Z',
      protein: 17.9, carbs: 6.7, fat: 0, calories: 100.6,
      fiber: null, sodium: null, components: fakeComponents
    });
    global.fetch = _origFetch;
    assert.strictEqual(capturedBody.name,     'Yogurt bowl');
    assert.strictEqual(capturedBody.protein,  17.9);
    assert.deepStrictEqual(capturedBody.components, fakeComponents);
    assert.strictEqual(result.name, 'Yogurt bowl');
    assert.deepStrictEqual(result.components, fakeComponents);
  });

  await test('updateLog patches correct snake_case columns', async function () {
    var returnedRow = {
      id: 'log-1', user_id: 'u1', logged_at: '2026-09-16T07:00:00Z',
      name: 'Updated Meal', category: 'Lunch', freeform_input: null,
      protein: 30, carbs: 45, fat: 10, calories: 390,
      fiber: null, sodium: null, library_item_id: null, serving_multiplier: 1,
      ai_estimated: false, ai_notes: null, created_at: '2026-09-16T07:00:00Z',
      components: null
    };
    var capturedBody;
    var _origFetch = global.fetch;
    global.fetch = async function (url, opts) {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, status: 200, text: async function () { return JSON.stringify([returnedRow]); } };
    };
    var result = await FLD.updateLog('u1', 'log-1', {
      name: 'Updated Meal', protein: 30, carbs: 45, fat: 10, calories: 390,
      components: null
    });
    global.fetch = _origFetch;
    assert.strictEqual(capturedBody.name,       'Updated Meal');
    assert.strictEqual(capturedBody.protein,    30);
    assert.strictEqual(capturedBody.calories,   390);
    assert.strictEqual(capturedBody.components, null);
    assert.strictEqual(result.name,     'Updated Meal');
    assert.strictEqual(result.calories, 390);
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) process.exit(1);
}

run().catch(function (e) { console.error(e); process.exit(1); });
