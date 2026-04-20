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

  var TYPE_LABELS = {
    gel: 'Gel', bar: 'Bar', drink_powder: 'Drink powder',
    liquid: 'Liquid', chew: 'Chew', other: 'Other'
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

  function isEventPastOrToday(dateStr) {
    if (!dateStr) return true; // no date set = treat as past
    return dateStr <= new Date().toISOString().slice(0, 10);
  }

  // ── Events list ────────────────────────────────────────────────────────────

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

  renders.events = renderEventsList;

  on($('btn-new-event'), 'click', function () {
    navigate('create', { currentEventId: null });
  });

  on($('btn-new-event-nav'), 'click', function () {
    navigate('create', { currentEventId: null });
  });

  // ── Create / Edit event ────────────────────────────────────────────────────

  // draftSegments is rebuilt each time the create view opens
  var draftSegments = [];

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

  function syncDraftSegmentsFromDOM() {
    var segCards = $$('[data-seg-draft-id]');
    segCards.forEach(function (card) {
      var id = card.dataset.segDraftId;
      var seg = draftSegments.find(function (s) { return s.id === id; });
      if (!seg) return;
      seg.name = card.querySelector('.seg-name').value.trim();
      var dur = parseFloat(card.querySelector('.seg-duration').value);
      if (dur > 0) seg.durationHours = dur;
      var carbs = parseFloat(card.querySelector('.seg-carbs-target').value);
      if (!isNaN(carbs)) seg.targets.carbsPerHour = carbs;
      var sodium = parseFloat(card.querySelector('.seg-sodium-target').value);
      if (!isNaN(sodium)) seg.targets.sodiumPerHour = sodium;
      var caff = parseFloat(card.querySelector('.seg-caffeine-target').value);
      if (!isNaN(caff)) seg.targets.caffeinePerHour = caff;
    });
  }

  function renderSegmentForms() {
    var $list = $('segments-form-list');
    $list.innerHTML = draftSegments.map(function (seg, i) {
      return segmentFormHTML(seg, i, draftSegments.length);
    }).join('');

    // Wire remove buttons
    $$('.btn-remove-segment').forEach(function (btn) {
      on(btn, 'click', function () {
        syncDraftSegmentsFromDOM();
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
    syncDraftSegmentsFromDOM();
    draftSegments.push(Data.newSegment('', 1));
    renderSegmentForms();
    // Scroll to new segment
    var cards = $$('[data-seg-draft-id]');
    if (cards.length) cards[cards.length - 1].scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

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
          carbsPerHour:    parseFloat(card.querySelector('.seg-carbs-target').value)    || 0,
          sodiumPerHour:   parseFloat(card.querySelector('.seg-sodium-target').value)   || 0,
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

  on($('btn-create-back'), 'click', function () {
    navigate(state.currentEventId ? 'detail' : 'events');
  });

  // Show delete button only when editing an existing event
  // (renderCreate is called before this handler fires, so check state.currentEventId)
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

  renders.create = renderCreate;

  // ── Event detail ───────────────────────────────────────────────────────────

  async function renderDetail() {
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

    var showActuals = isEventPastOrToday(evt.date);

    // Pre-populate actuals from plan on first open (silent background save)
    if (showActuals) {
      var needsSave = false;
      evt.segments.forEach(function (seg) {
        if (!evt.actuals[seg.id]) {
          evt.actuals[seg.id] = {
            durationHours: seg.durationHours,
            items: seg.items.map(function (item) {
              return Object.assign({}, item, { id: Data.generateId() });
            })
          };
          needsSave = true;
        }
      });
      if (needsSave) {
        try {
          await Data.saveActuals(evt.id, evt.actuals, evt.postEventNotes);
        } catch (e) {
          console.error('Failed to pre-populate actuals:', e);
          // non-fatal: continue rendering with in-memory state
        }
      }
    }

    $('detail-event-name').textContent = evt.name;

    var totals = Data.calcEventTotals(evt);
    var rates  = Data.calcEventRates(evt);
    var totalH = totals.durationHours;

    var hasActuals = showActuals && Object.keys(evt.actuals).length > 0;
    var actTotals = hasActuals ? Data.calcActualEventTotals(evt) : null;
    var actRates  = hasActuals ? Data.calcActualEventRates(evt)  : null;

    $('detail-summary').innerHTML =
      '<div class="event-meta-row">' +
        '<span class="type-badge">' + (EVENT_TYPE_LABELS[evt.type] || escHtml(evt.type)) + '</span>' +
        (evt.date ? '<span class="event-meta-date">' + escHtml(evt.date) + '</span>' : '') +
      '</div>' +
      '<div class="summary-cards">' +
        metricCardHTML('carbs',    Math.round(totals.carbs) + 'g',  fmt(rates.carbs, 'g/hr avg'),
          actTotals ? Math.round(actTotals.carbs) + 'g'   : undefined,
          actRates  ? fmt(actRates.carbs, 'g/hr avg')     : undefined) +
        metricCardHTML('sodium',   Math.round(totals.sodium) + 'mg', fmt(rates.sodium, 'mg/hr avg'),
          actTotals ? Math.round(actTotals.sodium) + 'mg' : undefined,
          actRates  ? fmt(actRates.sodium, 'mg/hr avg')   : undefined) +
        metricCardHTML('caffeine', Math.round(totals.caffeine) + 'mg', fmt(rates.caffeine, 'mg/hr avg'),
          actTotals ? Math.round(actTotals.caffeine) + 'mg' : undefined,
          actRates  ? fmt(actRates.caffeine, 'mg/hr avg')   : undefined) +
      '</div>';

    var multiSeg = evt.segments.length > 1;
    var $body = $('detail-body');
    $body.innerHTML =
      evt.segments.map(function (seg) {
        var html = segmentSectionHTML(seg, multiSeg);
        if (showActuals) {
          var actualSeg = evt.actuals[seg.id] || { durationHours: null, items: [] };
          html += actualSegmentSectionHTML(seg, actualSeg);
        }
        return html;
      }).join('') +
      (multiSeg ? totalsFooterHTML(totals, totalH) : '') +
      (showActuals ? postEventNotesHTML(evt.postEventNotes) : '');

    attachDetailHandlers(evt);
  }

  function metricCardHTML(key, value, rate, actualValue, actualRate) {
    var labels = { carbs: 'Carbs', sodium: 'Sodium', caffeine: 'Caffeine' };
    var hasActuals = actualValue !== undefined;
    return '<div class="metric-card' + (hasActuals ? ' has-actuals' : '') + '">' +
      '<div class="metric-value">' + value + '</div>' +
      (hasActuals ? '<div class="metric-actual">' + actualValue + '</div>' : '') +
      '<div class="metric-label">' + labels[key] + '</div>' +
      '<div class="metric-rate">' + rate + '</div>' +
      (hasActuals ? '<div class="metric-actual-rate">' + actualRate + '</div>' : '') +
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
      '<div class="segment-totals">' +
        '<span>' + totals.carbs + 'g carbs</span>' +
        '<span>' + totals.sodium + 'mg Na</span>' +
        (totals.caffeine ? '<span>' + totals.caffeine + 'mg caff</span>' : '') +
        '<span>' + dhLabel + '</span>' +
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
    var metaParts = [TYPE_LABELS[item.type] || escHtml(item.type)];
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

  function actualItemRowHTML(item) {
    var metaParts = [TYPE_LABELS[item.type] || escHtml(item.type)];
    if (item.carbsPerUnit)   metaParts.push(item.carbsPerUnit + 'g');
    if (item.sodiumPerUnit)  metaParts.push(item.sodiumPerUnit + 'mg Na');
    if (item.caffeinePerUnit) metaParts.push(item.caffeinePerUnit + 'mg caff');
    var isOneOff = !item.productId;
    return '<div class="item-row' + (isOneOff ? ' is-oneoff' : '') + '" data-actual-item-id="' + item.id + '">' +
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

  function postEventNotesHTML(notes) {
    return '<div class="post-event-notes-section">' +
      '<label for="post-event-notes">Post-event notes</label>' +
      '<textarea id="post-event-notes" class="post-event-notes-textarea"' +
        ' placeholder="What worked, what didn\'t\u2026">' +
      escHtml(notes || '') +
      '</textarea>' +
    '</div>';
  }

  function actualSegmentSectionHTML(seg, actualSeg) {
    var dh = actualSeg.durationHours;
    var dhLabel = (dh && dh > 0)
      ? (dh === Math.floor(dh) ? dh + 'h' : dh.toFixed(1) + 'h')
      : '—';
    return '<div class="actual-section" data-actual-segment-id="' + seg.id + '">' +
      '<div class="actual-section-header">' +
        '<span class="actual-pill">ACTUAL</span>' +
        '<span class="actual-section-title">' + escHtml(seg.name) + '</span>' +
      '</div>' +
      '<div class="actual-duration-row">' +
        'Duration: <span class="actual-duration-value editable" data-inline="actual-duration">' +
        dhLabel +
        '</span>' +
      '</div>' +
      '<div class="item-list">' +
        (actualSeg.items.length
          ? actualSeg.items.map(function (item) { return actualItemRowHTML(item); }).join('')
          : '<div style="padding:8px 16px;font-size:13px;color:var(--text-tertiary)">No items logged yet.</div>') +
      '</div>' +
      '<button class="btn-add-item" data-add-actual-segment-id="' + seg.id + '">+ Add item</button>' +
    '</div>';
  }

  function attachDetailHandlers(evt) {
    // Static header buttons — use .onclick to avoid stacking listeners on re-render
    $('btn-detail-back').onclick = function () { navigate('events'); };
    $('btn-edit-event').onclick = function () {
      navigate('create', { currentEventId: evt.id });
    };
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

    // Stepper buttons
    $$('.stepper-btn', $('detail-body')).forEach(function (btn) {
      on(btn, 'click', function () {
        var row = btn.closest('[data-item-id]');
        if (!row) return; // actual item rows use data-actual-item-id — handled separately
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

  renders.detail = renderDetail;

  // ── Add item sheet ─────────────────────────────────────────────────────────

  var _sheetEventId = null;
  var _sheetSegmentId = null;

  function openAddItemSheet(eventId, segmentId) {
    _sheetEventId = eventId;
    _sheetSegmentId = segmentId;
    $('sheet-overlay').classList.remove('hidden');
    $('product-search').value = '';
    renderSheetLibraryTab().catch(function (e) {
      showToast("Couldn't load library — check your connection.");
    });
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

  async function addItemToSegment(eventId, segmentId, item) {
    var evt = await Data.getEvent(eventId);
    if (!evt) return;
    var seg = evt.segments.find(function (s) { return s.id === segmentId; });
    if (!seg) return;
    seg.items.push(item);
    await Data.saveEvent(evt);
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
      if (tab === 'library') {
        renderSheetLibraryTab($('product-search').value.trim()).catch(function (e) {
          showToast("Couldn't load library — check your connection.");
        });
      }
    });
  });

  // Live search
  on($('product-search'), 'input', function () {
    renderSheetLibraryTab($('product-search').value.trim()).catch(function (e) {
      showToast("Couldn't search — check your connection.");
    });
  });

  // One-off form submit
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

  // ── Product library ──────────────────────────────────────────────────────────

  var TYPE_ORDER = ['gel', 'bar', 'drink_powder', 'liquid', 'chew'];

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

  renders.library = renderLibrary;

  on($('btn-new-product'), 'click', function () {
    navigate('product-form', { editingProductId: null });
  });

  // ── Product form ──────────────────────────────────────────────────────────────

  async function renderProductForm() {
    var isEdit = !!state.editingProductId;
    var product = null;
    if (isEdit) {
      var products;
      try { products = await Data.getProducts(); }
      catch (e) { showToast("Couldn't load product — check your connection."); return; }
      product = products.find(function (p) { return p.id === state.editingProductId; }) || null;
    }

    $('pf-title').textContent             = isEdit ? 'Edit Product' : 'New Product';
    $('btn-delete-product').style.display = isEdit ? '' : 'none';
    $('pf-brand').value    = product ? (product.brand    || '') : '';
    $('pf-name').value     = product ? product.name           : '';
    $('pf-type').value     = product ? product.type           : 'gel';
    $('pf-carbs').value    = product ? product.carbsPerUnit    : 0;
    $('pf-sodium').value   = product ? product.sodiumPerUnit   : 0;
    $('pf-caffeine').value = product ? product.caffeinePerUnit : 0;
  }

  renders['product-form'] = renderProductForm;

  on($('btn-pf-back'), 'click', function () { navigate('library'); });

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

  // ── Inline editing ─────────────────────────────────────────────────────────

  function makeEditable(el, onSave) {
    if (el.querySelector('input')) return; // already editing
    var original = el.textContent.trim();
    var input = document.createElement('input');
    input.value = original;
    input.className = 'inline-edit';
    input.style.width = Math.max(60, original.length * 10) + 'px';
    el.textContent = '';
    el.appendChild(input);
    input.focus();
    input.select();

    var committed = false;
    function commit() {
      if (committed) return;
      committed = true;
      var val = input.value.trim() || original;
      onSave(val);
    }
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { input.value = original; input.blur(); }
    });
  }

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

  // ── Init ───────────────────────────────────────────────────────────────────
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

  document.addEventListener('DOMContentLoaded', init);

  // Expose for later tasks
  window._App = {
    state: state, navigate: navigate, renders: renders,
    $: $, $$: $$, on: on, fmt: fmt, escHtml: escHtml,
    segmentFormHTML: segmentFormHTML,
    TYPE_LABELS: TYPE_LABELS, EVENT_TYPE_LABELS: EVENT_TYPE_LABELS
  };

})();
