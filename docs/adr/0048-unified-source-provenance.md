# ADR-0048: Unified source provenance — lockfile, derived vintages, attributed locks, release freeze

- **Status:** accepted — decision 2026-11-21, issue #1103. **Supersedes ADR-0047** (opt-in source pins and derived vintage).
- **Related:** ADR-0001, ADR-0004, ADR-0047 (superseded); CONTEXT.md « Version de table publiée »; issue #1105 (real-data relock).

## Context

ADR-0047 made content pinning opt-in for three sources (`osm_reseaux`, `bornes-recharges`, `korrigo`). That solved the dishonest vintages for three sources only and left an asymmetry: the other manifest sources still published declared or stale vintages, real-data lock failures could not distinguish "the input moved" from "the code broke", and there was no release-level freeze — only a per-source pin list. A single system is needed for attribution, freshness and release control.

## Decision

### 1. The four vintage bases

Every manifest source declares **exactly one** basis, explicitly, from this closed vocabulary:

| basis | used for | published vintage |
|---|---|---|
| `declaree` | dated releases whose identity is the vintage (RP 2023, DVF 2025, BPE 2025, OCS-GE millesimes, frozen snapshots) | the declared version/date |
| `contenu_date` | file carrying its own update date (bornes `date_maj`) | that date, else acquisition date |
| `contenu_timestamp` | OSM PBF HeaderBlock `osmosis_replication_timestamp` (field 32, after inflating the zlib blob) | that date, else acquisition date |
| `telechargement` | rolling exports with no stable content date (ODS `exports/csv`, Grist, data-fair/DPE, SIRENE, SNCF GTFS, DILA `all_latest`, live `latest` aliases) | acquisition date of the bytes actually used |

There is no implicit default and **no load-time mutation of the manifests**: the registry is resolved at the use sites (`download_sources()`, `vintages_depuis_manifest()`, `relock_sources()`) through `base_vintage(id)` / `declarer_bases(manifest)`. An unknown id fails loudly — there is no `DESCRIPTION` Collate dependency and no namespace rewriting. A contract test enumerates every `MANIFEST_*` and asserts each id resolves to exactly one valid basis. When a content date cannot be read for a derived basis, the honest fallback is `telechargement`. HTTP `Last-Modified`/`ETag` is never a vintage (ODS exports send neither). A source whose manifest declares no single reference/publication date (ORT line-by-line actualisation, DPE rolling base) never gets one invented from the acquisition clock. Without a run digest (a theme builder called outside a run), the declared vintage stands — no acquisition can be attested; every real run publishes the derived value.

### 2. One committed lockfile

`pipeline/sources.lock.json` is ONE committed file (like `renv.lock`) with one record per source: `{source_id, url, sha256, bytes, acquired_at, vintage_basis, vintage, date_reference}`. It is simultaneously:

- the **attribution baseline** — locks compare the run's digests to it;
- the **release freeze** — publication refuses unless the run's digests equal it, with zero writes;
- the **replacement for pins** — `SOURCES_EPINGLEES`, the `pins/` registry and `repin-source.R` are retired; ADR-0047 is superseded.

The first three records are seeded from the ADR-0047 pins, keeping their sha256 and dates exactly. Other sources have no record in this PR (issue #1105 performs the real-data relock). A source absent from the lockfile has **no baseline**: drift attribution reports "no baseline" and publication refuses.

Determinism: when the run's bytes hash to the lockfile record, the resolver uses the record's `acquired_at`/`vintage` verbatim — clock-free. Two cold rebuilds from the locked bytes publish identical vintages.

`resoudre_source()` stays the single resolver; `ecrire_atomique()` remains the atomic-write helper. A deliberate `Rscript pipeline/scripts/relock-sources.R <run-dir> [source_id...]` rewrites records from a run's digests in one atomic write; a failed write keeps the old file.

### 3. Recorded digests

Every run writes `source-digests.json` beside the payload, covering every source actually read. The resolver hashes each file once (a second hash of the 330 MB PBF is avoided) and writes a per-cache sidecar recording the file name, size and mtime; a sidecar is trusted only while all three still match the cached bytes — any replacement forces a re-hash and a fresh vintage. Records are de-duplicated by `source_id` (latest wins) in both the run file and the cache aggregate. `vintages_depuis_manifest()` consumes the valid sidecars and publishes the derived value for **every** source, keeping the `cache=` plumbing. `source-digests.json` is excluded from the cron diff-skip decision, like `run-report.json`.

**Non-manifest network reads.** Coverage is not limited to `MANIFEST_*`: the three Admin Express WFS layers fetched by `publier_geometrie()` are declared as `geometrie_{communes,epcis,departements}` with basis `telechargement`, hashed once per run and entered into both the coverage contract and the release freeze. Every network read in `pipeline/R` is audited structurally: a `download.file`/`httr2`/ analogous call must either be covered by such a digest (manifests via `resoudre_source`, DPE via its `api` pull, geometry via `publier_geometrie`) or sit in an explicit allowlist with a reason (AEDAR's operator `--check` acquisitions are a separate artifact outside the seven-theme run). A new, unlisted network read fails the suite. AEDAR inputs are separately frozen by their own content pins (`sha1` in `AEDAR_SOURCE_RESOURCES`, `sha256` in `AEDAR_TYPEQU_METADATA_RESOURCES`, both verified on acquisition) and live outside this lockfile.

### 4. Attributed lock failures

A failing `verif_*` compares its inputs (from `VERIFICATIONS_RUN`'s `args`, or every theme source for `sur_brut`) to the lockfile using the run's digests:

- at least one input differs, or has no baseline → **data drift**: "données : dérive de `<source>` depuis `<date lockfile>`, relock requis", with expected/observed, reported in the run report, **not fatal**;
- every input equals the lockfile and the value moved → **code regression**: "régression de code : entrées identiques, sortie modifiée", **fatal**.

Because publication requires every digest to equal the lockfile, a regression cannot be masked by drift up to publication. The `rapport_*` targets depend on the `verif_*` targets and aggregate their returned attributions, so a drift from the same run is in that run's `run-report.json`.

### 5. Release freeze

ONE guard, `verifier_gel_release(sortie, ...)`, is placed **where a serving-DB connection is opened** — never inside an inner function that merely receives a `con`. `sortie` is REQUIRED with no implicit default: each caller names the exact directory its projection/artifacts are read from, and the structural audit rejects a no-argument guard call. Production never branches on whether it is under test. It guards the `LUSK_PUBLISH_DB` target, the `LUSK_SCALAR_SCOPE`/scoped path, all `publish-serving-tables.R` publishing modes, `publish-aedar-aggregates.R --publish`, declared profiles and the operator connection via `run_pipeline`. It refuses with zero writes when the run's digests differ from the lockfile, with a named reason (`digests_absents`, `sans_reference`, `derive`, `empreinte_absente`). There is deliberately **no mtime staleness rule**: the operator flow is build → `relock-sources.R <that run>` → commit the lockfile → publish that run, so the committed lockfile is necessarily newer than the run's digests, and a checkout/merge can reset its mtime. Freshness comes from content equality plus the publication targets' dependency on `digests_run`. Publication targets depend on `digests_run`, so the guard reads THIS run's `source-digests.json`. Cron and static builds never call it. Coverage is **structural**: a test scans every `dbConnect(`/`configuration_service_postgres(` call in `pipeline/R` and `pipeline/scripts`, requiring a `verifier_gel_release(` call in an enclosing branch or an explicit allowlist entry with a reason (`lusk_it_*` fixtures, read-only `--check`, the #1072 recovery bridge); a new unguarded path fails the suite. The `offre_tc` bridge (#1072) stays an out-of-scope recovery tool.

## Consequences

- Rolling exports publish the acquisition date of the bytes actually used, not a stale contract label. Dated releases keep their vintages exactly.
- Cron adopts upstream byte changes (no hard pin failure), records the new digest and derives the vintage; a release requires a deliberate relock commit.
- Lock failures become actionable; real-data relock and the two byte-identical cold rebuilds are moved to #1105 and the operator window (no serving-DB connection here).
- A new manifest source must declare a basis or its first use fails loudly — the asymmetry of ADR-0047 is closed.
- The run report is a dependency of the `verif_*` targets and carries their drift attributions as values, not as a stale side file.
- Determinism is proven at fixture scale on the real `scalar-serving` producer: two clock dates over the same locked bytes yield byte-identical artifacts.
