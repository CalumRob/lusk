# Publication guard inventory (#984)

The semantic batch contract may report an absent publication as one correlated
`publication_unavailable` result instead of failing the whole request. That
softening is deliberately narrow and explicit:

- **`unavailable`** — the guard calls `publication_unavailable(family, detail)`.
  It means the requested item's own or directly required publication (marker,
  descriptor, facts or active read route) is not present. The v2 executor
  converts it to one typed result; v1 still returns `503`. No data, versions or
  fake zero is invented.
- **`fatal`** — every other `503` guard. It aborts the whole request, even in
  v2. This includes SQL/schema faults, the shared `territory_reference` clock,
  snapshot changes inside one repeatable-read read, conflicting provenance,
  malformed or incomplete published rows, ambiguous producer declarations and
  incompatible facet contracts. It also covers the DB-unavailable
  `DATABASE_URL` guard outside the semantic read path.

`404` identity/member failures, `422` request/coordinate/member validation and
`413` work/byte bounds are request failures by construction and are not part of
this inventory. The v2 executor admits actual target/member/cohort identity and
declared level before any item outcome, so an unknown identity is never masked
by an absent publication. The executor classifies the exception object, never
its message; a plain `HTTPException(503, "...")` is never downgraded. V1 keeps
its historical precedence and exact status/detail strings; the soft helpers
below reuse the original v1 details.

Cohort targets are not a separate family: their outcome names the underlying
resource family (`scalar`, `profile`, `ordered_series`, `typed_reading`, ...).
`named_reference`, `collection`, and `aedar` cover the remaining
declared families.

The table is generated from the API source by
[`scripts/generate_publication_guard_inventory.py`](scripts/generate_publication_guard_inventory.py);
a contract test fails when a guard is added or reclassified without refreshing
it. A `?` family marks the small set of generic helpers whose caller supplies the
declared resource family at runtime; the emitted v2 outcome still carries the
actual family.

Boundary notes for reviewers:

- A missing required SQL relation is schema-fatal, not absence: v2 admission
  checks the producer-declared relation group with `to_regclass` before any item
  outcome, and real `UndefinedTable`/`UndefinedColumn` errors are never caught.
- v2 admission is charged to the same 200,000-unit request budget before its SQL
  and receives the route's producer catalogue explicitly. It does not enumerate
  cohort members; v2 preflight resolves each distinct cohort once and charges
  each item's own facts/evidence work.
- Where a soft guard also accepts an empty `content_version` on an existing
  marker, that empty value is treated as "no usable publication". Canonical
  publishers never emit it (`table_publication.content_version` is `NOT NULL`
  and receives a content hash); a blank or mismatched *dependency clock* stays
  fatal. If a future producer permits a blank version, these guards must be
  promoted to hard integrity.

<!-- BEGIN GENERATED PUBLICATION GUARD INVENTORY -->

| Outcome | File | Function | Family | Guard detail |
| --- | --- | --- | --- | --- |
| `unavailable` | `aedar_reads.py` | `_aedar_comparison_marker` | `aedar` | AEDAR comparison publication is unavailable or stale |
| `unavailable` | `aedar_reads.py` | `_aedar_density_class_summary_records` | `aedar` | AEDAR density-class summary is missing or incomplete |
| `unavailable` | `aedar_reads.py` | `_aedar_territorial_aggregate_snapshot` | `aedar` | AEDAR territorial publication is unavailable or incompatible |
| `unavailable` | `aedar_reads.py` | `_aedar_territorial_aggregate_snapshot` | `aedar` | AEDAR territorial publication is unavailable or incompatible |
| `unavailable` | `aedar_reads.py` | `_aedar_territory_summary_snapshot` | `aedar` | AEDAR territory summary publication is unavailable or stale |
| `unavailable` | `aedar_reads.py` | `_aedar_territory_summary_snapshot` | `aedar` | AEDAR territory summary publication is unavailable or stale |
| `unavailable` | `cohort_reads.py` | `_indicator_shape` | `?` | Indicator has ambiguous or unavailable published storage shapes |
| `unavailable` | `cohort_reads.py` | `_legacy_series_context` | `ordered_series` | Series publication is unavailable or incompatible |
| `unavailable` | `cohort_reads.py` | `_owned_series_context` | `ordered_series` | Owned-series cohort route is unavailable |
| `unavailable` | `cohort_reads.py` | `_owned_series_context` | `ordered_series` | Owned-series publication is stale or unavailable |
| `unavailable` | `cohort_reads.py` | `_profile_context` | `profile` | Declared profile publication is unavailable |
| `unavailable` | `cohort_reads.py` | `_profile_context` | `profile` | Declared profile publication is unavailable |
| `unavailable` | `cohort_reads.py` | `_profile_context` | `profile` | Profile publication is unavailable or incompatible |
| `unavailable` | `cohort_reads.py` | `_scalar_contract` | `scalar` | Declared scalar publication is unavailable |
| `unavailable` | `cohort_reads.py` | `_scalar_contract` | `scalar` | Scalar publication is stale or incompatible |
| `unavailable` | `cohort_reads.py` | `_typed_reading_context` | `typed_reading` | Selected-reading publication is inconsistent |
| `unavailable` | `cohort_reads.py` | `_typed_reading_context` | `typed_reading` | Typed-reading evidence publication is unavailable or stale |
| `unavailable` | `cohort_reads.py` | `_typed_reading_context` | `typed_reading` | Typed-reading publication is unavailable or stale |
| `unavailable` | `observed_collections.py` | `_published_collection_comparison` | `collection` | Observed collection comparison publication is missing or incompatible |
| `unavailable` | `observed_collections.py` | `collection_comparison_preflight` | `collection` | Observed collection comparison publication is missing or incompatible |
| `unavailable` | `observed_collections.py` | `collection_marker` | `collection` | Observed collection publication is missing or incompatible |
| `unavailable` | `profile_reads.py` | `focal_profiles` | `profile` | Profile publication is unavailable or incompatible |
| `unavailable` | `profile_reads.py` | `focal_profiles` | `profile` | Profile scalar dependency is stale or incompatible |
| `unavailable` | `semantic_resource_reader.py` | `_coordinate_values` | `profile` | Profile coordinate descriptor is unavailable |
| `unavailable` | `semantic_resource_reader.py` | `_coordinate_values` | `?` | Series coordinate descriptor is unavailable |
| `unavailable` | `semantic_resource_reader.py` | `_require_dual_series_route` | `ordered_series` | Declared ordered-series facet publication is unavailable or incompatible |
| `unavailable` | `semantic_resource_reader.py` | `_typed_reading_preflight` | `typed_reading` | Selected-reading publication is inconsistent |
| `unavailable` | `semantic_resource_reader.py` | `_typed_reading_preflight` | `typed_reading` | Typed-reading evidence publication is unavailable or stale |
| `unavailable` | `semantic_resource_reader.py` | `_typed_reading_preflight` | `typed_reading` | Typed-reading publication is unavailable or stale |
| `unavailable` | `semantic_resource_reader.py` | `_typed_reading_read` | `typed_reading` | Typed-reading publication is unavailable or stale |
| `unavailable` | `semantic_resource_reader.py` | `preflight` | `profile` | Declared profile publication is unavailable |
| `unavailable` | `semantic_resource_reader.py` | `preflight` | `named_reference` | Named reference publication is unavailable |
| `unavailable` | `semantic_resource_reader.py` | `read` | `profile` | Declared profile publication is unavailable |
| `unavailable` | `semantic_resource_reader.py` | `read` | `profile` | Declared profile publication is unavailable |
| `unavailable` | `semantic_resource_reader.py` | `read` | `named_reference` | Named reference publication is unavailable |
| `unavailable` | `series_comparison_projection.py` | `_context` | `?` | Series comparison axis publication is unavailable or stale |
| `unavailable` | `series_comparison_projection.py` | `_context` | `?` | Series comparison axis publication is unavailable or stale |
| `unavailable` | `series_comparison_projection.py` | `_context` | `?` | Series comparison descriptor/publication is unavailable |
| `unavailable` | `snapshot_reads.py` | `_focal_series_snapshot` | `ordered_series` | Series publication is unavailable or incompatible |
| `unavailable` | `snapshot_reads.py` | `_indicator_comparison_preflight` | `ordered_series` | Declared ordered-series facet publication is unavailable |
| `unavailable` | `snapshot_reads.py` | `_indicator_comparison_preflight` | `?` | Declared resource publication is unavailable |
| `unavailable` | `snapshot_reads.py` | `_indicator_comparison_snapshot` | `ordered_series` | Declared ordered-series facet publication is unavailable |
| `unavailable` | `snapshot_reads.py` | `_indicator_comparison_snapshot` | `?` | Declared resource publication is unavailable |
| `unavailable` | `snapshot_reads.py` | `_indicator_facts_snapshot` | `?` | Declared resource publication is unavailable |
| `unavailable` | `snapshot_reads.py` | `_indicator_facts_snapshot` | `scalar` | Scalar publication is stale or incompatible |
| `unavailable` | `snapshot_reads.py` | `_indicator_facts_snapshot` | `scalar` | Scalar publication is unavailable |
| `unavailable` | `snapshot_reads.py` | `_indicator_facts_snapshot` | `ordered_series` | Series publication is unavailable or incompatible |
| `unavailable` | `snapshot_reads.py` | `_owned_named_reference_snapshot` | `named_reference` | Owned named-reference publication is unavailable or stale |
| `unavailable` | `snapshot_reads.py` | `_owned_reference_comparison_result` | `named_reference` | Owned analytical-reference publication is unavailable or stale |
| `unavailable` | `snapshot_reads.py` | `_owned_series_comparison_results` | `ordered_series` | Owned-series publication is stale or unavailable |
| `unavailable` | `snapshot_reads.py` | `_owned_series_route` | `?` | Owned-series active publication route is not declared |
| `unavailable` | `snapshot_reads.py` | `_owned_series_snapshot` | `ordered_series` | Owned-series publication is stale or unavailable |
| `unavailable` | `snapshot_reads.py` | `_profile_comparison_publication_marker` | `?` | Published profile comparison is stale or incompatible |
| `unavailable` | `snapshot_reads.py` | `_scalar_comparison_publication_marker` | `?` | Published scalar comparison is stale or incompatible |
| `unavailable` | `snapshot_reads.py` | `_scalar_facet_descriptor` | `scalar` | Declared scalar facet descriptor is unavailable or incompatible |
| `unavailable` | `snapshot_reads.py` | `_scalar_facet_snapshot` | `scalar` | Scalar facet publication is stale or incompatible |
| `unavailable` | `snapshot_reads.py` | `_series_comparison_snapshot` | `ordered_series` | Series publication is unavailable or incompatible |
| `unavailable` | `typed_reading_snapshots.py` | `_milieux_reading_marker` | `typed_reading` | Milieux reading publication is unavailable |
| `fatal` | `aedar_reads.py` | `_aedar_comparison_marker` | `—` | AEDAR comparison publication is unavailable or stale |
| `fatal` | `aedar_reads.py` | `_aedar_comparison_marker` | `—` | AEDAR comparison publication is unavailable or stale |
| `fatal` | `aedar_reads.py` | `_aedar_comparison_marker` | `—` | AEDAR comparison publication is unavailable or stale |
| `fatal` | `aedar_reads.py` | `_aedar_comparison_snapshot` | `—` | AEDAR comparison facet declaration is incomplete for the requested measures |
| `fatal` | `aedar_reads.py` | `_aedar_comparison_snapshot` | `—` | Published AEDAR reference identity is unavailable |
| `fatal` | `aedar_reads.py` | `_aedar_density_class_summary_records` | `—` | AEDAR density-class summary contains an invalid reading |
| `fatal` | `aedar_reads.py` | `_aedar_density_class_summary_records` | `—` | AEDAR density-class summary is malformed |
| `fatal` | `aedar_reads.py` | `_aedar_density_class_summary_records` | `—` | AEDAR density-class summary is missing or incomplete |
| `fatal` | `aedar_reads.py` | `_aedar_fixed_aggregate_snapshot` | `—` | AEDAR territory summary publication changed within the read snapshot |
| `fatal` | `aedar_reads.py` | `_aedar_fixed_aggregate_snapshot` | `—` | Published AEDAR reference identity is unavailable |
| `fatal` | `aedar_reads.py` | `_aedar_fixed_peer_ids` | `—` | Published AEDAR reference identity is unavailable |
| `fatal` | `aedar_reads.py` | `_aedar_prepare_fixed_aggregate_batch` | `—` | AEDAR territory summary publication changed within the read snapshot |
| `fatal` | `aedar_reads.py` | `_aedar_prepare_fixed_aggregate_batch` | `—` | Published AEDAR reference identity is unavailable |
| `fatal` | `aedar_reads.py` | `_aedar_selected_comparison_snapshot` | `—` | AEDAR comparison facet declaration is incomplete for the requested measures |
| `fatal` | `aedar_reads.py` | `_aedar_territorial_aggregate_snapshot` | `—` | AEDAR TYPEQU metadata publication is incomplete |
| `fatal` | `aedar_reads.py` | `_aedar_territorial_aggregate_snapshot` | `—` | AEDAR measure publication is incomplete for the requested projection |
| `fatal` | `aedar_reads.py` | `_aedar_territorial_aggregate_snapshot` | `—` | AEDAR territorial publication is unavailable or incompatible |
| `fatal` | `aedar_reads.py` | `_aedar_territorial_aggregate_snapshot` | `—` | AEDAR territorial publication is unavailable or incompatible |
| `fatal` | `aedar_reads.py` | `_aedar_territorial_aggregate_snapshot` | `—` | AEDAR territorial publication is unavailable or incompatible |
| `fatal` | `aedar_reads.py` | `_aedar_territory_summary_snapshot` | `—` | AEDAR territory summary contains an invalid reading |
| `fatal` | `aedar_reads.py` | `_aedar_territory_summary_snapshot` | `—` | AEDAR territory summary is incomplete for the requested projection |
| `fatal` | `aedar_reads.py` | `_aedar_territory_summary_snapshot` | `—` | AEDAR territory summary provenance is inconsistent |
| `fatal` | `aedar_reads.py` | `_aedar_territory_summary_snapshot` | `—` | AEDAR territory summary publication is unavailable or stale |
| `fatal` | `aedar_reads.py` | `_aedar_territory_summary_snapshot` | `—` | AEDAR territory summary publication is unavailable or stale |
| `fatal` | `aedar_reads.py` | `_aedar_territory_summary_snapshot` | `—` | AEDAR territory summary publication is unavailable or stale |
| `fatal` | `aedar_reads.py` | `_aedar_territory_summary_snapshot` | `—` | AEDAR territory summary publication is unavailable or stale |
| `fatal` | `cohort_reads.py` | `_collection_context` | `—` | Collection coordinate descriptor is unavailable |
| `fatal` | `cohort_reads.py` | `_collection_context` | `—` | Observed collection publication is incompatible with the cohort |
| `fatal` | `cohort_reads.py` | `_indicator_shape` | `—` | Indicator has ambiguous collection/storage declarations |
| `fatal` | `cohort_reads.py` | `_indicator_shape` | `—` | Indicator has ambiguous or unavailable published storage shapes |
| `fatal` | `cohort_reads.py` | `_indicator_shape` | `—` | Published storage shape differs from its producer declaration |
| `fatal` | `cohort_reads.py` | `_legacy_series_context` | `—` | Series descriptor is unavailable |
| `fatal` | `cohort_reads.py` | `_legacy_series_context` | `—` | Series publication is unavailable or incompatible |
| `fatal` | `cohort_reads.py` | `_owned_series_context` | `—` | Owned-series active publication route is unavailable |
| `fatal` | `cohort_reads.py` | `_owned_series_context` | `—` | Owned-series cohort route is unavailable |
| `fatal` | `cohort_reads.py` | `_owned_series_context` | `—` | Owned-series publication is stale or unavailable |
| `fatal` | `cohort_reads.py` | `_profile_context` | `—` | Declared profile publication is unavailable |
| `fatal` | `cohort_reads.py` | `_profile_context` | `—` | Legacy profile unit contract is incompatible |
| `fatal` | `cohort_reads.py` | `_profile_context` | `—` | Profile axes are invalid |
| `fatal` | `cohort_reads.py` | `_profile_context` | `—` | Profile detail units are unavailable |
| `fatal` | `cohort_reads.py` | `_profile_context` | `—` | Profile detail units are unavailable |
| `fatal` | `cohort_reads.py` | `_profile_context` | `—` | Profile publication is unavailable or incompatible |
| `fatal` | `cohort_reads.py` | `_scalar_contract` | `—` | Scalar publication is stale or incompatible |
| `fatal` | `cohort_reads.py` | `_typed_reading_context` | `—` | Selected-reading publication is inconsistent |
| `fatal` | `cohort_reads.py` | `_typed_reading_context` | `—` | Typed-reading evidence publication is incompatible |
| `fatal` | `cohort_reads.py` | `_typed_reading_context` | `—` | Typed-reading evidence publication is unavailable or stale |
| `fatal` | `cohort_reads.py` | `_typed_reading_context` | `—` | Typed-reading evidence storage is unavailable |
| `fatal` | `cohort_reads.py` | `_typed_reading_context` | `—` | Typed-reading publication is unavailable or stale |
| `fatal` | `cohort_reads.py` | `_typed_reading_context` | `—` | Typed-reading publication is unavailable or stale |
| `fatal` | `cohort_reads.py` | `_typed_reading_context` | `—` | Typed-reading publication is unavailable or stale |
| `fatal` | `cohort_reads.py` | `_typed_reading_context` | `—` | Typed-reading storage is unavailable |
| `fatal` | `cohort_reads.py` | `preflight_cohort` | `—` | Cohort facts are unavailable for this published resource shape |
| `fatal` | `cohort_reads.py` | `preflight_cohort` | `—` | Cohort facts are unavailable for this published resource shape |
| `fatal` | `cohort_reads.py` | `preflight_legacy_series_cohort` | `—` | Series cohort is incomplete |
| `fatal` | `cohort_reads.py` | `preflight_legacy_series_cohort` | `—` | Series source provenance is unavailable |
| `fatal` | `cohort_reads.py` | `preflight_owned_series_cohort` | `—` | Owned-series cohort is incomplete |
| `fatal` | `cohort_reads.py` | `preflight_owned_series_cohort` | `—` | Owned-series marker row count does not match its facts |
| `fatal` | `cohort_reads.py` | `preflight_owned_series_cohort` | `—` | Owned-series provenance is incomplete |
| `fatal` | `cohort_reads.py` | `preflight_profile_cohort` | `—` | Declared profile population is incomplete |
| `fatal` | `cohort_reads.py` | `preflight_profile_cohort` | `—` | Profile cell provenance is unavailable |
| `fatal` | `cohort_reads.py` | `read_cohort` | `—` | Cohort facts are unavailable for this published resource shape |
| `fatal` | `cohort_reads.py` | `read_legacy_series_cohort` | `—` | Series cohort is incomplete |
| `fatal` | `cohort_reads.py` | `read_legacy_series_cohort` | `—` | Series contains duplicate axis facts |
| `fatal` | `cohort_reads.py` | `read_legacy_series_cohort` | `—` | Series source provenance is unavailable |
| `fatal` | `cohort_reads.py` | `read_owned_series_cohort` | `—` | Owned-series declared axis point is missing |
| `fatal` | `cohort_reads.py` | `read_owned_series_cohort` | `—` | Owned-series fact conflicts across provenance rows |
| `fatal` | `cohort_reads.py` | `read_owned_series_cohort` | `—` | Owned-series provenance is incomplete |
| `fatal` | `cohort_reads.py` | `read_owned_series_cohort` | `—` | Owned-series value conflicts across provenance rows |
| `fatal` | `cohort_reads.py` | `read_profile_cohort` | `—` | Declared profile population is incomplete |
| `fatal` | `cohort_reads.py` | `read_profile_cohort` | `—` | Profile cell provenance is unavailable |
| `fatal` | `cohort_reads.py` | `read_scalar_cohort` | `—` | Scalar observation provenance is incomplete |
| `fatal` | `cohort_reads.py` | `read_scalar_cohort` | `—` | Scalar observation provenance is incomplete |
| `fatal` | `cohort_reads.py` | `read_typed_reading_cohort` | `—` | Milieux reading is missing or overlaps its source-absence evidence |
| `fatal` | `cohort_reads.py` | `read_typed_reading_cohort` | `—` | Typed-reading evidence provenance is unavailable |
| `fatal` | `cohort_reads.py` | `read_typed_reading_cohort` | `—` | Typed-reading source differs from its published descriptor |
| `fatal` | `cohort_reads.py` | `read_typed_reading_cohort` | `—` | Typed-reading source provenance is unavailable |
| `fatal` | `cohort_reads.py` | `resolve_territory_cohort` | `—` | Territory reference publication is unavailable |
| `fatal` | `cohort_reads.py` | `validate_typed_reading_integrity.checked_count` | `—` | Typed-reading publication row count is inconsistent |
| `fatal` | `main.py` | `pool` | `—` | DATABASE_URL is not configured |
| `fatal` | `observed_collections.py` | `_published_collection_comparison` | `—` | Observed collection comparison lineage is not complete |
| `fatal` | `observed_collections.py` | `_published_collection_comparison` | `—` | Observed collection comparison lineage storage is unavailable |
| `fatal` | `observed_collections.py` | `_published_collection_comparison` | `—` | Observed collection comparison provenance is incomplete |
| `fatal` | `observed_collections.py` | `_published_collection_comparison` | `—` | Observed collection comparison publication is incomplete |
| `fatal` | `observed_collections.py` | `_published_collection_comparison` | `—` | Observed collection comparison publication is missing or incompatible |
| `fatal` | `observed_collections.py` | `_published_collection_comparison` | `—` | Observed collection comparison publication is stale |
| `fatal` | `observed_collections.py` | `_published_collection_comparison` | `—` | Observed collection comparison row is invalid |
| `fatal` | `observed_collections.py` | `_published_collection_comparison` | `—` | Observed collection comparison source metadata is incomplete |
| `fatal` | `observed_collections.py` | `collection_comparison_preflight` | `—` | Observed collection comparison lineage storage is unavailable |
| `fatal` | `observed_collections.py` | `collection_comparison_preflight` | `—` | Observed collection comparison publication is missing or incompatible |
| `fatal` | `observed_collections.py` | `collection_marker` | `—` | Observed collection publication is missing or incompatible |
| `fatal` | `observed_collections.py` | `collection_marker` | `—` | Unknown observed collection contract |
| `fatal` | `profile_reads.py` | `focal_profiles` | `—` | Legacy profile unit contract is incompatible |
| `fatal` | `profile_reads.py` | `focal_profiles` | `—` | Profile axes are invalid |
| `fatal` | `profile_reads.py` | `focal_profiles` | `—` | Profile cell provenance is unavailable |
| `fatal` | `profile_reads.py` | `focal_profiles` | `—` | Profile comparison point is invalid |
| `fatal` | `profile_reads.py` | `focal_profiles` | `—` | Profile detail units are unavailable |
| `fatal` | `profile_reads.py` | `focal_profiles` | `—` | Profile detail units are unavailable |
| `fatal` | `profile_reads.py` | `focal_profiles` | `—` | Profile publication is incomplete |
| `fatal` | `profile_reads.py` | `focal_profiles` | `—` | Profile publication is unavailable or incompatible |
| `fatal` | `profile_reads.py` | `focal_profiles` | `—` | Profile scalar dependency is stale or incompatible |
| `fatal` | `repository.py` | `search_territories` | `—` | No territory reference has been published |
| `fatal` | `repository.py` | `search_territories` | `—` | Territory reference exceeds search scan bound |
| `fatal` | `resource_execution.py` | `_read_snapshot` | `—` | Resource admission returned an invalid work estimate |
| `fatal` | `resource_execution.py` | `_read_snapshot` | `—` | Resource preflight returned an invalid work estimate |
| `fatal` | `semantic_resource_reader.py` | `_coordinate_values` | `—` | Series coordinate descriptor is unavailable |
| `fatal` | `semantic_resource_reader.py` | `_filter_coordinates` | `—` | Published resource does not expose its declared coordinate rows |
| `fatal` | `semantic_resource_reader.py` | `_require_dual_series_route` | `—` | Declared ordered-series facet publication is unavailable or incompatible |
| `fatal` | `semantic_resource_reader.py` | `_typed_reading_preflight` | `—` | Selected-reading publication is inconsistent |
| `fatal` | `semantic_resource_reader.py` | `_typed_reading_preflight` | `—` | Typed-reading evidence publication is incompatible |
| `fatal` | `semantic_resource_reader.py` | `_typed_reading_preflight` | `—` | Typed-reading evidence publication is stale |
| `fatal` | `semantic_resource_reader.py` | `_typed_reading_preflight` | `—` | Typed-reading evidence publication is unavailable or stale |
| `fatal` | `semantic_resource_reader.py` | `_typed_reading_preflight` | `—` | Typed-reading publication is unavailable or stale |
| `fatal` | `semantic_resource_reader.py` | `_typed_reading_preflight` | `—` | Typed-reading publication is unavailable or stale |
| `fatal` | `semantic_resource_reader.py` | `_typed_reading_read` | `—` | Milieux reading is missing or overlaps its source-absence evidence |
| `fatal` | `semantic_resource_reader.py` | `_typed_reading_read` | `—` | Typed-reading evidence provenance is unavailable |
| `fatal` | `semantic_resource_reader.py` | `_typed_reading_read` | `—` | Typed-reading publication is unavailable or stale |
| `fatal` | `semantic_resource_reader.py` | `_typed_reading_read` | `—` | Typed-reading source differs from its published descriptor |
| `fatal` | `semantic_resource_reader.py` | `_typed_reading_read` | `—` | Typed-reading source provenance is unavailable |
| `fatal` | `semantic_resource_reader.py` | `admit` | `—` | Required publication storage relation is unavailable |
| `fatal` | `semantic_resource_reader.py` | `admit` | `—` | Territory reference publication is unavailable |
| `fatal` | `semantic_resource_reader.py` | `preflight` | `—` | Named reference publication is unavailable |
| `fatal` | `semantic_resource_reader.py` | `read` | `—` | Declared profile publication is unavailable |
| `fatal` | `semantic_resource_reader.py` | `read` | `—` | Named reference publication is unavailable |
| `fatal` | `series_comparison_projection.py` | `_context` | `—` | Series comparison axis publication is unavailable or stale |
| `fatal` | `series_comparison_projection.py` | `_context` | `—` | Series comparison contract is unsupported |
| `fatal` | `series_comparison_projection.py` | `_context` | `—` | Series comparison contract is unsupported |
| `fatal` | `series_comparison_projection.py` | `_context` | `—` | Series comparison descriptor/publication is unavailable |
| `fatal` | `series_comparison_projection.py` | `_selected_axes` | `—` | Selected raccordement member curve is incomplete |
| `fatal` | `series_comparison_projection.py` | `_selected_axes` | `—` | Selected series comparison fact/provenance is inconsistent |
| `fatal` | `series_comparison_projection.py` | `read_axis_comparisons` | `—` | Published series comparison axis is incomplete |
| `fatal` | `series_comparison_projection.py` | `read_axis_comparisons` | `—` | Published series peer comparison evidence is inconsistent |
| `fatal` | `series_comparison_projection.py` | `read_axis_comparisons` | `—` | Published series peer comparison evidence is inconsistent |
| `fatal` | `snapshot_reads.py` | `_comparison_cohort` | `—` | Published default density class is unavailable |
| `fatal` | `snapshot_reads.py` | `_complete_owned_mean_curve` | `—` | Selected owned-series fact conflicts across provenance rows |
| `fatal` | `snapshot_reads.py` | `_complete_owned_mean_curve` | `—` | Selected raccordement member curve is incomplete |
| `fatal` | `snapshot_reads.py` | `_complete_owned_mean_curve` | `—` | Selected raccordement member curve lacks provenance |
| `fatal` | `snapshot_reads.py` | `_complete_owned_mean_curve` | `—` | Selected raccordement member model-zero reason conflicts across curve axes |
| `fatal` | `snapshot_reads.py` | `_complete_owned_mean_curve` | `—` | Selected raccordement model-zero reason conflicts with measured values |
| `fatal` | `snapshot_reads.py` | `_execute_comparison_publication_read` | `—` | Published comparison schema is unavailable |
| `fatal` | `snapshot_reads.py` | `_fixed_scalar_comparison_context` | `—` | Published Bretagne comparison identity is unavailable |
| `fatal` | `snapshot_reads.py` | `_fixed_scalar_comparison_context` | `—` | Published Bretagne comparison identity is unavailable |
| `fatal` | `snapshot_reads.py` | `_focal_series_snapshot` | `—` | Incomplete published series |
| `fatal` | `snapshot_reads.py` | `_focal_series_snapshot` | `—` | Invalid published series axis |
| `fatal` | `snapshot_reads.py` | `_focal_series_snapshot` | `—` | Series publication is unavailable or incompatible |
| `fatal` | `snapshot_reads.py` | `_indicator_comparison_preflight` | `—` | Declared ordered-series facet publication is unavailable |
| `fatal` | `snapshot_reads.py` | `_indicator_comparison_preflight` | `—` | Declared scalar and ordered-series facets have incompatible themes |
| `fatal` | `snapshot_reads.py` | `_indicator_comparison_preflight` | `—` | Declared scalar facet theme is unavailable |
| `fatal` | `snapshot_reads.py` | `_indicator_comparison_preflight` | `—` | Indicator has ambiguous published storage shapes |
| `fatal` | `snapshot_reads.py` | `_indicator_comparison_preflight` | `—` | Indicator theme metadata is unavailable |
| `fatal` | `snapshot_reads.py` | `_indicator_comparison_snapshot` | `—` | Declared ordered-series facet publication is unavailable |
| `fatal` | `snapshot_reads.py` | `_indicator_comparison_snapshot` | `—` | Declared scalar and ordered-series facets have incompatible themes |
| `fatal` | `snapshot_reads.py` | `_indicator_comparison_snapshot` | `—` | Declared scalar facet theme is unavailable |
| `fatal` | `snapshot_reads.py` | `_indicator_comparison_snapshot` | `—` | Indicator comparison facet is unavailable or ambiguous |
| `fatal` | `snapshot_reads.py` | `_indicator_comparison_snapshot` | `—` | Indicator has ambiguous published storage shapes |
| `fatal` | `snapshot_reads.py` | `_indicator_comparison_snapshot` | `—` | Indicator theme metadata is unavailable |
| `fatal` | `snapshot_reads.py` | `_indicator_facts_snapshot` | `—` | Indicator has ambiguous collection/storage declarations |
| `fatal` | `snapshot_reads.py` | `_indicator_facts_snapshot` | `—` | Indicator has ambiguous published storage shapes |
| `fatal` | `snapshot_reads.py` | `_indicator_facts_snapshot` | `—` | Scalar publication is stale or incompatible |
| `fatal` | `snapshot_reads.py` | `_indicator_facts_snapshot` | `—` | Scalar publication is stale or incompatible |
| `fatal` | `snapshot_reads.py` | `_indicator_facts_snapshot` | `—` | Series publication is unavailable or incompatible |
| `fatal` | `snapshot_reads.py` | `_owned_named_reference_snapshot` | `—` | Analytical-reference provenance is incomplete |
| `fatal` | `snapshot_reads.py` | `_owned_named_reference_snapshot` | `—` | Owned analytical-reference route is unavailable |
| `fatal` | `snapshot_reads.py` | `_owned_named_reference_snapshot` | `—` | Owned named-reference marker row count is inconsistent |
| `fatal` | `snapshot_reads.py` | `_owned_named_reference_snapshot` | `—` | Owned named-reference publication is unavailable or stale |
| `fatal` | `snapshot_reads.py` | `_owned_named_reference_snapshot` | `—` | Required analytical reference is incomplete |
| `fatal` | `snapshot_reads.py` | `_owned_reference_comparison_result` | `—` | Analytical-reference identity is unavailable |
| `fatal` | `snapshot_reads.py` | `_owned_reference_comparison_result` | `—` | Owned analytical-reference publication is unavailable or stale |
| `fatal` | `snapshot_reads.py` | `_owned_series_comparison_results` | `—` | Complete-support owned-series comparison is incomplete |
| `fatal` | `snapshot_reads.py` | `_owned_series_comparison_results` | `—` | Owned series comparison provenance is incomplete |
| `fatal` | `snapshot_reads.py` | `_owned_series_comparison_results` | `—` | Owned-series active publication route is unavailable |
| `fatal` | `snapshot_reads.py` | `_owned_series_comparison_results` | `—` | Owned-series active publication route is unavailable |
| `fatal` | `snapshot_reads.py` | `_owned_series_comparison_results` | `—` | Owned-series active publication route is unavailable |
| `fatal` | `snapshot_reads.py` | `_owned_series_comparison_results` | `—` | Owned-series comparison provenance is incomplete |
| `fatal` | `snapshot_reads.py` | `_owned_series_comparison_results` | `—` | Owned-series comparison provenance revision is unavailable |
| `fatal` | `snapshot_reads.py` | `_owned_series_comparison_results` | `—` | Owned-series comparison provenance revision is unavailable |
| `fatal` | `snapshot_reads.py` | `_owned_series_comparison_results` | `—` | Owned-series comparison provenance revision is unavailable |
| `fatal` | `snapshot_reads.py` | `_owned_series_comparison_results` | `—` | Owned-series fixed comparison is incomplete |
| `fatal` | `snapshot_reads.py` | `_owned_series_comparison_results` | `—` | Owned-series fixed comparison is unavailable or stale |
| `fatal` | `snapshot_reads.py` | `_owned_series_comparison_results` | `—` | Owned-series fixed comparison is unavailable or stale |
| `fatal` | `snapshot_reads.py` | `_owned_series_comparison_results` | `—` | Owned-series fixed comparison level is incompatible |
| `fatal` | `snapshot_reads.py` | `_owned_series_comparison_results` | `—` | Owned-series fixed comparison point is unavailable |
| `fatal` | `snapshot_reads.py` | `_owned_series_comparison_results` | `—` | Owned-series focal comparison result is incomplete or invalid |
| `fatal` | `snapshot_reads.py` | `_owned_series_comparison_results` | `—` | Owned-series publication is stale or unavailable |
| `fatal` | `snapshot_reads.py` | `_owned_series_comparison_results` | `—` | Owned-series publication is stale or unavailable |
| `fatal` | `snapshot_reads.py` | `_owned_series_comparison_results` | `—` | Owned-series publication is unavailable or stale |
| `fatal` | `snapshot_reads.py` | `_owned_series_context` | `—` | Series context parent reference is ambiguous |
| `fatal` | `snapshot_reads.py` | `_owned_series_route` | `—` | Indicator has ambiguous active owned-series routes |
| `fatal` | `snapshot_reads.py` | `_owned_series_route` | `—` | Owned-series active publication route is not declared |
| `fatal` | `snapshot_reads.py` | `_owned_series_snapshot` | `—` | Owned named reference contains an undeclared axis |
| `fatal` | `snapshot_reads.py` | `_owned_series_snapshot` | `—` | Owned series declared axis point is missing |
| `fatal` | `snapshot_reads.py` | `_owned_series_snapshot` | `—` | Owned series focal curve is incomplete |
| `fatal` | `snapshot_reads.py` | `_owned_series_snapshot` | `—` | Owned series marker row count does not match its facts |
| `fatal` | `snapshot_reads.py` | `_owned_series_snapshot` | `—` | Owned-series active publication route is not declared |
| `fatal` | `snapshot_reads.py` | `_owned_series_snapshot` | `—` | Owned-series publication is stale or unavailable |
| `fatal` | `snapshot_reads.py` | `_owned_series_snapshot` | `—` | Required owned named reference is empty |
| `fatal` | `snapshot_reads.py` | `_owned_series_snapshot` | `—` | Required owned named reference is incomplete |
| `fatal` | `snapshot_reads.py` | `_owned_series_snapshot.lineage` | `—` | Owned series provenance is incomplete |
| `fatal` | `snapshot_reads.py` | `_profile_comparison_publication_marker` | `—` | Published profile comparison is stale or incompatible |
| `fatal` | `snapshot_reads.py` | `_profile_comparison_publication_marker` | `—` | Published profile comparison is stale or incompatible |
| `fatal` | `snapshot_reads.py` | `_profile_comparison_publication_marker` | `—` | Published profile comparison is stale or incompatible |
| `fatal` | `snapshot_reads.py` | `_profile_comparison_publication_marker` | `—` | Published profile comparison is unavailable |
| `fatal` | `snapshot_reads.py` | `_profile_comparison_results` | `—` | Coordinate-selected profile comparison is ambiguous |
| `fatal` | `snapshot_reads.py` | `_profile_comparison_results` | `—` | Legacy profile comparison unit is incompatible |
| `fatal` | `snapshot_reads.py` | `_profile_comparison_results` | `—` | Profile comparison cell is unavailable |
| `fatal` | `snapshot_reads.py` | `_profile_comparison_results` | `—` | Profile comparison point does not match its published descriptor |
| `fatal` | `snapshot_reads.py` | `_profile_comparison_results` | `—` | Profile comparison unit is unavailable |
| `fatal` | `snapshot_reads.py` | `_profile_comparison_results` | `—` | Profile detail comparison point is invalid |
| `fatal` | `snapshot_reads.py` | `_profile_comparison_results` | `—` | Profile scalar comparison facet is invalid |
| `fatal` | `snapshot_reads.py` | `_profile_comparison_results` | `—` | Profile scalar comparison facet is unavailable |
| `fatal` | `snapshot_reads.py` | `_profile_comparison_results` | `—` | Published profile comparison is incomplete |
| `fatal` | `snapshot_reads.py` | `_profile_comparison_results` | `—` | Published scalar profile comparison is incomplete |
| `fatal` | `snapshot_reads.py` | `_published_comparison_sources` | `—` | Published comparison provenance is incomplete |
| `fatal` | `snapshot_reads.py` | `_published_comparison_sources` | `—` | Published comparison provenance is stale |
| `fatal` | `snapshot_reads.py` | `_published_comparison_sources` | `—` | Published comparison provenance is unavailable |
| `fatal` | `snapshot_reads.py` | `_published_profile_comparison_results` | `—` | Published profile comparison has duplicate peer ranks |
| `fatal` | `snapshot_reads.py` | `_published_profile_comparison_results` | `—` | Published profile comparison has missing or duplicate results |
| `fatal` | `snapshot_reads.py` | `_published_profile_comparison_results` | `—` | Published profile comparison is incomplete |
| `fatal` | `snapshot_reads.py` | `_published_profile_comparison_results` | `—` | Published profile comparison peer rank is invalid |
| `fatal` | `snapshot_reads.py` | `_published_profile_comparison_results` | `—` | Published profile comparison peer ranks are incomplete |
| `fatal` | `snapshot_reads.py` | `_published_profile_comparison_results` | `—` | Published profile comparison peer statuses do not match group counts |
| `fatal` | `snapshot_reads.py` | `_published_profile_comparison_results` | `—` | Published profile comparison result is invalid |
| `fatal` | `snapshot_reads.py` | `_published_scalar_comparison_results` | `—` | Published scalar comparison contains duplicate peer ranks |
| `fatal` | `snapshot_reads.py` | `_published_scalar_comparison_results` | `—` | Published scalar comparison contains duplicate results |
| `fatal` | `snapshot_reads.py` | `_published_scalar_comparison_results` | `—` | Published scalar comparison is incomplete |
| `fatal` | `snapshot_reads.py` | `_published_scalar_comparison_results` | `—` | Published scalar comparison peer rank is invalid |
| `fatal` | `snapshot_reads.py` | `_published_scalar_comparison_results` | `—` | Published scalar comparison peer ranks are incomplete |
| `fatal` | `snapshot_reads.py` | `_published_scalar_comparison_results` | `—` | Published scalar comparison peer statuses do not match group counts |
| `fatal` | `snapshot_reads.py` | `_published_scalar_comparison_results` | `—` | Published scalar comparison result is invalid |
| `fatal` | `snapshot_reads.py` | `_scalar_comparison_publication_marker` | `—` | Published scalar comparison is stale or incompatible |
| `fatal` | `snapshot_reads.py` | `_scalar_comparison_publication_marker` | `—` | Published scalar comparison is stale or incompatible |
| `fatal` | `snapshot_reads.py` | `_scalar_comparison_publication_marker` | `—` | Published scalar comparison is stale or incompatible |
| `fatal` | `snapshot_reads.py` | `_scalar_comparison_publication_marker` | `—` | Published scalar comparison is unavailable |
| `fatal` | `snapshot_reads.py` | `_scalar_facet_comparison_preflight` | `—` | Declared scalar facet comparison is incompatible |
| `fatal` | `snapshot_reads.py` | `_scalar_facet_comparison_preflight` | `—` | Published scalar facet comparison is incomplete |
| `fatal` | `snapshot_reads.py` | `_scalar_facet_comparison_snapshot` | `—` | Declared scalar facet comparison is incompatible |
| `fatal` | `snapshot_reads.py` | `_scalar_facet_comparison_snapshot` | `—` | Published scalar facet comparison is unavailable or ambiguous |
| `fatal` | `snapshot_reads.py` | `_scalar_facet_descriptor` | `—` | Declared scalar facet descriptor is unavailable or incompatible |
| `fatal` | `snapshot_reads.py` | `_scalar_facet_snapshot` | `—` | Dense scalar facet observation is missing |
| `fatal` | `snapshot_reads.py` | `_scalar_facet_snapshot` | `—` | Dense scalar facet observation is missing |
| `fatal` | `snapshot_reads.py` | `_scalar_facet_snapshot` | `—` | Scalar facet observation provenance is incomplete |
| `fatal` | `snapshot_reads.py` | `_scalar_facet_snapshot` | `—` | Scalar facet observation provenance is incomplete |
| `fatal` | `snapshot_reads.py` | `_scalar_facet_snapshot` | `—` | Scalar facet publication is stale or incompatible |
| `fatal` | `snapshot_reads.py` | `_series_comparison_snapshot` | `—` | Series comparison point is not a declared axis |
| `fatal` | `snapshot_reads.py` | `_series_comparison_snapshot` | `—` | Series publication is unavailable or incompatible |
| `fatal` | `snapshot_reads.py` | `_theme_comparison_snapshot` | `—` | Profile publication is unavailable or incompatible |
| `fatal` | `snapshot_reads.py` | `_theme_comparison_snapshot` | `—` | Published scalar comparison omits a declared indicator |
| `fatal` | `snapshot_reads.py` | `_theme_comparison_snapshot` | `—` | Scalar publication is unavailable or incompatible |
| `fatal` | `snapshot_reads.py` | `_theme_comparison_snapshot` | `—` | Territory reference publication is unavailable |
| `fatal` | `typed_reading_snapshots.py` | `_demographic_reading_cloud` | `—` | Demographic cloud reading identity is ambiguous or absent |
| `fatal` | `typed_reading_snapshots.py` | `_demographic_reading_cloud` | `—` | Selected demographic cloud facts are unavailable or incompatible |
| `fatal` | `typed_reading_snapshots.py` | `_demographic_reading_cloud` | `—` | Selected demographic cloud members have missing reading facts |
| `fatal` | `typed_reading_snapshots.py` | `_demographic_reading_marker` | `—` | Demographic reading publication is unavailable or incompatible |
| `fatal` | `typed_reading_snapshots.py` | `_milieux_reading_cloud` | `—` | Milieux cloud population provenance differs from its reading |
| `fatal` | `typed_reading_snapshots.py` | `_milieux_reading_cloud` | `—` | Milieux cloud reading identity is ambiguous or absent |
| `fatal` | `typed_reading_snapshots.py` | `_milieux_reading_cloud` | `—` | Milieux cloud source binding is stale or incompatible |
| `fatal` | `typed_reading_snapshots.py` | `_milieux_reading_cloud` | `—` | Milieux cloud source component sets/windows are incomplete |
| `fatal` | `typed_reading_snapshots.py` | `_milieux_reading_cloud` | `—` | Milieux cloud state component set differs from published provenance |
| `fatal` | `typed_reading_snapshots.py` | `_milieux_reading_cloud` | `—` | Milieux source-absence publication is stale or incomplete |
| `fatal` | `typed_reading_snapshots.py` | `_milieux_reading_cloud` | `—` | Selected Milieux cloud members have missing reading facts |
| `fatal` | `typed_reading_snapshots.py` | `_milieux_reading_cloud` | `—` | Selected Milieux members have undeclared or invalid reading absence |
| `fatal` | `typed_reading_snapshots.py` | `_milieux_reading_marker` | `—` | Milieux reading publication is unavailable |
| `fatal` | `typed_reading_snapshots.py` | `_milieux_reading_marker` | `—` | Milieux reading publication is unavailable or incompatible |
| `fatal` | `typed_reading_snapshots.py` | `_milieux_reading_marker` | `—` | Milieux source-absence publication is stale or incompatible |
| `fatal` | `typed_reading_snapshots.py` | `typed_reading_descriptor` | `—` | Demographic reading descriptor is unavailable or stale |
| `fatal` | `typed_reading_snapshots.py` | `typed_reading_descriptor` | `—` | Selected-reading descriptor is unavailable or incompatible |
| `fatal` | `typed_reading_snapshots.py` | `validate_milieux_source_bindings` | `—` | Milieux source binding is stale or incompatible |

<!-- END GENERATED PUBLICATION GUARD INVENTORY -->
