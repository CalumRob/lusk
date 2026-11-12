# ADR-0044: Indicator-scoped canonical scalar materialization

- **Status:** Accepted — implementation decision for #989, 2026-11-12. The
  serving database publication remains the separately gated operator step.
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
   `LUSK_SCALAR_BASELINE_SORTIE` — the canonical generation the serving database
   was published from — and, under the existing scalar advisory lock
   (`pg_advisory_lock(594,1)`), compares the live markers before any write:
   - **unchanged owners** (territory reference, demographic/habitat/economy/
     milieux typed readings and the Milieux absence marker, the owned series
     dataset) must match the **candidate** artifacts;
   - **scalar and scalar comparison** must match the **prior baseline**
     artifacts, not the updated candidate (whose scalar version necessarily
     changes);
   - **declared profile** (`declared_profile`), **profile comparison**
     (`profile_comparison_publication`), the **DPE required scalar version**,
     and the **selected habitat reading** (`selected_reading`,
     `selected_reading_publication`, `selected_reading_descriptor.
     linked_content_version`) must match the **prior baseline** composite
     (profile version + baseline scalar version + reference version);
   - the **candidate profile artifact** must already be bound to the
     **candidate scalar version**;
   - candidate vs baseline must differ **exactly** by the declared scoped
     indicators (facts/descriptors/provenance/comparison identical after
     removing them; typed/series/reference/profile facts identical).
   Any mismatch — including an unreadable/invalid baseline artifact under the
   current producer contracts — hard-refuses with **zero writes** and a report
   naming each marker and expected value, instructing the operator to retrieve
   the latest canonical generation that matches serving; never to regenerate,
   force or overwrite. This is a precondition, not a second publisher.
8. Execute the scalar-bound profile companion through its normal owner, inside
   one atomic publication transaction. `refresh_declared_profile_scalar_binding()`
   reads the existing declared-profile artifacts with their prior binding,
   changes **only** the descriptor's `required_scalar_version` to the candidate
   scalar version, and re-writes the same owner artifacts through the normal
   profile transport (facts, axes, provenance and eligible territories are
   identical; DPE fact rows are untouched). It never recomputes the profile.
   The wrapper then opens **one outer transaction** via
   `with_publication_transaction()`; the existing owner adapters and typed
   readers now use `publication_transaction()`, so their inner transactions
   compose into it. Order: territory reference → scalar → refreshed profile →
   demographic/habitat selected reading → economy → Milieux/series. Any failure
   rolls back every owner and the wrapper restores the pre-refresh profile
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
- A publication is allowed only when the live serving markers match the
  candidate for unchanged owners and the supplied prior baseline for the scalar,
  its comparison, the declared profile/comparison, and the selected habitat
  linked reading; any mismatch refuses with zero writes and asks for the current
  canonical generation. The guard also proves candidate vs baseline differ only
  by the scoped indicators.
- The scalar/comparison tables remain whole-table replaces. Unchanged rows keep
  their facts, provenance and descriptors, but the table content version changes
  and scalar-bound dependents (DPE profile binding, habitat reading linked
  version) advance through their normal owners. No per-row write semantics are
  claimed.
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
