-- migrations/0005_food_log.sql
-- Food library: saved meals with per-serving macros
CREATE TABLE IF NOT EXISTS food_library (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL,
  name                 TEXT NOT NULL,
  category             TEXT,
  protein_per_serving  REAL NOT NULL DEFAULT 0,
  carbs_per_serving    REAL NOT NULL DEFAULT 0,
  fat_per_serving      REAL NOT NULL DEFAULT 0,
  calories_per_serving REAL NOT NULL DEFAULT 0,
  fiber_per_serving    REAL,
  sodium_per_serving   REAL,
  serving_unit         TEXT,
  created_at           TIMESTAMPTZ DEFAULT now()
);

-- Daily food log entries
CREATE TABLE IF NOT EXISTS food_logs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL,
  logged_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  name               TEXT NOT NULL,
  category           TEXT,
  freeform_input     TEXT,
  protein            REAL NOT NULL DEFAULT 0,
  carbs              REAL NOT NULL DEFAULT 0,
  fat                REAL NOT NULL DEFAULT 0,
  calories           REAL NOT NULL DEFAULT 0,
  fiber              REAL,
  sodium             REAL,
  library_item_id    UUID REFERENCES food_library(id),
  serving_multiplier REAL DEFAULT 1.0,
  ai_estimated       BOOLEAN DEFAULT false,
  ai_notes           TEXT,
  created_at         TIMESTAMPTZ DEFAULT now()
);

-- Per-user daily targets (all nullable = no target set)
CREATE TABLE IF NOT EXISTS daily_targets (
  user_id         UUID PRIMARY KEY,
  calories_target REAL,
  protein_target  REAL,
  carbs_target    REAL,
  fat_target      REAL,
  fiber_target    REAL,
  sodium_target   REAL,
  updated_at      TIMESTAMPTZ DEFAULT now()
);
