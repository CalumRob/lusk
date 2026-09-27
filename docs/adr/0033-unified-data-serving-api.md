# ADR-0033 : One API serving path for structured product data

- **Status:** accepted
- **Date:** 2026-09-27
- **Decision:** #569

## Context

ADR-0003 chose static data because the original payload was small and the
browser had no adjustable queries. ADR-0031 later chose static per-Territoire
and per-Indicateur **Modèles de lecture** to avoid downloading large theme
tables. Both were reasonable for their product needs. The new access comparison
changes the question: readers need bounded but adjustable peer sets, medians
and direction-aware ranks. Serving every choice as another static projection
would multiply artifacts, freshness rules and browser loaders. The access
slice (#571, #572) now reads canonical R Parquet through Postgres and a bounded
read-only API, without a browser database credential or JSON prerequisite.

## Decision

**Structured product data has one target serving path:** the R pipeline owns
computation and canonical Parquet; validated, changed datasets are published
atomically to Postgres; the browser reads them through bounded, read-only API
contracts. The browser never queries SQL directly. The API does not decide
source facts or silently reimplement the R pipeline. Publication and reading
use separate database roles, and a failed dataset refresh preserves the
previous complete result. New product-data surfaces should not introduce new
static Modèles de lecture by default.

Static files remain appropriate for **application assets and canonical Parquet
exports when offered**, not as a second general product-data serving path. A
small bootstrap asset (including a search index) needs a measured exception;
territory search should first be considered through the API. Large images and
rendered static maps may eventually live in a cloud object bucket/CDN: those
are **media delivery**, not a second source of structured facts. The API or
published metadata may identify an asset; this ADR chooses no bucket provider,
upload workflow, or map-tile architecture. Vector/spatial *facts* do not
automatically become image assets.

Existing static read models keep working **during migration only**. Migrate a
surface once its API contract and equivalence tests are ready, then retire its
static read path. This temporary coexistence is not a permanent hybrid serving
strategy and is not authorization for a big-bang rewrite.

## Alternatives considered

1. **Extend bounded static editable views.** Preserves the current static
   deployment and Vercel failover, but each new adjustable comparison enlarges
   publication and browser contracts. A fixed list could work for a fixed
   report, not the emerging interaction without limiting it in advance.
2. **Permanent static + API hybrid.** Keeps some current surfaces cheap but
   leaves two freshness, validation, failure and UI loading paths indefinitely.
   For Lusk, that ongoing duplication is costlier than a staged migration.
3. **Postgres-backed API for product data (chosen).** One read contract and
   dataset-level publication seam, with query-time bounded comparisons. It adds
   a runtime dependency and an operational/failover obligation. This is not a
   general SQL endpoint, a rewrite of R in SQL, or an immediate migration of
   every existing page.

## Evidence and limits

The first access dataset contains **19,020 observations**. Its operator-run
canonical Parquet publication took **9.06 s** end to end. Seven opt-in
real-Postgres integration tests passed, including a failed refresh retaining
the previous complete dataset, changed/unchanged publication, a read-only
role and an updated value through the HTTP contract. The public API matched
the independently R-published Allineuc rank **19/38**. Twenty warm,
sequential requests per scope through Pi-loopback nginx measured P95 **24.4
ms** (own EPCI), **100.5 ms** (density), and **454.5 ms** (Bretagne), all under
the agreed **1 s Pi-local P95** verification bound at this data size. These
numbers do **not** establish internet latency, all-page capacity, or a
product-wide performance promise. On the same Pi, the first Bretagne data
request after an **API-only process restart** (after `/api/health` was ready)
returned HTTP 200 in **0.515 s**. PostgreSQL's cache was *not* cleared: this is
process-cold, not a database-cold benchmark. Docker separately reported about
**1.7 s** for the container restart; that time and the wait for health are
**not included** in the 0.515 s request, and this was not an end-to-end outage
measurement. A read-only storage snapshot at
19,020 observations showed **14 MB** for the four access-serving tables
(including their indexes/TOAST) and **21 MB** for the entire `lusk` database.
One snapshot cannot demonstrate storage growth across repeated changed runs.

The Pi remains the primary host (ADR-0006), with Postgres and API behind
nginx/Cloudflared. As more pages rely on the API, Pi/database availability
and the old static-only Vercel failover become a product risk. Before removing
the last static consumers, define a truthful outage/failover behavior; do not
silently return stale static comparisons as though they were live. Likewise,
dataset publication is currently operator-run rather than automatically tied
to every R build (#572): plan a reliable refresh/monitoring path before a
site-wide dependency. Database-cold queries, repeated-refresh storage growth
and backup capacity must be checked against each representative new dataset
before that surface switches; the access slice is evidence, not a whole-site
benchmark.

## Phased adoption

1. **Keep the verified access slice** while agreeing on its reader-facing
   curated reading and which controls readers may change. Reuse the
   `densite|epci|bretagne` Contexte de comparaison policy from #555/#558 where
   this is a commune fiche; do not invent a second page-wide default or URL
   convention. Product defaults belong in semantic/published facts, not a
   renderer literal; the present API does not itself define the final UI.
2. **Ship one browser surface using the API**, with explicit loading, missing
   data and outage states and tests against canonical R values and provenance.
   Existing pages remain static until individually migrated.
3. **Migrate one existing surface at a time.** For each, choose a bounded API
   read contract, prove data/semantic parity with its static model, check cold
   and warm latency plus publication/storage costs, deploy, then remove that
   surface's static fetch and artifact if no other consumer remains.
4. **Consolidate operations and delivery.** Revisit publisher scheduling,
   monitoring, backups and Vercel failover before removing all static fallbacks.
   Add a media bucket only when actual image/map volume justifies it. Keep
   canonical Parquet independent of browser serving; making every dataset
   downloadable is not a launch prerequisite.

This changes ADR-0003's *target* static-first serving rule and supersedes the
long-term static read-model choice in ADR-0031; neither earlier ADR becomes
false about why it was made or how existing pages work today. ADR-0004's
static-file cron and ADR-0006's tag/timer frontend release remain in place for
unmigrated pages, but their static-only Pi/failover assumptions no longer
describe the target data-serving architecture.
