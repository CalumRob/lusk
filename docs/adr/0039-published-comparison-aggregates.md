# ADR-0039: Publish aggregates for declared comparison contexts

- **Status:** accepted — product owner, 2026-10-08; publication-grain refinement accepted 2026-10-13; comparison-scope revision accepted 2026-10-14.
- **Parent:** ADR-0033; refines the comparison-serving direction in ADR-0035 and ADR-0038.
- **Implementation:** #727, under publication/artifact-grain umbrella #751 and performance objective #726.

**AEDAR scope amendment (#810, owner-approved 2026-10-21):** the AEDAR-specific
peer/rank projection in this ADR is superseded. Keep the source-grain facts,
serve commune EPCI/Bretagne references directly from `aedar_territorial_aggregate`,
use the existing pooled density artifact with `aedar_comparison_group`, and retain
only EPCI/departement same-level median summaries. AEDAR publishes no
territory/member/rank rows or peer eligibility counts. Other comparison families
and this ADR's shared publication approach are unchanged.

## Decision

For every currently offered comparison context, compute its peer-derived numeric results from canonical pipeline data and publish them as a comparison projection. The API serves those published results for current contexts instead of loading all peer facts and recomputing their aggregates per request. This applies across current comparison families, including scalar/profile, ordered-series, numeric period/detail collections, and AEDAR fixed-context comparisons. The inventory is contract-tested so an in-scope family cannot silently be omitted.

**Owner scope revision (2026-10-14):** essential-service comparison summaries are deprecated and are not a current comparison family. The non-AEDAR BPE/building-access comparisons are superseded by AEDAR comparisons and are not a current family either. The AEDAR comparison contract below is the in-scope access-comparison path.

The currently offered contexts include the commune choices (density class, EPCI, Bretagne) and fixed level-specific contexts already exposed by product contracts. A declared context resolves to a peer group; compute group-level statistics once per distinct group and declared facet. Publish two logical result grains: group statistics by resolved context/group and declared comparison facet or axis point; and territory-specific comparison results (including ranks and ties) keyed by that same grain plus territory. Preserve each family's statistic, direction/tie behavior, weighting, support and missingness semantics, source lineage, and response contract.

The comparison projection is separate from source facts because it has a different grain. Use one shared publication and API-read mechanism over a small number of constrained result shapes. Share a physical shape only where the data contracts genuinely fit; do not create one unconstrained generic EAV/JSON table or a bespoke publication/read mechanism per family. Canonical Parquet artifacts follow independently versioned, constrained serving projections across themes, rather than theme bundles or one file per indicator; descriptors and provenance belong to the corresponding coherent publication unit. Exact physical DDL, file names and shape assignment remain implementation decisions under #727/#751.

Aggregates are refreshed in step with the canonical serving data they summarize and are read as a coherent published result. Each comparison projection has its own content version and records the exact input publication versions it summarizes, including the relevant territory-reference version. Publish changed dependencies atomically where they share a publication transaction; otherwise retain the last complete projection but have the API fail closed when its recorded inputs no longer match current publications. No global release marker is introduced. Publication identity tracks the contributing data snapshot; it does **not** require peers to share a source vintage. In particular, OCS-GE comparisons retain their declared territory-specific M2→M3 windows and associated provenance. A mixed-vintage peer group is valid when its source facts declare it so.

AEDAR's existing EPCI and Bretagne comparisons continue to use their direct territory aggregates. The commune density-class comparison is a distinct address-grain projection: pool member-commune address facts and apply the existing AEDAR territorial-aggregate contract, including its measures, address denominators, sparse-record zero treatment and coverage/null behavior. Do not derive it by averaging commune aggregates. It uses `2026-v1` as the shared AEDAR source-snapshot identity, has its own projection content version, and records the territory-reference publication version that determines density-class membership. Publish it coherently with the related AEDAR aggregate when their inputs change.

Explicit arbitrary territory selections remain request-time comparisons. This includes future user-defined peer groups; no combinatorial set of custom groups is precomputed. Raw peer observations needed by visualizations (for example, reading-cloud points) remain raw. No browser static fallback is introduced.

## Consequences

- Default reads avoid fetching every peer observation solely to calculate group statistics.
- The top-level R publisher validates comparison outputs against canonical inputs and preserves the previous complete publication on failure.
- API reads serve published statistics and territory-specific comparison results corresponding to the current comparison context and compatible input publications; source-vintage equality is not a compatibility condition.
- Existing query-path optimizations remain useful for explicit selections.
- ADR-0035's request-time calculation remains the policy for dynamic selections; this ADR changes the target for currently offered fixed contexts. ADR-0036's mean/weighting rules remain unchanged; its statement that precomputed fixed-context curves are not required is superseded for currently offered contexts only.

## Not decided here

This ADR does not dictate table names, one physical table per shape, production DDL, deployment, or production publication. Those belong to reviewed implementation work under #727/#751 and operator-controlled rollout.
