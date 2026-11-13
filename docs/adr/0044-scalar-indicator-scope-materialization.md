# ADR-0044: Indicator-scoped canonical scalar materialization

- **Status:** Accepted — implementation decision for #989, 2026-11-12. The
  serving database publication remains the separately gated operator step.
  Amended by #995 (2026-11-12): the pre-write guard and the write are scoped to
  the registered scalar dependency closure instead of every retained owner.
- **Parent:** ADR-0038 (common indicator serving contract), ADR-0035 (serving
  grains and scoped comparisons), ADR-0037 (publish tables independently from
  R).
- **Authority:** the owner requires the three Mobility supply scalars to follow
  the normal publication semantics without regenerating unrelated OSM/OCS-GE
  facts or inventing a second publisher.

## Context

The canonical scalar artifact of a theme is materialized from the theme's
in-memory payload. For Mobilité that payload comes from one monolithic builder
that also computes OSM networks, OCS-GE surfaces, GTFS access and building
access. Three supply scalars merged in #953
(`stations_service`, `stations_service_1000`, `bornes_recharge_1000`) depend
only on BPE B316, IRVE and the hub-vélo population. Rebuilding the whole theme
to add them is unrelated compute; injecting rows into an old generation or
writing a one-off SQL script is not a supported publication path.

At the same time, the serving contract is a *whole-table snapshot*: the scalar
``replace`` adapter deletes and rewrites `scalar_observation`, and
`assert_complete_scalar_snapshot()` refuses an incomplete snapshot unless the
omission is an explicitly retired indicator. A "scoped publish" against the
serving database is therefore not an option; only the artifact materialization
can be scoped.

## Decision

1. Add a **closed, registered producer contract** per theme
   (`scalar_scope_registry()`). A scope names the theme, the exact registered
   indicator ids and the source ids it reads. The only registered scope is the
   Mobility supply trio; unknown themes/indicators are refused.
2. Add a generic **scoped materializer**
   (`materialize_scoped_scalar_artifact()`): it reads the current canonical
   per-theme artifact, recomputes only the scoped indicators through the
   theme's owner functions, and merges them in. Every unrelated descriptor,
   fact, provenance association, dataset and vintage row is preserved
   verbatim, in its existing order; the eligible-territory universe is the
   base's, validated equal to the current territory reference.
3. Share the producer code, never fork it. The supply aggregation is extracted
   as `agreger_ravitaillement_territoires()` and called by the full
   `agreger_offre_territoires()`; the indicator assembly is extracted as
   `assembler_indicateurs_mobilite()` and called by the full
   `construire_indicateurs_mobilite()`. Fixture tests prove equality, so the
   scoped path is the same arithmetic and shaping as the full producer.
4. Refuse producer-side stale bases. Every preserved descriptor must be
   **semantically identical** to what current metadata produces (label, unit,
   direction, facet, levels, sources, completeness, denominator semantics);
   every preserved source vintage must equal the current canonical vintage; the
   base eligible universe must equal the current reference universe at the
   retained contracts' levels. A semantic mismatch stops the materialization
   and names the indicator — a full theme regeneration is then required. These
   are producer-artifact checks; they do **not** prove the serving baseline.
5. A **documentation-only** metadata edit (for example a definition or caveat
   change that only moves `descriptor_version`) does not block preservation and
   does not rewrite the preserved descriptor: the published descriptor row is
   kept as-is and the drift is returned by the materializer for the receipt.
6. Wire the existing graph and CLI, not a bespoke script:
   - target `scalar_serving_scope`, enabled only by `LUSK_SCALAR_SCOPE`, with an
     explicit closed dependency set: the scope's four source file targets, the
     EPCI extract, the theme's `vintages_table_*`, the current artifact pointer
     and `territoires.parquet`. It cannot reach `brut_*`, `publie_*`,
     `raccordement_*` or an OSM/OCS-GE target.
   - CLI `publish-serving-tables.R --scalar-scope` (local materialization, no DB)
     and `--scalar-scope-check` (byte-check that replays the materialization in
     a temporary directory and compares the generation token).
7. Keep the full-snapshot publication path, markers and advisory locks; add a
   **pre-write serving baseline guard** plus the **atomic profile companion**.
   When a scoped publication is requested (`LUSK_SCALAR_SCOPE` set),
   `publish_retained_backend_from_parquet()` requires
   `LUSK_SCALAR_BASELINE_SORTIE` — the counterpart generation: the canonical
   generation the serving database was published from when publishing forward,
   or the published candidate when recovering. Under the existing scalar
   advisory lock (`pg_advisory_lock(594,1)`), the wrapper derives the
   **registered dependency closure** from producer metadata and declared-profile
   artifacts (amended by #995; this supersedes the all-owner guard):
   - the retained **scalar snapshot + its comparison** (whole-table writers);
   - every declared profile that carries a `required_scalar_version` binding
     (the scalar token is global, so the DPE companion is affected);
   - every typed-reading resource whose declared `source_keys` intersect those
     profile `comparison_scalar` facets (the linked Habitat selected reading);
   - the **territory reference** must match both generations and is never
     rewritten by this path;
   - the `source_dataset`/`source_vintage` rows those scalar/profile projections
     will upsert. Every target row already live must match exactly (a newer
     shared row refuses with zero writes); target-only rows may be inserted
     forward, and unreferenced inserted rows are retired in the same
     transaction. Recovery additionally retires candidate-only rows. A row is
     retired only when no base table in the serving schema references its
     `source_id`/`vintage_id` (FK-backed or text-only); shared/referenced rows
     are preserved, so unrelated owners are not cascaded or left dangling.
   Before any write, the guard requires the live markers of **that closure** to
   match the *current* generation exactly: scalar + scalar comparison,
   declared profile + profile comparison, DPE required scalar/descriptor,
   selected-reading content and linked version. Unrelated owners — demographic,
   economy, Milieux and owned-series rows **and markers** — are outside the
   plan: they are not read as expectations, not published, and a newer live
   version cannot fail a scoped publication. The same plan also proves target
   vs current differ **exactly** by the declared scoped indicators
   (facts/descriptors/provenance/comparison identical after removing them;
   profile facts/descriptors identical after removing the scalar binding;
   affected selected-reading content identical). Any closure mismatch
   hard-refuses with **zero writes** and a report naming each marker and
   expected value, instructing the operator to retrieve the exact counterpart
   generation; never to regenerate, force or overwrite.
8. Execute only the closure through its normal owners, inside one atomic
   publication transaction. Forward, the candidate declared-profile artifact is
   refreshed metadata-only to the candidate scalar version by
   `refresh_declared_profile_scalar_binding()` (only the descriptor's
   `required_scalar_version` changes; DPE facts/axes/provenance are untouched),
   then the registered scalar, profile and selected-reading publishers run.
   Recovery uses the same plan with the frozen prior baseline as target and the
   published candidate as current: the scalar publisher's normal explicit
   **retirement policy** omits the three scoped indicators from the restored
   generation (metadata still declares them, so the API reports them as
   declared-but-unpublished, exactly as before #989); the profile companion is
   restored from the baseline artifact and the linked Habitat reading from the
   baseline artifact. The wrapper opens **one outer transaction** via
   `with_publication_transaction()`; the existing owner adapters and typed
   readers compose into it through `publication_transaction()`. The active
   **connection identity** is tracked (not a process boolean): inner publishers
   join only on the identical connection; a different connection fails before
   SQL; nested outer calls are refused; the active state is cleared on every
   exit/error. Order: scalar → profiles → linked selected reading. Any failure
   rolls back every owner and (forward) restores the pre-refresh profile
   artifacts; a retry after clearing the failure succeeds. This is not a second
   publisher and not an ad-hoc SQL seed.
   The scalar `pg_advisory_lock(594,1)` serializes scalar publishers; it does
   **not** replace the operator's no-concurrent-other-owner-publish window. The
   other owners keep their own locks, so the maintenance-window prerequisite
   remains explicit and is not hidden.

## Consequences

- The three scalars can be materialized from their real light inputs in about
  half a minute, without OSM/OCS-GE recomputation and without touching
  unrelated facts, versions or the shared reference.
- The full theme producer remains the oracle for the same facts; parity is
  enforced at the shared aggregation/assembly seams and in fixture tests.
- A scoped artifact is a complete theme artifact (11 retained Mobility
  scalars), so the existing `--check`/`--publish` whole-snapshot contract,
  markers and advisory locks remain the publication path; the wrapper adds the
  baseline guard and composes the owner transactions into one atomic
  publication (with the profile companion refreshed metadata-only).
- A publication is allowed only when the live markers of the registered scalar
  dependency closure (scalar/comparison, bound profile/comparison, DPE required
  scalar, Habitat selected reading/linked version) match the current generation,
  and the target/current artifacts differ only by the scoped indicators. Any
  closure mismatch refuses with zero writes and asks for the exact counterpart
  generation. Unrelated owner markers may legitimately be newer and neither
  block nor change.
- The scalar/comparison and declared-profile tables remain whole-table replaces.
  Unchanged rows keep their facts, provenance and descriptors, but the table
  content version changes and scalar-bound dependents (DPE profile binding,
  habitat reading linked version) advance through their normal owners. No
  per-row write semantics are claimed. Demographic, economy, Milieux and
  owned-series rows and markers are not read or written by the scoped path.
- Recovery is the same normal wrapper/plan in the opposite direction: the
  frozen prior baseline is the target and the published candidate is the current
  guard state. The registered scalar retirement policy omits the three scoped
  indicators (declared but unpublished), and the same atomic transaction
  restores the baseline profile and linked Habitat reading without touching
  newer unrelated owners.
- A semantic metadata change to an unrecomputed indicator fails loudly and
  requires the full theme path; this is deliberate — the scoped path cannot
  silently relabel an old fact.
- The worker never connects to the serving database. The operator performs the
  backup/window/identity checks and the normal publication step.

## Rejected alternatives

- Full five-theme `tar_make()`: recomputes unrelated OSM/OCS-GE and Milieux for
  three light facts.
- A bespoke R script or SQL writing the three rows: not a registered, tested,
  reviewable publication capability; bypasses provenance/version/lock
  semantics.
- A scoped DB upsert: contradicts the whole-table snapshot and the complete-
  snapshot guard; would desynchronise the table marker from the row set.
- Reusing the Oct-2026 generation as an **unverified** baseline: it predates
  #953 and does not contain the three resources; as a *declared prior baseline*
  it is a valid input only when the live serving markers match it, which the
  guard now proves before any write. Using it without that proof is rejected.
