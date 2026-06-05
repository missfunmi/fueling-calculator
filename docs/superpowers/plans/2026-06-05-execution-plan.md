# Execution Plan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an auto-generated, editable per-segment execution plan that breaks a segment's fuel items into 15-minute interval slots.

**Architecture:** The algorithm lives in `data.js` and is tested independently. Plans are persisted in `localStorage` keyed by segment ID (DB persistence via the `save_event` RPC is a follow-up once the Supabase function is updated — see note below). The UI adds a collapsible panel at the bottom of each segment section in the detail view, with a dedicated slot editor bottom sheet for editing individual slots.

> **DB persistence note:** Full database persistence requires adding an `execution_plan JSONB` column to the `segments` table and updating the `save_event` Postgres RPC in Supabase. This is deferred — `localStorage` is used for now. A follow-up task should apply the migration and update `eventToDb`/`dbToEvent` in `data.js`.

**Tech Stack:** Vanilla JS, localStorage, existing bottom-sheet pattern (see `#sheet-overlay` in `index.html`), Lucide SVG icons (copy icon already used in the codebase).

---

## File Map

| File | Change |
|------|--------|
| `data.js` | Add `generateExecutionPlan`, `checkExecutionPlanTarget`, `calcSlotCarbs`, `saveExecutionPlan`, `loadExecutionPlan`, `deleteExecutionPlan` |
| `export.js` | Add `generateExecutionPlanText` |
| `app.js` | Add `executionPlanHTML`, slot editor open/close/move/remove/add handlers, copy handler; update `segmentSectionHTML`, `reattachSegmentHandlers` |
| `index.html` | Add slot editor sheet HTML |
| `style.css` | Add execution plan panel and slot editor styles |
| `tests/data.test.js` | Add algorithm and storage tests |
| `tests/export.test.js` | Add `generateExecutionPlanText` tests |

---

## Task 1: Core algorithm in data.js

**Files:**
- Modify: `data.js` (before the `exports` block at line ~540)
- Test: `tests/data.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/data.test.js` inside the `run()` function, before the final `console.log` summary:

```js
  // ── Execution Plan ────────────────────────────────────────────────────────────

  console.log('\nExecution Plan — generateExecutionPlan');

  await test('generates correct slot count for 1h segment', async function () {
    var seg = {
      id: 'seg1', durationHours: 1,
      targets: { carbsPerHour: 60, sodiumPerHour: 0, caffeinePerHour: 0 },
      items: []
    };
    var plan = D.generateExecutionPlan(seg);
    assert.strictEqual(plan.length, 4); // ceil(60/15) = 4
  });

  await test('generates correct slot count for 3.5h segment', async function () {
    var seg = {
      id: 'seg1', durationHours: 3.5,
      targets: { carbsPerHour: 90, sodiumPerHour: 0, caffeinePerHour: 0 },
      items: []
    };
    var plan = D.generateExecutionPlan(seg);
    assert.strictEqual(plan.length, 14); // ceil(210/15) = 14
  });

  await test('distributes 4 gels evenly across 8 slots', async function () {
    var seg = {
      id: 'seg1', durationHours: 2,
      targets: { carbsPerHour: 60, sodiumPerHour: 0, caffeinePerHour: 0 },
      items: [
        { id: 'g1', type: 'gel', carbsPerUnit: 25, sodiumPerUnit: 0, caffeinePerUnit: 0, quantity: 4 }
      ]
    };
    var plan = D.generateExecutionPlan(seg);
    var assigned = plan.filter(function(s) { return s.assignments.length > 0; });
    assert.strictEqual(assigned.length, 4);
    assert.strictEqual(plan[0].assignments[0].itemId, 'g1');
    assert.strictEqual(plan[0].assignments[0].quantity, 1);
  });

  await test('interleaves caf and non-caf gels', async function () {
    var seg = {
      id: 'seg1', durationHours: 2,
      targets: { carbsPerHour: 60, sodiumPerHour: 0, caffeinePerHour: 0 },
      items: [
        { id: 'gcaf', type: 'gel', carbsPerUnit: 25, sodiumPerUnit: 0, caffeinePerUnit: 75, quantity: 2 },
        { id: 'gnon', type: 'gel', carbsPerUnit: 25, sodiumPerUnit: 0, caffeinePerUnit: 0, quantity: 2 }
      ]
    };
    var plan = D.generateExecutionPlan(seg);
    var nonEmpty = plan.filter(function(s) { return s.assignments.length > 0; });
    assert.strictEqual(nonEmpty.length, 4);
    // First slot should have a caf gel
    assert.strictEqual(nonEmpty[0].assignments[0].itemId, 'gcaf');
    // Second slot should have a non-caf gel
    assert.strictEqual(nonEmpty[1].assignments[0].itemId, 'gnon');
  });

  await test('splits bars into half-unit assignments', async function () {
    var seg = {
      id: 'seg1', durationHours: 2,
      targets: { carbsPerHour: 40, sodiumPerHour: 0, caffeinePerHour: 0 },
      items: [
        { id: 'b1', type: 'bar', carbsPerUnit: 45, sodiumPerUnit: 0, caffeinePerUnit: 0, quantity: 2 }
      ]
    };
    var plan = D.generateExecutionPlan(seg);
    var allAssignments = plan.reduce(function(acc, s) { return acc.concat(s.assignments); }, []);
    assert.strictEqual(allAssignments.length, 4); // 2 bars × 2 halves = 4
    assert.strictEqual(allAssignments[0].quantity, 0.5);
  });

  await test('distributes drink_powder as one sip per slot', async function () {
    var seg = {
      id: 'seg1', durationHours: 1,
      targets: { carbsPerHour: 80, sodiumPerHour: 0, caffeinePerHour: 0 },
      items: [
        { id: 'dp1', type: 'drink_powder', carbsPerUnit: 80, sodiumPerUnit: 0, caffeinePerUnit: 0, quantity: 1 }
      ]
    };
    var plan = D.generateExecutionPlan(seg);
    // Every slot gets a sip
    assert.strictEqual(plan.length, 4);
    plan.forEach(function(slot) {
      assert.strictEqual(slot.assignments.length, 1);
      assert.strictEqual(slot.assignments[0].itemId, 'dp1');
      assert.ok(Math.abs(slot.assignments[0].quantity - 0.25) < 0.001); // 1/4 per slot
    });
  });

  await test('skips items with quantity 0', async function () {
    var seg = {
      id: 'seg1', durationHours: 1,
      targets: { carbsPerHour: 60, sodiumPerHour: 0, caffeinePerHour: 0 },
      items: [
        { id: 'g1', type: 'gel', carbsPerUnit: 25, sodiumPerUnit: 0, caffeinePerUnit: 0, quantity: 0 }
      ]
    };
    var plan = D.generateExecutionPlan(seg);
    var allAssignments = plan.reduce(function(acc, s) { return acc.concat(s.assignments); }, []);
    assert.strictEqual(allAssignments.length, 0);
  });

  console.log('\nExecution Plan — checkExecutionPlanTarget');

  await test('returns projected rate when >15% below target', async function () {
    var seg = {
      id: 'seg1', durationHours: 1,
      targets: { carbsPerHour: 100, sodiumPerHour: 0, caffeinePerHour: 0 },
      items: [
        { id: 'g1', type: 'gel', carbsPerUnit: 25, sodiumPerUnit: 0, caffeinePerUnit: 0, quantity: 2 }
      ]
    };
    var result = D.checkExecutionPlanTarget(seg);
    assert.strictEqual(result, 50); // 50g/hr, well below 85g threshold
  });

  await test('returns null when within 15% of target', async function () {
    var seg = {
      id: 'seg1', durationHours: 1,
      targets: { carbsPerHour: 100, sodiumPerHour: 0, caffeinePerHour: 0 },
      items: [
        { id: 'g1', type: 'gel', carbsPerUnit: 25, sodiumPerUnit: 0, caffeinePerUnit: 0, quantity: 4 }
      ]
    };
    var result = D.checkExecutionPlanTarget(seg);
    assert.strictEqual(result, null); // 100g/hr = exactly on target
  });

  await test('returns null when no target set', async function () {
    var seg = {
      id: 'seg1', durationHours: 1,
      targets: { carbsPerHour: 0, sodiumPerHour: 0, caffeinePerHour: 0 },
      items: [
        { id: 'g1', type: 'gel', carbsPerUnit: 25, sodiumPerUnit: 0, caffeinePerUnit: 0, quantity: 2 }
      ]
    };
    assert.strictEqual(D.checkExecutionPlanTarget(seg), null);
  });

  console.log('\nExecution Plan — calcSlotCarbs');

  await test('calculates carbs for a slot', async function () {
    var items = [
      { id: 'g1', carbsPerUnit: 25, quantity: 1 },
      { id: 'dp1', carbsPerUnit: 80, quantity: 1 }
    ];
    var slot = { assignments: [{ itemId: 'g1', quantity: 1 }, { itemId: 'dp1', quantity: 0.25 }] };
    var carbs = D.calcSlotCarbs(slot, items);
    assert.strictEqual(carbs, 45); // 25 + 80*0.25 = 45
  });

  await test('returns 0 for empty slot', async function () {
    var slot = { assignments: [] };
    assert.strictEqual(D.calcSlotCarbs(slot, []), 0);
  });

  console.log('\nExecution Plan — localStorage persistence');

  await test('saveExecutionPlan and loadExecutionPlan round-trip', async function () {
    var plan = [{ slotIndex: 0, intervalMinutes: 15, assignments: [{ itemId: 'g1', quantity: 1 }] }];
    D.saveExecutionPlan('seg-abc', plan);
    var loaded = D.loadExecutionPlan('seg-abc');
    assert.deepStrictEqual(loaded, plan);
  });

  await test('loadExecutionPlan returns null for unknown segment', async function () {
    assert.strictEqual(D.loadExecutionPlan('unknown-seg'), null);
  });

  await test('deleteExecutionPlan removes the plan', async function () {
    D.saveExecutionPlan('seg-del', [{ slotIndex: 0, intervalMinutes: 15, assignments: [] }]);
    D.deleteExecutionPlan('seg-del');
    assert.strictEqual(D.loadExecutionPlan('seg-del'), null);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/funmi/Development/projects/fueling-calculator && node tests/data.test.js 2>&1 | tail -20
```

Expected: failures with `D.generateExecutionPlan is not a function` or similar.

- [ ] **Step 3: Implement the algorithm in data.js**

Add the following functions in `data.js` just before the `exports` block (around line 540). Insert after `function itemFromOneOff`:

```js
  // ── Execution Plan ────────────────────────────────────────────────────────────

  function generateExecutionPlan(segment) {
    var slotCount = Math.ceil((segment.durationHours || 1) * 60 / 15);
    var slots = [];
    for (var i = 0; i < slotCount; i++) {
      slots.push({ slotIndex: i, intervalMinutes: 15, assignments: [] });
    }

    var liquidItems = (segment.items || []).filter(function (item) {
      return item.type === 'drink_powder' && item.quantity > 0;
    });
    var discreteItems = (segment.items || []).filter(function (item) {
      return item.type !== 'drink_powder' && item.quantity > 0;
    });

    // Liquid: one fractional sip per slot
    liquidItems.forEach(function (item) {
      var fraction = Math.round((1 / slotCount) * 10000) / 10000;
      slots.forEach(function (slot) {
        slot.assignments.push({ itemId: item.id, quantity: fraction });
      });
    });

    // Separate gels by caffeine content, bars, and other
    var gelCaf = [], gelNonCaf = [], bars = [], other = [];
    discreteItems.forEach(function (item) {
      if (item.type === 'gel' && item.caffeinePerUnit > 0) {
        for (var i = 0; i < item.quantity; i++) gelCaf.push({ itemId: item.id, quantity: 1 });
      } else if (item.type === 'gel') {
        for (var i = 0; i < item.quantity; i++) gelNonCaf.push({ itemId: item.id, quantity: 1 });
      } else if (item.type === 'bar') {
        var halves = Math.round(item.quantity * 2);
        for (var i = 0; i < halves; i++) bars.push({ itemId: item.id, quantity: 0.5 });
      } else {
        for (var i = 0; i < item.quantity; i++) other.push({ itemId: item.id, quantity: 1 });
      }
    });

    // Interleave caf and non-caf gels
    var gels = [];
    var maxLen = Math.max(gelCaf.length, gelNonCaf.length);
    for (var i = 0; i < maxLen; i++) {
      if (i < gelCaf.length)    gels.push(gelCaf[i]);
      if (i < gelNonCaf.length) gels.push(gelNonCaf[i]);
    }

    function distributeUnits(units) {
      units.forEach(function (unit, i) {
        var idx = Math.floor(i * slotCount / units.length);
        slots[idx].assignments.push(unit);
      });
    }

    distributeUnits(gels);
    distributeUnits(bars);
    distributeUnits(other);

    return slots;
  }

  // Returns the projected g/hr if it is >15% below target, otherwise null.
  function checkExecutionPlanTarget(segment) {
    var target = segment.targets && segment.targets.carbsPerHour;
    if (!target) return null;
    var totalCarbs = (segment.items || []).reduce(function (sum, item) {
      return sum + (item.carbsPerUnit || 0) * (item.quantity || 0);
    }, 0);
    var projected = totalCarbs / (segment.durationHours || 1);
    return projected < target * 0.85 ? Math.round(projected) : null;
  }

  function calcSlotCarbs(slot, items) {
    var itemMap = {};
    (items || []).forEach(function (item) { itemMap[item.id] = item; });
    return (slot.assignments || []).reduce(function (sum, a) {
      var item = itemMap[a.itemId];
      return sum + (item ? (item.carbsPerUnit || 0) * a.quantity : 0);
    }, 0);
  }

  function saveExecutionPlan(segmentId, plan) {
    localStorage.setItem('fuelPlanner.execPlan.' + segmentId, JSON.stringify(plan));
  }

  function loadExecutionPlan(segmentId) {
    try {
      var raw = localStorage.getItem('fuelPlanner.execPlan.' + segmentId);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function deleteExecutionPlan(segmentId) {
    localStorage.removeItem('fuelPlanner.execPlan.' + segmentId);
  }
```

- [ ] **Step 4: Export the new functions**

In the `exports` block at the bottom of `data.js`, add:

```js
  exports.generateExecutionPlan     = generateExecutionPlan;
  exports.checkExecutionPlanTarget  = checkExecutionPlanTarget;
  exports.calcSlotCarbs             = calcSlotCarbs;
  exports.saveExecutionPlan         = saveExecutionPlan;
  exports.loadExecutionPlan         = loadExecutionPlan;
  exports.deleteExecutionPlan       = deleteExecutionPlan;
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd /Users/funmi/Development/projects/fueling-calculator && node tests/data.test.js 2>&1 | tail -20
```

Expected: all new tests pass, no regressions.

- [ ] **Step 6: Commit**

```bash
git add data.js tests/data.test.js
git commit -m "feat: add execution plan algorithm and localStorage persistence"
```

---

## Task 2: generateExecutionPlanText in export.js

**Files:**
- Modify: `export.js`
- Test: `tests/export.test.js`

- [ ] **Step 1: Write the failing test**

Append to the `run()` function in `tests/export.test.js`:

```js
  console.log('\nExecution Plan — generateExecutionPlanText');

  await test('formats execution plan as readable text', async function () {
    var seg = {
      name: 'Bike',
      items: [
        { id: 'g1', brand: 'Maurten', name: 'Gel 100', type: 'gel', carbsPerUnit: 25, quantity: 1 },
        { id: 'dp1', brand: 'Skratch', name: 'Superfuel', type: 'drink_powder', carbsPerUnit: 100, quantity: 1 }
      ]
    };
    var plan = [
      { slotIndex: 0, intervalMinutes: 15, assignments: [{ itemId: 'g1', quantity: 1 }, { itemId: 'dp1', quantity: 0.25 }] },
      { slotIndex: 1, intervalMinutes: 15, assignments: [{ itemId: 'dp1', quantity: 0.25 }] },
      { slotIndex: 2, intervalMinutes: 15, assignments: [] },
      { slotIndex: 3, intervalMinutes: 15, assignments: [{ itemId: 'dp1', quantity: 0.25 }] }
    ];
    var text = Export.generateExecutionPlanText(seg, plan);
    assert.ok(text.includes('Bike — Execution Plan'));
    assert.ok(text.includes('0:15'));
    assert.ok(text.includes('Maurten Gel 100'));
    assert.ok(text.includes('Sip Skratch Superfuel'));
    assert.ok(text.includes('~50g carbs')); // 25 + 100*0.25 = 50
    // Empty slot (0:45) should not appear
    assert.ok(!text.includes('0:45'));
  });

  await test('formats half-bar correctly', async function () {
    var seg = {
      name: 'Bike',
      items: [{ id: 'b1', brand: 'Maurten', name: 'Solid Bar', type: 'bar', carbsPerUnit: 45, quantity: 1 }]
    };
    var plan = [
      { slotIndex: 0, intervalMinutes: 15, assignments: [{ itemId: 'b1', quantity: 0.5 }] }
    ];
    var text = Export.generateExecutionPlanText(seg, plan);
    assert.ok(text.includes('½ Maurten Solid Bar'));
  });
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/funmi/Development/projects/fueling-calculator && node tests/export.test.js 2>&1 | tail -10
```

Expected: `Export.generateExecutionPlanText is not a function`.

- [ ] **Step 3: Implement generateExecutionPlanText in export.js**

Add the following function in `export.js` before the `exports` block:

```js
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
        var item = itemMap[a.itemId];
        return sum + (item ? (item.carbsPerUnit || 0) * a.quantity : 0);
      }, 0);

      var itemLabels = slot.assignments.map(function (a) {
        var item = itemMap[a.itemId];
        if (!item) return '';
        var fullName = (item.brand ? item.brand + ' ' : '') + item.name;
        if (item.type === 'drink_powder') return 'Sip ' + fullName;
        if (a.quantity === 0.5) return '½ ' + fullName;
        return fullName;
      }).filter(Boolean).join(' · ');

      var carbNote = slotCarbs > 0 ? '  (~' + Math.round(slotCarbs) + 'g carbs)' : '';
      lines.push(timeLabel + '  ' + itemLabels + carbNote);
    });

    return lines.join('\n');
  }
```

Add to the `exports` block in `export.js`:

```js
    generateExecutionPlanText: generateExecutionPlanText,
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/funmi/Development/projects/fueling-calculator && node tests/export.test.js 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add export.js tests/export.test.js
git commit -m "feat: add generateExecutionPlanText for execution plan copy"
```

---

## Task 3: Execution plan panel HTML and CSS

**Files:**
- Modify: `app.js` — add `executionPlanHTML(seg)`, update `segmentSectionHTML`
- Modify: `style.css` — add execution plan panel styles

- [ ] **Step 1: Add executionPlanHTML to app.js**

Add this function in `app.js` after `segmentSectionHTML` (around line 634):

```js
  function slotTimeLabel(slotIndex, intervalMinutes) {
    var totalMinutes = (slotIndex + 1) * intervalMinutes;
    var h = Math.floor(totalMinutes / 60);
    var m = totalMinutes % 60;
    return h + ':' + String(m).padStart(2, '0');
  }

  function executionPlanHTML(seg) {
    var plan = Data.loadExecutionPlan(seg.id);
    var hasPlan = plan && plan.length > 0;

    // Staleness check: slot count mismatch means duration changed
    var expectedSlots = Math.ceil((seg.durationHours || 1) * 60 / 15);
    var isStale = hasPlan && plan.length !== expectedSlots;

    // Check for orphaned itemIds (items removed since generation)
    var itemIds = new Set((seg.items || []).map(function (i) { return i.id; }));
    var hasOrphans = hasPlan && plan.some(function (slot) {
      return (slot.assignments || []).some(function (a) { return !itemIds.has(a.itemId); });
    });
    var showStaleWarning = isStale || hasOrphans;

    var headerHTML =
      '<div class="exec-plan-header">' +
        '<button class="exec-plan-toggle" data-exec-toggle="' + seg.id + '" aria-expanded="' + (hasPlan ? 'false' : 'false') + '">' +
          (hasPlan ? '&#9660;' : '&#9654;') + ' Execution plan' +
        '</button>' +
        (hasPlan
          ? '<div class="exec-plan-header-actions">' +
              '<button class="exec-plan-copy-btn" data-exec-copy="' + seg.id + '" title="Copy execution plan" aria-label="Copy execution plan">' +
                '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>' +
              '</button>' +
              '<button class="exec-plan-regen-btn" data-exec-regen="' + seg.id + '">Regenerate</button>' +
            '</div>'
          : '<button class="exec-plan-generate-btn" data-exec-generate="' + seg.id + '">Generate</button>') +
      '</div>';

    if (!hasPlan) {
      return '<div class="exec-plan-panel" data-exec-panel="' + seg.id + '">' + headerHTML + '</div>';
    }

    var staleHTML = showStaleWarning
      ? '<div class="exec-plan-stale-warning">Segment changed — plan may be out of date. Regenerate to refresh.</div>'
      : '';

    var slotsHTML = plan.map(function (slot) {
      var slotCarbs = Data.calcSlotCarbs(slot, seg.items);
      var carbLabel = slotCarbs > 0 ? '<span class="exec-slot-carbs">~' + Math.round(slotCarbs) + 'g</span>' : '';

      var assignmentLabels = (slot.assignments || []).map(function (a) {
        var item = (seg.items || []).find(function (i) { return i.id === a.itemId; });
        if (!item) return '';
        var fullName = escHtml((item.brand ? item.brand + ' ' : '') + item.name);
        if (item.type === 'drink_powder') return 'Sip ' + fullName;
        if (a.quantity === 0.5) return '½ ' + fullName;
        return fullName;
      }).filter(Boolean).join(' · ');

      var isEmpty = !assignmentLabels;

      return '<div class="exec-slot-row' + (isEmpty ? ' exec-slot-empty' : '') + '" ' +
        'data-exec-slot="' + seg.id + ':' + slot.slotIndex + '">' +
        '<span class="exec-slot-time">' + slotTimeLabel(slot.slotIndex, slot.intervalMinutes) + '</span>' +
        '<span class="exec-slot-items">' + (isEmpty ? '—' : assignmentLabels) + '</span>' +
        carbLabel +
      '</div>';
    }).join('');

    return '<div class="exec-plan-panel" data-exec-panel="' + seg.id + '">' +
      headerHTML +
      '<div class="exec-plan-body hidden" data-exec-body="' + seg.id + '">' +
        staleHTML +
        '<div class="exec-slots-list">' + slotsHTML + '</div>' +
      '</div>' +
    '</div>';
  }
```

- [ ] **Step 2: Append executionPlanHTML to segmentSectionHTML**

In `segmentSectionHTML`, find the closing line:

```js
      '<button class="btn-add-item" data-add-segment-id="' + seg.id + '">+ Add item</button>' +
    '</div>';
```

Replace it with:

```js
      '<button class="btn-add-item" data-add-segment-id="' + seg.id + '">+ Add item</button>' +
      executionPlanHTML(seg) +
    '</div>';
```

- [ ] **Step 3: Add CSS to style.css**

Append the following to `style.css`:

```css
/* ── Execution Plan Panel ─────────────────────────────────────────────────── */
.exec-plan-panel {
  border-top: 1px solid var(--border);
  margin-top: 4px;
}

.exec-plan-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
}

.exec-plan-toggle {
  background: none;
  border: none;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 0;
  text-align: left;
}

.exec-plan-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.exec-plan-generate-btn,
.exec-plan-regen-btn {
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-secondary);
  cursor: pointer;
}

.exec-plan-copy-btn {
  background: none;
  border: none;
  padding: 4px;
  cursor: pointer;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
}

.exec-plan-stale-warning {
  font-size: 12px;
  color: var(--warning, #b45309);
  background: var(--warning-bg, #fef3c7);
  padding: 6px 16px;
  border-radius: 6px;
  margin: 0 16px 8px;
}

.exec-plan-body { padding-bottom: 8px; }
.exec-plan-body.hidden { display: none; }

.exec-slots-list { padding: 0 16px; }

.exec-slot-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  font-size: 13px;
}
.exec-slot-row:last-child { border-bottom: none; }
.exec-slot-row:active { background: var(--surface-raised); }

.exec-slot-empty .exec-slot-items { color: var(--text-tertiary); }

.exec-slot-time {
  min-width: 36px;
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary);
  font-size: 12px;
}

.exec-slot-items { flex: 1; }

.exec-slot-carbs {
  font-size: 11px;
  color: var(--text-tertiary);
  white-space: nowrap;
}
```

- [ ] **Step 4: Verify it renders without errors**

Open the app in a browser, navigate to an event detail view. Confirm each segment shows "▶ Execution plan  [Generate]" at the bottom with no JS errors in the console.

- [ ] **Step 5: Commit**

```bash
git add app.js style.css
git commit -m "feat: add execution plan panel HTML and CSS to segment section"
```

---

## Task 4: Generate, Regenerate, and Collapse handlers

**Files:**
- Modify: `app.js` — add handlers; update `reattachSegmentHandlers`

- [ ] **Step 1: Add the handler functions to app.js**

Add these functions after `reattachActualSegmentHandlers` (around line 997):

```js
  function handleExecutionPlanGenerate(segId, forceRegenerate) {
    var evt = state.currentEvent;
    if (!evt) return;
    var seg = (evt.segments || []).find(function (s) { return s.id === segId; });
    if (!seg) return;

    function doGenerate() {
      var plan = Data.generateExecutionPlan(seg);
      Data.saveExecutionPlan(segId, plan);
      // Re-render this segment section only
      var multiSeg = evt.segments.length > 1;
      var segEl = document.querySelector('[data-segment-id="' + segId + '"]');
      if (segEl) {
        segEl.outerHTML = segmentSectionHTML(seg, multiSeg);
        reattachSegmentHandlers(segId);
      }
      // Auto-expand the panel after generation
      var body = document.querySelector('[data-exec-body="' + segId + '"]');
      if (body) body.classList.remove('hidden');
      var toggle = document.querySelector('[data-exec-toggle="' + segId + '"]');
      if (toggle) toggle.setAttribute('aria-expanded', 'true');
    }

    var shortfall = Data.checkExecutionPlanTarget(seg);
    if (shortfall !== null) {
      if (!confirm(
        'This plan delivers ~' + shortfall + 'g/hr carbs against a ' +
        seg.targets.carbsPerHour + 'g/hr target.\nConsider adding more items. Generate anyway?'
      )) return;
    }

    if (forceRegenerate && Data.loadExecutionPlan(segId)) {
      if (!confirm('Regenerate plan? Any manual edits will be replaced.')) return;
    }

    doGenerate();
  }

  function handleExecutionPlanToggle(segId) {
    var body = document.querySelector('[data-exec-body="' + segId + '"]');
    var toggle = document.querySelector('[data-exec-toggle="' + segId + '"]');
    if (!body) return;
    var isHidden = body.classList.contains('hidden');
    body.classList.toggle('hidden', !isHidden);
    if (toggle) toggle.setAttribute('aria-expanded', String(isHidden));
  }
```

- [ ] **Step 2: Wire handlers into reattachSegmentHandlers**

Inside `reattachSegmentHandlers`, after the existing `$$('[data-inline]')` block, add:

```js
    // Execution plan handlers
    var genBtn = segEl.querySelector('[data-exec-generate]');
    if (genBtn) {
      on(genBtn, 'click', function () {
        handleExecutionPlanGenerate(genBtn.dataset.execGenerate, false);
      });
    }

    var regenBtn = segEl.querySelector('[data-exec-regen]');
    if (regenBtn) {
      on(regenBtn, 'click', function () {
        handleExecutionPlanGenerate(regenBtn.dataset.execRegen, true);
      });
    }

    var toggleBtn = segEl.querySelector('[data-exec-toggle]');
    if (toggleBtn) {
      on(toggleBtn, 'click', function () {
        handleExecutionPlanToggle(toggleBtn.dataset.execToggle);
      });
    }

    var copyBtn = segEl.querySelector('[data-exec-copy]');
    if (copyBtn) {
      on(copyBtn, 'click', function () {
        var evt2 = state.currentEvent;
        if (!evt2) return;
        var seg2 = (evt2.segments || []).find(function (s) { return s.id === copyBtn.dataset.execCopy; });
        var plan = Data.loadExecutionPlan(copyBtn.dataset.execCopy);
        if (!seg2 || !plan) return;
        var text = Export.generateExecutionPlanText(seg2, plan);
        navigator.clipboard.writeText(text).then(function () {
          showToast('Execution plan copied!');
        }).catch(function () {
          showToast("Couldn't copy — try again.");
        });
      });
    }
```

- [ ] **Step 3: Verify in the browser**

1. Open an event detail view.
2. Tap **Generate** on a segment — confirm plan generates and the panel expands automatically.
3. Tap the **▼ Execution plan** toggle — confirm it collapses and re-expands.
4. Tap **Regenerate** — confirm the confirmation dialog appears.
5. Tap the copy icon — confirm "Execution plan copied!" toast appears.

- [ ] **Step 4: Commit**

```bash
git add app.js
git commit -m "feat: wire generate, regenerate, collapse, and copy handlers for execution plan"
```

---

## Task 5: Slot editor sheet HTML and CSS

**Files:**
- Modify: `index.html` — add slot editor sheet
- Modify: `style.css` — add slot editor styles

- [ ] **Step 1: Add the slot editor sheet to index.html**

Add the following immediately after the closing `</div>` of `#sheet-overlay` (around line 283 in index.html):

```html
<!-- ── Bottom sheet: Slot editor ──────────────────────────────────── -->
<div id="slot-editor-overlay" class="sheet-overlay hidden">
  <div id="slot-editor-sheet" class="sheet">
    <div class="sheet-handle"></div>
    <div class="sheet-header">
      <span id="slot-editor-title">0:15</span>
      <button id="btn-close-slot-editor" class="sheet-close" type="button" aria-label="Close">&#215;</button>
    </div>
    <div id="slot-editor-body" class="slot-editor-body"></div>
    <div class="slot-editor-footer">
      <button id="btn-slot-add-item" class="btn-secondary" type="button">+ Add item</button>
    </div>
  </div>
</div>

<!-- ── Bottom sheet: Slot picker (Move to slot) ─────────────────── -->
<div id="slot-picker-overlay" class="sheet-overlay hidden">
  <div id="slot-picker-sheet" class="sheet">
    <div class="sheet-handle"></div>
    <div class="sheet-header">
      <span>Move to slot</span>
      <button id="btn-close-slot-picker" class="sheet-close" type="button" aria-label="Close">&#215;</button>
    </div>
    <div id="slot-picker-body" class="slot-picker-body"></div>
  </div>
</div>
```

- [ ] **Step 2: Add slot editor CSS to style.css**

Append to `style.css`:

```css
/* ── Slot editor sheet ────────────────────────────────────────────────────── */
.slot-editor-body {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 8px 16px;
}

.slot-editor-footer {
  padding: 12px 16px;
  border-top: 1px solid var(--border);
}

.slot-assignment-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 0;
  border-bottom: 1px solid var(--border);
  font-size: 14px;
}
.slot-assignment-row:last-child { border-bottom: none; }

.slot-assignment-label { flex: 1; }

.slot-assignment-actions {
  display: flex;
  gap: 8px;
}

.slot-assignment-actions button {
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-secondary);
  cursor: pointer;
}

.slot-empty-label {
  padding: 16px 0;
  font-size: 13px;
  color: var(--text-tertiary);
  text-align: center;
}

/* ── Slot picker sheet ────────────────────────────────────────────────────── */
.slot-picker-body {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.slot-picker-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  font-size: 14px;
}
.slot-picker-row:last-child { border-bottom: none; }
.slot-picker-row:active { background: var(--surface-raised); }

.slot-picker-time {
  font-variant-numeric: tabular-nums;
  font-weight: 500;
  min-width: 40px;
}

.slot-picker-summary {
  flex: 1;
  font-size: 12px;
  color: var(--text-tertiary);
  margin-left: 8px;
}
```

- [ ] **Step 3: Commit**

```bash
git add index.html style.css
git commit -m "feat: add slot editor and slot picker sheet HTML and CSS"
```

---

## Task 6: Slot editor interactions

**Files:**
- Modify: `app.js` — add slot editor open/close/move/remove/add logic

- [ ] **Step 1: Add slot editor state and helpers**

Add these variables and functions in `app.js` after `handleExecutionPlanToggle` (added in Task 4):

```js
  // Slot editor state
  var _slotEditorSegId = null;
  var _slotEditorSlotIndex = null;
  var _slotEditorMoveItemId = null; // itemId being moved, set when Move is tapped

  function openSlotEditor(segId, slotIndex) {
    var evt = state.currentEvent;
    if (!evt) return;
    var seg = (evt.segments || []).find(function (s) { return s.id === segId; });
    var plan = Data.loadExecutionPlan(segId);
    if (!seg || !plan) return;
    var slot = plan[slotIndex];
    if (!slot) return;

    _slotEditorSegId = segId;
    _slotEditorSlotIndex = slotIndex;

    $('slot-editor-title').textContent = slotTimeLabel(slotIndex, slot.intervalMinutes);
    renderSlotEditorBody(seg, slot);
    $('slot-editor-overlay').classList.remove('hidden');
  }

  function closeSlotEditor() {
    $('slot-editor-overlay').classList.add('hidden');
    _slotEditorSegId = null;
    _slotEditorSlotIndex = null;
  }

  function renderSlotEditorBody(seg, slot) {
    var itemMap = {};
    (seg.items || []).forEach(function (i) { itemMap[i.id] = i; });

    var bodyEl = $('slot-editor-body');
    if (!slot.assignments || !slot.assignments.length) {
      bodyEl.innerHTML = '<div class="slot-empty-label">No items assigned. Tap + Add item below.</div>';
      return;
    }

    bodyEl.innerHTML = slot.assignments.map(function (a, aIdx) {
      var item = itemMap[a.itemId];
      if (!item) return '';
      var fullName = escHtml((item.brand ? item.brand + ' ' : '') + item.name);
      var label = item.type === 'drink_powder' ? 'Sip ' + fullName
                : a.quantity === 0.5 ? '½ ' + fullName
                : fullName;
      return '<div class="slot-assignment-row" data-assignment-idx="' + aIdx + '">' +
        '<span class="slot-assignment-label">' + label + '</span>' +
        '<div class="slot-assignment-actions">' +
          '<button data-slot-move-idx="' + aIdx + '">Move</button>' +
          '<button data-slot-remove-idx="' + aIdx + '">Remove</button>' +
        '</div>' +
      '</div>';
    }).filter(Boolean).join('');

    // Attach move/remove handlers
    $$('[data-slot-move-idx]', bodyEl).forEach(function (btn) {
      on(btn, 'click', function () {
        var aIdx = parseInt(btn.dataset.slotMoveIdx, 10);
        var plan = Data.loadExecutionPlan(_slotEditorSegId);
        if (!plan) return;
        _slotEditorMoveItemId = plan[_slotEditorSlotIndex].assignments[aIdx];
        openSlotPicker(seg, plan, _slotEditorSlotIndex);
      });
    });

    $$('[data-slot-remove-idx]', bodyEl).forEach(function (btn) {
      on(btn, 'click', function () {
        var aIdx = parseInt(btn.dataset.slotRemoveIdx, 10);
        var plan = Data.loadExecutionPlan(_slotEditorSegId);
        if (!plan) return;
        plan[_slotEditorSlotIndex].assignments.splice(aIdx, 1);
        Data.saveExecutionPlan(_slotEditorSegId, plan);
        refreshSlotEditorAndPanel(_slotEditorSegId, _slotEditorSlotIndex, seg, plan);
      });
    });
  }

  function refreshSlotEditorAndPanel(segId, slotIndex, seg, plan) {
    // Update slot editor body
    renderSlotEditorBody(seg, plan[slotIndex]);
    // Re-render the segment panel in the detail view
    var multiSeg = state.currentEvent && state.currentEvent.segments.length > 1;
    var segEl = document.querySelector('[data-segment-id="' + segId + '"]');
    if (segEl) {
      segEl.outerHTML = segmentSectionHTML(seg, multiSeg);
      reattachSegmentHandlers(segId);
    }
    // Re-open body since re-render collapsed it
    var body = document.querySelector('[data-exec-body="' + segId + '"]');
    if (body) body.classList.remove('hidden');
  }

  function openSlotPicker(seg, plan, fromSlotIndex) {
    var itemMap = {};
    (seg.items || []).forEach(function (i) { itemMap[i.id] = i; });
    var interval = plan[0] ? plan[0].intervalMinutes : 15;

    var pickerBody = $('slot-picker-body');
    pickerBody.innerHTML = plan.map(function (slot, idx) {
      if (idx === fromSlotIndex) return ''; // skip current slot
      var summary = (slot.assignments || []).map(function (a) {
        var item = itemMap[a.itemId];
        return item ? escHtml((item.brand ? item.brand + ' ' : '') + item.name) : '';
      }).filter(Boolean).join(', ') || '—';

      return '<div class="slot-picker-row" data-pick-slot="' + idx + '">' +
        '<span class="slot-picker-time">' + slotTimeLabel(idx, interval) + '</span>' +
        '<span class="slot-picker-summary">' + summary + '</span>' +
      '</div>';
    }).filter(Boolean).join('');

    $$('[data-pick-slot]', pickerBody).forEach(function (row) {
      on(row, 'click', function () {
        var toIdx = parseInt(row.dataset.pickSlot, 10);
        var freshPlan = Data.loadExecutionPlan(_slotEditorSegId);
        if (!freshPlan || !_slotEditorMoveItemId) return;

        // Remove from source slot
        var srcAssignments = freshPlan[_slotEditorSlotIndex].assignments;
        var aIdx = srcAssignments.indexOf(_slotEditorMoveItemId);
        if (aIdx !== -1) srcAssignments.splice(aIdx, 1);

        // Add to destination slot
        freshPlan[toIdx].assignments.push(_slotEditorMoveItemId);

        Data.saveExecutionPlan(_slotEditorSegId, freshPlan);
        _slotEditorMoveItemId = null;

        $('slot-picker-overlay').classList.add('hidden');
        refreshSlotEditorAndPanel(_slotEditorSegId, _slotEditorSlotIndex, seg, freshPlan);
      });
    });

    $('slot-picker-overlay').classList.remove('hidden');
  }

  function openSlotAddItemPicker(seg, slotIndex) {
    var plan = Data.loadExecutionPlan(_slotEditorSegId);
    if (!plan) return;

    // Build remaining quantity map
    var assignedQty = {};
    plan.forEach(function (slot) {
      (slot.assignments || []).forEach(function (a) {
        assignedQty[a.itemId] = (assignedQty[a.itemId] || 0) + a.quantity;
      });
    });

    // Show a simple confirm-style picker using the slot picker sheet (reused)
    var itemMap = {};
    (seg.items || []).forEach(function (i) { itemMap[i.id] = i; });

    var pickerBody = $('slot-picker-body');
    $('slot-picker-sheet').querySelector('.sheet-header span').textContent = 'Add item';

    pickerBody.innerHTML = (seg.items || []).map(function (item) {
      var totalAssigned = assignedQty[item.id] || 0;
      var remaining = Math.round((item.quantity - totalAssigned) * 100) / 100;
      var label = escHtml((item.brand ? item.brand + ' ' : '') + item.name);
      var remainLabel = remaining > 0 ? remaining + ' remaining' : 'fully assigned';

      return '<div class="slot-picker-row" data-add-item-id="' + item.id + '" data-add-item-type="' + item.type + '">' +
        '<span class="slot-picker-time" style="min-width:unset;flex:1">' + label + '</span>' +
        '<span class="slot-picker-summary" style="margin-left:0">' + remainLabel + '</span>' +
      '</div>';
    }).join('');

    $$('[data-add-item-id]', pickerBody).forEach(function (row) {
      on(row, 'click', function () {
        var freshPlan = Data.loadExecutionPlan(_slotEditorSegId);
        if (!freshPlan) return;
        var isBar = row.dataset.addItemType === 'bar';
        freshPlan[slotIndex].assignments.push({
          itemId: row.dataset.addItemId,
          quantity: isBar ? 0.5 : 1
        });
        Data.saveExecutionPlan(_slotEditorSegId, freshPlan);
        $('slot-picker-overlay').classList.add('hidden');
        $('slot-picker-sheet').querySelector('.sheet-header span').textContent = 'Move to slot';
        refreshSlotEditorAndPanel(_slotEditorSegId, slotIndex, seg, freshPlan);
      });
    });

    $('slot-picker-overlay').classList.remove('hidden');
  }
```

- [ ] **Step 2: Wire static sheet close buttons and slot row taps**

In the section of `app.js` where event listeners are set up (near `on($('btn-close-sheet'), ...)`, around line 1110), add:

```js
  on($('btn-close-slot-editor'), 'click', closeSlotEditor);
  on($('btn-close-slot-picker'), 'click', function () {
    $('slot-picker-overlay').classList.add('hidden');
    $('slot-picker-sheet').querySelector('.sheet-header span').textContent = 'Move to slot';
  });
  on($('btn-slot-add-item'), 'click', function () {
    var evt = state.currentEvent;
    if (!evt || _slotEditorSegId === null || _slotEditorSlotIndex === null) return;
    var seg = (evt.segments || []).find(function (s) { return s.id === _slotEditorSegId; });
    if (!seg) return;
    openSlotAddItemPicker(seg, _slotEditorSlotIndex);
  });
```

- [ ] **Step 3: Wire slot row tap in reattachSegmentHandlers**

Inside `reattachSegmentHandlers`, after the copy button handler added in Task 4, add:

```js
    $$('[data-exec-slot]', segEl).forEach(function (row) {
      on(row, 'click', function () {
        var parts = row.dataset.execSlot.split(':');
        openSlotEditor(parts[0], parseInt(parts[1], 10));
      });
    });
```

- [ ] **Step 4: Verify in the browser**

1. Generate a plan on a segment with gels and drink powder.
2. Tap a slot row — confirm the slot editor sheet opens showing assigned items.
3. Tap **Move** on an item — confirm the slot picker opens.
4. Tap a destination slot — confirm the item moves and the panel updates.
5. Tap **Remove** on an item — confirm it is removed from the slot.
6. Tap **+ Add item** — confirm the add picker opens showing items with remaining counts.
7. Tap an item — confirm it is added to the slot.

- [ ] **Step 5: Commit**

```bash
git add app.js
git commit -m "feat: implement slot editor with move, remove, and add item interactions"
```

---

## Self-review checklist

- [x] **Spec coverage:**
  - ✅ Data model: `executionPlan` array with `slotIndex`, `intervalMinutes`, `assignments`
  - ✅ Algorithm: discrete items (gels interleaved, bars halved), liquid as continuous drip
  - ✅ Pre-generation target warning (>15% shortfall)
  - ✅ Post-generation per-slot carb totals
  - ✅ Collapsible panel in segment section
  - ✅ Generate / Regenerate with confirmation
  - ✅ Slot editor: Move, Remove, Add item
  - ✅ Copy button (two-square icon) with clipboard output
  - ✅ Staleness warning on duration/item change
  - ✅ Persistence via localStorage

- [x] **Placeholder scan:** No TBDs, all code blocks complete.

- [x] **Type consistency:**
  - `slotTimeLabel(slotIndex, intervalMinutes)` — defined in Task 3, used in Tasks 3 and 6. ✅
  - `Data.generateExecutionPlan` / `Data.calcSlotCarbs` / `Data.saveExecutionPlan` / `Data.loadExecutionPlan` / `Data.deleteExecutionPlan` / `Data.checkExecutionPlanTarget` — defined and exported in Task 1, used in Tasks 4 and 6. ✅
  - `Export.generateExecutionPlanText` — defined in Task 2, used in Task 4. ✅
  - `refreshSlotEditorAndPanel` — defined and used in Task 6. ✅
  - `_slotEditorMoveItemId` stores the assignment object (not just itemId) — used consistently in Task 6. ✅
