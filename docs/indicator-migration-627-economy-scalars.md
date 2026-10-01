# #627 execution batch: economy scalar publication

This batch composes the existing registered scalar projections into the one
existing `scalar_observation` table snapshot. It does not add schema, markers,
or a second publisher. `publish_service_share_scalars()` still uses
`register_scalar_publisher()`, `publish_registered_scalar()`,
`validate_scalar_projection()`, and `scalar_postgres_adapter()`; the additional
canonical projections are combined before the same transaction/retry/version
path.

The service Parquet refresh path now requires and projects the canonical
`indicateurs_economie.parquet` facts for `effectifs_salaries` and `chomage`.
The explicit `--check` command validates and reports the complete snapshot;
`--publish` uses the existing `publier_tables_service_depuis_parquet()` path.
The fixture-only scalar command remains separate and guarded to disposable DBs.
When a committed scalar descriptor is omitted, the adapter rejects the
replacement inside the transaction before deleting facts, preserving the prior
snapshot and marker. Service reads are restricted to IDs generated from
`service_registry` and the declared three service modes, not every scalar key.

Canonical read-only parity check against `E:/Lusk/public/data/indicateurs_economie.parquet`
validated 2,534 rows for these two indicators: 1,202 communes, 61 EPCIs and 4
departments per indicator. The canonical file also has Région rows; the
metadata's declared levels exclude Région for these indicators, so those rows
are not projected. This check did not write to the artifact or any database.

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
