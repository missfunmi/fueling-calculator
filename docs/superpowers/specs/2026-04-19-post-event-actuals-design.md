# Post-Event Actuals — Design Spec
_2026-04-19_

## Overview

Add per-segment post-event tracking to the event detail view. For any event dated today or earlier, the user can log actual duration and fuel items consumed per segment, add a free-text reflection note for the whole event, and see planned vs actual totals in the summary cards.

**Constraints:**
- No distance tracking (deferred — would be added to both plan and actuals when implemented)
- Single event-level notes box (not per-segment)
- Post-event section only visible/editable for events dated today or earlier
- No explicit save button — auto-saves on change, consistent with the rest of the app
- JSONB storage for actuals (simple, minimal schema change; normalization deferred to future migration if analytics are needed)

---

## Data Model

### New columns on `events` table

```sql
ALTER TABLE events ADD COLUMN post_event_notes TEXT;
ALTER TABLE events ADD COLUMN actuals JSONB DEFAULT NULL;
```

### `actuals` JSONB shape

Keyed by segment UUID. Items use the same snapshot pattern as planned items — values captured at log-time, `productId` nullable for one-offs.

```json
{
  "seg-uuid-1": {
    "durationHours": 3.1,
    "items": [
      {
        "id": "uuid",
        "productId": "uuid-or-null",
        "name": "Maurten C-160",
        "brand": "Maurten",
        "type": "drink_powder",
        "carbsPerUnit": 160,
        "sodiumPerUnit": 290,
        "caffeinePerUnit": 0,
        "quantity": 3
      }
    ]
  },
  "seg-uuid-2": {
    "durationHours": 1.5,
    "items": []
  }
}
```

Content inside `actuals` uses camelCase throughout (stored as JSONB, only accessed by the JS app — no snake_case conversion needed for the nested values).

### JS event object additions

```js
{
  // existing fields...
  postEventNotes: '',   // maps to post_event_notes column
  actuals: {}           // pass-through from JSONB column; {} when null/absent
}
```

### Invariants

- `actuals` keys are segment UUIDs — O(1) lookup per segment
- Items inside actuals are fully snapshotted (same invariant as planned items: editing/deleting a library product never affects logged actuals)
- `save_event` RPC does not touch `post_event_notes` or `actuals` — plan edits never clobber actuals
- Actuals for a segment are pre-populated from that segment's planned items on first open (same items, same quantities) — user adjusts from there

---

## Architecture

```
Browser
  └── app.js renderDetail()
        ├── shows planned segment (read-only item list) for reference
        ├── shows ACTUAL subsection per segment (duration + items, editable)
        └── shows post-event notes textarea at bottom

  └── data.js saveActuals()
        └── PATCH /events?id=eq.ID  { actuals, post_event_notes }
```

Actuals save separately from the plan via a lightweight PATCH — no RPC needed since it's a single-row update with no multi-table atomicity requirement.

---

## UI/UX

### Visibility rule

Post-event UI (actual subsections + notes textarea) is shown only when `event.date ≤ today`. Future events show no actuals UI.

### Summary cards

When actuals exist, each card shows planned → actual:

```
Carbs              Sodium             Caffeine
480g → 535g        2400mg → 1170mg    0mg
90/hr → 89/hr      450/hr → 195/hr    0/hr
```

If no actuals are logged yet, cards show planned only (no change from current behaviour).

### Per-segment layout

Each segment in the event detail gains an ACTUAL subsection directly below its existing planned content:

```
─── Bike (planned) ──────────────────────────────
  🎯 90g carbs/hr  600mg Na/hr
  ████████░ Carbs  85/hr
  ██████░░░ Sodium 450/hr
  · Maurten C-160      ×3
  · Maurten Gel 100    ×6

─── ACTUAL ──────────────────────────────────────
  Duration  [3.1h]
  · Maurten C-160      − 3 +
  · Maurten Gel 100    − 1 +
  · Coke 500ml         − 1 +    (one-off)
  + Add item
```

- Planned section: read-only in post-event context. Targets and progress bars remain visible; item quantities are not editable from the actual subsection (plan is unchanged).
- Actual duration: inline-editable on tap, same pattern as existing segment duration field. Saves on blur.
- Actual items: same stepper UI as planned items. Quantity changes auto-save.
- "+ Add item": opens the existing add-item bottom sheet (Library + One-off tabs), same as on the plan. Items added here go into `actuals[segmentId].items`.
- One-off items in actuals are visually distinguished (amber tint, "one-off" label) — same visual treatment already used in the add-item sheet.

### First open (no actuals yet)

When the user first views the actual subsection for a segment with no logged actuals, it is pre-populated with the segment's planned items (same names, brands, nutrient values, quantities). The user adjusts from there rather than starting from a blank list. This pre-population writes to `event.actuals` immediately (auto-save).

### Event-level notes

A textarea at the very bottom of the event detail view, below all segments. Shown only for past/today events. Saves on blur. Placeholder: "What worked, what didn't…"

### No explicit save button

Consistent with how the rest of the app handles inline edits.

---

## Calculations

Three new functions in `data.js`:

```js
// Totals for one segment's actuals
calcActualSegmentTotals(actualSegment)
// → { carbs, sodium, caffeine }
// Same logic as calcSegmentTotals but operates on actualSegment.items

// Per-hour rates for one segment's actuals
calcActualSegmentRates(actualSegment)
// → { carbs, sodium, caffeine }
// Divides totals by actualSegment.durationHours (fallback to 1)

// Totals across all segments' actuals
calcActualEventTotals(event)
// → { carbs, sodium, caffeine, durationHours }
// Sums across event.actuals values
```

No `rateStatus` colouring for actuals — actual values are shown as plain numbers, not compared against targets.

---

## API Layer (`data.js`)

### `dbToEvent` update

```js
function dbToEvent(row) {
  return {
    // ...existing fields...
    postEventNotes: row.post_event_notes || '',
    actuals:        row.actuals || {}
  };
}
```

### `eventToDb` update

```js
function eventToDb(evt) {
  return {
    // ...existing fields...
    post_event_notes: evt.postEventNotes || null
    // actuals not included — saved separately via saveActuals()
  };
}
```

### New: `saveActuals(eventId, actuals, postEventNotes)`

```js
async function saveActuals(eventId, actuals, postEventNotes) {
  await supabaseRequest(
    'PATCH',
    'events?id=eq.' + eventId,
    { actuals: actuals, post_event_notes: postEventNotes || null },
    'return=minimal'
  );
}
```

---

## Files Changed

| File | Change |
|---|---|
| `data.js` | `dbToEvent` + `eventToDb` updated; `saveActuals` added; `calcActualSegmentTotals`, `calcActualSegmentRates`, `calcActualEventTotals` added |
| `app.js` | `renderDetail` updated to render actual subsections + notes textarea; new actuals auto-save handlers; `addActualItemToSegment`; summary card update |
| `style.css` | Actual subsection styles; planned→actual summary card layout |
| Supabase | 2 `ALTER TABLE` statements (run in SQL editor) |

---

## Future: Migration to Normalized Tables

If analytics or multi-user aggregate queries become useful, `actuals` JSONB can be migrated to:
- `segment_actuals(id, segment_id, duration_hours)` — requires changing `save_event` RPC to upsert segments rather than delete+reinsert, so `segment_id` FKs survive plan edits
- `actual_items(id, segment_actual_id, ...)` — mirrors the `items` table structure

No app-level interface changes would be needed — only `data.js` would change.

---

## Out of Scope

- Distance tracking (deferred — add to both plan and actuals together)
- Per-segment notes (one event-level notes box only)
- Comparison charts or visualisations
- Editing actuals for future events
