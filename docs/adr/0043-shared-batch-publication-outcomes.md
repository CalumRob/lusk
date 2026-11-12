# ADR-0043 : Shared typed publication outcomes for batch reads

- **Status:** accepted (owner decision 2026-11-12, issue #984; supersedes the
  atomic-only availability stance of ADR-0040 for batch reads)
- **Date:** 2026-11-12
- **Related:** #983 (PRD), #984 (API), #797/#689 (semantic contract)

## Context

ADR-0040 made every semantic batch atomic: an absent, stale or incompatible
publication dependency rejected the whole request with `503`. That is the right
law for integrity failures, but it also made *one unpublished resource* look like
a failed page. The client then discovered and retried resources individually,
producing request fan-out and HTTP `503` storms (recorded cold flow: 48 HTTP,
47 POST, 14 HTTP `503`). Missing publication is not a numeric zero and must not
be fabricated; it is also not necessarily a request-level failure.

The owner approved one shared versioned batch outcome contract across all
declared resource families, including AEDAR, with no permanent Mobility
exception. v1 remains a migration bridge only.

## Decision

1. `POST /api/resources/read-batch` accepts an optional top-level
   `"contract": "semantic-read-batch-v2"`. Omitting it keeps the v1 response and
   its atomic failure semantics exactly.
2. A v2 response has one result per requested item, in request order:
   - `status: "available"` with the unchanged `data` payload, or
   - `status: "publication_unavailable"` with a closed `reason`
     (`publication_absent`) and declared `family`. The family is derived from
     the producer resource declaration, never from which lookup failed: a
     comparison intent on an ordered series still names `ordered_series`, and
     a scalar/profile comparison names its resource family. No data, version,
     rank or zero is invented.
3. Only the explicit server-side `PublicationUnavailable` guard type
   (`api/publication_outcomes.py`) may become an item outcome. The executor
   never matches English messages and never catches `HTTPException` broadly.
   V2 first admits actual target/member/cohort identity and declared level
   before any publication absence can become an outcome, so a bad identity is
   never masked by an unpublished resource. V1 keeps its historical precedence
   and its exact status/detail strings during migration.
4. These remain whole-request failures in both contracts, with no partial
   envelope: `404` identity/member, `422` malformed/unknown/field/coordinate,
   `413` work/byte bounds; SQL/schema/pool/service faults; a failed or changed
   snapshot; the shared `territory_reference` clock; stale/incompatible global
   dependency versions; conflicting/incomplete provenance; malformed or
   incomplete published rows; ambiguous producer declarations and incompatible
   facet contracts. Database errors are never treated as missing publication.
5. Preflight still runs for every item before any read, on one
   `READ ONLY REPEATABLE READ` snapshot. An unavailable item consumes at least
   one work unit and is not read. The 200,000-unit and 8 MB bounds are
   unchanged; the client packing budget (at most 12 items per semantic request)
   is unchanged. All available items in a v2 batch keep exact values, ranks,
   units, clocks and provenance.
6. Publication guards are classified guard-by-guard in
   [`api/publication-guard-inventory.md`](../../api/publication-guard-inventory.md),
   generated from source and checked by a contract test. A new guard cannot be
   added, or a fatal guard silently softened, without recording its class.
7. All-unavailable is a valid `200` envelope. It must not trigger automatic
   resource-discovery retries; only an explicit refresh may re-probe a later
   publication. Client acquisition/coalescing remains a separate issue (#985).

## Consequences

- The API gains a typed outcome vocabulary; no new route, storage, publication
  or schema is introduced.
- Existing clients and single reads are untouched until they opt into v2.
- Consumers must treat `publication_unavailable` as an item state, not as a
  retryable request error, and must not parse `detail`.
- The migration from v1 to v2 and the later consumer migration are separate
  operator-controlled steps. This ADR authorizes no deployment, data
  publication, R pipeline run or frontend release.
- Builds and schemas are additive: v1 and v2 share the same request item
  grammar; only the optional `contract` field and response envelope differ.
