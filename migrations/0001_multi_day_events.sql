-- Migration: multi-day events support
-- Adds category and end_date to events, and date to segments.
-- Existing rows: category defaults to 'single', end_date/date default to NULL
-- (app treats NULL as empty string).

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'single';

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS end_date text;

ALTER TABLE segments
  ADD COLUMN IF NOT EXISTS date text;
