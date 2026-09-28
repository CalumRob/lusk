# ADR-0037: Publish independently versioned serving tables from R

- **Status:** accepted — product owner, 2026-09-28
- **Parent:** ADR-0033 (R/Parquet authority → Postgres projection → bounded read-only API)

The desktop R pipeline owns publication of each validated serving table to both
its canonical local Parquet and Postgres on the Pi. The Pi never needs those
Parquet files. R uses DBI with a PostgreSQL driver, connecting directly from
the publishing PC via libpq and the operator's private password file. SSH is
used separately for copying API code, not for publishing tables. A table's content version is independent of other
tables and includes the facts and metadata that affect its meaning. Replacing
one changed table must not rewrite unchanged tables or Parquet files; a DB version
behind an unchanged local Parquet version must be retried after a failed
connection or database rebuild. A grouped transaction may commit several
changed tables and their individual markers together without creating a global
publication version. Reads that combine tables pin one database snapshot and
report the relevant table versions or a derived token.

Normal refreshes use the existing `targets` graph to decide **before expensive
computation** which source and compute stages are outdated. Database publication
is an explicit, opt-in leaf after the final shared reference and vintages: only
this leaf runs on every requested DB publication to check table markers and
retry a failed upload. It does not force its upstream compute targets to rerun,
and it is absent from the unattended static-site cron graph.

This replaces the combined access-plus-building fingerprint and joint refresh
introduced in the narrow building-access prototype. A new serving table
requires a declared grain and validation, an explicit addition to the
fresh-install schema, a numbered migration for the existing database, and a
registered R publisher/read contract. R never auto-creates Postgres tables
from an arbitrary frame. Existing static JSON continues only while its current
consumer needs it; new database-served facts acquire no JSON mirror by default.

**Why:** canonical computation and publication stay in one place, retries are
safe after partial cross-system failure, and future indicator slices do not
force unrelated facts to republish. The previous Python importer duplicated a
publication seam and refreshed access and building facts together whenever
either changed. Validating a changed table is a bounded pass over its already
computed rows, not a rerun of the whole pipeline or a performance benchmark.
