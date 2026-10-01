# #627 — Mobility scalar batch

This batch registers only the canonical scalar facts `surface_reseaux_routiers`, `offre_tc`, and `bornes_recharge` from `indicateurs_mobilite.parquet`. The shared scalar serving, canonical projector, complete snapshot assembler, publisher, adapter, transaction/lock, marker, and partial-snapshot guard are reused; no consumer cutover is included.

The R-produced Parquet remains authoritative for values, units and one-source provenance. Producer metadata declares the eligible levels including Région, sparse completeness, self comparison facets, `not_available` for bare canonical NA, and unavailable support/denominator counts (`counts_available: false`). The percent values remain the producer's fractions even though the published unit is `%`; no conversion is performed. Services shares stay with their specialized registered projector.

Remaining Mobility obligations (not included in this batch): remaining ordinary scalars/ratios, declared compositions and household-car/cycling/network profiles, other networks, the cumulative connection curve/reference, and residual map/theme/read-model consumers. No static artifact or ranks are claimed retired. Live publication, consumer cutover, API deployment, latency evidence, and operator rollout remain separate gates.
