# Territory search API seam and measurement gate (#582)

## Implemented seam (not a browser migration)

`GET /api/territories/search?q=...&limit=...` reads the existing R-published
`territory_reference`, in a read-only repeatable-read transaction. Query length
is 1–64 characters, trimmed-nonempty; limit is 1–50 (default 8). Response
contains the matching query, `type/id/name` results, and an identity derived
from the territory-reference content version. Missing publication fails 503;
invalid parameters fail 422. The query projects only three identity/label
columns and is capped at 1,501 scanned rows (over 1,500 fails closed). No
migration, new serving table, R publication change, credential, or browser fetch
is introduced.

Matching follows the current client score bands and normalization: NFD,
U+0300–U+036F removal, lowercase, `œ`/`æ` expansion, and straight/curly
apostrophe, hyphen and whitespace collapsing. It matches names only; codes do
not match. Python's standard library cannot guarantee JavaScript
`localeCompare(..., 'fr')` ordering. The backend therefore returns 503 when
multiple matching names share a score and raw name length, rather than emitting
an unproven order. This is a deliberate fail-closed seam, not full parity. A
one-character query is accepted but can hit this limitation often on the full
index. Code search is a separate product option for owner decision; it is not
current UI behavior.

The existing JSON contains parent EPCI IDs on communes, but the canonical
reference does not publish parent EPCI labels on each commune. Search covers
labels canonical in the reference (including EPCI rows), not a fabricated
parent-label join. Shared territory JSON remains required by other consumers.
The local curated test cases exercise name matching, accents, apostrophes,
hyphens, EPCI labels, codes (negative case), and tie failure. Live published
reference differential/golden parity remains unverified: this worker did not
have read access to the Pi publication, and the local static JSON is not claimed
as a verified live DB fixture.

## Measurement procedure

`api/scripts/measure_territory_search.py SITE_ORIGIN API_ORIGIN` reports status,
latency, bytes and cache headers for ten static and search requests, never the
response bodies. The first sample is only the first sample; the remaining nine
are sequential warm-path candidates. It does **not** measure process-cold.
Run at the Pi using the production static origin and loopback API origin to
isolate Pi-local first/warm paths; run again from a representative browser
network to capture transfer, CDN/browser cache behavior, and remote latency.
Process-cold requires a separately approved API process restart and timed first
request (not database cold unless the operator separately arranges it). Do not
restart any production service without operator approval. Capture browser
transferred/resource size, cache status, and request timing in DevTools. The
local static file is 401,742 bytes. Consider the one-time static transfer versus
debounced per-query API requests. Keep the existing UI static pending semantic
parity, availability, measurements, and owner decision.

SSH without explicit identity was denied earlier. The orchestrator reports the
read-only key `$HOME/.ssh/lusk_pi_ed25519`; this worker did not use it. The API
endpoint is not deployed, so no Pi search latency data exists. Production
comparison remains an operator/deploy gate; no live database or deployment was
changed.
