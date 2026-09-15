# Food Log + Macro Tracker — PRD

**Date:** 2026-09-15
**Status:** Draft — awaiting approval
**Phase:** 1 of N

---

## Background

The fueling calculator already tracks race-day nutrition — planned and actual fuel per event segment. The missing piece is day-to-day food intake: the user needs to log meals, track macros and calories against daily targets, and monitor progress toward a specific body composition for performance. This is a natural extension of the same nutrition-tracking intent, living in the same app alongside Events and Library.

---

## Goals

- Log daily food intake quickly — under 30 seconds per meal from tap to save
- Track protein, carbs, fat, calories, fiber, and sodium against daily targets
- Reduce entry friction with AI: freeform text instead of database lookups or form fields
- Build a personal food library for fast reuse of frequent meals

---

## Non-goals (phase 1)

- Photo upload or OCR of nutrition labels
- Insights, trends, or graphical analytics
- Pre-log meal planning / "how to close the gap" suggestions
- Integration with event fuel planner (deferred — event fuel does not typically count toward daily macro goals)
- Markdown export
- Sharing or social features

---

## Users

Single-user app. The user is a performance athlete tracking nutrition for body composition and training goals alongside race preparation.

---

## Phase 1 Feature Requirements

### F1 — Freeform meal logging

The primary entry mechanism is a freeform text field. The user types anything — a meal description, pasted nutrition label values, a library item name with a quantity, or a mix — and the app estimates the macros via AI.

- Freeform input supports: plain meal descriptions ("two scrambled eggs with toast"), nutrition label values ("250 cal, 30g protein, 45g carbs"), library references ("my post-workout shake, 1.5 servings"), or combinations
- After input, user taps "Calculate" → AI Edge Function returns estimated macros
- Estimated values appear in an editable block; user can tap any value to correct it before saving
- Fields: name (editable), protein, carbs, fat, calories, fiber (optional), sodium (optional)
- `ai_notes` shown below fields when the AI made notable assumptions
- Category: Breakfast / Lunch / Dinner / Fuel / Snack
- Timestamp: defaults to now, user-editable
- "Save to library" checkbox saves the entry to `food_library` at the same time as logging it

### F2 — Daily progress view

The main Food Log screen shows today's status at a glance.

- Header: "Food Log" + gear icon (→ targets settings)
- Date navigation: prev/next arrows, date label with `▾` caret opening a calendar picker for jumping to any past date
- Progress section: running totals vs. targets for calories (prominent), then protein, carbs, fat, fiber, sodium as slim rows with colour-coded dots and fill bars
  - If a target is not set for a metric: bar is hidden; value appears alone
- Timeline: time-axis layout (fixed time column + vertical rule + entries), newest entry at top
  - Each entry shows: meal name, macro summary, category badge
- Floating "+" button → log entry form

### F3 — Edit and delete logged entries

- Tap any timeline entry → opens entry form pre-filled with stored values; re-parse not required
- All macro fields directly editable
- Delete via swipe or long-press (confirmation required)

### F4 — Daily targets

- User sets per-metric daily targets: calories, protein, carbs, fat, fiber, sodium
- All targets are optional — any unset target simply hides the progress bar for that metric
- Targets are persistent and apply to every day until changed

### F5 — Food library

- Saved meals with per-serving macros and optional serving unit
- Accessible from the existing Library tab as a new "Food" sub-tab (alongside the existing "Fuel" tab)
- Sorted alphabetically
- Tapping "Use" on a library item navigates to the entry form with the item pre-filled; user types a freeform serving hint ("¾ of this", "×1.5", "two servings") which is included in the AI calculation
- "+ Add food item" on the Food library tab opens a blank entry form in "new library item" mode (saves directly to library, no daily log entry created)
- Edit and delete available on each library item

---

## Success metrics

- A common meal (e.g. "chicken rice bowl") is logged in under 30 seconds from tap to save
- AI parse returns plausible macros for typical meals without manual correction in the majority of cases
- Library reuse flow (tap Use → type serving → save) completes in under 10 seconds

---

## Out of scope for all phases (known)

- Barcode scanning
- Integration with third-party nutrition databases (MyFitnessPal, Cronometer)
- Meal planning calendar
- Multiple user profiles
