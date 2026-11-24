"""Read-only PostgreSQL adapter for shared retained backend metadata."""

from fastapi import HTTPException

from api.resource_catalogue import ResourceCatalogue, ResourceGrammar, database_resource_catalogue
from api.resource_publication import live_territory_reference_version
from api.territory_search import MAX_TERRITORY_SEARCH_SCAN, search_territory_rows


class ReadRepository:
    """Owns the connection pool and storage access for territory search."""

    def __init__(self, connections):
        self.connections = connections

    def resource_catalogue(self, grammar: ResourceGrammar) -> ResourceCatalogue:
        with self.connections.connection() as connection:
            with connection.transaction():
                connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
                return database_resource_catalogue(connection, grammar)

    def search_territories(self, query: str, limit: int) -> dict:
        with self.connections.connection() as connection:
            with connection.transaction():
                connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
                reference_version = live_territory_reference_version(connection)
                rows = connection.execute(
                    """SELECT territory_type, territory_id, name FROM territory_reference
                       ORDER BY CASE territory_type WHEN 'commune' THEN 0 WHEN 'epci' THEN 1
                                WHEN 'departement' THEN 2 WHEN 'region' THEN 3 ELSE 4 END,
                                territory_id LIMIT %s""", (MAX_TERRITORY_SEARCH_SCAN + 1,)
                ).fetchall()
                if len(rows) > MAX_TERRITORY_SEARCH_SCAN:
                    raise HTTPException(503, "Territory reference exceeds search scan bound")
                entries = [dict(zip(("type", "id", "name"), row)) for row in rows]
                exact_code = next((row for row in entries if row["id"] == query.strip()), None)
                return {"publication_id": "territory-v1-" + reference_version, "query": query,
                        "limit": limit, "candidate_limit": MAX_TERRITORY_SEARCH_SCAN,
                        "exact_code": exact_code,
                        "candidates": search_territory_rows(entries, query, limit)}
