# Portioned Meals — Design Spec
**Date:** 2026-09-19

## Problem

Users batch-cook (e.g. a rice stir-fry making 4 portions) and need to log
each serving as they eat it over subsequent days. The current flow requires
re-entering everything each time, or keeping macros offline.

## Solution

Batch meals live in the **food log**, not the library. When a batch is
created it is assigned a `batch_id` UUID. The first serving is logged
immediately with per-serving macros. Subsequent servings are re-logged
from an "Active batches" section or from a "↻ Log serving today" button on
the original timeline entry.

## Data model additions (food_logs)

| Column | Type | Description |
|---|---|---|
| `batch_id` | UUID | Groups all servings of a batch. Set on origin + re-logs. |
| `batch_total` | INT | How many portions the batch was divided into. Origin entry only. |
| `batch_remaining` | INT | Servings still to be logged. Decremented on re-log. Origin entry only. |
| `batch_discarded` | BOOLEAN | Set true when user dismisses remaining servings. Origin entry only. |

Re-log entries have `batch_id` set (for grouping) but `batch_total` and
`batch_remaining` null.

## UX flows

### Day 1 — creating a batch
1. User opens Log Meal → Describe mode.
2. Types full recipe including "makes 4 portions", taps Calculate.
3. "Servings this makes" field appears below Name in the macros block (amber tint).
4. Per-serving preview row shows live-computed per-serving macros.
5. Save button reads "Log 1 of 4 servings".
6. On save: macros are divided by N, origin log entry is created with
   `batch_total = 4`, `batch_remaining = 3`, `batch_id = <uuid>`.

### Subsequent days — re-logging
1. "Active batches" section appears at the top of the food log for any batch
   with `batch_remaining > 0` and `batch_discarded = false`.
2. User taps "↻ Log" → serving picker bottom sheet opens.
3. Picker shows: ½×, 1×, 1½×, 2×, custom multiplier chips + live macro
   preview + category picker + "Log serving" button.
4. On confirm: new log entry created (macros scaled by multiplier), origin
   entry `batch_remaining` decremented by 1.
5. Multiplier only scales macros; batch count always decrements by 1.

### Dismissing a batch
- Each active batch row has an × button.
- Confirms with a dialog, then sets `batch_discarded = true` on all entries
  with that `batch_id`.

### Editing a re-log serving
- Standard flow: tap timeline entry → Edit Meal form, change macros manually.

## Constraints
- Single-serving logs (batchServings = 1) are unaffected — no new fields shown.
- "Save to library" checkbox is hidden when batchServings > 1.
- Batch meals are not written to the food library.
