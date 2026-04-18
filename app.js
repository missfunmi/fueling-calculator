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
