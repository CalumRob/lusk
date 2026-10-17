# Lusk read API

The API exposes bounded, read-only HTTP reads of data published by Lusk's R
pipeline into PostgreSQL. The pipeline owns calculations, descriptors, source
lineage and publication; the API validates publication dependencies and serves
typed projections. It is not an arbitrary SQL interface, a computation service,
or the owner of source facts.

## Start here

- [Endpoint reference](ENDPOINTS.md) — every registered business operation,
  inputs, bounds, response-contract pointers and availability behavior.
- [Semantic resource contract](batch-read-contract.md) — current discovery at
  `GET /api/resources`, single reads at `POST /api/resources/read`, and atomic
  batches at `POST /api/resources/read-batch`; producer-declared targets,
  coordinates, intents, fields, and bounds.
- [Field selection contract](field-selection-contract.md) — current resource-owned
  projection rules and mandatory response metadata.
- [Historical theme-read contract](theme-read-contract.md) — retired theme and
  comparison route shapes retained for migration context only; those routes are
  not supported by the current API.
- [Database migrations](migrations/README.md) — fresh-schema versus additive
  migration guidance (not authorization to apply either).
- [Historical API notes](README-history.md) — retained design, test and
  operations evidence from earlier API slices. It is archival, not current
  deployment guidance; do not execute its one-off commands.

## Run locally

From the repository root, in the project's Python environment:

```sh
python -m pip install -r api/requirements-dev.txt
python -m uvicorn api.main:app --reload
```

The local API listens on `http://127.0.0.1:8000`; interactive Swagger is at
[`/api/docs`](http://127.0.0.1:8000/api/docs) and its schema at
[`/api/openapi.json`](http://127.0.0.1:8000/api/openapi.json). The schema is
generated from the running FastAPI application. Regenerate the endpoint
reference inventory after route/request-schema changes with
`python -m api.scripts.generate_endpoint_inventory`; verify it is current with
`python -m api.scripts.generate_endpoint_inventory --check`. Both commands
derive from the existing app without a database connection.

Run the ordinary, database-free API suite with:

```sh
python -m pytest api/tests
```

Database-backed integration tests are separately guarded and opt-in. Read
[`tests/integration/README.md`](tests/integration/README.md) before considering
them; never target a serving database. Documentation and OpenAPI generation do
not need PostgreSQL or `DATABASE_URL`.

## Availability and deployment boundary

The repository describes what this source revision can serve. It does not
establish which revision, schema, publications, or endpoints are currently
installed in any live environment. Check the deployed source/schema/publication
versions with the operator before relying on a route. Routes can return `503`
when required publication markers are absent or stale, or dependent published
tables are incompatible; this is intentional fail-closed availability, not an
empty successful result. Missing focal records and invalid inputs have their
own `404` and `422` behavior; see the endpoint reference and OpenAPI for the
operation's declared responses.

The API's deployment requires an operator-provisioned PostgreSQL read role and
private runtime configuration, an initialized compatible schema, and coherent
published data. R publication is a separate, owner/operator-controlled path.
The operator-owned, gitignored `README-deploy.md` and private deployment
configuration are intentionally outside this public source documentation.
This README authorizes no migration, publication, deployment, production
connection, application consumer rollout, or security-boundary change. Public
Swagger/OpenAPI makes the read contract discoverable; it is not an
authentication or security boundary.

## Reading contracts

Responses preserve producer-owned status/availability, units and axes, source
and vintage provenance, and independent publication/version metadata. Omitted
facts remain unavailable rather than becoming zero; a failed dependency check
does not imply that a route is unsupported or that its data is empty. The API
does not promise a single global release version or production performance
characteristics. Examples in the endpoint reference use illustrative IDs only;
they do not define producer-domain policy.
