# Multi-User Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add passphrase-based multi-user identity so each browser derives a stable UUID from name + passphrase, filtering all events and products per user, with a landing page and setup screen on first visit.

**Architecture:** `deriveUserId(name, passphrase)` hashes the concatenation with SHA-256 and formats the result as a UUID. The UUID is stored in `localStorage` so it is only derived on setup; subsequent visits read it directly. All Supabase queries already filter by `user_id` — the only change is replacing the hardcoded constant with a dynamic localStorage read. After setup completes the page reloads so `data.js` picks up the new `USER_ID` at module-load time.

**Tech Stack:** Vanilla JS, `crypto.subtle.digest` (Web Crypto API, available on HTTPS in all modern browsers and in Node 18+), Supabase PostgREST, no new dependencies.

---

## File Map

| File | What changes |
|---|---|
| `data.js` | Add `deriveUserId`, `saveUser`; replace hardcoded `USER_ID` with `localStorage.getItem`; add KEYS entries; export both new functions |
| `tests/data.test.js` | Update crypto mock to include `subtle`; add Identity test section |
| `index.html` | Add `view-landing` and `view-setup` divs inside `#app` |
| `app.js` | Update `navigate()` to hide tab bar for landing/setup; update `init()` with identity check and landing/setup handlers |
| `style.css` | Add landing and setup screen styles |

---

## Context for implementers

**Codebase overview:**
- `data.js` is an IIFE that exports via `exports` parameter — add all new functions before the `// ── Exports` comment and add them to the exports block.
- `app.js` is a single IIFE. `navigate(view)` controls which `.view` div is shown. The `init()` function at the bottom wires up all event listeners and is called on `DOMContentLoaded`.
- `USER_ID` in `data.js` (line 9) is currently hardcoded as `'33d5e92b-360a-45b7-a423-656f14e67b98'`. It is used in all event/product queries. It must remain a module-level variable (not a function) — replacing its value with a `localStorage.getItem` call is sufficient; a page reload after setup ensures the new value is picked up.
- `supabaseRequest(method, path, body, prefer)` — `prefer` sets the `Prefer:` request header. For upserts, use `'return=minimal,resolution=merge-duplicates'` and include `?on_conflict=id` in the path (see `saveProduct` for the pattern).
- Tests in `tests/data.test.js` use a hand-rolled mock for `fetch` and `localStorage`. Run with: `node --experimental-vm-modules tests/data.test.js`

---

## Task 1: `deriveUserId` in data.js

**Files:**
- Modify: `data.js` (add function + export)
- Modify: `tests/data.test.js` (update crypto mock + add tests)

- [ ] **Step 1: Update the crypto mock in the test file to include `subtle`**

Open `tests/data.test.js`. The current mock at the top sets `global.crypto` with only `randomUUID`. Replace it so `subtle` is also available (needed by `crypto.subtle.digest`):

```js
// Replace the existing crypto mock block (lines ~16-27) with:
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
    subtle: nodeCrypto.webcrypto.subtle
  }
});
```

- [ ] **Step 2: Write failing tests for `deriveUserId`**

Add a new section at the end of the `run()` function in `tests/data.test.js`, before the final `console.log` summary lines:

```js
  // ── Identity ──────────────────────────────────────────────────────────────────

  console.log('\nIdentity');

  await test('deriveUserId: same inputs produce same UUID', async function () {
    var id1 = await D.deriveUserId('Funmi', 'test-phrase');
    var id2 = await D.deriveUserId('Funmi', 'test-phrase');
    assert.strictEqual(id1, id2);
  });

  await test('deriveUserId: different name produces different UUID', async function () {
    var id1 = await D.deriveUserId('Funmi', 'test-phrase');
    var id2 = await D.deriveUserId('Alice', 'test-phrase');
    assert.notStrictEqual(id1, id2);
  });

  await test('deriveUserId: different passphrase produces different UUID', async function () {
    var id1 = await D.deriveUserId('Funmi', 'test-phrase');
    var id2 = await D.deriveUserId('Funmi', 'other-phrase');
    assert.notStrictEqual(id1, id2);
  });

  await test('deriveUserId: name is case-insensitive', async function () {
    var id1 = await D.deriveUserId('FUNMI', 'test-phrase');
    var id2 = await D.deriveUserId('funmi', 'test-phrase');
    assert.strictEqual(id1, id2);
  });

  await test('deriveUserId: name and passphrase are trimmed', async function () {
    var id1 = await D.deriveUserId('  Funmi  ', '  test-phrase  ');
    var id2 = await D.deriveUserId('Funmi', 'test-phrase');
    assert.strictEqual(id1, id2);
  });

  await test('deriveUserId: output is UUID-shaped (8-4-4-4-12 hex)', async function () {
    var id = await D.deriveUserId('Funmi', 'test-phrase');
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
node --experimental-vm-modules tests/data.test.js 2>&1 | grep -E "deriveUserId|passed|failed"
```

Expected: `D.deriveUserId is not a function` (or similar) and failure count increases.

- [ ] **Step 4: Implement `deriveUserId` in data.js**

Add after the `KEYS` block (around line 14), before `supabaseRequest`:

```js
  async function deriveUserId(name, passphrase) {
    var input = name.toLowerCase().trim() + ':' + passphrase.trim();
    var encoded = new TextEncoder().encode(input);
    var hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
    var hex = Array.from(new Uint8Array(hashBuffer))
      .map(function (b) { return b.toString(16).padStart(2, '0'); })
      .join('');
    // Format first 32 hex chars as UUID: 8-4-4-4-12
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' +
           hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20, 32);
  }
```

- [ ] **Step 5: Export `deriveUserId`**

In the `// ── Exports` block at the bottom of `data.js`, add:

```js
  exports.deriveUserId = deriveUserId;
```

- [ ] **Step 6: Run tests — all should pass**

```bash
node --experimental-vm-modules tests/data.test.js 2>&1 | tail -5
```

Expected: all Identity tests pass, total passed count increases by 6, 0 failed.

- [ ] **Step 7: Commit**

```bash
git add data.js tests/data.test.js
git commit -m "feat: add deriveUserId — SHA-256 hash of name:passphrase as UUID"
```

---

## Task 2: `saveUser`, dynamic `USER_ID`, and KEYS

**Files:**
- Modify: `data.js`
- Modify: `tests/data.test.js`

- [ ] **Step 1: Write failing test for `saveUser`**

In `tests/data.test.js`, add to the Identity section (after the `deriveUserId` tests):

```js
  await test('saveUser sends upsert POST to users endpoint', async function () {
    mockFetch([{ status: 200, body: '[]' }]);
    await D.saveUser('aaaaaaaa-0000-0000-0000-000000000001', 'Funmi');
    // passes if no exception thrown
  });

  await test('saveUser throws on server error', async function () {
    mockFetch([{ status: 400, body: 'Bad request' }]);
    await assert.rejects(
      D.saveUser('aaaaaaaa-0000-0000-0000-000000000001', 'Funmi'),
      /Bad request/
    );
  });
```

- [ ] **Step 2: Run to confirm they fail**

```bash
node --experimental-vm-modules tests/data.test.js 2>&1 | grep -E "saveUser|failed"
```

Expected: `D.saveUser is not a function`.

- [ ] **Step 3: Update KEYS to include userId and displayName keys**

In `data.js`, update the `KEYS` block:

```js
  var KEYS = {
    recent:      'fuelPlanner.recentProducts',
    migrated:    'fuelPlanner.migrated',
    userId:      'fuelPlanner.userId',
    displayName: 'fuelPlanner.displayName'
  };
```

- [ ] **Step 4: Replace hardcoded USER_ID with dynamic localStorage read**

In `data.js`, replace line 9:

```js
  // Before:
  var USER_ID = '33d5e92b-360a-45b7-a423-656f14e67b98'; // the UUID you generated and used in the SQL

  // After:
  var USER_ID = localStorage.getItem('fuelPlanner.userId');
```

`USER_ID` is read once at module-load time. A page reload after setup ensures the new value is picked up. Existing queries (`user_id=eq.USER_ID`) are unchanged.

- [ ] **Step 5: Implement `saveUser`**

Add after the existing `saveActuals` function in `data.js`:

```js
  async function saveUser(id, displayName) {
    await supabaseRequest(
      'POST',
      'users?on_conflict=id',
      { id: id, display_name: displayName },
      'return=minimal,resolution=merge-duplicates'
    );
  }
```

- [ ] **Step 6: Export `saveUser`**

In the `// ── Exports` block, add:

```js
  exports.saveUser = saveUser;
```

- [ ] **Step 7: Run all tests — should all pass**

```bash
node --experimental-vm-modules tests/data.test.js 2>&1 | tail -5
```

Expected: all tests pass (previous count + 2), 0 failed. The existing tests still pass because they mock `fetch` responses and do not depend on the `USER_ID` value.

- [ ] **Step 8: Commit**

```bash
git add data.js tests/data.test.js
git commit -m "feat: dynamic USER_ID from localStorage; add saveUser"
```

---

## Task 3: HTML — landing and setup views

**Files:**
- Modify: `index.html`
- Modify: `app.js` (navigate tab-bar logic only)

- [ ] **Step 1: Add view-landing and view-setup to index.html**

Inside `#app`, before the existing `<!-- ── Events list view -->` comment, add:

```html
  <!-- ── Landing view ───────────────────────────────────────────────── -->
  <div id="view-landing" class="view view-centered">
    <div class="landing-content">
      <h1 class="landing-title">Fueling Calculator</h1>
      <p class="landing-tagline">Plan your race nutrition. Track what you actually ate.</p>
      <ul class="landing-features">
        <li>Plan fuel per segment with carb, sodium and caffeine targets</li>
        <li>Log actuals after each event and compare to your plan</li>
        <li>Build a personal product library for faster planning</li>
        <li>Access your plans from any device</li>
      </ul>
      <button id="btn-landing-start" class="btn-primary">Get started</button>
    </div>
  </div>

  <!-- ── Setup view ─────────────────────────────────────────────────── -->
  <div id="view-setup" class="view view-centered">
    <div class="setup-content">
      <h1 class="setup-title">Create your account</h1>
      <form id="setup-form" novalidate>
        <div class="form-group">
          <label for="setup-name">What should we call you?</label>
          <input id="setup-name" class="form-input" type="text" placeholder="Your name" autocomplete="off" required>
        </div>
        <div class="form-group">
          <label for="setup-passphrase">Secret phrase</label>
          <div class="passphrase-field">
            <input id="setup-passphrase" class="form-input" type="password" placeholder="e.g. purple cactus tuesday" autocomplete="off" required>
            <button type="button" id="btn-toggle-passphrase" class="btn-show-passphrase" aria-label="Show passphrase">Show</button>
          </div>
          <p class="setup-helper">Use a few words you will remember — this is how you access your data from any device.</p>
        </div>
        <button type="submit" class="btn-primary">Get started</button>
      </form>
    </div>
  </div>

```

- [ ] **Step 2: Update navigate() to hide tab bar for landing and setup views**

In `app.js`, find the `hideTabBar` line inside `navigate()`:

```js
    // Before:
    var hideTabBar = (view === 'detail' || view === 'create' ||
                      view === 'product-form');

    // After:
    var hideTabBar = (view === 'detail' || view === 'create' ||
                      view === 'product-form' || view === 'landing' || view === 'setup');
```

- [ ] **Step 3: Verify syntax**

```bash
node --check app.js && echo "OK"
```

Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add index.html app.js
git commit -m "feat: add view-landing and view-setup HTML; hide tab bar for both views"
```

---

## Task 4: CSS — landing and setup styles

**Files:**
- Modify: `style.css`

- [ ] **Step 1: Add styles at the end of style.css**

```css
/* ── Landing + Setup shared ──────────────────────────────────────────────── */
.view-centered {
  justify-content: center;
  align-items: center;
  padding: 32px 24px;
  padding-bottom: 32px; /* override tab-bar padding — these views have no tab bar */
}

/* ── Landing page ────────────────────────────────────────────────────────── */
.landing-content {
  width: 100%;
  max-width: 480px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  text-align: center;
}

.landing-title {
  font-size: 28px;
  font-weight: 700;
  color: var(--text);
}

.landing-tagline {
  font-size: 16px;
  color: var(--text-secondary);
}

.landing-features {
  text-align: left;
  list-style: disc;
  padding-left: 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 14px;
  color: var(--text-secondary);
}

/* ── Setup screen ────────────────────────────────────────────────────────── */
.setup-content {
  width: 100%;
  max-width: 480px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.setup-title {
  font-size: 22px;
  font-weight: 700;
  text-align: center;
  color: var(--text);
}

.passphrase-field {
  position: relative;
  display: flex;
  align-items: center;
}

.passphrase-field .form-input {
  flex: 1;
  padding-right: 60px; /* room for show/hide button */
}

.btn-show-passphrase {
  position: absolute;
  right: 10px;
  font-size: 13px;
  color: var(--text-secondary);
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px;
}

.setup-helper {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 6px;
  line-height: 1.5;
}
```

- [ ] **Step 2: Commit**

```bash
git add style.css
git commit -m "feat: landing page and setup screen styles"
```

---

## Task 5: App logic — init check and landing/setup handlers

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Add identity check and all setup handlers at the top of init()**

In `app.js`, replace the existing `init()` function body. The full updated function:

```js
  async function init() {
    // ── Landing + setup handlers — registered regardless of login state ────────

    on($('btn-landing-start'), 'click', function () {
      navigate('setup');
    });

    on($('btn-toggle-passphrase'), 'click', function () {
      var field = $('setup-passphrase');
      var btn   = $('btn-toggle-passphrase');
      if (field.type === 'password') {
        field.type = 'text';
        btn.textContent = 'Hide';
      } else {
        field.type = 'password';
        btn.textContent = 'Show';
      }
    });

    on($('setup-form'), 'submit', async function (e) {
      e.preventDefault();
      var name       = $('setup-name').value.trim();
      var passphrase = $('setup-passphrase').value.trim();
      if (!name || !passphrase) return;
      var submitBtn = $('setup-form').querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Setting up…';
      try {
        var userId = await Data.deriveUserId(name, passphrase);
        localStorage.setItem('fuelPlanner.userId', userId);
        localStorage.setItem('fuelPlanner.displayName', name);
        await Data.saveUser(userId, name);
        window.location.reload();
      } catch (err) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Get started';
        showToast("Setup failed — check your connection.");
      }
    });

    // ── Identity check — must come before any data access ─────────────────────

    if (!localStorage.getItem('fuelPlanner.userId')) {
      navigate('landing');
      return;
    }

    // ── Normal app init ───────────────────────────────────────────────────────

    // Tab bar
    $$('.tab-btn').forEach(function (btn) {
      on(btn, 'click', function () { navigate(btn.dataset.tabView); });
    });

    // Migrate localStorage data to Supabase on first load
    try {
      await Data.migrateIfNeeded();
    } catch (e) {
      console.error('Migration failed:', e);
      showToast("Migration failed — your local data is safe. Will retry next load.");
    }

    navigate('events');
  }
```

- [ ] **Step 2: Verify syntax**

```bash
node --check app.js && echo "OK"
```

Expected: `OK`

- [ ] **Step 3: Run all tests to confirm nothing regressed**

```bash
node --experimental-vm-modules tests/data.test.js 2>&1 | tail -5
```

Expected: all tests pass, 0 failed.

- [ ] **Step 4: Smoke test in browser**

Open the app in an incognito window (clears localStorage). Confirm:
- Landing page appears (no tab bar visible)
- "Get started" navigates to setup screen
- Submit with empty fields does nothing
- Submit with valid name + passphrase shows "Setting up…" then reloads to events list
- Reload again — landing/setup screens are skipped, events list shows directly
- Open a second incognito window, enter same name + passphrase — same events appear

- [ ] **Step 5: Commit**

```bash
git add app.js
git commit -m "feat: identity check in init(); landing and setup screen handlers"
```

---

## Task 6: Supabase schema + owner migration (manual steps)

This task is performed by the owner in the Supabase dashboard — no code changes.

- [ ] **Step 1: Create the users table**

In the Supabase SQL editor, run:

```sql
CREATE TABLE users (
  id           UUID PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT now()
);
```

- [ ] **Step 2: Complete setup in the app to generate your derived UUID**

Open the app in a browser where `fuelPlanner.userId` is not set (use incognito or clear localStorage). Enter your name and passphrase and click "Get started". After the reload, open the browser console and run:

```js
localStorage.getItem('fuelPlanner.userId')
```

Copy the UUID that appears.

- [ ] **Step 3: Migrate existing events and products to the new UUID**

In the Supabase SQL editor, replace `<new-uuid>` with the UUID you copied:

```sql
UPDATE events   SET user_id = '<new-uuid>' WHERE user_id = '33d5e92b-360a-45b7-a423-656f14e67b98';
UPDATE products SET user_id = '<new-uuid>' WHERE user_id = '33d5e92b-360a-45b7-a423-656f14e67b98';
INSERT INTO users (id, display_name) VALUES ('<new-uuid>', 'Funmi')
  ON CONFLICT (id) DO NOTHING;
```

- [ ] **Step 4: Reload the app and confirm your events appear**

Refresh the browser. Your existing events and products should be visible.

- [ ] **Step 5: Test a second user**

Open an incognito window. Enter a different name + passphrase. Confirm the events list is empty (separate user, no cross-contamination). Add a test event and confirm it does not appear in the first browser window.

---

## Self-Review Checklist

**Spec coverage:**
- Identity derivation (name + passphrase → SHA-256 → UUID): Task 1 ✓
- `saveUser` upsert: Task 2 ✓
- Dynamic `USER_ID`: Task 2 ✓
- Landing page HTML + content: Task 3 ✓
- Setup screen HTML (name, passphrase, show/hide toggle, helper text): Task 3 ✓
- Tab bar hidden for landing/setup: Task 3 ✓
- Landing/setup CSS: Task 4 ✓
- Init identity check + early return: Task 5 ✓
- Setup form handler (derive, store, saveUser, reload): Task 5 ✓
- Passphrase show/hide toggle: Task 5 ✓
- Page reload after setup (so USER_ID is re-read): Task 5 ✓
- `users` table SQL: Task 6 ✓
- Owner migration SQL: Task 6 ✓
- Recovery path documented: Spec only (no code — manual admin process) ✓
- Future share links compatibility: No code needed — events already keyed by user_id ✓
