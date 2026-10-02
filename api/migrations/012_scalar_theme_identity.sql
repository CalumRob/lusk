-- Additive compatibility field: old snapshots remain readable but are not
-- eligible for selected-theme reads until republished from canonical metadata.
ALTER TABLE scalar_descriptor ADD COLUMN theme_id text
  CHECK (theme_id IS NULL OR theme_id ~ '^[a-z][a-z0-9_]{0,63}$');
