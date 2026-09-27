# ADR-0036: Means for interactive building-access peer curves

- **Status:** accepted
- **Decision:** product owner, 2026-09-27
- **Supersedes:** ADR-0034's fixed-scope, pooled-building peer ramp rule
- **Parent:** ADR-0033 (R/Parquet authority and bounded read-only serving)

The product must let a person assemble a peer group interactively. Both figures
in Variant E's building-access distribution set use the comparison metric type
**mean** (`moyenne`) in the semantic serving contract. The label component owns
French syntax; neither the data pipeline nor the figure renderer composes a
literal such as "Groupe comparé — moyenne".

The ramp retains **eleven positions for each of three modes**. Each territory's
position is its R-published quantile of buildings. For every position and mode,
the selected group's point is the mean of its members' corresponding points,
weighted by each member's **ramp `total_buildings`**. It describes an average
of territory curves, **not** the quantiles of all buildings pooled across the
group. Fractional peer ordinate values are expected; neither the API nor the
app rounds them to a building-level percentile. A group with fewer than two
available member curves has no comparison, even when the focal territory has
no local ramp. The distribution grid retains its building-weighted cell shares:
each share is the mean of a building's binary membership in that cell. The grid
may be removed in a later product pass; do not redesign it as part of this
decision.

R and the canonical per-territory Parquet remain the authority for counts and
quantile points. Use the ramp's own building counts and commune assignment for
its weights and membership; do not substitute the snapshot indicator
`nb_buildings`. The two inputs disagree for Allineuc (168 versus 174) because
their building-to-commune assignments differ. Whole selected territories must
be resolved into **distinct communes**, with overlapping parents counted only
once. Reject unbounded, unknown or partially published selections; a serving
read must use one committed publication. There is no browser database access.

This ADR changes the meaning of the peer comparison, not the selected
territory's quantiles. A pure serving calculation and focused tests may precede
the endpoint and physical schema; the existing essential-services API does not
yet serve either building figure. It does not authorize a production migration
or require a disposable-Postgres performance gate while the app has no users.
