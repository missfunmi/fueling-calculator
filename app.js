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
