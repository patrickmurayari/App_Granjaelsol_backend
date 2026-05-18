-- Add is_adjustment and adjustment_notes columns to merchandise_entries
ALTER TABLE merchandise_entries
  ADD COLUMN IF NOT EXISTS is_adjustment BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS adjustment_notes TEXT;
