// data.js
(function (exports) {
  'use strict';

  // ── Config ──────────────────────────────────────────────────────────────────
  // Fill these in from your Supabase project Settings → API
  var SUPABASE_URL  = 'https://jcrmkxlzqewwqugkwlww.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_VArDAA7V8Gg-Xi20vj7zkw_NiidAk_Q';
  var USER_ID = '33d5e92b-360a-45b7-a423-656f14e67b98'; // the UUID you generated and used in the SQL

  var KEYS = {
    recent:   'fuelPlanner.recentProducts',
    migrated: 'fuelPlanner.migrated'
  };

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
    return (rows || []).map(dbToEvent);
  }

  async function getEvent(id) {
    var rows = await supabaseRequest(
      'GET',
      'events?id=eq.' + id + '&user_id=eq.' + USER_ID + '&select=*,segments(*,items(*))'
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

  async function saveActuals(eventId, actuals, postEventNotes) {
    await supabaseRequest(
      'PATCH',
      'events?id=eq.' + eventId,
      { actuals: actuals, post_event_notes: postEventNotes || null },
      'return=minimal'
    );
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
    if (existingEvents.length > 0 && existingProducts.length > 0) {
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

    // Remap recent product IDs to their new UUIDs
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

  exports.generateId       = generateId;
  exports.getProducts      = getProducts;
  exports.saveProduct      = saveProduct;
  exports.deleteProduct    = deleteProduct;
  exports.getEvents        = getEvents;
  exports.getEvent         = getEvent;
  exports.saveEvent        = saveEvent;
  exports.deleteEvent      = deleteEvent;
  exports.saveActuals      = saveActuals;
  exports.getRecentProducts = getRecentProducts;
  exports.recordProductUsed = recordProductUsed;
  exports.migrateIfNeeded  = migrateIfNeeded;
  exports.calcSegmentTotals = calcSegmentTotals;
  exports.calcSegmentRates  = calcSegmentRates;
  exports.calcEventTotals   = calcEventTotals;
  exports.calcEventRates    = calcEventRates;
  exports.rateStatus        = rateStatus;
  exports.calcActualSegmentTotals = calcActualSegmentTotals;
  exports.calcActualSegmentRates  = calcActualSegmentRates;
  exports.calcActualEventTotals   = calcActualEventTotals;
  exports.calcActualEventRates    = calcActualEventRates;
  exports.newSegment        = newSegment;
  exports.newEvent          = newEvent;
  exports.itemFromProduct   = itemFromProduct;
  exports.itemFromOneOff    = itemFromOneOff;

})(typeof module !== 'undefined' ? module.exports : (window.Data = window.Data || {}));
