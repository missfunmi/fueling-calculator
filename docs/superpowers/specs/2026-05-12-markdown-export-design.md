# Markdown Export — Design Spec
_2026-05-12_

## Overview

Add a "Copy plan" button to the event detail page that copies a clean markdown representation of the full fuel plan to the clipboard. The output includes planned segments with targets, items, totals, and rates, plus an optional actuals section at the bottom that can be deleted before sharing. No server involvement — pure client-side generation.

---

## Markdown Output Format

### Structure

```
# {Event Name}
{Event Type} · {Date}

## Planned

### {Segment Name} ({duration})
**Targets:** {X}g carbs/hr · {X}mg Na/hr[ · {X}mg caff/hr]

| Item | Qty | Carbs | Sodium | [Caffeine] |
|------|-----|-------|--------|[-----------|]
| {Brand} {Name} | {qty} | {Xg} | {Xmg} | [{Xmg}] |

**Totals:** {X}g carbs · {X}mg Na[ · {X}mg caffeine]
**Rates:** {X}g carbs/hr · {X}mg Na/hr[ · {X}mg caffeine/hr]

### {Segment 2 Name} ({duration})
...

---

## Actual

### {Segment Name} (actual: {duration})

| Item | Qty | Carbs | Sodium | [Caffeine] |
|------|-----|-------|--------|[-----------|]
| {Brand} {Name} | {qty} | {Xg} | {Xmg} | [{Xmg}] |

**Totals:** {X}g carbs · {X}mg Na[ · {X}mg caffeine]
**Rates:** {X}g carbs/hr · {X}mg Na/hr[ · {X}mg caffeine/hr]

*{Post-event notes}*
```

### Rules

- **Caffeine** — the caffeine column in item tables and caffeine in Totals/Rates lines are included only if at least one item in that segment has `caffeinePerUnit > 0` or the segment target has `caffeinePerHour > 0`. Omitted entirely if neither applies, to reduce noise for plans that don't use caffeine.
- **Actuals section** — the `---` separator, `## Actual` heading, and all actual segment blocks are omitted entirely if `Object.keys(evt.actuals).length === 0`. This avoids an empty section for events that haven't had post-event data logged.
- **Post-event notes** — the italicised notes line is omitted if `evt.postEventNotes` is empty or null.
- **Rates in Planned** — calculated from `calcSegmentRates(seg)`: carbs, sodium, caffeine per hour based on items and segment duration. No comparison to targets, no status indicators. Targets are shown on their own line directly above the table; rates are on their own line below totals — the reader can compare them directly.
- **Rates in Actual** — calculated from `calcActualSegmentRates(actualSeg)` using the actual segment's `durationHours`. Only shown if `actualSeg.durationHours` is a positive number (i.e. duration was logged). If null or zero, the Rates line is omitted for that segment.
- **Item display** — brand and name concatenated as `{brand} {name}` (brand omitted if empty). Contributed totals per item are `carbsPerUnit × quantity`, `sodiumPerUnit × quantity`, `caffeinePerUnit × quantity`.
- **Single-segment events** — same structure; `## Planned` heading still present for consistency with multi-segment events.
- **Notes** — the event's pre-event `notes` field is not included.

### Concrete Example

```markdown
# Ironman Wales 2025
Ride · 2026-07-26

## Planned

### Bike (5:00)
**Targets:** 90g carbs/hr · 700mg Na/hr

| Item | Qty | Carbs | Sodium |
|------|-----|-------|--------|
| SiS Beta Fuel | 2 | 160g | 0mg |
| Maurten Gel 100 | 4 | 100g | 0mg |

**Totals:** 260g carbs · 0mg Na
**Rates:** 52g carbs/hr · 0mg Na/hr

### Run (3:30)
**Targets:** 60g carbs/hr · 400mg Na/hr

| Item | Qty | Carbs | Sodium |
|------|-----|-------|--------|
| Maurten Gel 100 | 3 | 75g | 0mg |

**Totals:** 75g carbs · 0mg Na
**Rates:** 21.4g carbs/hr · 0mg Na/hr

---

## Actual

### Bike (actual: 5:12)

| Item | Qty | Carbs | Sodium |
|------|-----|-------|--------|
| SiS Beta Fuel | 2 | 160g | 0mg |

**Totals:** 160g carbs · 0mg Na
**Rates:** 30.8g carbs/hr · 0mg Na/hr

### Run (actual: 3:45)

| Item | Qty | Carbs | Sodium |
|------|-----|-------|--------|
| Maurten Gel 100 | 2 | 50g | 0mg |

**Totals:** 50g carbs · 0mg Na
**Rates:** 13.3g carbs/hr · 0mg Na/hr

*Legs felt great until km 30. Needed more sodium on the run.*
```

---

## Files Changed

| File | Change |
|---|---|
| `export.js` | New file — `Export.generateEventMarkdown(evt)` wrapped in IIFE writing to `window.Export` |
| `index.html` | `<script src="export.js">` added before `app.js` |
| `app.js` | `formatHM` added to `window._App`; "Copy plan" button rendered in `renderDetail`; click handler wired in `init()` |

---

## `export.js`

### Public API

```js
window.Export = {
  generateEventMarkdown: generateEventMarkdown
};
```

### `generateEventMarkdown(evt)`

Pure function. Takes an event object (same shape returned by `Data.getEvent`). Returns a markdown string. No network calls, no DOM access, no side effects.

**Dependencies read from globals:**
- `window.Data.calcSegmentTotals(seg)` → `{ carbs, sodium, caffeine }`
- `window.Data.calcSegmentRates(seg)` → `{ carbs, sodium, caffeine }`
- `window.Data.calcActualSegmentTotals(actualSeg)` → `{ carbs, sodium, caffeine }`
- `window.Data.calcActualSegmentRates(actualSeg)` → `{ carbs, sodium, caffeine }`
- `window._App.fmt(n, unit)` → formatted number string
- `window._App.formatHM(hours)` → `"1h45m"` display string
- `window._App.EVENT_TYPE_LABELS` → `{ ride: 'Ride', ... }`
- `window._App.TYPE_LABELS` → `{ gel: 'Gel', ... }` (available but not used in the current output)

### Internal helpers

**`segmentHasCaffeine(seg)`** — returns true if `seg.targets.caffeinePerHour > 0` or any `seg.items[i].caffeinePerUnit > 0`.

**`actualSegHasCaffeine(actualSeg)`** — same check for an actual segment's items.

**`itemContributions(item)`** — returns `{ carbs, sodium, caffeine }` contributed totals for a single item (`perUnit × quantity`).

**`plannedSegmentMd(seg)`** — builds the `### Segment (duration)` block for a planned segment.

**`actualSegmentMd(seg, actualSeg)`** — builds the `### Segment (actual: duration)` block. `seg` is the planned segment (for the name); `actualSeg` is the actual data.

---

## `app.js` Changes

### `window._App` — add `formatHM`

```js
window._App = {
  // existing...
  formatHM: formatHM
};
```

### "Copy plan" button in `renderDetail`

Rendered inside `detail-body` at the bottom of the planned content — after the totals footer (multi-segment) or after the last segment (single-segment), and before the start-actuals / actuals UI. Uses existing `btn-secondary` class.

```html
<button id="btn-copy-plan" type="button" class="btn-secondary" style="margin-top:16px">Copy plan</button>
```

The button is always rendered (not conditional on actuals state) since it exports the full event regardless.

### Click handler in `init()`

```js
on($('btn-copy-plan'), 'click', function () {
  var md = Export.generateEventMarkdown(state.currentEvent);
  navigator.clipboard.writeText(md).then(function () {
    showToast('Plan copied!');
  }).catch(function () {
    showToast("Couldn't copy — try again.");
  });
});
```

`state.currentEvent` is set by `renderDetail` before handlers fire, so it is always current.

---

## Out of Scope

- Native share sheet (`navigator.share`) — deferred until events have persistent URLs
- Download as `.md` file
- Exporting multiple events at once
- Including pre-event notes
- Event-level aggregate totals (only per-segment totals are shown)
- PDF or any other format
