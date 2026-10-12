"""Run the API against an explicitly retained, read-only raccordement test schema.

This deliberately bypasses the application's DATABASE_URL pool. The only
connection uses the guarded reader DSN and requires an explicit IT schema.
"""
import argparse
import os
import re
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit

import psycopg
import uvicorn

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from api.main import ReadRepository, app, get_repository


class _GuardedReadConnections:
    def __init__(self, dsn: str, schema: str):
        self.dsn = dsn
        self.schema = schema

    def connection(self):
        owner = self

        class _ConnectionContext:
            def __enter__(self):
                uri = urlsplit(owner.dsn)
                query = parse_qs(uri.query)
                query["options"] = [f"-csearch_path={owner.schema}"]
                scoped_dsn = urlunsplit((uri.scheme, uri.netloc, uri.path,
                                         urlencode(query, doseq=True), uri.fragment))
                self.connection = psycopg.connect(scoped_dsn)
                return self.connection

            def __exit__(self, *_exc):
                self.connection.close()

        return _ConnectionContext()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--schema", required=True,
                        help="retained schema name, e.g. it_raccordement_dec9ffa740864144")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    if os.environ.get("DATABASE_URL"):
        raise SystemExit("Refusing DATABASE_URL; unset it and use the guarded read-only test DSN.")
    if os.environ.get("LUSK_TEST_DATABASE_PREFIX") != "lusk_it_" or \
       os.environ.get("LUSK_TEST_DATABASE_NAME") != "lusk_it_contract":
        raise SystemExit("Refusing: exact lusk_it_contract name and lusk_it_ prefix are required.")
    if not re.fullmatch(r"it_raccordement_[a-f0-9]{16}", args.schema):
        raise SystemExit("Refusing: schema must be an explicitly retained it_raccordement_<16 hex> schema.")
    dsn = os.environ.get("LUSK_TEST_READ_DSN", "")
    uri = urlsplit(dsn)
    if not dsn or uri.username != "lusk_it_contract_read" or uri.path != "/lusk_it_contract":
        raise SystemExit("Refusing: LUSK_TEST_READ_DSN must name the guarded read role/database.")
    if not os.environ.get("PGPASSFILE"):
        raise SystemExit("Refusing: process-local PGPASSFILE must point to the private pgpass file.")

    # Fail closed before opening a local listener: confirm both identity and the
    # exact national contract in this schema using the reader role only.
    query = parse_qs(uri.query)
    query["options"] = [f"-csearch_path={args.schema}"]
    scoped = urlunsplit((uri.scheme, uri.netloc, uri.path, urlencode(query, doseq=True), uri.fragment))
    with psycopg.connect(scoped) as conn:
        identity = conn.execute("SELECT current_database(),current_user,current_schema()").fetchone()
        if identity != ("lusk_it_contract", "lusk_it_contract_read", args.schema):
            raise SystemExit("Refusing: guarded reader identity/schema check failed.")
        declaration = conn.execute("""SELECT comparison_statistic,comparison_scope,cardinality(axis_values)
            FROM series_dataset_descriptor WHERE indicator_id='raccordement_courbe' AND active_read_route""").fetchone()
        publication = conn.execute("SELECT 1 FROM series_dataset_publication WHERE dataset_id='raccordement_courbe'").fetchone()
        if declaration != ("mean", "selected_group", 73) or not publication:
            raise SystemExit("Refusing: schema does not contain the published national mean curve contract.")

    app.dependency_overrides[get_repository] = lambda: ReadRepository(
        _GuardedReadConnections(dsn, args.schema))
    print(f"Read-only test API listening on http://127.0.0.1:{args.port} using {args.schema}")
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
