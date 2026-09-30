-- migrations/0014_retarget_items_product_fk.sql
-- Retarget items.product_id FK from products to food_library.
--
-- Migration 0013 already copied all rows from products into food_library
-- keeping their original UUIDs, so every existing product_id value in items
-- is already a valid food_library id. No data needs to change.
--
-- After this migration, food_library item ids (including new food items that
-- were never in products) are valid values for items.product_id, which
-- removes the 23503 FK violation when adding food library items to segments.

ALTER TABLE items
  DROP CONSTRAINT IF EXISTS items_product_id_fkey;

ALTER TABLE items
  ADD CONSTRAINT items_product_id_fkey
  FOREIGN KEY (product_id)
  REFERENCES food_library(id)
  ON DELETE SET NULL;
