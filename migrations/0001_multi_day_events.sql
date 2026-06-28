-- Migration: multi-day events support
-- Adds end_date to events and date to segments.
-- Existing rows get NULL, which the app treats as empty string (single-day, no segment date).

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS end_date text;

ALTER TABLE segments
  ADD COLUMN IF NOT EXISTS date text;
