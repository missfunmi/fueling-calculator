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

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) process.exit(1);
}

run().catch(function (e) { console.error(e); process.exit(1); });
