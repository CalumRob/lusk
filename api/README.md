# Interactive data-serving spike (#569)

This slice does not replace the static site. Its earlier API image has been
deployed on the Pi; the current single-dataset schema is **not deployed**. It tests one bounded
read contract with FastAPI + psycopg against PostgreSQL. R remains the computation
owner; the database holds a serving projection of its published outputs. There is
no endpoint for arbitrary SQL or user-supplied lists of peers.
ADR-0031 continues to govern today's static read models; #569 investigates a new
interaction and publication need, not a silent reversal of that decision. No
existing renderer is changed by this spike.

## Sources and grain

| Published input (`public/data/`) | Serving projection |
| --- | --- |
| `territoires.parquet` | `territory_reference`: identity, EPCI, département and density-class reference for the current dataset; territory type is matched against the validated indicator facts |
| `indicateurs_mobilite.parquet` | `essential_service_access`: one territory × service × mode for the current dataset; nullable share as a **fraction** in 0–1, despite its `%` display unit |
| `pipeline/inst/extdata/theme-metadata/theme_mobilite.json` | Pipeline-owned descriptor of declared share keys, indicator labels, source IDs and effective directions; its directions are contract-tested against the R ranking registry |
| `vintages.parquet` | Source version, name and dates attached to served observations |

The importer reads **canonical Parquet**, not published JSON or route-scoped
models. The theme descriptor is a pipeline-owned configuration file, not a
published browser payload. A future R-to-Postgres publisher may send these
validated tables directly without a Python Parquet reader; neither approach
requires publishing JSON. The importer validates all three modes for every
published territory and service. Null means unavailable, never zero. It does not
manufacture building denominators from the separately published building count.

`import_publication()` validates canonical inputs, then replaces **only the
essential-service dataset** with transactional DELETE/INSERT. The current
publication identifier, row count and regional scope label are updated in the
same transaction. Invalid input never reaches the DB; a database error rolls
the entire refresh back. Committed readers see either the previous complete
dataset or the next complete dataset. No old facts are retained in Postgres:
to return to an earlier snapshot, republish its canonical Parquet and matching
pipeline metadata. `TRUNCATE` is intentionally not used. Concurrent publishers
are serialized with an advisory transaction lock. The API uses a repeatable-read
snapshot per request; successive requests may observe different refreshes.

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

### Existing database migration (operator-run; not automatic)

`schema.sql` is a **fresh-install schema**, not an in-place migration of the
currently deployed versioned tables. Do not apply it to live `lusk` without the
explicit migration and API cutover plan in [`README-deploy.md`](README-deploy.md).
The user has authorized deleting the old serving rows after test verification;
this does not authorize deleting unrelated data or silently rebuilding the Pi.

From the repository root in a Python virtual environment:

```text
pip install -r api/requirements-dev.txt
python -m pytest api/tests
python -m api.importer --check public/data
```

No PostgreSQL is needed for those checks. Before any database publication, an
operator must review `schema.sql`, apply it to a **designated test database**,
configure a separate publishing credential as `PUBLISH_DATABASE_URL`, and run
`python -m api.importer public/data`. For a guided, one-off import, use
`python -m api.importer public/data --host 192.168.1.120 --database lusk
--user lusk_publisher` instead; it prompts for the password without recording
it in the shell. The API takes a *different, read-only*
`DATABASE_URL`; give it SELECT on the serving relations it reads and no
write permissions. Credentials must never be copied to `/srv/lusk/api`.

The earlier versioned-schema integration suite passed against a disposable Pi
Postgres database; the **new single-dataset schema must be retested there**.
Representative publication and query measurements are still needed before #569
selects an architecture. See [`README-deploy.md`](README-deploy.md) for the
operator-run cutover; no live Pi changes are part of this code change.
