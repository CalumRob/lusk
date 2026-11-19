BEGIN;

-- #1041: the canonical territory reference gains the producer-owned commune
-- littoral classification (DREAL Bretagne positive list) and the source's own
-- classement (Mer/Estuaire) as provenance. Additive DDL only: existing rows
-- and publication markers survive, and every existing row keeps NULL/NULL
-- (the historical/transition reference). The projected reference content
-- version changes only when the producer republishes the canonical reference;
-- applying this migration does not publish nor mutate the serving data.
ALTER TABLE territory_reference
  ADD COLUMN littoral_code text,
  ADD COLUMN littoral_classement_source text;

-- A littoral code is meaningful only on a commune. C (listed by DREAL) must
-- carry the source classement; NC (validated complement) must not; NULL is
-- the explicit unclassified/transition state. There is no default and no
-- implicit NC: a future publication that cannot prove the complete crosswalk
-- must fail rather than write an unexplained NULL as non-littoral.
ALTER TABLE territory_reference
  ADD CONSTRAINT territory_reference_littoral_scope_check CHECK (COALESCE(
    (littoral_code IS NULL AND littoral_classement_source IS NULL)
    OR (territory_type = 'commune' AND littoral_code = 'C'
        AND littoral_classement_source IN ('Mer', 'Estuaire'))
    OR (territory_type = 'commune' AND littoral_code = 'NC'
        AND littoral_classement_source IS NULL),
    FALSE
  ));

COMMIT;
