# Optional Pi API deployment (example)

An earlier, versioned-schema API image is running on the Pi; this document does
**not** imply that the new single-dataset schema or image is deployed.
It does not change the existing static-app Compose service, nginx configuration, or PostgreSQL
Compose project. The operator performs and reviews all Docker/Compose and privileged nginx
 changes. The operator controls privileged changes; this checkout supplies application source.

The examples assume:

- The API source is a Python package under this repository's `api/` directory, exposes
  `api.main:app`, and implements `/api/health` and `/api/territories/...` routes.
- The API project supplies `api/requirements.txt`.
- The existing nginx container serves the SPA on host port `3535`, with document root
  `/usr/share/nginx/html/app`, a `/data/` alias, and SPA fallback `try_files $uri /index.html`.
- PostgreSQL 18-trixie is in the separate `/srv/lusk-db` Compose project and is currently
  published as `192.168.1.120:5432:5432`, database `lusk`.
- The two Compose networks are external shared networks named `lusk-edge` and `lusk-data` by
  default. Nginx and the API must both join `lusk-edge`; PostgreSQL and the API must both join
  `lusk-data`. Adjust the names in the examples if the operator's existing networks differ.

No credentials belong in these examples or in source control. Keep database credentials in the
operator-owned `/srv/lusk-private/api.env` file, **outside the agent-writable `/srv/lusk/api`**,
readable only by the deployment account/root. Use the database
service's network DNS name and port on `lusk-data` for the API connection (not a host-published
port). Confirm the actual PostgreSQL service name and network membership before deploying; do not
assume a container name.

## Files

- `deploy/Dockerfile` builds from the repository root and runs `uvicorn api.main:app`.
- `deploy/compose.yaml` has no `ports:` entry: the API is not published on the host. It joins
  both external networks and reads private settings from `/srv/lusk-private/api.env`.
- `deploy/nginx-api.conf` is a server-block snippet for the existing nginx configuration. Its
   variable-based proxy target plus Docker resolver allows nginx to start while the API is absent;
   requests return a gateway error until it becomes resolvable. `/api` and `/api/` are handled
   before the SPA fallback, so missing API routes cannot return `index.html`.

**Important for the current config:** its `try_files $uri /index.html` lives at
`server` scope. When adding the proxy, move that directive into an explicit
`location / { try_files $uri /index.html; }`; otherwise the inherited `try_files`
may intercept `/api/` and return the SPA. Preserve the existing `/data/` alias
and verify a missing data file remains 404. Do not paste the snippet into the
current config while leaving the server-level fallback in place.

`expose: 8000` is informational within Compose; it does not publish a host port. The nginx snippet
expects the API service/container DNS name `lusk-api` on the shared edge network. If the Compose
project prefixes service names in the operator's environment, configure a network alias `lusk-api`
or update the snippet consistently.

## Operator deployment sequence

### Migration from the deployed versioned spike

`schema.sql` describes a fresh single-dataset installation. **Do not run it
against the existing `lusk` schema**: several legacy tables have the same names
but different columns, and CREATE without migration would leave them unchanged.
The canonical Parquet and pipeline metadata must be available to repopulate the
serving tables. Migration discards *only* the old serving tables and their data,
not the database or unrelated tables. First run the opt-in real-Postgres tests
against `lusk_it_spike` with this revision, including failed and successful
replacement. Review the live schema and grants, and identify any other objects
referencing the old tables before proceeding. Plan a brief API maintenance window:
the old API cannot read the new layout; the new API cannot read the old layout.

The operator should take a `pg_dump` of `lusk` outside the agent-writable
checkout before the change, keep the old image available until cutover,
and review `migrations/001_replace_versioned_access.sql`, which removes only
`active_publication`, `import_publication`, `publication_service_registry`,
`publication_comparison_scope`, `essential_service_access`,
`territory_reference` and the two legacy validation functions/trigger, then
applies `schema.sql` and the explicit role grants in
`migrations/001_grant_reader.sql`. Avoid `CASCADE`,
which could remove unrelated dependents. Do not run this procedure just by
copying the table list: check dependencies and the actual schema first. A
read-only inspection confirmed the Pi's `lusk` database uses the original
four-table variant (19,020 observations; the registry and regional scope tables
were never installed). The migration accepts either the four-table or the
later six-table variant, but rejects a partial/unknown mix. After
the schema transaction commits, publish the validated Parquet dataset and
rebuild the API image. Until publication completes, the new API returns 503
for the comparison route; `/api/health` alone is not a data-readiness check.
If the schema change or publication fails, stop before rebuilding the API;
restore the database dump **only with an operator-reviewed recovery plan** or
complete the publication, never silently point the old image at the new layout.

For this Pi's known layout, once the migration test passes and the operator has
reviewed actual dependencies and approved downtime, the operator runs these
commands **on the Pi** (not from an agent session). The dump file stays private,
outside Git; verify it is nonempty before continuing. `--single-transaction`
and `ON_ERROR_STOP` ensure a SQL error rolls the schema change back.

```sh
cd /srv/lusk-db
umask 077
docker compose exec -T postgres pg_dump -U postgres -d lusk -Fc > /srv/lusk-private/lusk-pre-access.dump
test -s /srv/lusk-private/lusk-pre-access.dump || exit 1
# Stop the API container through its own Compose project; the old image remains available.
cd /srv/lusk/api/deploy
docker compose -f compose.yaml stop
cd /srv/lusk-db
set -o pipefail
cat /srv/lusk/api/migrations/001_replace_versioned_access.sql \
    /srv/lusk/api/schema.sql \
    /srv/lusk/api/migrations/001_grant_reader.sql |
  docker compose exec -T postgres psql -U postgres -d lusk \
    -v ON_ERROR_STOP=1 --single-transaction -f -
```

Do not run these commands yet: the branch must first land on the Pi, the
migration test must pass there, the old schema/dependencies must be checked,
and the operator must choose the maintenance window. The publisher then runs
from the PC with the canonical Parquet and metadata (see `README.md`), and the
operator rebuilds the API via its Compose project and verifies a real comparison
response as well as `/api/health`. The dump is for deliberate recovery, not an
automatic in-place version switch.

### Initial and repeat deployment

1. **Review prerequisites.** Confirm the API implementation and `api/requirements.txt` exist,
   confirm the expected health and territory routes, and inspect the current nginx and PostgreSQL
   Compose/network configuration. These examples are not a substitute for reviewing those files.
2. **Create/verify shared networks.** The Compose project refers to existing external networks; it
   will not create them. Ensure the nginx service is attached to `lusk-edge` and the PostgreSQL
   service is attached to `lusk-data`. If they are not, the operator must plan and perform the
   required Compose changes and recreate affected services deliberately. Do not attach the API to
   a public-facing network other than the existing edge network.
3. **Prepare private configuration.** On the Pi, create `/srv/lusk-private/api.env` outside version
   control with the required application/database settings. Set restrictive permissions (for
   example, owner-only read/write). Use the PostgreSQL service's DNS name and internal port on
   `lusk-data`; do not put secrets in Compose YAML, Dockerfile, nginx config, or command history.
4. **Place reviewed source and deployment files.** Put the API source under `/srv/lusk/api` and
   these deployment files at `/srv/lusk/api/deploy/`. The Docker build context in the example is
   the repository root (`../..` from `deploy`), so that directory layout must be preserved.
5. **Build and start the API.** From `/srv/lusk/api/deploy`, the operator can run
    `docker compose -f compose.yaml config --quiet` to validate interpolation **without printing
    secrets from the env file**, then `docker compose -f compose.yaml up -d --build`. Review the
    Compose file for unexpected published ports. Check `docker compose ps` and logs. The health check
   validates `/api/health` inside the container.
6. **Apply nginx change separately on a first deployment only.** The Pi's existing
   Nginx `/api/` route does not need a second modification for a schema cutover.
   For a new installation, the operator—not the API agent—reviews and inserts the
   contents of `nginx-api.conf` inside the existing app `server {}` block. Move the server-level
   SPA fallback into `location / { try_files $uri /index.html; }`. Preserve the existing `/data/`
   alias and SPA behavior. Validate with `nginx -t` inside the nginx deployment context,
   then reload/recreate nginx using the operator's established procedure. Do not replace the
   whole nginx configuration with this snippet.
7. **Verify from the LAN.** Check `http://<pi-address>:3535/api/health` and a known
   `/api/territories/...` request. Confirm an unknown `/api/...` request does not return the SPA
   HTML, the static app and `/data/` still work, and the API has no host-published port. Verify
   database access over `lusk-data` and inspect logs for accidental secret exposure.
8. **Rollback if needed.** Remove/revert only the added nginx locations and reload nginx; then
   stop/remove the API Compose service with its own project. Do not remove shared networks or
   alter the PostgreSQL project as part of API rollback.

Do not run the Compose setup or privileged nginx/database changes without the user's approval.
