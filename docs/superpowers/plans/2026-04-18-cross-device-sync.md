# Cross-Device Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace localStorage with Supabase (Postgres) so fueling plans are accessible from any device via direct `fetch()` to the Supabase PostgREST API — no SDK, no backend server.

**Architecture:** `data.js` is fully rewritten: synchronous localStorage calls become async Supabase fetch calls, with a `supabaseRequest()` helper handling auth headers. `app.js` is updated throughout — every function that calls data functions becomes async and awaits results. A one-time `migrateIfNeeded()` runs on first load to move any existing localStorage data to Supabase.

**Tech Stack:** Vanilla JS (ES2017 async/await, `crypto.randomUUID()`), Supabase PostgREST REST API, Postgres RPC function for atomic event saves, Row Level Security with a hardcoded USER_ID UUID.

**Note on intermediate states:** Tasks 1–5 rewrite `data.js`. After Task 5, `data.js` is fully async but `app.js` still calls it synchronously — the app will not render correctly until Task 8 completes the `app.js` migration. Run this on a feature branch; intermediate states are expected.

---

### Task 1: Supabase project setup (manual — no code changes)

**Files:**
- Supabase SQL editor (no local files changed)

- [ ] **Step 1: Create Supabase project**

  Go to [supabase.com](https://supabase.com) → New project. Note the **Project URL** (`https://xxxx.supabase.co`) and the **anon public key** from Settings → API.

- [ ] **Step 2: Generate your USER_ID UUID**

  Run this in your browser console or any UUID generator:
  ```js
  crypto.randomUUID()
  ```
  Save the result — you'll hardcode it in `data.js` and in the SQL below. Example: `a1b2c3d4-e5f6-7890-abcd-ef1234567890`

- [ ] **Step 3: Run schema SQL in Supabase SQL editor**

  Project → SQL Editor → New query. Paste and run:

  ```sql
  -- Single user row (insert your UUID)
  CREATE TABLE users (
    id UUID PRIMARY KEY
  );
  INSERT INTO users (id) VALUES ('YOUR-USER-UUID');

  CREATE TABLE products (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL REFERENCES users(id),
    brand             TEXT,
    name              TEXT NOT NULL,
    type              TEXT NOT NULL,
    carbs_per_unit    INTEGER NOT NULL DEFAULT 0,
    sodium_per_unit   INTEGER NOT NULL DEFAULT 0,
    caffeine_per_unit INTEGER NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE events (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id),
    name       TEXT NOT NULL,
    date       DATE,
    type       TEXT NOT NULL DEFAULT 'other',
    notes      TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE segments (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id          UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name              TEXT NOT NULL,
    duration_hours    REAL NOT NULL DEFAULT 1,
    carbs_per_hour    INTEGER NOT NULL DEFAULT 0,
    sodium_per_hour   INTEGER NOT NULL DEFAULT 0,
    caffeine_per_hour INTEGER NOT NULL DEFAULT 0,
    sort_order        INTEGER NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE items (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    segment_id        UUID NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
    product_id        UUID REFERENCES products(id) ON DELETE SET NULL,
    name              TEXT NOT NULL,
    brand             TEXT,
    type              TEXT NOT NULL,
    carbs_per_unit    INTEGER NOT NULL DEFAULT 0,
    sodium_per_unit   INTEGER NOT NULL DEFAULT 0,
    caffeine_per_unit INTEGER NOT NULL DEFAULT 0,
    quantity          INTEGER NOT NULL DEFAULT 1,
    sort_order        INTEGER NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  ```

- [ ] **Step 4: Run RLS policies in Supabase SQL editor**

  New query. Replace `YOUR-USER-UUID` with your actual UUID:

  ```sql
  ALTER TABLE products ENABLE ROW LEVEL SECURITY;
  ALTER TABLE events   ENABLE ROW LEVEL SECURITY;
  ALTER TABLE segments ENABLE ROW LEVEL SECURITY;
  ALTER TABLE items    ENABLE ROW LEVEL SECURITY;

  CREATE POLICY "personal_access" ON products
    USING (user_id = 'YOUR-USER-UUID'::UUID);

  CREATE POLICY "personal_access" ON events
    USING (user_id = 'YOUR-USER-UUID'::UUID);

  CREATE POLICY "personal_access" ON segments
    USING (event_id IN (
      SELECT id FROM events WHERE user_id = 'YOUR-USER-UUID'::UUID
    ));

  CREATE POLICY "personal_access" ON items
    USING (segment_id IN (
      SELECT id FROM segments
      WHERE event_id IN (
        SELECT id FROM events WHERE user_id = 'YOUR-USER-UUID'::UUID
      )
    ));
  ```

- [ ] **Step 5: Create save_event RPC function in Supabase SQL editor**

  New query. Replace `YOUR-USER-UUID` in the security guard:

  ```sql
  CREATE OR REPLACE FUNCTION save_event(event_data jsonb)
  RETURNS void AS $$
  DECLARE
    evt_id UUID;
    seg    jsonb;
    seg_id UUID;
    itm    jsonb;
  BEGIN
    -- Reject writes to any user other than the hardcoded owner
    IF (event_data->>'user_id')::UUID != 'YOUR-USER-UUID'::UUID THEN
      RAISE EXCEPTION 'unauthorized';
    END IF;

    -- Upsert event row
    INSERT INTO events (id, user_id, name, date, type, notes)
    VALUES (
      (event_data->>'id')::UUID,
      (event_data->>'user_id')::UUID,
      event_data->>'name',
      NULLIF(event_data->>'date', '')::DATE,
      COALESCE(event_data->>'type', 'other'),
      event_data->>'notes'
    )
    ON CONFLICT (id) DO UPDATE SET
      name       = EXCLUDED.name,
      date       = EXCLUDED.date,
      type       = EXCLUDED.type,
      notes      = EXCLUDED.notes,
      updated_at = now();

    evt_id := (event_data->>'id')::UUID;

    -- Remove existing segments (cascades to items)
    DELETE FROM segments WHERE event_id = evt_id;

    -- Re-insert segments and items
    FOR seg IN SELECT * FROM jsonb_array_elements(event_data->'segments')
    LOOP
      seg_id := (seg->>'id')::UUID;

      INSERT INTO segments (id, event_id, name, duration_hours,
                            carbs_per_hour, sodium_per_hour, caffeine_per_hour, sort_order)
      VALUES (
        seg_id,
        evt_id,
        seg->>'name',
        (seg->>'durationHours')::REAL,
        COALESCE((seg->'targets'->>'carbsPerHour')::INTEGER, 0),
        COALESCE((seg->'targets'->>'sodiumPerHour')::INTEGER, 0),
        COALESCE((seg->'targets'->>'caffeinePerHour')::INTEGER, 0),
        COALESCE((seg->>'sortOrder')::INTEGER, 0)
      );

      FOR itm IN SELECT * FROM jsonb_array_elements(seg->'items')
      LOOP
        INSERT INTO items (id, segment_id, product_id, name, brand, type,
                           carbs_per_unit, sodium_per_unit, caffeine_per_unit,
                           quantity, sort_order)
        VALUES (
          (itm->>'id')::UUID,
          seg_id,
          NULLIF(itm->>'productId', 'null')::UUID,
          itm->>'name',
          itm->>'brand',
          itm->>'type',
          COALESCE((itm->>'carbsPerUnit')::INTEGER, 0),
          COALESCE((itm->>'sodiumPerUnit')::INTEGER, 0),
          COALESCE((itm->>'caffeinePerUnit')::INTEGER, 0),
          COALESCE((itm->>'quantity')::INTEGER, 1),
          COALESCE((itm->>'sortOrder')::INTEGER, 0)
        );
      END LOOP;
    END LOOP;
  END;
  $$ LANGUAGE plpgsql SECURITY DEFINER;

  GRANT EXECUTE ON FUNCTION save_event(jsonb) TO anon;
  ```

- [ ] **Step 6: Verify setup**

  Run these queries in Supabase SQL Editor to confirm the tables and RLS are in place:

  ```sql
  SELECT tablename FROM pg_tables WHERE schemaname = 'public';
  -- Expected: users, products, events, segments, items

  SELECT routine_name FROM information_schema.routines
  WHERE routine_schema = 'public' AND routine_name = 'save_event';
  -- Expected: 1 row
  ```

---

### Task 2: Rewrite data.js

**Files:**
- Modify: `data.js` (full rewrite)

- [ ] **Step 1: Replace data.js with the new Supabase implementation**

  Replace the entire contents of `data.js` with the following. Fill in `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `USER_ID` with the values from Task 1:

  ```js
  // data.js
  (function (exports) {
    'use strict';

    // ── Config ──────────────────────────────────────────────────────────────────
    // Fill these in from your Supabase project Settings → API
    var SUPABASE_URL  = 'https://YOUR_PROJECT_REF.supabase.co';
    var SUPABASE_ANON_KEY = 'YOUR_ANON_KEY';
    var USER_ID = 'YOUR-USER-UUID'; // the UUID you generated and used in the SQL

    var KEYS = {
      recent:   'fuelPlanner.recentProducts',
      migrated: 'fuelPlanner.migrated'
    };

    // ── Supabase fetch helper ────────────────────────────────────────────────────
    async function supabaseRequest(method, path, body, prefer) {
      var defaultPrefer = method === 'POST' ? 'return=representation' : '';
      var preferValue = prefer !== undefined ? prefer : defaultPrefer;
      var headers = {
        'apikey':        SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
        'Content-Type':  'application/json'
      };
      if (preferValue) headers['Prefer'] = preferValue;
      var res = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
        method:  method,
        headers: headers,
        body:    body ? JSON.stringify(body) : undefined
      });
      if (!res.ok) throw new Error(await res.text());
      if (res.status === 204) return null;
      // Use text() first to guard against empty bodies (e.g. void RPC responses)
      var text = await res.text();
      return text ? JSON.parse(text) : null;
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
        id:               p.id,
        user_id:          USER_ID,
        brand:            p.brand || null,
        name:             p.name,
        type:             p.type,
        carbs_per_unit:   p.carbsPerUnit    || 0,
        sodium_per_unit:  p.sodiumPerUnit   || 0,
        caffeine_per_unit: p.caffeinePerUnit || 0
      };
    }

    function dbToEvent(row) {
      return {
        id:       row.id,
        name:     row.name,
        date:     row.date || '',
        type:     row.type || 'other',
        notes:    row.notes || '',
        segments: (row.segments || [])
          .slice()
          .sort(function (a, b) { return a.sort_order - b.sort_order; })
          .map(function (seg) {
            return {
              id:            seg.id,
              name:          seg.name,
              durationHours: seg.duration_hours,
              targets: {
                carbsPerHour:   seg.carbs_per_hour   || 0,
                sodiumPerHour:  seg.sodium_per_hour  || 0,
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
        user_id: USER_ID,
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
    // Uses crypto.randomUUID() — available in all modern browsers and Netlify's CDN edge
    function generateId() {
      return crypto.randomUUID();
    }

    // ── Products ─────────────────────────────────────────────────────────────────

    async function getProducts() {
      var rows = await supabaseRequest(
        'GET',
        'products?user_id=eq.' + USER_ID + '&select=*&order=created_at.asc'
      );
      return rows.map(dbToProduct);
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
      // Keep recents clean — this stays in localStorage
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
        'events?user_id=eq.' + USER_ID + '&select=*,segments(*,items(*))&order=date.desc.nullslast'
      );
      return rows.map(dbToEvent);
    }

    async function getEvent(id) {
      var rows = await supabaseRequest(
        'GET',
        'events?id=eq.' + id + '&select=*,segments(*,items(*))'
      );
      return rows.length ? dbToEvent(rows[0]) : null;
    }

    async function saveEvent(evt) {
      // save_event returns void — use return=minimal so PostgREST doesn't try to serialise output
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

    // ── Recent products — stays in localStorage (per-device convenience) ─────────

    // Returns an array of product IDs (strings), most-recent first
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
    // On first load, moves any existing localStorage data to Supabase.
    // Sets fuelPlanner.migrated = 'true' on success; leaves localStorage untouched on error.

    async function migrateIfNeeded() {
      if (localStorage.getItem(KEYS.migrated) === 'true') return;

      // If Supabase already has data (e.g. migrated from another device), just mark done
      var existingEvents   = await supabaseRequest('GET', 'events?user_id=eq.'   + USER_ID + '&select=id&limit=1');
      var existingProducts = await supabaseRequest('GET', 'products?user_id=eq.' + USER_ID + '&select=id&limit=1');
      if (existingEvents.length > 0 || existingProducts.length > 0) {
        localStorage.setItem(KEYS.migrated, 'true');
        return;
      }

      // Read old localStorage data
      var oldProducts = [];
      var oldEvents   = [];
      try {
        oldProducts = JSON.parse(localStorage.getItem('fuelPlanner.products') || '[]');
        oldEvents   = JSON.parse(localStorage.getItem('fuelPlanner.events')   || '[]');
      } catch (e) {}

      // Nothing to migrate
      if (!oldProducts.length && !oldEvents.length) {
        localStorage.setItem(KEYS.migrated, 'true');
        return;
      }

      // Old IDs are short alphanumeric strings, not UUIDs.
      // Assign new UUIDs to all entities; remap productId references.
      var productIdMap = {};
      var migratedProducts = oldProducts.map(function (p) {
        var newId = generateId();
        productIdMap[p.id] = newId;
        return Object.assign({}, p, { id: newId });
      });

      for (var i = 0; i < migratedProducts.length; i++) {
        await saveProduct(migratedProducts[i]);
      }

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
      // Note: on error, the caller (init in app.js) catches and shows a toast.
      // localStorage is left untouched so migration retries next load.
    }

    // ── Calculations (unchanged) ──────────────────────────────────────────────────

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
      if (ratio >= 0.9 && ratio <= 1.1)   return 'on-target';
      if (ratio >= 0.75 && ratio < 0.9)   return 'warning-under';
      if (ratio > 1.1  && ratio <= 1.25)  return 'warning-over';
      return ratio < 0.75 ? 'under' : 'over';
    }

    // ── Factories (unchanged, updated to use crypto.randomUUID via generateId) ────

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
        id:       generateId(),
        name:     name || 'New Event',
        date:     new Date().toISOString().slice(0, 10),
        type:     'ride',
        notes:    '',
        segments: [newSegment(name || 'New Event', 1)]
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

    exports.generateId       = generateId;
    exports.getProducts      = getProducts;
    exports.saveProduct      = saveProduct;
    exports.deleteProduct    = deleteProduct;
    exports.getEvents        = getEvents;
    exports.getEvent         = getEvent;
    exports.saveEvent        = saveEvent;
    exports.deleteEvent      = deleteEvent;
    exports.getRecentProducts = getRecentProducts;
    exports.recordProductUsed = recordProductUsed;
    exports.migrateIfNeeded  = migrateIfNeeded;
    exports.calcSegmentTotals = calcSegmentTotals;
    exports.calcSegmentRates  = calcSegmentRates;
    exports.calcEventTotals   = calcEventTotals;
    exports.calcEventRates    = calcEventRates;
    exports.rateStatus        = rateStatus;
    exports.newSegment        = newSegment;
    exports.newEvent          = newEvent;
    exports.itemFromProduct   = itemFromProduct;
    exports.itemFromOneOff    = itemFromOneOff;

  })(typeof module !== 'undefined' ? module.exports : (window.Data = window.Data || {}));
  ```

- [ ] **Step 2: Verify data.js has no syntax errors**

  Run:
  ```bash
  node --check data.js
  ```
  Expected: no output (no errors).

- [ ] **Step 3: Commit**

  ```bash
  git add data.js
  git commit -m "feat: rewrite data.js with async Supabase fetch calls"
  ```

---

### Task 3: Add loading spinner and toast markup to index.html and style.css

**Files:**
- Modify: `index.html`
- Modify: `style.css`

- [ ] **Step 1: Add loading spinner and toast container to index.html**

  In `index.html`, add the following just before the closing `</body>` tag (before the `<script>` tags):

  ```html
  <!-- ── Loading spinner ─────────────────────────────────────────────── -->
  <div id="loading-overlay" class="loading-overlay hidden">
    <div class="loading-spinner"></div>
  </div>

  <!-- ── Toast notification ──────────────────────────────────────────── -->
  <div id="toast" class="toast hidden"></div>
  ```

- [ ] **Step 2: Add loading and toast styles to style.css**

  Append to the end of `style.css`:

  ```css
  /* ── Loading spinner ─────────────────────────────────────────────────────── */
  .loading-overlay {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, 0.7);
    z-index: 200;
  }
  .loading-overlay.hidden { display: none; }

  .loading-spinner {
    width: 32px;
    height: 32px;
    border: 3px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* Inline container spinner (used inside view bodies while data loads) */
  .container-spinner {
    display: flex;
    justify-content: center;
    padding: 48px 0;
  }
  .container-spinner::after {
    content: '';
    width: 28px;
    height: 28px;
    border: 3px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }

  /* ── Toast ───────────────────────────────────────────────────────────────── */
  .toast {
    position: fixed;
    bottom: calc(env(safe-area-inset-bottom) + 80px);
    left: 50%;
    transform: translateX(-50%);
    background: #1a1a1a;
    color: #fff;
    padding: 10px 20px;
    border-radius: 20px;
    font-size: 14px;
    font-weight: 500;
    white-space: nowrap;
    z-index: 300;
    opacity: 1;
    transition: opacity 0.3s ease;
  }
  .toast.hidden { display: none; }
  .toast.fade-out { opacity: 0; }

  @media (min-width: 768px) {
    .toast { bottom: 32px; }
  }
  ```

- [ ] **Step 3: Verify**

  Open `index.html` in the browser. Confirm the page loads without errors (the loading overlay and toast are invisible by default).

- [ ] **Step 4: Commit**

  ```bash
  git add index.html style.css
  git commit -m "feat: add loading spinner and toast markup and styles"
  ```

---

### Task 4: Add async utilities to app.js and update navigate() and init()

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Add showLoading, showToast, and showContainerSpinner utilities**

  In `app.js`, add these three functions immediately after the `fmt` function (after line `return rounded + (unit || '');`), before the `TYPE_LABELS` declaration:

  ```js
  function showContainerSpinner(el) {
    if (el) el.innerHTML = '<div class="container-spinner"></div>';
  }

  var _toastTimer = null;
  function showToast(message) {
    var el = $('toast');
    if (!el) return;
    if (_toastTimer) clearTimeout(_toastTimer);
    el.textContent = message;
    el.className = 'toast';
    _toastTimer = setTimeout(function () {
      el.classList.add('fade-out');
      setTimeout(function () { el.className = 'toast hidden'; }, 300);
    }, 4000);
  }
  ```

- [ ] **Step 2: Update navigate() to handle async render functions**

  In `app.js`, the current `navigate` function ends with:
  ```js
    // Render the new view
    if (renders[view]) renders[view]();
  }
  ```

  Replace those two lines with:
  ```js
    // Render the new view — attach .catch() so async renders don't silently swallow errors
    if (renders[view]) {
      var renderResult = renders[view]();
      if (renderResult && typeof renderResult.catch === 'function') {
        renderResult.catch(function (e) {
          console.error('Render error:', e);
          showToast("Couldn't load — check your connection.");
        });
      }
    }
  }
  ```

- [ ] **Step 3: Update init() to call migrateIfNeeded before first render**

  Replace the current `init` function:
  ```js
  function init() {
    // Tab bar
    $$('.tab-btn').forEach(function (btn) {
      on(btn, 'click', function () { navigate(btn.dataset.tabView); });
    });
    navigate('events');
  }
  ```

  With:
  ```js
  async function init() {
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

- [ ] **Step 4: Verify data.js syntax**

  ```bash
  node --check app.js
  ```
  Expected: no output.

- [ ] **Step 5: Commit**

  ```bash
  git add app.js
  git commit -m "feat: add showContainerSpinner, showToast utilities; make navigate async-safe; init calls migrateIfNeeded"
  ```

---

### Task 5: Make renderEventsList async

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Replace renderEventsList with an async version**

  Replace the current `renderEventsList` function (lines 116–150 in the original; the function that starts with `function renderEventsList()`) with:

  ```js
  async function renderEventsList() {
    var $list = $('events-list');
    showContainerSpinner($list);
    var events;
    try {
      events = (await Data.getEvents()).slice().sort(function (a, b) {
        return (b.date || '').localeCompare(a.date || '');
      });
    } catch (e) {
      $list.innerHTML = '';
      showToast("Couldn't load events — check your connection.");
      return;
    }

    if (!events.length) {
      $list.innerHTML = '<div class="empty-state"><div style="font-size:48px">🚴</div><p>No events yet.</p><p>Tap + to plan your first one.</p></div>';
      return;
    }
    $list.innerHTML = events.map(function (evt) {
      var totals = Data.calcEventTotals(evt);
      var totalHours = totals.durationHours;
      var hLabel = totalHours === Math.floor(totalHours)
        ? totalHours + 'h'
        : totalHours.toFixed(1) + 'h';
      return '<div class="event-card" data-event-id="' + evt.id + '">' +
        '<div class="event-card-row">' +
          '<span class="event-card-name">' + escHtml(evt.name) + '</span>' +
          '<span class="type-badge">' + (EVENT_TYPE_LABELS[evt.type] || escHtml(evt.type)) + '</span>' +
        '</div>' +
        '<div class="event-card-meta">' +
          (evt.date ? escHtml(evt.date) + ' · ' : '') +
          hLabel + ' · ' +
          Math.round(totals.carbs) + 'g carbs · ' +
          Math.round(totals.sodium) + 'mg Na' +
        '</div>' +
      '</div>';
    }).join('');

    $list.querySelectorAll('.event-card').forEach(function (card) {
      on(card, 'click', function () {
        navigate('detail', { currentEventId: card.dataset.eventId });
      });
    });
  }
  ```

- [ ] **Step 2: Verify syntax**

  ```bash
  node --check app.js
  ```
  Expected: no output.

- [ ] **Step 3: Commit**

  ```bash
  git add app.js
  git commit -m "feat: make renderEventsList async with Supabase data fetch"
  ```

---

### Task 6: Make renderCreate and event form handlers async

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Replace renderCreate with an async version**

  Replace the current `renderCreate` function with:

  ```js
  async function renderCreate() {
    var isEdit = !!state.currentEventId;
    var evt = null;
    if (isEdit) {
      try {
        evt = await Data.getEvent(state.currentEventId);
      } catch (e) {
        showToast("Couldn't load event — check your connection.");
        return;
      }
      if (!evt) { navigate('events'); return; }
    }

    $('create-title').textContent = isEdit ? 'Edit Event' : 'New Event';
    $('btn-save-event').textContent = isEdit ? 'Save Changes' : 'Save Event';
    $('btn-delete-event').style.display = isEdit ? '' : 'none';

    $('ef-name').value  = evt ? evt.name : '';
    $('ef-date').value  = evt ? (evt.date || '') : new Date().toISOString().slice(0, 10);
    $('ef-type').value  = evt ? evt.type : 'ride';
    $('ef-notes').value = evt ? (evt.notes || '') : '';

    draftSegments = evt
      ? evt.segments.map(function (s) { return JSON.parse(JSON.stringify(s)); })
      : [Data.newSegment('', 1)];

    renderSegmentForms();
  }
  ```

- [ ] **Step 2: Replace the event-form submit handler with an async version**

  Replace the current `on($('event-form'), 'submit', ...)` handler with:

  ```js
  on($('event-form'), 'submit', async function (e) {
    e.preventDefault();
    var name = $('ef-name').value.trim();
    if (!name) { $('ef-name').focus(); return; }

    var segCards = $$('[data-seg-draft-id]');
    var segments = Array.from(segCards).map(function (card) {
      var id = card.dataset.segDraftId;
      var existing = draftSegments.find(function (s) { return s.id === id; });
      return {
        id:            id,
        name:          card.querySelector('.seg-name').value.trim() || name,
        durationHours: parseFloat(card.querySelector('.seg-duration').value) || 1,
        targets: {
          carbsPerHour:    parseFloat(card.querySelector('.seg-carbs-target').value)   || 0,
          sodiumPerHour:   parseFloat(card.querySelector('.seg-sodium-target').value)  || 0,
          caffeinePerHour: parseFloat(card.querySelector('.seg-caffeine-target').value) || 0
        },
        items: existing ? (existing.items || []) : []
      };
    });

    var isEdit = !!state.currentEventId;
    var evt;
    if (isEdit) {
      var base;
      try { base = await Data.getEvent(state.currentEventId); }
      catch (e) { showToast("Couldn't load event — check your connection."); return; }
      if (!base) { navigate('events'); return; }
      evt = Object.assign({}, base, {
        name:     name,
        date:     $('ef-date').value,
        type:     $('ef-type').value,
        notes:    $('ef-notes').value.trim(),
        segments: segments
      });
    } else {
      evt = Object.assign(Data.newEvent(name), {
        date:     $('ef-date').value,
        type:     $('ef-type').value,
        notes:    $('ef-notes').value.trim(),
        segments: segments
      });
    }

    var saveBtn = $('btn-save-event');
    saveBtn.disabled = true;
    try {
      await Data.saveEvent(evt);
      navigate('detail', { currentEventId: evt.id });
    } catch (e) {
      showToast("Couldn't save — check your connection.");
    } finally {
      saveBtn.disabled = false;
    }
  });
  ```

- [ ] **Step 3: Replace the btn-delete-event click handler with an async version**

  Replace the current `on($('btn-delete-event'), 'click', ...)` handler with:

  ```js
  on($('btn-delete-event'), 'click', async function () {
    var evt;
    try { evt = await Data.getEvent(state.currentEventId); }
    catch (e) { showToast("Couldn't load event — check your connection."); return; }
    if (!evt) return;
    if (!confirm('Delete "' + evt.name + '"? This cannot be undone.')) return;
    try {
      await Data.deleteEvent(evt.id);
      navigate('events');
    } catch (e) {
      showToast("Couldn't delete — check your connection.");
    }
  });
  ```

- [ ] **Step 4: Verify syntax**

  ```bash
  node --check app.js
  ```
  Expected: no output.

- [ ] **Step 5: Commit**

  ```bash
  git add app.js
  git commit -m "feat: make renderCreate and event form submit/delete handlers async"
  ```

---

### Task 7: Make renderDetail, updateItemQty, and inline edit async

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Replace renderDetail with an async version**

  Replace the current `renderDetail` function with:

  ```js
  async function renderDetail() {
    // Show spinner while fetching — clears automatically when body is replaced below
    showContainerSpinner($('detail-body'));

    var evt;
    try {
      evt = await Data.getEvent(state.currentEventId);
    } catch (e) {
      $('detail-body').innerHTML = '';
      showToast("Couldn't load event — check your connection.");
      return;
    }
    if (!evt) { navigate('events'); return; }

    $('detail-event-name').textContent = evt.name;

    var totals = Data.calcEventTotals(evt);
    var rates  = Data.calcEventRates(evt);
    var totalH = totals.durationHours;
    $('detail-summary').innerHTML =
      '<div class="event-meta-row">' +
        '<span class="type-badge">' + (EVENT_TYPE_LABELS[evt.type] || escHtml(evt.type)) + '</span>' +
        (evt.date ? '<span class="event-meta-date">' + escHtml(evt.date) + '</span>' : '') +
      '</div>' +
      '<div class="summary-cards">' +
        metricCardHTML('carbs',    Math.round(totals.carbs)    + 'g',  fmt(rates.carbs,    'g/hr avg'))  +
        metricCardHTML('sodium',   Math.round(totals.sodium)   + 'mg', fmt(rates.sodium,   'mg/hr avg')) +
        metricCardHTML('caffeine', Math.round(totals.caffeine) + 'mg', fmt(rates.caffeine, 'mg/hr avg')) +
      '</div>';

    var multiSeg = evt.segments.length > 1;
    var $body = $('detail-body');
    $body.innerHTML = evt.segments.map(function (seg) {
      return segmentSectionHTML(seg, multiSeg);
    }).join('') +
    (multiSeg ? totalsFooterHTML(totals, totalH) : '');

    attachDetailHandlers(evt);
  }
  ```

- [ ] **Step 2: Replace updateItemQty with an async version**

  Replace the current `updateItemQty` function with:

  ```js
  async function updateItemQty(eventId, segId, itemId, delta) {
    var evt;
    try { evt = await Data.getEvent(eventId); }
    catch (e) { showToast("Couldn't load event — check your connection."); return; }
    if (!evt) return;

    var seg = evt.segments.find(function (s) { return s.id === segId; });
    if (!seg) return;
    var item = seg.items.find(function (i) { return i.id === itemId; });
    if (!item) return;

    item.quantity = Math.max(0, item.quantity + delta);
    if (item.quantity === 0) {
      seg.items = seg.items.filter(function (i) { return i.id !== itemId; });
    }

    try {
      await Data.saveEvent(evt);
      await renderDetail();
    } catch (e) {
      showToast("Couldn't save — check your connection.");
    }
  }
  ```

- [ ] **Step 3: Update the detail-event-name inline save callback in attachDetailHandlers**

  In `attachDetailHandlers`, replace the `$('detail-event-name').onclick` assignment with:

  ```js
  $('detail-event-name').onclick = function () {
    makeEditable($('detail-event-name'), async function (val) {
      try {
        var updated = await Data.getEvent(evt.id);
        if (!updated) return;
        updated.name = val;
        await Data.saveEvent(updated);
        await renderDetail();
      } catch (e) {
        showToast("Couldn't save — check your connection.");
      }
    });
  };
  ```

- [ ] **Step 4: Update handleInlineEdit to use async saveSegmentField**

  Replace the entire `handleInlineEdit` function with:

  ```js
  function handleInlineEdit(el, eventId) {
    var segSection = el.closest('[data-segment-id]');
    if (!segSection) return;
    var segId = segSection.dataset.segmentId;
    var field = el.dataset.inline;

    async function saveSegmentField(value) {
      try {
        var evt = await Data.getEvent(eventId);
        if (!evt) return;
        var seg = evt.segments.find(function (s) { return s.id === segId; });
        if (!seg) return;
        var num = parseFloat(value);
        if (field === 'seg-name') {
          seg.name = value || seg.name;
        } else if (field === 'seg-duration') {
          if (num > 0) seg.durationHours = num;
        } else if (field === 'seg-carbs-target') {
          if (!isNaN(num) && num >= 0) seg.targets.carbsPerHour = num;
        } else if (field === 'seg-sodium-target') {
          if (!isNaN(num) && num >= 0) seg.targets.sodiumPerHour = num;
        } else if (field === 'seg-caff-target') {
          if (!isNaN(num) && num >= 0) seg.targets.caffeinePerHour = num;
        }
        await Data.saveEvent(evt);
        await renderDetail();
      } catch (e) {
        showToast("Couldn't save — check your connection.");
      }
    }

    // Strip display formatting so the inline input shows just the raw number
    if (field !== 'seg-name') {
      var raw = el.textContent.trim();
      el.textContent = parseFloat(raw.replace(/[^0-9.]/g, '')) || 0;
    }

    makeEditable(el, saveSegmentField);
  }
  ```

- [ ] **Step 5: Verify syntax**

  ```bash
  node --check app.js
  ```
  Expected: no output.

- [ ] **Step 6: Commit**

  ```bash
  git add app.js
  git commit -m "feat: make renderDetail, updateItemQty, and inline edit handlers async"
  ```

---

### Task 8: Make add-item sheet handlers async

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Replace addItemToSegment with an async version**

  Replace the current `addItemToSegment` function with:

  ```js
  async function addItemToSegment(eventId, segmentId, item) {
    var evt = await Data.getEvent(eventId);
    if (!evt) return;
    var seg = evt.segments.find(function (s) { return s.id === segmentId; });
    if (!seg) return;
    seg.items.push(item);
    await Data.saveEvent(evt);
  }
  ```

- [ ] **Step 2: Replace renderSheetLibraryTab with an async version**

  Replace the current `renderSheetLibraryTab` function with:

  ```js
  async function renderSheetLibraryTab(query) {
    var products;
    try {
      products = await Data.getProducts();
    } catch (e) {
      showToast("Couldn't load library — check your connection.");
      return;
    }

    // Resolve recent product IDs against the full product list
    var recentIds = Data.getRecentProducts(); // returns array of IDs
    var recent = recentIds
      .map(function (id) { return products.find(function (p) { return p.id === id; }); })
      .filter(Boolean);

    var $recentSection = $('recent-products-section');
    if (!query && recent.length) {
      $recentSection.style.display = '';
      $('recent-products-list').innerHTML = recent.map(function (p) {
        return productRowSheetHTML(p);
      }).join('');
      attachSheetProductHandlers($('recent-products-list'));
    } else {
      $recentSection.style.display = 'none';
    }

    var filtered = query
      ? products.filter(function (p) {
          var q = query.toLowerCase();
          return (p.name  || '').toLowerCase().includes(q) ||
                 (p.brand || '').toLowerCase().includes(q) ||
                 (TYPE_LABELS[p.type] || p.type || '').toLowerCase().includes(q);
        })
      : products.filter(function (p) { return recentIds.indexOf(p.id) === -1; });

    var $results = $('product-search-results');
    if (!query && !products.length) {
      $results.innerHTML = '<div style="padding:16px 0;font-size:14px;color:var(--text-tertiary)">Your library is empty. Add products via the Library tab.</div>';
      return;
    }
    $results.innerHTML = filtered.map(function (p) {
      return productRowSheetHTML(p);
    }).join('');
    attachSheetProductHandlers($results);
  }
  ```

- [ ] **Step 3: Replace attachSheetProductHandlers with an async-aware version**

  Replace the current `attachSheetProductHandlers` function with:

  ```js
  function attachSheetProductHandlers($container) {
    $$('.product-row', $container).forEach(function (row) {
      on(row, 'click', async function () {
        var productId = row.dataset.productId;
        var products;
        try { products = await Data.getProducts(); }
        catch (e) { showToast("Couldn't load product — check your connection."); return; }

        var product = products.find(function (p) { return p.id === productId; });
        if (!product || !_sheetEventId || !_sheetSegmentId) return;

        try {
          await addItemToSegment(_sheetEventId, _sheetSegmentId, Data.itemFromProduct(product));
          Data.recordProductUsed(productId);
          closeSheet();
          await renderDetail();
        } catch (e) {
          showToast("Couldn't add item — check your connection.");
        }
      });
    });
  }
  ```

- [ ] **Step 4: Replace the oneoff-form submit handler with an async version**

  Replace the current `on($('oneoff-form'), 'submit', ...)` handler with:

  ```js
  on($('oneoff-form'), 'submit', async function (e) {
    e.preventDefault();
    var name = $('oo-name').value.trim();
    if (!name) { $('oo-name').focus(); return; }

    var fields = {
      name:            name,
      brand:           $('oo-brand').value.trim(),
      type:            $('oo-type').value,
      carbsPerUnit:    $('oo-carbs').value,
      sodiumPerUnit:   $('oo-sodium').value,
      caffeinePerUnit: $('oo-caffeine').value
    };
    var item = Data.itemFromOneOff(fields);

    try {
      if ($('oo-save-library').checked) {
        var product = Object.assign({ id: Data.generateId() }, fields, {
          carbsPerUnit:    Number(fields.carbsPerUnit)    || 0,
          sodiumPerUnit:   Number(fields.sodiumPerUnit)   || 0,
          caffeinePerUnit: Number(fields.caffeinePerUnit) || 0
        });
        await Data.saveProduct(product);
        item.productId = product.id;
        Data.recordProductUsed(product.id);
      }
      await addItemToSegment(_sheetEventId, _sheetSegmentId, item);
      closeSheet();
      await renderDetail();
    } catch (e) {
      showToast("Couldn't save — check your connection.");
    }
  });
  ```

- [ ] **Step 5: Update the live-search handler and sheet tab-switch to await renderSheetLibraryTab**

  The live-search handler currently calls `renderSheetLibraryTab(...)` directly. Since it's now async, attach a `.catch()`:

  Replace:
  ```js
  on($('product-search'), 'input', function () {
    renderSheetLibraryTab($('product-search').value.trim());
  });
  ```
  With:
  ```js
  on($('product-search'), 'input', function () {
    renderSheetLibraryTab($('product-search').value.trim()).catch(function (e) {
      showToast("Couldn't search — check your connection.");
    });
  });
  ```

  In the sheet tab-switching handler, replace:
  ```js
  if (tab === 'library') renderSheetLibraryTab($('product-search').value.trim());
  ```
  With:
  ```js
  if (tab === 'library') {
    renderSheetLibraryTab($('product-search').value.trim()).catch(function (e) {
      showToast("Couldn't load library — check your connection.");
    });
  }
  ```

  In `openAddItemSheet`, replace:
  ```js
  renderSheetLibraryTab();
  ```
  With:
  ```js
  renderSheetLibraryTab().catch(function (e) {
    showToast("Couldn't load library — check your connection.");
  });
  ```

- [ ] **Step 6: Verify syntax**

  ```bash
  node --check app.js
  ```
  Expected: no output.

- [ ] **Step 7: Commit**

  ```bash
  git add app.js
  git commit -m "feat: make add-item sheet handlers async"
  ```

---

### Task 9: Make renderLibrary, renderProductForm, and product form handlers async

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Replace renderLibrary with an async version**

  Replace the current `renderLibrary` function with:

  ```js
  async function renderLibrary() {
    var $body = $('library-body');
    showContainerSpinner($body);

    var products;
    try {
      products = await Data.getProducts();
    } catch (e) {
      $body.innerHTML = '';
      showToast("Couldn't load library — check your connection.");
      return;
    }

    var desktopBtn = '<button class="btn-new-product-desktop" id="btn-new-product-desktop">+ New Product</button>';

    if (!products.length) {
      $body.innerHTML = desktopBtn + '<div class="empty-state"><div style="font-size:48px">📦</div><p>No products yet.</p><p>Tap + to add your first product.</p></div>';
      var dbtn = $('btn-new-product-desktop');
      if (dbtn) on(dbtn, 'click', function () { navigate('product-form', { editingProductId: null }); });
      return;
    }

    var groups = {};
    products.forEach(function (p) {
      var key = p.type || 'other';
      if (!groups[key]) groups[key] = [];
      groups[key].push(p);
    });

    var types = TYPE_ORDER.concat(
      Object.keys(groups).filter(function (t) { return TYPE_ORDER.indexOf(t) === -1; })
    ).filter(function (t) { return groups[t]; });

    $body.innerHTML = desktopBtn + types.map(function (type) {
      return '<div class="product-group">' +
        '<div class="product-group-title">' + escHtml(TYPE_LABELS[type] || type) + 's</div>' +
        groups[type].map(function (p) {
          var meta = [];
          if (p.carbsPerUnit)    meta.push(p.carbsPerUnit + 'g carbs');
          if (p.sodiumPerUnit)   meta.push(p.sodiumPerUnit + 'mg Na');
          if (p.caffeinePerUnit) meta.push(p.caffeinePerUnit + 'mg caff');
          return '<div class="product-row" data-product-id="' + p.id + '">' +
            '<div class="product-row-info">' +
              '<div class="product-row-name">' + escHtml((p.brand ? p.brand + ' ' : '') + p.name) + '</div>' +
              '<div class="product-row-meta">' + meta.join(' · ') + '</div>' +
            '</div>' +
            '<span style="color:var(--text-tertiary);font-size:20px">&#8250;</span>' +
          '</div>';
        }).join('') +
      '</div>';
    }).join('');

    $$('.product-row', $body).forEach(function (row) {
      on(row, 'click', function () {
        navigate('product-form', { editingProductId: row.dataset.productId });
      });
    });

    var dbtn = $('btn-new-product-desktop');
    if (dbtn) on(dbtn, 'click', function () { navigate('product-form', { editingProductId: null }); });
  }
  ```

- [ ] **Step 2: Replace renderProductForm with an async version**

  Replace the current `renderProductForm` function with:

  ```js
  async function renderProductForm() {
    var isEdit = !!state.editingProductId;
    var product = null;
    if (isEdit) {
      var products;
      try { products = await Data.getProducts(); }
      catch (e) { showToast("Couldn't load product — check your connection."); return; }
      product = products.find(function (p) { return p.id === state.editingProductId; }) || null;
    }

    $('pf-title').textContent   = isEdit ? 'Edit Product' : 'New Product';
    $('btn-delete-product').style.display = isEdit ? '' : 'none';
    $('pf-brand').value    = product ? (product.brand    || '') : '';
    $('pf-name').value     = product ? product.name           : '';
    $('pf-type').value     = product ? product.type           : 'gel';
    $('pf-carbs').value    = product ? product.carbsPerUnit    : 0;
    $('pf-sodium').value   = product ? product.sodiumPerUnit   : 0;
    $('pf-caffeine').value = product ? product.caffeinePerUnit : 0;
  }
  ```

- [ ] **Step 3: Replace the product-form submit handler with an async version**

  Replace the current `on($('product-form'), 'submit', ...)` handler with:

  ```js
  on($('product-form'), 'submit', async function (e) {
    e.preventDefault();
    var name = $('pf-name').value.trim();
    if (!name) { $('pf-name').focus(); return; }

    var product = {
      id:              state.editingProductId || Data.generateId(),
      brand:           $('pf-brand').value.trim(),
      name:            name,
      type:            $('pf-type').value,
      carbsPerUnit:    parseFloat($('pf-carbs').value)    || 0,
      sodiumPerUnit:   parseFloat($('pf-sodium').value)   || 0,
      caffeinePerUnit: parseFloat($('pf-caffeine').value) || 0
    };

    var saveBtn = document.querySelector('#product-form button[type="submit"]');
    if (saveBtn) saveBtn.disabled = true;
    try {
      await Data.saveProduct(product);
      navigate('library');
    } catch (e) {
      showToast("Couldn't save — check your connection.");
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  });
  ```

- [ ] **Step 4: Replace the btn-delete-product click handler with an async version**

  Replace the current `on($('btn-delete-product'), 'click', ...)` handler with:

  ```js
  on($('btn-delete-product'), 'click', async function () {
    if (!state.editingProductId) return;
    if (!confirm('Delete this product from your library? Existing plans won\'t be affected.')) return;
    try {
      await Data.deleteProduct(state.editingProductId);
      navigate('library');
    } catch (e) {
      showToast("Couldn't delete — check your connection.");
    }
  });
  ```

- [ ] **Step 5: Verify syntax**

  ```bash
  node --check app.js
  ```
  Expected: no output.

- [ ] **Step 6: Commit**

  ```bash
  git add app.js
  git commit -m "feat: make renderLibrary, renderProductForm, and product form handlers async"
  ```

---

### Task 10: Update tests/data.test.js for async data.js

**Files:**
- Modify: `tests/data.test.js`

The CRUD functions are now async and the `getRecentProducts()` return type changed. The calculation and factory tests are pure functions — they are **not** touched.

**What needs a mock:**
- `global.crypto.randomUUID` — used by `generateId()` in the new data.js
- `global.fetch` — used by all async CRUD functions

**Specific behavioral change:** `getRecentProducts()` now returns `string[]` (IDs) instead of `Product[]`. Filtering stale IDs is no longer done inside `getRecentProducts()` — it happens at the call site (`renderSheetLibraryTab`) after a full product fetch.

- [ ] **Step 1: Add crypto mock and async-aware test runner at the top of the file**

  Replace the existing preamble (lines 1–30 of the current file — the `global.localStorage` mock, `require`, and `test` helper) with:

  ```js
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
  var _uuidCounter = 0;
  global.crypto = {
    randomUUID: function () {
      _uuidCounter++;
      return '00000000-0000-0000-0000-' + String(_uuidCounter).padStart(12, '0');
    }
  };

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
  ```

  Note: all test blocks below are now indented inside the `run()` async function. The file ends with `}` closing `run()` and a call to run it.

- [ ] **Step 2: Rewrite the Products CRUD section**

  Replace the Products CRUD test block (the four `test(...)` calls under `console.log('\nProducts CRUD')`) with:

  ```js
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
  ```

- [ ] **Step 3: Rewrite the Events CRUD section**

  Replace the Events CRUD test block with:

  ```js
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
  ```

- [ ] **Step 4: Rewrite the Recent products section**

  The return type of `getRecentProducts()` changed: it now returns `string[]` (IDs), not `Product[]`.
  Stale-ID filtering now happens at the call site, not inside `getRecentProducts()`.

  Replace the Recent products test block with:

  ```js
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
  ```

- [ ] **Step 5: Keep factory and calculation tests unchanged**

  These test pure functions that did not change. Leave the `newEvent / newSegment factories` and `Calculations` sections exactly as they are. They just need to be inside the `run()` function body (indented).

- [ ] **Step 6: Close the run() function and invoke it**

  At the very end of the file, replace:
  ```js
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) process.exit(1);
  ```
  With:
  ```js
  // ── Summary ───────────────────────────────────────────────────────────────────

    console.log('\n' + passed + ' passed, ' + failed + ' failed');
    if (failed > 0) process.exit(1);
  } // end run()

  run().catch(function (e) { console.error('Test runner error:', e); process.exit(1); });
  ```

- [ ] **Step 7: Run tests to verify all pass**

  ```bash
  node tests/data.test.js
  ```

  Expected output:
  ```
  Products CRUD
    ✓ getProducts returns [] when empty
    ✓ saveProduct sends upsert POST to Supabase
    ✓ saveProduct throws on server error
    ✓ deleteProduct removes from recent list
    ✓ getProducts normalises snake_case to camelCase

  Events CRUD
    ✓ getEvents returns [] when empty
    ✓ getEvent returns null when not found
    ✓ saveEvent sends POST to rpc/save_event
    ✓ saveEvent throws on server error
    ✓ deleteEvent sends DELETE request
    ✓ getEvents normalises nested segments and items
    ✓ getEvents sorts segments and items by sort_order

  Recent products
    ✓ getRecentProducts returns [] when empty
    ✓ recordProductUsed prepends and caps at 5
    ✓ deleteProduct removes ID from recent list
    ✓ getRecentProducts returns stale IDs as-is (filtering is caller responsibility)

  Factories
    ✓ newEvent has one segment named after the event
    ✓ itemFromProduct snapshots product values
    ✓ itemFromOneOff sets productId null, coerces numerics, defaults type to other
    ✓ newSegment uses provided name and duration

  Calculations
    ✓ calcSegmentTotals: sums items correctly
    ... (all calculation tests pass)

  N passed, 0 failed
  ```

- [ ] **Step 8: Commit**

  ```bash
  git add tests/data.test.js
  git commit -m "test: update data.test.js for async Supabase data.js — mock fetch, update CRUD and recent product tests"
  ```

---

### Task 11: Manual smoke test (end-to-end)

- [ ] **Step 1: Start local server and open the app**

  ```bash
  npx serve . -p 8080
  ```
  Open http://localhost:8080/ in a browser. Open the browser DevTools console.

- [ ] **Step 2: Verify initial load (no localStorage data)**

  - If this is a fresh setup: confirm no console errors on load.
  - Confirm the Events list shows the empty state ("No events yet").
  - Confirm no "Couldn't load" toast appears.

- [ ] **Step 3: Verify migration (if you have existing localStorage data)**

  On first load, check the console for `Migration failed` messages. If migration succeeds:
  - Your events should appear in the events list.
  - Run in console: `localStorage.getItem('fuelPlanner.migrated')` → should be `"true"`.
  - Run in console to confirm Supabase has data:
    ```js
    Data.getEvents().then(evts => console.log('Events:', evts.length));
    Data.getProducts().then(ps => console.log('Products:', ps.length));
    ```

- [ ] **Step 4: Test create event flow**

  - Tap "+ New Event". Enter a name (e.g. "Test Ride"). Tap "Save Event".
  - Confirm redirect to Event Detail view.
  - Reload the page. Confirm the event still appears in the list (data persisted in Supabase).

- [ ] **Step 5: Test add item flow**

  - Open the event detail. Tap "+ Add item".
  - Library tab: if no products, switch to One-off tab.
  - One-off tab: add an item (e.g. name "Gel", carbs 25). Tap "Add item".
  - Confirm item appears in the segment with quantity 1.
  - Tap + on the stepper. Confirm quantity becomes 2.
  - Reload the page. Open the event. Confirm item and quantity persisted.

- [ ] **Step 6: Test edit event**

  - From event detail, tap the ✏️ edit button. Change the event name. Tap "Save Changes".
  - Confirm the updated name shows in the detail header and events list.
  - Reload and confirm the name persisted.

- [ ] **Step 7: Test product library**

  - Navigate to Library. Tap "+". Add a product (name + carbs/sodium values). Tap "Save Product".
  - Confirm it appears in the library list.
  - Open the event, tap "+ Add item". Library tab should show the new product.
  - Tap the product to add it to the segment.
  - Reload. Confirm both the library product and the event item persisted.

- [ ] **Step 8: Test cross-device sync (the whole point)**

  - Note the URL of your Netlify deployment (or use ngrok to expose localhost temporarily).
  - Open the same URL on a different device (phone or second browser).
  - Confirm the events and products created on the first device are visible.

- [ ] **Step 9: Test error handling**

  - In DevTools Network tab, set throttling to "Offline".
  - Try to save an event. Confirm a "Couldn't save" toast appears.
  - Re-enable network. Confirm the app recovers and saves successfully.

- [ ] **Step 10: Final commit if any fixes were needed**

  ```bash
  git add -A
  git commit -m "fix: address issues found during smoke testing"
  ```
