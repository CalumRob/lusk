-- Detail-level units are not necessarily the descriptor's headline unit.
ALTER TABLE profile_descriptor ADD COLUMN denominator_semantics text;
ALTER TABLE profile_axis ADD COLUMN unit text;
-- Older declared profiles have one homogeneous descriptor unit; new profiles
-- with an explicit detail-unit contract set this flag and require every axis.
ALTER TABLE profile_descriptor ADD COLUMN detail_units_required boolean NOT NULL DEFAULT false;
UPDATE profile_axis a SET unit=d.unit
FROM profile_descriptor d
WHERE d.indicator_id=a.indicator_id AND a.axis_name='detail'
  AND a.unit IS NULL AND NOT d.detail_units_required;
