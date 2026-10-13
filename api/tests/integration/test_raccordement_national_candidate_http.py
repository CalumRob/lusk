"""Reviewed national artifact -> canonical R publisher -> guarded PostgreSQL -> HTTP."""
import json
import os
import re
import subprocess
import uuid
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit

import pytest

pytestmark = pytest.mark.integration


def test_national_candidate_publisher_http_focal_reference_and_selected_mean_curves(tmp_path):
    required = ["LUSK_TEST_PUBLISH_DSN", "LUSK_TEST_READ_DSN", "LUSK_TEST_DATABASE_NAME", "LUSK_TEST_DATABASE_PREFIX"]
    if not all(os.getenv(key) for key in required):
        pytest.skip("requires explicitly guarded private PostgreSQL test configuration")
    assert os.environ["LUSK_TEST_DATABASE_PREFIX"] == "lusk_it_"
    assert os.environ["LUSK_TEST_DATABASE_NAME"] == "lusk_it_contract"
    import psycopg
    from fastapi.testclient import TestClient
    from api.main import ReadRepository, app, get_repository, pool

    root = Path(__file__).resolve().parents[3]
    schema = "it_raccordement_" + uuid.uuid4().hex[:16]
    upgrade = psycopg.connect(os.environ["LUSK_TEST_PUBLISH_DSN"], autocommit=True)
    created = False

    def scoped(dsn):
        uri = urlsplit(dsn)
        query = parse_qs(uri.query)
        query["options"] = [f"-csearch_path={schema}"]
        return urlunsplit((uri.scheme, uri.netloc, uri.path, urlencode(query, doseq=True), uri.fragment))

    try:
        assert upgrade.execute("select current_database(),current_user").fetchone() == (
            os.environ["LUSK_TEST_DATABASE_NAME"], urlsplit(os.environ["LUSK_TEST_PUBLISH_DSN"]).username)
        with psycopg.connect(os.environ["LUSK_TEST_READ_DSN"]) as identity:
            assert identity.execute("select current_database(),current_user").fetchone() == (
                os.environ["LUSK_TEST_DATABASE_NAME"], urlsplit(os.environ["LUSK_TEST_READ_DSN"]).username)
        upgrade.execute(f'CREATE SCHEMA "{schema}"')
        created = True
        upgrade.execute(f'SET search_path TO "{schema}"')
        upgrade.execute((root / "api/schema.sql").read_text(encoding="utf-8"))

        prepared = tmp_path / "national-inputs.json"
        prepare = tmp_path / "prepare-national.R"
        prepare.write_text('''args<-commandArgs(TRUE); root<-args[[1]]; target<-args[[2]]
pkgload::load_all(file.path(root,"pipeline"),quiet=TRUE)
a<-lusk:::lire_artefact_raccordement_national()
v<-lusk:::vintages_mobilite()
rows<-lusk:::lignes_indicateurs_raccordement_national(a$calculation,v)
zero<-a$membership$code[which(a$membership$structural_zero_reason=="no_modeled_endpoint_stops")[[1]]]
epci<-a$membership$epci_code[match("35085",a$membership$code)]
density<-a$membership$density_class_code[match("35085",a$membership$code)]
calc<-a$calculation
oracle<-list(combourg=calc$commune_curves[calc$commune_curves$code=="35085",],
 zero=calc$commune_curves[calc$commune_curves$code==zero,],
 region=calc$aggregate_curves[calc$aggregate_curves$level=="region",],
 epci=calc$aggregate_curves[calc$aggregate_curves$level=="epci" & calc$aggregate_curves$group_code==epci,],
 density=calc$aggregate_curves[calc$aggregate_curves$level=="density_class" & calc$aggregate_curves$group_code==density,],
 reference=calc$regional_mean_reference)
jsonlite::write_json(list(membership=a$membership,indicators=rows,vintages=v,oracle=oracle,
 zero_code=zero,combourg_epci=epci,combourg_density=density),target,
  dataframe="rows",auto_unbox=TRUE,na="null",digits=16)
''', encoding="utf-8")
        env = os.environ.copy()
        env["PGPASSFILE"] = str(Path(os.environ["APPDATA"]) / "PostgreSQL/pgpass.conf")
        library = subprocess.run(["Rscript", "-e", "cat(.libPaths()[1])"], cwd=root / "pipeline",
                                 capture_output=True, text=True, check=True).stdout
        env["R_LIBS_USER"] = library
        prepared_run = subprocess.run(["Rscript", str(prepare), str(root), str(prepared)], cwd=root,
                                      env=env, capture_output=True, text=True)
        assert prepared_run.returncode == 0, prepared_run.stdout + prepared_run.stderr
        data = json.loads(prepared.read_text(encoding="utf-8"))
        membership = data["membership"]
        codes = {row["code"] for row in membership}
        assert len(codes) == 1202
        epcis = {}
        for row in membership:
            if row["epci_code"] is not None:
                epcis[row["epci_code"]] = row["epci_reference_name"]
        communes = [(row["code"], "commune", row["code"], row["department_code"],
                     row["epci_code"], row["density_class_code"], row["density_class_registered_label"])
                    for row in membership]
        groups = ([(code, "epci", name, None, None, None, None) for code, name in epcis.items()] +
                  [(code, "departement", code, None, None, None, None) for code in sorted({r["department_code"] for r in membership})] +
                  [("53", "region", "Bretagne", None, None, None, None)])
        refs = communes + groups
        upgrade.cursor().executemany("""INSERT INTO territory_reference
          (territory_id,territory_type,name,department_id,epci_id,density_class_code,density_class_label)
          VALUES(%s,%s,%s,%s,%s,%s,%s)""", refs)
        upgrade.execute("INSERT INTO table_publication(table_name,content_version,row_count) VALUES('territory_reference','national-test-ref-v1',%s)",
                        (len(refs),))
        upgrade.execute("INSERT INTO access_publication_metadata(singleton,bretagne_kind,bretagne_label) VALUES(true,'region','Bretagne')")
        upgrade.execute("INSERT INTO table_publication(table_name,content_version,row_count) VALUES('essential_service_access','national-test-access-v1',1)")
        upgrade.execute("INSERT INTO service_registry(service) VALUES('fixture_service')")
        upgrade.execute("""INSERT INTO essential_service_access(territory_id,service,mode,share,indicator_label,effective_direction,source_id,source_name,source_version,reference_date,source_publication_date)
          VALUES('35085','fixture_service','walk_transit',.5,'Fixture access','high','fixture_access','Fixture access','v1','2026-01-01','2026-01-02')""")
        upgrade.execute("INSERT INTO source_dataset(source_id,name) VALUES('mobility_snapshot','Mobility reading fixture')")
        upgrade.execute("INSERT INTO source_vintage(source_id,vintage_id,version,reference_date,publication_date) VALUES('mobility_snapshot','v1','v1','2026-01-01','2026-01-02')")
        upgrade.execute("INSERT INTO mobility_reading_story(story_key,groupe,salience_reason,ordinal) VALUES('fixture_story','fixture_group','fixture_reason',1)")
        upgrade.execute("INSERT INTO mobility_reading_clock(ordinal,clock_name,frequency,reference,trigger) VALUES(1,'Fixture clock','annual','Fixture reference','Fixture trigger')")
        upgrade.execute("""INSERT INTO mobility_reading_descriptor(singleton,descriptor_version,source_id,vintage_id,source_name,dataset_name,source_version,reference_date,publication_date,unit,direction,allowed_levels,missing_status,classification_values,field_keys,story_count,clock_count)
          VALUES(true,'1','mobility_snapshot','v1','Mobility reading fixture','Fixture','v1','2026-01-01','2026-01-02','count','high',ARRAY['commune','epci','departement','region'],'unavailable',ARRAY['saillant'],ARRAY['groupe','story_key','salience_reason','classification_saillance','div_loss_t','div_loss_b','status'],1,1)""")
        upgrade.execute("""INSERT INTO mobility_typed_reading(territory_id,territory_type,groupe,story_key,salience_reason,classification_saillance,div_loss_t,div_loss_b,status,source_id,vintage_id)
          VALUES('35085','commune','fixture_group','fixture_story','fixture_reason','saillant',1,.5,'measured','mobility_snapshot','v1')""")
        upgrade.execute("INSERT INTO table_publication(table_name,content_version,row_count,reference_content_version) VALUES('mobility_typed_reading','fixture-reading-v1',1,'national-test-ref-v1')")
        vintage = next(row for row in data["vintages"] if row["id"] == "raccordement_gtfs_national")
        upgrade.execute("INSERT INTO source_dataset(source_id,name) VALUES(%s,%s)",
                        (vintage["id"], vintage["source"]))
        upgrade.execute("""INSERT INTO source_vintage(source_id,vintage_id,version,reference_date,publication_date)
          VALUES(%s,%s,%s,%s,%s)""", (vintage["id"], vintage["version"], vintage["version"],
          vintage["date_reference"], vintage["date_publication"]))

        payload_path = tmp_path / "canonical-rows.json"
        payload_path.write_text(json.dumps({"indicators": data["indicators"], "vintages": data["vintages"]}),
                                encoding="utf-8")
        metadata_path = root / "pipeline/inst/extdata/theme-metadata/theme_mobilite.json"
        publish = tmp_path / "publish-national.R"
        publish.write_text('''args<-commandArgs(TRUE); root<-args[[1]]; payload<-jsonlite::read_json(args[[2]],simplifyVector=TRUE)
metadata<-jsonlite::read_json(args[[3]],simplifyVector=FALSE); schema<-args[[4]]
pkgload::load_all(file.path(root,"pipeline"),quiet=TRUE)
canonical<-list(mobilite=list(indicateurs=as.data.frame(payload$indicators)),vintages=as.data.frame(payload$vintages))
con<-DBI::dbConnect(RPostgres::Postgres(),dbname=Sys.getenv("LUSK_TEST_DATABASE_NAME"),host="192.168.1.120",port=5432,user="lusk_it_contract_pub")
DBI::dbExecute(con,sprintf("SET search_path TO \\\"%s\\\"",schema))
registry<-lusk:::register_raccordement_owned_publisher(list(),metadata)
adapter<-lusk:::owned_series_postgres_adapter(con)
result<-lusk:::publish_registered_series(registry,"raccordement_courbe_owned",canonical,adapter)
stopifnot(isTRUE(result$changed),nrow(adapter$dataset_marker("raccordement_courbe"))==1L)
retry<-lusk:::publish_registered_series(registry,"raccordement_courbe_owned",canonical,adapter)
stopifnot(!retry$changed)
DBI::dbDisconnect(con)
''', encoding="utf-8")
        env.update({"LUSK_TEST_DATABASE_NAME": "lusk_it_contract"})
        published = subprocess.run(["Rscript", str(publish), str(root), str(payload_path), str(metadata_path), schema],
                                   cwd=root, env=env, capture_output=True, text=True)
        assert published.returncode == 0, published.stdout + published.stderr
        assert upgrade.execute("SELECT row_count FROM series_dataset_publication WHERE dataset_id='raccordement_courbe'").fetchone() == (92637,)
        assert upgrade.execute("SELECT count(*) FROM series_dataset_observation WHERE indicator_id='raccordement_courbe'").fetchone() == (92564,)
        assert upgrade.execute("SELECT count(*) FROM series_named_reference WHERE reference_id='bretagne_all_assessed_communes_mean'").fetchone() == (73,)

        # The ordinary scalar publisher must consume a paired, isolated canonical
        # bundle, not relabel the incumbent static scalar with national metadata.
        # All non-raccordement observations retain their original bytes/lineage.
        bundle = tmp_path / "isolated-national-canonical"
        bundle.mkdir()
        scalar_publish = tmp_path / "publish-national-scalar.R"
        scalar_publish.write_text('''args<-commandArgs(TRUE); root<-args[[1]]; bundle<-args[[2]]; schema<-args[[3]]
pkgload::load_all(file.path(root,"pipeline"),quiet=TRUE)
a<-lusk:::lire_artefact_raccordement_national()
national<-lusk:::lignes_indicateurs_raccordement_national(a$calculation,lusk:::vintages_mobilite())
incumbent<-nanoparquet::read_parquet(file.path(root,"public/data/indicateurs_mobilite.parquet"))
keep<-!incumbent$key %in% c("raccordement_tc","raccordement_courbe","raccordement_reference")
combined<-dplyr::bind_rows(incumbent[keep,],national[,setdiff(names(national),"code"),drop=FALSE])
preserved<-as.data.frame(combined[seq_len(sum(keep)),names(incumbent)])
original<-as.data.frame(incumbent[keep,]); rownames(preserved)<-rownames(original)<-NULL
stopifnot(identical(preserved,original))
v<-nanoparquet::read_parquet(file.path(root,"public/data/vintages.parquet"))
new_v<-lusk:::vintages_mobilite(); new_v<-new_v[new_v$id=="raccordement_gtfs_national",]
v<-dplyr::bind_rows(v[!v$id %in% new_v$id,],new_v)
nanoparquet::write_parquet(combined,file.path(bundle,"indicateurs_mobilite.parquet"))
nanoparquet::write_parquet(v,file.path(bundle,"vintages.parquet"))
stopifnot(file.copy(file.path(root,"pipeline/inst/extdata/theme-metadata/theme_mobilite.json"),file.path(bundle,"theme_mobilite.json")))
refs<-nanoparquet::read_parquet(file.path(root,"public/data/territoires.parquet"))
eligible<-data.frame(territory_id=as.character(refs$territoire),territory_type=as.character(refs$type))
registry<-lusk:::register_scalar_publisher(list(),"canonical_mobility",
 project=function(directory) lusk:::project_mobility_scalar_cohort(directory,eligible),
 publish=function(projection,db,version) db$replace(projection,version))
con<-DBI::dbConnect(RPostgres::Postgres(),dbname=Sys.getenv("LUSK_TEST_DATABASE_NAME"),host="192.168.1.120",port=5432,user="lusk_it_contract_pub")
DBI::dbExecute(con,sprintf("SET search_path TO \\"%s\\"",schema))
adapter<-lusk:::scalar_postgres_adapter(con)
published<-lusk:::publish_registered_scalar(registry,"canonical_mobility",bundle,adapter)
stopifnot(published$changed)
retry<-lusk:::publish_registered_scalar(registry,"canonical_mobility",bundle,adapter)
stopifnot(!retry$changed)
# Rejected candidate refreshes must leave the already published scalar visible.
# Invoke the same public publisher, then prove its previous value/version/source
# through HTTP below; do not substitute hand-inserted SQL observations.
original<-nanoparquet::read_parquet(file.path(bundle,"indicateurs_mobilite.parquet"))
index<-which(original$key=="raccordement_tc" & original$territoire=="35238")
stopifnot(length(index)==1L)
rejections<-list()
for (field in c("value","vintage_source","vintage_date_reference")) {
 bad<-original
 bad[[field]][index]<-switch(field,value=original$value[index]+.01,
   vintage_source="Legacy mairie producer",vintage_date_reference="2000-01-01")
 nanoparquet::write_parquet(bad,file.path(bundle,"indicateurs_mobilite.parquet"))
 error<-tryCatch({lusk:::publish_registered_scalar(registry,"canonical_mobility",bundle,adapter);NULL},error=function(e) conditionMessage(e))
 stopifnot(!is.null(error),grepl("Raccordement scalar",error,fixed=TRUE))
 rejections[[field]]<-error
}
nanoparquet::write_parquet(original,file.path(bundle,"indicateurs_mobilite.parquet"))
retry<-lusk:::publish_registered_scalar(registry,"canonical_mobility",bundle,adapter)
stopifnot(!retry$changed,identical(retry$content_version,published$content_version))
jsonlite::write_json(list(schema=schema,bundle=bundle,content_version=published$content_version,
 rejected_refreshes=rejections,unchanged_non_raccordement_rows=sum(keep),matrix_sha256=a$matrix_sha256,envelope_sha256=a$envelope_sha256),
 file.path(bundle,"publisher-receipt.json"),auto_unbox=TRUE,pretty=TRUE)
DBI::dbDisconnect(con)
''', encoding="utf-8")
        scalar_run = subprocess.run(["Rscript", str(scalar_publish), str(root), str(bundle), schema],
                                    cwd=root, env=env, capture_output=True, text=True)
        assert scalar_run.returncode == 0, scalar_run.stdout + scalar_run.stderr
        scalar_receipt = json.loads((bundle / "publisher-receipt.json").read_text(encoding="utf-8"))
        assert set(scalar_receipt["rejected_refreshes"]) == {"value", "vintage_source", "vintage_date_reference"}

        role = urlsplit(os.environ["LUSK_TEST_READ_DSN"]).username
        assert re.fullmatch(r"[A-Za-z0-9_$-]+", role)
        upgrade.execute(f'GRANT USAGE ON SCHEMA "{schema}" TO "{role}"')
        upgrade.execute(f'GRANT SELECT ON ALL TABLES IN SCHEMA "{schema}" TO "{role}"')

        class Connections:
            def connection(self):
                class Context:
                    def __enter__(self): self.conn = psycopg.connect(scoped(os.environ["LUSK_TEST_READ_DSN"])); return self.conn
                    def __exit__(self, *args): self.conn.close()
                return Context()
        app.dependency_overrides[get_repository] = lambda: ReadRepository(Connections())
        pool.cache_clear()
        combourg = "35085"
        zero = next(row for row in membership if row["code"] == data["zero_code"])
        combourg_row = next(row for row in membership if row["code"] == combourg)
        density_code = data["combourg_density"]
        to_values = lambda rows: [row["share"] if "share" in row else row["share_mean"] for row in rows]
        with TestClient(app) as client:
            scalar_cases = [("commune", "35238", .43772196082183124),
                            ("commune", "35085", .31532250816815825),
                            ("commune", data["zero_code"], 0),
                            ("epci", data["combourg_epci"], to_values(data["oracle"]["epci"])[18]),
                            ("departement", "35", next(row["value"] for row in data["indicators"]
                                if row["key"] == "raccordement_courbe" and row["type"] == "departement"
                                and row["territoire"] == "35" and row["detail"] == "t0090")),
                            ("region", "53", .0815863775592058)]
            scalar_bodies = []
            for level, code, expected in scalar_cases:
                scalar = client.get(f"/api/territories/{level}/{code}/indicators/raccordement_tc")
                curve = client.get(f"/api/territories/{level}/{code}/indicators/raccordement_courbe")
                assert scalar.status_code == curve.status_code == 200, (scalar.text, curve.text)
                body = scalar.json()
                assert body["status"] == "measured"
                assert body["content_version"] == scalar_receipt["content_version"]
                assert body["value"] == pytest.approx(expected, abs=1e-12)
                assert body["value"] == next(point["value"] for point in curve.json()["points"] if point["axis"] == "t0090")
                assert body["sources"] == [{"source_id": vintage["id"], "name": vintage["source"],
                    "vintage_id": vintage["version"] + "/" + vintage["date_reference"],
                    "version": vintage["version"], "reference_date": vintage["date_reference"],
                    "publication_date": vintage["date_publication"]}]
                scalar_bodies.append(body)
            (bundle / "scalar-http-receipt.json").write_text(json.dumps(scalar_bodies, ensure_ascii=False, indent=2), encoding="utf-8")
            focal = client.get(f"/api/territories/commune/{combourg}/indicators/raccordement_courbe")
            zero_response = client.get(f"/api/territories/commune/{zero['code']}/indicators/raccordement_courbe")
            region = client.get("/api/territories/region/53/indicators/raccordement_courbe")
            epci = client.get(f"/api/territories/epci/{combourg_row['epci_code']}/indicators/raccordement_courbe")
            selected_epci = client.post(f"/api/territories/commune/{combourg}/indicators/raccordement_courbe/comparison",
                json={"selection":[{"territory_type":"epci","territory_id":data["combourg_epci"]}]})
            one_member = client.post(f"/api/territories/commune/{combourg}/indicators/raccordement_courbe/comparison",
                json={"selection":[{"territory_type":"commune","territory_id":combourg}]})
            default_facts = client.get(f"/api/territories/commune/{combourg}/themes/mobilite/facts")
            density_rank = client.post("/api/territories/commune/35238/indicators/raccordement_courbe/comparison")
            rennes_epci = next(row for row in membership if row["code"] == "35238")["epci_code"]
            epci_rank = client.post("/api/territories/commune/35238/indicators/raccordement_courbe/comparison",
                json={"selection":[{"territory_type":"epci","territory_id":rennes_epci}]})
        responses={"focal":focal,"zero":zero_response,"region":region,"epci":epci,
                   "default_facts":default_facts,"selected_epci":selected_epci,"one_member":one_member,
                   "density_rank":density_rank,"epci_rank":epci_rank}
        assert all(response.status_code==200 for response in responses.values()), {
            key:(response.status_code,response.text[:1000]) for key,response in responses.items()
            if response.status_code != 200
        }
        focal_body, zero_body = focal.json(), zero_response.json()
        assert len(focal_body["points"]) == len(region.json()["points"]) == len(epci.json()["points"]) == 73
        assert focal_body["axis_numeric_values"] == list(range(0, 361, 5))
        assert focal_body["named_references"][0]["id"] == "bretagne_all_assessed_communes_mean"
        assert len(focal_body["named_references"][0]["points"]) == 73
        assert [point["value"] for point in focal_body["points"]] == pytest.approx(to_values(data["oracle"]["combourg"]), abs=1e-12)
        assert [point["value"] for point in region.json()["points"]] == pytest.approx(to_values(data["oracle"]["region"]), abs=1e-12)
        assert [point["value"] for point in focal_body["named_references"][0]["points"]] == pytest.approx(to_values(data["oracle"]["reference"]), abs=1e-12)
        assert focal_body["points"][18]["value"] == pytest.approx(.31532250816815825, abs=1e-12)
        assert all(point["value"] == 0 and point["status"] == "measured" and
                   point["missing_reason"] == zero["structural_zero_reason"] for point in zero_body["points"])
        assert [point["value"] for point in zero_body["points"]] == pytest.approx(to_values(data["oracle"]["zero"]), abs=1e-12)
        default_mean = next(row for row in default_facts.json()["default_comparison"]["results"]
                            if row["indicator_id"] == "raccordement_courbe")
        assert default_mean["statistic"] == "mean" and len(default_mean["mean_curve"]["points"]) == 73
        assert default_mean["mean_curve"]["scope"]["density_class_code"] == density_code
        assert [point["value"] for point in default_mean["mean_curve"]["points"]] == pytest.approx(to_values(data["oracle"]["density"]), abs=1e-12)
        assert default_mean["mean_curve"]["model_zero_reason_counts"] == {
            "endpoint_stops_but_no_permitted_first_boarding": 24, "no_modeled_endpoint_stops": 55}
        comparison_sources = default_mean["comparison_sources"]
        assert len(comparison_sources) == 1
        assert comparison_sources[0]["source_id"] == "raccordement_gtfs_national"
        assert len(comparison_sources[0]["revision_hash"]) == 64
        density_result = density_rank.json()["result"]
        assert (density_result["rank"], density_result["rank_size"]) == (1, 14)
        assert default_mean["rank_size"] == default_mean["eligible_count"] == 331
        selected_result = selected_epci.json()["result"]
        assert selected_result["statistic"] == "mean" and "median" not in selected_result
        assert selected_result["mean"] == pytest.approx(to_values(data["oracle"]["epci"])[18], abs=1e-12)
        assert [point["value"] for point in selected_result["mean_curve"]["points"]] == pytest.approx(to_values(data["oracle"]["epci"]), abs=1e-12)
        assert selected_result["mean_curve"]["model_zero_reason_counts"]["no_modeled_endpoint_stops"] == 13
        assert selected_result["comparison_sources"] == comparison_sources
        selected_theme_result = next(row for row in default_facts.json()["default_comparison"]["results"]
                                     if row["indicator_id"] == "raccordement_courbe")
        assert selected_theme_result["mean_curve"]["model_zero_reason_counts"] == {
            "endpoint_stops_but_no_permitted_first_boarding": 24, "no_modeled_endpoint_stops": 55}
        assert selected_result["mean_curve"]["model_zero_reason_counts"]["no_modeled_endpoint_stops"] == 13
        epci_rank_result = epci_rank.json()["result"]
        assert (epci_rank_result["rank"], epci_rank_result["rank_size"]) == (1, 43)
        single_result=one_member.json()["result"]
        assert single_result["status"]=="unavailable" and single_result["reason"]=="fewer_than_two_comparable_values"
        assert single_result["mean"] is None and single_result["mean_curve"] is None

        # A failed refresh must leave the previous complete publication readable
        # through both the focal-series and selected-group comparison routes.
        prior_curve = focal.json()
        prior_selected_mean = selected_epci.json()["result"]["mean_curve"]

        def reject_owned_refresh(rows, expected_error, name):
            candidate = tmp_path / f"{name}-canonical.json"
            candidate.write_text(json.dumps({"indicators": rows, "vintages": data["vintages"]}),
                                 encoding="utf-8")
            script = tmp_path / f"{name}-refresh.R"
            script.write_text('''args<-commandArgs(TRUE); root<-args[[1]]; payload<-jsonlite::read_json(args[[2]],simplifyVector=TRUE)
metadata<-jsonlite::read_json(args[[3]],simplifyVector=FALSE); schema<-args[[4]]; expected<-args[[5]]
pkgload::load_all(file.path(root,"pipeline"),quiet=TRUE)
canonical<-list(mobilite=list(indicateurs=as.data.frame(payload$indicators)),vintages=as.data.frame(payload$vintages))
con<-DBI::dbConnect(RPostgres::Postgres(),dbname=Sys.getenv("LUSK_TEST_DATABASE_NAME"),host="192.168.1.120",port=5432,user="lusk_it_contract_pub")
identity<-DBI::dbGetQuery(con,"SELECT current_database() AS database,current_user AS role")
stopifnot(identical(identity$database[[1L]],Sys.getenv("LUSK_TEST_DATABASE_NAME")),
  identical(identity$role[[1L]],"lusk_it_contract_pub"))
DBI::dbExecute(con,sprintf("SET search_path TO \\\"%s\\\"",schema))
registry<-lusk:::register_raccordement_owned_publisher(list(),metadata)
adapter<-lusk:::owned_series_postgres_adapter(con)
failure<-tryCatch({lusk:::publish_registered_series(registry,"raccordement_courbe_owned",canonical,adapter);NULL},error=function(e) conditionMessage(e))
stopifnot(!is.null(failure),grepl(expected,failure,fixed=TRUE))
DBI::dbDisconnect(con)
''', encoding="utf-8")
            completed = subprocess.run(["Rscript", str(script), str(root), str(candidate),
                str(metadata_path), schema, expected_error], cwd=root / "pipeline", env=env,
                capture_output=True, text=True)
            assert completed.returncode == 0, completed.stdout + completed.stderr
            with TestClient(app) as client:
                curve = client.get(f"/api/territories/commune/{combourg}/indicators/raccordement_courbe")
                selected = client.post(
                    f"/api/territories/commune/{combourg}/indicators/raccordement_courbe/comparison",
                    json={"selection":[{"territory_type":"epci","territory_id":data["combourg_epci"]}]})
            assert curve.status_code == selected.status_code == 200
            assert curve.json()["publication_id"] == prior_curve["publication_id"]
            assert curve.json()["points"] == prior_curve["points"]
            assert selected.json()["result"]["mean_curve"] == prior_selected_mean

        missing_member_rows = [row for row in data["indicators"] if not (
            row["key"] == "raccordement_courbe" and row["type"] == "commune" and
            row["territoire"] == combourg)]
        reject_owned_refresh(missing_member_rows,
            "Dense-complete duration publication omits reference territory/territories: commune/35085",
            "missing-commune-curve")

        missing_point_rows = [row for row in data["indicators"] if not (
            row["key"] == "raccordement_courbe" and row["type"] == "commune" and
            row["territoire"] == combourg and row["detail"] == "t0090")]
        reject_owned_refresh(missing_point_rows,
            "Canonical focal raccordement curve for commune 35085 is missing declared point(s): t0090",
            "missing-duration-point")
    finally:
        app.dependency_overrides.pop(get_repository, None)
        pool.cache_clear()
        upgrade.close()
