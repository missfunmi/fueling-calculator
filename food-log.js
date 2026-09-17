// food-log.js
(function () {
  'use strict';

  var _A = window._App; // navigate, renders, $, $$, on, escHtml

  var COMPONENT_COLORS = ['#5b9bd5', '#e8a04b', '#6abf69', '#e8585e', '#9b7dd4', '#4bbfbf'];
  var CATEGORY_COLORS = {
    'breakfast':    { bg: 'var(--amber-bg)',  color: 'var(--amber-text)'  },
    'lunch':        { bg: 'var(--blue-bg)',   color: 'var(--blue-text)'   },
    'dinner':       { bg: 'var(--purple-bg)', color: 'var(--purple-text)' },
    'fuel':         { bg: 'var(--red-bg)',    color: 'var(--red-text)'    },
    'snack':        { bg: 'var(--green-bg)',  color: 'var(--green-text)'  },
    'pre-workout':  { bg: 'var(--red-bg)',    color: 'var(--red-text)'    },
    'post-workout': { bg: 'var(--green-bg)',  color: 'var(--green-text)'  }
  };

  // ── Item display helpers ─────────────────────────────────────────────────────

  // Core display primitive — accepts {calories, protein, carbs, fat, fiber, sodium}.
  function macroMetaFromValues(v) {
    var meta = [];
    if (v.calories != null) meta.push(Math.round(v.calories) + ' kcal');
    if (v.protein  != null) meta.push(Math.round(v.protein)  + 'g protein');
    if (v.carbs    != null) meta.push(Math.round(v.carbs)    + 'g carbs');
    if (v.fat      != null) meta.push(Math.round(v.fat)      + 'g fat');
    if (v.fiber    != null) meta.push(Math.round(v.fiber)    + 'g fiber');
    if (v.sodium   != null) meta.push(Math.round(v.sodium)   + 'mg sodium');
    return meta;
  }

  // Returns formatted macro strings for a library item (per-serving field names).
  function itemMacroMeta(item) {
    return macroMetaFromValues({
      calories: item.caloriesPerServing,
      protein:  item.proteinPerServing,
      carbs:    item.carbsPerServing,
      fat:      item.fatPerServing,
      fiber:    item.fiberPerServing,
      sodium:   item.sodiumPerServing
    });
  }

  // Returns serving context string ('per 63g', 'per 1 scoop', or '') — no leading space.
  function itemServingContext(item) {
    if (item.servingSize != null && item.servingSize > 0) {
      return 'per ' + item.servingSize + (item.servingUnit ? ' ' + _A.escHtml(item.servingUnit) : _A.escHtml('g'));
    }
    if (item.servingUnit) return 'per ' + _A.escHtml(item.servingUnit);
    return '';
  }

  // Returns full meta line for library list and picker rows.
  function itemMetaLine(item) {
    var parts = itemMacroMeta(item);
    var ctx   = itemServingContext(item);
    if (ctx) parts.push(ctx);
    return parts.join(' · ');
  }

  // Module state
  var state = {
    date: todayStr(),
    logs: [],
    targets: null,
    library: [],
    editingEntry: null,
    libraryOnlyMode: false,
    renderGen: 0
  };

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  function fmtDate(str) {
    var d = new Date(str + 'T12:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function prevDate(str) {
    var d = new Date(str + 'T12:00:00');
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  }

  function nextDate(str) {
    var d = new Date(str + 'T12:00:00');
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }

  function pct(val, target) {
    if (!target || !val) return 0;
    return Math.min(100, Math.round((val / target) * 100));
  }

  function sumLogs(logs, key) {
    return logs.reduce(function (acc, l) { return acc + (l[key] || 0); }, 0);
  }

  // ── Progress section ─────────────────────────────────────────────────────────

  function progressHTML(logs, targets) {
    var cal  = Math.round(sumLogs(logs, 'calories'));
    var pro  = Math.round(sumLogs(logs, 'protein'));
    var carb = Math.round(sumLogs(logs, 'carbs'));
    var fat  = Math.round(sumLogs(logs, 'fat'));
    var fib  = logs.some(function (l) { return l.fiber != null; })
               ? Math.round(sumLogs(logs, 'fiber')) : null;
    var sod  = logs.some(function (l) { return l.sodium != null; })
               ? Math.round(sumLogs(logs, 'sodium')) : null;

    var t = targets || {};
    var calTarget  = t.caloriesTarget;
    var proTarget  = t.proteinTarget;
    var carbTarget = t.carbsTarget;
    var fatTarget  = t.fatTarget;
    var fibTarget  = t.fiberTarget;

    function calBarHTML() {
      if (!calTarget) {
        return '<div class="fl-cal-row"><span class="fl-cal-number">' + cal + '</span>' +
               '<span class="fl-cal-target"> kcal</span></div>';
      }
      return '<div class="fl-cal-row"><span class="fl-cal-number">' + cal + '</span>' +
             '<span class="fl-cal-target"> / ' + calTarget + ' kcal</span></div>' +
             '<div class="fl-cal-bar-track"><div class="fl-cal-bar-fill" style="width:' + pct(cal, calTarget) + '%;background:var(--m-cal)"></div></div>';
    }

    function macroRowHTML(label, value, target, color, unit) {
      var valStr = value + (unit || 'g');
      if (!target) {
        return '<div class="fl-macro-row">' +
               '<span class="fl-macro-dot" style="background:' + color + '"></span>' +
               '<span class="fl-macro-label">' + label + '</span>' +
               '<span class="fl-macro-value">' + valStr + '</span>' +
               '</div>';
      }
      return '<div class="fl-macro-row">' +
             '<span class="fl-macro-dot" style="background:' + color + '"></span>' +
             '<span class="fl-macro-label">' + label + '</span>' +
             '<div class="fl-macro-bar-track"><div class="fl-macro-bar-fill" style="width:' + pct(value, target) + '%;background:' + color + '"></div></div>' +
             '<span class="fl-macro-value">' + valStr + ' / ' + target + '</span>' +
             '</div>';
    }

    var rows = [
      macroRowHTML('Protein', pro,  proTarget,  'var(--m-protein)', 'g'),
      macroRowHTML('Carbs',   carb, carbTarget, 'var(--m-carbs)',   'g'),
      macroRowHTML('Fat',     fat,  fatTarget,  'var(--m-fat)',     'g')
    ];
    if (fib !== null || fibTarget) rows.push(macroRowHTML('Fiber', fib != null ? fib : 0, fibTarget, 'var(--m-fiber)', 'g'));
    if (sod !== null) rows.push(macroRowHTML('Sodium', sod, null, 'var(--m-sodium)', 'mg'));

    return '<div class="fl-progress">' + calBarHTML() + rows.join('') + '</div>';
  }

  // ── Date navigation ──────────────────────────────────────────────────────────

  function dateNavHTML(date) {
    var isToday = date === todayStr();
    return '<div class="fl-date-nav">' +
      '<button class="fl-date-nav-btn" id="fl-btn-prev">&#8249;</button>' +
      '<div class="fl-date-center">' +
        (isToday
          ? '<span class="fl-today-label">Today</span>'
          : '<button class="fl-today-jump" id="fl-btn-today">Jump to today</button>') +
        '<label class="fl-date-label-wrap" for="fl-date-picker" style="cursor:pointer;display:flex;align-items:center;gap:4px">' +
          '<span class="fl-date-label">' + _A.escHtml(fmtDate(date)) + '</span>' +
          '<span class="fl-date-caret"><i class="ti ti-chevron-down"></i></span>' +
        '</label>' +
        '<input type="date" id="fl-date-picker" value="' + date + '" max="' + todayStr() + '" ' +
          'style="position:absolute;opacity:0;pointer-events:none;width:0;height:0">' +
      '</div>' +
      '<button class="fl-date-nav-btn" id="fl-btn-next" ' + (isToday ? 'disabled style="opacity:0.3"' : '') + '>&#8250;</button>' +
    '</div>';
  }

  // ── Timeline ─────────────────────────────────────────────────────────────────

  function fmtTime(isoStr) {
    var d = new Date(isoStr);
    var h = d.getHours(), m = d.getMinutes();
    var ampm = h >= 12 ? 'pm' : 'am';
    var hh = h % 12 || 12;
    return hh + ':' + (m < 10 ? '0' : '') + m + ampm;
  }

  function timelineHTML(logs) {
    if (!logs || !logs.length) {
      return '<div class="fl-empty-timeline">No entries yet. Tap + to log a meal.</div>';
    }
    return '<div class="fl-timeline">' +
      logs.map(function (log) {
        var macroParts = [];
        if (log.calories != null) macroParts.push(Math.round(log.calories) + ' kcal');
        if (log.protein != null) macroParts.push(Math.round(log.protein) + 'g protein');
        if (log.carbs   != null) macroParts.push(Math.round(log.carbs)   + 'g carbs');
        if (log.fat     != null) macroParts.push(Math.round(log.fat)     + 'g fat');
        if (log.fiber   != null) macroParts.push(Math.round(log.fiber)   + 'g fiber');
        if (log.sodium  != null) macroParts.push(Math.round(log.sodium)  + 'mg sodium');
        var macroHTML = macroParts.map(function (p) {
          return '<span style="white-space:nowrap">' + _A.escHtml(p) + '</span>';
        }).join(' · ');
        var servingMeta = log.logServingSize != null
          ? (log.logServingSize + (log.logServingUnit ? ' ' + log.logServingUnit : ''))
          : null;
        var pillsHTML = '';
        if (log.components && log.components.length) {
          var libItems  = log.components.filter(function (c) { return c.library_item_id; });
          var freeItems = log.components.filter(function (c) { return !c.library_item_id; });
          var pills = libItems.map(function (c, i) {
            var color = COMPONENT_COLORS[i % COMPONENT_COLORS.length];
            var label = (c.amount_g != null ? c.amount_g + (c.serving_unit ? ' ' + c.serving_unit : 'g') + ' ' : '') + c.name;
            return '<span class="fl-component-pill">' +
              '<span class="fl-component-pill-dot" style="background:' + color + '"></span>' +
              _A.escHtml(label) +
            '</span>';
          });
          if (freeItems.length) {
            var freeLabel = freeItems.map(function (c) { return c.name; }).join(' · ');
            pills.push('<span class="fl-component-pill">' + _A.escHtml(freeLabel) + '</span>');
          }
          pillsHTML =
            '<div class="fl-entry-components" id="fl-ec-' + log.id + '">' + pills.join('') + '</div>' +
            '<div class="fl-entry-expand" data-ec-id="' + log.id + '">▲ Collapse</div>';
        }

        return '<div class="fl-timeline-entry">' +
          '<div class="fl-time-col"><span class="fl-time-text">' + fmtTime(log.loggedAt) + '</span></div>' +
          '<div class="fl-entry-body" data-entry-id="' + log.id + '">' +
            '<div class="fl-entry-name">' + _A.escHtml(log.name) + (servingMeta ? '<span class="fl-entry-serving">' + _A.escHtml(servingMeta) + '</span>' : '') + '</div>' +
            '<div class="fl-entry-meta">' +
              (function() {
                var cat = (log.category || '').trim().toLowerCase();
                var cs = CATEGORY_COLORS[cat];
                return '<span class="fl-category-badge"' + (cs ? ' style="background:' + cs.bg + ';color:' + cs.color + '"' : '') + '>' + _A.escHtml(log.category || 'Other') + '</span>';
              })() +
              macroHTML +
            '</div>' +
            pillsHTML +
          '</div>' +
        '</div>';
      }).join('') +
    '</div>';
  }

  // ── Main render ──────────────────────────────────────────────────────────────

  async function renderFoodLog() {
    var $body = _A.$('food-log-body');
    $body.innerHTML = '<div style="padding:32px;text-align:center;color:var(--text-tertiary)">Loading…</div>';
    state.renderGen = (state.renderGen || 0) + 1;
    var gen = state.renderGen;

    var userId = localStorage.getItem('fuelPlanner.userId');
    if (!userId) {
      $body.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-secondary)">Set up your account first.</div>';
      return;
    }

    try {
      var results = await Promise.all([
        FoodLogData.getLogs(userId, state.date),
        FoodLogData.getTargets(userId),
        FoodLogData.getLibrary(userId)
      ]);
      if (gen !== state.renderGen) return; // stale render, a newer one is in flight
      state.logs    = results[0];
      state.targets = results[1];
      state.library = results[2];
    } catch (e) {
      if (gen !== state.renderGen) return;
      $body.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-secondary)">Couldn\'t load — check your connection.</div>';
      return;
    }

    $body.innerHTML =
      dateNavHTML(state.date) +
      progressHTML(state.logs, state.targets) +
      timelineHTML(state.logs) +
      '<button class="fl-fab" id="fl-fab">+</button>';

    // Date nav handlers
    _A.on(_A.$('fl-btn-prev'), 'click', function () {
      state.date = prevDate(state.date);
      renderFoodLog();
    });
    _A.on(_A.$('fl-btn-next'), 'click', function () {
      if (state.date < todayStr()) {
        state.date = nextDate(state.date);
        renderFoodLog();
      }
    });
    var btnToday = _A.$('fl-btn-today');
    if (btnToday) {
      _A.on(btnToday, 'click', function () {
        state.date = todayStr();
        renderFoodLog();
      });
    }

    // Date label click → open date picker
    var datePicker = _A.$('fl-date-picker');
    var dateWrap = _A.$$('.fl-date-label-wrap', $body)[0];
    if (dateWrap && datePicker) {
      _A.on(dateWrap, 'click', function () {
        try { datePicker.showPicker(); } catch (e) { datePicker.focus(); }
      });
      _A.on(datePicker, 'change', function () {
        if (datePicker.value && datePicker.value <= todayStr()) {
          state.date = datePicker.value;
          renderFoodLog();
        }
      });
    }

    // Gear icon → settings (onclick replaces handler on each render)
    _A.$('btn-food-log-targets').onclick = function () {
      _A.state.settingsReturnView = 'food-log';
      _A.navigate('settings');
    };

    // FAB → new entry
    _A.on(_A.$('fl-fab'), 'click', function () {
      state.editingEntry = null;
      _A.navigate('food-log-entry');
    });

    // Timeline entry taps
    _A.$$('.fl-entry-body', $body).forEach(function (el) {
      _A.on(el, 'click', function () {
        var id = el.dataset.entryId;
        state.editingEntry = state.logs.filter(function (l) { return l.id === id; })[0] || null;
        _A.navigate('food-log-entry');
      });
    });

    // Component pills collapse/expand
    _A.$$('.fl-entry-expand', $body).forEach(function (btn) {
      _A.on(btn, 'click', function (e) {
        e.stopPropagation();
        var ecEl = _A.$('fl-ec-' + btn.dataset.ecId);
        if (!ecEl) return;
        var isVisible = ecEl.style.display !== 'none';
        ecEl.style.display = isVisible ? 'none' : '';
        btn.textContent = isVisible ? '▼ Show components' : '▲ Collapse';
      });
    });
  }

  // ── Food library pane ────────────────────────────────────────────────────────

  function _titleCase(str) {
    return str.trim().split(/\s+/).map(function (w) {
      return w.split('-').map(function (part) {
        return part ? part.charAt(0).toUpperCase() + part.slice(1) : part;
      }).join('-');
    }).join(' ');
  }

  async function renderFoodLibraryPane(paneEl) {
    if (!paneEl) return;
    paneEl.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-tertiary)">Loading…</div>';

    var userId = localStorage.getItem('fuelPlanner.userId');
    var items;
    try {
      items = await FoodLogData.getLibrary(userId);
    } catch (e) {
      paneEl.innerHTML = '<div style="padding:24px;color:var(--text-secondary)">Couldn\'t load food library.</div>';
      return;
    }

    state.library = items;

    if (!items.length) {
      paneEl.innerHTML = '<div style="padding:32px 16px;text-align:center;color:var(--text-tertiary);font-size:14px">No food items yet. Tap + to add your first item.</div>';
      return;
    }

    // Group by category (title-cased); uncategorised → 'Other' (sorted last)
    var groups = {};
    items.forEach(function (item) {
      var key = item.category ? _titleCase(item.category) : 'Other';
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    });
    var sortedKeys = Object.keys(groups).filter(function (k) { return k !== 'Other'; }).sort();
    if (groups['Other']) sortedKeys.push('Other');

    paneEl.innerHTML = sortedKeys.map(function (key) {
      return '<div class="product-group">' +
        '<div class="product-group-title">' + _A.escHtml(key) + '</div>' +
        groups[key].map(function (item) {
          var fullName = (item.brand ? item.brand + ' ' : '') + item.name;
          return '<div class="product-row" data-lib-id="' + item.id + '">' +
            '<div class="product-row-info">' +
              '<div class="product-row-name">' + _A.escHtml(fullName) + '</div>' +
              '<div class="product-row-meta">' + itemMetaLine(item) + '</div>' +
            '</div>' +
            '<span style="color:var(--text-tertiary);font-size:20px">&#8250;</span>' +
          '</div>';
        }).join('') +
      '</div>';
    }).join('');

    var itemsById = {};
    items.forEach(function (item) { itemsById[item.id] = item; });

    _A.$$('.product-row', paneEl).forEach(function (row) {
      _A.on(row, 'click', function () {
        var id = row.dataset.libId;
        var item = itemsById[id];
        if (!item) return;
        state.editingEntry = null;
        state.editingLibraryItem = item;
        _A.navigate('food-log-entry');
      });
    });
  }

  // ── Entry form ───────────────────────────────────────────────────────────────

  function renderFoodLogEntry() {
    var entry = state.editingEntry;
    var isEdit = !!entry;
    var libraryOnlyMode = state.libraryOnlyMode || false;
    state.libraryOnlyMode = false;
    var libItem = state.editingLibraryItem || null;
    var isLibraryEdit = !!libItem && !isEdit;
    if (isLibraryEdit) state.editingLibraryItem = null;
    var $body = _A.$('food-log-entry-body');

    // Title and delete button
    var isLibraryForm = isLibraryEdit || libraryOnlyMode;
    _A.$('fle-title').textContent = isEdit ? 'Edit Meal' : (isLibraryEdit ? 'Edit Food Item' : (libraryOnlyMode ? 'New Food Item' : 'Log Meal'));
    var delBtn = _A.$('btn-fle-delete');
    delBtn.style.display = (isEdit || isLibraryEdit) ? '' : 'none';

    // Form state
    var src = isLibraryEdit ? libItem : (isEdit ? entry : null);
    var formState = {
      name:        src ? src.name : '',
      brand:       src ? (isLibraryEdit ? (src.brand || '')       : '')                     : '',
      category:    isLibraryForm ? (src ? (src.category || '') : '') : (src ? (src.category || 'Breakfast') : 'Breakfast'),
      servingSize: src ? (isLibraryEdit ? (src.servingSize != null ? src.servingSize : '') : '') : '',
      servingUnit: src ? (isLibraryEdit ? (src.servingUnit || '') : '') : '',
      protein:     src ? (isLibraryEdit ? src.proteinPerServing   : src.protein)   : (libraryOnlyMode ? null : 0),
      carbs:       src ? (isLibraryEdit ? src.carbsPerServing     : src.carbs)     : (libraryOnlyMode ? null : 0),
      fat:         src ? (isLibraryEdit ? src.fatPerServing       : src.fat)       : (libraryOnlyMode ? null : 0),
      calories:    src ? (isLibraryEdit ? src.caloriesPerServing  : src.calories)  : (libraryOnlyMode ? null : 0),
      fiber:       src ? (isLibraryEdit ? src.fiberPerServing     : src.fiber)     : null,
      sodium:      src ? (isLibraryEdit ? src.sodiumPerServing    : src.sodium)    : null,
      loggedAt:    isEdit ? entry.loggedAt : (state.date === todayStr() ? new Date().toISOString() : new Date(state.date + 'T12:00:00').toISOString()),
      aiEstimated: isEdit ? entry.aiEstimated : false,
      aiNotes:     isEdit ? entry.aiNotes    : null,
      libraryItemId:     isEdit ? entry.libraryItemId     : null,
      servingMultiplier: isEdit ? entry.servingMultiplier : 1.0,
      logServingSize: isEdit ? (entry.logServingSize ?? null) : null,
      logServingUnit: isEdit ? (entry.logServingUnit || '') : '',
      buildFreeform: ''
    };
    var buildComponents = []; // [{item, amountG}]
    var buildMode = false;    // true = Build tab active
    var postCalculate = null; // {name, protein, carbs, fat, calories, fiber, sodium, components} | null
    var isCalculating = false; // true while parseMeal await is in flight
    var parsed = isEdit || isLibraryEdit || libraryOnlyMode;

    function macroEditRowHTML(label, key, unit) {
      var val = formState[key];
      var display = val != null ? Math.round(val) : '';
      return '<div class="fl-macro-edit-row">' +
        '<span class="fl-macro-edit-label">' + label + '</span>' +
        '<div class="fl-macro-edit-value-wrap">' +
          '<input class="fl-macro-edit-value" type="number" min="0" data-macro="' + key + '" value="' + display + '" placeholder="—">' +
          '<span class="fl-macro-edit-unit">' + unit + '</span>' +
        '</div>' +
      '</div>';
    }

    var UNIT_DATALIST = '<datalist id="fl-unit-suggestions">' +
      '<option value="g">' +
      '<option value="oz">' +
      '<option value="ml">' +
      '<option value="tsp">' +
      '<option value="tbsp">' +
      '<option value="cup">' +
      '<option value="slice">' +
      '<option value="piece">' +
      '<option value="serving">' +
      '</datalist>';

    function estimatedBlockHTML() {
      if (!parsed) return '';

      if (isLibraryForm) {
        return '<div class="fl-estimated">' +
          '<div class="fl-estimated-title">Item Details</div>' +
          // Brand
          '<div class="fl-macro-edit-row">' +
            '<span class="fl-macro-edit-label">Brand</span>' +
            '<div class="fl-macro-edit-value-wrap" style="flex:1;margin-left:16px">' +
              '<input class="fl-macro-edit-value" type="text" data-macro="brand" value="' + _A.escHtml(formState.brand) + '" placeholder="optional" style="width:100%;text-align:left">' +
            '</div>' +
          '</div>' +
          // Name
          '<div class="fl-macro-edit-row">' +
            '<span class="fl-macro-edit-label">Name</span>' +
            '<div class="fl-macro-edit-value-wrap" style="flex:1;margin-left:16px">' +
              '<input class="fl-macro-edit-value" type="text" data-macro="name" value="' + _A.escHtml(formState.name) + '" style="width:100%;text-align:left">' +
            '</div>' +
          '</div>' +
          // Category
          '<div class="fl-macro-edit-row">' +
            '<span class="fl-macro-edit-label">Category</span>' +
            '<div class="fl-macro-edit-value-wrap" style="flex:1;margin-left:16px">' +
              '<input class="fl-macro-edit-value" type="text" data-macro="category" value="' + _A.escHtml(formState.category) + '" placeholder="optional" style="width:100%;text-align:left">' +
            '</div>' +
          '</div>' +
          // Per serving block
          '<div style="margin-top:8px;font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-tertiary);margin-bottom:6px">Per Serving</div>' +
          // Serving size
          '<div class="fl-macro-edit-row">' +
            '<span class="fl-macro-edit-label">Size</span>' +
            '<div class="fl-macro-edit-value-wrap">' +
              '<input class="fl-macro-edit-value" type="number" min="0" data-macro="servingSize" value="' + formState.servingSize + '" placeholder="—">' +
              '<input type="text" class="fl-macro-edit-unit fl-unit-input" data-macro="servingUnit" value="' + _A.escHtml(formState.servingUnit ?? '') + '" placeholder="g" list="fl-unit-suggestions" autocomplete="off">' +
              UNIT_DATALIST +
            '</div>' +
          '</div>' +
          macroEditRowHTML('Calories', 'calories', 'kcal') +
          macroEditRowHTML('Protein',  'protein',  'g') +
          macroEditRowHTML('Carbs',    'carbs',    'g') +
          macroEditRowHTML('Fat',      'fat',      'g') +
          macroEditRowHTML('Fiber',    'fiber',    'g') +
          macroEditRowHTML('Sodium',   'sodium',   'mg') +
        '</div>';
      }

      // Non-library (log entry) form — unchanged layout
      return '<div class="fl-estimated">' +
        '<div class="fl-estimated-title">Estimated Macros</div>' +
        '<div class="fl-macro-edit-row">' +
          '<span class="fl-macro-edit-label">Name</span>' +
          '<div class="fl-macro-edit-value-wrap" style="flex:1;margin-left:16px">' +
            '<input class="fl-macro-edit-value" type="text" data-macro="name" value="' + _A.escHtml(formState.name) + '" style="width:100%;text-align:left">' +
          '</div>' +
        '</div>' +
        macroEditRowHTML('Calories', 'calories', 'kcal') +
        macroEditRowHTML('Protein',  'protein',  'g') +
        macroEditRowHTML('Carbs',    'carbs',    'g') +
        macroEditRowHTML('Fat',      'fat',      'g') +
        macroEditRowHTML('Fiber',    'fiber',    'g') +
        macroEditRowHTML('Sodium',   'sodium',   'mg') +
        (isEdit ? (function() {
          var _linkedLib = entry && entry.libraryItemId
            ? (state.library || []).filter(function(i) { return i.id === entry.libraryItemId; })[0]
            : null;
          var _lockedUnit = _linkedLib ? (_linkedLib.servingUnit || 'g') : null;
          return '<div class="fl-macro-edit-row">' +
            '<span class="fl-macro-edit-label">Serving</span>' +
            '<div class="fl-macro-edit-value-wrap">' +
              '<input class="fl-macro-edit-value" type="number" min="0" data-macro="logServingSize" value="' + (formState.logServingSize != null ? formState.logServingSize : '') + '" placeholder="—">' +
              (_lockedUnit
                ? '<span class="fl-macro-edit-unit">' + _A.escHtml(_lockedUnit) + '</span>'
                : '<input type="text" class="fl-macro-edit-unit fl-unit-input" data-macro="logServingUnit" value="' + _A.escHtml(formState.logServingUnit ?? '') + '" placeholder="g" list="fl-unit-suggestions" autocomplete="off">' +
                  UNIT_DATALIST) +
            '</div>' +
          '</div>';
        })() : '') +
      '</div>';
    }

    function buildModeHTML() {
      var componentRows = buildComponents.map(function (bc, i) {
        var color = COMPONENT_COLORS[i % COMPONENT_COLORS.length];
        var scaled = FoodLogData.scaleComponentMacros(bc.item, bc.amountG);
        var sub = macroMetaFromValues(scaled);
        if (bc.amountG != null && bc.amountG > 0) sub.push('per ' + bc.amountG + (bc.item.servingUnit ? ' ' + _A.escHtml(bc.item.servingUnit) : 'g'));
        return '<div class="fl-component-row">' +
          '<div class="fl-component-color" style="background:' + color + '"></div>' +
          '<div class="fl-component-info">' +
            '<div class="fl-component-name">' + _A.escHtml((bc.item.brand ? bc.item.brand + ' ' : '') + bc.item.name) + '</div>' +
            '<div class="fl-component-sub">' + sub.join(' · ') + '</div>' +
          '</div>' +
          '<div class="fl-component-amount-wrap">' +
            '<input class="fl-component-amount" type="number" min="0" data-build-amount="' + i + '" value="' + bc.amountG + '">' +
            '<span class="fl-component-unit">' + _A.escHtml(bc.item.servingUnit || 'g') + '</span>' +
          '</div>' +
          '<div class="fl-component-remove" data-build-remove="' + i + '">×</div>' +
        '</div>';
      }).join('');

      return '<div style="margin-top:10px">' +
        '<div style="font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-tertiary);padding:0 0 5px">Library items</div>' +
        '<div class="fl-component-list">' + (componentRows || '<div style="font-size:13px;color:var(--text-tertiary);padding:8px 0">No items yet — tap below to add.</div>') + '</div>' +
        '<div class="fl-add-from-lib-btn" id="fl-build-add-btn">+ Add from library</div>' +
        '<div style="margin-top:10px">' +
          '<div style="font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-tertiary);margin-bottom:4px">Other items</div>' +
          '<textarea class="fl-freeform-area" id="fl-build-freeform" placeholder="21g honey, 23g slivered almonds…" style="margin-top:0">' + _A.escHtml(formState.buildFreeform || '') + '</textarea>' +
        '</div>' +
      '</div>';
    }

    function calculatedTotalsHTML() {
      if (!postCalculate) return '';
      var pc = postCalculate;
      return '<div class="fl-estimated-block">' +
        '<div class="fl-estimated-title">Estimated Totals</div>' +
        '<div class="fl-estimated-name-row">' +
          '<span class="fl-estimated-name-label">Name</span>' +
          '<input class="fl-estimated-name-input" type="text" id="fl-build-name" value="' + _A.escHtml(pc.name) + '">' +
        '</div>' +
        '<div class="fl-estimated-macros">' +
          '<div class="fl-estimated-macro"><div class="fl-estimated-macro-val">' + Math.round(pc.calories) + '</div><div class="fl-estimated-macro-label">kcal</div></div>' +
          '<div class="fl-estimated-macro"><div class="fl-estimated-macro-val">' + Math.round(pc.protein) + 'g</div><div class="fl-estimated-macro-label">protein</div></div>' +
          '<div class="fl-estimated-macro"><div class="fl-estimated-macro-val">' + Math.round(pc.carbs) + 'g</div><div class="fl-estimated-macro-label">carbs</div></div>' +
          '<div class="fl-estimated-macro"><div class="fl-estimated-macro-val">' + Math.round(pc.fat) + 'g</div><div class="fl-estimated-macro-label">fat</div></div>' +
          (pc.fiber  != null ? '<div class="fl-estimated-macro"><div class="fl-estimated-macro-val">' + Math.round(pc.fiber)  + 'g</div><div class="fl-estimated-macro-label">fiber</div></div>' : '') +
          (pc.sodium != null ? '<div class="fl-estimated-macro"><div class="fl-estimated-macro-val">' + Math.round(pc.sodium) + 'mg</div><div class="fl-estimated-macro-label">sodium</div></div>' : '') +
        '</div>' +
        (pc.hasMissingMacros ? '<div class="fl-estimated-caveat">* some values may be missing</div>' : '') +
      '</div>';
    }

    function pickerSheetHTML(library, selectedIds) {
      var rows = library.map(function (item) {
        var checked = selectedIds.indexOf(item.id) !== -1;
        return '<div class="fl-picker-row" data-picker-id="' + item.id + '">' +
          '<div class="fl-picker-check' + (checked ? ' checked' : '') + '"></div>' +
          '<div class="fl-picker-info">' +
            '<div class="fl-picker-name">' + _A.escHtml(item.name) + '</div>' +
            (item.brand ? '<div class="fl-picker-brand">' + _A.escHtml(item.brand) + '</div>' : '') +
            '<div class="fl-picker-macros">' + itemMetaLine(item) + '</div>' +
          '</div>' +
        '</div>';
      }).join('');

      var n = selectedIds.length;
      return '<div class="fl-sheet-overlay" id="fl-picker-overlay">' +
        '<div class="fl-sheet">' +
          '<div class="fl-sheet-handle"></div>' +
          '<div class="fl-sheet-header">' +
            '<div class="fl-sheet-title">Add from Library</div>' +
            '<span class="fl-sheet-count" id="fl-picker-count">' + (n ? n + ' selected' : '') + '</span>' +
          '</div>' +
          '<input class="fl-sheet-search" id="fl-picker-search" placeholder="Search…" type="search">' +
          '<div class="fl-sheet-list" id="fl-picker-list">' + (rows || '<div style="padding:24px 16px;text-align:center;color:var(--text-secondary);font-size:14px">No items in your library yet</div>') + '</div>' +
          '<div class="fl-sheet-confirm-btn' + (n === 0 ? '" style="opacity:0.4;pointer-events:none' : '') + '" id="fl-picker-confirm">Add ' + (n > 0 ? n + ' ' : '') + 'item' + (n !== 1 ? 's' : '') + ' →</div>' +
        '</div>' +
      '</div>';
    }

    var categories = ['Breakfast', 'Lunch', 'Dinner', 'Fuel', 'Snack'];

    function categoryChipsHTML() {
      return '<div class="fl-category-chips">' +
        categories.map(function (c) {
          return '<button class="fl-chip' + (formState.category.toLowerCase() === c.toLowerCase() ? ' active' : '') + '" data-category="' + c + '">' + c + '</button>';
        }).join('') +
      '</div>';
    }

    function fmtInputTime(isoStr) {
      var d = new Date(isoStr);
      var hh = String(d.getHours()).padStart(2, '0');
      var mm = String(d.getMinutes()).padStart(2, '0');
      return hh + ':' + mm;
    }

    function removePickerOverlay() {
      var o = document.getElementById('fl-picker-overlay');
      if (o && o.parentNode) o.parentNode.removeChild(o);
    }

    function render() {
      removePickerOverlay();
      var modeToggle = (!isEdit && !isLibraryForm)
        ? '<div class="fl-mode-tabs">' +
            '<div class="fl-mode-tab' + (!buildMode ? ' active' : '') + '" data-mode="describe">Describe</div>' +
            '<div class="fl-mode-tab' + ( buildMode ? ' active' : '') + '" data-mode="build">Build</div>' +
          '</div>'
        : '';

      var formBody;
      if (buildMode) {
        formBody =
          modeToggle +
          '<div style="margin-top:12px">' + buildModeHTML() + '</div>' +
          (postCalculate ? calculatedTotalsHTML() : '') +
          (!isLibraryForm
            ? '<div style="margin-top:12px">' +
                '<div style="font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-tertiary);margin-bottom:6px">Category</div>' +
                categoryChipsHTML() +
              '</div>' +
              '<div style="margin-top:12px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-tertiary);margin-bottom:6px">Time</div>' +
              '<input id="fl-time-input" type="time" value="' + fmtInputTime(formState.loggedAt) + '" style="padding:6px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);color:var(--text);font-size:14px">'
            : '') +
          (!postCalculate
            ? '<button class="fl-parse-btn" id="fl-calc-btn" style="margin-top:12px">Calculate</button>'
            : '<div style="display:flex;gap:8px;margin-top:16px"><button id="fl-save-btn" class="btn-primary" style="flex:1">Save</button></div>');
      } else {
        formBody =
          modeToggle +
          (!isEdit && !isLibraryForm
            ? '<div style="margin-top:12px"><label style="display:block;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-tertiary);margin-bottom:6px">What did you eat?</label>' +
              '<textarea class="fl-freeform-area" id="fl-freeform" placeholder="e.g. chicken rice bowl, 2 eggs and toast, post-workout shake \xd71.5…"></textarea>' +
              '<button class="fl-parse-btn" id="fl-parse-btn">Calculate</button></div>'
            : '') +
          estimatedBlockHTML() +
          (!isLibraryForm
            ? '<div style="margin-top:16px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-tertiary);margin-bottom:6px">Category</div>' +
              categoryChipsHTML() +
              '<div style="margin-top:12px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-tertiary);margin-bottom:6px">Time</div>' +
              '<input id="fl-time-input" type="time" value="' + fmtInputTime(formState.loggedAt) + '" style="padding:6px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);color:var(--text);font-size:14px">'
            : '') +
          (parsed && !isEdit && !isLibraryForm
            ? '<label class="fl-save-library-row"><input type="checkbox" id="fl-save-library"> Save to library</label>' +
              '<div id="fl-save-library-size-row" style="display:none;margin-top:6px;padding-left:2px">' +
                '<label style="font-size:13px;color:var(--text-2);display:flex;align-items:center;gap:8px">Serving size' +
                  '<input class="fl-macro-edit-value" type="number" min="0" id="fl-save-library-size" style="width:80px" placeholder="—">' +
                  '<input type="text" class="fl-unit-input" id="fl-save-library-unit" placeholder="g" list="fl-unit-suggestions" autocomplete="off">' +
                '</label>' +
              '</div>' +
              UNIT_DATALIST
            : '') +
          (parsed || isEdit || isLibraryForm
            ? '<div style="display:flex;gap:8px;margin-top:24px"><button id="fl-save-btn" class="btn-primary" style="flex:1">Save</button></div>'
            : '');
      }

      $body.innerHTML = '<div style="padding:16px;position:relative">' + formBody + '</div>';
      attachHandlers();
    }

    function attachHandlers() {
      // Mode toggle
      _A.$$('.fl-mode-tab', $body).forEach(function (tab) {
        _A.on(tab, 'click', function () {
          if (isCalculating) return;
          var newMode = tab.dataset.mode === 'build';
          if (newMode === buildMode) return;
          buildMode = newMode;
          postCalculate = null;
          render();
        });
      });

      // Amount inputs (Build mode)
      _A.$$('[data-build-amount]', $body).forEach(function (input) {
        _A.on(input, 'change', function () {
          if (isCalculating) return;
          var idx = parseInt(input.dataset.buildAmount, 10);
          buildComponents[idx].amountG = parseFloat(input.value) || 0;
          if (postCalculate !== null) postCalculate = null;
          render();
        });
      });

      // Remove buttons (Build mode)
      _A.$$('[data-build-remove]', $body).forEach(function (btn) {
        _A.on(btn, 'click', function () {
          if (isCalculating) return;
          var idx = parseInt(btn.dataset.buildRemove, 10);
          buildComponents.splice(idx, 1);
          postCalculate = null;
          render();
        });
      });

      // Freeform textarea in Build mode
      var buildFreeformEl = _A.$('fl-build-freeform');
      if (buildFreeformEl) {
        _A.on(buildFreeformEl, 'input', function () {
          formState.buildFreeform = buildFreeformEl.value;
        });
        _A.on(buildFreeformEl, 'change', function () {
          if (postCalculate !== null) {
            postCalculate = null;
            render();
          }
        });
      }

      // Add from library button (Build mode)
      var addBtn = _A.$('fl-build-add-btn');
      if (addBtn) {
        _A.on(addBtn, 'click', function () {
          if (isCalculating) return;
          var selectedIds = buildComponents.map(function (bc) { return bc.item.id; });
          var sheetEl = document.createElement('div');
          sheetEl.innerHTML = pickerSheetHTML(state.library, selectedIds);
          var overlay = sheetEl.firstChild;
          document.body.appendChild(overlay);

          var currentSelected = selectedIds.slice();
          var libraryMap = {};
          state.library.forEach(function (i) { libraryMap[i.id] = i; });

          function updateConfirm() {
            var n = currentSelected.length;
            var confirmBtn = _A.$('fl-picker-confirm');
            if (!confirmBtn) return;
            confirmBtn.textContent = 'Add ' + (n > 0 ? n + ' ' : '') + 'item' + (n !== 1 ? 's' : '') + ' →';
            confirmBtn.style.opacity = n === 0 ? '0.4' : '';
            confirmBtn.style.pointerEvents = n === 0 ? 'none' : '';
            var countEl = _A.$('fl-picker-count');
            if (countEl) countEl.textContent = n ? n + ' selected' : '';
          }

          // Toggle selection
          _A.$$('.fl-picker-row', overlay).forEach(function (row) {
            _A.on(row, 'click', function () {
              var id = row.dataset.pickerId;
              var idx = currentSelected.indexOf(id);
              if (idx === -1) {
                currentSelected.push(id);
                row.querySelector('.fl-picker-check').classList.add('checked');
              } else {
                currentSelected.splice(idx, 1);
                row.querySelector('.fl-picker-check').classList.remove('checked');
              }
              updateConfirm();
            });
          });

          // Search filter
          var searchEl = _A.$('fl-picker-search');
          if (searchEl) {
            _A.on(searchEl, 'input', function () {
              var q = searchEl.value.toLowerCase();
              _A.$$('.fl-picker-row', overlay).forEach(function (row) {
                var item = libraryMap[row.dataset.pickerId];
                if (!item) return;
                var text = ((item.brand || '') + ' ' + item.name).toLowerCase();
                row.style.display = text.indexOf(q) !== -1 ? '' : 'none';
              });
            });
          }

          // Confirm
          var confirmBtn = _A.$('fl-picker-confirm');
          if (confirmBtn) {
            _A.on(confirmBtn, 'click', function () {
              var existingIds = buildComponents.map(function (bc) { return bc.item.id; });
              currentSelected.forEach(function (id) {
                if (existingIds.indexOf(id) !== -1) return;
                var item = libraryMap[id];
                if (!item) return;
                buildComponents.push({ item: item, amountG: item.servingSize || 100 });
              });
              // Remove deselected items
              buildComponents = buildComponents.filter(function (bc) {
                return currentSelected.indexOf(bc.item.id) !== -1;
              });
              postCalculate = null;
              overlay.parentNode.removeChild(overlay);
              render();
            });
          }

          // Close on overlay backdrop tap
          _A.on(overlay, 'click', function (e) {
            if (e.target === overlay) overlay.parentNode.removeChild(overlay);
          });
        });
      }

      // Calculate button (Build mode)
      var calcBtn = _A.$('fl-calc-btn');
      if (calcBtn) {
        _A.on(calcBtn, 'click', async function () {
          if (isCalculating) return;
          if (!buildComponents.length && !(formState.buildFreeform || '').trim()) return;
          calcBtn.disabled = true;
          calcBtn.textContent = 'Calculating…';

          // Parse freeform first (async) — library component records are built
          // AFTER the await so they reflect buildComponents at resolution time,
          // not at click time. This prevents a removed component from being
          // included if the user taps × during the parseMeal round-trip.
          var freeText = (formState.buildFreeform || '').trim();
          var freeformTextarea = _A.$('fl-build-freeform');
          if (freeformTextarea) freeformTextarea.disabled = true;
          var amountInputs = _A.$$('[data-build-amount]', $body);
          var removeBtns   = _A.$$('[data-build-remove]', $body);
          var modeTabs     = _A.$$('.fl-mode-tab', $body);
          amountInputs.forEach(function (el) { el.disabled = true; });
          removeBtns.forEach(function (el) { el.style.pointerEvents = 'none'; el.style.opacity = '0.4'; });
          modeTabs.forEach(function (el) { el.style.pointerEvents = 'none'; el.style.opacity = '0.5'; });
          try {
            isCalculating = true;
            var parsedResult = null;
            if (freeText) {
              parsedResult = await FoodLogData.parseMeal(freeText, state.library);
            }

            // Sum library components from current buildComponents (post-await)
            var totals = { protein: 0, carbs: 0, fat: 0, calories: 0, fiber: null, sodium: null };
            var hasMissingMacros = false;
            var componentRecords = buildComponents.map(function (bc) {
              var scaled = FoodLogData.scaleComponentMacros(bc.item, bc.amountG);
              if (scaled.protein  == null) hasMissingMacros = true;
              if (scaled.carbs    == null) hasMissingMacros = true;
              if (scaled.fat      == null) hasMissingMacros = true;
              if (scaled.calories == null) hasMissingMacros = true;
              totals.protein  += scaled.protein  || 0;
              totals.carbs    += scaled.carbs    || 0;
              totals.fat      += scaled.fat      || 0;
              totals.calories += scaled.calories || 0;
              if (scaled.fiber  != null) { if (totals.fiber  == null) totals.fiber  = 0; totals.fiber  += scaled.fiber; }
              if (scaled.sodium != null) { if (totals.sodium == null) totals.sodium = 0; totals.sodium += scaled.sodium; }
              return {
                library_item_id: bc.item.id,
                name:        (bc.item.brand ? bc.item.brand + ' ' : '') + bc.item.name,
                amount_g:    bc.amountG,
                serving_unit: bc.item.servingUnit || null,
                protein:  scaled.protein,  carbs:    scaled.carbs,
                fat:      scaled.fat,      calories: scaled.calories,
                fiber:    scaled.fiber,    sodium:   scaled.sodium
              };
            });

            // Merge parsed freeform result
            var freeComponents = [];
            if (parsedResult) {
              if (parsedResult.protein  == null) hasMissingMacros = true;
              if (parsedResult.carbs    == null) hasMissingMacros = true;
              if (parsedResult.fat      == null) hasMissingMacros = true;
              if (parsedResult.calories == null) hasMissingMacros = true;
              totals.protein  += parsedResult.protein  || 0;
              totals.carbs    += parsedResult.carbs     || 0;
              totals.fat      += parsedResult.fat       || 0;
              totals.calories += parsedResult.calories  || 0;
              if (parsedResult.fiber  != null) { if (totals.fiber  == null) totals.fiber  = 0; totals.fiber  += parsedResult.fiber; }
              if (parsedResult.sodium != null) { if (totals.sodium == null) totals.sodium = 0; totals.sodium += parsedResult.sodium; }
              freeComponents.push({
                library_item_id: null, name: freeText, amount_g: null,
                protein: parsedResult.protein, carbs: parsedResult.carbs,
                fat: parsedResult.fat, calories: parsedResult.calories,
                fiber: parsedResult.fiber, sodium: parsedResult.sodium
              });
            }

            // Suggest name from library items or freeform
            var suggestedName;
            if (buildComponents.length === 1) {
              suggestedName = (buildComponents[0].item.brand
                ? buildComponents[0].item.brand + ' ' + buildComponents[0].item.name
                : buildComponents[0].item.name);
            } else if (buildComponents.length > 1) {
              suggestedName = buildComponents.map(function (bc) { return bc.item.name; }).slice(0, 3).join(' & ');
            } else {
              suggestedName = freeText.split(',')[0].replace(/^[\d.]+\s*[a-z]*\s*/i, '').trim() || 'Meal';
            }

            postCalculate = {
              name:     suggestedName,
              protein:  Math.round(totals.protein  * 10) / 10,
              carbs:    Math.round(totals.carbs    * 10) / 10,
              fat:      Math.round(totals.fat      * 10) / 10,
              calories: Math.round(totals.calories * 10) / 10,
              fiber:    totals.fiber  != null ? Math.round(totals.fiber  * 10) / 10 : null,
              sodium:   totals.sodium != null ? Math.round(totals.sodium * 10) / 10 : null,
              hasMissingMacros: hasMissingMacros,
              components: componentRecords.concat(freeComponents)
            };

            render();
          } catch (e) {
            postCalculate = null;
            calcBtn.disabled = false;
            calcBtn.textContent = 'Calculate';
            if (freeformTextarea) freeformTextarea.disabled = false;
            amountInputs.forEach(function (el) { el.disabled = false; });
            removeBtns.forEach(function (el) { el.style.pointerEvents = ''; el.style.opacity = ''; });
            modeTabs.forEach(function (el) { el.style.pointerEvents = ''; el.style.opacity = ''; });
          } finally {
            isCalculating = false;
          }
        });
      }

      // Category chips
      _A.$$('.fl-chip', $body).forEach(function (chip) {
        _A.on(chip, 'click', function () {
          formState.category = chip.dataset.category;
          _A.$$('.fl-chip', $body).forEach(function (c) { c.classList.remove('active'); });
          chip.classList.add('active');
        });
      });

      // Time input
      var timeInput = _A.$('fl-time-input');
      if (timeInput) {
        _A.on(timeInput, 'change', function () {
          var parts = timeInput.value.split(':');
          var d = new Date(formState.loggedAt);
          d.setHours(parseInt(parts[0], 10), parseInt(parts[1], 10), 0, 0);
          formState.loggedAt = d.toISOString();
        });
      }

      // "Save to library" checkbox — show/hide serving size row
      var saveLibCb = _A.$('fl-save-library');
      if (saveLibCb) {
        _A.on(saveLibCb, 'change', function () {
          var sizeRow = _A.$('fl-save-library-size-row');
          if (sizeRow) sizeRow.style.display = saveLibCb.checked ? 'block' : 'none';
        });
      }

      // Macro edit inputs
      _A.$$('[data-macro]', $body).forEach(function (input) {
        _A.on(input, 'input', function () {
          var key = input.dataset.macro;
          var strKeys = ['name', 'brand', 'category', 'servingUnit', 'logServingUnit'];
          // food_logs.protein/carbs/fat/calories are NOT NULL — coerce cleared
          // fields to 0 for log-entry forms; library items allow null (unknown).
          var logNonNullKeys = ['protein', 'carbs', 'fat', 'calories'];
          var nullOnClear = isLibraryForm || logNonNullKeys.indexOf(key) === -1;
          formState[key] = strKeys.indexOf(key) !== -1
            ? input.value
            : (input.value === '' ? (nullOnClear ? null : 0) : parseFloat(input.value));
        });
      });

      // Parse button
      var parseBtn = _A.$('fl-parse-btn');
      if (parseBtn) {
        _A.on(parseBtn, 'click', async function () {
          var freeform = (_A.$('fl-freeform').value || '').trim();
          if (!freeform) return;
          parseBtn.disabled = true;
          parseBtn.textContent = 'Calculating…';
          try {
            var result = await FoodLogData.parseMeal(freeform, state.library);
            formState.name             = result.name;
            formState.protein          = result.protein;
            formState.carbs            = result.carbs;
            formState.fat              = result.fat;
            formState.calories         = result.calories;
            formState.fiber            = result.fiber;
            formState.sodium           = result.sodium;
            formState.aiEstimated      = result.ai_estimated;
            formState.aiNotes          = result.ai_notes;
            formState.libraryItemId    = result.library_item_id;
            formState.servingMultiplier = result.serving_multiplier || 1.0;
            parsed = true;
            render();
            if (_A.$('fl-freeform')) _A.$('fl-freeform').value = freeform;
          } catch (e) {
            parseBtn.disabled = false;
            parseBtn.textContent = 'Calculate';
          }
        });
      }

      // Save
      var saveBtn = _A.$('fl-save-btn');
      if (saveBtn) {
        _A.on(saveBtn, 'click', async function () {
          // Build mode save path
          if (buildMode && postCalculate) {
            var nameInput = _A.$('fl-build-name');
            var finalName = nameInput ? nameInput.value.trim() : '';
            if (!finalName) { alert('Please enter a name.'); return; }
            saveBtn.disabled = true;
            saveBtn.textContent = 'Saving…';
            try {
              var userId = localStorage.getItem('fuelPlanner.userId');
              await FoodLogData.saveLog(userId, {
                name:              finalName,
                category:          (formState.category || 'breakfast').trim().toLowerCase(),
                loggedAt:          formState.loggedAt,
                freeformInput:     formState.buildFreeform || null,
                protein:           postCalculate.protein,
                carbs:             postCalculate.carbs,
                fat:               postCalculate.fat,
                calories:          postCalculate.calories,
                fiber:             postCalculate.fiber,
                sodium:            postCalculate.sodium,
                libraryItemId:     null,
                servingMultiplier: 1.0,
                aiEstimated:       false,
                aiNotes:           null,
                components:        postCalculate.components
              });
              state.editingEntry = null;
              _A.navigate('food-log');
            } catch (e) {
              saveBtn.disabled = false;
              saveBtn.textContent = 'Save';
              alert('Could not save — check your connection.');
            }
            return;
          }

          if (!formState.name) { alert('Please enter a name.'); return; }
          var saveLibCb = _A.$('fl-save-library');
          var libSizeInput = _A.$('fl-save-library-size');
          var libUnitInput = _A.$('fl-save-library-unit');
          var libSizeVal = '';
          var servingUnit = null;
          if (saveLibCb && saveLibCb.checked) {
            libSizeVal = libSizeInput ? libSizeInput.value.trim() : '';
            if (!libSizeVal || parseFloat(libSizeVal) <= 0) {
              alert('Serving size is required when saving to library.');
              return;
            }
            servingUnit = libUnitInput ? (libUnitInput.value.trim() || null) : null;
          }
          saveBtn.disabled = true;
          saveBtn.textContent = 'Saving…';
          if (saveLibCb) saveLibCb.disabled = true;
          if (libSizeInput) libSizeInput.disabled = true;
          if (libUnitInput) libUnitInput.disabled = true;
          var userId = localStorage.getItem('fuelPlanner.userId');
          if (isLibraryForm) {
              // Clamp negatives
              ['protein','carbs','fat','calories','fiber','sodium'].forEach(function (k) {
                if (formState[k] != null && formState[k] < 0) formState[k] = 0;
              });
              // Require at least a name and one macro value
              var hasAnyMacro = ['protein','carbs','fat','calories'].some(function (k) { return formState[k] != null && formState[k] > 0; });
              if (!formState.name.trim()) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; alert('Please enter a name.'); return; }
              if (!hasAnyMacro) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; alert('Please enter at least one macro value.'); return; }
              var hasServingSize = formState.servingSize !== '' && formState.servingSize != null && parseFloat(formState.servingSize) > 0;
              if (!hasServingSize) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; alert('Serving size is required when macros are set.'); return; }
            }
          try {
            var normCategory = formState.category ? formState.category.trim().toLowerCase() : null;
            if (isLibraryEdit) {
              await FoodLogData.updateLibraryItem(userId, libItem.id, {
                name: formState.name, category: normCategory,
                brand: formState.brand || null,
                servingSize: (formState.servingSize !== '' && formState.servingSize != null) ? parseFloat(formState.servingSize) : null,
                servingUnit: formState.servingUnit || null,
                proteinPerServing: formState.protein, carbsPerServing: formState.carbs,
                fatPerServing: formState.fat, caloriesPerServing: formState.calories,
                fiberPerServing: formState.fiber, sodiumPerServing: formState.sodium
              });
              state.editingEntry = null;
              _A.navigate('library');
              return;
            } else if (isEdit) {
              var editPayload = {
                name: formState.name, category: normCategory,
                loggedAt: formState.loggedAt,
                protein: formState.protein, carbs: formState.carbs,
                fat: formState.fat, calories: formState.calories,
                fiber: formState.fiber, sodium: formState.sodium,
                aiEstimated: formState.aiEstimated, aiNotes: formState.aiNotes
              };
              var _szRaw = formState.logServingSize;
              var _sz = (_szRaw === '' || _szRaw === null) ? null : Number(_szRaw);
              if (_sz !== null && isNaN(_sz)) _sz = null;
              var _linkedLibForSave = entry.libraryItemId
                ? (state.library || []).filter(function(i) { return i.id === entry.libraryItemId; })[0]
                : null;
              var _unit = _linkedLibForSave
                ? (entry.logServingUnit !== null && entry.logServingUnit !== undefined ? entry.logServingUnit : null)
                : (typeof formState.logServingUnit === 'string' ? formState.logServingUnit : '').trim() || null;
              editPayload.logServingSize = _sz;
              editPayload.logServingUnit = _unit;
              await FoodLogData.updateLog(userId, entry.id, editPayload);
            } else if (libraryOnlyMode) {
              await FoodLogData.saveLibraryItem(userId, {
                name: formState.name, category: normCategory,
                brand: formState.brand || null,
                servingSize: (formState.servingSize !== '' && formState.servingSize != null) ? parseFloat(formState.servingSize) : null,
                servingUnit: formState.servingUnit || null,
                proteinPerServing: formState.protein, carbsPerServing: formState.carbs,
                fatPerServing: formState.fat, caloriesPerServing: formState.calories,
                fiberPerServing: formState.fiber, sodiumPerServing: formState.sodium
              });
              state.editingEntry = null;
              _A.navigate('library');
              return;
            } else {
              await FoodLogData.saveLog(userId, {
                name: formState.name, category: normCategory,
                loggedAt: formState.loggedAt, freeformInput: (_A.$('fl-freeform') && _A.$('fl-freeform').value) || null,
                protein: formState.protein, carbs: formState.carbs,
                fat: formState.fat, calories: formState.calories,
                fiber: formState.fiber, sodium: formState.sodium,
                libraryItemId: formState.libraryItemId,
                servingMultiplier: formState.servingMultiplier,
                aiEstimated: formState.aiEstimated, aiNotes: formState.aiNotes
              });
              if (saveLibCb && saveLibCb.checked) {
                await FoodLogData.saveLibraryItem(userId, {
                  name: formState.name, category: normCategory,
                  proteinPerServing: formState.protein, carbsPerServing: formState.carbs,
                  fatPerServing: formState.fat, caloriesPerServing: formState.calories,
                  fiberPerServing: formState.fiber, sodiumPerServing: formState.sodium,
                  servingSize: parseFloat(libSizeVal),
                  servingUnit: servingUnit
                });
              }
            }
            state.editingEntry = null;
            _A.navigate('food-log');
          } catch (e) {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save';
            if (saveLibCb) saveLibCb.disabled = false;
            if (libSizeInput) libSizeInput.disabled = false;
            if (libUnitInput) libUnitInput.disabled = false;
            alert('Could not save — check your connection.');
          }
        });
      }
    }

    // Back and delete handlers (onclick replaces handler on each render)
    _A.$('btn-fle-back').onclick = function () {
      removePickerOverlay();
      state.editingEntry = null;
      _A.navigate(isLibraryEdit || libraryOnlyMode ? 'library' : 'food-log');
    };

    _A.$('btn-fle-delete').onclick = async function () {
      var userId = localStorage.getItem('fuelPlanner.userId');
      if (isLibraryEdit) {
        if (!confirm('Delete this food item from your library?')) return;
        try {
          await FoodLogData.deleteLibraryItem(userId, libItem.id);
          state.editingEntry = null;
          _A.navigate('library');
        } catch (e) {
          alert('Could not delete — check your connection.');
        }
      } else {
        if (!confirm('Delete this entry?')) return;
        try {
          await FoodLogData.deleteLog(userId, entry.id);
          state.editingEntry = null;
          _A.navigate('food-log');
        } catch (e) {
          alert('Could not delete — check your connection.');
        }
      }
    };

    render();
  }

  // ── Targets settings ─────────────────────────────────────────────────────────

  async function renderFoodLogTargets() {
    var $body = _A.$('food-log-targets-body');
    $body.innerHTML = '<div style="padding:32px;text-align:center;color:var(--text-tertiary)">Loading…</div>';

    var userId = localStorage.getItem('fuelPlanner.userId');
    var targets;
    try {
      targets = await FoodLogData.getTargets(userId) || {};
    } catch (e) {
      $body.innerHTML = '<div style="padding:24px;color:var(--text-secondary)">Couldn\'t load targets.</div>';
      return;
    }

    function inputRow(label, key, placeholder) {
      var val = targets[key] != null ? targets[key] : '';
      return '<div class="fl-target-row">' +
        '<span class="fl-targets-label">' + label + '</span>' +
        '<input class="fl-targets-input" type="number" min="0" data-key="' + key + '" value="' + val + '" placeholder="' + placeholder + '">' +
      '</div>';
    }

    $body.innerHTML =
      '<p style="padding:16px 16px 8px;font-size:14px;color:var(--text-secondary)">Leave a field blank to hide its progress bar.</p>' +
      '<div style="border:1px solid var(--border);border-radius:var(--radius-md);margin:0 16px">' +
        inputRow('Calories', 'caloriesTarget', 'kcal/day') +
        inputRow('Protein',  'proteinTarget',  'g/day') +
        inputRow('Carbs',    'carbsTarget',    'g/day') +
        inputRow('Fat',      'fatTarget',      'g/day') +
        inputRow('Fiber',    'fiberTarget',    'g/day') +
        inputRow('Sodium',   'sodiumTarget',   'mg/day') +
      '</div>' +
      '<div style="padding:16px">' +
        '<button id="fl-targets-save" class="btn-primary" style="width:100%">Save</button>' +
      '</div>';

    _A.on(_A.$('fl-targets-save'), 'click', async function () {
      var btn = _A.$('fl-targets-save');
      btn.disabled = true;
      btn.textContent = 'Saving…';

      var updated = {};
      _A.$$('[data-key]', $body).forEach(function (input) {
        var val = input.value.trim();
        updated[input.dataset.key] = val !== '' ? Math.max(0, parseFloat(val) || 0) : null;
      });

      try {
        await FoodLogData.saveTargets(userId, updated);
        state.targets = updated;
        _A.navigate('food-log');
      } catch (e) {
        btn.disabled = false;
        btn.textContent = 'Save';
        alert('Could not save targets — check your connection.');
      }
    });

    _A.on(_A.$('btn-flt-back'), 'click', function () {
      _A.navigate('food-log');
    });
  }

  // ── Register ─────────────────────────────────────────────────────────────────

  _A.renders['food-log'] = renderFoodLog;
  _A.renders['food-log-entry']   = renderFoodLogEntry;
  _A.renders['food-log-targets'] = renderFoodLogTargets;

  window.FoodLog = {
    renderFoodLog: renderFoodLog,
    renderFoodLibraryPane: renderFoodLibraryPane,
    newFoodItem: function () {
      state.editingEntry = null;
      state.libraryOnlyMode = true;
      _A.navigate('food-log-entry');
    }
  };
})();
