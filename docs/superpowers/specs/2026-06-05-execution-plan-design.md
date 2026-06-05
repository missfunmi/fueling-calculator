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

### Pre-generation target check

Before generating, calculate the plan's projected carb delivery:
`projectedCarbsPerHour = sum(item.carbsPerUnit * item.quantity) / segment.durationHours`

If `projectedCarbsPerHour` is more than 15% below `segment.targets.carbsPerHour`, show a warning:

> "This plan delivers ~85g/hr carbs against a 100g/hr target. Consider adding more items before generating."
> [Cancel] [Generate anyway]

Generation proceeds if the user confirms or if the shortfall is within 15%.

### Item classification

Items are classified before distribution:

- **Liquid (drink powder)**: distributed continuously across all slots as fractional carb delivery — see step 3 below.
- **Bars**: distributed as half-unit discrete assignments.
- **All other discrete items** (gels, etc.): distributed as whole-unit assignments.

### Steps

1. **Calculate slots** — create `ceil(durationHours * 60 / 15)` empty slots.

2. **Discrete items** (gels, bars):
   - Bars: split into half-unit increments (quantity 2 = 4 × 0.5 assignments).
   - Gels: use whole units. If both caffeinated and non-caffeinated gels exist, treat them as a unified gel pool and interleave caf/non-caf alternately when assigning slots.
   - Space assignments evenly using floor-based indexing:
     `slotIndex = floor(i * slotCount / totalUnits)` for unit `i`
   - If units exceed slots, multiple assignments stack in the same slot.

3. **Liquid items** (drink powder):
   - Treat as a continuous drip across the full segment — one sip cue per slot.
   - Sip volume per slot = `totalVolumeOz / slotCount` (approximately 6–8 oz per slot for a standard 26 oz bottle over 3–3.5 hours, matching ~2 real sips).
   - Carbs per slot = `item.carbsPerUnit * item.quantity / slotCount` (fractional, rounded to 1 decimal for display).
   - Stored as a single assignment per slot: `{ itemId, quantity: 1/slotCount }` — quantity represents the fraction of the total consumed at this slot.
   - Display label: "Sip [item name] (~Xg carbs)".

4. **Conflicts**: multiple items in the same slot are fine — the slot renders all of them.

### Post-generation slot carb totals

Each slot's carb contribution is calculated at render time:
`slotCarbs = sum(assignment.quantity * item.carbsPerUnit for each assignment)`

Displayed inline on each slot row (e.g. `0:30  Gel (caf) · Superfuel sip  ~47g`). This lets the user sanity-check the per-slot rhythm at a glance.

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

  0:15  Gel (non-caf) · Superfuel sip         ~47g
  0:30  Gel (caf) · Superfuel sip             ~47g
  0:45  Superfuel sip                         ~14g
  1:00  Gel (non-caf) · Superfuel sip         ~47g
  1:15  Gel (caf) · Superfuel sip             ~47g
  1:30  Superfuel sip                         ~14g
  1:45  ½ Bar · Superfuel sip                 ~39g
  2:00  Gel (non-caf) · Superfuel sip         ~47g
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
- **Hourly target significantly exceeded by planned items**: no warning — over-fueling is caught by the existing segment progress indicators, not the execution plan generator.
- **Liquid item with no volume data**: fall back to distributing as a discrete item (evenly spaced sip cues, no per-slot carb estimate shown).

---

## Out of Scope (this iteration)

- Diff-aware regeneration (preserving manual edits across regeneration)
- Configurable interval size (15 min is fixed for now)
- Execution plan tracking during the event (marking items as consumed)
- Exporting the execution plan separately from the full event plan
