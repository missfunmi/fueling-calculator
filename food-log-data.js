// food-log-data.js
(function () {
  'use strict';

  var SUPABASE_URL      = 'https://jcrmkxlzqewwqugkwlww.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_VArDAA7V8Gg-Xi20vj7zkw_NiidAk_Q';

  async function req(method, path, body, prefer) {
    var defaultPrefer = method === 'POST' ? 'return=representation' : '';
    var preferValue   = prefer !== undefined ? prefer : defaultPrefer;
    var headers = { 'apikey': SUPABASE_ANON_KEY };
    if (body)         headers['Content-Type'] = 'application/json';
    if (preferValue)  headers['Prefer'] = preferValue;
    var res = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
      method: method, headers: headers,
      body: body ? JSON.stringify(body) : undefined
    });
    var text = await res.text();
    if (!res.ok) throw new Error(res.status + ' ' + (text || res.statusText));
    if (res.status === 204 || !text) return null;
    return JSON.parse(text);
  }

  // ── Log entries ─────────────────────────────────────────────────────────────

  function rowToLog(r) {
    return {
      id: r.id, userId: r.user_id, loggedAt: r.logged_at,
      name: r.name, category: r.category || '',
      freeformInput: r.freeform_input || null,
      protein: r.protein, carbs: r.carbs, fat: r.fat, calories: r.calories,
      fiber: r.fiber, sodium: r.sodium,
      libraryItemId: r.library_item_id || null,
      servingMultiplier: r.serving_multiplier || 1,
      aiEstimated: r.ai_estimated || false,
      aiNotes: r.ai_notes || null,
      createdAt: r.created_at
    };
  }

  async function getLogs(userId, date) {
    // date: 'YYYY-MM-DD'
    var from = date + 'T00:00:00.000Z';
    var to   = date + 'T23:59:59.999Z';
    var rows = await req('GET',
      'food_logs?user_id=eq.' + encodeURIComponent(userId) +
      '&logged_at=gte.' + encodeURIComponent(from) +
      '&logged_at=lte.' + encodeURIComponent(to) +
      '&order=logged_at.desc'
    );
    return (rows || []).map(rowToLog);
  }

  async function saveLog(userId, entry) {
    var rows = await req('POST', 'food_logs', {
      user_id:           userId,
      logged_at:         entry.loggedAt || new Date().toISOString(),
      name:              entry.name,
      category:          entry.category || null,
      freeform_input:    entry.freeformInput || null,
      protein:           entry.protein || 0,
      carbs:             entry.carbs   || 0,
      fat:               entry.fat     || 0,
      calories:          entry.calories || 0,
      fiber:             entry.fiber   != null ? entry.fiber  : null,
      sodium:            entry.sodium  != null ? entry.sodium : null,
      library_item_id:   entry.libraryItemId   || null,
      serving_multiplier: entry.servingMultiplier || 1.0,
      ai_estimated:      entry.aiEstimated || false,
      ai_notes:          entry.aiNotes || null
    });
    if (!rows || !rows[0]) throw new Error('saveLog: no row returned');
    return rowToLog(rows[0]);
  }

  async function updateLog(userId, id, fields) {
    var body = {};
    if (fields.name      !== undefined) body.name      = fields.name;
    if (fields.category  !== undefined) body.category  = fields.category;
    if (fields.loggedAt  !== undefined) body.logged_at = fields.loggedAt;
    if (fields.protein   !== undefined) body.protein   = fields.protein;
    if (fields.carbs     !== undefined) body.carbs     = fields.carbs;
    if (fields.fat       !== undefined) body.fat       = fields.fat;
    if (fields.calories  !== undefined) body.calories  = fields.calories;
    if (fields.fiber     !== undefined) body.fiber     = fields.fiber;
    if (fields.sodium    !== undefined) body.sodium    = fields.sodium;
    if (fields.aiNotes   !== undefined) body.ai_notes  = fields.aiNotes;
    if (fields.aiEstimated !== undefined) body.ai_estimated = fields.aiEstimated;
    var rows = await req('PATCH',
      'food_logs?id=eq.' + encodeURIComponent(id) + '&user_id=eq.' + encodeURIComponent(userId),
      body, 'return=representation'
    );
    if (!rows || !rows[0]) throw new Error('updateLog: no row returned');
    return rowToLog(rows[0]);
  }

  async function deleteLog(userId, id) {
    await req('DELETE',
      'food_logs?id=eq.' + encodeURIComponent(id) + '&user_id=eq.' + encodeURIComponent(userId)
    );
  }

  // ── Food library ─────────────────────────────────────────────────────────────

  function rowToItem(r) {
    return {
      id: r.id, userId: r.user_id, name: r.name, category: r.category || '',
      proteinPerServing: r.protein_per_serving,
      carbsPerServing:   r.carbs_per_serving,
      fatPerServing:     r.fat_per_serving,
      caloriesPerServing: r.calories_per_serving,
      fiberPerServing:   r.fiber_per_serving,
      sodiumPerServing:  r.sodium_per_serving,
      servingUnit:       r.serving_unit || null,
      createdAt:         r.created_at
    };
  }

  async function getLibrary(userId) {
    var rows = await req('GET',
      'food_library?user_id=eq.' + encodeURIComponent(userId) + '&order=name.asc'
    );
    return (rows || []).map(rowToItem);
  }

  async function saveLibraryItem(userId, item) {
    var rows = await req('POST', 'food_library', {
      user_id:             userId,
      name:                item.name,
      category:            item.category || null,
      protein_per_serving: item.proteinPerServing || 0,
      carbs_per_serving:   item.carbsPerServing   || 0,
      fat_per_serving:     item.fatPerServing      || 0,
      calories_per_serving: item.caloriesPerServing || 0,
      fiber_per_serving:   item.fiberPerServing  != null ? item.fiberPerServing  : null,
      sodium_per_serving:  item.sodiumPerServing != null ? item.sodiumPerServing : null,
      serving_unit:        item.servingUnit || null
    });
    if (!rows || !rows[0]) throw new Error('saveLibraryItem: no row returned');
    return rowToItem(rows[0]);
  }

  async function updateLibraryItem(userId, id, fields) {
    var body = {};
    if (fields.name               !== undefined) body.name                = fields.name;
    if (fields.category           !== undefined) body.category            = fields.category;
    if (fields.proteinPerServing  !== undefined) body.protein_per_serving = fields.proteinPerServing;
    if (fields.carbsPerServing    !== undefined) body.carbs_per_serving   = fields.carbsPerServing;
    if (fields.fatPerServing      !== undefined) body.fat_per_serving     = fields.fatPerServing;
    if (fields.caloriesPerServing !== undefined) body.calories_per_serving = fields.caloriesPerServing;
    if (fields.fiberPerServing    !== undefined) body.fiber_per_serving   = fields.fiberPerServing;
    if (fields.sodiumPerServing   !== undefined) body.sodium_per_serving  = fields.sodiumPerServing;
    if (fields.servingUnit        !== undefined) body.serving_unit        = fields.servingUnit;
    var rows = await req('PATCH',
      'food_library?id=eq.' + encodeURIComponent(id) + '&user_id=eq.' + encodeURIComponent(userId),
      body, 'return=representation'
    );
    if (!rows || !rows[0]) throw new Error('updateLibraryItem: no row returned');
    return rowToItem(rows[0]);
  }

  async function deleteLibraryItem(userId, id) {
    await req('DELETE',
      'food_library?id=eq.' + encodeURIComponent(id) + '&user_id=eq.' + encodeURIComponent(userId)
    );
  }

  // ── Daily targets ────────────────────────────────────────────────────────────

  function rowToTargets(r) {
    return {
      userId:          r.user_id,
      caloriesTarget:  r.calories_target,
      proteinTarget:   r.protein_target,
      carbsTarget:     r.carbs_target,
      fatTarget:       r.fat_target,
      fiberTarget:     r.fiber_target,
      sodiumTarget:    r.sodium_target,
      updatedAt:       r.updated_at
    };
  }

  async function getTargets(userId) {
    var rows = await req('GET', 'daily_targets?user_id=eq.' + encodeURIComponent(userId));
    return rows && rows.length ? rowToTargets(rows[0]) : null;
  }

  async function saveTargets(userId, targets) {
    var rows = await req('POST', 'daily_targets', {
      user_id:         userId,
      calories_target: targets.caloriesTarget != null ? targets.caloriesTarget : null,
      protein_target:  targets.proteinTarget  != null ? targets.proteinTarget  : null,
      carbs_target:    targets.carbsTarget    != null ? targets.carbsTarget    : null,
      fat_target:      targets.fatTarget      != null ? targets.fatTarget      : null,
      fiber_target:    targets.fiberTarget    != null ? targets.fiberTarget    : null,
      sodium_target:   targets.sodiumTarget   != null ? targets.sodiumTarget   : null,
      updated_at:      new Date().toISOString()
    }, 'return=representation,resolution=merge-duplicates');
    if (!rows || !rows[0]) throw new Error('saveTargets: no row returned');
    return rowToTargets(rows[0]);
  }

  // ── AI parsing ───────────────────────────────────────────────────────────────

  async function parseMeal(input, library) {
    var res = await fetch(SUPABASE_URL + '/functions/v1/parse-meal', {
      method: 'POST',
      headers: {
        'apikey':        SUPABASE_ANON_KEY,
        'Content-Type':  'application/json'
      },
      body: JSON.stringify({ input: input, library: library || [] })
    });
    var data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'Parse failed');
    return data;
  }

  // ── Exports ──────────────────────────────────────────────────────────────────

  window.FoodLogData = {
    getLogs: getLogs, saveLog: saveLog, updateLog: updateLog, deleteLog: deleteLog,
    getLibrary: getLibrary, saveLibraryItem: saveLibraryItem,
    updateLibraryItem: updateLibraryItem, deleteLibraryItem: deleteLibraryItem,
    getTargets: getTargets, saveTargets: saveTargets,
    parseMeal: parseMeal
  };
})();
