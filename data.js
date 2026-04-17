// data.js
(function (exports) {
  'use strict';

  var KEYS = {
    products: 'fuelPlanner.products',
    events: 'fuelPlanner.events',
    recent: 'fuelPlanner.recentProducts'
  };

  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // ── Products ────────────────────────────────────────────────────────────────

  function getProducts() {
    try { return JSON.parse(localStorage.getItem(KEYS.products) || '[]'); }
    catch (e) { return []; }
  }

  function saveProduct(product) {
    var list = getProducts();
    var i = list.findIndex(function (p) { return p.id === product.id; });
    if (i >= 0) list[i] = product; else list.push(product);
    localStorage.setItem(KEYS.products, JSON.stringify(list));
  }

  function deleteProduct(id) {
    localStorage.setItem(KEYS.products, JSON.stringify(
      getProducts().filter(function (p) { return p.id !== id; })
    ));
    // Remove from recents too
    try {
      var recent = JSON.parse(localStorage.getItem(KEYS.recent) || '[]')
        .filter(function (i) { return i !== id; });
      localStorage.setItem(KEYS.recent, JSON.stringify(recent));
    } catch (e) {}
  }

  // ── Events ──────────────────────────────────────────────────────────────────

  function getEvents() {
    try { return JSON.parse(localStorage.getItem(KEYS.events) || '[]'); }
    catch (e) { return []; }
  }

  function saveEvent(event) {
    var list = getEvents();
    var i = list.findIndex(function (e) { return e.id === event.id; });
    if (i >= 0) list[i] = event; else list.push(event);
    localStorage.setItem(KEYS.events, JSON.stringify(list));
  }

  function deleteEvent(id) {
    localStorage.setItem(KEYS.events, JSON.stringify(
      getEvents().filter(function (e) { return e.id !== id; })
    ));
  }

  // ── Recent products ─────────────────────────────────────────────────────────

  function getRecentProducts() {
    try {
      var ids = JSON.parse(localStorage.getItem(KEYS.recent) || '[]');
      var products = getProducts();
      return ids
        .map(function (id) { return products.find(function (p) { return p.id === id; }); })
        .filter(Boolean);
    } catch (e) { return []; }
  }

  function recordProductUsed(id) {
    try {
      var ids = JSON.parse(localStorage.getItem(KEYS.recent) || '[]');
      var updated = [id].concat(ids.filter(function (i) { return i !== id; })).slice(0, 5);
      localStorage.setItem(KEYS.recent, JSON.stringify(updated));
    } catch (e) {}
  }

  // ── Calculations ─────────────────────────────────────────────────────────────

  function calcSegmentTotals(segment) {
    return (segment.items || []).reduce(function (acc, item) {
      return {
        carbs: acc.carbs + (item.carbsPerUnit || 0) * (item.quantity || 0),
        sodium: acc.sodium + (item.sodiumPerUnit || 0) * (item.quantity || 0),
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
        carbs: acc.carbs + t.carbs,
        sodium: acc.sodium + t.sodium,
        caffeine: acc.caffeine + t.caffeine,
        durationHours: acc.durationHours + (seg.durationHours || 0)
      };
    }, { carbs: 0, sodium: 0, caffeine: 0, durationHours: 0 });
  }

  function calcEventRates(event) {
    var t = calcEventTotals(event);
    var h = t.durationHours || 1;
    return { carbs: t.carbs / h, sodium: t.sodium / h, caffeine: t.caffeine / h };
  }

  // Returns: 'on-target' | 'warning-under' | 'warning-over' | 'under' | 'over' | 'none'
  function rateStatus(actual, target) {
    if (target === undefined || target === null) return 'none';
    if (target === 0) return actual > 0 ? 'over' : 'none';
    var ratio = actual / target;
    if (ratio >= 0.9 && ratio <= 1.1) return 'on-target';
    if (ratio >= 0.75 && ratio < 0.9) return 'warning-under';
    if (ratio > 1.1 && ratio <= 1.25) return 'warning-over';
    return ratio < 0.75 ? 'under' : 'over';
  }

  // ── Factories ─────────────────────────────────────────────────────────────────

  function newSegment(name, durationHours) {
    return {
      id: generateId(),
      name: name || 'Segment',
      durationHours: durationHours || 1,
      targets: { carbsPerHour: 80, sodiumPerHour: 500, caffeinePerHour: 0 },
      items: []
    };
  }

  function newEvent(name) {
    return {
      id: generateId(),
      name: name || 'New Event',
      date: new Date().toISOString().slice(0, 10),
      type: 'ride',
      notes: '',
      segments: [newSegment(name || 'New Event', 1)]
    };
  }

  function itemFromProduct(product) {
    return {
      id: generateId(),
      productId: product.id,
      name: product.name,
      brand: product.brand || '',
      type: product.type,
      carbsPerUnit: Number(product.carbsPerUnit) || 0,
      sodiumPerUnit: Number(product.sodiumPerUnit) || 0,
      caffeinePerUnit: Number(product.caffeinePerUnit) || 0,
      quantity: 1
    };
  }

  function itemFromOneOff(fields) {
    return {
      id: generateId(),
      productId: null,
      name: fields.name,
      brand: fields.brand || '',
      type: fields.type || 'other',
      carbsPerUnit: Number(fields.carbsPerUnit) || 0,
      sodiumPerUnit: Number(fields.sodiumPerUnit) || 0,
      caffeinePerUnit: Number(fields.caffeinePerUnit) || 0,
      quantity: 1
    };
  }

  // ── Exports ──────────────────────────────────────────────────────────────────

  exports.generateId = generateId;
  exports.getProducts = getProducts;
  exports.saveProduct = saveProduct;
  exports.deleteProduct = deleteProduct;
  exports.getEvents = getEvents;
  exports.saveEvent = saveEvent;
  exports.deleteEvent = deleteEvent;
  exports.getRecentProducts = getRecentProducts;
  exports.recordProductUsed = recordProductUsed;
  exports.calcSegmentTotals = calcSegmentTotals;
  exports.calcSegmentRates = calcSegmentRates;
  exports.calcEventTotals = calcEventTotals;
  exports.calcEventRates = calcEventRates;
  exports.rateStatus = rateStatus;
  exports.newSegment = newSegment;
  exports.newEvent = newEvent;
  exports.itemFromProduct = itemFromProduct;
  exports.itemFromOneOff = itemFromOneOff;

})(typeof module !== 'undefined' ? module.exports : (window.Data = window.Data || {}));
