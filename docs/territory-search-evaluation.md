# Territory search API seam and measurement gate (#582)

## Implemented backend contract (not a browser migration)

`GET /api/territories/search?q=...&limit=...` reads the existing R-published
`territory_reference` in a read-only repeatable-read transaction. Query length
is 1–64 characters and must contain a non-whitespace character. `limit` is
1–50 (default 8). The response includes reference publication identity, an
optional exact-code match, and a bounded `candidates` window. It selects only
the `type/id/name` fields, scans at most 1,500 rows (over-bound fails closed),
and returns no more than 1,500 candidates. Missing publication fails 503;
invalid request values fail 422. No schema or R publication change is needed.

Text matching mirrors the current JS scoring (exact, prefix, word-start,
substring) and normalization (NFD, U+0300–U+036F removal, lowercase,
`œ`/`æ` expansion, straight/curly apostrophe, hyphen and whitespace folding).
Codes do not participate in text matches. Only an exact full code match is
returned separately; it cannot crowd textual results. The API orders candidate
groups by score and raw name length, retaining the whole boundary tie group.
Within that group the client must call the existing
`rechercherTerritoires(candidates, q, limit)` for the final French
`localeCompare('fr')` order and result cap. This is an explicit locale-ordering
seam: the Python service does not guess collation or return a false final order.
The JS utility's current tests cover the final French ordering and cap; API
tests cover retaining boundary ties, normalization, exact-code separation and
the repository contract. Run
`node --experimental-strip-types api/scripts/verify_search_parity.mjs` for the
cross-language differential: Python generates candidate windows, then the actual
JS `rechercherTerritoires` runs over those candidates and its top-eight IDs are
compared with the JS full-reference search for every one of 1,262 unique names
(1,268 territory rows). The local check passed. This establishes candidate and
final ordering parity against the current static artifact, not a live database
snapshot or independent R export. A separate read-only, repeatable-read query
against the live Pi publication on 2026-09-28 checked all 1,268
`territory_reference` rows (content-version prefix `6648ff769603`) against the
current `territoires.json`: zero missing/extra IDs and zero mismatches in type,
public name, département or EPCI ID. This establishes the live reference's
identity/name parity at that snapshot, but not a future publication's parity.
The user's exact-code choice is implemented separately in the API response;
the browser continues to use its existing static name search, so exact-code
lookup is not surfaced in the UI under this measured exception.

The reference is ordered by type (commune, EPCI, département, région), then ID,
matching the static payload's stable source ordering for comparator-equal
labels. It publishes EPCI names as territories but not parent EPCI labels on
each commune, so no parent-label matching is fabricated. The 401,742-byte
shared static artifact remains for other consumers.

## ICU/Postgres exploration

Python PyICU is not installed in this worktree. SSH with the explicit
read-only key succeeded, but the SSH user cannot access the Docker socket;
`sudo -n docker ps` requires a password, and `psql` is not installed on the Pi
host. The independent live reference comparison above used a local read-only
database transaction without printing or copying credentials; the worker did
not run that query. ICU collation was not inspected. Thus an
ICU French collation's availability/version on the live database is unknown.
The candidate seam avoids dependence on either database or Python ICU while
keeping final collation in the already-tested browser JS implementation.

## Deployment and measured static exception (2026-09-28)

`api/scripts/measure_territory_search.py SITE_ORIGIN API_ORIGIN` reports status,
latency, bytes and cache headers for ten static and search requests without
printing response bodies. The product owner deployed the reviewed API through
Docker Compose. The Pi's `/api/health` returned 200/ok; the deployed `api/main.py`
hash matched the reviewed file. Read-only smoke requests returned the expected
Rennes text candidates, exact-code result for `35238`, and complete building
access facts for Allineuc (33 ramp rows and 30 grid rows). No database migration
or write was needed.

Pi-loopback run: ten sequential requests per path; the first sample is not a
process-cold measurement. Static `/data/territoires.json` returned 389,060 body
bytes; first sample 96.07 ms, all-sample median 2.865 ms, with nine subsequent
samples between 2.38 and 3.55 ms. Search returned 289 body bytes; first sample
42.53 ms, all-sample median 42.0 ms and p95 49.83 ms. The static p95 is 96.07 ms
because the ten-sample set includes its slower first request. Both paths meet
the working local <1 s P95 target; an already-loaded static reference gives
lower per-query latency.

External public-origin spot checks from the orchestrator client (five sequential
`curl` requests, not an instrumented browser) returned 200 for both paths. With
gzip, the static payload transferred 25,624 bytes and search transferred 224
bytes. Observed times were 85–132 ms for static and 107–158 ms for search.
The static response had a weak ETag; neither response exposed `Cache-Control`,
and both returned `cf-cache-status: DYNAMIC`. These measurements do not establish
browser cache-hit behavior or real-user latency distributions. The OpenChamber
browser confirmed the live homepage loads, but its tools do not expose a network
waterfall or cache timing.

**Product decision:** retain the existing static browser search as a measured
exception; do not cut the browser over to the API. The shared territory reference
is still needed by other browser consumers, so moving search alone would not
remove its initial transfer. Once loaded, local static search is about 3 ms,
versus about 42 ms through the Pi API (and 107–158 ms in these small public-path
samples). The API remains healthy and within the target, but the measured result
does not justify adding a network request to each debounced search. Keep the
bounded API route as a serving seam; reconsider this exception if the shared
reference is removed from browser bootstrap or new measurements materially
change the trade-off. No browser code was changed; text matching and French
ordering remain the established client implementation.

Process-cold and DB-cold timings were not measured: they require separately
approved service/database setup. Browser transfer/cache waterfall, API outage
behavior after a browser cutover, and a browser API migration are consequently
not claimed or performed. See the recorded decision and raw sample details on
[#582](https://github.com/CalumRob/lusk/issues/582).
