# Fueling Calculator — Design Spec
_2026-04-17 · updated 2026-04-18_

## Overview

A responsive static web app for planning nutrition across endurance events. The user builds a plan by assembling products (gels, bars, drink powders) into segments of an event, watching totals update in real time against per-hour targets. Plans persist in localStorage.

The layout adapts to screen size: on mobile it follows phone conventions (bottom tab bar, full-width content); on desktop it uses a sticky top nav bar with content centred at a comfortable reading width.

---

## Architecture

**Tech stack:** Vanilla HTML/CSS/JS, no dependencies, no build step.

**Files:**
- `index.html` — app shell and view templates
- `style.css` — responsive styles, CSS custom properties; single `@media (min-width: 768px)` breakpoint separates mobile and desktop layouts
- `app.js` — UI logic, state management, event handlers
- `data.js` — localStorage read/write, all data model operations

**Deployment:** Drop the four files onto any static host. Works on GitHub Pages, Netlify, or any personal website.

**Future path:** When moving to a Postgres backend, `data.js` is the only file that changes — the rest of the app is unaware of the storage layer.

---

## Data Model

All data stored in localStorage under two keys: `fuelPlanner.products` and `fuelPlanner.events`.

### Product (library item)

```json
{
  "id": "uuid",
  "brand": "Maurten",
  "name": "C-160",
  "type": "drink_powder",
  "carbsPerUnit": 160,
  "sodiumPerUnit": 290,
  "caffeinePerUnit": 0
}
```

**Product types:** `bar` | `gel` | `drink_powder` | `liquid` | `chew`

### Event

```json
{
  "id": "uuid",
  "name": "70.3 Triathlon",
  "date": "2026-05-10",
  "type": "triathlon",
  "notes": "",
  "segments": [
    {
      "id": "uuid",
      "name": "Bike",
      "durationHours": 3,
      "targets": {
        "carbsPerHour": 110,
        "sodiumPerHour": 600,
        "caffeinePerHour": 0
      },
      "items": [
        {
          "id": "uuid",
          "productId": "uuid-or-null",
          "name": "Maurten 320",
          "brand": "Maurten",
          "type": "drink_powder",
          "carbsPerUnit": 80,
          "sodiumPerUnit": 400,
          "caffeinePerUnit": 0,
          "quantity": 3
        }
      ]
    },
    {
      "id": "uuid",
      "name": "Run",
      "durationHours": 1.5,
      "targets": {
        "carbsPerHour": 65,
        "sodiumPerHour": 400,
        "caffeinePerHour": 0
      },
      "items": []
    }
  ]
}
```

**Key invariants:**
- Items snapshot all product values at the time of adding. Editing or deleting a library product never modifies existing event items.
- `productId: null` for one-off items not saved to the library.
- Single-sport events have exactly one segment; the segment label is hidden in the UI when there is only one.

**Event types:** `ride` | `run` | `triathlon` | `swim` | `other`

---

## Tracked Nutrients

Carbohydrates (g), sodium (mg), caffeine (mg). No others.

---

## Calculations

For each segment:
- **Total per nutrient** = sum of (quantity × perUnit) across all items
- **Per-hour rate** = total ÷ segment durationHours
- **Progress status** = actual per-hour rate vs segment target per-hour rate
  - Green: within ±10% of target
  - Amber: 10–25% under or over
  - Red: >25% under or over, or target is 0 and actual > 0

For the event:
- **Event totals** = sum of segment totals (displayed quietly at bottom, no colour coding)
- **Weighted average per-hour** = sum of segment totals ÷ total event duration (shown in top summary cards)

---

## Screens & Navigation

### Navigation — desktop (≥ 768px)

Sticky top nav bar spanning the full viewport width:
- **Left:** "Fueling Calculator" text logo
- **Right:** text links — Events · Library · + New Event button (accent-coloured pill)

Active tab link is highlighted. The nav bar is always visible; per-view headers are hidden on the Events and Library list views since the nav bar provides context. Sub-views (Event Detail, Create/Edit Event, Product Form) retain their own header below the nav bar for back-navigation and inline editing.

Content is centred at `max-width: 900px` with `40px` horizontal padding.

### Navigation — mobile (< 768px)

Fixed bottom tab bar with two text-only labels: **Events** and **Library**. No icons. Active tab uses accent colour and semi-bold weight. Per-view headers (white background, dark text, 1px bottom border) appear at the top of each view.

### App headers (all screen sizes)

White background, dark text, 1px bottom border. The back arrow uses accent colour. Action buttons ("+", edit, delete) use a subtle grey pill background; the delete button uses red text.

### Events list (home)

- List of saved events sorted by date descending
- Each row: event name, type badge, date, total duration, total carbs and sodium
- "+ New Event" button (top nav on desktop; "+" in view header on mobile) to create a new event
- Tap a row to open Event Detail

### Event Detail

**Header:** Event name (tappable to edit inline), back arrow. Type badge and date shown below the header.

**Summary cards (top):** Three metric cards — carbs, sodium, caffeine. Each shows:
- Total across all segments
- Weighted average per-hour rate
- No colour coding — targets are per-segment, so colour lives only in the segment sections below

**Segment sections:** For each segment (labelled only if >1 segment):
- Segment name and duration (tappable to edit inline)
- Per-hour targets shown inline, tappable to edit
- Progress bars for carbs/sodium/caffeine vs segment target
- **Segment totals line:** plain text showing absolute totals for that segment (e.g. `320g carbs · 1200mg Na · 3h`), displayed below the progress bars with no colour coding
- Item list: each item shows brand + name, type, per-unit breakdown, and a − qty + stepper with large touch targets
- "+ Add item" button

**Totals footer (multi-segment events only):** Plain text, no colour. e.g.:
> Totals — 640g carbs · 4800mg Na · 150mg caffeine · 4.5h

### Create / Edit Event

Accessed via "+" on the events list or the edit icon on the event header.

**Required:** Name only.

**Defaults:**
- Duration: 1 hour
- Targets: 80g carbs/hr, 500mg Na/hr, 0mg caffeine/hr
- One segment named the same as the event

**Optional fields** (all editable inline later): date, event type, notes.

Segments can be added, reordered, and deleted on this screen. Deleting a segment with items prompts for confirmation.

### Add Item Sheet

Bottom sheet, two tabs:

**Library tab:**
- Search bar filtering by name, brand, or type
- Last 5 recently used products surfaced at top (tracked by last-use timestamp)
- Tap a product to add it to the segment with quantity 1
- Quantity adjustable immediately after adding; no separate confirmation step

**One-off tab:**
- Fields: name, brand (optional), type, carbs/unit, sodium/unit, caffeine/unit
- "Save to library" toggle (off by default)
- Tap "Add" to insert directly into segment

### Product Library

Accessible via Library tab. Products grouped by type.

- Tap a product to edit it (name, brand, type, values)
- Swipe to delete — removes from library only, does not affect any event items
- UI note on edit screen: "Changes won't update existing plans"
- "+ New product" opens the same form with "save to library" pre-checked
- On desktop, where the Library view header is hidden, a "+ New Product" button is rendered at the top of the product list instead

---

## UX Principles

- **Minimal required input to get started** — create an event with a name only; everything else has defaults
- **Inline editing** — segment name, duration, and targets editable directly on the event detail screen without navigation
- **One tap to add** — tap a library product and it appears in the segment immediately at qty 1
- **Recently used products first** — library add sheet surfaces the last 5 products used (by last-use timestamp, stored in `fuelPlanner.recentProducts`); recently used products are excluded from the main all-products list to avoid duplicates
- **Large touch targets** — +/− steppers are at minimum 44px tap targets; form inputs have `min-height: 48px` on mobile
- **No confirmation dialogs for reversible actions** — quantity changes, adding items are instant; confirmations only for deletes
- **Responsive, not adaptive** — a single CSS breakpoint at 768px shifts navigation and layout; content components (cards, progress bars, item rows) are identical on all screen sizes
- **Platform-appropriate navigation** — desktop uses a top nav bar (standard web); mobile uses a bottom tab bar (standard phone); sub-view navigation (back arrow, inline edit) is consistent across both

---

## Persistence

All data in localStorage. No accounts, no sync, no server.

`data.js` exposes a simple interface:
- `getProducts()` / `saveProduct(p)` / `deleteProduct(id)`
- `getEvents()` / `saveEvent(e)` / `deleteEvent(id)`
- `getRecentProducts()` / `recordProductUsed(id)` — maintains `fuelPlanner.recentProducts` as an array of up to 5 productIds ordered by last-use timestamp; stale ids (deleted products) are filtered out on read

When migrating to Postgres later, only `data.js` changes.

---

## Out of Scope (v1)

- User accounts / sync across devices
- Export / share plans
- Scheduling nutrition timing within a segment (e.g. "take gel at 45min mark")
- Integration with Garmin / Strava
- Imperial/metric unit toggle (grams and mg throughout)
