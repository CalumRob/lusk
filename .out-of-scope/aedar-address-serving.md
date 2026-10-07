# AEDAR Address-Level Serving

For the current AEDAR 2026-v1 rollout, Lusk will publish the four official
territorial aggregate resources to Postgres, but will not migrate the six
address-level resources into the database or expose them through the proposed
bounded API.

## Why this is out of scope

Publishing the territorial aggregates has already taken longer than is
acceptable for this rollout. The owner estimates that the address-level data
would take roughly 100 times as long to publish. That operational cost is not
justified for the current territory-focused serving need. Keep the territorial
aggregate product; do not attempt a full address-level database import under
the current design.

This is a scope decision about database serving, not a claim that address data
is absent from the source. Reconsider only if a concrete address-level use case
and a materially different storage/query approach are proposed and explicitly
approved by the owner.

## Prior requests

- #695 — “Serve sparse AEDAR address records through bounded reads”.
- #693 — “Integrate full AEDAR address and territorial data into the serving API” (parent scope narrowed to territorial aggregates; see #694).
