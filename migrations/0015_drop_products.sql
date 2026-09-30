-- migrations/0015_drop_products.sql
-- Drop the legacy products table.
--
-- All product data was copied into food_library (is_fuel = true) by migration 0013,
-- keeping the original UUIDs. Migration 0014 retargeted items.product_id FK to
-- food_library, so no FK constraint points here any more.
--
-- Run after confirming all active users have opened the app post-migration-0013
-- (migrateIfNeeded in data.js now checks food_library, not this table).

DROP TABLE IF EXISTS products;
