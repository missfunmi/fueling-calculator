# Anonymous-First Identity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the name+passphrase setup-first flow with anonymous-first identity — UUID on first click, optional recovery phrase claim later via a subtle dismissable indicator in the events header.

**Architecture:** `data.js` gains `getUserId()` (dynamic localStorage read replacing module-level constant), a phrase wordlist, and claim/lookup functions; `index.html` gains a second landing button, a claim indicator element in the events header, and two new full-screen views; `app.js` gains rewritten `init()` plus claim/recovery screen handlers; CSS gets matching styles. Supabase gets a new `claims` table and loses the `display_name` column from `users`. `view-setup` and `deriveUserId` are removed entirely.

**Tech Stack:** Vanilla JS/HTML/CSS, Supabase (PostgREST + anon key), Web Crypto API (`crypto.randomUUID`, `crypto.getRandomValues`, `crypto.subtle.digest`), Netlify.

---

## File Map

| File | What changes |
|---|---|
| `data.js` | `getUserId()` replaces module-level `USER_ID`; KEYS gains `isAnonymous`, loses `displayName`; new `generatePhrase`, `hashPhrase`, `saveClaim`, `lookupClaim` + wordlist; `saveUser` simplified (id only); `deriveUserId` removed; all `USER_ID` call sites updated |
| `tests/data.test.js` | Remove `deriveUserId` + old `saveUser` tests; add `crypto.getRandomValues` to mock; add `getUserId`, `generatePhrase`, `hashPhrase`, `saveClaim`, `lookupClaim`, updated `saveUser` tests |
| `index.html` | Remove `view-setup`; landing gets second button; `view-events` header gets claim indicator; add `view-claim`, `view-recovery` |
| `style.css` | Remove setup-only styles; add `btn-secondary`, claim indicator, claim phrase, recovery error styles |
| `app.js` | Rewrite `init()`; update `navigate()` hideTabBar list; add `_indicatorDismissed`/`_currentPhrase` module vars; add `renders.claim`; add indicator/claim/recovery handlers |
| Supabase | `CREATE TABLE claims` + RLS policy; `ALTER TABLE users DROP COLUMN display_name`; owner migration |

---

### Task 1: data.js + tests — getUserId(), new identity functions, KEYS update

**Files:**
- Modify: `data.js`
- Modify: `tests/data.test.js`

- [ ] **Step 1: Add `crypto.getRandomValues` to the test mock**

In `tests/data.test.js`, replace the existing `crypto` mock (the `Object.defineProperty(global, 'crypto', ...)` block, lines 19–29) with:

```js
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
```

- [ ] **Step 2: Replace the entire "Identity" section in the test file with updated tests**

Locate the `// ── Identity` section (starting at the `console.log('\nIdentity')` line, ending with the last `saveUser` test before `// ── Summary`). Replace everything in that section with:

```js
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
```

- [ ] **Step 3: Run tests and verify the new Identity tests fail**

```bash
cd /Users/funmi/Development/projects/fueling-calculator && node tests/data.test.js
```

Expected: the new `getUserId`, `generatePhrase`, `hashPhrase`, `saveClaim`, `lookupClaim` tests fail (functions don't exist yet). All tests before the Identity section pass.

- [ ] **Step 4: Replace data.js with the updated version**

Write the complete new `data.js`. Key changes from the current file:
- `KEYS`: `displayName` → `isAnonymous: 'fuelPlanner.isAnonymous'`
- `var USER_ID = ...` → `function getUserId() { return localStorage.getItem(KEYS.userId); }`
- All `USER_ID` references replaced with `getUserId()` calls (in `productToDb`, `eventToDb`, `getProducts`, `getEvents`, `getEvent`, `migrateIfNeeded`)
- New wordlist constant `WORDLIST` (256 BIP-39 words)
- New functions: `generatePhrase`, `hashPhrase`, `saveClaim`, `lookupClaim`
- `saveUser(id, displayName)` → `saveUser(id)` — body sends only `{ id: id }`
- `deriveUserId` removed entirely
- Exports updated: add `getUserId`, `generatePhrase`, `hashPhrase`, `saveClaim`, `lookupClaim`; remove `deriveUserId`

Full replacement content:

```js
// data.js
(function (exports) {
  'use strict';

  // ── Config ───────────────────────────────────────────────────────────────────
  var SUPABASE_URL      = 'https://jcrmkxlzqewwqugkwlww.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_VArDAA7V8Gg-Xi20vj7zkw_NiidAk_Q';

  var KEYS = {
    recent:      'fuelPlanner.recentProducts',
    migrated:    'fuelPlanner.migrated',
    userId:      'fuelPlanner.userId',
    isAnonymous: 'fuelPlanner.isAnonymous'
  };

  // ── Identity ─────────────────────────────────────────────────────────────────

  // Reads userId dynamically on each call — no module-level constant needed.
  // This means UUID changes (claim, recovery) take effect immediately.
  function getUserId() {
    return localStorage.getItem(KEYS.userId);
  }

  // 256-word BIP-39 English subset. 256^4 ≈ 4.3 billion combinations.
  var WORDLIST = [
    'abandon','ability','able','about','above','absent','absorb','abstract',
    'absurd','abuse','access','accident','account','accuse','achieve','acid',
    'acoustic','acquire','across','act','action','actor','actress','actual',
    'adapt','add','addict','address','adjust','admit','adult','advance',
    'advice','aerobic','afford','afraid','again','age','agent','agree',
    'ahead','aim','air','airport','aisle','alarm','album','alcohol',
    'alert','alien','all','alley','allow','almost','alone','alpha',
    'already','also','alter','always','amateur','amazing','among','amount',
    'amused','analyst','anchor','ancient','anger','angle','angry','animal',
    'ankle','announce','annual','another','answer','antenna','antique','anxiety',
    'any','apart','apology','appear','apple','approve','april','arch',
    'arctic','area','arena','argue','arm','armed','armor','army',
    'around','arrange','arrest','arrive','arrow','art','artefact','artist',
    'artwork','ask','aspect','assault','asset','assist','assume','asthma',
    'athlete','atom','attack','attend','attitude','attract','auction','audit',
    'august','aunt','author','auto','autumn','average','avocado','award',
    'awesome','awful','awkward','axle','baby','badge','bag','balance',
    'balcony','ball','bamboo','banana','banner','bar','barely','bargain',
    'barrel','base','basic','basket','battle','beach','beauty','because',
    'become','beef','before','begin','behave','behind','believe','below',
    'belt','bench','benefit','best','betray','better','between','beyond',
    'bicycle','bid','bike','bind','biology','bird','birth','bitter',
    'black','blade','blame','blanket','blast','bleak','bless','blind',
    'blood','blossom','blouse','blue','blur','blush','board','boat',
    'body','boil','bomb','bone','book','boost','border','boring',
    'borrow','boss','bottom','bounce','box','boy','bracket','brain',
    'brand','brave','bread','breeze','brick','bridge','brief','bright',
    'bring','brisk','broccoli','broken','bronze','broom','brother','brown',
    'brush','bubble','buddy','budget','buffalo','build','bulb','bulk',
    'bullet','bundle','bunker','burden','burger','burst','bus','business',
    'busy','butter','buyer','buzz','cabin','cable','cage','cake',
    'call','calm','camera','camp','canal','cancel','candy','cannon'
  ];

  // Picks 4 words from WORDLIST using cryptographically secure random values.
  // Returns a space-separated string e.g. "maple river sunset bottle"
  function generatePhrase() {
    var indices = new Uint32Array(4);
    crypto.getRandomValues(indices);
    return Array.from(indices).map(function (n) {
      return WORDLIST[n % WORDLIST.length];
    }).join(' ');
  }

  // Returns sha256(phrase.trim().toLowerCase()) as a 64-char hex string.
  async function hashPhrase(phrase) {
    var normalized = phrase.trim().toLowerCase();
    var encoded = new TextEncoder().encode(normalized);
    var hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
    return Array.from(new Uint8Array(hashBuffer))
      .map(function (b) { return b.toString(16).padStart(2, '0'); })
      .join('');
  }

  // Saves phrase_hash → user_id in the claims table.
  // The raw phrase is never sent to the server.
  async function saveClaim(phraseHash) {
    await supabaseRequest(
      'POST',
      'claims?on_conflict=phrase_hash',
      { phrase_hash: phraseHash, user_id: getUserId() },
      'return=minimal,resolution=merge-duplicates'
    );
  }

  // Looks up a phrase_hash in claims. Returns the UUID string if found, null if not.
  async function lookupClaim(phraseHash) {
    var rows = await supabaseRequest(
      'GET',
      'claims?phrase_hash=eq.' + phraseHash + '&select=user_id'
    );
    return (rows && rows.length) ? rows[0].user_id : null;
  }

  // ── Supabase fetch helper ────────────────────────────────────────────────────
  async function supabaseRequest(method, path, body, prefer) {
    var defaultPrefer = method === 'POST' ? 'return=representation' : '';
    var preferValue = prefer !== undefined ? prefer : defaultPrefer;
    var headers = { 'apikey': SUPABASE_ANON_KEY };
    if (body) headers['Content-Type'] = 'application/json';
    if (preferValue) headers['Prefer'] = preferValue;
    var res = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
      method:  method,
      headers: headers,
      body:    body ? JSON.stringify(body) : undefined
    });
    var text = await res.text();
    if (!res.ok) throw new Error(res.status + ' ' + (text || res.statusText));
    if (res.status === 204 || !text) return null;
    return JSON.parse(text);
  }

  // ── Normalisation ────────────────────────────────────────────────────────────

  function dbToProduct(row) {
    return {
      id:              row.id,
      brand:           row.brand || '',
      name:            row.name,
      type:            row.type,
      carbsPerUnit:    row.carbs_per_unit    || 0,
      sodiumPerUnit:   row.sodium_per_unit   || 0,
      caffeinePerUnit: row.caffeine_per_unit || 0
    };
  }

  function productToDb(p) {
    return {
      id:                p.id,
      user_id:           getUserId(),
      brand:             p.brand || null,
      name:              p.name,
      type:              p.type,
      carbs_per_unit:    p.carbsPerUnit    || 0,
      sodium_per_unit:   p.sodiumPerUnit   || 0,
      caffeine_per_unit: p.caffeinePerUnit || 0
    };
  }

  function dbToEvent(row) {
    return {
      id:             row.id,
      name:           row.name,
      date:           row.date || '',
      type:           row.type || 'other',
      notes:          row.notes || '',
      postEventNotes: row.post_event_notes || '',
      actuals:        row.actuals || {},
      segments: (row.segments || [])
        .slice()
        .sort(function (a, b) { return a.sort_order - b.sort_order; })
        .map(function (seg) {
          return {
            id:            seg.id,
            name:          seg.name,
            durationHours: seg.duration_hours,
            targets: {
              carbsPerHour:    seg.carbs_per_hour    || 0,
              sodiumPerHour:   seg.sodium_per_hour   || 0,
              caffeinePerHour: seg.caffeine_per_hour || 0
            },
            items: (seg.items || [])
              .slice()
              .sort(function (a, b) { return a.sort_order - b.sort_order; })
              .map(function (itm) {
                return {
                  id:              itm.id,
                  productId:       itm.product_id || null,
                  name:            itm.name,
                  brand:           itm.brand || '',
                  type:            itm.type,
                  carbsPerUnit:    itm.carbs_per_unit    || 0,
                  sodiumPerUnit:   itm.sodium_per_unit   || 0,
                  caffeinePerUnit: itm.caffeine_per_unit || 0,
                  quantity:        itm.quantity || 1
                };
              })
          };
        })
    };
  }

  // eventToDb produces the shape expected by the save_event Postgres RPC function
  function eventToDb(evt) {
    return {
      id:      evt.id,
      user_id: getUserId(),
      name:    evt.name,
      date:    evt.date || '',
      type:    evt.type || 'other',
      notes:   evt.notes || null,
      segments: (evt.segments || []).map(function (seg, si) {
        return {
          id:            seg.id,
          name:          seg.name,
          durationHours: seg.durationHours,
          sortOrder:     si,
          targets: {
            carbsPerHour:    (seg.targets && seg.targets.carbsPerHour)    || 0,
            sodiumPerHour:   (seg.targets && seg.targets.sodiumPerHour)   || 0,
            caffeinePerHour: (seg.targets && seg.targets.caffeinePerHour) || 0
          },
          items: (seg.items || []).map(function (itm, ii) {
            return {
              id:              itm.id,
              productId:       itm.productId || null,
              name:            itm.name,
              brand:           itm.brand || null,
              type:            itm.type,
              carbsPerUnit:    itm.carbsPerUnit    || 0,
              sodiumPerUnit:   itm.sodiumPerUnit   || 0,
              caffeinePerUnit: itm.caffeinePerUnit || 0,
              quantity:        itm.quantity || 1,
              sortOrder:       ii
            };
          })
        };
      })
    };
  }

  // ── ID generation ────────────────────────────────────────────────────────────
  function generateId() {
    return crypto.randomUUID();
  }

  // ── Products ─────────────────────────────────────────────────────────────────

  async function getProducts() {
    var rows = await supabaseRequest(
      'GET',
      'products?user_id=eq.' + getUserId() + '&select=*&order=created_at.asc'
    );
    return (rows || []).map(dbToProduct);
  }

  async function saveProduct(product) {
    await supabaseRequest(
      'POST',
      'products?on_conflict=id',
      productToDb(product),
      'return=representation,resolution=merge-duplicates'
    );
  }

  async function deleteProduct(id) {
    await supabaseRequest('DELETE', 'products?id=eq.' + id, null, 'return=minimal');
    try {
      var ids = JSON.parse(localStorage.getItem(KEYS.recent) || '[]')
        .filter(function (i) { return i !== id; });
      localStorage.setItem(KEYS.recent, JSON.stringify(ids));
    } catch (e) {}
  }

  // ── Events ───────────────────────────────────────────────────────────────────

  async function getEvents() {
    var rows = await supabaseRequest(
      'GET',
      'events?user_id=eq.' + getUserId() + '&select=*,segments(*,items(*))&order=date.desc.nullslast'
    );
    return (rows || []).map(dbToEvent);
  }

  async function getEvent(id) {
    var rows = await supabaseRequest(
      'GET',
      'events?id=eq.' + id + '&user_id=eq.' + getUserId() + '&select=*,segments(*,items(*))'
    );
    return rows.length ? dbToEvent(rows[0]) : null;
  }

  async function saveEvent(evt) {
    await supabaseRequest(
      'POST',
      'rpc/save_event',
      { event_data: eventToDb(evt) },
      'return=minimal'
    );
  }

  async function deleteEvent(id) {
    await supabaseRequest('DELETE', 'events?id=eq.' + id, null, 'return=minimal');
  }

  async function saveActuals(eventId, actuals, postEventNotes) {
    await supabaseRequest(
      'PATCH',
      'events?id=eq.' + eventId,
      { actuals: actuals, post_event_notes: postEventNotes || null },
      'return=minimal'
    );
  }

  // Upserts only the user id — display_name is no longer collected.
  async function saveUser(id) {
    await supabaseRequest(
      'POST',
      'users?on_conflict=id',
      { id: id },
      'return=minimal,resolution=merge-duplicates'
    );
  }

  // ── Recent products — stored in localStorage (per-device convenience) ────────

  function getRecentProducts() {
    try { return JSON.parse(localStorage.getItem(KEYS.recent) || '[]'); }
    catch (e) { return []; }
  }

  function recordProductUsed(id) {
    try {
      var ids = JSON.parse(localStorage.getItem(KEYS.recent) || '[]');
      var updated = [id].concat(ids.filter(function (i) { return i !== id; })).slice(0, 5);
      localStorage.setItem(KEYS.recent, JSON.stringify(updated));
    } catch (e) {}
  }

  // ── Migration ─────────────────────────────────────────────────────────────────

  async function migrateIfNeeded() {
    if (localStorage.getItem(KEYS.migrated) === 'true') return;

    var existingEvents   = await supabaseRequest('GET', 'events?user_id=eq.'   + getUserId() + '&select=id&limit=1');
    var existingProducts = await supabaseRequest('GET', 'products?user_id=eq.' + getUserId() + '&select=id&limit=1');
    if (existingEvents.length > 0 && existingProducts.length > 0) {
      localStorage.setItem(KEYS.migrated, 'true');
      return;
    }

    var oldProducts = [];
    var oldEvents   = [];
    try {
      oldProducts = JSON.parse(localStorage.getItem('fuelPlanner.products') || '[]');
      oldEvents   = JSON.parse(localStorage.getItem('fuelPlanner.events')   || '[]');
    } catch (e) {}

    if (!oldProducts.length && !oldEvents.length) {
      localStorage.setItem(KEYS.migrated, 'true');
      return;
    }

    var productIdMap = {};
    var migratedProducts = oldProducts.map(function (p) {
      var newId = generateId();
      productIdMap[p.id] = newId;
      return Object.assign({}, p, { id: newId });
    });

    for (var i = 0; i < migratedProducts.length; i++) {
      await saveProduct(migratedProducts[i]);
    }

    try {
      var oldRecent = JSON.parse(localStorage.getItem(KEYS.recent) || '[]');
      var newRecent = oldRecent
        .map(function (id) { return productIdMap[id]; })
        .filter(Boolean)
        .slice(0, 5);
      localStorage.setItem(KEYS.recent, JSON.stringify(newRecent));
    } catch (e) {}

    for (var j = 0; j < oldEvents.length; j++) {
      var oldEvt = oldEvents[j];
      var migratedEvt = Object.assign({}, oldEvt, {
        id: generateId(),
        segments: (oldEvt.segments || []).map(function (seg) {
          return Object.assign({}, seg, {
            id: generateId(),
            items: (seg.items || []).map(function (itm) {
              return Object.assign({}, itm, {
                id:        generateId(),
                productId: itm.productId ? (productIdMap[itm.productId] || null) : null
              });
            })
          });
        })
      });
      await saveEvent(migratedEvt);
    }

    localStorage.setItem(KEYS.migrated, 'true');
  }

  // ── Calculations ──────────────────────────────────────────────────────────────

  function calcSegmentTotals(segment) {
    return (segment.items || []).reduce(function (acc, item) {
      return {
        carbs:    acc.carbs    + (item.carbsPerUnit    || 0) * (item.quantity || 0),
        sodium:   acc.sodium   + (item.sodiumPerUnit   || 0) * (item.quantity || 0),
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
        carbs:         acc.carbs         + t.carbs,
        sodium:        acc.sodium        + t.sodium,
        caffeine:      acc.caffeine      + t.caffeine,
        durationHours: acc.durationHours + (seg.durationHours || 0)
      };
    }, { carbs: 0, sodium: 0, caffeine: 0, durationHours: 0 });
  }

  function calcEventRates(event) {
    var t = calcEventTotals(event);
    var h = t.durationHours || 1;
    return { carbs: t.carbs / h, sodium: t.sodium / h, caffeine: t.caffeine / h };
  }

  function rateStatus(actual, target) {
    if (target === undefined || target === null) return 'none';
    if (target === 0) return actual > 0 ? 'over' : 'none';
    var ratio = actual / target;
    if (ratio >= 0.9 && ratio <= 1.1)  return 'on-target';
    if (ratio >= 0.75 && ratio < 0.9)  return 'warning-under';
    if (ratio > 1.1  && ratio <= 1.25) return 'warning-over';
    return ratio < 0.75 ? 'under' : 'over';
  }

  function calcActualSegmentTotals(actualSegment) {
    return calcSegmentTotals(actualSegment);
  }

  function calcActualSegmentRates(actualSegment) {
    var t = calcActualSegmentTotals(actualSegment);
    var h = actualSegment.durationHours || 1;
    return { carbs: t.carbs / h, sodium: t.sodium / h, caffeine: t.caffeine / h };
  }

  function calcActualEventTotals(event) {
    return Object.keys(event.actuals || {}).reduce(function (acc, segId) {
      var actualSeg = event.actuals[segId];
      var t = calcActualSegmentTotals(actualSeg);
      return {
        carbs:         acc.carbs         + t.carbs,
        sodium:        acc.sodium        + t.sodium,
        caffeine:      acc.caffeine      + t.caffeine,
        durationHours: acc.durationHours + (actualSeg.durationHours || 0)
      };
    }, { carbs: 0, sodium: 0, caffeine: 0, durationHours: 0 });
  }

  function calcActualEventRates(event) {
    var t = calcActualEventTotals(event);
    var h = t.durationHours || 1;
    return { carbs: t.carbs / h, sodium: t.sodium / h, caffeine: t.caffeine / h };
  }

  function calcEventGoalRates(event) {
    var segs = event.segments || [];
    var totalH = segs.reduce(function (s, seg) { return s + (seg.durationHours || 0); }, 0);
    if (!totalH) return { carbs: 0, sodium: 0, caffeine: 0 };
    return {
      carbs:    segs.reduce(function (s, seg) { return s + (seg.targets.carbsPerHour    || 0) * (seg.durationHours || 0); }, 0) / totalH,
      sodium:   segs.reduce(function (s, seg) { return s + (seg.targets.sodiumPerHour   || 0) * (seg.durationHours || 0); }, 0) / totalH,
      caffeine: segs.reduce(function (s, seg) { return s + (seg.targets.caffeinePerHour || 0) * (seg.durationHours || 0); }, 0) / totalH,
    };
  }

  // ── Factories ─────────────────────────────────────────────────────────────────

  function newSegment(name, durationHours) {
    return {
      id:            generateId(),
      name:          name || 'Segment',
      durationHours: durationHours || 1,
      targets:       { carbsPerHour: 80, sodiumPerHour: 500, caffeinePerHour: 0 },
      items:         []
    };
  }

  function newEvent(name) {
    return {
      id:             generateId(),
      name:           name || 'New Event',
      date:           new Date().toISOString().slice(0, 10),
      type:           'ride',
      notes:          '',
      postEventNotes: '',
      actuals:        {},
      segments:       [newSegment(name || 'New Event', 1)]
    };
  }

  function itemFromProduct(product) {
    return {
      id:              generateId(),
      productId:       product.id,
      name:            product.name,
      brand:           product.brand || '',
      type:            product.type,
      carbsPerUnit:    Number(product.carbsPerUnit)    || 0,
      sodiumPerUnit:   Number(product.sodiumPerUnit)   || 0,
      caffeinePerUnit: Number(product.caffeinePerUnit) || 0,
      quantity:        1
    };
  }

  function itemFromOneOff(fields) {
    return {
      id:              generateId(),
      productId:       null,
      name:            fields.name,
      brand:           fields.brand || '',
      type:            fields.type || 'other',
      carbsPerUnit:    Number(fields.carbsPerUnit)    || 0,
      sodiumPerUnit:   Number(fields.sodiumPerUnit)   || 0,
      caffeinePerUnit: Number(fields.caffeinePerUnit) || 0,
      quantity:        1
    };
  }

  // ── Exports ───────────────────────────────────────────────────────────────────

  exports.getUserId        = getUserId;
  exports.generatePhrase   = generatePhrase;
  exports.hashPhrase       = hashPhrase;
  exports.saveClaim        = saveClaim;
  exports.lookupClaim      = lookupClaim;
  exports.generateId       = generateId;
  exports.getProducts      = getProducts;
  exports.saveProduct      = saveProduct;
  exports.deleteProduct    = deleteProduct;
  exports.getEvents        = getEvents;
  exports.getEvent         = getEvent;
  exports.saveEvent        = saveEvent;
  exports.deleteEvent      = deleteEvent;
  exports.saveActuals      = saveActuals;
  exports.saveUser         = saveUser;
  exports.getRecentProducts  = getRecentProducts;
  exports.recordProductUsed  = recordProductUsed;
  exports.migrateIfNeeded    = migrateIfNeeded;
  exports.calcSegmentTotals  = calcSegmentTotals;
  exports.calcSegmentRates   = calcSegmentRates;
  exports.calcEventTotals    = calcEventTotals;
  exports.calcEventRates     = calcEventRates;
  exports.rateStatus         = rateStatus;
  exports.calcActualSegmentTotals = calcActualSegmentTotals;
  exports.calcActualSegmentRates  = calcActualSegmentRates;
  exports.calcActualEventTotals   = calcActualEventTotals;
  exports.calcActualEventRates    = calcActualEventRates;
  exports.calcEventGoalRates      = calcEventGoalRates;
  exports.newSegment         = newSegment;
  exports.newEvent           = newEvent;
  exports.itemFromProduct    = itemFromProduct;
  exports.itemFromOneOff     = itemFromOneOff;

})(typeof module !== 'undefined' ? module.exports : (window.Data = window.Data || {}));
```

- [ ] **Step 5: Run tests and verify all pass**

```bash
node tests/data.test.js
```

Expected output: all sections pass including the new Identity section. Zero failures. The old `deriveUserId` tests are gone.

- [ ] **Step 6: Commit**

```bash
git add data.js tests/data.test.js
git commit -m "feat: anonymous-first data layer — getUserId(), generatePhrase, hashPhrase, saveClaim, lookupClaim; remove deriveUserId"
```

---

### Task 2: index.html — markup for anonymous-first flows

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Add second button to landing page**

In `index.html`, replace:

```html
      <button id="btn-landing-start" class="btn-primary">Get started</button>
```

with:

```html
      <button id="btn-landing-start" class="btn-primary">Get started</button>
      <button id="btn-existing-data" class="btn-secondary" style="margin-top:8px">Take me to my existing data</button>
```

- [ ] **Step 2: Add claim indicator to view-events header**

Replace the `view-events` header:

```html
  <div id="view-events" class="view active">
    <header class="app-header">
      <h1>Events</h1>
      <button id="btn-new-event" class="btn-icon" aria-label="New event">+</button>
    </header>
    <div id="events-list" class="view-body"></div>
  </div>
```

with:

```html
  <div id="view-events" class="view active">
    <header class="app-header">
      <h1>Events</h1>
      <button id="btn-new-event" class="btn-icon" aria-label="New event">+</button>
    </header>
    <div id="claim-indicator" class="claim-indicator hidden">
      <span id="claim-indicator-text" class="claim-indicator-text">Save your data — get a recovery phrase</span>
      <button id="btn-dismiss-indicator" class="claim-indicator-dismiss" type="button" aria-label="Dismiss">&#215;</button>
    </div>
    <div id="events-list" class="view-body"></div>
  </div>
```

- [ ] **Step 3: Remove view-setup entirely**

Delete the entire `<!-- ── Setup view ── -->` block including the comment and the closing `</div>`:

```html
  <!-- ── Setup view ─────────────────────────────────────────────────────────────── -->
  <div id="view-setup" class="view view-centered">
    <div class="setup-content">
      <h1 class="setup-title">Set up your space</h1>
      <form id="setup-form" novalidate>
        <div class="form-group">
          <label for="setup-name">What should we call you?</label>
          <input id="setup-name" class="form-input" type="text" placeholder="Your name" autocomplete="off" required>
        </div>
        <div class="form-group">
          <label for="setup-passphrase">Your phrase</label>
          <div class="passphrase-field">
            <input id="setup-passphrase" class="form-input" type="text" placeholder="e.g. purple cactus tuesday" autocomplete="off" required>
            <button type="button" id="btn-toggle-passphrase" class="btn-show-passphrase" aria-label="Hide phrase">Hide</button>
          </div>
          <p class="setup-helper">A few words you'll remember — type the same phrase on any device to get back to your data.</p>
        </div>
        <button type="submit" class="btn-primary">Get started</button>
      </form>
    </div>
  </div>
```

- [ ] **Step 4: Add view-claim and view-recovery before view-detail**

Insert the following two views immediately before the `<!-- ── Event detail view ── -->` comment:

```html
  <!-- ── Claim view ────────────────────────────────────────────────────────── -->
  <div id="view-claim" class="view">
    <header class="app-header">
      <button id="btn-claim-back" class="btn-back" aria-label="Back">&#8592;</button>
      <h1>Recovery phrase</h1>
    </header>
    <div class="view-body">
      <div class="form-card" style="margin-top:16px">
        <p class="claim-subtext">Write these words down or copy them somewhere safe. You'll need them to access your data on a new device.</p>
        <div id="claim-phrase" class="claim-phrase"></div>
        <div class="claim-phrase-actions">
          <button id="btn-regenerate-phrase" type="button" class="btn-secondary">Regenerate</button>
          <button id="btn-copy-phrase" type="button" class="btn-secondary">Copy</button>
        </div>
        <div class="toggle-row" style="margin-top:20px">
          <span class="toggle-label">I've saved my recovery phrase</span>
          <input id="claim-saved-checkbox" class="toggle-input" type="checkbox">
        </div>
      </div>
      <button id="btn-save-claim" type="button" class="btn-primary" style="margin-top:16px" disabled>Save and continue</button>
    </div>
  </div>

  <!-- ── Recovery view ─────────────────────────────────────────────────────── -->
  <div id="view-recovery" class="view">
    <header class="app-header">
      <button id="btn-recovery-back" class="btn-back" aria-label="Back">&#8592;</button>
      <h1>Recovery</h1>
    </header>
    <div class="view-body">
      <div class="form-card" style="margin-top:16px">
        <p class="recovery-subtext">Type the 4 words you saved when you set up your data.</p>
        <div class="form-group">
          <label for="recovery-phrase-input">Recovery phrase</label>
          <input id="recovery-phrase-input" class="form-input" type="text"
                 placeholder="e.g. maple river sunset bottle" autocomplete="off">
        </div>
        <div id="recovery-error" class="recovery-error hidden"></div>
      </div>
      <button id="btn-find-data" type="button" class="btn-primary" style="margin-top:16px">Find my data</button>
    </div>
  </div>

```

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: anonymous-first markup — claim indicator, view-claim, view-recovery, second landing button, remove view-setup"
```

---

### Task 3: style.css — remove setup styles, add new styles

**Files:**
- Modify: `style.css`

- [ ] **Step 1: Remove setup-only CSS rules**

Find and delete the `/* ── Setup screen ─────────────────────────────────────────────────────────── */` comment and the following rule blocks:

- `.setup-content { ... }`
- `.setup-title { ... }`
- `.passphrase-field { ... }`
- `.btn-show-passphrase { ... }` and `.btn-show-passphrase:hover { ... }`
- `.setup-helper { ... }`

Leave `.view-centered` and all `.landing-*` rules in place — they are still used by the landing page.

- [ ] **Step 2: Add btn-secondary**

Find the buttons section (search for `.btn-text`). Add the following after the last button rule in that section:

```css
.btn-secondary {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 10px 16px;
  border-radius: var(--radius);
  font-size: 15px;
  font-weight: 500;
  border: 1.5px solid var(--border);
  background: transparent;
  color: var(--text);
  cursor: pointer;
  width: 100%;
}
.btn-secondary:active { opacity: 0.7; }
```

- [ ] **Step 3: Add claim indicator, claim screen, and recovery screen styles**

At the very end of `style.css`, append:

```css
/* ── Claim indicator ─────────────────────────────────────────────────────── */
.claim-indicator {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  background: var(--amber-bg);
  color: var(--amber-text);
  padding: 10px 16px;
  font-size: 13px;
  cursor: pointer;
  border-bottom: 1px solid rgba(0,0,0,0.06);
}
.claim-indicator-text {
  flex: 1;
}
.claim-indicator-dismiss {
  flex-shrink: 0;
  background: none;
  border: none;
  cursor: pointer;
  color: inherit;
  font-size: 18px;
  line-height: 1;
  padding: 2px 4px;
}

/* ── Claim screen ────────────────────────────────────────────────────────── */
.claim-subtext,
.recovery-subtext {
  font-size: 14px;
  color: var(--text-secondary);
  margin-bottom: 16px;
  line-height: 1.5;
}

.claim-phrase {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 0.01em;
  text-align: center;
  padding: 20px 8px;
  color: var(--text);
  line-height: 1.4;
}

.claim-phrase-actions {
  display: flex;
  gap: 8px;
}
.claim-phrase-actions .btn-secondary {
  padding: 8px 12px;
  font-size: 13px;
}

/* ── Recovery screen ─────────────────────────────────────────────────────── */
.recovery-error {
  font-size: 13px;
  color: var(--error, #d93025);
  margin-top: 8px;
  padding: 4px 0;
}
```

Note: `.recovery-error` uses `var(--error, #d93025)` — this uses the `--error` custom property if it's defined in `:root`, or falls back to red.

- [ ] **Step 4: Commit**

```bash
git add style.css
git commit -m "feat: anonymous-first styles — btn-secondary, claim indicator, claim/recovery screens; remove setup styles"
```

---

### Task 4: app.js — init rewrite, indicator + claim + recovery handlers

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Add module-level variables after the state object**

Find the `var state = { ... };` block (around line 6). After the closing `};`, add:

```js
  var _indicatorDismissed = false; // reset to false on page load; session-only dismissal
  var _currentPhrase = '';         // holds the phrase currently displayed on the claim screen
```

- [ ] **Step 2: Update navigate() to include claim and recovery in hideTabBar**

Find (around line 97–98):

```js
    var hideTabBar = (view === 'detail' || view === 'create' ||
                      view === 'product-form' || view === 'landing' || view === 'setup');
```

Replace with:

```js
    var hideTabBar = (view === 'detail' || view === 'create' ||
                      view === 'product-form' || view === 'landing' ||
                      view === 'claim' || view === 'recovery');
```

- [ ] **Step 3: Add claim indicator show/hide to renderEventsList**

In `renderEventsList`, add the following helper after all the rendering code. Add it in two places:

**a) In the `!events.length` early-return branch, just before `return`:**

```js
    if (!events.length) {
      $list.innerHTML = '<div class="empty-state"><div style="font-size:48px">🚴</div><p>No events yet.</p><p>Tap + to plan your first one.</p></div>';
      _refreshClaimIndicator();
      return;
    }
```

**b) At the very end of `renderEventsList`, after `$list.querySelectorAll('.event-card').forEach(...)`:**

```js
    _refreshClaimIndicator();
```

Then add the helper function near the top of the function section (after `renders.events = renderEventsList;`):

```js
  function _refreshClaimIndicator() {
    var indicator = $('claim-indicator');
    if (!indicator) return;
    if (!_indicatorDismissed && localStorage.getItem('fuelPlanner.isAnonymous') === 'true') {
      indicator.classList.remove('hidden');
    } else {
      indicator.classList.add('hidden');
    }
  }
```

- [ ] **Step 4: Add renders.claim**

After `renders.events = renderEventsList;`, add:

```js
  renders.claim = function () {
    _currentPhrase = Data.generatePhrase();
    var phraseEl = $('claim-phrase');
    if (phraseEl) phraseEl.textContent = _currentPhrase;
    var checkbox = $('claim-saved-checkbox');
    if (checkbox) checkbox.checked = false;
    var saveBtn = $('btn-save-claim');
    if (saveBtn) saveBtn.disabled = true;
  };
```

- [ ] **Step 5: Rewrite init()**

Replace the entire `init()` function (from `async function init() {` to its closing `}`) with:

```js
  async function init() {
    // ── Landing handlers — always registered regardless of identity state ───────
    on($('btn-landing-start'), 'click', async function () {
      if (!localStorage.getItem('fuelPlanner.userId')) {
        var uuid = Data.generateId();
        localStorage.setItem('fuelPlanner.userId', uuid);
        localStorage.setItem('fuelPlanner.isAnonymous', 'true');
        // Register user in DB so save_event can validate user_id
        try {
          await Data.saveUser(uuid);
        } catch (e) {
          console.error('Could not register user:', e);
          // Non-fatal: user will see a connection error when saving their first event
        }
      }
      navigate('create', { currentEventId: null });
    });

    on($('btn-existing-data'), 'click', function () {
      navigate('recovery');
    });

    // ── Identity check — must come before any data access ─────────────────────
    if (!localStorage.getItem('fuelPlanner.userId')) {
      navigate('landing');
      return;
    }

    // ── Normal app init ────────────────────────────────────────────────────────

    // Tab bar
    $$('.tab-btn').forEach(function (btn) {
      on(btn, 'click', function () { navigate(btn.dataset.tabView); });
    });

    // Claim indicator: tapping the text/background opens claim screen;
    // tapping the dismiss button hides it for this session only.
    on($('claim-indicator'), 'click', function (e) {
      var dismissBtn = $('btn-dismiss-indicator');
      if (dismissBtn && dismissBtn.contains(e.target)) return;
      navigate('claim');
    });
    on($('btn-dismiss-indicator'), 'click', function (e) {
      e.stopPropagation();
      _indicatorDismissed = true;
      var indicator = $('claim-indicator');
      if (indicator) indicator.classList.add('hidden');
    });

    // Claim screen
    on($('btn-claim-back'), 'click', function () { navigate('events'); });

    on($('btn-regenerate-phrase'), 'click', function () {
      _currentPhrase = Data.generatePhrase();
      var phraseEl = $('claim-phrase');
      if (phraseEl) phraseEl.textContent = _currentPhrase;
    });

    on($('btn-copy-phrase'), 'click', function () {
      navigator.clipboard.writeText(_currentPhrase).then(function () {
        showToast('Phrase copied!');
      }).catch(function () {
        showToast("Copy failed \u2014 select and copy manually.");
      });
    });

    on($('claim-saved-checkbox'), 'change', function () {
      var saveBtn = $('btn-save-claim');
      if (saveBtn) saveBtn.disabled = !$('claim-saved-checkbox').checked;
    });

    on($('btn-save-claim'), 'click', async function () {
      var btn = $('btn-save-claim');
      btn.disabled = true;
      btn.textContent = 'Saving\u2026';
      try {
        var hash = await Data.hashPhrase(_currentPhrase);
        await Data.saveClaim(hash);
        localStorage.setItem('fuelPlanner.isAnonymous', 'false');
        navigate('events');
        showToast('Recovery phrase saved!');
      } catch (e) {
        btn.disabled = false;
        btn.textContent = 'Save and continue';
        showToast("Couldn\u2019t save \u2014 check your connection.");
      }
    });

    // Recovery screen
    on($('btn-recovery-back'), 'click', function () { navigate('landing'); });

    on($('btn-find-data'), 'click', async function () {
      var phrase = ($('recovery-phrase-input') || {}).value || '';
      var errorEl = $('recovery-error');
      if (errorEl) { errorEl.textContent = ''; errorEl.classList.add('hidden'); }
      var btn = $('btn-find-data');
      btn.disabled = true;
      btn.textContent = 'Searching\u2026';
      try {
        var hash = await Data.hashPhrase(phrase);
        var userId = await Data.lookupClaim(hash);
        if (userId) {
          localStorage.setItem('fuelPlanner.userId', userId);
          localStorage.setItem('fuelPlanner.isAnonymous', 'false');
          window.location.reload();
        } else {
          if (errorEl) {
            errorEl.textContent = 'No data found for this phrase. Check for typos and try again.';
            errorEl.classList.remove('hidden');
          }
          btn.disabled = false;
          btn.textContent = 'Find my data';
        }
      } catch (e) {
        if (errorEl) {
          errorEl.textContent = "Couldn\u2019t search \u2014 check your connection.";
          errorEl.classList.remove('hidden');
        }
        btn.disabled = false;
        btn.textContent = 'Find my data';
      }
    });

    // Migrate localStorage data to Supabase on first load
    try {
      await Data.migrateIfNeeded();
    } catch (e) {
      console.error('Migration failed:', e);
      showToast("Migration failed \u2014 your local data is safe. Will retry next load.");
    }

    navigate('events');
  }
```

- [ ] **Step 6: Run tests to confirm no regressions**

```bash
node tests/data.test.js
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add app.js
git commit -m "feat: anonymous-first app logic — init rewrite, claim indicator, claim/recovery screen handlers"
```

---

### Task 5: Supabase manual steps + owner migration

**Files:** None (Supabase SQL editor at https://app.supabase.com)

- [ ] **Step 1: Create the claims table and enable RLS**

Run in the Supabase SQL editor:

```sql
CREATE TABLE claims (
  phrase_hash  TEXT        PRIMARY KEY,
  user_id      UUID        NOT NULL REFERENCES users(id),
  created_at   TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE claims ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon all" ON claims
  FOR ALL TO anon USING (true) WITH CHECK (true);
```

- [ ] **Step 2: Drop display_name from users**

```sql
ALTER TABLE users DROP COLUMN IF EXISTS display_name;
```

- [ ] **Step 3: Owner migration — register UUID in claims**

The owner already has a UUID in localStorage. The absence of `fuelPlanner.isAnonymous` is treated as "claimed" (no indicator shown). To register a recovery phrase so cross-device recovery works:

1. Open the deployed app in the browser on the current device
2. Open the browser console and run:
   ```js
   localStorage.setItem('fuelPlanner.isAnonymous', 'true')
   ```
3. Reload the page — the claim indicator appears in the events header
4. Tap the indicator → claim screen → note the 4-word phrase → check "I've saved my recovery phrase" → "Save and continue"
5. The owner's UUID is now in the `claims` table; recovery on a new device works with that phrase

- [ ] **Step 4: Push to Netlify and smoke-test**

```bash
git push
```

Smoke tests (run in the browser after deploy):

1. **New visitor**: Incognito window → landing shows two buttons → "Get started" → create event form (no setup screen) → save an event → events list shows the claim indicator
2. **Claim flow**: Tap the claim indicator → claim screen shows 4 random words → check "I've saved my recovery phrase" → "Save and continue" → back to events, indicator hidden
3. **Returning anonymous visitor**: Close and reopen the incognito tab → skip landing → events list → indicator shows again (still anonymous from another session — use a fresh incognito to test a pre-claimed user)
4. **Recovery flow**: New incognito window → "Take me to my existing data" → type the phrase from step 2 → "Find my data" → page reloads → same events visible, no indicator
5. **Wrong phrase**: Recovery with a bad phrase → inline error "No data found for this phrase"
6. **Dismiss indicator**: New anonymous session → tap ✕ → indicator disappears → navigate away and back → still gone → reload page → indicator reappears
