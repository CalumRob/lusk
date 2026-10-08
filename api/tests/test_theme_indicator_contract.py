from api.main import _theme_owned_series_contract, _theme_owned_series_indicator
import json
from pathlib import Path


def test_mobility_canonical_pages_declare_regional_motorisation_and_curve():
    metadata_path = Path(__file__).parents[2] / "pipeline/inst/extdata/theme-metadata/theme_mobilite.json"
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    published_path = Path(__file__).parents[2] / "public/data/theme_mobilite.json"
    published = json.loads(published_path.read_text(encoding="utf-8"))
    pages = metadata["indicator_pages"]
    assert "region" in pages["voitures_menage"]["levels"]
    assert "region" in pages["raccordement_courbe"]["levels"]
    assert pages["voitures_menage"]["composition"]["parts"] == [
        "sans_voiture", "une_voiture", "deux_plus"]
    assert "region" in published["indicator_pages"]["voitures_menage"]["levels"]
    assert published["indicator_pages"]["voitures_menage"] == pages["voitures_menage"]
    assert published["indicator_pages"]["raccordement_courbe"] == pages["raccordement_courbe"]


def test_owned_series_contract_keeps_descriptor_and_named_reference_independent():
    series = {
        "indicator_id": "raccordement_courbe", "dataset_id": "owned-dataset",
        "theme_id": "mobilite", "axis_kind": "duration_minute",
        "axis_values": ["60"], "axis_numeric_values": [60], "completeness": "dense_complete",
        "direction": "low", "descriptor_version": "descriptor-v3",
        "comparison_point": "60", "observation_period_kind": "source_snapshot",
        "context": {"territory_id": "22001", "source_revision": "context-rev"},
        "points": [{"axis": "60", "value": 0.4}], "scope_series": [],
        "named_references": [{"id": "commune_bretonne_mediane", "role": "reference",
            "statistic": "median_routed_communes", "unit": "%", "observation_period_kind": "source_snapshot",
            "points": [{"axis": "60", "observation_period": "2026-09-16", "value": 0.2,
                "status": "measured", "provenance": [{"revision_id": "ref-rev", "revision_hash": "ref-hash"}]}]}],
    }
    metadata, references = _theme_owned_series_contract([series])
    assert metadata == [{key: value for key, value in series.items()
                         if key not in ("points", "scope_series", "named_references")}]
    assert references == [{"indicator_id": "raccordement_courbe", **series["named_references"][0]}]
    assert references[0]["points"][0]["provenance"][0]["revision_hash"] == "ref-hash"


def test_owned_series_indicator_preserves_period_numeric_axis_and_complete_revision_lineage():
    series = {"indicator_id": "raccordement_courbe", "label": "Raccordement", "unit": "%",
        "axis_values": ["60"], "axis_numeric_values": [60]}
    point = {"axis": "60", "observation_period": "2026-09-16", "state_role": None,
        "value": 0.4, "status": "measured", "provenance": [{
            "revision_id": "point-rev", "source_id": "source-1", "vintage_id": "vintage-7",
            "source_name": "Source", "dataset_name": "Dataset", "version": "v1",
            "reference_date": None, "publication_date": "2026-09-20", "revision_hash": "sha256"}]}
    fact = _theme_owned_series_indicator(series, point)
    assert fact["dimensions"] == {"axis": "60", "numeric_axis_value": 60,
        "observation_period": "2026-09-16"}
    assert fact["sources"][0] == {**point["provenance"][0], "name": "Source"}
