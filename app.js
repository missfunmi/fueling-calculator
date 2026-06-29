// app.js
(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────────────────────
  var state = {
    view: 'events',
    currentEventId: null,
    currentEvent: null,
    addingToSegmentId: null,
    editingProductId: null,  // null = creating new product
    claimReturnView: null    // where to return after claim view (null = landing)
  };

  var _indicatorDismissed = false; // reset to false on page load; session-only dismissal
  var _currentPhrase = '';         // holds the phrase currently displayed on the claim screen

  // ── DOM helpers ────────────────────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }
  function $$(sel, ctx) { return (ctx || document).querySelectorAll(sel); }
  function on(el, evt, fn) { if (el) el.addEventListener(evt, fn); }

  function fmt(n, unit) {
    var rounded = Math.round(n * 10) / 10;
    return rounded + (unit || '');
  }

  // Parses a segment duration string into decimal hours.
  // Accepts: "1:45" · "1h45m" · "1h 45m" · "45m" · "1.75" · "2"
  function parseDuration(str) {
    str = (str || '').trim().toLowerCase();
    if (!str) return 0;
    // "1h45m", "1h 45m", "1h45", "2h" — hours with optional minutes
    var hmMatch = str.match(/^(\d+(?:\.\d+)?)\s*h\s*(\d+)?\s*m?$/);
    if (hmMatch) {
      return (parseFloat(hmMatch[1]) || 0) + (parseFloat(hmMatch[2] || 0)) / 60;
    }
    // "45m", "45min" — minutes only
    var mMatch = str.match(/^(\d+(?:\.\d+)?)\s*m(?:in)?$/);
    if (mMatch) {
      return (parseFloat(mMatch[1]) || 0) / 60;
    }
    // "1:45" — colon-separated h:m
    var colonParts = str.split(':');
    if (colonParts.length === 2) {
      return (parseFloat(colonParts[0]) || 0) + (parseFloat(colonParts[1]) || 0) / 60;
    }
    // plain number = decimal hours
    return parseFloat(str) || 0;
  }

  // Formats decimal hours for editing in duration inputs: 1.75 → "1:45", 2 → "2:00"
  function formatDuration(hours) {
    if (!hours || hours <= 0) return '';
    var h = Math.floor(hours);
    var m = Math.round((hours - h) * 60);
    if (m === 60) { h += 1; m = 0; }
    return h + ':' + (m < 10 ? '0' : '') + m;
  }

  function parseHMS(str) {
    str = (str || '').trim();
    var parts = str.split(':');
    if (parts.length === 3) {
      return (parseFloat(parts[0]) || 0) + (parseFloat(parts[1]) || 0) / 60 + (parseFloat(parts[2]) || 0) / 3600;
    }
    if (parts.length === 2) {
      return (parseFloat(parts[0]) || 0) + (parseFloat(parts[1]) || 0) / 60;
    }
    return parseFloat(str) || 0;
  }

  function formatHMS(hours) {
    if (!hours || hours <= 0) return '—';
    var h = Math.floor(hours);
    var rem = (hours - h) * 60;
    var m = Math.floor(rem + 0.0001); // rounding guard
    var s = Math.round(((rem - m) + 0.0001) * 60);
    if (s >= 60) { s -= 60; m += 1; }
    if (m >= 60) { m -= 60; h += 1; }
    return h + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  // Display-only format: "6h42m" or "10h" (no seconds shown)
  function formatHM(hours) {
    if (!hours || hours <= 0) return '—';
    var h = Math.floor(hours);
    var rem = (hours - h) * 60;
    var m = Math.floor(rem + 0.0001);
    if (m === 0) return h + 'h';
    return h + 'h' + m + 'm';
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
    swim: 'Swim', vacation: 'Vacation', training_camp: 'Training Camp', other: 'Other'
  };

  // ── Router ─────────────────────────────────────────────────────────────────
  var TAB_VIEWS = { events: true, library: true };

  function navigate(view, params) {
    closeSheet(); // ensure sheet is closed on navigation
    if (params) Object.assign(state, params);
    state.view = view;

    $$('.view').forEach(function (v) { v.classList.remove('active'); });
    var el = $('view-' + view);
    if (el) el.classList.add('active');

    // Show/hide tab bar (hide on detail and form views)
    var hideTabBar = (view === 'detail' || view === 'create' ||
                      view === 'product-form' || view === 'landing' ||
                      view === 'claim' || view === 'recovery' || view === 'settings');
    var tabBar = $('tab-bar');
    if (tabBar) tabBar.style.display = hideTabBar ? 'none' : '';

    var topNav = $('top-nav');
    if (topNav) topNav.style.display = hideTabBar ? 'none' : '';
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

    // Update claim indicator visibility on every navigation
    _refreshClaimIndicator();
  }

  // ── Renders (populated in later tasks) ────────────────────────────────────
  var renders = {};

  // ── Segment form HTML helper (used by renderCreate) ────────────────────────
  function segmentFormHTML(seg, idx, total, isMultiDay) {
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
        (isMultiDay
          ? '<div class="form-group">' +
              '<label>Date</label>' +
              '<input class="form-input seg-date" type="date" value="' + escHtml(seg.date || '') + '">' +
            '</div>'
          : '') +
        '<div class="form-group">' +
          '<label>Duration</label>' +
          '<input class="form-input seg-duration" type="text" inputmode="text" value="' + formatDuration(seg.durationHours) + '" placeholder="e.g. 1:45 or 1h45m">' +
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

  function eventCardHTML(evt) {
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
        (evt.date
          ? (evt.category === 'multi' && evt.endDate
              ? escHtml(evt.date) + ' — ' + escHtml(evt.endDate)
              : escHtml(evt.date)) + ' · '
          : '') +
        hLabel + ' · ' +
        Math.round(totals.carbs) + 'g carbs · ' +
        Math.round(totals.sodium) + 'mg Na' +
      '</div>' +
    '</div>';
  }

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
      _refreshClaimIndicator();
      return;
    }

    var today = new Date().toISOString().slice(0, 10);
    function eventArchiveDate(evt) {
      return (evt.category === 'multi' && evt.endDate) ? evt.endDate : evt.date;
    }
    var upcoming = events.filter(function (evt) {
      var d = eventArchiveDate(evt);
      return !d || d >= today;
    });
    var past = events.filter(function (evt) {
      var d = eventArchiveDate(evt);
      return d && d < today;
    });

    var html = upcoming.map(eventCardHTML).join('');

    if (past.length) {
      html += '<details class="past-events-section">' +
        '<summary class="past-events-summary">Past events (' + past.length + ')</summary>' +
        '<div class="past-events-list">' +
          past.map(eventCardHTML).join('') +
        '</div>' +
      '</details>';
    }

    $list.innerHTML = html;

    $list.querySelectorAll('.event-card').forEach(function (card) {
      on(card, 'click', function () {
        navigate('detail', { currentEventId: card.dataset.eventId });
      });
    });
    _refreshClaimIndicator();
  }

  renders.events = renderEventsList;

  function _refreshClaimIndicator() {
    var indicator = $('claim-indicator');
    if (!indicator) return;
    // Hide on full-screen flows where the banner would be intrusive or redundant
    var hideOnView = (state.view === 'landing' || state.view === 'claim' || state.view === 'recovery');
    if (!hideOnView && !_indicatorDismissed && localStorage.getItem('fuelPlanner.isAnonymous') === 'true') {
      indicator.classList.remove('hidden');
    } else {
      indicator.classList.add('hidden');
    }
  }

  renders.claim = function () {
    _currentPhrase = Data.generatePhrase();
    var phraseEl = $('claim-phrase');
    if (phraseEl) phraseEl.textContent = _currentPhrase;
    var checkbox = $('claim-saved-checkbox');
    if (checkbox) checkbox.checked = false;
    var saveBtn = $('btn-save-claim');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Save and continue'; }
  };

  renders.recovery = function () {
    var input = $('recovery-phrase-input');
    if (input) input.value = '';
    var errorEl = $('recovery-error');
    if (errorEl) { errorEl.textContent = ''; errorEl.classList.add('hidden'); }
    var btn = $('btn-find-data');
    if (btn) { btn.disabled = false; btn.textContent = 'Find my data'; }
  };

  on($('btn-new-event'), 'click', function () {
    navigate('create', { currentEventId: null });
  });

  on($('btn-new-event-nav'), 'click', function () {
    navigate('create', { currentEventId: null });
  });

  // ── Create / Edit event ────────────────────────────────────────────────────

  // draftSegments is rebuilt each time the create view opens
  var draftSegments = [];

  function _applyMultiDayToggle(isMulti) {
    var endDateInput = $('ef-end-date');
    if (!endDateInput) return;
    if (isMulti) {
      endDateInput.classList.remove('ef-end-date-hidden');
    } else {
      endDateInput.classList.add('ef-end-date-hidden');
      endDateInput.value = '';
    }
  }

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

    $('ef-name').value     = evt ? evt.name : '';
    $('ef-date').value     = evt ? (evt.date || '') : new Date().toISOString().slice(0, 10);
    $('ef-category').value = evt ? (evt.category || 'single') : 'single';
    $('ef-type').value     = evt ? evt.type : 'ride';
    $('ef-notes').value    = evt ? (evt.notes || '') : '';

    var endDateInput = $('ef-end-date');
    endDateInput.value = evt ? (evt.endDate || '') : '';
    _applyMultiDayToggle($('ef-category').value === 'multi');

    $('ef-category').onchange = function () {
      syncDraftSegmentsFromDOM();
      _applyMultiDayToggle(this.value === 'multi');
      renderSegmentForms();
    };

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
      var dur = parseDuration(card.querySelector('.seg-duration').value);
      if (dur > 0) seg.durationHours = dur;
      var carbs = parseFloat(card.querySelector('.seg-carbs-target').value);
      if (!isNaN(carbs)) seg.targets.carbsPerHour = carbs;
      var sodium = parseFloat(card.querySelector('.seg-sodium-target').value);
      if (!isNaN(sodium)) seg.targets.sodiumPerHour = sodium;
      var caff = parseFloat(card.querySelector('.seg-caffeine-target').value);
      if (!isNaN(caff)) seg.targets.caffeinePerHour = caff;
      var segDateEl = card.querySelector('.seg-date');
      if (segDateEl) seg.date = segDateEl.value;
    });
  }

  function renderSegmentForms() {
    var $list = $('segments-form-list');
    var isMultiDay = $('ef-category') && $('ef-category').value === 'multi';
    $list.innerHTML = draftSegments.map(function (seg, i) {
      return segmentFormHTML(seg, i, draftSegments.length, isMultiDay);
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
    var isMulti = $('ef-category') && $('ef-category').value === 'multi';
    var startDate = isMulti ? ($('ef-date').value || '') : '';
    draftSegments.push(Data.newSegment('', 1, startDate));
    renderSegmentForms();
    // Scroll to new segment
    var cards = $$('[data-seg-draft-id]');
    if (cards.length) cards[cards.length - 1].scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  on($('event-form'), 'submit', async function (e) {
    e.preventDefault();
    var name = $('ef-name').value.trim();
    if (!name) { $('ef-name').focus(); return; }

    var category = $('ef-category').value;
    var endDate  = $('ef-end-date').value;
    if (category === 'multi' && endDate && endDate < $('ef-date').value) {
      showToast('End date must be on or after the start date.');
      return;
    }

    var segCards = $$('[data-seg-draft-id]');
    var segments = Array.from(segCards).map(function (card) {
      var id = card.dataset.segDraftId;
      var existing = draftSegments.find(function (s) { return s.id === id; });
      var segDateEl = card.querySelector('.seg-date');
      return {
        id:            id,
        name:          card.querySelector('.seg-name').value.trim() || name,
        date:          segDateEl ? segDateEl.value : '',
        durationHours: parseDuration(card.querySelector('.seg-duration').value) || 1,
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
        endDate:  $('ef-end-date').value,
        category: $('ef-category').value,
        type:     $('ef-type').value,
        notes:    $('ef-notes').value.trim(),
        segments: segments
      });
    } else {
      evt = Object.assign(Data.newEvent(name), {
        date:     $('ef-date').value,
        endDate:  $('ef-end-date').value,
        category: $('ef-category').value,
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

    state.currentEvent = evt;

    var archiveDate = (evt.category === 'multi' && evt.endDate) ? evt.endDate : evt.date;
    var canAddActuals = isEventPastOrToday(archiveDate);
    var showActuals   = canAddActuals && Object.keys(evt.actuals).length > 0;

    $('detail-event-name').textContent = evt.name;

    var totals = Data.calcEventTotals(evt);
    var rates  = Data.calcEventRates(evt);
    var totalH = totals.durationHours;

    var actTotals  = showActuals ? Data.calcActualEventTotals(evt) : null;
    var actRates   = showActuals ? Data.calcActualEventRates(evt)  : null;
    var goalRates  = showActuals ? Data.calcEventGoalRates(evt)    : null;

    $('detail-summary').innerHTML =
      '<div class="event-meta-row">' +
        '<span class="type-badge">' + (EVENT_TYPE_LABELS[evt.type] || escHtml(evt.type)) + '</span>' +
        (evt.date
          ? '<span class="event-meta-date">' +
              (evt.category === 'multi' && evt.endDate
                ? escHtml(evt.date) + ' — ' + escHtml(evt.endDate)
                : escHtml(evt.date)) +
            '</span>'
          : '') +
      '</div>' +
      '<div class="summary-cards">' +
        metricCardHTML('carbs',    Math.round(totals.carbs) + 'g',  fmt(rates.carbs, 'g/hr avg'),
          actTotals ? Math.round(actTotals.carbs) + 'g'   : undefined,
          actRates  ? fmt(actRates.carbs, 'g/hr avg')     : undefined,
          goalRates ? fmt(goalRates.carbs, 'g/hr goal')   : undefined) +
        metricCardHTML('sodium',   Math.round(totals.sodium) + 'mg', fmt(rates.sodium, 'mg/hr avg'),
          actTotals ? Math.round(actTotals.sodium) + 'mg' : undefined,
          actRates  ? fmt(actRates.sodium, 'mg/hr avg')   : undefined,
          goalRates ? fmt(goalRates.sodium, 'mg/hr goal') : undefined) +
        metricCardHTML('caffeine', Math.round(totals.caffeine) + 'mg', fmt(rates.caffeine, 'mg/hr avg'),
          actTotals ? Math.round(actTotals.caffeine) + 'mg' : undefined,
          actRates  ? fmt(actRates.caffeine, 'mg/hr avg')   : undefined,
          goalRates ? fmt(goalRates.caffeine, 'mg/hr goal') : undefined) +
      '</div>';

    var multiSeg = evt.segments.length > 1;
    var $body = $('detail-body');
    $body.innerHTML =
      evt.segments.map(function (seg) {
        var html = segmentSectionHTML(seg, multiSeg);
        if (showActuals) {
          var actualSeg = evt.actuals[seg.id] || { durationHours: null, items: [] };
          html += actualSegmentSectionHTML(seg, actualSeg, evt.category === 'multi');
        }
        return html;
      }).join('') +
      (multiSeg ? totalsFooterHTML(totals, totalH) : '') +
      '<div style="padding:8px 16px"><button id="btn-copy-plan" type="button" class="btn-secondary" style="margin-top:8px">Copy plan</button></div>' +
      (showActuals ? postEventNotesHTML(evt.postEventNotes) : '') +
      (showActuals
        ? '<div class="clear-actuals-section"><button class="btn-clear-actuals" data-clear-actuals>Remove post-event data</button></div>'
        : '') +
      (canAddActuals && !showActuals
        ? '<div class="start-actuals-section"><button class="btn-secondary" data-start-actuals>📝 Log post-event data</button></div>'
        : '');

    attachDetailHandlers(evt);
  }

  function metricCardHTML(key, value, rate, actualValue, actualRate, goalRate) {
    var labels = { carbs: 'Carbs', sodium: 'Sodium', caffeine: 'Caffeine' };
    var hasActuals = actualValue !== undefined;
    return '<div class="metric-card' + (hasActuals ? ' has-actuals' : '') + '">' +
      '<div class="metric-value">' + value + '</div>' +
      (hasActuals ? '<div class="metric-actual">' + actualValue + '</div>' : '') +
      '<div class="metric-label">' + labels[key] + '</div>' +
      '<div class="metric-rate">' + rate + '</div>' +
      (hasActuals ? '<div class="metric-actual-rate">' + actualRate + '</div>' : '') +
      (hasActuals && goalRate ? '<div class="metric-goal-rate">🎯 ' + goalRate + '</div>' : '') +
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

  function actualSegmentSectionHTML(seg, actualSeg, isMultiDay) {
    var dh = actualSeg.durationHours;
    var dhLabel = formatHM(dh);

    var gaugesHTML = '';
    if (dh && dh > 0) {
      var actRates = Data.calcActualSegmentRates(actualSeg);
      var tgt = seg.targets;
      var pctCarbs  = tgt.carbsPerHour   ? Math.min(actRates.carbs    / tgt.carbsPerHour   * 100, 150) : 0;
      var pctSodium = tgt.sodiumPerHour  ? Math.min(actRates.sodium   / tgt.sodiumPerHour  * 100, 150) : 0;
      var pctCaff   = tgt.caffeinePerHour ? Math.min(actRates.caffeine / tgt.caffeinePerHour * 100, 150) : 0;
      var stCarbs   = Data.rateStatus(actRates.carbs,    tgt.carbsPerHour);
      var stSodium  = Data.rateStatus(actRates.sodium,   tgt.sodiumPerHour);
      var stCaff    = Data.rateStatus(actRates.caffeine, tgt.caffeinePerHour);
      gaugesHTML =
        '<div class="progress-group actual-progress">' +
          progressRowHTML('Carbs',    fmt(actRates.carbs,    'g/hr'), pctCarbs,  stCarbs)  +
          progressRowHTML('Sodium',   fmt(actRates.sodium,   'mg/hr'), pctSodium, stSodium) +
          progressRowHTML('Caffeine', fmt(actRates.caffeine, 'mg/hr'), pctCaff,   stCaff)  +
        '</div>';
    }

    return '<div class="actual-section" data-actual-segment-id="' + seg.id + '">' +
      '<div class="actual-section-header">' +
        '<span class="actual-pill">ACTUAL</span>' +
        '<span class="actual-section-title">' + escHtml(seg.name) + '</span>' +
      '</div>' +
      (isMultiDay && seg.date
        ? '<div class="actual-duration-row">Date: <span>' + escHtml(seg.date) + '</span></div>'
        : '') +
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
      gaugesHTML +
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
        if (btn.closest('.actual-section')) return; // handled by actual stepper handler
        var row = btn.closest('[data-item-id]');
        if (!row) return; // actual item rows use data-actual-item-id — handled separately
        var segSection = btn.closest('[data-segment-id]');
        var itemId = row.dataset.itemId;
        var segId = segSection.dataset.segmentId;
        updateItemQty(evt.id, segId, itemId, btn.dataset.action === 'inc' ? 1 : -1);
      });
    });

    // Add item buttons (planned segments)
    $$('[data-add-segment-id]', $('detail-body')).forEach(function (btn) {
      on(btn, 'click', function () {
        openAddItemSheet(evt.id, btn.dataset.addSegmentId);
      });
    });

    // Add item buttons (actual segments)
    $$('[data-add-actual-segment-id]', $('detail-body')).forEach(function (btn) {
      on(btn, 'click', function () {
        openAddItemSheet(evt.id, btn.dataset.addActualSegmentId, true);
      });
    });

    // Inline editable segment fields
    $$('[data-inline]:not([data-inline="actual-duration"])', $('detail-body')).forEach(function (el) {
      on(el, 'click', function () {
        handleInlineEdit(el, evt.id);
      });
    });

    // Actual stepper buttons
    $$('.actual-section .stepper-btn', $('detail-body')).forEach(function (btn) {
      on(btn, 'click', function () {
        var row    = btn.closest('[data-actual-item-id]');
        var secEl  = btn.closest('[data-actual-segment-id]');
        if (!row || !secEl) return;
        var itemId = row.dataset.actualItemId;
        var segId  = secEl.dataset.actualSegmentId;
        updateActualItemQty(evt.id, segId, itemId, btn.dataset.action === 'inc' ? 1 : -1);
      });
    });

    // Actual duration inline edit
    $$('[data-inline="actual-duration"]', $('detail-body')).forEach(function (el) {
      on(el, 'click', function () {
        var secEl = el.closest('[data-actual-segment-id]');
        if (!secEl) return;
        var segId = secEl.dataset.actualSegmentId;
        // Show hh:mm:ss in the input (not the display "Xh Ym" label)
        var dh = (state.currentEvent && state.currentEvent.actuals && state.currentEvent.actuals[segId])
          ? state.currentEvent.actuals[segId].durationHours : null;
        el.textContent = dh ? formatHMS(dh) : '';
        makeEditable(el, async function (val) {
          try {
            var evt2 = await Data.getEvent(evt.id);
            if (!evt2) return;
            var num = parseHMS(val);
            if (!num || num <= 0) {
              showToast('Duration must be greater than 0.');
              await renderDetail();
              return;
            }
            if (!evt2.actuals[segId]) evt2.actuals[segId] = { durationHours: null, items: [] };
            evt2.actuals[segId].durationHours = num;
            await Data.saveActuals(evt2.id, evt2.actuals, evt2.postEventNotes);
            await renderDetail();
          } catch (e) {
            showToast("Couldn't save — check your connection.");
          }
        });
      });
    });

    // Post-event notes — save on blur
    var notesTextarea = $('post-event-notes');
    if (notesTextarea) {
      on(notesTextarea, 'blur', async function () {
        try {
          if (!document.contains(notesTextarea)) return; // element detached (e.g. re-render)
          var evt2 = await Data.getEvent(evt.id);
          if (!evt2) return;
          await Data.saveActuals(evt2.id, evt2.actuals, notesTextarea.value.trim());
        } catch (e) {
          showToast("Couldn't save — check your connection.");
        }
      });
    }

    // Start actuals button
    var startActualsBtn = document.querySelector('[data-start-actuals]');
    if (startActualsBtn) {
      on(startActualsBtn, 'click', function () {
        startActuals(evt.id);
      });
    }

    // Clear actuals button
    var clearActualsBtn = document.querySelector('[data-clear-actuals]');
    if (clearActualsBtn) {
      on(clearActualsBtn, 'click', function () {
        clearActuals(evt.id);
      });
    }

    // Copy plan button
    var copyPlanBtn = $('btn-copy-plan');
    if (copyPlanBtn) {
      on(copyPlanBtn, 'click', function () {
        var md = Export.generateEventMarkdown(evt);
        navigator.clipboard.writeText(md).then(function () {
          showToast('Plan copied!');
        }).catch(function () {
          showToast("Couldn't copy — try again.");
        });
      });
    }
  }

  function refreshSummaryCards() {
    var evt = state.currentEvent;
    if (!evt) return;
    var totals  = Data.calcEventTotals(evt);
    var rates   = Data.calcEventRates(evt);
    var archiveDate = (evt.category === 'multi' && evt.endDate) ? evt.endDate : evt.date;
    var showAct = isEventPastOrToday(archiveDate) && Object.keys(evt.actuals || {}).length > 0;
    var actTotals = showAct ? Data.calcActualEventTotals(evt) : null;
    var actRates  = showAct ? Data.calcActualEventRates(evt)  : null;
    var goalRates = showAct ? Data.calcEventGoalRates(evt)    : null;
    var cardsEl = $('detail-summary') && $('detail-summary').querySelector('.summary-cards');
    if (cardsEl) {
      cardsEl.innerHTML =
        metricCardHTML('carbs',    Math.round(totals.carbs)    + 'g',  fmt(rates.carbs,    'g/hr avg'),
          actTotals ? Math.round(actTotals.carbs)    + 'g'  : undefined,
          actRates  ? fmt(actRates.carbs,    'g/hr avg')     : undefined,
          goalRates ? fmt(goalRates.carbs,   'g/hr goal')    : undefined) +
        metricCardHTML('sodium',   Math.round(totals.sodium)   + 'mg', fmt(rates.sodium,   'mg/hr avg'),
          actTotals ? Math.round(actTotals.sodium)   + 'mg' : undefined,
          actRates  ? fmt(actRates.sodium,   'mg/hr avg')    : undefined,
          goalRates ? fmt(goalRates.sodium,  'mg/hr goal')   : undefined) +
        metricCardHTML('caffeine', Math.round(totals.caffeine) + 'mg', fmt(rates.caffeine, 'mg/hr avg'),
          actTotals ? Math.round(actTotals.caffeine) + 'mg' : undefined,
          actRates  ? fmt(actRates.caffeine, 'mg/hr avg')    : undefined,
          goalRates ? fmt(goalRates.caffeine,'mg/hr goal')   : undefined);
    }
    // Also update totals footer if present
    var footerEl = $('detail-body') && $('detail-body').querySelector('.totals-footer');
    if (footerEl) {
      var totalH = totals.durationHours;
      footerEl.outerHTML = totalsFooterHTML(totals, totalH);
    }
  }

  function reattachSegmentHandlers(segId) {
    var evt = state.currentEvent;
    var segEl = document.querySelector('[data-segment-id="' + segId + '"]');
    if (!segEl || !evt) return;
    $$('.stepper-btn', segEl).forEach(function (btn) {
      on(btn, 'click', function () {
        var row = btn.closest('[data-item-id]');
        if (!row) return;
        var itemId = row.dataset.itemId;
        updateItemQty(evt.id, segId, itemId, btn.dataset.action === 'inc' ? 1 : -1);
      });
    });
    $$('[data-add-segment-id]', segEl).forEach(function (btn) {
      on(btn, 'click', function () {
        openAddItemSheet(evt.id, btn.dataset.addSegmentId);
      });
    });
    $$('[data-inline]:not([data-inline="actual-duration"])', segEl).forEach(function (el) {
      on(el, 'click', function () { handleInlineEdit(el, evt.id); });
    });
  }

  function reattachActualSegmentHandlers(segId) {
    var evt = state.currentEvent;
    var secEl = document.querySelector('[data-actual-segment-id="' + segId + '"]');
    if (!secEl || !evt) return;
    $$('.stepper-btn', secEl).forEach(function (btn) {
      on(btn, 'click', function () {
        var row = btn.closest('[data-actual-item-id]');
        if (!row) return;
        var itemId = row.dataset.actualItemId;
        updateActualItemQty(evt.id, segId, itemId, btn.dataset.action === 'inc' ? 1 : -1);
      });
    });
    $$('[data-add-actual-segment-id]', secEl).forEach(function (btn) {
      on(btn, 'click', function () {
        openAddItemSheet(evt.id, btn.dataset.addActualSegmentId, true);
      });
    });
    $$('[data-inline="actual-duration"]', secEl).forEach(function (el) {
      on(el, 'click', function () {
        if (el.querySelector('input')) return;
        // Show hh:mm:ss in the input (not the display "Xh Ym" label)
        var dh = (state.currentEvent && state.currentEvent.actuals && state.currentEvent.actuals[segId])
          ? state.currentEvent.actuals[segId].durationHours : null;
        el.textContent = dh ? formatHMS(dh) : '';
        makeEditable(el, async function (val) {
          try {
            var num = parseHMS(val);
            if (!num || num <= 0) {
              showToast('Duration must be greater than 0.');
              await renderDetail();
              return;
            }
            var evt2 = await Data.getEvent(evt.id);
            if (!evt2) return;
            if (!evt2.actuals[segId]) evt2.actuals[segId] = { durationHours: null, items: [] };
            evt2.actuals[segId].durationHours = num;
            await Data.saveActuals(evt2.id, evt2.actuals, evt2.postEventNotes);
            await renderDetail();
          } catch (e) {
            showToast("Couldn't save — check your connection.");
          }
        });
      });
    });
  }

  function updateItemQty(eventId, segId, itemId, delta) {
    var evt = state.currentEvent;
    if (!evt || evt.id !== eventId) return;

    var seg = evt.segments.find(function (s) { return s.id === segId; });
    if (!seg) return;
    var item = seg.items.find(function (i) { return i.id === itemId; });
    if (!item) return;

    item.quantity = Math.max(0, item.quantity + delta);
    if (item.quantity === 0) {
      seg.items = seg.items.filter(function (i) { return i.id !== itemId; });
    }

    // Re-render just this segment section
    var multiSeg = evt.segments.length > 1;
    var segEl = document.querySelector('[data-segment-id="' + segId + '"]');
    if (segEl) {
      segEl.outerHTML = segmentSectionHTML(seg, multiSeg);
      reattachSegmentHandlers(segId);
    }
    refreshSummaryCards();

    // Save in background
    Data.saveEvent(evt).catch(function () {
      showToast("Couldn't save — check your connection.");
    });
  }

  function updateActualItemQty(eventId, segId, itemId, delta) {
    var evt = state.currentEvent;
    if (!evt || evt.id !== eventId) return;

    if (!evt.actuals) evt.actuals = {};
    var actualSeg = evt.actuals[segId];
    if (!actualSeg) return;
    var item = actualSeg.items.find(function (i) { return i.id === itemId; });
    if (!item) return;

    item.quantity = Math.max(0, item.quantity + delta);
    if (item.quantity === 0) {
      actualSeg.items = actualSeg.items.filter(function (i) { return i.id !== itemId; });
    }

    // Re-render just this actual section
    var seg = evt.segments.find(function (s) { return s.id === segId; });
    var secEl = document.querySelector('[data-actual-segment-id="' + segId + '"]');
    if (secEl && seg) {
      secEl.outerHTML = actualSegmentSectionHTML(seg, actualSeg);
      reattachActualSegmentHandlers(segId);
    }
    refreshSummaryCards();

    // Save in background
    Data.saveActuals(evt.id, evt.actuals, evt.postEventNotes).catch(function () {
      showToast("Couldn't save — check your connection.");
    });
  }

  async function startActuals(eventId) {
    var evt;
    try { evt = await Data.getEvent(eventId); }
    catch (e) { showToast("Couldn't load event — check your connection."); return; }
    if (!evt) return;

    evt.segments.forEach(function (seg) {
      if (!evt.actuals[seg.id]) {
        evt.actuals[seg.id] = {
          durationHours: seg.durationHours,
          items: seg.items.map(function (item) {
            return Object.assign({}, item, { id: Data.generateId() });
          })
        };
      }
    });

    try {
      await Data.saveActuals(evt.id, evt.actuals, evt.postEventNotes);
      await renderDetail();
    } catch (e) {
      showToast("Couldn't save — check your connection.");
    }
  }

  async function clearActuals(eventId) {
    try {
      await Data.saveActuals(eventId, null, null);
      if (state.currentEvent && state.currentEvent.id === eventId) {
        state.currentEvent.actuals = {};
        state.currentEvent.postEventNotes = '';
      }
      await renderDetail();
    } catch (e) {
      showToast("Couldn't save — check your connection.");
    }
  }

  renders.detail = renderDetail;

  // ── Add item sheet ─────────────────────────────────────────────────────────

  var _sheetEventId = null;
  var _sheetSegmentId = null;
  var _sheetIsActual = false;

  function openAddItemSheet(eventId, segmentId, isActual) {
    _sheetEventId   = eventId;
    _sheetSegmentId = segmentId;
    _sheetIsActual  = !!isActual;
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
    _sheetEventId   = null;
    _sheetSegmentId = null;
    _sheetIsActual  = false;
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

    if (query) {
      // Search results: flat list sorted alphabetically, no category headers.
      filtered.sort(function (a, b) {
        return productSortKey(a) < productSortKey(b) ? -1 : productSortKey(a) > productSortKey(b) ? 1 : 0;
      });
      $results.innerHTML = filtered.map(function (p) { return productRowSheetHTML(p); }).join('');
    } else {
      // No query: group by type, sort within each group, show category headings.
      var sheetGroups = {};
      filtered.forEach(function (p) {
        var key = normalizeType(p.type);
        if (!sheetGroups[key]) sheetGroups[key] = [];
        sheetGroups[key].push(p);
      });
      Object.keys(sheetGroups).forEach(function (key) {
        sheetGroups[key].sort(function (a, b) {
          return productSortKey(a) < productSortKey(b) ? -1 : productSortKey(a) > productSortKey(b) ? 1 : 0;
        });
      });
      var sheetTypes = TYPE_ORDER.concat(
        Object.keys(sheetGroups).filter(function (t) { return TYPE_ORDER.indexOf(t) === -1; }).sort()
      ).filter(function (t) { return sheetGroups[t]; });
      $results.innerHTML = sheetTypes.map(function (type) {
        return '<div class="product-group-title" style="padding:8px 16px 4px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--text-tertiary)">' +
          escHtml(TYPE_LABELS[type] || type) + 's' +
        '</div>' +
        sheetGroups[type].map(function (p) { return productRowSheetHTML(p); }).join('');
      }).join('');
    }
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
          if (_sheetIsActual) {
            await addItemToActualSegment(_sheetEventId, _sheetSegmentId, Data.itemFromProduct(product));
          } else {
            await addItemToSegment(_sheetEventId, _sheetSegmentId, Data.itemFromProduct(product));
          }
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

  async function addItemToActualSegment(eventId, segmentId, item) {
    var evt = await Data.getEvent(eventId);
    if (!evt) throw new Error('Event not found');
    if (!evt.actuals) evt.actuals = {};
    if (!evt.actuals[segmentId]) {
      evt.actuals[segmentId] = { durationHours: null, items: [] };
    }
    evt.actuals[segmentId].items.push(item);
    await Data.saveActuals(evt.id, evt.actuals, evt.postEventNotes);
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
      if (_sheetIsActual) {
        await addItemToActualSegment(_sheetEventId, _sheetSegmentId, item);
      } else {
        await addItemToSegment(_sheetEventId, _sheetSegmentId, item);
      }
      closeSheet();
      await renderDetail();
    } catch (e) {
      showToast("Couldn't save — check your connection.");
    }
  });

  // ── Product library ──────────────────────────────────────────────────────────

  var TYPE_ORDER = ['bar', 'chew', 'drink_powder', 'gel', 'liquid'];

  // Normalise a product type string to a canonical lowercase key so that
  // "Gel", "gel", "Drink Powder", "drink_powder" all map to the same group.
  function normalizeType(type) {
    if (!type) return 'other';
    return type.toLowerCase().replace(/\s+/g, '_');
  }

  // Sort key for a product: "Brand Name" → lowercase, used for alphabetical ordering.
  function productSortKey(p) {
    return ((p.brand ? p.brand + ' ' : '') + p.name).toLowerCase();
  }

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

    // Group by normalised type key so "Gel" and "gel" land in the same bucket.
    var groups = {};
    products.forEach(function (p) {
      var key = normalizeType(p.type);
      if (!groups[key]) groups[key] = [];
      groups[key].push(p);
    });

    // Sort each group alphabetically by brand + name.
    Object.keys(groups).forEach(function (key) {
      groups[key].sort(function (a, b) {
        return productSortKey(a) < productSortKey(b) ? -1 : productSortKey(a) > productSortKey(b) ? 1 : 0;
      });
    });

    var types = TYPE_ORDER.concat(
      Object.keys(groups).filter(function (t) { return TYPE_ORDER.indexOf(t) === -1; }).sort()
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

  function renderSettings() {
    var isAnonymous = localStorage.getItem('fuelPlanner.isAnonymous') === 'true';
    var section = $('settings-account-section');
    if (!section) return;

    if (isAnonymous) {
      section.innerHTML =
        '<div class="form-card" style="margin-top:16px">' +
          '<p style="margin:0 0 12px">Claim your account to protect your data and get a recovery phrase for linking this account on another device.</p>' +
          '<button id="btn-settings-go-claim" class="btn-primary">Claim account</button>' +
        '</div>';
      on($('btn-settings-go-claim'), 'click', function () {
        state.claimReturnView = 'settings';
        navigate('claim');
      });
    } else {
      section.innerHTML =
        '<div class="form-card" style="margin-top:16px">' +
          '<p style="margin:0 0 4px;font-weight:600">Recovery phrase</p>' +
          '<p style="margin:0 0 12px;color:var(--text-secondary);font-size:14px">For security reasons, your recovery phrase was never stored, so we can\'t show it to you. If you\'ve lost it, generate a new one below. Be sure to save it immediately, as your old phrase will stop working.</p>' +
          '<button id="btn-settings-new-phrase" class="btn-secondary">Generate new recovery phrase</button>' +
        '</div>';
      on($('btn-settings-new-phrase'), 'click', function () {
        if (!confirm('This will replace your current recovery phrase. Your old phrase will stop working immediately. Make sure you\'re ready to save the new one before continuing.')) return;
        state.claimReturnView = 'settings';
        navigate('claim');
      });
    }
  }

  renders.library = renderLibrary;
  renders.settings = renderSettings;

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
    $('pf-type').value     = product ? (TYPE_LABELS[product.type] || product.type) : 'Gel';
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
      type:            $('pf-type').value.trim() || 'other',
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
          var dur = parseDuration(value);
          if (dur > 0) seg.durationHours = dur;
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

    // Normalise the element text to the editable format before makeEditable() runs
    if (field === 'seg-duration') {
      // Show h:mm so the user can type in the same format they'll see in the form
      var curSeg = state.currentEvent && state.currentEvent.segments.find(function (s) { return s.id === segId; });
      el.textContent = curSeg ? formatDuration(curSeg.durationHours) : '';
    } else if (field !== 'seg-name') {
      var raw = el.textContent.trim();
      el.textContent = parseFloat(raw.replace(/[^0-9.]/g, '')) || 0;
    }

    makeEditable(el, saveSegmentField);
  }

  // ── Init ───────────────────────────────────────────────────────────────────
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

    // ── Tab bar — registered early so it works immediately after Get Started ────
    $$('.tab-btn').forEach(function (btn) {
      on(btn, 'click', function () { navigate(btn.dataset.tabView); });
    });

    // ── Settings gear buttons ──────────────────────────────────────────────────
    function openSettings() {
      state.settingsReturnView = state.view;
      navigate('settings');
    }
    on($('btn-settings-events'), 'click', openSettings);
    on($('btn-settings-library'), 'click', openSettings);
    on($('btn-settings-nav'), 'click', openSettings);
    on($('btn-settings-back'), 'click', function () {
      navigate(state.settingsReturnView || 'events');
    });

    // Claim indicator: tapping the text/background opens claim screen;
    // tapping the dismiss button hides it for this session only.
    on($('claim-indicator'), 'click', function (e) {
      var dismissBtn = $('btn-dismiss-indicator');
      if (dismissBtn && dismissBtn.contains(e.target)) return;
      state.claimReturnView = 'events';
      navigate('claim');
    });
    on($('btn-dismiss-indicator'), 'click', function (e) {
      e.stopPropagation();
      _indicatorDismissed = true;
      var indicator = $('claim-indicator');
      if (indicator) indicator.classList.add('hidden');
    });

    // Claim screen
    on($('btn-claim-back'), 'click', function () {
      navigate(state.claimReturnView || 'landing');
    });

    on($('btn-regenerate-phrase'), 'click', function () {
      _currentPhrase = Data.generatePhrase();
      var phraseEl = $('claim-phrase');
      if (phraseEl) phraseEl.textContent = _currentPhrase;
    });

    on($('btn-copy-phrase'), 'click', function () {
      navigator.clipboard.writeText(_currentPhrase).then(function () {
        showToast('Phrase copied!');
      }).catch(function () {
        showToast("Copy failed \u2014 write down the phrase above.");
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
        _refreshClaimIndicator();
        state.claimReturnView = null;
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
      if (!phrase.trim()) {
        if (errorEl) {
          errorEl.textContent = 'Please enter your recovery phrase.';
          errorEl.classList.remove('hidden');
        }
        return;
      }
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

    // ── Identity check — must come before any data access ─────────────────────
    // All handlers above are safe to register for anonymous users too.
    if (!localStorage.getItem('fuelPlanner.userId')) {
      navigate('landing');
      return;
    }

    // Record this visit (fire-and-forget — never blocks the UI)
    Data.touchLastVisited().catch(function (e) { console.warn('touchLastVisited failed:', e); });

    // Migrate localStorage data to Supabase on first load
    try {
      await Data.migrateIfNeeded();
    } catch (e) {
      console.error('Migration failed:', e);
      showToast("Migration failed \u2014 your local data is safe. Will retry next load.");
    }

    navigate('events');
  }

  document.addEventListener('DOMContentLoaded', init);

  // Expose for later tasks
  window._App = {
    state: state, navigate: navigate, renders: renders,
    $: $, $$: $$, on: on, fmt: fmt, escHtml: escHtml,
    formatHM: formatHM,
    segmentFormHTML: segmentFormHTML,
    TYPE_LABELS: TYPE_LABELS, EVENT_TYPE_LABELS: EVENT_TYPE_LABELS
  };

})();
