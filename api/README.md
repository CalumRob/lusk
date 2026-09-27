# Interactive data-serving spike (#569)

This slice does not replace the static site. The access-only API is deployed
on the Pi as a bounded serving experiment. It tests one dataset's
read contract with FastAPI + psycopg against PostgreSQL. R remains the computation
owner; the database holds a serving projection of its published outputs. There is
no endpoint for arbitrary SQL or user-supplied lists of peers.
ADR-0031 continues to govern today's static read models during ADR-0033's
route-by-route transition. Variant E's existing Services essentiels figure is
the first development-only browser consumer (#581); its renderer is unchanged.

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

The access publication identifier fingerprints the **validated serving
projection**: access facts and their source/vintage, territory reference fields,
and the published regional comparison scope. It identifies this pipeline-owned
data snapshot, not an arbitrary run timestamp or raw Parquet encoding. Changes
to unrelated indicators or vintages in shared Parquet do not refresh the access
dataset. A repeat run with the same fingerprint skips the write entirely,
leaving `imported_at` and all other datasets untouched. The first run after the
older raw-file-hash importer changes the identifier once, even if values match.

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

The same bounded read contract has three further routes:
`/api/territories/epci/{code}/essential-services` compares Breton EPCIs,
`/api/territories/departement/{code}/essential-services` compares the four
Breton départements, and `/api/territories/region/{code}/essential-services`
returns Bretagne's own shares with `scope`, medians and ranks null (no peer
universe). Non-commune scopes expose a kind and member count; their public
labels continue to come from the pipeline-published territory read model in
Variant E, not invented inside the API. Unknown territory types have no route.
The publication is still the existing 19,020-observation access dataset; these
reads require no new table or browser credential.

Variant E alone requests these routes in development. `npm run dev` proxies
`/api` same-origin to the public read-only API at
`https://lusk.calumrobertson.fr` by default. To use another API server,
set `LUSK_API_ORIGIN` before starting Vite (Command Prompt:
`set LUSK_API_ORIGIN=http://localhost:8000`; PowerShell:
`$env:LUSK_API_ORIGIN='http://localhost:8000'`). It is a URL, not a database
secret. If the API is unavailable, the section fails visibly instead of
silently showing static access facts. This does not publish Variant E in
production or change the site's current static pages.

This spike does **not** implement an interactive indicator page, arbitrary
searched-territory comparisons, legacy `iso_*` pages, or a generic site-wide
indicator store. A contrasting `low` direction is covered in contract tests,
but actual `iso_*` facts are not loaded by this first table. Whether to rank a
singleton peer group in future contracts is still to be decided: this slice
follows the generic R ranking rule (1/1); some current read models suppress it.

## Local verification

### Serving schema

`schema.sql` is a **fresh-install schema**, not an idempotent migration. The
original Pi schema was replaced once on 2026-09-27 with the tested,
transaction-scoped `migrations/001_replace_versioned_access.sql`; **do not run
that migration again**. Ordinary refreshes use only the importer, which
atomically replaces the access dataset without dropping tables. The Pi-specific
operator notes in `README-deploy.md` are local and gitignored, consistent with
`docs/self-hosting.md`; the reusable source and test contract remain tracked.

From the repository root in a Python virtual environment:

```text
pip install -r api/requirements-dev.txt
python -m pytest api/tests
python -m api.importer --check public/data
```

No PostgreSQL is needed for those checks. Before a first database publication,
test in a **designated disposable database**. For a guided, one-off import, use
`python -m api.importer public/data --host <pi-host> --database lusk
--user lusk_publisher`; without `PGPASSFILE`, it prompts for the password
without recording it in the shell. The API takes a *different, read-only*
`DATABASE_URL`; give it SELECT on the serving relations it reads and no
write permissions. Credentials must never be copied to `/srv/lusk/api`.

### Repeatable R-to-Postgres access publication (#572)

Run **after** a successful R pipeline publication (including the shared
`vintages.parquet` fusion), from the repository root. Use canonical
`public/data/*.parquet` and pipeline-owned Mobilité metadata; JSON outputs and
the static-site release are not inputs. This step is explicit/operator-run, not
added to the static-site cron or a `targets` side effect.

The operator creates a libpq password file **outside this checkout and any
agent-writable deployment directory**, restricts access to the operator, and
sets `PGPASSFILE` to its absolute path in the publishing environment. A line
matches `host:port:database:username:password` (for example,
`<pi-host>:5432:lusk:lusk_publisher:<private-password>`); escape literal `:`
and `\` according to libpq's passfile rules. The file is never copied into
`api/`, shown in logs, or committed. `PGPASSFILE` contains only a path, not a
password; the importer rejects missing files and files inside the repository.
That check cannot establish filesystem ACLs or discover every other
agent-writable directory: **the operator must verify** the chosen location is
outside those directories and accessible only to the publishing identity.
The importer passes the path to libpq; it does not read or print the secret.
On this PC the operator chose a passfile under their Windows user profile;
programs running as the **same Windows identity** can technically read it.
That is an accepted local trust boundary here, not isolation from the agent.
Use an exact host, port, database and publisher role in each entry; avoid a
wildcard that could silently select the wrong database. The operator creates
the file and restricts its ACL without pasting its contents into an agent
session. To persist **only the path** across new PowerShell sessions:

```powershell
$env:PGPASSFILE = Join-Path $env:APPDATA 'PostgreSQL\pgpass.conf'
[Environment]::SetEnvironmentVariable('PGPASSFILE', $env:PGPASSFILE, 'User')
```

```powershell
python -m api.importer public/data --host <pi-host> --database lusk --user lusk_publisher
```

The command reports `published` when the validated access snapshot changes,
`unchanged` when it already matches the current database publication, and
fails nonzero without changing the prior dataset if validation or SQL fails.
The publisher serializes competing runs before comparing fingerprints. Only
essential-service access is a Postgres dataset in this slice; other pipeline
datasets stay in their own canonical Parquet and are not invented as tables.

**Observed verification, 2026-09-27:** 22 local Python tests passed; the operator
ran all 7 opt-in real-Postgres tests in disposable `lusk_it_spike` (2.28 s),
including changed/unchanged publication, failed refresh and the changed value
through the read-only HTTP contract. With an operator-created Windows-profile
passfile and no password prompt, the live publisher first reported 19,020
observations `published`, then the identical second run reported 19,020
`unchanged`. The public API's publication ID matched the validated canonical
Parquet snapshot (`2026-08-06-e1cc6023cf17e99e`), and Allineuc's health
walking/transit rank remained 19/38 with source version 2026-02. No static-site
release or API rebuild was needed. No full R suite was run for this Python-only
change.

## Operator-run deployment and checks (#571)

Supported starting state: Docker Compose, a Lusk checkout at `/srv/lusk`, an
existing static nginx service (`lusk` in `/srv/lusk/compose.yaml`), PostgreSQL
(`postgres` in `/srv/lusk-db/compose.yaml`), and database `lusk`. The operator
owns both Compose files and `/srv/lusk-private/`; API deployment never rewrites
them. A blank Pi/base site/database installation is outside this slice.

1. Ensure external Docker networks `lusk-edge` and `lusk-data` exist. The
   operator declares `lusk-edge` on the existing nginx service and `lusk-data`
   on PostgreSQL in their respective Compose files, **retaining their default
   networks**. Validate each project with `docker compose config --quiet` and
   deliberately recreate the affected services once. Do not rely on an
   ephemeral `docker network connect`. The tracked `deploy/compose.yaml` joins
   both networks without publishing an API host port.
2. Provision separate non-superuser `lusk_reader` and `lusk_publisher` Postgres
   logins. Set their passwords interactively in `psql` (`\password`), never in
   command history or tracked files. Apply `schema.sql` to a **fresh, empty
   serving schema** and `migrations/001_grant_reader.sql` in one transaction;
   the reader gets SELECT and the publisher gets only the access-serving writes.
   Do not use this fresh-install sequence on the already-deployed Pi.
3. The operator places the reader `DATABASE_URL` in the mode-600
   `/srv/lusk-private/api.env`, outside the checkout; the publisher credential
   stays in the operator's private PC password file (or a one-off prompt). From the PC,
   validate and publish canonical Parquet with `python -m api.importer
   public/data --host <pi-host> --database lusk --user lusk_publisher`.
4. From `/srv/lusk/api/deploy`, use **`docker compose -p lusk-api -f compose.yaml
   config --quiet`** and `docker compose -p lusk-api -f compose.yaml up -d
   --build api`. Always pass `-p lusk-api`: the default project inferred from
   `deploy/` is *not* the running API project. On first installation only, add
   `deploy/nginx-api.conf` to the existing nginx server block and move its
   server-level SPA fallback into `location /`; retain the `/data/` alias.
5. Verify Pi-loopback and public `/api/health` **and** a known comparison, a
   missing API route (not HTML), the static site, and no API host port in
   `docker ps` (`8000/tcp` without `->`). Verify reader SELECT=true and
   INSERT/schema CREATE/database CREATE=false. To rotate credentials, use
   interactive `\password`, update the private env file for the reader, then
   recreate only the `lusk-api` service and recheck a real comparison.

The opt-in real-Postgres checks in `tests/integration/README.md` require an
explicitly disposable `lusk_it_*` database. They cover failed refresh,
concurrent readers, a successful replacement, historical-schema rehearsal and
read-only/CREATE denial. **Seven passed** on the Pi's disposable database on
2026-09-27. In live `lusk`, the canonical importer committed 19,020 access
observations in **9.06 seconds** end-to-end (operator-reported). Allineuc's
health walking/transit rank was **19/38** through the public API. The live
reader's SELECT/INSERT/schema CREATE/database CREATE privileges were
`true/false/false/false`; the API had no host-published port.

For repeatable query timing, run **sequentially** from the Pi against
`http://127.0.0.1:3535/api/territories/commune/22001/essential-services`
with `comparison=epci`, `densite`, then `bretagne`: 20 warmed `curl` requests
per scope, collecting `time_total`; nearest-rank P95 is the 19th sorted value.
With 19,020 observations, observed Pi-loopback P95 was **24.4 / 100.5 / 454.5
ms** respectively. The agreed #571 engineering bound is **P95 <1 second** for
each of these scopes at this data size; all passed. This is not a cold-start,
internet-latency or product-wide guarantee.

```sh
set -o pipefail
for scope in epci densite bretagne; do
  echo "$scope"
  for i in $(seq 1 20); do
    curl -fsS -o /dev/null -w '%{time_total}\n' \
      "http://127.0.0.1:3535/api/territories/commune/22001/essential-services?comparison=$scope" || exit 1
  done | sort -n | awk 'NR == 10 { a = $1 } NR == 11 { median = 500 * (a + $1) } NR == 19 { p95 = 1000 * $1 } END { printf "median %.1f ms, p95 %.1f ms\n", median, p95 }'
done
```
