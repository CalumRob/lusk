"""Read-only PostgreSQL adapter for shared retained backend metadata."""

from fastapi import HTTPException

from api.territory_search import MAX_TERRITORY_SEARCH_SCAN, search_territory_rows


class ReadRepository:
    """Owns the connection pool and storage access for territory search."""

    def __init__(self, connections):
        self.connections = connections

    def search_territories(self, query: str, limit: int) -> dict:
        with self.connections.connection() as connection:
            with connection.transaction():
                connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
                marker = connection.execute(
                    "SELECT content_version FROM table_publication WHERE table_name = 'territory_reference'"
                ).fetchone()
                if not marker:
                    raise HTTPException(503, "No territory reference has been published")
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
                return {"publication_id": "territory-v1-" + marker[0], "query": query,
                        "limit": limit, "candidate_limit": MAX_TERRITORY_SEARCH_SCAN,
                        "exact_code": exact_code,
                        "candidates": search_territory_rows(entries, query, limit)}
