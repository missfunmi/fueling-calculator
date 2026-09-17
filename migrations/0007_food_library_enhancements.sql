-- migrations/0007_food_library_enhancements.sql
ALTER TABLE food_library ADD COLUMN brand        TEXT;
ALTER TABLE food_library ADD COLUMN serving_size REAL;
ALTER TABLE food_logs    ADD COLUMN components   JSONB;
