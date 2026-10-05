"""Canonical grant producer -> registered R publisher -> named HTTP acquisition."""
import json
import os
import subprocess
import statistics
import uuid
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit

import pytest

pytestmark = pytest.mark.integration


def test_canonical_annual_grants_survive_registered_publication(tmp_path):
    required = ("LUSK_TEST_PUBLISH_DSN", "LUSK_TEST_READ_DSN",
                "LUSK_TEST_DATABASE_NAME", "LUSK_TEST_CANONICAL_DATA_DIR")
    if not all(os.getenv(key) for key in required):
        pytest.skip("requires explicitly guarded disposable PostgreSQL and canonical artifacts")
    assert os.environ["LUSK_TEST_DATABASE_PREFIX"] == "lusk_it_"
    assert os.environ["LUSK_TEST_DATABASE_NAME"].startswith("lusk_it_")
    import psycopg
    from fastapi.testclient import TestClient
    from api.main import ReadRepository, app, get_repository, pool

    root = Path(__file__).resolve().parents[3]
    canonical = Path(os.environ["LUSK_TEST_CANONICAL_DATA_DIR"])
    # An independently published producer projection, not an expectation made
    # by the serving projector or by the API's SQL aggregation.
    rows = json.loads((canonical / "indicateurs_programmes.json").read_text(encoding="utf-8-sig"))
    expected = next(row for row in rows if row["key"] == "subventions_annuelles"
                    and row["territoire"] == "35238")
    schema = "it_" + uuid.uuid4().hex[:20]

    def scoped(dsn):
        url = urlsplit(dsn)
        query = parse_qs(url.query)
        query["options"] = [f"-csearch_path={schema}"]
        return urlunsplit((url.scheme, url.netloc, url.path, urlencode(query, doseq=True), url.fragment))

    class Connections:
        def connection(self):
            return psycopg.connect(scoped(os.environ["LUSK_TEST_READ_DSN"]))

    with psycopg.connect(os.environ["LUSK_TEST_PUBLISH_DSN"], autocommit=True) as pub:
        assert pub.execute("SELECT current_database(),current_user").fetchone() == (
            os.environ["LUSK_TEST_DATABASE_NAME"], urlsplit(os.environ["LUSK_TEST_PUBLISH_DSN"]).username)
        with psycopg.connect(os.environ["LUSK_TEST_READ_DSN"]) as reader:
            assert reader.execute("SELECT current_database(),current_user").fetchone() == (
                os.environ["LUSK_TEST_DATABASE_NAME"], urlsplit(os.environ["LUSK_TEST_READ_DSN"]).username)
        pub.execute(f'CREATE SCHEMA "{schema}"')
        try:
            pub.execute(f'SET search_path TO "{schema}"')
            pub.execute((root / "api/schema.sql").read_text(encoding="utf-8"))
            completed = subprocess.run(
                ["Rscript", "scripts/smoke-programme-postgres.R", schema],
                cwd=root / "pipeline", env=os.environ.copy(), capture_output=True,
                text=True, encoding="utf-8", errors="replace", timeout=180,
            )
            assert completed.returncode == 0, completed.stdout + completed.stderr
            annual_expected = [row for row in rows if row["key"] == "subventions_annuelles"]
            annual_sql = pub.execute("""SELECT o.territory_id,o.territory_type,o.axis_value,o.value,v.source_name,
                v.source_version,v.reference_date::text,v.publication_date::text
                FROM series_dataset_observation o JOIN series_observation_provenance p
                  USING(dataset_id,indicator_id,territory_id,axis_value)
                JOIN series_provenance_revision v USING(provenance_revision_id)
                WHERE o.indicator_id='subventions_annuelles'""").fetchall()
            domain_expected = [row for row in rows if row["key"] == "subventions_par_domaine"]
            domain_sql = pub.execute("""SELECT o.territory_id,o.territory_type,o.detail_key,o.observation_period,o.value,
                sd.name,v.version,v.reference_date::text,v.publication_date::text
                FROM period_detail_observation o JOIN source_dataset sd USING(source_id)
                JOIN source_vintage v USING(source_id,vintage_id)""").fetchall()
            member_expected = [row for row in rows if row["key"] == "couverture_programmes"]
            member_sql = pub.execute("""SELECT o.territory_id,o.territory_type,o.detail_key,
                CASE WHEN o.convention_valant_ort THEN c.rider_label ELSE NULL END,
                sd.name,v.version,v.reference_date::text,v.publication_date::text
                FROM anchored_membership o JOIN observed_collection_category c USING(indicator_id,detail_key)
                JOIN source_dataset sd ON sd.source_id=o.source_id JOIN source_vintage v
                  ON v.source_id=o.source_id AND v.vintage_id=o.vintage_id""").fetchall()
            assert len(annual_sql) == len(annual_expected)
            assert len(domain_sql) == len(domain_expected)
            assert len(member_sql) == len(member_expected)
            annual_by_key = {(row["territoire"],row["type"],row["dimension"]):row for row in annual_expected}
            for territory,level,period,value,name,version,reference_date,publication_date in annual_sql:
                row = annual_by_key[(territory,level,period)]
                assert value == pytest.approx(row["value"],rel=0,abs=1e-6)
                assert (name,version,reference_date,publication_date) == tuple(row[key] for key in (
                    "vintage_source","vintage_version","vintage_date_reference","vintage_date_publication"))
            domains_by_key = {(row["territoire"],row["type"],row["detail"],row["dimension"]):row for row in domain_expected}
            for territory,level,detail,period,value,name,version,reference_date,publication_date in domain_sql:
                row = domains_by_key[(territory,level,detail,period)]
                assert value == pytest.approx(row["value"],rel=0,abs=1e-6)
                assert (name,version,reference_date,publication_date) == tuple(row[key] for key in (
                    "vintage_source","vintage_version","vintage_date_reference","vintage_date_publication"))
            members_by_key = {(row["territoire"],row["type"],row["detail"]):row for row in member_expected}
            for territory,level,detail,rider,name,version,reference_date,publication_date in member_sql:
                row = members_by_key[(territory,level,detail)]
                assert rider == row["rider"]
                assert (name,version,reference_date,publication_date) == tuple(row[key] for key in (
                    "vintage_source","vintage_version","vintage_date_reference","vintage_date_publication"))
            role = urlsplit(os.environ["LUSK_TEST_READ_DSN"]).username
            from psycopg import sql
            pub.execute(sql.SQL("GRANT USAGE ON SCHEMA {} TO {}").format(sql.Identifier(schema), sql.Identifier(role)))
            pub.execute(sql.SQL("GRANT SELECT ON ALL TABLES IN SCHEMA {} TO {}").format(sql.Identifier(schema), sql.Identifier(role)))
            app.dependency_overrides[get_repository] = lambda: ReadRepository(Connections())
            pool.cache_clear()
            with TestClient(app) as client:
                response = client.get("/api/territories/commune/35238/indicators/subventions_annuelles")
            assert response.status_code == 200, response.text
            body = response.json()
            assert body["indicator_id"] == expected["key"]
            assert body["theme_id"] == "programmes"
            assert body["unit"] == expected["unit"]
            point = next(point for point in body["points"] if point["axis"] == expected["dimension"])
            assert point["value"] == pytest.approx(expected["value"], rel=0, abs=1e-6)
            assert point["observation_period"] == expected["dimension"]
            assert point["status"] == "measured"
            source = point["provenance"][0]
            assert source["source_name"] == expected["vintage_source"]
            assert source["version"] == expected["vintage_version"]
            assert source["reference_date"] == expected["vintage_date_reference"]
            assert source["publication_date"] == expected["vintage_date_publication"]
            assert body["scope_series"] == []
            parent_id = pub.execute("SELECT epci_id FROM territory_reference WHERE territory_id=%s", (expected["territoire"],)).fetchone()[0]
            parent_expected = next(row for row in rows if row["key"] == expected["key"]
                                   and row["territoire"] == parent_id and row["dimension"] == expected["dimension"])
            context = body["context"]
            assert context["parent"]["id"] == parent_id
            assert context["parent"]["type"] == "epci"
            assert context["points"][0]["axis"] == expected["dimension"]
            assert context["points"][0]["value"] == pytest.approx(parent_expected["value"], rel=0, abs=1e-6)
            domains = [row for row in rows if row["key"] == "subventions_par_domaine"
                       and row["territoire"] == expected["territoire"]]
            with TestClient(app) as client:
                domain_response = client.get("/api/territories/commune/35238/indicators/subventions_par_domaine")
            assert domain_response.status_code == 200, domain_response.text
            entries = domain_response.json()["entries"]
            assert len(entries) == len(domains)
            for domain in domains:
                entry = next(entry for entry in entries if entry["detail"] == domain["detail"]
                             and entry["observation_period"] == domain["dimension"])
                assert entry["value"] == pytest.approx(domain["value"], rel=0, abs=1e-6)
                assert entry["sources"][0]["version"] == domain["vintage_version"]
                assert entry["sources"][0]["reference_date"] == domain["vintage_date_reference"]
            assert domain_response.json()["completeness"] == "observed_sparse"
            metadata = json.loads((root / "pipeline/inst/extdata/theme-metadata/theme_programmes.json").read_text(encoding="utf-8"))
            facet = metadata["indicator_pages"]["subventions_par_domaine"]["comparison"]
            domain_peers = [row for row in rows if row["key"] == "subventions_par_domaine"
                            and row["detail"] == facet["detail"] and row["dimension"] == facet["dimension"]
                            and row["territoire"] != expected["territoire"]][:2]
            with TestClient(app) as client:
                domain_comparison = client.post("/api/territories/commune/35238/indicators/subventions_par_domaine/comparison",
                    json={"selection": [{"territory_type":"commune","territory_id":row["territoire"]} for row in domain_peers]})
            assert domain_comparison.status_code == 200, domain_comparison.text
            assert domain_comparison.json()["result"]["median"] == pytest.approx(
                statistics.median(row["value"] for row in domain_peers), rel=0, abs=1e-6)
            assert "entries" not in domain_comparison.json()
            assert "focal_value" not in domain_comparison.json()["result"]
            with TestClient(app) as client:
                for selection in ([],[{"territory_type":"commune","territory_id":domain_peers[0]["territoire"]}]):
                    limited = client.post("/api/territories/commune/35238/indicators/subventions_par_domaine/comparison",
                        json={"selection":selection})
                    assert limited.status_code == 200, limited.text
                    assert limited.json()["result"]["selected_member_count"] == len(selection)
                    assert limited.json()["result"]["median"] is None
                mixed_selection = [{"territory_type":"epci","territory_id":parent_id},
                                   {"territory_type":"commune","territory_id":expected["territoire"]}]
                mixed = client.post("/api/territories/commune/35238/indicators/subventions_par_domaine/comparison",
                    json={"selection":mixed_selection})
                assert mixed.status_code == 200, mixed.text
                mixed_ids = {key for (key,) in pub.execute("SELECT territory_id FROM territory_reference WHERE territory_type='commune' AND epci_id=%s",(parent_id,))}
                mixed_values = [row["value"] for row in domain_expected if row["territoire"] in mixed_ids
                                and row["detail"]==facet["detail"] and row["dimension"]==facet["dimension"]]
                assert mixed.json()["result"]["selected_member_count"] == len(mixed_ids)
                assert mixed.json()["result"]["median"] == pytest.approx(statistics.median(mixed_values),rel=0,abs=1e-6)
                theme_comparison = client.post("/api/territories/commune/35238/themes/programmes/comparison",
                    json={"theme_id":"programmes","selection":mixed_selection})
                assert theme_comparison.status_code == 200, theme_comparison.text
                assert {result["indicator_id"] for result in theme_comparison.json()["results"]} == {
                    "subventions_annuelles","subventions_par_domaine","couverture_programmes"}
                assert not {"entries","relationships","summaries","context","points"}.intersection(theme_comparison.json())
                assert all("focal_value" not in result for result in theme_comparison.json()["results"])
            reference_version = pub.execute("SELECT content_version FROM table_publication WHERE table_name='territory_reference'").fetchone()[0]
            pub.execute("UPDATE table_publication SET content_version='incompatible-test-reference' WHERE table_name='territory_reference'")
            with TestClient(app) as client:
                for indicator in ("couverture_programmes","subventions_par_domaine","subventions_annuelles"):
                    incompatible = client.get(f"/api/territories/commune/35238/indicators/{indicator}")
                    assert incompatible.status_code == 503, incompatible.text
                    incompatible_comparison = client.post(f"/api/territories/commune/35238/indicators/{indicator}/comparison",json={"selection":[]})
                    assert incompatible_comparison.status_code == 503, incompatible_comparison.text
            pub.execute("UPDATE table_publication SET content_version=%s WHERE table_name='territory_reference'",(reference_version,))
            membership_expected = [row for row in rows if row["key"] == "couverture_programmes"
                                   and row["territoire"] == expected["territoire"]]
            with TestClient(app) as client:
                membership_response = client.get("/api/territories/commune/35238/indicators/couverture_programmes")
            assert membership_response.status_code == 200, membership_response.text
            assert len(membership_response.json()["entries"]) == len(membership_expected)
            for membership in membership_expected:
                entry = next(entry for entry in membership_response.json()["entries"] if entry["detail"] == membership["detail"])
                assert entry["rider"] == membership["rider"]
                assert entry["sources"][0]["name"] == membership["vintage_source"]
                assert entry["sources"][0]["reference_date"] == membership["vintage_date_reference"]
                assert entry["sources"][0]["publication_date"] == membership["vintage_date_publication"]
            memberships = [row for row in rows if row["key"] == "couverture_programmes"]
            with TestClient(app) as client:
                for membership in (row for row in memberships if row["detail"] == "ORT"):
                    ort = client.get(f'/api/territories/{membership["type"]}/{membership["territoire"]}/indicators/couverture_programmes')
                    assert ort.status_code == 200, ort.text
                    entry = next(entry for entry in ort.json()["entries"] if entry["detail"] == membership["detail"])
                    assert entry["sources"][0]["reference_date"] == membership["vintage_date_reference"]
                    assert entry["sources"][0]["publication_date"] is None
                for level, code in (("epci",parent_id),("departement","35"),("region",next(row["territoire"] for row in rows if row["type"]=="region"))):
                    related = client.get(f'/api/territories/{level}/{code}/indicators/couverture_programmes')
                    assert related.status_code == 200, related.text
                    if level == "region":
                        relevant = {row["territoire"] for row in memberships}
                    elif level == "epci":
                        relevant = {key for (key,) in pub.execute("SELECT territory_id FROM territory_reference WHERE epci_id=%s",(code,))}
                        relevant.add(code)
                    else:
                        refs = pub.execute("SELECT territory_id,epci_id FROM territory_reference WHERE territory_type='commune' AND department_id=%s",(code,)).fetchall()
                        relevant = {key for key, _ in refs} | {epci for _,epci in refs if epci is not None}
                    expected_anchors = {(row["detail"],row["territoire"]) for row in memberships if row["territoire"] in relevant}
                    body_related = related.json()
                    actual_anchors = {(entry["detail"],code) for entry in body_related["entries"]} | {
                        (relation["detail"],relation["anchor"]["id"]) for relation in body_related["relationships"]}
                    assert actual_anchors == expected_anchors
                    assert {(summary["detail"],summary["anchor_count"]) for summary in body_related["summaries"]} == {
                        (detail,len({anchor for key,anchor in expected_anchors if key==detail}))
                        for detail in {key for key,_ in expected_anchors}}
                noncomparable = client.post("/api/territories/commune/35238/indicators/couverture_programmes/comparison",json={"selection":[]})
                assert noncomparable.status_code == 200, noncomparable.text
                assert noncomparable.json()["result"]["reason"] == "categorical_membership_not_comparable"
                assert "relationships" not in noncomparable.json() and "entries" not in noncomparable.json()
            # Fiche focal eligibility includes regional facts even where the
            # standalone indicator page limits its comparison controls.
            annual = [row for row in rows if row["key"] == expected["key"]]
            with TestClient(app) as client:
                for level in ("commune", "epci", "departement", "region"):
                    focal = next(row for row in annual if row["type"] == level)
                    read = client.get(f'/api/territories/{level}/{focal["territoire"]}/indicators/{focal["key"]}')
                    assert read.status_code == 200, read.text
                    focal_point = next(point for point in read.json()["points"] if point["axis"] == focal["dimension"])
                    assert focal_point["value"] == pytest.approx(focal["value"], rel=0, abs=1e-6)
                    if level == "region":
                        assert read.json()["context"] is None
                    elif level != "commune":
                        assert read.json()["context"]["parent"]["type"] == "region"
                peers = [row for row in annual if row["type"] == "commune"
                         and row["territoire"] != expected["territoire"]][:2]
                selection = [{"territory_type": "commune", "territory_id": row["territoire"]} for row in peers]
                comparison = client.post("/api/territories/commune/35238/indicators/subventions_annuelles/comparison",
                                         json={"selection": selection})
                assert comparison.status_code == 200, comparison.text
                result = comparison.json()["result"]
                assert result["median"] == pytest.approx(statistics.median(row["value"] for row in peers), rel=0, abs=1e-6)
                assert result["source_facet"] == expected["dimension"]
                assert result["selected_member_count"] == len(peers)
                assert "focal_value" not in result and "points" not in comparison.json()
                assert "context" not in comparison.json()
                empty = client.post("/api/territories/commune/35238/indicators/subventions_annuelles/comparison",
                                    json={"selection": []})
                assert empty.status_code == 200, empty.text
                assert empty.json()["scope"]["member_count"] == 0
                assert empty.json()["result"]["median"] is None
                region = next(row for row in annual if row["type"] == "region")
                regional_comparison = client.post(
                    f'/api/territories/region/{region["territoire"]}/indicators/subventions_annuelles/comparison',
                    json={"selection": selection})
                assert regional_comparison.status_code == 200, regional_comparison.text
                assert regional_comparison.json()["result"]["status"] == "unavailable"
                assert regional_comparison.json()["result"]["median"] is None
                observed_ids = {row["territoire"] for row in annual}
                absent_id = next(territory_id for (territory_id,) in pub.execute(
                    "SELECT territory_id FROM territory_reference WHERE territory_type='commune' ORDER BY territory_id"
                ) if territory_id not in observed_ids)
                absent = client.get(f"/api/territories/commune/{absent_id}/indicators/subventions_annuelles")
                assert absent.status_code == 200, absent.text
                assert absent.json()["availability"] == "no_record"
                assert absent.json()["points"] == []
                absent_domain = client.get(f"/api/territories/commune/{absent_id}/indicators/subventions_par_domaine")
                assert absent_domain.status_code == 200, absent_domain.text
                assert absent_domain.json()["entries"] == []
                assert absent_domain.json()["availability"] == "no_record"
                theme = client.get("/api/territories/commune/35238/themes/programmes/facts")
                assert theme.status_code == 200, theme.text
                assert theme.json()["complete_theme"] is False
                theme_indicators = [row for row in theme.json()["indicators"]
                                    if row["indicator_id"] == expected["key"]]
                theme_series = next(row for row in theme.json()["indicator_metadata"]
                                    if row["indicator_id"] == expected["key"])
                assert len(theme_indicators) == len(theme_series["axis_values"])
                assert [row["dimensions"]["axis"] for row in theme_indicators] == theme_series["axis_values"]
                assert {collection["indicator_id"] for collection in theme.json()["collections"]} == {
                    "couverture_programmes", "subventions_par_domaine"}
                assert next(result for result in theme.json()["default_comparison"]["results"]
                            if result["indicator_id"] == expected["key"])["statistic"] == "median"
            # Rehearse upgrading a populated pre-017 projection. The existing
            # fail-closed contract is the default; no facts or markers change.
            collection_before = pub.execute("SELECT indicator_id,content_version,row_count FROM observed_collection_publication ORDER BY indicator_id").fetchall()
            with pytest.raises(psycopg.errors.RaiseException):
                with pub.transaction():
                    pub.execute("UPDATE observed_collection_publication SET row_count=row_count+1,published_at=transaction_timestamp() WHERE indicator_id='subventions_par_domaine'")
            assert pub.execute("SELECT indicator_id,content_version,row_count FROM observed_collection_publication ORDER BY indicator_id").fetchall() == collection_before
            with pytest.raises(psycopg.errors.RaiseException):
                with pub.transaction():
                    pub.execute("UPDATE observed_collection_publication SET content_version='invalid-contract',published_at=transaction_timestamp() WHERE indicator_id='subventions_par_domaine'")
                    pub.execute("UPDATE observed_collection_category SET source_id='acv' WHERE indicator_id='subventions_par_domaine'")
            assert pub.execute("SELECT indicator_id,content_version,row_count FROM observed_collection_publication ORDER BY indicator_id").fetchall() == collection_before
            with pytest.raises(psycopg.errors.NotNullViolation):
                with pub.transaction():
                    pub.execute("UPDATE observed_collection_publication SET content_version='invalid-fact',published_at=transaction_timestamp() WHERE indicator_id='subventions_par_domaine'")
                    pub.execute("UPDATE period_detail_observation SET value=NULL WHERE indicator_id='subventions_par_domaine'")
            assert pub.execute("SELECT indicator_id,content_version,row_count FROM observed_collection_publication ORDER BY indicator_id").fetchall() == collection_before
            before = pub.execute("SELECT content_version,row_count FROM series_dataset_publication ORDER BY dataset_id").fetchall()
            pub.execute("ALTER TABLE series_dataset_descriptor DROP COLUMN absence_semantics")
            pub.execute("ALTER TABLE series_dataset_descriptor DROP COLUMN comparison_levels")
            pub.execute("DROP TABLE series_context_parent_policy")
            pub.execute((root / "api/migrations/017_series_source_absence.sql").read_text(encoding="utf-8"))
            assert pub.execute("SELECT content_version,row_count FROM series_dataset_publication ORDER BY dataset_id").fetchall() == before
            assert pub.execute("SELECT DISTINCT absence_semantics FROM series_dataset_descriptor").fetchall() == [("unavailable",)]
            with TestClient(app) as client:
                legacy_absent = client.get(f"/api/territories/commune/{absent_id}/indicators/subventions_annuelles")
            assert legacy_absent.status_code == 503
            legacy_markers = pub.execute("SELECT dataset_id,content_version,row_count FROM series_dataset_publication ORDER BY dataset_id").fetchall()
            reference_marker = pub.execute("SELECT content_version,row_count FROM table_publication WHERE table_name='territory_reference'").fetchone()
            for table in ("anchored_membership","period_detail_observation","observed_collection_category",
                          "observed_collection_descriptor","observed_collection_publication"):
                pub.execute(sql.SQL("DROP TABLE {}").format(sql.Identifier(table)))
            for function in ("validate_observed_collection_write","validate_period_detail_observation",
                             "validate_anchored_membership","validate_observed_collection_publication"):
                pub.execute(sql.SQL("DROP FUNCTION {}()").format(sql.Identifier(function)))
            pub.execute((root / "api/migrations/018_observed_collections.sql").read_text(encoding="utf-8"))
            assert pub.execute("SELECT dataset_id,content_version,row_count FROM series_dataset_publication ORDER BY dataset_id").fetchall() == legacy_markers
            assert pub.execute("SELECT content_version,row_count FROM table_publication WHERE table_name='territory_reference'").fetchone() == reference_marker
            republished = subprocess.run(["Rscript","scripts/smoke-programme-postgres.R",schema,"--collections-only"],
                cwd=root / "pipeline",env=os.environ.copy(),capture_output=True,text=True,encoding="utf-8",errors="replace",timeout=180)
            assert republished.returncode == 0, republished.stdout + republished.stderr
            pub.execute(sql.SQL("GRANT SELECT ON ALL TABLES IN SCHEMA {} TO {}").format(sql.Identifier(schema),sql.Identifier(role)))
            with TestClient(app) as client:
                after_upgrade = client.get("/api/territories/commune/35238/indicators/subventions_par_domaine")
                annual_after_upgrade = client.get("/api/territories/commune/35238/indicators/subventions_annuelles")
            assert after_upgrade.status_code == 200, after_upgrade.text
            assert len(after_upgrade.json()["entries"]) == len(domains)
            assert annual_after_upgrade.status_code == 200, annual_after_upgrade.text
            assert annual_after_upgrade.json()["points"][0]["value"] == pytest.approx(expected["value"],rel=0,abs=1e-6)
        finally:
            app.dependency_overrides.clear()
            pool.cache_clear()
            pub.execute(f'DROP SCHEMA "{schema}" CASCADE')
