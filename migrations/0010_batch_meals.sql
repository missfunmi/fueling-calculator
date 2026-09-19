-- migrations/0010_batch_meals.sql
-- Adds batch tracking to food_logs for portioned / meal-prep logging.
ALTER TABLE food_logs ADD COLUMN IF NOT EXISTS batch_id UUID;
ALTER TABLE food_logs ADD COLUMN IF NOT EXISTS batch_total INT;
ALTER TABLE food_logs ADD COLUMN IF NOT EXISTS batch_remaining INT;
ALTER TABLE food_logs ADD COLUMN IF NOT EXISTS batch_discarded BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_food_logs_batch_id
  ON food_logs(batch_id) WHERE batch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_food_logs_active_batches
  ON food_logs(user_id, batch_remaining, batch_discarded)
  WHERE batch_remaining IS NOT NULL;
