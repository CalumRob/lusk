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
snapshot or independent R export. The user's exact-code choice is implemented
separately in the API response; browser consumption remains pending cutover work.

The reference is ordered by type (commune, EPCI, département, région), then ID,
matching the static payload's stable source ordering for comparator-equal
labels. It publishes EPCI names as territories but not parent EPCI labels on
each commune, so no parent-label matching is fabricated. The 401,742-byte
shared static artifact remains for other consumers.

## ICU/Postgres exploration

Python PyICU is not installed in this worktree. SSH with the explicit
read-only key succeeded, but the SSH user cannot access the Docker socket;
`sudo -n docker ps` requires a password, and `psql` is not installed on the Pi
host. No DB credentials were inspected and no live DB query was run. Thus an
ICU French collation's availability/version on the live database is unknown.
The candidate seam avoids dependence on either database or Python ICU while
keeping final collation in the already-tested browser JS implementation.

## Measurement and operator gate

`api/scripts/measure_territory_search.py SITE_ORIGIN API_ORIGIN` reports status,
latency, bytes and cache headers for ten static and search requests without
printing response bodies. Its first sample is only the first sample; remaining
samples are sequential warm candidates, not process-cold measurements. Pi-local
first/warm comparison requires the production static origin and API loopback
origin. Browser network measurement must separately record transferred bytes,
cache status and timing. Process-cold requires an operator-approved API process
restart and timed first request; DB-cold requires separate operator setup. Do
not restart production services from this worker.

No Pi search endpoint is deployed, so there are no live API performance or
availability results. Deployment is the product owner's API Docker Compose
operation after review/merge; no database migration is needed. Do not cut over
the UI until operator deployment, Pi-local first/warm and browser transfer/cache
measurement, API outage behavior, and the product decision (API vs measured
static exception) are complete. No live DB write/deployment was made.
