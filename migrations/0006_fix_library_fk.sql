-- migrations/0006_fix_library_fk.sql
-- Change food_logs.library_item_id FK to SET NULL on delete
-- so deleting a food library item does not delete food log entries.
ALTER TABLE food_logs
  DROP CONSTRAINT IF EXISTS food_logs_library_item_id_fkey;

ALTER TABLE food_logs
  ADD CONSTRAINT food_logs_library_item_id_fkey
  FOREIGN KEY (library_item_id)
  REFERENCES food_library(id)
  ON DELETE SET NULL;
