# #627 execution batch: economy scalar publication

This batch composes the existing registered scalar projections into the one
existing `scalar_observation` table snapshot. It does not add schema, markers,
or a second publisher. `publish_service_share_scalars()` still uses
`register_scalar_publisher()`, `publish_registered_scalar()`,
`validate_scalar_projection()`, and `scalar_postgres_adapter()`; the additional
canonical projections are combined before the same transaction/retry/version
path.

The service Parquet refresh path now requires and projects the canonical
`indicateurs_economie.parquet` facts for every indicator named in the
producer-owned `scalar_contracts` metadata. Those declarations distinguish
fact eligibility (including Région rows) from indicator-page comparison
levels; they also state sparse completeness, missing-value status, and that
support/denominator counts are unavailable from this producer. The explicit
`--check` command and `publier_tables_service_depuis_parquet()` now call the
same table-level `project_service_scalar_snapshot()` assembly seam; publishing
passes its cohort list through the existing scalar publisher wrapper.
The fixture-only scalar command remains separate and guarded to disposable DBs.
When a committed scalar descriptor is omitted, the adapter rejects the
replacement inside the transaction before deleting facts, preserving the prior
snapshot and marker. Service reads are restricted to IDs generated from
`service_registry` and the declared three service modes, not every scalar key.

Canonical read-only projection against `public/data/indicateurs_economie.parquet`
validated 2,534 economy facts plus the existing service cohort (21,556 total
facts, 17 descriptors) across communes, EPCIs, departments, and Région. It did
not write to a database or modify the canonical fact artifact. The generated
`public/data/theme_economie.json` is refreshed from the metadata producer so
the checked-in copy remains byte-identical to its source.

## Deliberately not migrated by this batch

- `eco_activites` is sparse/non-ordinary scalar evidence and remains in the
  canonical static indicator/read-model consumers pending a separately bounded
  evidence mapping.
- Economy `indicator_pages`/Repères/Carte consumers in
  `app/src/views/IndicateurPage.vue` and `app/src/payload/indicatorReadModel.ts`,
  fiche scalar facts resolved through `app/src/fiche/content/`, and numeric-map
  layers assembled in `app/src/carte/coucheModel.ts` / `app/src/carte/fusion.ts`
  still use static indicator/read-model acquisition. This PR does not claim an
  API consumer cutover. The next #627 step must add bounded cohort comparison
  acquisition and migrate those seams to visible/retryable unavailable states
  without static fallback.
- Static `indicateurs_economie` artifact, ranks and downstream pipeline
  consumers remain; none are deleted. `histoires_economie` remains an active
  fiche semantic consumer and is not part of these two scalar facts.
- Other theme scalar batches (demography, housing, mobility, and programmes),
  and profile/series/evidence batches retain their separate constrained grains.
  Future scalar batches join the same deterministic `combine_scalar_projections`
  input list; they must never publish a partial shared-table snapshot.

This is an intermediate PR referencing #627 only; it does not close the parent
migration issue or authorize production publication/deployment.
