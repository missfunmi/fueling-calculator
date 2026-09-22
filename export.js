// export.js
(function () {
  'use strict';

  // ── Caffeine helpers ────────────────────────────────────────────────────────

  function segmentHasCaffeine(seg) {
    if (seg.targets && seg.targets.caffeinePerHour > 0) return true;
    return (seg.items || []).some(function (item) { return item.caffeinePerUnit > 0; });
  }

  function actualSegHasCaffeine(actualSeg) {
    return (actualSeg.items || []).some(function (item) { return item.caffeinePerUnit > 0; });
  }

  // ── Item helpers ────────────────────────────────────────────────────────────

  function itemLabel(item) {
    return item.brand ? item.brand + ' ' + item.name : item.name;
  }

  function itemContributions(item) {
    return {
      carbs:    (item.carbsPerUnit    || 0) * (item.quantity || 0),
      sodium:   (item.sodiumPerUnit   || 0) * (item.quantity || 0),
      caffeine: (item.caffeinePerUnit || 0) * (item.quantity || 0)
    };
  }

  // ── Planned segment block ───────────────────────────────────────────────────

  function plannedSegmentMd(seg, execPlan) {
    var showCaff = segmentHasCaffeine(seg);
    var tgt = seg.targets || {};
    var durationLabel = window._App.formatHM(seg.durationHours);

    // Heading
    var lines = ['### ' + seg.name + ' (' + durationLabel + ')'];

    // Targets line
    var targetsLine = '**Targets:** ' + (tgt.carbsPerHour || 0) + 'g carbs/hr · ' + (tgt.sodiumPerHour || 0) + 'mg Na/hr';
    if (showCaff) targetsLine += ' · ' + (tgt.caffeinePerHour || 0) + 'mg caff/hr';
    lines.push(targetsLine);
    lines.push('');

    // Table header
    var header = '| Item | Qty | Carbs | Sodium |';
    var divider = '|------|-----|-------|--------|';
    if (showCaff) { header += ' Caffeine |'; divider += '-----------|'; }
    lines.push(header);
    lines.push(divider);

    // Item rows
    (seg.items || []).forEach(function (item) {
      var c = itemContributions(item);
      var row = '| ' + itemLabel(item) + ' | ' + item.quantity + ' | ' + Math.round(c.carbs) + 'g | ' + Math.round(c.sodium) + 'mg |';
      if (showCaff) row += ' ' + Math.round(c.caffeine) + 'mg |';
      lines.push(row);
    });
    lines.push('');

    // Execution plan (if provided)
    if (execPlan) {
      lines.push('');
      lines.push('**Execution Plan:**');
      var planLines = generateExecutionPlanText(seg, execPlan).split('\n');
      // Skip the "Segment — Execution Plan" header line and the blank line after it
      planLines.slice(2).forEach(function (l) { lines.push(l); });
    }

    // Totals
    var totals = window.Data.calcSegmentTotals(seg);
    var totalsLine = '**Totals:** ' + Math.round(totals.carbs) + 'g carbs · ' + Math.round(totals.sodium) + 'mg Na';
    if (showCaff) totalsLine += ' · ' + Math.round(totals.caffeine) + 'mg caffeine';
    lines.push(totalsLine);

    // Rates
    var rates = window.Data.calcSegmentRates(seg);
    var ratesLine = '**Rates:** ' + window._App.fmt(rates.carbs, 'g carbs/hr') + ' · ' + window._App.fmt(rates.sodium, 'mg Na/hr');
    if (showCaff) ratesLine += ' · ' + window._App.fmt(rates.caffeine, 'mg caffeine/hr');
    lines.push(ratesLine);

    return lines.join('\n');
  }

  // ── Actual segment block ────────────────────────────────────────────────────

  function actualSegmentMd(seg, actualSeg) {
    var showCaff = actualSegHasCaffeine(actualSeg);
    var durationLabel = actualSeg.durationHours
      ? window._App.formatHM(actualSeg.durationHours)
      : '—';

    var lines = ['### ' + seg.name + ' (actual: ' + durationLabel + ')'];
    lines.push('');

    // Table header
    var header = '| Item | Qty | Carbs | Sodium |';
    var divider = '|------|-----|-------|--------|';
    if (showCaff) { header += ' Caffeine |'; divider += '-----------|'; }
    lines.push(header);
    lines.push(divider);

    // Item rows
    (actualSeg.items || []).forEach(function (item) {
      var c = itemContributions(item);
      var row = '| ' + itemLabel(item) + ' | ' + item.quantity + ' | ' + Math.round(c.carbs) + 'g | ' + Math.round(c.sodium) + 'mg |';
      if (showCaff) row += ' ' + Math.round(c.caffeine) + 'mg |';
      lines.push(row);
    });
    lines.push('');

    // Totals
    var totals = window.Data.calcActualSegmentTotals(actualSeg);
    var totalsLine = '**Totals:** ' + Math.round(totals.carbs) + 'g carbs · ' + Math.round(totals.sodium) + 'mg Na';
    if (showCaff) totalsLine += ' · ' + Math.round(totals.caffeine) + 'mg caffeine';
    lines.push(totalsLine);

    // Rates — only when durationHours is a positive number
    if (actualSeg.durationHours && actualSeg.durationHours > 0) {
      var rates = window.Data.calcActualSegmentRates(actualSeg);
      var ratesLine = '**Rates:** ' + window._App.fmt(rates.carbs, 'g carbs/hr') + ' · ' + window._App.fmt(rates.sodium, 'mg Na/hr');
      if (showCaff) ratesLine += ' · ' + window._App.fmt(rates.caffeine, 'mg caffeine/hr');
      lines.push(ratesLine);
    }

    return lines.join('\n');
  }

  // ── Main function ───────────────────────────────────────────────────────────

  // execPlans is an optional object keyed by segment id containing the saved plan array.
  function generateEventMarkdown(evt, execPlans) {
    var typeLabel = (window._App.EVENT_TYPE_LABELS[evt.type] || evt.type);
    var lines = [
      '# ' + evt.name,
      typeLabel + ' · ' + evt.date,
      '',
      '## Planned'
    ];

    evt.segments.forEach(function (seg) {
      lines.push('');
      var execPlan = execPlans && execPlans[seg.id] ? execPlans[seg.id] : null;
      lines.push(plannedSegmentMd(seg, execPlan));
    });

    // Actuals section — omit entirely if no actuals logged
    var actualKeys = Object.keys(evt.actuals || {});
    if (actualKeys.length > 0) {
      lines.push('');
      lines.push('---');
      lines.push('');
      lines.push('## Actual');

      evt.segments.forEach(function (seg) {
        var actualSeg = evt.actuals[seg.id];
        if (!actualSeg) return;
        lines.push('');
        lines.push(actualSegmentMd(seg, actualSeg));
      });

      // Post-event notes — omit if empty/null
      if (evt.postEventNotes && evt.postEventNotes.trim()) {
        lines.push('');
        lines.push('*' + evt.postEventNotes.trim() + '*');
      }
    }

    return lines.join('\n') + '\n';
  }

  // ── Execution Plan ──────────────────────────────────────────────────────────

  function generateExecutionPlanText(seg, plan) {
    var itemMap = {};
    (seg.items || []).forEach(function (item) { itemMap[item.id] = item; });

    var lines = [(seg.name || 'Segment') + ' — Execution Plan', ''];

    (plan || []).forEach(function (slot) {
      if (!slot.assignments || !slot.assignments.length) return;

      var totalMinutes = slot.slotIndex * slot.intervalMinutes;
      var h = Math.floor(totalMinutes / 60);
      var m = totalMinutes % 60;
      var timeLabel = h + ':' + String(m).padStart(2, '0');

      var slotCarbs = slot.assignments.reduce(function (sum, a) {
        if (a.type === 'drink_group') return sum + (a.carbsPerSlot || 0);
        var item = itemMap[a.itemId];
        return sum + (item ? (item.carbsPerUnit || 0) * a.quantity : 0);
      }, 0);

      var itemLabels = slot.assignments.map(function (a) {
        if (a.type === 'drink_group') {
          var label = a.groupName ? 'Sip ' + a.groupName : 'Sip';
          return label;
        }
        var item = itemMap[a.itemId];
        if (!item) return '';
        var fullName = (item.brand ? item.brand + ' ' : '') + item.name;
        if (a.quantity === 0.5) return '½ ' + fullName;
        return fullName;
      }).filter(Boolean).join(' · ');

      var carbNote = slotCarbs > 0 ? '  (~' + Math.round(slotCarbs) + 'g carbs)' : '';
      lines.push(timeLabel + '  ' + itemLabels + carbNote);
    });

    return lines.join('\n');
  }

  // ── Food Log Markdown ────────────────────────────────────────────────────────

  var MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var DAY_LONG = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  var FOOD_CAT_ORDER = ['breakfast','pre-workout','lunch','snack','dinner','post-workout','fuel'];

  function parseDateLocal(str) {
    var parts = str.split('-');
    return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  }

  function padLeft(str, ch, len) {
    str = String(str);
    while (str.length < len) str = ch + str;
    return str;
  }

  function formatDateKey2(d) {
    var y = d.getFullYear();
    var m = padLeft(d.getMonth() + 1, '0', 2);
    var day = padLeft(d.getDate(), '0', 2);
    return y + '-' + m + '-' + day;
  }

  function generateFoodLogMarkdown(logsByDate, startDate, endDate) {
    // Build allDates array from startDate to endDate inclusive
    var allDates = [];
    var cur = parseDateLocal(startDate);
    var endD = parseDateLocal(endDate);
    while (cur <= endD) {
      allDates.push(formatDateKey2(cur));
      cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1);
    }

    // Trim outer empty dates
    var firstIdx = -1, lastIdx = -1;
    for (var i = 0; i < allDates.length; i++) {
      var entries = logsByDate[allDates[i]];
      if (entries && entries.length > 0) {
        if (firstIdx === -1) firstIdx = i;
        lastIdx = i;
      }
    }
    var trimmedDates = firstIdx >= 0 ? allDates.slice(firstIdx, lastIdx + 1) : [];

    // Determine if sodium/fiber columns needed
    var showSodium = false, showFiber = false;
    Object.keys(logsByDate).forEach(function (dateKey) {
      (logsByDate[dateKey] || []).forEach(function (log) {
        if (log.sodium != null) showSodium = true;
        if (log.fiber != null) showFiber = true;
      });
    });

    // Title
    var isMultiDay = startDate !== endDate;
    var title;
    if (!isMultiDay) {
      var sd = parseDateLocal(startDate);
      title = '# Food Log — ' + DAY_LONG[sd.getDay()] + ', ' + sd.getDate() + ' ' + MONTH_SHORT[sd.getMonth()] + ' ' + sd.getFullYear();
    } else {
      var sd = parseDateLocal(startDate);
      var ed = parseDateLocal(endDate);
      if (sd.getMonth() === ed.getMonth() && sd.getFullYear() === ed.getFullYear()) {
        title = '# Food Log — ' + sd.getDate() + '–' + ed.getDate() + ' ' + MONTH_SHORT[ed.getMonth()] + ' ' + ed.getFullYear();
      } else {
        title = '# Food Log — ' + sd.getDate() + ' ' + MONTH_SHORT[sd.getMonth()] + '–' + ed.getDate() + ' ' + MONTH_SHORT[ed.getMonth()] + ' ' + ed.getFullYear();
      }
    }

    var lines = [title, ''];

    var grandCal = 0, grandProtein = 0, grandCarbs = 0, grandFat = 0;

    trimmedDates.forEach(function (dateStr) {
      var d = parseDateLocal(dateStr);
      if (isMultiDay) {
        lines.push('## ' + DAY_LONG[d.getDay()] + ', ' + d.getDate() + ' ' + MONTH_SHORT[d.getMonth()] + ' ' + d.getFullYear());
        lines.push('');
      }

      var dayEntries = logsByDate[dateStr];
      if (!dayEntries || dayEntries.length === 0) {
        lines.push('*(no entries)*');
        lines.push('');
        return;
      }

      var dayCal = 0, dayProtein = 0, dayCarbs = 0, dayFat = 0;

      var sortedEntries = dayEntries.slice().sort(function (a, b) {
        return new Date(a.loggedAt) - new Date(b.loggedAt);
      });

      var header = '| Time | Category | Item | Cal | Protein | Carbs | Fat |';
      var divider = '|------|----------|------|-----|---------|-------|-----|';
      if (showSodium) { header += ' Sodium |'; divider += '--------|'; }
      if (showFiber)  { header += ' Fiber |';  divider += '-------|'; }
      lines.push(header);
      lines.push(divider);

      sortedEntries.forEach(function (log) {
        var t = new Date(log.loggedAt);
        var h = t.getHours(), m = String(t.getMinutes()).padStart(2, '0');
        var timeStr = (h % 12 || 12) + ':' + m + ' ' + (h >= 12 ? 'PM' : 'AM');
        var cat = log.category || 'other';
        var catLabel = cat.charAt(0).toUpperCase() + cat.slice(1);
        var row = '| ' + timeStr + ' | ' + catLabel + ' | ' + (log.name || '') + ' | ' + Math.round(log.calories || 0) + ' | ' + Math.round(log.protein || 0) + 'g | ' + Math.round(log.carbs || 0) + 'g | ' + Math.round(log.fat || 0) + 'g |';
        if (showSodium) row += ' ' + (log.sodium != null ? Math.round(log.sodium) + 'mg' : '—') + ' |';
        if (showFiber)  row += ' ' + (log.fiber  != null ? Math.round(log.fiber)  + 'g'  : '—') + ' |';
        lines.push(row);

        dayCal     += (log.calories || 0);
        dayProtein += (log.protein  || 0);
        dayCarbs   += (log.carbs    || 0);
        dayFat     += (log.fat      || 0);
      });

      lines.push('');

      lines.push((isMultiDay ? '**Day total:**' : '**Total:**') + ' ' + Math.round(dayCal) + ' kcal · ' + Math.round(dayProtein) + 'g protein · ' + Math.round(dayCarbs) + 'g carbs · ' + Math.round(dayFat) + 'g fat');
      lines.push('');
      if (isMultiDay) {
        lines.push('---');
        lines.push('');
      }

      if (isMultiDay) {
        grandCal     += dayCal;
        grandProtein += dayProtein;
        grandCarbs   += dayCarbs;
        grandFat     += dayFat;
      }
    });

    if (isMultiDay && trimmedDates.length > 0) {
      lines.push('**Total:** ' + Math.round(grandCal) + ' kcal · ' + Math.round(grandProtein) + 'g protein · ' + Math.round(grandCarbs) + 'g carbs · ' + Math.round(grandFat) + 'g fat');
      lines.push('');
    }

    return lines.join('\n');
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  window.Export = {
    generateEventMarkdown: generateEventMarkdown,
    generateExecutionPlanText: generateExecutionPlanText,
    generateFoodLogMarkdown: generateFoodLogMarkdown
  };

})();
