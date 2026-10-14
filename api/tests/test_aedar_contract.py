from api.main import app


def test_aedar_reader_is_named_typed_and_bounded():
    route = next(r for r in app.routes if r.path ==
        "/api/aedar/territories/{territory_type}/{territory_id}/aggregates")
    assert route.endpoint.__name__ == "aedar_territorial_aggregates"
    assert route.methods == {"GET"}
    sql = " ".join(c for c in route.endpoint.__code__.co_consts if isinstance(c, str))
    assert "territory_type=%s AND territory_id=%s" in sql
    assert "LIMIT %s OFFSET %s" in sql
    assert "typequ=ANY(%s)" in sql
    assert "aedar_territorial_aggregate" in sql
    assert "sql" not in route.endpoint.__annotations__


def test_aedar_source_measure_contract_has_312_fields_and_four_level_identity():
    from pathlib import Path
    root = Path(__file__).resolve().parents[2]
    source = (root / "pipeline/R/aedar_aggregates.R").read_text(encoding="utf-8")
    for field in ("code_insee", "epci_code", "code_departement", "code_region",
                  "LIB_TYPEQU", "n_addresses", "n_observed", "coverage_status"):
        assert field in source
    assert "length(measure_columns)!=312L" in source
    assert "never derive" in source


def test_aedar_migration_updates_markers_and_grants_database_roles():
    from pathlib import Path
    root = Path(__file__).resolve().parents[2]
    migration = (root / "api/migrations/028_aedar_territorial_aggregates.sql").read_text()
    fresh = (root / "api/schema.sql").read_text()
    for sql in (migration, fresh):
        assert "aedar_territorial_aggregate" in sql
        assert "shared_fact_publication_requires_reference" in sql
        assert "lusk_reader" in sql and "GRANT SELECT" in sql
        normalized = "".join(sql.split()).upper()
        assert "LUSK_PUBLISHER" in normalized and "GRANTSELECT,INSERT,UPDATE,DELETE" in normalized
    metadata_migration = (root / "api/migrations/031_aedar_typequ_metadata.sql").read_text()
    for field in ("typequ_hierarchy_label","typequ_description","typequ_domain_code","typequ_domain_label","typequ_subdomain_code",
                  "typequ_subdomain_label","typequ_gamme","typequ_gamme_status","typequ_source_order"):
        assert field in metadata_migration and field in fresh
    assert "typequ_gamme_status='hors_gamme' AND typequ_gamme IS NOT NULL AND typequ_gamme='Hors Gamme'" in metadata_migration
    assert "typequ_gamme_status='absent' AND typequ_gamme IS NULL" in metadata_migration


def test_aedar_metadata_complete_check_fails_closed_for_partial_gamme_states():
    import re
    import sqlite3
    from pathlib import Path

    root = Path(__file__).resolve().parents[2]
    migration = (root / "api/migrations/031_aedar_typequ_metadata.sql").read_text(encoding="utf-8")
    fresh = (root / "api/schema.sql").read_text(encoding="utf-8")
    pattern = r"aedar_typequ_metadata_complete_check\s+CHECK\s*\(COALESCE\((.*?),\s*FALSE\)\)"

    def expression(sql):
        match = re.search(pattern, sql, flags=re.IGNORECASE | re.DOTALL)
        assert match, "complete metadata constraint must COALESCE unknown to FALSE"
        return match.group(1)

    migration_check = expression(migration)
    fresh_check = expression(fresh)
    assert "".join(migration_check.split()).lower() == "".join(fresh_check.split()).lower()
    assert "typequ_gammeisnotnull" in "".join(migration_check.split()).lower()

    # SQLite shares PostgreSQL's relevant CHECK rule: NULL passes unless the
    # expression explicitly collapses UNKNOWN to FALSE. This is a hermetic
    # truth-table test of the exact constraint expression used by both schemas.
    columns = ("typequ_hierarchy_label", "typequ_description", "typequ_domain_code", "typequ_domain_label",
               "typequ_subdomain_code", "typequ_subdomain_label", "typequ_gamme_status", "typequ_source_order", "typequ_gamme")
    connection = sqlite3.connect(":memory:")
    connection.execute(f"CREATE TABLE metadata ({', '.join(columns)}, CHECK ({migration_check}))")
    names = ",".join(columns)
    placeholders = ",".join("?" for _ in columns)
    connection.execute(f"INSERT INTO metadata ({names}) VALUES ({placeholders})", (None,) * len(columns))
    absent = ("label", "description", "D", "Domain", "S", "Subdomain", "absent", 1, None)
    connection.execute(f"INSERT INTO metadata ({names}) VALUES ({placeholders})", absent)
    hors_gamme_null = ("label", "description", "D", "Domain", "S", "Subdomain", "hors_gamme", 1, None)
    import pytest
    with pytest.raises(sqlite3.IntegrityError):
        connection.execute(f"INSERT INTO metadata ({names}) VALUES ({placeholders})", hors_gamme_null)


def test_aedar_typed_response_rejects_incomplete_measure_maps():
    from api.main import AEDARFactResponse
    import pytest
    with pytest.raises(Exception, match="312"):
        AEDARFactResponse(territory_id="x", territory_type="commune", typequ="A104",
            typequ_label="GENDARMERIE",typequ_hierarchy_label="GENDARMERIE",typequ_description="Description",
            typequ_domain_code="A",typequ_domain_label="Services",
            typequ_subdomain_code="A1",typequ_subdomain_label="Publics",typequ_gamme=None,
            typequ_gamme_status="absent",typequ_source_order=1,
            identity={"code_insee":"x"}, n_addresses=1,
            n_observed=1, coverage_status="covered", measures={"count_5_walk_share":0},
            source_id="aedar_bretagne", vintage_id="2026-v1", source_url="https://example.test",
            licence="ODbL", attribution="AEDAR", reference_date=None, publication_date="2026-09-30")


def test_aedar_http_read_bounds_results_for_all_territory_levels(monkeypatch):
    from contextlib import contextmanager
    from fastapi.testclient import TestClient
    import api.main as main

    class Cursor:
        description = [type("Column", (), {"name": n}) for n in
                       ("territory_id", "territory_type", "typequ", "typequ_label","typequ_hierarchy_label","typequ_description",
                        "typequ_domain_code","typequ_domain_label","typequ_subdomain_code",
                        "typequ_subdomain_label","typequ_gamme","typequ_gamme_status","typequ_source_order",
                        "identity", "n_addresses", "n_observed", "coverage_status",
                        "measures", "source_id", "vintage_id", "source_url", "licence", "attribution",
                        "reference_date", "publication_date")]
        def fetchone(self): return ("aedar-v1", 1, "ref-v1", "ref-v1")
        def fetchall(self):
            return [("id", "commune", "C401", "STS SECTION TECHNICIEN SUPÉRIEUR, CPGE CLASSE PRÉPARATOIRE AUX GRANDES ÉCOLES",
                     "STS SECTION TECHNICIEN SUPÉRIEUR, CPGE CLASSE PRÉPARATOIRE AUX GRANDES\nÉCOLES",
                     "Official description line one\nline two", "C","Services","C4","Publics",
                     "Hors Gamme","hors_gamme",1,{"code_insee": "id"},
                     10, 8, "covered", {key: (0 if key == "count_5_walk_share" else None)
                       for key in main._AEDAR_MEASURE_KEYS}, "aedar_bretagne",
                      "2026-v1", "https://example.test", "ODbL",
                      "© OpenStreetMap contributors; données AEDAR — licence ODbL", None, "2026-09-30")]
    class Connection:
        def execute(self, sql, *_args, **_kwargs):
            if "SELECT p.content_version" in sql:
                return type("Marker",(),{"fetchone":lambda self:("aedar-v1",1,"ref-v1","ref-v1")})()
            return Cursor()
        @contextmanager
        def transaction(self): yield self
    class FakePool:
        @contextmanager
        def connection(self): yield Connection()
    monkeypatch.setattr(main, "pool", lambda: FakePool())
    client = TestClient(main.app)
    for level in ("commune", "epci", "departement", "region"):
        response = client.get(f"/api/aedar/territories/{level}/id/aggregates?limit=1&typequ=C401")
        assert response.status_code == 200
        body = response.json()
        assert body["territory"] == {"territory_type": level, "territory_id": "id"}
        assert len(body["facts"]) == 1
        assert body["facts"][0]["licence"] == "ODbL"
        assert body["facts"][0]["measures"]["count_5_walk_share"] == 0
        assert body["facts"][0]["typequ_domain_code"] == "C"
        assert body["facts"][0]["typequ_label"] == "STS SECTION TECHNICIEN SUPÉRIEUR, CPGE CLASSE PRÉPARATOIRE AUX GRANDES ÉCOLES"
        assert body["facts"][0]["typequ_hierarchy_label"] == "STS SECTION TECHNICIEN SUPÉRIEUR, CPGE CLASSE PRÉPARATOIRE AUX GRANDES\nÉCOLES"
        assert body["facts"][0]["typequ_description"] == "Official description line one\nline two"
        assert body["facts"][0]["typequ_gamme"] == "Hors Gamme"
        assert body["facts"][0]["typequ_gamme_status"] == "hors_gamme"
        assert body["facts"][0]["typequ_source_order"] == 1
        assert len(body["facts"][0]["measures"]) == 312
        assert body["facts"][0]["publication_date"] == "2026-09-30"
        assert body["content_version"] == "aedar-v1"
        assert body["reference_content_version"] == "ref-v1"
        assert body["facts"][0]["attribution"] == "© OpenStreetMap contributors; données AEDAR — licence ODbL"
