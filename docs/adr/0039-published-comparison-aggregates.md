# ADR-0039: Publish aggregates for declared comparison contexts

- **Status:** accepted — product owner, 2026-10-08.
- **Parent:** ADR-0033; refines the comparison-serving direction in ADR-0035 and ADR-0038.
- **Implementation:** #727, under performance objective #726.

## Decision

For every currently offered comparison context, compute its peer-derived numeric results from canonical pipeline data and publish them as a comparison projection. The API serves those published results for current contexts instead of loading all peer facts and recomputing their aggregates per request. This applies across current comparison families, including scalar/profile, ordered-series, essential-services, building-access, and numeric period/detail collections. The inventory is contract-tested so an in-scope family cannot silently be omitted.

The currently offered contexts include the commune choices (density class, EPCI, Bretagne) and fixed level-specific contexts already exposed by product contracts. A declared context resolves to a peer group; compute group-level statistics once per distinct group and declared facet. Territory-specific results such as rank remain territory-specific. Preserve each family's statistic, direction/tie behavior, weighting, support and missingness semantics, source lineage, and response contract.

The comparison projection is separate from source facts because it has a different grain. Use one shared publication and API-read mechanism over a small number of constrained result shapes. Share a physical shape only where the data contracts genuinely fit; do not create one unconstrained generic EAV/JSON table or a bespoke publication/read mechanism per family. The precise DDL and shape assignment remain implementation decisions under #727.

Aggregates are refreshed in step with the canonical serving data they summarize and are read as a coherent published result. Publication identity tracks the contributing data snapshot; it does **not** require peers to share a source vintage. In particular, OCS-GE comparisons retain their declared territory-specific M2→M3 windows and associated provenance. A mixed-vintage peer group is valid when its source facts declare it so.

Explicit arbitrary territory selections remain request-time comparisons. This includes future user-defined peer groups; no combinatorial set of custom groups is precomputed. Raw peer observations needed by visualizations (for example, reading-cloud points) remain raw. No browser static fallback is introduced.

## Consequences

- Default reads avoid fetching every peer observation solely to calculate group statistics.
- The publisher validates comparison outputs against canonical inputs and preserves the previous complete publication on failure.
- API reads serve published results corresponding to the current comparison context and compatible data snapshot; source-vintage equality is not a compatibility condition.
- Existing query-path optimizations remain useful for explicit selections.
- ADR-0035's request-time calculation remains the policy for dynamic selections; this ADR changes the target for currently offered fixed contexts. ADR-0036's mean/weighting rules remain unchanged; its statement that precomputed fixed-context curves are not required is superseded for currently offered contexts only.

## Not decided here

This ADR does not dictate table names, one physical table per shape, a global release marker, production DDL, deployment, or publication. Those belong to reviewed implementation work under #727 and operator-controlled rollout.
