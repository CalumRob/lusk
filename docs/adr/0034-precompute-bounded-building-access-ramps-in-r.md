# ADR-0034: R precomputes the bounded building-access comparison ramps

- **Status:** accepted
- **Decision:** product owner, 2026-09-27
- **Parent:** ADR-0033 (canonical R/Parquet → Postgres projection → bounded read-only API)

Variant E's existing building-access ramp shows eleven quantile points for
each of three modes, both for the selected territory and its comparison group.
These are quantiles of **buildings**, not of territories. The published
territory-level points lose the information needed to compute a group's
quantiles: for Allineuc's 38-commune EPCI, weighting commune 50th-percentile
points gives approximately 12.22 accessible types while the pipeline's
building-level group calculation gives 7. Averaging the points would change
the figure's meaning and return an incorrect peer ramp.

**Decision:** preserve the ramp and its comparison meaning. R computes the
curves for the product's currently supported, bounded peer scopes from the
building-level input and publishes the results as **canonical Parquet** with
scope identity, quantile order, denominator, availability and provenance.
Postgres stores a validated serving projection of those precomputed curves;
the read-only interface resolves a target and its declared scope and looks up
the matching points in one committed publication. SQL does **not** average
territory quantiles or derive new arbitrary peer scopes. The currently
generated territory read models already contain these R-computed comparison
curves, but their JSON is **not** the canonical input to Postgres.

The alternative of publishing a per-territory × mode histogram and computing
type-1 quantiles in SQL was considered. It could support additional bounded
scopes but publishes more detail, moves a statistical rule into the serving
layer and adds work per request without a current product need. Replacing the
peer ramp with means would be cheaper still, but changes the reading; even the
existing `avg_div_*` support counts cannot simply be substituted (Allineuc's
`nb_buildings` is 168 while the published ramp covers 174 buildings). These
alternatives are not forbidden forever; adopting either requires a new product
decision and a parity/cost evaluation.

The distribution grid is a **different** evidence grain: its cell counts can
be summed over eligible territories to produce exact building-weighted peer
shares. Offline comparisons for commune density/EPCI/Bretagne, Breton EPCIs
and Breton départements matched the R-published cell counts and denominators.
This does not authorize a new SQL schema, endpoint or production migration:
the publication unit, shared territory ownership and physical read cost remain
under the separately proposed ADR-0035. Do not ship the ramp read until the
new Parquet artifact, publication validation and disposable-Postgres parity
tests prove complete curves and correct absent/no-comparison behavior.
