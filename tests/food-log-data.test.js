// tests/food-log-data.test.js
// Run: node tests/food-log-data.test.js
// Requires: DB tables from migration 0005 to exist.
// Creates and cleans up its own rows — safe to run against the real DB.

const SUPABASE_URL      = 'https://jcrmkxlzqewwqugkwlww.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_VArDAA7V8Gg-Xi20vj7zkw_NiidAk_Q';

// Inline the fetch helper so we can test the DB layer directly without a browser.
async function req(method, path, body, prefer) {
  const defaultPrefer = method === 'POST' ? 'return=representation' : '';
  const preferValue   = prefer !== undefined ? prefer : defaultPrefer;
  const headers = { 'apikey': SUPABASE_ANON_KEY };
  if (body)        headers['Content-Type'] = 'application/json';
  if (preferValue) headers['Prefer'] = preferValue;
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    method, headers, body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  if (!res.ok) throw new Error(res.status + ' ' + (text || res.statusText));
  if (res.status === 204 || !text) return null;
  return JSON.parse(text);
}

const TEST_USER = '00000000-0000-0000-0000-000000000099'; // sentinel test user id

async function cleanup() {
  await req('DELETE', 'food_logs?user_id=eq.' + TEST_USER);
  await req('DELETE', 'food_library?user_id=eq.' + TEST_USER);
  await req('DELETE', 'daily_targets?user_id=eq.' + TEST_USER);
}

let passed = 0, failed = 0;
function assert(label, condition) {
  if (condition) { console.log('  PASS', label); passed++; }
  else { console.error('  FAIL', label); failed++; }
}

async function run() {
  await cleanup();
  console.log('\n── food_library ────────────────────────────────────');

  // Save a library item
  const [saved] = await req('POST', 'food_library', {
    user_id: TEST_USER, name: 'Test Shake',
    protein_per_serving: 25, carbs_per_serving: 10,
    fat_per_serving: 3, calories_per_serving: 167,
    fiber_per_serving: null, sodium_per_serving: null, serving_unit: 'scoop'
  });
  assert('save library item returns a row',  saved && saved.id);
  assert('name is correct',                  saved.name === 'Test Shake');
  assert('calories correct',                 saved.calories_per_serving === 167);

  // List library — should contain the saved item
  const library = await req('GET', 'food_library?user_id=eq.' + TEST_USER + '&order=name.asc');
  assert('getLibrary returns 1 item',        library.length === 1);

  // Update
  await req('PATCH', 'food_library?id=eq.' + saved.id + '&user_id=eq.' + TEST_USER,
    { name: 'Updated Shake' }, 'return=representation');
  const [updated] = await req('GET', 'food_library?id=eq.' + saved.id);
  assert('updateLibraryItem renames',        updated.name === 'Updated Shake');

  console.log('\n── food_logs ───────────────────────────────────────');

  const today = new Date().toISOString().slice(0, 10);
  const [log] = await req('POST', 'food_logs', {
    user_id: TEST_USER, logged_at: new Date().toISOString(),
    name: 'Scrambled eggs', category: 'Breakfast',
    protein: 18, carbs: 2, fat: 14, calories: 210,
    fiber: null, sodium: 340, ai_estimated: false
  });
  assert('save log returns row',             log && log.id);
  assert('log name correct',                 log.name === 'Scrambled eggs');
  assert('sodium stored',                    log.sodium === 340);

  const from = today + 'T00:00:00.000Z';
  const to   = today + 'T23:59:59.999Z';
  const logs = await req('GET',
    'food_logs?user_id=eq.' + TEST_USER +
    '&logged_at=gte.' + encodeURIComponent(from) +
    '&logged_at=lte.' + encodeURIComponent(to) +
    '&order=logged_at.desc'
  );
  assert('getLogs returns today\'s entries', logs.length === 1);

  // Update
  await req('PATCH', 'food_logs?id=eq.' + log.id + '&user_id=eq.' + TEST_USER,
    { calories: 220 }, 'return=representation');
  const [updatedLog] = await req('GET', 'food_logs?id=eq.' + log.id);
  assert('updateLog updates calories',       updatedLog.calories === 220);

  // Delete
  await req('DELETE', 'food_logs?id=eq.' + log.id + '&user_id=eq.' + TEST_USER);
  const after = await req('GET', 'food_logs?id=eq.' + log.id);
  assert('deleteLog removes entry',          after.length === 0);

  console.log('\n── daily_targets ───────────────────────────────────');

  // Upsert targets
  const [targets] = await req('POST', 'daily_targets', {
    user_id: TEST_USER, calories_target: 2200, protein_target: 180,
    carbs_target: 270, fat_target: 70, fiber_target: 30, sodium_target: null,
    updated_at: new Date().toISOString()
  }, 'return=representation,resolution=merge-duplicates');
  assert('saveTargets returns row',          targets && targets.user_id === TEST_USER);
  assert('calories_target stored',           targets.calories_target === 2200);
  assert('sodium_target is null',            targets.sodium_target === null);

  // Re-upsert to update
  await req('POST', 'daily_targets', {
    user_id: TEST_USER, calories_target: 2400, protein_target: 180,
    carbs_target: 270, fat_target: 70, fiber_target: 30, sodium_target: null,
    updated_at: new Date().toISOString()
  }, 'return=representation,resolution=merge-duplicates');
  const [reread] = await req('GET', 'daily_targets?user_id=eq.' + TEST_USER);
  assert('saveTargets upserts (updates)',    reread.calories_target === 2400);

  await cleanup();
  console.log('\n────────────────────────────────────────────────────');
  console.log(passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
}

run().catch(e => { console.error(e); process.exit(1); });
