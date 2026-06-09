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

  // Canonicalise item type to lowercase_with_underscores so "Drink Powder",
  // "drink powder", and "drink_powder" all compare equal.
  function normalizeItemType(type) {
    if (!type) return 'other';
    return type.toLowerCase().replace(/\s+/g, '_');
  }

  function dbToProduct(row) {
    return {
      id:              row.id,
      brand:           row.brand || '',
      name:            row.name,
      type:            normalizeItemType(row.type),
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
                  type:            normalizeItemType(itm.type),
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

  // Updates last_visited_at to now. Called fire-and-forget on each app load.
  // Requires: ALTER TABLE users ADD COLUMN last_visited_at TIMESTAMPTZ DEFAULT now();
  async function touchLastVisited() {
    await supabaseRequest(
      'PATCH',
      'users?id=eq.' + getUserId(),
      { last_visited_at: new Date().toISOString() },
      'return=minimal'
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
      type:            normalizeItemType(product.type),
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
      type:            normalizeItemType(fields.type),
      carbsPerUnit:    Number(fields.carbsPerUnit)    || 0,
      sodiumPerUnit:   Number(fields.sodiumPerUnit)   || 0,
      caffeinePerUnit: Number(fields.caffeinePerUnit) || 0,
      quantity:        1
    };
  }

  // ── Execution Plan ────────────────────────────────────────────────────────────

  function generateExecutionPlan(segment) {
    // +1 so slot 0 = 0:00 (segment start) and the last slot = segment end time.
    var slotCount = Math.ceil((segment.durationHours || 1) * 60 / 15) + 1;
    var slots = [];
    for (var i = 0; i < slotCount; i++) {
      slots.push({ slotIndex: i, intervalMinutes: 15, assignments: [] });
    }

    // 'liquid' items (e.g. electrolyte boosters) are treated the same as 'drink_powder' —
    // they go in a bottle and are consumed as a continuous sip, not as discrete units.
    var liquidItems = (segment.items || []).filter(function (item) {
      return (item.type === 'drink_powder' || item.type === 'liquid') && item.quantity > 0;
    });
    var discreteItems = (segment.items || []).filter(function (item) {
      return item.type !== 'drink_powder' && item.type !== 'liquid' && item.quantity > 0;
    });

    // Liquid: build drink_group assignments — one merged sip per slot per group.
    // Uses segment.bottleGroups (Option B) if defined; otherwise auto-merges all
    // drink_powder items into a single implicit group (Option A).
    var bottleGroups = (segment.bottleGroups && segment.bottleGroups.length)
      ? segment.bottleGroups.map(function (g) {
          return {
            groupId:   g.id,
            groupName: g.name || null,
            items: liquidItems.filter(function (item) { return g.itemIds.indexOf(item.id) !== -1; })
          };
        }).filter(function (g) { return g.items.length > 0; })
      : (liquidItems.length
          ? [{ groupId: '__auto__', groupName: null, items: liquidItems }]
          : []);

    bottleGroups.forEach(function (group) {
      var totalCarbs  = group.items.reduce(function (s, item) { return s + (item.carbsPerUnit  || 0) * (item.quantity || 0); }, 0);
      var totalSodium = group.items.reduce(function (s, item) { return s + (item.sodiumPerUnit || 0) * (item.quantity || 0); }, 0);
      var carbsPerSlot  = Math.round((totalCarbs  / slotCount) * 100) / 100;
      var sodiumPerSlot = Math.round((totalSodium / slotCount) * 100) / 100;
      slots.forEach(function (slot) {
        slot.assignments.push({
          type:         'drink_group',
          groupId:      group.groupId,
          groupName:    group.groupName,
          itemIds:      group.items.map(function (item) { return item.id; }),
          carbsPerSlot: carbsPerSlot,
          sodiumPerSlot: sodiumPerSlot
        });
      });
    });

    // Separate gels by caffeine content, bars, and other
    var gelCaf = [], gelNonCaf = [], bars = [], other = [];
    discreteItems.forEach(function (item) {
      if (item.type === 'gel' && item.caffeinePerUnit > 0) {
        for (var i = 0; i < item.quantity; i++) gelCaf.push({ itemId: item.id, quantity: 1 });
      } else if (item.type === 'gel') {
        for (var i = 0; i < item.quantity; i++) gelNonCaf.push({ itemId: item.id, quantity: 1 });
      } else if (item.type === 'bar') {
        var halves = Math.round(item.quantity * 2);
        for (var i = 0; i < halves; i++) bars.push({ itemId: item.id, quantity: 0.5 });
      } else {
        for (var i = 0; i < item.quantity; i++) other.push({ itemId: item.id, quantity: 1 });
      }
    });

    // Interleave caf and non-caf gels
    var gels = [];
    var maxLen = Math.max(gelCaf.length, gelNonCaf.length);
    for (var i = 0; i < maxLen; i++) {
      if (i < gelCaf.length)    gels.push(gelCaf[i]);
      if (i < gelNonCaf.length) gels.push(gelNonCaf[i]);
    }

    // Combine all discrete items into a single round-robin interleaved pool.
    // Round-robin across [gels, bars, other] prevents any two items from the same
    // category from being placed adjacently, and a single distribution pass
    // prevents slot collisions that occurred when each category was distributed
    // independently.
    var discretePool = [];
    var categories = [gels, bars, other].filter(function (c) { return c.length > 0; });
    var poolMax = categories.reduce(function (m, c) { return Math.max(m, c.length); }, 0);
    for (var i = 0; i < poolMax; i++) {
      categories.forEach(function (cat) {
        if (i < cat.length) discretePool.push(cat[i]);
      });
    }

    // Use the (i + 0.5) centering formula so items are spread evenly across all
    // slots rather than packing into the front of the segment.
    discretePool.forEach(function (unit, i) {
      var idx = Math.floor((i + 0.5) * slotCount / discretePool.length);
      slots[idx].assignments.push(unit);
    });

    return slots;
  }

  // Returns the projected g/hr if it is >15% below target, otherwise null.
  function checkExecutionPlanTarget(segment) {
    var target = segment.targets && segment.targets.carbsPerHour;
    if (!target) return null;
    var totalCarbs = (segment.items || []).reduce(function (sum, item) {
      return sum + (item.carbsPerUnit || 0) * (item.quantity || 0);
    }, 0);
    var projected = totalCarbs / (segment.durationHours || 1);
    return projected < target * 0.85 ? Math.round(projected) : null;
  }

  function calcSlotCarbs(slot, items) {
    var itemMap = {};
    (items || []).forEach(function (item) { itemMap[item.id] = item; });
    return (slot.assignments || []).reduce(function (sum, a) {
      if (a.type === 'drink_group') return sum + (a.carbsPerSlot || 0);
      var item = itemMap[a.itemId];
      return sum + (item ? (item.carbsPerUnit || 0) * a.quantity : 0);
    }, 0);
  }

  function saveExecutionPlan(segmentId, plan) {
    localStorage.setItem('fuelPlanner.execPlan.' + segmentId, JSON.stringify(plan));
  }

  function loadExecutionPlan(segmentId) {
    try {
      var raw = localStorage.getItem('fuelPlanner.execPlan.' + segmentId);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function deleteExecutionPlan(segmentId) {
    localStorage.removeItem('fuelPlanner.execPlan.' + segmentId);
  }

  // ── Exports ───────────────────────────────────────────────────────────────────

  exports.getUserId          = getUserId;
  exports.generatePhrase     = generatePhrase;
  exports.hashPhrase         = hashPhrase;
  exports.saveClaim          = saveClaim;
  exports.lookupClaim        = lookupClaim;
  exports.generateId         = generateId;
  exports.getProducts        = getProducts;
  exports.saveProduct        = saveProduct;
  exports.deleteProduct      = deleteProduct;
  exports.getEvents          = getEvents;
  exports.getEvent           = getEvent;
  exports.saveEvent          = saveEvent;
  exports.deleteEvent        = deleteEvent;
  exports.saveActuals        = saveActuals;
  exports.saveUser           = saveUser;
  exports.touchLastVisited   = touchLastVisited;
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
  exports.generateExecutionPlan     = generateExecutionPlan;
  exports.checkExecutionPlanTarget  = checkExecutionPlanTarget;
  exports.calcSlotCarbs             = calcSlotCarbs;
  exports.saveExecutionPlan         = saveExecutionPlan;
  exports.loadExecutionPlan         = loadExecutionPlan;
  exports.deleteExecutionPlan       = deleteExecutionPlan;

})(typeof module !== 'undefined' ? module.exports : (window.Data = window.Data || {}));
