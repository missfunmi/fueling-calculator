-- migrations/0008_food_library_nullable_macros.sql
-- Allow null macros on food_library items (unknown values, not just 0).
-- The app enforces that serving_size must be present when any macro is set.
ALTER TABLE food_library ALTER COLUMN protein_per_serving  DROP NOT NULL;
ALTER TABLE food_library ALTER COLUMN carbs_per_serving    DROP NOT NULL;
ALTER TABLE food_library ALTER COLUMN fat_per_serving      DROP NOT NULL;
ALTER TABLE food_library ALTER COLUMN calories_per_serving DROP NOT NULL;
