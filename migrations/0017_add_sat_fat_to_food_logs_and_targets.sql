-- migrations/0017_add_sat_fat_to_food_logs_and_targets.sql
ALTER TABLE food_logs
  ADD COLUMN IF NOT EXISTS sat_fat REAL;

ALTER TABLE daily_targets
  ADD COLUMN IF NOT EXISTS sat_fat_pct REAL;
