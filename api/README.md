# Interactive data-serving spike (#569)

## PostgreSQL integration tests

Database-backed API tests are opt-in and use guarded, test-only PostgreSQL targets. Before
running them, follow [`tests/integration/README.md`](tests/integration/README.md) for the
database/role checks and private `PGPASSFILE` setup. The persistent test database is
`lusk_it_contract`; each run uses its own disposable schema. Never use the serving database
`lusk` for integration tests or place credentials in the repository.

Owned ENAF and OCS-GE series can be checked from fresh canonical Milieux
Parquet with `Rscript scripts/publish-serving-tables.R --owned-series-check`
(run from `pipeline/`). Explicit publication uses
`LUSK_PUBLISH_OWNED_SERIES=1 Rscript scripts/publish-serving-tables.R --owned-series-publish`.
The two datasets commit independently; if one fails, rerun the command to
reconcile both safely. This command is unavailable in `LUSK_MODE=cron`.

This slice does not replace the static site. The access-only API is deployed
on the Pi as a bounded serving experiment. It tests one dataset's
read contract with FastAPI + psycopg against PostgreSQL. R remains the computation
owner; the database holds a serving projection of its published outputs. There is
no endpoint for arbitrary SQL. The new custom building-group endpoints in this
branch are **not deployed**; they accept an explicit, bounded list of published
territories and never add the focal territory automatically.
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
| `rampe_acces_batiments.parquet` | `building_ramp`: three modes × eleven positions per complete territory, with its own building denominator; explicit absent sentinels |
| `distribution_acces_batiments.parquet` | `building_grid`: thirty cells per complete territory; explicit absent sentinel |

The R publisher reads **canonical Parquet**, not published JSON or route-scoped
models. The theme descriptor is a pipeline-owned configuration file, not a
published browser payload. R sends validated projections from the desktop
without publishing new JSON mirrors. Three modes are required for every served
territory and service. Null means unavailable, never zero; building denominators
come from the building facts themselves.

The desktop R pipeline projects the canonical Parquet into five declared SQL
tables. Each table has its own content version in `table_publication`; changes
to access alone do not rewrite building facts, and vice versa. A publication
transaction serializes writers, replaces only changed fact tables, upserts
changed shared references and removes only unreferenced stale identities. It
updates each changed table's marker together with its rows; the access scope
descriptor is updated with access. Foreign-key conflicts or incomplete tables
roll the transaction back. Re-running after a Parquet-success/DB-failure
compares **database** markers and retries even when the local files are already
unchanged. API reads pin one repeatable-read snapshot. The obsolete Python
database-write importer was removed in issue #600; it is not part of the current
runtime or operator workflow. Historical migration files describe the former
database layout only and must not be replayed to restore that writer.

## API contract

The initial Variant E figures use `GET /api/territories/{type}/{id}/building-access`,
returning focal ramp/grid values and the mean comparison for the existing default
scope in one committed publication. The commune's comparison mode is resolved
against its density, EPCI, or Bretagne scope; EPCI and département compare to
their own level, while the region has no peers. The browser has **no peer-group
chooser** in this pilot. Its labels come from the existing typed read-model
scope, not a second API copy. The figure values fail closed if this read fails.
The rest of the territory model (including the figure's presentation grammar
and other theme sections) still loads from static JSON; this pilot migrates the
building-figure **values**, not the entire page or its metadata.

The internal API also has `GET /api/building-access/territories` for the bounded,
published choice catalog and `POST /api/territories/{type}/{id}/building-access-comparison`
with `{ "selected": [{"type": "commune", "id": "22001"}, ...] }`.
Selections expand to **distinct communes**, even when parents overlap; none
are selected or excluded on behalf of the user. The response has one
publication ID, declared direction and explicit member set, and both figures
carry metric type `mean`. The ramp has eleven building-count-weighted mean
positions **per mode**, not quantiles of pooled buildings; the grid pools cell
counts. An absent member contributes nothing, and fewer than two available
members yield a null comparison. A single repeatable-read transaction pins the
marker versions, identity and selected rows. Its token derives from the
reference, ramp and grid versions, not access. Unknown/unbounded selections
fail closed.

`migrations/002_building_access.sql` was applied to the Pi's `lusk` database
on 2026-09-28. R then published all five tables and their row counts were
checked against the canonical Parquet. The existing catalog and explicit-group
API routes were deployed. `migrations/003_building_access_all_levels.sql` was
rehearsed in a rolled-back live transaction and applied on 2026-09-28. R then
published 41,784 ramp rows and 37,982 grid rows. Local current API code read
the live PostgreSQL publication for a commune, EPCI, département and region;
the operator rebuilt the API and checked Variant E in the browser.

### Existing access reads

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

## First selected-theme scalar acquisition batch (#627)

### Declared-profile extension: DPE (unactivated)

The same theme facts read now includes focal-only `profiles` and a separate
`profile_content_version`. Profile cells carry their own source/vintage links,
ordered closed axes and typed availability. Theme membership is producer-owned
`profile_descriptor.theme_id`, never an API list. `complete_theme` remains false:
this addition is not complete Habitat coverage or a fiche cutover. The additive
unactivated contracts are `theme-facts-v1` and `theme-comparison-v1`.

`distribution_dpe` has one detail axis and no sex axis. Its comparison names
`part_passoires`, already in the theme scalar results; the comparison read adds
`profile_comparisons` and its profile version, not peer DPE bins. The profile
descriptor pins the exact required `scalar_observation` version. Both theme
reads and the existing declared-profile route validate that pin, facet unit,
direction, allowed levels and reference compatibility in the same read-only
REPEATABLE READ transaction. A scalar refresh makes DPE unavailable until the
complete profile snapshot is refreshed; structure-age has no such scalar pin.

`publier_declared_profiles_postgres(demography, demography_metadata, habitat,
habitat_metadata, scalar_version, con)` is the explicit complete-snapshot
publication entrypoint. The version argument must be the verified canonical
shared scalar token, not a guessed freshness date. It composes both profiles,
checks dependencies and preserves age cells. An old age-only publish fails
before committing if it would discard another published profile. No new live
target, consumer flag, schema application, publication or deployment is enabled
by this change. Automated DPE refresh wiring, canonical publication parity and
complete fiche integration remain release gates under #627.

Fresh DDL and migration 013 represent an absent second axis with an empty
physical coordinate key and NULL axis reference, retaining the existing
composite observation/provenance keys. No fake `sex` axis row is created; the
HTTP cell has `sex: null`. Constraints and the existing row trigger distinguish
this from a declared second-axis coordinate. Dense completeness and per-cell
provenance are enforced by the publisher and checked by the focal reader.

The API now has two additive, non-activated read boundaries:

- `GET /api/territories/{type}/{id}/themes/{theme}/facts` returns only the
  selected territory's published scalar-family facts and lineage.
- `POST /api/territories/{type}/{id}/themes/comparison` takes an explicit typed
  selection (including `[]`), resolves whole territories to distinct commune
  members through the existing reference resolver, and returns request-scoped
  scalar medians/ranks/counts for the explicit selection. Overlaps are
  deduplicated and focal membership is not changed implicitly. Selected scalar
  rows are read in one SQL query; unsupported facet/direction/grain contracts
  report comparison unavailable rather than inventing a statistic.

The scalar-family contract explicitly identifies its statistic as `median`;
it does not apply that rule to building-weighted means or other evidence
families. A rank is returned only when the measured focal territory actually
belongs to the selected group. An empty selection has no rank or rank size;
a measured focal outside the group retains its value but has no group rank.
The request uses the existing typed-selection safety bound of 1,500 submitted
territories, accommodating an explicit selection of the published universe.
An unknown or not-yet-published scalar theme returns 404, not an empty success.

Theme membership is owned by canonical pipeline `theme_<theme>.json` metadata
and persisted as `scalar_descriptor.theme_id`; it participates in descriptor and
table content identity. Fresh schema requires a valid key. Additive migration
012 leaves existing descriptors NULL until a normal canonical scalar republish,
and such legacy rows are not exposed by selected-theme reads. Neither migration
application nor publication is authorized by this code change.

This is strictly a **scalar-family slice**, not a ready theme payload: responses
carry `complete_theme: false` and no frontend consumer is switched. The current
shared scalar snapshot includes Services essentiels plus the existing
metadata-declared ordinary scalar projections for Économie/Emploi, Démographie,
Mobilité and Habitat. Remaining theme facts include declared profiles (e.g.
DPE and mobility profiles), housing price series and the source facts used by
demographic/housing readings, Milieux annual and multi-year state facts,
sparse programme/grant evidence, and theme
metadata/lecture context. Scalar comparison is currently supported only for
self-facet, commune-eligible, high/low-direction descriptors. Non-commune
measure-grain comparisons and other statistic contracts remain unavailable.
No other-theme rows or unselected commune peer dump are included in these reads.

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
that migration again**. `migrations/002_building_access.sql` and
`migrations/003_building_access_all_levels.sql` were applied on 2026-09-28;
do not rerun them. They preserve the existing access marker while introducing
per-table markers and all-level building grains. Ordinary refreshes use R,
without dropping tables. The Pi-specific
operator notes in `README-deploy.md` are local and gitignored, consistent with
`docs/self-hosting.md`; the reusable source and test contract remain tracked.

From the repository root in a Python virtual environment:

```text
pip install -r api/requirements-dev.txt
python -m pytest api/tests
```

No PostgreSQL is needed for those checks. To validate and publish current data,
use the R commands under “Desktop-to-Pi publication after R (#572)” below; no
Python importer CLI exists. Migrations 002 and 003 were first
rehearsed in rolled-back transactions, then applied to live PostgreSQL; R
committed the changed tables and their row counts were checked. The product
owner checked the Variant E browser after the API image was rebuilt. The
product owner declined a disposable-Postgres **performance gate**. The API
uses a *different, read-only* `DATABASE_URL`; no database credentials belong in
the browser or `/srv/lusk/api` checkout.

### Deployment procedure for the bounded building pilot

The PC connects **directly** to Pi PostgreSQL over LAN at `192.168.1.120:5432`,
database `lusk`, role `lusk_publisher`. libpq reads the private password from
`%APPDATA%\PostgreSQL\pgpass.conf`; use the literal IP, not the SSH hostname
`calum-pi`, because passfile host matching is exact. Do not copy the passfile,
credentials, or Parquet to the Pi. On 2026-09-28 the publisher owned both
building tables and the completeness-check function; verify ownership and
rehearse in a rolled-back transaction before **any future** migration, and get
operator approval before applying it. Never reapply migrations 001–003.

The Pi API checkout is root-owned at `/srv/lusk/api`. Stage **current** source
files with SSH as `lusk-agent`, then ask the operator to install them. For this
pilot the staging path was `/tmp/lusk-sql-pilot-588/api`:

```powershell
scp -i "$HOME/.ssh/lusk_pi_ed25519" api/main.py api/building_comparison.py api/schema.sql lusk-agent@calum-pi:/tmp/lusk-sql-pilot-588/api/
```

```sh
sudo install -m 0644 /tmp/lusk-sql-pilot-588/api/main.py /srv/lusk/api/main.py
sudo install -m 0644 /tmp/lusk-sql-pilot-588/api/building_comparison.py /srv/lusk/api/building_comparison.py
sudo install -m 0644 /tmp/lusk-sql-pilot-588/api/schema.sql /srv/lusk/api/schema.sql
cd /srv/lusk/api/deploy
sudo docker compose -p lusk-api -f compose.yaml ps
sudo docker compose -p lusk-api -f compose.yaml up -d --build --no-deps api
```

The existing Compose project is **`lusk-api`**, with config at
`/srv/lusk/api/deploy/compose.yaml`. Confirm `compose ps` lists the existing
container before rebuilding; without `-p lusk-api`, Docker Compose would use
the directory's default project and could create a second stack. The Dockerfile
copies `api/` into the image, so a restart alone does not pick up source changes.
For data changes, publish **from the PC** with R below; rebuilding Docker does
not publish data. Local operator-only detail remains in gitignored
`api/README-deploy.md` (no password is recorded there).

### Desktop-to-Pi publication after R (#572)

Run **on the publishing PC**, after a successful R pipeline publication
(including the shared `vintages.parquet` fusion), from `pipeline/`.
The canonical Parquet files remain on the PC; the publisher reads them here
and sends the validated serving projection to PostgreSQL on the Pi. Pulling
API code on the Pi does not transfer or publish these files. Use canonical
`public/data/*.parquet` and pipeline-owned Mobilité metadata; JSON outputs and
the static-site release are not inputs. Publication is opt-in: the normal
`targets` graph and static-site cron do not include a DB target. The `--targets`
command opts in to a leaf target after the final territory publication,
Mobilité metadata and fused vintages. Targets skips unchanged upstream compute;
the leaf checks the database markers every explicit run so a failed DB write
can be retried. The `--publish` command retries from already-published files
without evaluating the graph. RPostgres connects directly from the PC to the
Pi's existing PostgreSQL service over libpq; SSH is for copying API code, not
for publishing data.

The operator creates a libpq password file **outside this checkout and any
agent-writable deployment directory**, restricts access to the operator, and
sets `PGPASSFILE` to its absolute path in the publishing environment. A line
matches `host:port:database:username:password` (for example,
`<pi-host>:5432:lusk:lusk_publisher:<private-password>`); escape literal `:`
and `\` according to libpq's passfile rules. The file is never copied into
`api/`, shown in logs, or committed. `PGPASSFILE` contains only a path, not a
password; the operator must verify the file is private and outside the checkout.
That check cannot establish filesystem ACLs or discover every other
agent-writable directory: **the operator must verify** the chosen location is
outside those directories and accessible only to the publishing identity.
RPostgres uses libpq; the script does not read or print the secret.
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
# From pipeline/; --check reads canonical files without a database connection.
Rscript scripts/publish-serving-tables.R --check
# The one-time migration 002 has already been applied; do not rerun it.
$env:LUSK_PUBLISH_HOST = '<pi-db-host>'
$env:LUSK_PUBLISH_PORT = '5432' # optional: default 5432
$env:LUSK_PUBLISH_DATABASE = 'lusk'
$env:LUSK_PUBLISH_USER = 'lusk_publisher'
Rscript scripts/publish-serving-tables.R --targets
# DB retry from existing canonical files without evaluating the targets graph:
Rscript scripts/publish-serving-tables.R --publish
```

The standalone command reports changed physical tables or `No table changes`;
the targets command reports the result in the targets run log. Each explicit
publication compares local content versions to database markers, so a
Parquet-success/DB-failure is retried without rewriting already-current files.
Reference, service registry, access, ramp and grid each retain their own version;
other pipeline facts stay in canonical Parquet. Deploying the new API code and
testing its read paths in the browser are the remaining live checks.

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
    the reader gets SELECT and the publisher gets only the serving-table writes.
   Do not use this fresh-install sequence on the already-deployed Pi.
3. The operator places the reader `DATABASE_URL` in the mode-600
   `/srv/lusk-private/api.env`, outside the checkout; the publisher credential
    stays in the operator's private PC password file. The desktop R publisher
    runs only after the reviewed migration and publication checks below.
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
2026-09-27. In live `lusk`, the then-current R publisher committed 19,020 access
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
# Shared scalar publication contract (#594)

## Bounded Programmes acquisition (#627)

The stable indicator endpoint serves `subventions_annuelles` as an owned year
series, `subventions_par_domaine` as a sparse observed year/detail collection,
and `couverture_programmes` as sparse anchored membership. An omitted domain or
membership is no record, never a fabricated zero/false. ORT preserves the actual
row reference date and null publication date; a label's ORT rider remains on that
label. Commune reads include covering EPCI contracts; aggregate reads include
complete named relevant anchors and source-supported category counts. No peer
grant datasets are sent with these focal facts.

Annual `context` contains only the declared parent's matching-year points and
their provenance (commune→EPCI, EPCI/département→region; none for region). Missing
or nonpositive totals do not authorize a context share. The consumer must not
substitute another year. Domain grants retain their producer-declared comparison
year/category; numeric comparisons use ordinary medians with the established
same-density default and typed, deduplicated custom selection. Membership remains
explicitly non-comparable. Comparison-only responses contain selected-group
results and compatibility tokens, not focal entries, relationships, points or
parent context.

Programmes theme facts assemble available owned series and `collections` in the
same caller MVCC snapshot. `complete_theme` stays false: this bounded batch is
not six-theme fiche activation, serving publication or a public deployment.
See migrations 017/018 and their explicit check/publish operator modes in
`migrations/README.md`.

## Shared scalar owners

R/Parquet remains authoritative. A scalar publisher registers a stable name,
projects canonical facts and declared descriptors, validates them with
`validate_scalar_projection()`, and replaces facts plus the independent
`scalar_observation` marker in one DB transaction. Hash facts and meaning-
affecting descriptor/source-vintage metadata. An unchanged table is a no-op
even when another changed; failure rolls back facts and marker together for
retry. Never infer labels, levels, source, missingness, denominator or zero.
Readers use named bounded selectors and one repeatable-read transaction, not
arbitrary SQL or browser credentials.

The scalar publication marker pins `reference_content_version` to the
independent `territory_reference` marker version. This is a dependency token,
not part of or a replacement for the scalar table's independent
`content_version`. When the territory-reference version changes, the publisher
checks the complete eligible territory-ID/type set before rebinding that token;
equal identity sets can be rebound without changing scalar content, while any
added, removed, or type-changed eligible identity leaves the old token in place
and the reader unavailable pending a coherent republish. Scalar reads fail with 503 if
either marker is missing or the versions differ. Complete row parity is checked
by the transactional publisher before committing its marker; bounded HTTP reads
do not scan the entire reference/fact tables to recount them on every request.
Dense profile reads additionally check the focal coordinate set and each cell's
lineage. This exact-version compatibility token is
the cross-table identity strategy; readers never blend a scalar snapshot with
a newer territorial reference and return 404 only for an absent row in a
validated compatible snapshot.

Fresh installs use `schema.sql`; existing installs use numbered additive
migrations. Orchestration reserves numbers serially before parallel workers;
the declared-profile migration is `006_declared_profile.sql`. Workers must not apply DDL to the live Pi. The orchestrator reviews/rehearses/
applies live migrations serially; only the product owner runs API Compose on
Pi. Future detail, series, evidence and service slices reserve distinct
migration numbers and use constrained shape-specific contracts. Fixture tests
are not full-site performance evidence.

The dense `structure_age` profile uses the declared `detail × sex` axes and the
page descriptor's comparison detail/sex. `GET /api/territories/{level}/{id}/profiles/structure_age`
returns one territory's ordered cells plus the bounded peer values for that
declared comparison facet. It fails closed on a missing/stale publication,
missing/duplicate profile coordinates or provenance; the app's switched
structure-age page has no static-fact fallback. Other profile consumers, map
layers and the remaining theme pages continue to use their incumbent artifacts.
The canonical `structure_age` fact contract is a numeric `value` or `NA` only:
the R calculation derives each share from `effectif / population` and does not
carry a suppression or unsupported reason. Accordingly, the profile publisher
maps finite values to `measured` and `NA` to `not_available`; it does not infer
more specific missingness from an input that does not encode it.
The R publisher is opt-in with `LUSK_PUBLISH_PROFILE=1` for a local full or
Démographie-targeted run; it is never part of the scheduled static publication.
Publication and territory-reference compatibility are pinned to independent
table markers. Representative-size Pi latency/storage and recovery validation
remain mandatory before the product owner deploys or switches live traffic.
Merging the API code is not an operator cutover: keep issue #596 open through
migration 006, publication and marker verification, measured Pi cost/P95 and
parity review, and the separately approved deployment/flag change.
The app rollout is separately gated at build time by
`VITE_STRUCTURE_AGE_PROFILE_API=1`; unset/any other value keeps the incumbent
static structure-age page. This is a build-time SPA flag, not a runtime switch:
enabling requires rebuilding and redeploying the static app with the flag set
after migration 006 and profile publication are verified. Rollback requires
rebuilding and redeploying with the flag unset (or any value other than `1`).
Do not enable the production static build until
the owner has applied migration 006, populated and checked the profile marker,
and approved Pi latency/parity results. This restores the static reader without
a schema rollback. Once enabled, API errors
are shown as unavailable/retry and never fall back to the static
`structure_age` fact.

The opt-in `Rscript scripts/publish-serving-tables.R --scalar-fixture-check`
projects only the small tracked Démographie fixture through the registered
scalar publisher. `--scalar-fixture-publish` is additionally guarded to a DSN
whose database exactly matches `LUSK_TEST_DATABASE_NAME=lusk_it_*`; it is for a
disposable integration database only. Neither mode invokes the production
targets graph or needs `data/raw`.
The theme metadata does not declare scalar completeness. This fixture adapter
therefore requires an explicit caller policy and uses `dense_complete` only
because its checked projection covers every eligible identity in that fixture;
it does not add completeness metadata to a product descriptor or establish a
catalogue-wide default.

`pipeline/scripts/smoke-profile-postgres.R` exercises fresh schema creation,
registered profile publication, source-vintage lineage, marker/reference
binding and transactional failure rollback against an isolated database named
`lusk_it_*` using the `LUSK_PROFILE_TEST_HOST/PORT/DATABASE/USER` variables.
It must never target the Pi or a production/default database.
