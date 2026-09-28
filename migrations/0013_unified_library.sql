-- migrations/0013_unified_library.sql
-- Extend food_library to hold fuel items, then migrate products into it.

ALTER TABLE food_library
  ADD COLUMN IF NOT EXISTS is_fuel              BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS caffeine_per_serving REAL,
  ADD COLUMN IF NOT EXISTS fuel_type            TEXT;

-- Copy existing fuel products into food_library.
-- calories estimated as carbs * 4 (carbs-only fuel approximation).
INSERT INTO food_library (
  id, user_id, name, brand, category, is_fuel, fuel_type,
  carbs_per_serving, sodium_per_serving, caffeine_per_serving,
  protein_per_serving, fat_per_serving, calories_per_serving,
  created_at
)
SELECT
  id,
  user_id,
  name,
  NULLIF(brand, ''),
  'fuel',
  true,
  type,
  carbs_per_unit,
  sodium_per_unit,
  CASE WHEN caffeine_per_unit > 0 THEN caffeine_per_unit ELSE NULL END,
  0,
  0,
  ROUND((carbs_per_unit * 4)::numeric, 1),
  created_at
FROM products
ON CONFLICT (id) DO NOTHING;
