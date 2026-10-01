-- migrations/0016_add_sat_fat_to_food_library.sql
ALTER TABLE food_library
  ADD COLUMN IF NOT EXISTS sat_fat_per_serving REAL;
