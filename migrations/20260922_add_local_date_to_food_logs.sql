-- migrations/20260922_add_local_date_to_food_logs.sql
-- Adds local_date column to food_logs to track calendar date in Eastern Time (where all historical data was logged)

ALTER TABLE food_logs ADD COLUMN local_date TEXT;

UPDATE food_logs
SET local_date = TO_CHAR(logged_at AT TIME ZONE 'America/New_York', 'YYYY-MM-DD')
WHERE local_date IS NULL;

CREATE INDEX food_logs_user_local_date_idx ON food_logs (user_id, local_date);
