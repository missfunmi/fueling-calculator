// food-log.js
(function () {
  'use strict';

  var _A = window._App; // navigate, renders, $, $$, on, escHtml

  // Module state
  var state = {
    date: todayStr(),
    logs: [],
    targets: null,
    library: []
  };

  function todayStr() {
    return new Date().toISOString().slice(0, 10);
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
    if (fib !== null) rows.push(macroRowHTML('Fiber', fib, fibTarget, 'var(--m-fiber)', 'g'));
    if (sod !== null) rows.push(macroRowHTML('Sodium', sod, null, 'var(--m-sodium)', 'mg'));

    return '<div class="fl-progress">' + calBarHTML() + rows.join('') + '</div>';
  }

  // ── Date navigation ──────────────────────────────────────────────────────────

  function dateNavHTML(date) {
    var isToday = date === todayStr();
    return '<div class="fl-date-nav">' +
      '<button class="fl-date-nav-btn" id="fl-btn-prev">&#8249;</button>' +
      '<div class="fl-date-center" id="fl-btn-today">' +
        (isToday ? '<span class="fl-today-label">Today</span>' : '<span class="fl-today-label" style="color:var(--text-tertiary)">Jump to today</span>') +
        '<span class="fl-date-label">' + _A.escHtml(fmtDate(date)) + '</span>' +
        '<span class="fl-date-caret">&#9662;</span>' +
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
      return '<div class="fl-empty-timeline">No entries yet — tap + to log a meal.</div>';
    }
    return '<div class="fl-timeline">' +
      logs.map(function (log) {
        var macroStr = Math.round(log.calories) + ' kcal';
        if (log.protein) macroStr += ' · ' + Math.round(log.protein) + 'g protein';
        return '<div class="fl-timeline-entry">' +
          '<div class="fl-time-col"><span class="fl-time-text">' + fmtTime(log.loggedAt) + '</span></div>' +
          '<div class="fl-entry-body" data-entry-id="' + log.id + '">' +
            '<div class="fl-entry-name">' + _A.escHtml(log.name) + '</div>' +
            '<div class="fl-entry-meta">' +
              '<span class="fl-category-badge">' + _A.escHtml(log.category || 'Other') + '</span>' +
              _A.escHtml(macroStr) +
              (log.aiEstimated ? ' <span style="color:var(--text-tertiary);font-size:11px">~est</span>' : '') +
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
      state.logs    = results[0];
      state.targets = results[1];
      state.library = results[2];
    } catch (e) {
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
    _A.on(_A.$('fl-btn-today'), 'click', function () {
      state.date = todayStr();
      renderFoodLog();
    });

    // Gear icon → targets
    _A.on(_A.$('btn-food-log-targets'), 'click', function () {
      _A.navigate('food-log-targets');
    });

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

  // Placeholder for food library pane — implemented in Task 9
  function renderFoodLibraryPane() {}

  // ── Register ─────────────────────────────────────────────────────────────────

  _A.renders['food-log'] = renderFoodLog;
  _A.renders['food-log-entry']   = function () {}; // stub — Task 7
  _A.renders['food-log-targets'] = function () {}; // stub — Task 8

  window.FoodLog = {
    renderFoodLog: renderFoodLog,
    renderFoodLibraryPane: renderFoodLibraryPane
  };
})();
