# Territory search API seam and measurement gate (#582)

## Implemented seam (not a browser migration)

`GET /api/territories/search?q=...&limit=...` reads the existing R-published
`territory_reference`, in a read-only repeatable-read transaction. Query length
is 2–64 characters, trimmed-nonempty; limit is 1–50 (default 8). Response
contains the matching query, `type/id/name` results, and an identity derived
from the territory-reference content version. Missing publication fails 503;
invalid parameters fail 422. No migration, new serving table, R publication
change, credential, or browser fetch is introduced.

Matching uses the current client score bands and accent/ligature normalization;
codes are also searchable and participate as substring matches. Ties use name
length, case-folded name, then stable identity. Note: Python's case-fold sort is
not guaranteed byte-for-byte equivalent to JavaScript `localeCompare(..., 'fr')`;
representative and full-index parity must be checked before any client cutover.
The current JSON has parent EPCI IDs on communes, but the canonical reference
does not publish parent EPCI labels on each commune. Search is over the labels
actually canonical in the reference (including EPCI rows), not a fabricated
parent-label join. No territory JSON is retired: it remains required by other
consumers.

## Measurement procedure

`api/scripts/measure_territory_search.py SITE_ORIGIN API_ORIGIN` reports status,
latency, bytes and cache headers for ten static and search requests, never the
response bodies. Run at the Pi using the production static origin and loopback
API origin to isolate Pi-local first/warm paths; run again from a representative
browser network to capture transfer, CDN/browser cache behavior, and remote
latency. Report cold as the first request after an approved API process restart
(not database cold unless the operator separately arranges it), plus warm
median/P95; do not restart any production service without operator approval.
Capture browser transferred/resource size, cache status, and request timing in
DevTools. Existing static file is 401,742 bytes locally. Compare that with the
bounded search response and acknowledge the one-time static download versus
per-keystroke debounced requests. Keep the existing UI static until measurements,
semantic parity (including accented names, codes, EPCI labels/ties), availability,
and owner decision support cutover.

The environment's SSH attempt `ssh -o BatchMode=yes lusk-agent@calum-pi` was
denied (`Permission denied (publickey,password)`); no credentials were inspected.
The API endpoint is not deployed, so a production search latency comparison is
an explicit operator/deploy gate. The existing catalog route returns the full
reference and is not a substitute for measuring a bounded search response.
