# ADR-0041: Request-time declared-profile detail comparisons in fixed contexts

- **Status:** accepted — product owner through PRD #952 §13.1, 2026-11-11; implemented by #960.
- **Parent:** ADR-0039; narrow exception to its published-fixed-aggregate policy for detail-backed declared profiles.

## Context

ADR-0039 publishes fixed-context comparison aggregates and has the API serve
them instead of recomputing peer facts per request. For a declared profile it
publishes the descriptor's declared comparison facet — one detail/sex point.

`reseaux_par_habitant` declares three published details (`t_km_1000`,
`b_km_1000`, `c_km_1000`) but its descriptor's comparison point is the bike
detail. The Mobilité « Réseaux » figure must read a reference for each network;
before #960 a `fixed_comparison` accepted only the published default point, so
the only honest fixed response compared all three readings against the bike
facet. Publishing every non-default detail for every fixed cohort would add a
row set and a content version per detail, duplicating facts already committed
as profile cells, solely for points a figure requests explicitly.

## Decision

For **detail-backed declared profiles only**, a `fixed_comparison` accepts
exactly one declared value per profile axis:

- The descriptor's **published default detail/sex point** keeps the published
  comparison projection and its version/lineage checks. Nothing changes for the
  existing default response or its fast path.
- An **explicitly requested non-default declared point** resolves the same
  canonical fixed cohort (the context's resolved density class, EPCI, Bretagne
  or same-level group) and is computed per request from that cohort's committed
  published profile cells in the caller's single repeatable-read snapshot. It
  uses the same median, direction-aware `rank`/`rank_size`/`rank_ties`,
  missingness, per-detail unit, denominator semantics and source lineage as an
  identical explicit selection.
- **No additional publication rows, schema change, migration or pipeline
  metadata change** is introduced. The request-scoped point is not published
  and does not add a comparison generation.
- The fixed-profile result stays **compact**: `member_ranks` remains a
  selected-comparison projection and is rejected (`422`) for fixed profile
  comparisons, default and alternate points alike. Scalar fixed comparisons and
  selected profile comparisons keep their existing `member_ranks` support.
- A **scalar-backed profile** (for example the DPE distribution) keeps its
  linked scalar comparison facet: `fixed_comparison` rejects profile
  coordinates (`422`) because the facet is that scalar, while
  `selected_comparison` retains its existing coordinate semantics.
- Empty or omitted coordinates mean no coordinate selection. Unknown, partial
  and multi-value coordinates remain `422`.
- Batch preflight charges the set-wise peer cell read (resolved members ×
  declared cells) rather than one keyed focal row. No per-peer query loop is
  introduced, and the ordinary work/output bounds are unchanged.

## Fail-closed authority

A request-scoped non-default point validates the `declared_profile` and
`territory_reference` publication generations and the cohort's per-cell
provenance; missing or stale cells fail closed with `503`. It deliberately does
**not** depend on the `profile_comparison_publication` generation, which owns
the published **default** facet. A missing default comparison marker therefore
fails the default read closed while the alternate point still serves from the
same committed cells. This split is intentional and contract-tested.

## Consequences

- ADR-0039 remains the policy for the published default facet and for every
  other currently offered fixed context; it is not retired.
- Only explicitly requested declared details pay the request-time cohort read;
  default reads and other readers are unchanged.
- Fixed and an identical explicit selection agree coordinate for coordinate,
  and single and batch reads share one snapshot.
- The extension is API-only and does not authorize app, pipeline or publication
  changes; #954 consumes it, and widening it to arbitrary coordinates or other
  comparison families requires a new owner decision.

## Not decided here

No wholesale replacement of published fixed aggregates, no new comparison
publication shape, and no change to direction/eligibility policy.
