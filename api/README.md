# Interactive data-serving spike (#569)

This is **not deployed** and does not replace the static site. It tests one bounded
read contract with FastAPI + psycopg against PostgreSQL. R remains the computation
owner; the database holds a serving projection of its published outputs. There is
no endpoint for arbitrary SQL or user-supplied lists of peers.

## Sources and grain

| Published input (`public/data/`) | Serving projection |
| --- | --- |
| `territoires.parquet` | `territory_reference`: identity, EPCI, département and density-class reference for this publication; territory type is matched against the validated indicator facts |
| `indicateurs_mobilite.parquet` | `essential_service_access`: one territory × service × mode × publication; nullable share as a **fraction** in 0–1, despite its `%` display unit |
| `pipeline/inst/extdata/theme-metadata/theme_mobilite.json` | Pipeline-owned descriptor of declared share keys, indicator labels and source IDs; validated Mobilité shares use the pipeline's `high` direction unless explicitly declared otherwise |
| `vintages.parquet` | Source version, name and dates attached to served observations |

The importer reads **canonical Parquet**, not published JSON or route-scoped
models. The theme descriptor is a pipeline-owned configuration file, not a
published browser payload. A future R-to-Postgres publisher may send these
validated tables directly without a Python Parquet reader; neither approach
requires publishing JSON. The importer validates all three modes for every
published territory and service. Null means unavailable, never zero. It does not
manufacture building denominators from the separately published building count.

`import_publication()` loads a new content-addressed version and switches the
active pointer **in one transaction**. Invalid input never reaches the DB. The
old version is retained for in-flight reads and deliberate cleanup; no DROP,
TRUNCATE, migration of existing tables, or automatic removal is performed.
One API request reads one active version in a repeatable-read transaction;
successive requests may observe different versions.

## API contract

`GET /api/territories/commune/{code}/essential-services?comparison=densite|epci|bretagne`
defaults to the commune's published density class. EPCI means **the commune's own
EPCI** in this first slice. The server derives peers from published reference
fields, excludes nulls from each statistic, calculates the median for each
service/mode and the median of each peer's car/foot gap and bike/foot gain.
Ranks use published direction (`1 + strictly better peers`); ties share their
rank, the next position skips, and the returned size counts peers with a value.
The number of scope members is distinct from each indicator's comparable count.
The territory's measured shares do not change when its comparison changes.

This spike does **not** implement an interactive indicator page, arbitrary
searched-territory comparisons, legacy `iso_*` pages, or a generic site-wide
indicator store. A contrasting `low` direction is covered in contract tests,
but actual `iso_*` facts are not loaded by this first table. Whether to rank a
singleton peer group in future contracts is still to be decided: this slice
follows the generic R ranking rule (1/1); some current read models suppress it.

## Local verification

From the repository root in a Python virtual environment:

```text
pip install -r api/requirements-dev.txt
python -m pytest api/tests
python -m api.importer --check public/data
```

No PostgreSQL is needed for those checks. Before any database publication, an
operator must review `schema.sql`, apply it to a **designated test database**,
configure a separate publishing credential as `PUBLISH_DATABASE_URL`, and run
`python -m api.importer public/data`. The API takes a *different, read-only*
`DATABASE_URL`; give it SELECT on the three serving relations it reads and no
write permissions. Credentials must never be copied to `/srv/lusk/api`.

The database-backed endpoint, publication rollback and query latency still
require a disposable PostgreSQL integration test and representative Pi
measurements before #569 can select this architecture. See
[`README-deploy.md`](README-deploy.md) for an optional, operator-run deployment
recipe; no live Pi changes are part of this slice.
