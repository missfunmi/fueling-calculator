// app.js
(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────────────────────
  var state = {
    view: 'events',
    currentEventId: null,
    addingToSegmentId: null,
    editingProductId: null   // null = creating new product
  };

  // ── DOM helpers ────────────────────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }
  function $$(sel, ctx) { return (ctx || document).querySelectorAll(sel); }
  function on(el, evt, fn) { if (el) el.addEventListener(evt, fn); }

  function fmt(n, unit) {
    var rounded = Math.round(n * 10) / 10;
    return rounded + (unit || '');
  }

  var TYPE_LABELS = {
    gel: 'Gel', bar: 'Bar', drink_powder: 'Drink powder',
    liquid: 'Liquid', chew: 'Chew'
  };

  var EVENT_TYPE_LABELS = {
    ride: 'Ride', run: 'Run', triathlon: 'Triathlon',
    swim: 'Swim', other: 'Other'
  };

  // ── Router ─────────────────────────────────────────────────────────────────
  var TAB_VIEWS = { events: true, library: true };

  function navigate(view, params) {
    if (params) Object.assign(state, params);
    state.view = view;

    $$('.view').forEach(function (v) { v.classList.remove('active'); });
    var el = $('view-' + view);
    if (el) el.classList.add('active');

    // Show/hide tab bar (hide on detail and form views)
    var hideTabBar = (view === 'detail' || view === 'create' ||
                      view === 'product-form');
    var tabBar = $('tab-bar');
    if (tabBar) tabBar.style.display = hideTabBar ? 'none' : '';
    if (hideTabBar) {
      $$('.view.active').forEach(function (v) {
        v.style.paddingBottom = '0';
      });
    } else {
      $$('.view.active').forEach(function (v) {
        v.style.paddingBottom = '';
      });
    }

    // Sync tab bar highlight
    $$('.tab-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.tabView === view);
    });

    // Render the new view
    if (renders[view]) renders[view]();
  }

  // ── Renders (populated in later tasks) ────────────────────────────────────
  var renders = {};

  // ── Segment form HTML helper (used by renderCreate) ────────────────────────
  function segmentFormHTML(seg, idx, total) {
    var canDelete = total > 1;
    return '<div class="form-card" data-seg-draft-id="' + seg.id + '">' +
      '<div class="form-section-header" style="margin-bottom:10px">' +
        '<span style="font-size:13px;font-weight:600;color:var(--text-secondary)">SEGMENT ' + (idx + 1) + '</span>' +
        (canDelete
          ? '<button type="button" class="btn-text btn-danger btn-remove-segment" style="font-size:13px">Remove</button>'
          : '') +
      '</div>' +
      '<div class="form-group">' +
        '<label>Name</label>' +
        '<input class="form-input seg-name" type="text" value="' + escHtml(seg.name) + '" placeholder="e.g. Bike">' +
      '</div>' +
      '<div class="form-row">' +
        '<div class="form-group">' +
          '<label>Duration (hrs)</label>' +
          '<input class="form-input seg-duration" type="number" min="0.25" step="0.25" value="' + seg.durationHours + '">' +
        '</div>' +
      '</div>' +
      '<div class="form-row">' +
        '<div class="form-group">' +
          '<label>Carbs/hr (g)</label>' +
          '<input class="form-input seg-carbs-target" type="number" min="0" value="' + seg.targets.carbsPerHour + '">' +
        '</div>' +
        '<div class="form-group">' +
          '<label>Na/hr (mg)</label>' +
          '<input class="form-input seg-sodium-target" type="number" min="0" value="' + seg.targets.sodiumPerHour + '">' +
        '</div>' +
        '<div class="form-group">' +
          '<label>Caff/hr (mg)</label>' +
          '<input class="form-input seg-caffeine-target" type="number" min="0" value="' + seg.targets.caffeinePerHour + '">' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function escHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Events list ────────────────────────────────────────────────────────────

  function renderEventsList() {
    var events = Data.getEvents().slice().sort(function (a, b) {
      return (b.date || '').localeCompare(a.date || '');
    });
    var $list = $('events-list');
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
          (evt.date ? evt.date + ' · ' : '') +
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

  renders.events = renderEventsList;

  on($('btn-new-event'), 'click', function () {
    navigate('create', { currentEventId: null });
  });

  // ── Create / Edit event ────────────────────────────────────────────────────

  // draftSegments is rebuilt each time the create view opens
  var draftSegments = [];

  function renderCreate() {
    var isEdit = !!state.currentEventId;
    var evt = isEdit ? Data.getEvents().find(function (e) { return e.id === state.currentEventId; }) : null;

    $('create-title').textContent = isEdit ? 'Edit Event' : 'New Event';
    $('btn-save-event').textContent = isEdit ? 'Save Changes' : 'Save Event';
    $('btn-delete-event').style.display = isEdit ? '' : 'none';

    $('ef-name').value = evt ? evt.name : '';
    $('ef-date').value = evt ? (evt.date || '') : new Date().toISOString().slice(0, 10);
    $('ef-type').value = evt ? evt.type : 'ride';
    $('ef-notes').value = evt ? (evt.notes || '') : '';

    // Seed draftSegments from existing event or a fresh default
    draftSegments = evt
      ? evt.segments.map(function (s) { return JSON.parse(JSON.stringify(s)); })
      : [Data.newSegment('', 1)];

    renderSegmentForms();
  }

  function renderSegmentForms() {
    var $list = $('segments-form-list');
    $list.innerHTML = draftSegments.map(function (seg, i) {
      return segmentFormHTML(seg, i, draftSegments.length);
    }).join('');

    // Wire remove buttons
    $$('.btn-remove-segment').forEach(function (btn) {
      on(btn, 'click', function () {
        var card = btn.closest('[data-seg-draft-id]');
        var id = card.dataset.segDraftId;
        var seg = draftSegments.find(function (s) { return s.id === id; });
        if (seg && seg.items && seg.items.length > 0) {
          if (!confirm('Remove segment "' + seg.name + '"? It has ' + seg.items.length + ' item(s) which will be lost.')) return;
        }
        draftSegments = draftSegments.filter(function (s) { return s.id !== id; });
        renderSegmentForms();
      });
    });
  }

  on($('btn-add-segment'), 'click', function () {
    draftSegments.push(Data.newSegment('', 1));
    renderSegmentForms();
    // Scroll to new segment
    var cards = $$('[data-seg-draft-id]');
    if (cards.length) cards[cards.length - 1].scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  on($('event-form'), 'submit', function (e) {
    e.preventDefault();
    var name = $('ef-name').value.trim();
    if (!name) { $('ef-name').focus(); return; }

    // Read segment values from DOM
    var segCards = $$('[data-seg-draft-id]');
    var segments = Array.from(segCards).map(function (card) {
      var id = card.dataset.segDraftId;
      var existing = draftSegments.find(function (s) { return s.id === id; });
      return {
        id: id,
        name: card.querySelector('.seg-name').value.trim() || name,
        durationHours: parseFloat(card.querySelector('.seg-duration').value) || 1,
        targets: {
          carbsPerHour: parseFloat(card.querySelector('.seg-carbs-target').value) || 0,
          sodiumPerHour: parseFloat(card.querySelector('.seg-sodium-target').value) || 0,
          caffeinePerHour: parseFloat(card.querySelector('.seg-caffeine-target').value) || 0
        },
        items: existing ? (existing.items || []) : []
      };
    });

    var isEdit = !!state.currentEventId;
    var evt = isEdit
      ? Object.assign({}, Data.getEvents().find(function (e) { return e.id === state.currentEventId; }), {
          name: name,
          date: $('ef-date').value,
          type: $('ef-type').value,
          notes: $('ef-notes').value.trim(),
          segments: segments
        })
      : Object.assign(Data.newEvent(name), {
          date: $('ef-date').value,
          type: $('ef-type').value,
          notes: $('ef-notes').value.trim(),
          segments: segments
        });

    Data.saveEvent(evt);

    navigate('detail', { currentEventId: evt.id });
  });

  on($('btn-create-back'), 'click', function () {
    navigate(state.currentEventId ? 'detail' : 'events');
  });

  // Show delete button only when editing an existing event
  // (renderCreate is called before this handler fires, so check state.currentEventId)
  on($('btn-delete-event'), 'click', function () {
    var evt = Data.getEvents().find(function (e) { return e.id === state.currentEventId; });
    if (!evt) return;
    if (!confirm('Delete "' + evt.name + '"? This cannot be undone.')) return;
    Data.deleteEvent(evt.id);
    navigate('events');
  });

  renders.create = renderCreate;

  // ── Event detail ───────────────────────────────────────────────────────────

  function renderDetail() {
    var evt = Data.getEvents().find(function (e) { return e.id === state.currentEventId; });
    if (!evt) { navigate('events'); return; }

    // Header name
    $('detail-event-name').textContent = evt.name;

    // Summary cards
    var totals = Data.calcEventTotals(evt);
    var rates = Data.calcEventRates(evt);
    var totalH = totals.durationHours;
    $('detail-summary').innerHTML =
      '<div class="summary-cards">' +
        metricCardHTML('carbs', Math.round(totals.carbs) + 'g', fmt(rates.carbs, 'g/hr avg')) +
        metricCardHTML('sodium', Math.round(totals.sodium) + 'mg', fmt(rates.sodium, 'mg/hr avg')) +
        metricCardHTML('caffeine', Math.round(totals.caffeine) + 'mg', fmt(rates.caffeine, 'mg/hr avg')) +
      '</div>';

    // Segment sections
    var multiSeg = evt.segments.length > 1;
    var $body = $('detail-body');
    $body.innerHTML = evt.segments.map(function (seg) {
      return segmentSectionHTML(seg, multiSeg);
    }).join('') +
    (multiSeg ? totalsFooterHTML(totals, totalH) : '');

    attachDetailHandlers(evt);
  }

  function metricCardHTML(key, value, rate) {
    var labels = { carbs: 'Carbs', sodium: 'Sodium', caffeine: 'Caffeine' };
    return '<div class="metric-card">' +
      '<div class="metric-value">' + value + '</div>' +
      '<div class="metric-label">' + labels[key] + '</div>' +
      '<div class="metric-rate">' + rate + '</div>' +
    '</div>';
  }

  function segmentSectionHTML(seg, showLabel) {
    var totals = Data.calcSegmentTotals(seg);
    var rates = Data.calcSegmentRates(seg);
    var tgt = seg.targets;

    var pctCarbs   = tgt.carbsPerHour   ? Math.min(rates.carbs   / tgt.carbsPerHour   * 100, 150) : 0;
    var pctSodium  = tgt.sodiumPerHour  ? Math.min(rates.sodium  / tgt.sodiumPerHour  * 100, 150) : 0;
    var pctCaff    = tgt.caffeinePerHour ? Math.min(rates.caffeine / tgt.caffeinePerHour * 100, 150) : 0;

    var stCarbs   = Data.rateStatus(rates.carbs,   tgt.carbsPerHour);
    var stSodium  = Data.rateStatus(rates.sodium,  tgt.sodiumPerHour);
    var stCaff    = Data.rateStatus(rates.caffeine, tgt.caffeinePerHour);

    var dh = seg.durationHours;
    var dhLabel = dh === Math.floor(dh) ? dh + 'h' : dh.toFixed(1) + 'h';

    return '<div class="segment-section" data-segment-id="' + seg.id + '">' +
      (showLabel
        ? '<div class="segment-header">' +
            '<div class="segment-title-row">' +
              '<span class="segment-name editable" data-inline="seg-name">' + escHtml(seg.name) + '</span>' +
              '<span class="segment-duration editable" data-inline="seg-duration">&nbsp;· ' + dhLabel + '</span>' +
            '</div>' +
            '<div class="segment-targets-row">' +
              '<span class="target-pill" data-inline="seg-carbs-target">' + tgt.carbsPerHour + 'g carbs/hr</span>' +
              '<span class="target-pill" data-inline="seg-sodium-target">' + tgt.sodiumPerHour + 'mg Na/hr</span>' +
              (tgt.caffeinePerHour ? '<span class="target-pill" data-inline="seg-caff-target">' + tgt.caffeinePerHour + 'mg caff/hr</span>' : '') +
            '</div>' +
          '</div>'
        : '<div class="segment-header">' +
            '<div class="segment-targets-row">' +
              '<span class="target-pill" data-inline="seg-carbs-target">' + tgt.carbsPerHour + 'g carbs/hr</span>' +
              '<span class="target-pill" data-inline="seg-sodium-target">' + tgt.sodiumPerHour + 'mg Na/hr</span>' +
              (tgt.caffeinePerHour ? '<span class="target-pill" data-inline="seg-caff-target">' + tgt.caffeinePerHour + 'mg caff/hr</span>' : '') +
            '</div>' +
          '</div>') +
      '<div class="progress-group">' +
        progressRowHTML('Carbs', fmt(rates.carbs, 'g/hr'), pctCarbs, stCarbs) +
        progressRowHTML('Sodium', fmt(rates.sodium, 'mg/hr'), pctSodium, stSodium) +
        progressRowHTML('Caffeine', fmt(rates.caffeine, 'mg/hr'), pctCaff, stCaff) +
      '</div>' +
      '<div class="item-list">' +
        (seg.items.length
          ? seg.items.map(function (item) { return itemRowHTML(item); }).join('')
          : '<div style="padding:12px 16px;font-size:13px;color:var(--text-tertiary)">No items yet.</div>') +
      '</div>' +
      '<button class="btn-add-item" data-add-segment-id="' + seg.id + '">+ Add item</button>' +
    '</div>';
  }

  function progressRowHTML(label, value, pct, status) {
    return '<div class="progress-row status-' + status + '">' +
      '<span class="progress-label">' + label + '</span>' +
      '<div class="progress-track"><div class="progress-fill" style="--pct:' + pct.toFixed(1) + '"></div></div>' +
      '<span class="progress-value">' + value + '</span>' +
    '</div>';
  }

  function itemRowHTML(item) {
    var metaParts = [TYPE_LABELS[item.type] || item.type];
    if (item.carbsPerUnit) metaParts.push(item.carbsPerUnit + 'g');
    if (item.sodiumPerUnit) metaParts.push(item.sodiumPerUnit + 'mg Na');
    if (item.caffeinePerUnit) metaParts.push(item.caffeinePerUnit + 'mg caff');
    return '<div class="item-row" data-item-id="' + item.id + '">' +
      '<div class="item-info">' +
        '<div class="item-name">' + escHtml((item.brand ? item.brand + ' ' : '') + item.name) + '</div>' +
        '<div class="item-meta">' + metaParts.join(' · ') + '</div>' +
      '</div>' +
      '<div class="stepper">' +
        '<button class="stepper-btn" data-action="dec">&#8722;</button>' +
        '<span class="stepper-qty">' + item.quantity + '</span>' +
        '<button class="stepper-btn" data-action="inc">&#43;</button>' +
      '</div>' +
    '</div>';
  }

  function totalsFooterHTML(totals, durationHours) {
    var dh = durationHours === Math.floor(durationHours) ? durationHours + 'h' : durationHours.toFixed(1) + 'h';
    return '<div class="totals-footer">' +
      'Totals &mdash; ' + Math.round(totals.carbs) + 'g carbs · ' +
      Math.round(totals.sodium) + 'mg Na · ' +
      Math.round(totals.caffeine) + 'mg caffeine · ' + dh +
    '</div>';
  }

  function attachDetailHandlers(evt) {
    // Static header buttons — use .onclick to avoid stacking listeners on re-render
    $('btn-detail-back').onclick = function () { navigate('events'); };
    $('btn-edit-event').onclick = function () {
      navigate('create', { currentEventId: evt.id });
    };
    $('detail-event-name').onclick = function () {
      makeEditable($('detail-event-name'), function (val) {
        var updated = Object.assign({}, Data.getEvents().find(function (e) { return e.id === evt.id; }), { name: val });
        Data.saveEvent(updated);
        renderDetail();
      });
    };

    // Stepper buttons
    $$('.stepper-btn', $('detail-body')).forEach(function (btn) {
      on(btn, 'click', function () {
        var row = btn.closest('[data-item-id]');
        var segSection = btn.closest('[data-segment-id]');
        var itemId = row.dataset.itemId;
        var segId = segSection.dataset.segmentId;
        updateItemQty(evt.id, segId, itemId, btn.dataset.action === 'inc' ? 1 : -1);
      });
    });

    // Add item buttons
    $$('[data-add-segment-id]', $('detail-body')).forEach(function (btn) {
      on(btn, 'click', function () {
        openAddItemSheet(evt.id, btn.dataset.addSegmentId);
      });
    });

    // Inline editable segment fields
    $$('[data-inline]', $('detail-body')).forEach(function (el) {
      on(el, 'click', function () {
        handleInlineEdit(el, evt.id);
      });
    });
  }

  function updateItemQty(eventId, segId, itemId, delta) {
    var events = Data.getEvents();
    var evt = events.find(function (e) { return e.id === eventId; });
    if (!evt) return;
    var seg = evt.segments.find(function (s) { return s.id === segId; });
    if (!seg) return;
    var item = seg.items.find(function (i) { return i.id === itemId; });
    if (!item) return;
    item.quantity = Math.max(0, item.quantity + delta);
    if (item.quantity === 0) {
      seg.items = seg.items.filter(function (i) { return i.id !== itemId; });
    }
    Data.saveEvent(evt);
    renderDetail();
  }

  renders.detail = renderDetail;

  // ── Add item sheet ─────────────────────────────────────────────────────────

  var _sheetEventId = null;
  var _sheetSegmentId = null;

  function openAddItemSheet(eventId, segmentId) {
    _sheetEventId = eventId;
    _sheetSegmentId = segmentId;
    $('sheet-overlay').classList.remove('hidden');
    $('product-search').value = '';
    renderSheetLibraryTab();
    // Reset to library tab
    $$('.sheet-tab-btn').forEach(function (b) { b.classList.remove('active'); });
    $$('.sheet-tab-content').forEach(function (c) { c.classList.remove('active'); });
    $('sheet-tab-library').classList.add('active');
    document.querySelector('[data-sheet-tab="library"]').classList.add('active');
    // Reset one-off form
    $('oneoff-form').reset();
    $('product-search').focus();
  }

  function closeSheet() {
    $('sheet-overlay').classList.add('hidden');
    _sheetEventId = null;
    _sheetSegmentId = null;
  }

  function renderSheetLibraryTab(query) {
    var products = Data.getProducts();
    var recent = Data.getRecentProducts();

    // Recent section
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

    // Search results
    var filtered = query
      ? products.filter(function (p) {
          var q = query.toLowerCase();
          return (p.name || '').toLowerCase().includes(q) ||
                 (p.brand || '').toLowerCase().includes(q) ||
                 (TYPE_LABELS[p.type] || p.type || '').toLowerCase().includes(q);
        })
      : products;

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

  function productRowSheetHTML(p) {
    var meta = [];
    if (p.carbsPerUnit) meta.push(p.carbsPerUnit + 'g carbs');
    if (p.sodiumPerUnit) meta.push(p.sodiumPerUnit + 'mg Na');
    if (p.caffeinePerUnit) meta.push(p.caffeinePerUnit + 'mg caff');
    return '<div class="product-row" data-product-id="' + p.id + '">' +
      '<div class="product-row-info">' +
        '<div class="product-row-name">' + escHtml((p.brand ? p.brand + ' ' : '') + p.name) + '</div>' +
        '<div class="product-row-meta">' + meta.join(' · ') + '</div>' +
      '</div>' +
      '<span class="product-type-chip">' + escHtml(TYPE_LABELS[p.type] || p.type) + '</span>' +
    '</div>';
  }

  function attachSheetProductHandlers($container) {
    $$('.product-row', $container).forEach(function (row) {
      on(row, 'click', function () {
        var productId = row.dataset.productId;
        var product = Data.getProducts().find(function (p) { return p.id === productId; });
        if (!product || !_sheetEventId || !_sheetSegmentId) return;
        addItemToSegment(_sheetEventId, _sheetSegmentId, Data.itemFromProduct(product));
        Data.recordProductUsed(productId);
        closeSheet();
        renderDetail();
      });
    });
  }

  function addItemToSegment(eventId, segmentId, item) {
    var evt = Data.getEvents().find(function (e) { return e.id === eventId; });
    if (!evt) return;
    var seg = evt.segments.find(function (s) { return s.id === segmentId; });
    if (!seg) return;
    seg.items.push(item);
    Data.saveEvent(evt);
  }

  // Sheet overlay close
  on($('sheet-overlay'), 'click', function (e) {
    if (e.target === $('sheet-overlay')) closeSheet();
  });
  on($('btn-close-sheet'), 'click', closeSheet);

  // Sheet tab switching
  $$('.sheet-tab-btn').forEach(function (btn) {
    on(btn, 'click', function () {
      var tab = btn.dataset.sheetTab;
      $$('.sheet-tab-btn').forEach(function (b) { b.classList.remove('active'); });
      $$('.sheet-tab-content').forEach(function (c) { c.classList.remove('active'); });
      btn.classList.add('active');
      $('sheet-tab-' + tab).classList.add('active');
      if (tab === 'library') renderSheetLibraryTab($('product-search').value.trim());
    });
  });

  // Live search
  on($('product-search'), 'input', function () {
    renderSheetLibraryTab($('product-search').value.trim());
  });

  // One-off form submit
  on($('oneoff-form'), 'submit', function (e) {
    e.preventDefault();
    var name = $('oo-name').value.trim();
    if (!name) { $('oo-name').focus(); return; }
    var fields = {
      name: name,
      brand: $('oo-brand').value.trim(),
      type: $('oo-type').value,
      carbsPerUnit: $('oo-carbs').value,
      sodiumPerUnit: $('oo-sodium').value,
      caffeinePerUnit: $('oo-caffeine').value
    };
    var item = Data.itemFromOneOff(fields);
    if ($('oo-save-library').checked) {
      var product = Object.assign({ id: Data.generateId() }, fields, {
        carbsPerUnit: Number(fields.carbsPerUnit) || 0,
        sodiumPerUnit: Number(fields.sodiumPerUnit) || 0,
        caffeinePerUnit: Number(fields.caffeinePerUnit) || 0
      });
      Data.saveProduct(product);
      item.productId = product.id;
      Data.recordProductUsed(product.id);
    }
    addItemToSegment(_sheetEventId, _sheetSegmentId, item);
    closeSheet();
    renderDetail();
  });

  // ── Product library ──────────────────────────────────────────────────────────

  var TYPE_ORDER = ['gel', 'bar', 'drink_powder', 'liquid', 'chew'];

  function renderLibrary() {
    var products = Data.getProducts();
    var $body = $('library-body');
    if (!products.length) {
      $body.innerHTML = '<div class="empty-state"><div style="font-size:48px">📦</div><p>No products yet.</p><p>Tap + to add your first product.</p></div>';
      return;
    }

    // Group by type
    var groups = {};
    products.forEach(function (p) {
      var key = p.type || 'other';
      if (!groups[key]) groups[key] = [];
      groups[key].push(p);
    });

    var types = TYPE_ORDER.concat(
      Object.keys(groups).filter(function (t) { return TYPE_ORDER.indexOf(t) === -1; })
    ).filter(function (t) { return groups[t]; });

    $body.innerHTML = types.map(function (type) {
      return '<div class="product-group">' +
        '<div class="product-group-title">' + (TYPE_LABELS[type] || type) + 's</div>' +
        groups[type].map(function (p) {
          var meta = [];
          if (p.carbsPerUnit) meta.push(p.carbsPerUnit + 'g carbs');
          if (p.sodiumPerUnit) meta.push(p.sodiumPerUnit + 'mg Na');
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
  }

  renders.library = renderLibrary;

  on($('btn-new-product'), 'click', function () {
    navigate('product-form', { editingProductId: null });
  });

  // ── Product form ──────────────────────────────────────────────────────────────

  function renderProductForm() {
    var isEdit = !!state.editingProductId;
    var product = isEdit ? Data.getProducts().find(function (p) { return p.id === state.editingProductId; }) : null;

    $('pf-title').textContent = isEdit ? 'Edit Product' : 'New Product';
    $('btn-delete-product').style.display = isEdit ? '' : 'none';
    $('pf-brand').value    = product ? (product.brand || '') : '';
    $('pf-name').value     = product ? product.name : '';
    $('pf-type').value     = product ? product.type : 'gel';
    $('pf-carbs').value    = product ? product.carbsPerUnit : 0;
    $('pf-sodium').value   = product ? product.sodiumPerUnit : 0;
    $('pf-caffeine').value = product ? product.caffeinePerUnit : 0;
  }

  renders['product-form'] = renderProductForm;

  on($('btn-pf-back'), 'click', function () { navigate('library'); });

  on($('product-form'), 'submit', function (e) {
    e.preventDefault();
    var name = $('pf-name').value.trim();
    if (!name) { $('pf-name').focus(); return; }
    var product = {
      id: state.editingProductId || Data.generateId(),
      brand: $('pf-brand').value.trim(),
      name: name,
      type: $('pf-type').value,
      carbsPerUnit: parseFloat($('pf-carbs').value) || 0,
      sodiumPerUnit: parseFloat($('pf-sodium').value) || 0,
      caffeinePerUnit: parseFloat($('pf-caffeine').value) || 0
    };
    Data.saveProduct(product);
    navigate('library');
  });

  on($('btn-delete-product'), 'click', function () {
    if (!state.editingProductId) return;
    if (!confirm('Delete this product from your library? Existing plans won\'t be affected.')) return;
    Data.deleteProduct(state.editingProductId);
    navigate('library');
  });

  // ── Init ───────────────────────────────────────────────────────────────────
  function init() {
    // Tab bar
    $$('.tab-btn').forEach(function (btn) {
      on(btn, 'click', function () { navigate(btn.dataset.tabView); });
    });
    navigate('events');
  }

  document.addEventListener('DOMContentLoaded', init);

  // Expose for later tasks
  window._App = {
    state: state, navigate: navigate, renders: renders,
    $: $, $$: $$, on: on, fmt: fmt, escHtml: escHtml,
    segmentFormHTML: segmentFormHTML,
    TYPE_LABELS: TYPE_LABELS, EVENT_TYPE_LABELS: EVENT_TYPE_LABELS
  };

})();
