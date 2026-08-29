-- Migration: change items.quantity from INTEGER to REAL to support fractional quantities.
-- Run in the Supabase SQL editor after 0003_exec_interval.sql.

ALTER TABLE items ALTER COLUMN quantity TYPE REAL;

CREATE OR REPLACE FUNCTION save_event(event_data jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
  DECLARE
    evt_id UUID;
    seg    jsonb;
    seg_id UUID;
    itm    jsonb;
  BEGIN
    -- Reject writes from unregistered users
    IF NOT EXISTS (
      SELECT 1 FROM users WHERE id = (event_data->>'user_id')::UUID
    ) THEN
      RAISE EXCEPTION 'unauthorized';
    END IF;

    -- Upsert event row
    INSERT INTO events (id, user_id, name, date, end_date, category, type, notes)
    VALUES (
      (event_data->>'id')::UUID,
      (event_data->>'user_id')::UUID,
      event_data->>'name',
      NULLIF(event_data->>'date', '')::DATE,
      NULLIF(event_data->>'end_date', ''),
      COALESCE(NULLIF(event_data->>'category', ''), 'single'),
      COALESCE(event_data->>'type', 'other'),
      event_data->>'notes'
    )
    ON CONFLICT (id) DO UPDATE SET
      name       = EXCLUDED.name,
      date       = EXCLUDED.date,
      end_date   = EXCLUDED.end_date,
      category   = EXCLUDED.category,
      type       = EXCLUDED.type,
      notes      = EXCLUDED.notes,
      updated_at = now();

    evt_id := (event_data->>'id')::UUID;

    -- Remove existing segments (cascades to items)
    DELETE FROM segments WHERE event_id = evt_id;

    -- Re-insert segments and items
    FOR seg IN SELECT * FROM jsonb_array_elements(event_data->'segments')
    LOOP
      seg_id := (seg->>'id')::UUID;

      INSERT INTO segments (id, event_id, name, date, duration_hours,
                            carbs_per_hour, sodium_per_hour, caffeine_per_hour,
                            sort_order, exec_interval)
      VALUES (
        seg_id,
        evt_id,
        seg->>'name',
        NULLIF(seg->>'date', ''),
        (seg->>'durationHours')::REAL,
        COALESCE((seg->'targets'->>'carbsPerHour')::INTEGER, 0),
        COALESCE((seg->'targets'->>'sodiumPerHour')::INTEGER, 0),
        COALESCE((seg->'targets'->>'caffeinePerHour')::INTEGER, 0),
        COALESCE((seg->>'sortOrder')::INTEGER, 0),
        NULLIF(seg->>'execInterval', '')::INTEGER
      );

      FOR itm IN SELECT * FROM jsonb_array_elements(seg->'items')
      LOOP
        INSERT INTO items (id, segment_id, product_id, name, brand, type,
                           carbs_per_unit, sodium_per_unit, caffeine_per_unit,
                           quantity, sort_order)
        VALUES (
          (itm->>'id')::UUID,
          seg_id,
          NULLIF(itm->>'productId', 'null')::UUID,
          itm->>'name',
          itm->>'brand',
          itm->>'type',
          COALESCE((itm->>'carbsPerUnit')::INTEGER, 0),
          COALESCE((itm->>'sodiumPerUnit')::INTEGER, 0),
          COALESCE((itm->>'caffeinePerUnit')::INTEGER, 0),
          COALESCE((itm->>'quantity')::REAL, 1),
          COALESCE((itm->>'sortOrder')::INTEGER, 0)
        );
      END LOOP;
    END LOOP;
  END;
$$;
