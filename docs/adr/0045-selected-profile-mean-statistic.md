# ADR-0045: Explicit equal-weight means for selected declared-profile comparisons

- **Status:** accepted — owner decision in #979, implemented by #996
- **Date:** 2026-11-12
- **Related:** #979 (PRD), #996 (API), ADR-0039, ADR-0041, ADR-0043

## Context

Mobilité page 2 compares a focal commune with the other eligible Breton communes
for the network figures (`reseaux`, `reseaux_par_habitant`, `offre_cyclable`).
The owner approved one equal-weight arithmetic mean of the selected communes,
not a population-weighted rate and not a stack of independently published
medians: each eligible commune counts once, with its native unit. The producer
facts are already additive across the Geovelo total/protected/shared partitions
for the same commune population; the obstacle was the median-only selected
comparison projection in the API.

ADR-0039 publishes fixed-context comparison aggregates (medians) and ADR-0041
computes a request-scoped declared point from committed profile cells. Neither
authorizes reconstructing a fixed cohort with another statistic, nor adding a
second comparison publication.

## Decision

1. The selected-comparison intent accepts an optional closed `statistic`:
   `median` or `mean`. Omitting it preserves every existing resource default —
   the published/dynamic declared-profile **median**, the owned series'
   declared mean, and every other family's statistic. `statistic` is an intent
   selector, never a `fields` flag: `fields` keeps its projection-only meaning.
2. An explicit `mean` is declared only for **detail-backed declared profiles**
   (`declared_profile` selected comparisons). Scalar profiles (their linked
   scalar facet), scalars, owned series, collections and AEDAR selections
   reject it with `422`; fixed comparisons cannot carry it at all. The server
   never silently chooses a mean from an unrelated flag and never reinterprets
   a published fixed median as a mean.
3. The mean is the equal-weight arithmetic mean of the **actual measured member
   values** for the requested detail point, computed per request from the same
   committed snapshot as the median. A measured `0` is a valid value; a
   missing/suppressed/unsupported cell is excluded and never converted to zero.
   With no eligible member the result is `unavailable` with a null mean and no
   fabricated population. With one eligible member the mean is that value
   (ranks still require two comparable values, unchanged from #917).
4. Every mean result carries a bounded, API-owned `eligible_members` list: the
   resolved commune identities that actually contributed, in stable order. It is
   derived from those measured cells, is not projectable away by `fields`, and
   lets a consumer prove that a total and its partitions use one population
   instead of comparing counts. Per-detail coverage may honestly differ; the
   consumer must refuse an incoherent stack rather than have the server shrink,
   weight or fabricate the group. No common-basis override is added.
5. An explicit mean never reads the published default/fixed comparison
   projection or its marker: it follows the same request-scoped
   declared-profile/reference/cell-provenance gates as an identical explicit
   selection, and returns the same direction-aware served ranks, units (raw and
   per-capita detail units), denominator semantics and source lineage. The
   existing `profile_content_version` and `reference_content_version` clocks
   remain the dependencies; no global release token is synthesized.

## Consequences

- The request grammar gains one optional, closed intent property; default
  responses, `fields` validation and every other statistic are unchanged.
- No schema, migration, R/pipeline work, fixed-mean publication row or new query
  framework is introduced; the work units stay the existing selected-member
  estimate and the 200,000-unit/8 MB bounds apply.
- The bounded identity list is at most the resolved member bound (1,500 typed
  members) and is charged inside the existing response envelope.
- Consumers choose the mean explicitly. A client that requires an additive
  total/protected/shared stack must compare `eligible_members` across the three
  responses and refuse when they differ.
- ADR-0039 stays the policy for published fixed medians; ADR-0041 stays the
  request-scoped declared-point rule. Neither is widened to other statistics.

## Not decided here

No mean for scalars, owned series, collections or AEDAR; no fixed mean
publication; no population weighting; no UI, scheduling or pipeline change.
