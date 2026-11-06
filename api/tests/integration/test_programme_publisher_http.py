"""Canonical grant producer -> registered R publisher -> named HTTP acquisition."""
import json
import os
import subprocess
import statistics
import uuid
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit

import pytest
import pandas as pd

from producer_artifacts import records

pytestmark = pytest.mark.integration


def _programme_producer_oracle(root: Path, canonical: Path, tmp_path: Path) -> Path:
    """Project test-only Parquet facts through the canonical R producer APIs."""
    output = tmp_path / "programme-producer-projections"
    script = tmp_path / "project-programme-fixture.R"
    script.write_text(
        """pkgload::load_all('.', quiet=TRUE, compile=FALSE)
canonical <- read_programme_serving_inputs(Sys.getenv('LUSK_TEST_CANONICAL_DATA_DIR'))
annual_registry <- register_programme_series_publishers(list(), canonical$metadata)
annual <- annual_registry$subventions_annuelles_owned$project(canonical$canonical)
collections <- lapply(register_programme_observed_collections(canonical$metadata),
  function(publisher) publisher$project(canonical$canonical))
output <- Sys.getenv('LUSK_TEST_PROGRAMME_ORACLE_DIR')
dir.create(output, recursive=TRUE, showWarnings=FALSE)
write_table <- function(name, value) {
  if (!is.data.frame(value)) stop('Producer projection is not a table: ', name)
  nanoparquet::write_parquet(value, file.path(output, paste0(name, '.parquet')))
}
write_table('annual-points', annual$points)
write_table('annual-provenance', annual$provenance)
write_table('annual-point-provenance', annual$point_provenance)
domain <- collections[['subventions_par_domaine']]
write_table('domain-facts', domain$facts)
write_table('domain-datasets', domain$datasets)
write_table('domain-vintages', domain$vintages)
membership <- collections[['couverture_programmes']]
write_table('membership-facts', membership$facts)
write_table('membership-categories', membership$categories)
write_table('membership-datasets', membership$datasets)
write_table('membership-vintages', membership$vintages)
""",
        encoding="utf-8",
    )
    env = os.environ.copy()
    env["LUSK_TEST_CANONICAL_DATA_DIR"] = str(canonical)
    env["LUSK_TEST_PROGRAMME_ORACLE_DIR"] = str(output)
    completed = subprocess.run(
        ["Rscript", str(script)], cwd=root / "pipeline", env=env,
        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=180,
    )
    assert completed.returncode == 0, completed.stdout + completed.stderr
    return output


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
    # Current canonical Parquets are projected by their existing R producer
    # APIs. These bounded test-oracle Parquets live only under pytest tmp_path;
    # no retired theme-wide export or new persistent artifact is written.
    oracle = _programme_producer_oracle(root, canonical, tmp_path)

    def oracle_table(name):
        return records(pd.read_parquet(oracle / f"{name}.parquet"))

    annual_expected = oracle_table("annual-points")
    annual_by_key = {(row["territory_id"], row["territory_type"], row["axis_value"]): row
                     for row in annual_expected}
    annual_provenance = {row["provenance_revision_id"]: row
                         for row in oracle_table("annual-provenance")}
    points_by_key = {(row["territory_id"], row["axis_value"]): row for row in annual_expected}
    annual_lineage = {}
    for link in oracle_table("annual-point-provenance"):
        point = points_by_key[(link["territory_id"], link["axis_value"])]
        key = (point["territory_id"], point["territory_type"], point["axis_value"])
        annual_lineage.setdefault(key, []).append(annual_provenance[link["provenance_revision_id"]])
    assert set(annual_lineage) == set(annual_by_key)

    domain_facts = oracle_table("domain-facts")
    domain_datasets = {row["source_id"]: row["name"] for row in oracle_table("domain-datasets")}
    domain_vintages = {(row["source_id"], row["vintage_id"]): row
                       for row in oracle_table("domain-vintages")}
    domain_expected = []
    for row in domain_facts:
        vintage = domain_vintages[(row["source_id"], row["vintage_id"])]
        domain_expected.append({**row, "vintage_source": domain_datasets[row["source_id"]],
            "vintage_version": vintage["version"],
            "vintage_date_reference": vintage["reference_date"],
            "vintage_date_publication": vintage["publication_date"]})
    domains_by_key = {(row["territory_id"], row["territory_type"], row["detail_key"],
                       row["observation_period"]): row for row in domain_expected}

    membership_facts = oracle_table("membership-facts")
    membership_categories = {row["detail_key"]: row
                             for row in oracle_table("membership-categories")}
    membership_datasets = {row["source_id"]: row["name"]
                           for row in oracle_table("membership-datasets")}
    membership_vintages = {(row["source_id"], row["vintage_id"]): row
                           for row in oracle_table("membership-vintages")}
    membership_expected = []
    for row in membership_facts:
        vintage = membership_vintages[(row["source_id"], row["vintage_id"])]
        category = membership_categories[row["detail_key"]]
        membership_expected.append({**row,
            "rider": category["rider_label"] if row["convention_valant_ort"] else None,
            "vintage_source": membership_datasets[row["source_id"]],
            "vintage_version": vintage["version"],
            "vintage_date_reference": vintage["reference_date"],
            "vintage_date_publication": vintage["publication_date"]})
    members_by_key = {(row["territory_id"], row["territory_type"], row["detail_key"]): row
                      for row in membership_expected}
    metadata = json.loads((root / "pipeline/inst/extdata/theme-metadata/theme_programmes.json")
                          .read_text(encoding="utf-8"))
    annual_page = metadata["indicator_pages"]["subventions_annuelles"]
    expected = next(row for row in annual_expected
                    if row["territory_type"] == "commune" and row["territory_id"] == "35238")
    assert expected["status"] == "measured"
    schema = "it_" + uuid.uuid4().hex[:20]
    artifact_directory = tmp_path / "comparison-artifacts"
    smoke_env = os.environ.copy()
    smoke_env["LUSK_TEST_ARTIFACT_DIR"] = str(artifact_directory)

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
                cwd=root / "pipeline", env=smoke_env, capture_output=True,
                text=True, encoding="utf-8", errors="replace", timeout=180,
            )
            assert completed.returncode == 0, completed.stdout + completed.stderr
            annual_sql = pub.execute("""SELECT o.territory_id,o.territory_type,o.axis_value,o.value,v.source_name,
                v.source_id,v.vintage_id,v.source_version,v.reference_date::text,v.publication_date::text
                FROM series_dataset_observation o JOIN series_observation_provenance p
                  USING(dataset_id,indicator_id,territory_id,axis_value)
                JOIN series_provenance_revision v USING(provenance_revision_id)
                WHERE o.indicator_id='subventions_annuelles'""").fetchall()
            domain_sql = pub.execute("""SELECT o.territory_id,o.territory_type,o.detail_key,o.observation_period,o.value,
                o.source_id,o.vintage_id,sd.name,v.version,v.reference_date::text,v.publication_date::text
                FROM period_detail_observation o JOIN source_dataset sd USING(source_id)
                JOIN source_vintage v USING(source_id,vintage_id)
                WHERE o.indicator_id='subventions_par_domaine'""").fetchall()
            member_sql = pub.execute("""SELECT o.territory_id,o.territory_type,o.detail_key,
                CASE WHEN o.convention_valant_ort THEN c.rider_label ELSE NULL END,
                o.source_id,o.vintage_id,sd.name,v.version,v.reference_date::text,v.publication_date::text
                FROM anchored_membership o JOIN observed_collection_category c USING(indicator_id,detail_key)
                JOIN source_dataset sd ON sd.source_id=o.source_id JOIN source_vintage v
                  ON v.source_id=o.source_id AND v.vintage_id=o.vintage_id
                WHERE o.indicator_id='couverture_programmes'""").fetchall()
            assert len(annual_sql) == len(annual_expected)
            assert len(domain_sql) == len(domain_expected)
            assert len(member_sql) == len(membership_expected)
            assert {(row[0], row[1], row[2]) for row in annual_sql} == set(annual_by_key)
            for territory,level,period,value,source_name,source_id,vintage_id,version,reference_date,publication_date in annual_sql:
                key = (territory,level,period)
                row = annual_by_key[key]
                lineage = annual_lineage[key]
                assert len(lineage) == 1
                producer_source = lineage[0]
                assert value == pytest.approx(row["value"],rel=0,abs=1e-6)
                assert (source_id,vintage_id,source_name,version,reference_date,publication_date) == (
                    producer_source["source_id"],producer_source["vintage_id"],producer_source["source_name"],
                    producer_source["source_version"],producer_source["reference_date"],
                    producer_source["publication_date"])
            assert {(row[0],row[1],row[2],row[3]) for row in domain_sql} == set(domains_by_key)
            for territory,level,detail,period,value,source_id,vintage_id,name,version,reference_date,publication_date in domain_sql:
                row = domains_by_key[(territory,level,detail,period)]
                assert value == pytest.approx(row["value"],rel=0,abs=1e-6)
                assert (source_id,vintage_id,name,version,reference_date,publication_date) == (
                    row["source_id"],row["vintage_id"],row["vintage_source"],row["vintage_version"],
                    row["vintage_date_reference"],row["vintage_date_publication"])
            assert {(row[0],row[1],row[2]) for row in member_sql} == set(members_by_key)
            for territory,level,detail,rider,source_id,vintage_id,name,version,reference_date,publication_date in member_sql:
                row = members_by_key[(territory,level,detail)]
                assert rider == row["rider"]
                assert (source_id,vintage_id,name,version,reference_date,publication_date) == (
                    row["source_id"],row["vintage_id"],row["vintage_source"],row["vintage_version"],
                    row["vintage_date_reference"],row["vintage_date_publication"])
            role = urlsplit(os.environ["LUSK_TEST_READ_DSN"]).username
            from psycopg import sql
            pub.execute(sql.SQL("GRANT USAGE ON SCHEMA {} TO {}").format(sql.Identifier(schema), sql.Identifier(role)))
            pub.execute(sql.SQL("GRANT SELECT ON ALL TABLES IN SCHEMA {} TO {}").format(sql.Identifier(schema), sql.Identifier(role)))
            app.dependency_overrides[get_repository] = lambda: ReadRepository(Connections())
            pool.cache_clear()
            with TestClient(app) as client:
                response = client.get("/api/territories/commune/35238/indicators/subventions_annuelles")
                status_only_series = client.get("/api/territories/commune/35238/indicators/subventions_annuelles?fields=status")
                value_series = client.get("/api/territories/commune/35238/indicators/subventions_annuelles?fields=value")
            assert response.status_code == 200, response.text
            assert status_only_series.status_code == 200, status_only_series.text
            assert all("value" not in point and point["status"] for point in status_only_series.json()["points"])
            assert all("value" not in point for point in status_only_series.json()["context"]["points"])
            assert value_series.status_code == 200, value_series.text
            assert [point["value"] for point in value_series.json()["points"]] == [
                point["value"] for point in response.json()["points"]]
            assert all("status" in point for point in value_series.json()["points"])
            body = response.json()
            assert body["indicator_id"] == "subventions_annuelles"
            assert body["theme_id"] == "programmes"
            assert body["unit"] == annual_page["unit"]
            point = next(point for point in body["points"] if point["axis"] == expected["axis_value"])
            assert point["value"] == pytest.approx(expected["value"], rel=0, abs=1e-6)
            assert point["observation_period"] == expected["observation_period"]
            assert point["status"] == "measured"
            source = point["provenance"][0]
            producer_source = annual_lineage[(expected["territory_id"], expected["territory_type"],
                                              expected["axis_value"])][0]
            assert source["source_id"] == producer_source["source_id"]
            assert source["version"] == producer_source["source_version"]
            assert source["reference_date"] == producer_source["reference_date"]
            assert source["publication_date"] == producer_source["publication_date"]
            assert body["scope_series"] == []
            parent_id = pub.execute("SELECT epci_id FROM territory_reference WHERE territory_id=%s", (expected["territory_id"],)).fetchone()[0]
            parent_expected = annual_by_key[(parent_id, "epci", expected["axis_value"])]
            context = body["context"]
            assert context["parent"]["id"] == parent_id
            assert context["parent"]["type"] == "epci"
            assert context["points"][0]["axis"] == expected["axis_value"]
            assert context["points"][0]["value"] == pytest.approx(parent_expected["value"], rel=0, abs=1e-6)
            domains = [row for row in domain_expected if row["territory_id"] == expected["territory_id"]]
            with TestClient(app) as client:
                domain_response = client.get("/api/territories/commune/35238/indicators/subventions_par_domaine")
                domain_status_only = client.get("/api/territories/commune/35238/indicators/subventions_par_domaine?fields=status")
            assert domain_response.status_code == 200, domain_response.text
            assert domain_status_only.status_code == 200, domain_status_only.text
            assert all("value" not in entry and entry["status"] == "measured"
                       for entry in domain_status_only.json()["entries"])
            assert [entry["sources"] for entry in domain_status_only.json()["entries"]] == [
                entry["sources"] for entry in domain_response.json()["entries"]]
            entries = domain_response.json()["entries"]
            assert len(entries) == len(domains)
            for domain in domains:
                entry = next(entry for entry in entries if entry["detail"] == domain["detail_key"]
                             and entry["observation_period"] == domain["observation_period"])
                assert entry["value"] == pytest.approx(domain["value"], rel=0, abs=1e-6)
                assert entry["sources"][0]["version"] == domain["vintage_version"]
                assert entry["sources"][0]["reference_date"] == domain["vintage_date_reference"]
            assert domain_response.json()["completeness"] == "observed_sparse"
            assert domain_response.json()["unit"] == metadata["indicator_pages"]["subventions_par_domaine"]["unit"]
            facet = metadata["indicator_pages"]["subventions_par_domaine"]["comparison"]
            domain_peers = [row for row in domain_expected if row["detail_key"] == facet["detail"]
                            and row["observation_period"] == facet["dimension"]
                            and row["territory_id"] != expected["territory_id"]][:2]
            with TestClient(app) as client:
                domain_comparison = client.post("/api/territories/commune/35238/indicators/subventions_par_domaine/comparison",
                    json={"selection": [{"territory_type":"commune","territory_id":row["territory_id"]} for row in domain_peers]})
            assert domain_comparison.status_code == 200, domain_comparison.text
            assert domain_comparison.json()["result"]["median"] == pytest.approx(
                statistics.median(row["value"] for row in domain_peers), rel=0, abs=1e-6)
            assert "entries" not in domain_comparison.json()
            assert "focal_value" not in domain_comparison.json()["result"]
            facet_rows = [row for row in domain_expected if row["territory_type"] == "commune"
                          and row["detail_key"] == facet["detail"]
                          and row["observation_period"] == facet["dimension"]]
            density_by_id = dict(pub.execute("SELECT territory_id,density_class_code FROM territory_reference WHERE territory_type='commune'").fetchall())
            values_by_density = {}
            for row in facet_rows:
                density_code = density_by_id.get(row["territory_id"])
                if density_code is not None:
                    values_by_density.setdefault(density_code, []).append(row)
            density_code, density_facts = next((key, rows) for key, rows in sorted(values_by_density.items())
                if len(rows) >= 2)
            focal_domain = density_facts[0]
            focal_id = focal_domain["territory_id"]
            density_values = [row["value"] for row in density_facts]
            with TestClient(app) as client:
                fixed_domain = client.post(
                    f"/api/territories/commune/{focal_id}/indicators/subventions_par_domaine/comparison")
            assert fixed_domain.status_code == 200, fixed_domain.text
            fixed_result = fixed_domain.json()["result"]
            assert fixed_result["median"] == pytest.approx(statistics.median(density_values), rel=0, abs=1e-6)
            direction = metadata["indicator_pages"]["subventions_par_domaine"]["direction"]
            focal_value = focal_domain["value"]
            better = sum(value > focal_value if direction == "high" else value < focal_value
                         for value in density_values)
            assert fixed_result["rank"] == 1 + better
            assert fixed_result["rank_size"] == len(density_values)
            assert fixed_domain.json()["scope"]["kind"] == "density_class"
            import pyarrow.parquet as pq
            generations = list(artifact_directory.glob(
                "observed-collection-comparison-subventions_par_domaine-*"))
            assert len(generations) == 1
            group_artifact = pq.read_table(generations[0] / "groups.parquet").to_pylist()
            territory_artifact = pq.read_table(generations[0] / "territories.parquet").to_pylist()
            group_columns = ("indicator_id","comparison_context","group_id","territory_type","detail_key",
                "observation_period","statistic","median","member_count","eligible_count","missing_count",
                "collection_content_version","reference_content_version")
            territory_columns = ("indicator_id","comparison_context","group_id","territory_type","detail_key",
                "observation_period","territory_id","value","status","rank","tie_count","rank_size",
                "collection_content_version","reference_content_version")
            group_database = [dict(zip(group_columns,row)) for row in pub.execute(
                """SELECT indicator_id,comparison_context,group_id,territory_type,detail_key,observation_period,
                    statistic,median,member_count,eligible_count,missing_count,collection_content_version,
                    reference_content_version FROM observed_collection_comparison_group
                    WHERE indicator_id='subventions_par_domaine'""").fetchall()]
            territory_database = [dict(zip(territory_columns,row)) for row in pub.execute(
                """SELECT indicator_id,comparison_context,group_id,territory_type,detail_key,observation_period,
                    territory_id,value,status,rank,tie_count,rank_size,collection_content_version,
                    reference_content_version FROM observed_collection_comparison_territory
                    WHERE indicator_id='subventions_par_domaine'""").fetchall()]
            assert sorted(group_artifact,key=repr) == sorted(group_database,key=repr)
            assert sorted(territory_artifact,key=repr) == sorted(territory_database,key=repr)
            with TestClient(app) as client:
                for selection in ([],[{"territory_type":"commune","territory_id":domain_peers[0]["territory_id"]}]):
                    limited = client.post("/api/territories/commune/35238/indicators/subventions_par_domaine/comparison",
                        json={"selection":selection})
                    assert limited.status_code == 200, limited.text
                    assert limited.json()["result"]["selected_member_count"] == len(selection)
                    assert limited.json()["result"]["median"] is None
                mixed_selection = [{"territory_type":"epci","territory_id":parent_id},
                                   {"territory_type":"commune","territory_id":expected["territory_id"]}]
                mixed = client.post("/api/territories/commune/35238/indicators/subventions_par_domaine/comparison",
                    json={"selection":mixed_selection})
                assert mixed.status_code == 200, mixed.text
                mixed_ids = {key for (key,) in pub.execute("SELECT territory_id FROM territory_reference WHERE territory_type='commune' AND epci_id=%s",(parent_id,))}
                mixed_values = [row["value"] for row in domain_expected if row["territory_id"] in mixed_ids
                                and row["detail_key"]==facet["detail"]
                                and row["observation_period"]==facet["dimension"]]
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
            membership_for_focal = [row for row in membership_expected
                                    if row["territory_id"] == expected["territory_id"]]
            with TestClient(app) as client:
                membership_response = client.get("/api/territories/commune/35238/indicators/couverture_programmes")
            assert membership_response.status_code == 200, membership_response.text
            assert membership_response.json()["unit"] == metadata["observed_collection_contracts"]["couverture_programmes"]["unit"]
            assert len(membership_response.json()["entries"]) == len(membership_for_focal)
            for membership in membership_for_focal:
                entry = next(entry for entry in membership_response.json()["entries"]
                             if entry["detail"] == membership["detail_key"])
                assert entry["rider"] == membership["rider"]
                assert entry["sources"][0]["name"] == membership["vintage_source"]
                assert entry["sources"][0]["reference_date"] == membership["vintage_date_reference"]
                assert entry["sources"][0]["publication_date"] == membership["vintage_date_publication"]
            memberships = membership_expected
            with TestClient(app) as client:
                for membership in (row for row in memberships if row["detail_key"] == "ORT"):
                    ort = client.get(f'/api/territories/{membership["territory_type"]}/{membership["territory_id"]}/indicators/couverture_programmes')
                    assert ort.status_code == 200, ort.text
                    entry = next(entry for entry in ort.json()["entries"] if entry["detail"] == membership["detail_key"])
                    assert entry["sources"][0]["reference_date"] == membership["vintage_date_reference"]
                    assert entry["sources"][0]["publication_date"] is None
                region_id = next(row["territory_id"] for row in annual_expected
                                 if row["territory_type"] == "region")
                for level, code in (("epci",parent_id),("departement","35"),("region",region_id)):
                    related = client.get(f'/api/territories/{level}/{code}/indicators/couverture_programmes')
                    assert related.status_code == 200, related.text
                    if level == "region":
                        relevant = {row["territory_id"] for row in memberships}
                    elif level == "epci":
                        relevant = {key for (key,) in pub.execute("SELECT territory_id FROM territory_reference WHERE epci_id=%s",(code,))}
                        relevant.add(code)
                    else:
                        refs = pub.execute("SELECT territory_id,epci_id FROM territory_reference WHERE territory_type='commune' AND department_id=%s",(code,)).fetchall()
                        relevant = {key for key, _ in refs} | {epci for _,epci in refs if epci is not None}
                    expected_anchors = {(row["detail_key"],row["territory_id"])
                                        for row in memberships if row["territory_id"] in relevant}
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
            annual = annual_expected
            with TestClient(app) as client:
                for level in ("commune", "epci", "departement", "region"):
                    focal = next(row for row in annual if row["territory_type"] == level)
                    read = client.get(f'/api/territories/{level}/{focal["territory_id"]}/indicators/subventions_annuelles')
                    assert read.status_code == 200, read.text
                    focal_point = next(point for point in read.json()["points"] if point["axis"] == focal["axis_value"])
                    assert focal_point["value"] == pytest.approx(focal["value"], rel=0, abs=1e-6)
                    if level == "region":
                        assert read.json()["context"] is None
                    elif level != "commune":
                        assert read.json()["context"]["parent"]["type"] == "region"
                peers = [row for row in annual if row["territory_type"] == "commune"
                         and row["territory_id"] != expected["territory_id"]][:2]
                selection = [{"territory_type": "commune", "territory_id": row["territory_id"]} for row in peers]
                comparison = client.post("/api/territories/commune/35238/indicators/subventions_annuelles/comparison",
                                         json={"selection": selection})
                assert comparison.status_code == 200, comparison.text
                result = comparison.json()["result"]
                assert result["median"] == pytest.approx(statistics.median(row["value"] for row in peers), rel=0, abs=1e-6)
                assert result["source_facet"] == expected["axis_value"]
                assert result["selected_member_count"] == len(peers)
                assert "focal_value" not in result and "points" not in comparison.json()
                assert "context" not in comparison.json()
                empty = client.post("/api/territories/commune/35238/indicators/subventions_annuelles/comparison",
                                    json={"selection": []})
                assert empty.status_code == 200, empty.text
                assert empty.json()["scope"]["member_count"] == 0
                assert empty.json()["result"]["median"] is None
                region = next(row for row in annual if row["territory_type"] == "region")
                regional_comparison = client.post(
                    f'/api/territories/region/{region["territory_id"]}/indicators/subventions_annuelles/comparison',
                    json={"selection": selection})
                assert regional_comparison.status_code == 200, regional_comparison.text
                assert regional_comparison.json()["result"]["status"] == "unavailable"
                assert regional_comparison.json()["result"]["median"] is None
                observed_ids = {row["territory_id"] for row in annual
                                if row["territory_type"] == "commune"}
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
                                    if row["indicator_id"] == "subventions_annuelles"]
                theme_series = next(row for row in theme.json()["indicator_metadata"]
                                    if row["indicator_id"] == "subventions_annuelles")
                assert len(theme_indicators) == len(theme_series["axis_values"])
                assert [row["dimensions"]["axis"] for row in theme_indicators] == theme_series["axis_values"]
                assert {collection["indicator_id"] for collection in theme.json()["collections"]} == {
                    "couverture_programmes", "subventions_par_domaine"}
                assert next(result for result in theme.json()["default_comparison"]["results"]
                            if result["indicator_id"] == "subventions_annuelles")["statistic"] == "median"
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
            for table in ("observed_collection_comparison_territory","observed_collection_comparison_group",
                          "observed_collection_comparison_publication","profile_comparison_territory",
                          "profile_comparison_group","profile_comparison_publication",
                          "anchored_membership","period_detail_observation","observed_collection_category",
                          "observed_collection_descriptor","observed_collection_publication"):
                pub.execute(sql.SQL("DROP TABLE {}").format(sql.Identifier(table)))
            for function in ("validate_observed_collection_comparison_write",
                             "validate_observed_collection_comparison_publication",
                             "validate_observed_collection_write","validate_period_detail_observation",
                             "validate_anchored_membership","validate_observed_collection_publication"):
                pub.execute(sql.SQL("DROP FUNCTION {}()").format(sql.Identifier(function)))
            pub.execute((root / "api/migrations/018_observed_collections.sql").read_text(encoding="utf-8"))
            pub.execute((root / "api/migrations/030_fixed_context_profile_collection_comparisons.sql").read_text(encoding="utf-8"))
            assert pub.execute("SELECT dataset_id,content_version,row_count FROM series_dataset_publication ORDER BY dataset_id").fetchall() == legacy_markers
            assert pub.execute("SELECT content_version,row_count FROM table_publication WHERE table_name='territory_reference'").fetchone() == reference_marker
            republished = subprocess.run(["Rscript","scripts/smoke-programme-postgres.R",schema,"--collections-only"],
                cwd=root / "pipeline",env=smoke_env,capture_output=True,text=True,encoding="utf-8",errors="replace",timeout=180)
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
