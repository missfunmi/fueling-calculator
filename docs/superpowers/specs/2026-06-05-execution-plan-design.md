# Execution Plan Feature — Design Spec
_Date: 2026-06-05_

## Overview

Auto-generate a timed execution plan for each segment of a fueling event. The plan breaks the segment's planned items into 15-minute interval slots, distributing items evenly so the hourly carb target is met. Users can adjust the generated plan by moving items between slots.

---

## Data Model

Each segment gains an `executionPlan` field — an array of slot objects, one per 15-minute interval:

```js
segment.executionPlan = [
  {
    slotIndex: 0,           // 0-based; slot 0 = 0:00–0:15
    intervalMinutes: 15,    // stored for self-documentation; default 15
    assignments: [
      { itemId: "abc123", quantity: 0.5 }
    ]
  },
  // ... ceil(durationHours * 60 / 15) entries total
]
```

- `itemId` references an item in `segment.items`. Orphaned references (item deleted after plan generated) are silently skipped at render time.
- Slots with no assignments are stored with `assignments: []` so the full timeline is always present.
- Slot count = `ceil(durationHours * 60 / 15)`. A 3.5-hour segment = 14 slots.
- `executionPlan` is persisted to the database alongside the segment. Manual edits survive across sessions.

---

## Auto-Generation Algorithm

Triggered by the "Generate" button. Always replaces the full `executionPlan` array (manual edits are wiped — user confirms before regenerating).

**Steps:**

1. **Calculate slots** — create `ceil(durationHours * 60 / 15)` empty slots.

2. **For each item in `segment.items`:**
   - Determine distributable units:
     - **Bars**: split into half-unit increments (quantity 2 = 4 × 0.5 assignments)
     - **All other types** (gel, drink powder, etc.): use whole units
   - Space assignments evenly across slots using floor-based indexing:
     `slotIndex = floor(i * slotCount / totalUnits)` for unit `i`
   - If units exceed slots, multiple assignments stack in the same slot.

3. **Caffeinated vs non-caffeinated gels**: when both types exist in a segment, interleave them in alternating slots rather than distributing each independently. The auto-generator treats them as a unified gel pool and assigns caf/non-caf alternately.

4. **Drink powder**: distributed as evenly-spaced sip reminders, same algorithm as gels. Not placed at every slot.

5. **Conflicts**: multiple items in the same slot are fine — the slot renders all of them.

---

## UI Layout

### Collapsed state (default, below segment items)

```
▶ Execution plan                    [Generate]
```

After generation, `[Generate]` becomes `[Regenerate]`.

### Expanded state

```
▼ Execution plan                 [Regenerate]

  0:15  Gel (non-caf) · Superfuel sip
  0:30  Gel (caf) · water
  0:45  Superfuel sip
  1:00  Gel (non-caf) · Superfuel sip
  1:15  Gel (caf)
  1:30  Superfuel sip
  1:45  ½ Bar · water
  2:00  Gel (non-caf)
  ...
```

- Each row shows `offset → items` format matching the user's familiar plan style.
- Empty slots render as `1:15  —` and are tappable (to add items).
- Tapping any slot opens the slot editor bottom sheet.

### Slot editor bottom sheet

```
── 1:45 ──────────────────────────────
  ½ Maurten bar        [Move] [Remove]
  Superfuel sip        [Move] [Remove]

  + Add item
```

- **Move** → opens a slot picker listing all other slots with a brief summary of their current contents (e.g. "0:30 — Gel (caf), Superfuel sip"). Selecting a slot moves the item there.
- **Remove** → removes the assignment; item becomes available again in the Add picker.
- **+ Add item** → shows items from `segment.items` with remaining unassigned quantity noted (e.g. "Gel (caf) — 1 remaining"). Tapping adds one unit to this slot.

### Regenerate confirmation

When the user taps `[Regenerate]` and a plan already exists:

> "Regenerate plan? Any manual edits will be replaced."
> [Cancel] [Regenerate]

---

## Persistence

`executionPlan` is saved to the database as part of the segment. The save path follows the existing event save flow — no new save triggers needed; it's included when the event is next saved.

On load, if `executionPlan` is absent (old events, or never generated), the panel shows the collapsed state with only `[Generate]`.

---

## Edge Cases

- **Duration change after plan generated**: slot count may no longer match. The panel shows a warning: "Segment duration changed — plan may be out of date." User can regenerate.
- **Item added/removed after plan generated**: same warning. Orphaned `itemId` references are skipped silently; new items won't appear in the plan until regeneration.
- **Single-slot segments** (< 15 min): all items land in slot 0. Plan still generates correctly.
- **Item quantity = 0**: skipped during generation.

---

## Out of Scope (this iteration)

- Diff-aware regeneration (preserving manual edits across regeneration)
- Configurable interval size (15 min is fixed for now)
- Execution plan tracking during the event (marking items as consumed)
- Exporting the execution plan separately from the full event plan
