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

      var totalMinutes = slot.slotIndex * slot.intervalMinutes + slot.intervalMinutes;
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

  // ── Public API ──────────────────────────────────────────────────────────────

  window.Export = {
    generateEventMarkdown: generateEventMarkdown,
    generateExecutionPlanText: generateExecutionPlanText
  };

})();
