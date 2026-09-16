// food-log.js
(function () {
  'use strict';

  var _A = window._App; // navigate, renders, $, $$, on, escHtml

  // Module state
  var state = {
    date: todayStr(),
    logs: [],
    targets: null,
    library: [],
    editingEntry: null,
    libraryOnlyMode: false,
    prefillFromLibrary: null,
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
        var macroParts = [Math.round(log.calories) + ' kcal'];
        if (log.protein) macroParts.push(Math.round(log.protein) + 'g protein');
        if (log.carbs)   macroParts.push(Math.round(log.carbs)   + 'g carbohydrates');
        if (log.fat)     macroParts.push(Math.round(log.fat)     + 'g fat');
        var macroHTML = macroParts.map(function (p) {
          return '<span style="white-space:nowrap">' + _A.escHtml(p) + '</span>';
        }).join(' · ');
        return '<div class="fl-timeline-entry">' +
          '<div class="fl-time-col"><span class="fl-time-text">' + fmtTime(log.loggedAt) + '</span></div>' +
          '<div class="fl-entry-body" data-entry-id="' + log.id + '">' +
            '<div class="fl-entry-name">' + _A.escHtml(log.name) + '</div>' +
            '<div class="fl-entry-meta">' +
              '<span class="fl-category-badge">' + _A.escHtml(log.category || 'Other') + '</span>' +
              macroHTML +
            '</div>' +
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
  }

  // ── Food library pane ────────────────────────────────────────────────────────

  function _titleCase(str) {
    return str.split(' ').map(function (w) {
      return w.charAt(0).toUpperCase() + w.slice(1);
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
          var meta = [];
          if (item.caloriesPerServing) meta.push(item.caloriesPerServing + ' kcal');
          if (item.proteinPerServing)  meta.push(item.proteinPerServing  + 'g protein');
          if (item.carbsPerServing)    meta.push(item.carbsPerServing    + 'g carbs');
          var suffix = item.servingSize
            ? ' per ' + item.servingSize + 'g'
            : (item.servingUnit ? ' per ' + _A.escHtml(item.servingUnit) : '');
          return '<div class="product-row" data-lib-id="' + item.id + '">' +
            '<div class="product-row-info">' +
              '<div class="product-row-name">' + _A.escHtml(fullName) + '</div>' +
              '<div class="product-row-meta">' + meta.join(' · ') + suffix + '</div>' +
            '</div>' +
            '<span style="color:var(--text-tertiary);font-size:20px">&#8250;</span>' +
          '</div>';
        }).join('') +
      '</div>';
    }).join('');

    _A.$$('.product-row', paneEl).forEach(function (row) {
      _A.on(row, 'click', function () {
        var id = row.dataset.libId;
        var item = items.filter(function (i) { return i.id === id; })[0];
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
    var prefill = (!isEdit && !isLibraryEdit && state.prefillFromLibrary) ? state.prefillFromLibrary : null;
    if (prefill) state.prefillFromLibrary = null;
    var $body = _A.$('food-log-entry-body');

    // Title and delete button
    var isLibraryForm = isLibraryEdit || libraryOnlyMode;
    _A.$('fle-title').textContent = isEdit ? 'Edit Meal' : (isLibraryEdit ? 'Edit Food Item' : (libraryOnlyMode ? 'New Food Item' : 'Log Meal'));
    var delBtn = _A.$('btn-fle-delete');
    delBtn.style.display = (isEdit || isLibraryEdit) ? '' : 'none';

    // Form state
    var src = isLibraryEdit ? libItem : (isEdit ? entry : prefill);
    var formState = {
      name:        src ? (isLibraryEdit ? src.name               : src.name)               : '',
      brand:       src ? (isLibraryEdit ? (src.brand || '')       : '')                     : '',
      category:    isLibraryForm ? (src ? (src.category || '') : '') : (src ? (src.category || 'Breakfast') : 'Breakfast'),
      servingSize: src ? (isLibraryEdit ? (src.servingSize != null ? src.servingSize : '') : '') : '',
      protein:     src ? (isLibraryEdit ? src.proteinPerServing   : src.protein)   : (libraryOnlyMode ? null : 0),
      carbs:       src ? (isLibraryEdit ? src.carbsPerServing     : src.carbs)     : (libraryOnlyMode ? null : 0),
      fat:         src ? (isLibraryEdit ? src.fatPerServing       : src.fat)       : (libraryOnlyMode ? null : 0),
      calories:    src ? (isLibraryEdit ? src.caloriesPerServing  : src.calories)  : (libraryOnlyMode ? null : 0),
      fiber:       src ? (isLibraryEdit ? src.fiberPerServing     : src.fiber)     : null,
      sodium:      src ? (isLibraryEdit ? src.sodiumPerServing    : src.sodium)    : null,
      loggedAt:    isEdit ? entry.loggedAt : (state.date === todayStr() ? new Date().toISOString() : new Date(state.date + 'T12:00:00').toISOString()),
      aiEstimated: isEdit ? entry.aiEstimated : false,
      aiNotes:     isEdit ? entry.aiNotes    : null,
      libraryItemId:     isEdit ? entry.libraryItemId     : (prefill ? prefill.libraryItemId     : null),
      servingMultiplier: isEdit ? entry.servingMultiplier : (prefill ? prefill.servingMultiplier : 1.0)
    };
    var parsed = isEdit || isLibraryEdit || libraryOnlyMode || !!prefill;

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

    function estimatedBlockHTML() {
      if (!parsed) return '';

      function macroRow(label, key, unit) {
        var val = formState[key];
        var display = val != null ? val : '';
        return '<div class="fl-macro-edit-row">' +
          '<span class="fl-macro-edit-label">' + label + '</span>' +
          '<div class="fl-macro-edit-value-wrap">' +
            '<input class="fl-macro-edit-value" type="number" min="0" data-macro="' + key + '" value="' + display + '" placeholder="—">' +
            '<span class="fl-macro-edit-unit">' + unit + '</span>' +
          '</div>' +
        '</div>';
      }

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
              '<input class="fl-macro-edit-value" type="number" min="0" data-macro="servingSize" value="' + (formState.servingSize !== '' ? formState.servingSize : '') + '" placeholder="—">' +
              '<span class="fl-macro-edit-unit">g</span>' +
            '</div>' +
          '</div>' +
          macroRow('Calories', 'calories', 'kcal') +
          macroRow('Protein',  'protein',  'g') +
          macroRow('Carbs',    'carbs',    'g') +
          macroRow('Fat',      'fat',      'g') +
          macroRow('Fiber',    'fiber',    'g') +
          macroRow('Sodium',   'sodium',   'mg') +
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
      '</div>';
    }

    var categories = ['Breakfast', 'Lunch', 'Dinner', 'Fuel', 'Snack'];

    function categoryChipsHTML() {
      return '<div class="fl-category-chips">' +
        categories.map(function (c) {
          return '<button class="fl-chip' + (formState.category === c ? ' active' : '') + '" data-category="' + c + '">' + c + '</button>';
        }).join('') +
      '</div>';
    }

    function fmtInputTime(isoStr) {
      var d = new Date(isoStr);
      var hh = String(d.getHours()).padStart(2, '0');
      var mm = String(d.getMinutes()).padStart(2, '0');
      return hh + ':' + mm;
    }

    function render() {
      $body.innerHTML =
        '<div style="padding:16px">' +
          (!isEdit && !isLibraryForm ? '<label style="display:block;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-tertiary);margin-bottom:6px">What did you eat?</label>' : '') +
          (!isEdit && !isLibraryForm ? '<textarea class="fl-freeform-area" id="fl-freeform" placeholder="e.g. chicken rice bowl, 2 eggs and toast, post-workout shake \xd71.5…"></textarea>' : '') +
          (!isEdit && !isLibraryForm ? '<button class="fl-parse-btn" id="fl-parse-btn">Calculate</button>' : '') +
          estimatedBlockHTML() +
          (!isLibraryForm ? '<div style="margin-top:16px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-tertiary);margin-bottom:6px">Category</div>' : '') +
          (!isLibraryForm ? categoryChipsHTML() : '') +
          (!isLibraryForm ? '<div style="margin-top:12px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-tertiary);margin-bottom:6px">Time</div>' : '') +
          (!isLibraryForm ? '<input id="fl-time-input" type="time" value="' + fmtInputTime(formState.loggedAt) + '" style="padding:6px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);color:var(--text);font-size:14px">' : '') +
          (parsed && !isEdit && !isLibraryForm ? '<label class="fl-save-library-row"><input type="checkbox" id="fl-save-library"> Save to library</label>' : '') +
          (parsed || isEdit || isLibraryForm ? '<div style="display:flex;gap:8px;margin-top:24px"><button id="fl-save-btn" class="btn-primary" style="flex:1">Save</button></div>' : '') +
        '</div>';

      attachHandlers();
    }

    function attachHandlers() {
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

      // Macro edit inputs
      _A.$$('[data-macro]', $body).forEach(function (input) {
        _A.on(input, 'input', function () {
          var key = input.dataset.macro;
          var strKeys = ['name', 'brand', 'category'];
          formState[key] = strKeys.indexOf(key) !== -1
            ? input.value
            : (input.value === '' ? null : parseFloat(input.value));
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
          if (!formState.name) { alert('Please enter a name.'); return; }
          saveBtn.disabled = true;
          saveBtn.textContent = 'Saving…';
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
            }
          try {
            if (isLibraryEdit) {
              var normCategory = formState.category ? formState.category.trim().toLowerCase() : null;
              await FoodLogData.updateLibraryItem(userId, libItem.id, {
                name: formState.name, category: normCategory,
                brand: formState.brand || null,
                servingSize: (formState.servingSize !== '' && formState.servingSize != null) ? parseFloat(formState.servingSize) : null,
                proteinPerServing: formState.protein, carbsPerServing: formState.carbs,
                fatPerServing: formState.fat, caloriesPerServing: formState.calories,
                fiberPerServing: formState.fiber, sodiumPerServing: formState.sodium
              });
              state.editingEntry = null;
              _A.navigate('library');
              return;
            } else if (isEdit) {
              await FoodLogData.updateLog(userId, entry.id, {
                name: formState.name, category: formState.category,
                loggedAt: formState.loggedAt,
                protein: formState.protein, carbs: formState.carbs,
                fat: formState.fat, calories: formState.calories,
                fiber: formState.fiber, sodium: formState.sodium,
                aiEstimated: formState.aiEstimated, aiNotes: formState.aiNotes
              });
            } else if (libraryOnlyMode) {
              var normCategory = formState.category ? formState.category.trim().toLowerCase() : null;
              await FoodLogData.saveLibraryItem(userId, {
                name: formState.name, category: normCategory,
                brand: formState.brand || null,
                servingSize: (formState.servingSize !== '' && formState.servingSize != null) ? parseFloat(formState.servingSize) : null,
                proteinPerServing: formState.protein, carbsPerServing: formState.carbs,
                fatPerServing: formState.fat, caloriesPerServing: formState.calories,
                fiberPerServing: formState.fiber, sodiumPerServing: formState.sodium
              });
              state.editingEntry = null;
              _A.navigate('library');
              return;
            } else {
              await FoodLogData.saveLog(userId, {
                name: formState.name, category: formState.category,
                loggedAt: formState.loggedAt, freeformInput: (_A.$('fl-freeform') && _A.$('fl-freeform').value) || null,
                protein: formState.protein, carbs: formState.carbs,
                fat: formState.fat, calories: formState.calories,
                fiber: formState.fiber, sodium: formState.sodium,
                libraryItemId: formState.libraryItemId,
                servingMultiplier: formState.servingMultiplier,
                aiEstimated: formState.aiEstimated, aiNotes: formState.aiNotes
              });
              var saveLibCb = _A.$('fl-save-library');
              if (saveLibCb && saveLibCb.checked) {
                await FoodLogData.saveLibraryItem(userId, {
                  name: formState.name, category: formState.category,
                  proteinPerServing: formState.protein, carbsPerServing: formState.carbs,
                  fatPerServing: formState.fat, caloriesPerServing: formState.calories,
                  fiberPerServing: formState.fiber, sodiumPerServing: formState.sodium
                });
              }
            }
            state.editingEntry = null;
            _A.navigate('food-log');
          } catch (e) {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save';
            alert('Could not save — check your connection.');
          }
        });
      }
    }

    // Back and delete handlers (onclick replaces handler on each render)
    _A.$('btn-fle-back').onclick = function () {
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
