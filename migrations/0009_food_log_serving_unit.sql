-- migrations/0009_food_log_serving_unit.sql
ALTER TABLE food_logs ADD COLUMN IF NOT EXISTS log_serving_size REAL;
ALTER TABLE food_logs ADD COLUMN IF NOT EXISTS log_serving_unit TEXT;
