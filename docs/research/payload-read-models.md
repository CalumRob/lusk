# Payload read models — baseline and alternatives

Date: 2026-09-15  
Issue: #532  
Decision: ADR-0031

## Current behavior

`usePayload()` starts every payload file on its first use. Route wait-sets only
control when a surface renders; they do not control which files are fetched,
parsed, validated, or retained. A minimal consumer waiting only for
`territoires` currently starts sixteen files in the fixture-backed regression
loop, and a complete production snapshot starts the remaining dependent theme
files as their indicator tables resolve.

Variant E is not atomic. Its Mobilité `ThemeContent` additionally consumes
`profils_acces_bpe`, `distribution_acces_batiments`, and
`rampe_acces_batiments`, but these files are absent from the territory route's
wait-set. Content can therefore gain sections after its first resolution.

## Reproducible baseline

Run from `app/`:

```sh
npm run benchmark:payload
```

The harness reads the committed real payload, then times UTF-8 decoding,
`JSON.parse`, the production validators, ingestion into the current flat arrays,
and `TerritoryFacts` plus `ThemeContent` resolution for Rennes (`35238`). It is a
local Node measurement, not a browser-network benchmark; it isolates the CPU
and allocation work that compression cannot remove.

Representative uncontended run on 2026-09-15:

| Stage | Time |
|---|---:|
| Read six Mobilité inputs | 55 ms |
| Decode UTF-8 | 76 ms |
| Parse JSON | 357 ms |
| Validate | 757 ms |
| Append validated indicator/reading rows | 2 ms |
| Resolve Rennes `TerritoryFacts` + `ThemeContent` | 885 ms |
| **Total** | **2,132 ms** |

The first uncontended run measured 1,901 ms total; repeated runs remained in the
same order of magnitude. Exact timings vary with filesystem cache and concurrent
CPU load, so the harness reports observations rather than enforcing a brittle
millisecond threshold.

### Mobilité inputs used by a complete territory reading

| Artifact | Raw bytes | gzip bytes |
|---|---:|---:|
| `territoires.json` | 179,431 | 16,073 |
| `indicateurs_mobilite.json` | 52,650,101 | 1,106,183 |
| `histoires_mobilite.json` | 1,520,154 | 137,684 |
| `profils_acces_bpe.json` | 1,466,333 | 64,109 |
| `distribution_acces_batiments.json` | 38,020,211 | 556,983 |
| `rampe_acces_batiments.json` | 33,231,959 | 452,338 |
| **Total** | **127,068,189** | **2,333,370** |

This is 126,268 territory, indicator, reading, profile, grid-cell, and ramp-point
rows after validation. The tiny ingestion timing shows that the main local costs
are parsing, structural validation, and repeatedly deriving one territory's
semantic facts from global peer populations.

## Alternatives

| Alternative | Startup time | Deployment and maintenance | Cacheability and freshness | Accessibility | Verdict |
|---|---|---|---|---|---|
| Compression plus lazy theme files | Avoids unrelated themes, but selected Mobilité still parses ~125 MB of theme/evidence JSON | Small loader change; retains current global contracts | Stable files are simple to refresh, but every theme refresh invalidates a broad object | Independent evidence arrivals can change the reading tree after first render | Immediate mitigation only |
| One static read model per territory and per indicator | Loads only the bounded facts required by the visited surface; territory comparison results are materialized once upstream | Adds deterministic projection, nested-file cleanup, parity tests, and recursive deploy-diff detection | Individual surfaces are independently cacheable; snapshot/version metadata keeps freshness explicit | A territory arrives as one stable semantic unit rather than progressively inserting sections | **Chosen (ADR-0031)** |
| Browser Parquet, Arrow, or DuckDB | Reduces bytes but still downloads broad analytical tables and performs client-side query work | Adds a decoder/query runtime and another browser compatibility surface | Static and cacheable, but broad files invalidate together | Delays stable content and increases failure modes before meaningful HTML exists | Reject for route loading; DuckDB remains eligible at build time |
| Pre-rendered territory HTML | Can produce a fast first document | Duplicates semantic rendering and still needs interactive comparison/map data | Excellent CDN caching, but couples data refresh to a second rendering stack | Good only if hydration and interactive states preserve the server document | Reject as primary data model |
| Runtime API or database | Can return narrow responses | Introduces operations, availability, secrets, and query contracts for immutable snapshots | HTTP caching is possible but freshness now depends on a runtime service | Adds a new failure/loading boundary without improving the semantic contract | Not justified by current product needs |

## Preferred architecture

- Canonical Parquet remains authoritative and downloadable.
- A post-canonical build step publishes one complete model per territory and one
  complete model per indicator.
- Pipeline table boundaries are not browser loading boundaries. Mobilité's
  profile, distribution, and ramp tables remain separate internally if useful,
  but their relevant evidence is folded into the consuming read model.
- Territory models carry precomputed comparison scope, rank, and references;
  they do not embed broad peer populations merely to repeat pipeline work in the
  browser.
- Indicator models retain the peer rows needed for URL-selected interactive
  scopes. Their dependency closure comes from page metadata rather than names.
- Small shared indexes remain for territory search, the indicator catalogue,
  sources, freshness, and shared map geometry. The indicator read-model route
  index is generated as `modeles-lecture/manifest.json` from the same
  `indicator_pages.read_model` declarations; the renderer does not carry a
  second list of migrated indicator names.
- No runtime API, database, browser SQL engine, or browser Parquet dependency is
  introduced.

## Immediate mitigations versus migration

True demand-driven fetching is necessary, but changing the current eager store
alone is unsafe: theme discovery, comparison derivation, and Variant E still
depend on broad files. Demand-driven behavior should land with each migrated
surface so the new route does not start the legacy global loader.

Compression and cache headers should be measured and documented, but they do
not replace bounded read models. The current Pi already gzips JSON.

## Smallest useful migration slice

Start with the scalar `demographie/densite` Page d'indicateur:

1. Materialize its artifact from canonical Parquet using its pinned page
   descriptor.
2. Validate the local artifact contract in the browser.
3. Route only manifest-listed pages (currently
    `/indicateurs/demographie/densite`) through the new loader, keeping the
    existing path as fallback for unmigrated indicators.
4. Assert that this route never requests `indicateurs_demographie.json` or
   unrelated payload files.
5. Follow with a descriptor that has a companion dependency, then materialize
   atomic territory models, where comparison values and Mobilité evidence make
   the larger architectural payoff.

The scalar slice does not solve the territory-page delay by itself. It is the
smallest end-to-end proof of the post-Parquet projector, nested static paths,
local validator, demand-driven route loader, fallback migration, and deploy
behavior without first porting every browser-side comparison calculation into
the pipeline.

## Territory-model release rehearsal

The compact territory slice was materialized from the complete canonical JSON
snapshot on 2026-09-16. The first full rehearsal completed in 560.43 s; the
final contract was then regenerated successfully as 1,268 six-theme artifacts:

| Measure | Raw bytes | gzip bytes |
|---|---:|---:|
| Complete 1,268-file set | 284,994,943 | 33,470,165 |
| Largest artifact (`commune/35238.json`) | 245,112 | 27,277 |
| Representative commune (`commune/22001.json`) | 224,079 | 26,006 |

The representative compact artifact is roughly 0.2% of the 127 MB raw legacy
Mobilité dependency set and arrives with all six themes as one validated unit.
Validation compared its resolved Mobilité `ThemeContent` with the legacy
projection for a commune with an EPCI, a commune without one, an EPCI, a
département, and the Région; all five retained observable semantic parity.

The numbers measure local materialization, byte size, validation, and semantic
resolution. They are not a WAN latency claim: production transfer timing still
depends on the host, cache state, and client connection.
