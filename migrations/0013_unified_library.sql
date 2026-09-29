-- migrations/0013_unified_library.sql
-- Extend food_library to hold fuel items, then migrate products into it.

ALTER TABLE food_library
  ADD COLUMN IF NOT EXISTS is_fuel              BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS caffeine_per_serving REAL;

-- Fail loudly if any products.id already exists in food_library.
-- Both tables use independently-generated UUIDs so this should never fire,
-- but silent data loss from ON CONFLICT DO NOTHING is worse than a hard stop.
DO $$
DECLARE conflict_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO conflict_count
  FROM products p
  WHERE EXISTS (SELECT 1 FROM food_library f WHERE f.id = p.id);

  IF conflict_count > 0 THEN
    RAISE EXCEPTION
      'Migration aborted: % product id(s) already exist in food_library. Resolve conflicts before re-running.',
      conflict_count;
  END IF;
END $$;

-- Copy existing fuel products into food_library.
-- category holds the fuel subtype (gel, bar, drink_powder, etc.) — same field
-- that food items use for meal category.  No separate fuel_type column needed.
-- Calories estimated as carbs * 4 (carbs-only fuel approximation).
INSERT INTO food_library (
  id, user_id, name, brand, category, is_fuel,
  carbs_per_serving, sodium_per_serving, caffeine_per_serving,
  protein_per_serving, fat_per_serving, calories_per_serving,
  created_at
)
SELECT
  id,
  user_id,
  name,
  NULLIF(brand, ''),
  type,
  true,
  carbs_per_unit,
  sodium_per_unit,
  CASE WHEN caffeine_per_unit > 0 THEN caffeine_per_unit ELSE NULL END,
  0,
  0,
  ROUND((carbs_per_unit * 4)::numeric, 1),
  created_at
FROM products;
