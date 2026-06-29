# Multi-Day Events — Design Spec
_2026-06-28_

## Overview

Add support for multi-day events (e.g. bikepacking trips, training camps, vacations). Any event type can be designated multi-day via a new Category field. Multi-day events have a start and end date, each segment carries its own date, and the past-events cutoff uses the end date instead of the start date.

---

## New Event Types

Add `vacation` and `training_camp` to `EVENT_TYPE_LABELS`:

```js
vacation:      'Vacation',
training_camp: 'Training Camp',
```

These are exposed in the Type dropdown alongside the existing types. No special multi-day semantics are tied to type — category drives that independently.

---

## Data Model Changes

### Event

Two new fields:

| Field | Type | Default | Notes |
|---|---|---|---|
| `category` | `"single"` \| `"multi"` | `"single"` | Drives all multi-day UI and logic |
| `endDate` | `"YYYY-MM-DD"` \| `""` | `""` | Only meaningful when `category === "multi"` |

### Segment

One new field:

| Field | Type | Default | Notes |
|---|---|---|---|
| `date` | `"YYYY-MM-DD"` \| `""` | event `date` | Only shown/used when parent event is multi-day |

### DB

Migration file: `migrations/0001_multi_day_events.sql`

```sql
ALTER TABLE events  ADD COLUMN IF NOT EXISTS end_date text;
ALTER TABLE segments ADD COLUMN IF NOT EXISTS date text;
```

**Existing rows:** both columns default to `NULL`, which `dbToEvent` maps to `""` via the existing `|| ''` fallback pattern. Existing events deserialize as single-day with no end date and no segment dates — no backfill required, no visible change for existing data.

The `save_event` RPC and `dbToEvent` / `eventToDb` mappings are updated to pass `end_date` and segment `date` through.

---

## Create / Edit Event Form

### Layout

```
[Name                              ]
[Category          ] [Type         ]
[Start date        ] [— End date   ]   ← end date only when multi-day
[Notes                             ]
[Segments …]
```

- **Category** is a `<select>` with options `Single-day` / `Multi-day`, placed in the same row as Type.
- **Date** row is always present and full-width by default. When multi-day is selected, the end date input fades/slides in within the same row (no row height change, no layout jump above or below).
- Switching from multi-day back to single-day hides the end date input and clears its value.

### Behaviour

- On load for an existing multi-day event, both date inputs are populated and the end date is visible.
- End date must be ≥ start date (client-side validation on save; show inline error if violated).
- Adding a new segment while in multi-day mode pre-fills that segment's date to the event start date.

---

## Event Cards (Events List)

- Single-day: `06/08/2026` (unchanged).
- Multi-day: `06/08/2026 — 06/09/2026`.

---

## Past / Upcoming Split

```js
// single-day
isPast = evt.date && evt.date < today;

// multi-day
isPast = evt.endDate && evt.endDate < today;
```

A multi-day event remains in **Upcoming** until its end date has passed.

---

## Segment Date Field

Shown **only on multi-day events**, in both the create/edit form and the populate-fuel (actuals) view.

### Position in segment card

```
[Date          ] [Duration    ]
[Carbs/hr] [Na/hr] [Caff/hr  ]
```

- Native `<input type="date">` pre-filled to the event start date when a segment is created.
- Fully text-editable and calendar-pickable (standard date input behaviour).
- When an event is switched from multi-day to single-day, segment date fields are hidden; stored values are preserved in the data model but ignored.

---

## Populate Fuel (Actuals) View

- Category and end date are display-only (no editing needed in actuals).
- Segment date field appears (and is editable) for multi-day events, in the same position as in the edit form.

---

## What Is Not Changing

- Single-day event behaviour is fully unchanged.
- The existing event types (ride, run, triathlon, swim, other) are unchanged.
- Past-event logic for single-day events is unchanged.
- Segment date values for single-day events are not written or read.
