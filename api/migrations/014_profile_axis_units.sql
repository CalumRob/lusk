-- Detail-level units are not necessarily the descriptor's headline unit.
ALTER TABLE profile_descriptor ADD COLUMN denominator_semantics text;
ALTER TABLE profile_axis ADD COLUMN unit text;
