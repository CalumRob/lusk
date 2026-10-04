# Verified frame-scoped official context acquisition — #658

Observed against the official IGN Géoplateforme WFS on **2026-10-04**. Read-only research; existing analytical files were not changed. Complements [the dated national archive research](map-mainland-context-source.md).

## Concrete source, not a missing external prerequisite

The official [WFS capabilities](https://data.geopf.fr/wfs/ows?service=WFS&version=2.0.0&request=GetCapabilities) advertise both `ADMINEXPRESS-COG.2025:commune` and `ADMINEXPRESS-COG.2026:commune`, alongside mutable `ADMINEXPRESS-COG.LATEST:commune`. Use a declared dated edition for this distinct context source, not an unrecorded `LATEST` alias or a CARTO variant.

The capabilities report `CountDefault=5000`, `ImplementsResultPaging=TRUE`, and **`PagingIsTransactionSafe=FALSE`**. Do not claim arbitrary multi-page acquisition from `LATEST` is an atomic snapshot.

The current representative frame has **2,302 matching communes**, below that advertised default count. A single complete frame response is therefore available without pagination or a national archive download. This is an observed count, NOT a hardcoded renderer or validation constant.

## Verified requests

Official endpoint: `https://data.geopf.fr/wfs/ows`.

Common parameters:

```text
service=WFS
version=2.0.0
request=GetFeature
typeNames=ADMINEXPRESS-COG.2026:commune
bbox=82287.65157724224,6643538.55184525,417431.64809357695,6978682.548361584,urn:ogc:def:crs:EPSG::2154
```

That bbox is the existing representative's observed frame. Production acquisition must derive its requested bbox from map-ready frame(s), not copy these example coordinates into renderer code.

1. Add `resultType=hits`. The live XML response reported `numberMatched="2302"`, `numberReturned="0"` and timestamp `2026-10-04T18:00:17.549Z`.
2. For the small inventory probe add `count=5000`, `outputFormat=application/json`, `propertyName=cleabs,code_insee,nom_officiel`, and `sortBy=cleabs A`. The live response reported `numberMatched=2302`, `numberReturned=2302`, `totalFeatures=2302`, `len(features)=2302` and 2,302 unique `cleabs` values; timestamp `2026-10-04T18:00:19.013Z`. It included `code_insee=50615`, `nom_officiel=Valognes`, `cleabs=COMMUNE_0000000000050615`.
3. Full geometry acquisition must omit the inventory-only `propertyName` (or explicitly include all required properties **and** `geometrie`) and request an explicit output CRS. **The probe in step 2 intentionally returned null geometry; do not adopt it as a land input.** Validate the actual full geometry response before promotion.

Both 2025 and 2026 framed inventory queries independently returned 2,302 unique IDs, including Valognes. Full-polygon availability was separately verified for Valognes through the dated 2025 service: `resourceID=commune.18314`, `srsName=urn:ogc:def:crs:EPSG::2154` returned one `MultiPolygon`, EPSG:2154, and approximately 26 KB of geometry JSON. The dated [DescribeFeatureType](https://data.geopf.fr/wfs/ows?service=WFS&version=2.0.0&request=DescribeFeatureType&typeNames=ADMINEXPRESS-COG.2025:commune) declares `cleabs`, `code_insee`, `nom_officiel`, `code_insee_du_departement` and `geometrie` (`gml:MultiSurfacePropertyType`). Check the selected edition's schema explicitly in implementation.

## Edition evidence and limits

The national download catalog independently identifies an official **2026-01-01** ADMIN EXPRESS COG edition; see the companion research. A read-only Rennes comparison found the existing analytical extract's population/reference properties match the dated 2026 service (`230890`, census date `2023-01-01Z`) rather than 2025 (`227830`, `2022-01-01Z`). Its exact geometry JSON matched **both** dated editions. This supports selecting explicit 2026 context while retaining the analytical extract untouched; it does not prove that every cached analytical feature has identical geometry across editions or justify changing analytical provenance.

The bounded comparison evidence is retained externally at `E:/Temp/opencode/issue-658-edition-geometry-probe.json`. Do not infer a dataset's complete vintage solely from that single municipality's population date. Record the context's actual declared edition independently.

## Acquisition and completeness contract

Perform this in a pipeline-owned acquisition/preparation command or step **before** rendering. Renderer preflight and shared ground must consume a local validated generation and never make HTTP calls.

- Identify endpoint, product/type name, explicit edition, requested bbox/CRS, output CRS, request parameters, service timestamp, acquired feature count/unique-ID evidence, and local content SHA-256 in the generation metadata.
- Verify the hits count is a finite nonnegative integer. Obtain one full response with capacity at least that count and within a verified service capacity; compare its `numberMatched`, `numberReturned`, actual array length and unique stable-ID count. They must agree with the complete expected result. An independently fetched ID inventory can additionally establish exact set equality. Reject a truncated, duplicate, malformed or inconsistent response, absent counts, OGC exception text, and malformed/empty/null/non-polygon geometries.
- Require source/output CRS and required schema fields. Verify the source acquisition bbox covers the requested frame and that the local geometry layer/manifest matches its content hash. Land polygons need not fill ocean pixels: coverage refers to the complete acquisition query, not polygon occupancy.
- If the requested complete result exceeds the supported single-response capacity, **fail loudly or use a separately validated complete official archive**. Do not silently page an inconsistent snapshot or treat a capped result as complete. The companion research supplies a dated national archive alternative.
- Stage, validate, then atomically promote. A failed initial acquisition must stop; a failed refresh must preserve the previous validated generation without presenting stale/wrong coverage as a newly successful acquisition.
- Mock counts, inventories and geometry responses in tests: especially fewer features than declared, duplicate IDs, missing geometry, wrong edition/CRS/coverage and failed refresh. Known Valognes is a regression fact, never a universal hardcoded completeness count or renderer special case.
- Retain whole official commune geometry when acquiring, then use #610's frame/profile-scoped effective identities and derivatives for rendering/reuse. Keep irrelevant/out-of-frame changes from invalidating unchanged displays.

This establishes an implementable official-source contract. Full framed geometry acquisition and its geographic/byte-parity validation remain implementation work, not an external dataset the owner must provide.
