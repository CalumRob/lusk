"""Producer declarations feed the semantic catalogue without legacy wrappers."""

import json
from pathlib import Path

from api.resource_catalogue import default_resource_catalogue


def test_mobility_producer_pages_declare_retained_levels_and_canonical_curve():
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
    # The checked-in static payload is an incumbent snapshot; the producer's
    # retained owned-series declaration is authoritative for semantic discovery.
    assert len(published["indicator_pages"]["raccordement_courbe"]["comparison"]["details"]) == 11
    assert len(pages["raccordement_courbe"]["comparison"]["details"]) == 73
    assert pages["raccordement_courbe"]["comparison"]["detail"] == "t0090"


def test_owned_series_and_named_reference_are_producer_derived_resources():
    catalogue = default_resource_catalogue()
    metadata = json.loads((Path(__file__).parents[2] /
        "pipeline/inst/extdata/theme-metadata/theme_mobilite.json").read_text(encoding="utf-8"))
    route = metadata["owned_series_routes"]["raccordement_courbe"]
    series = catalogue.resources_by_id["raccordement_courbe"]
    reference = catalogue.resources_by_id["raccordement_reference"]
    assert route["active_read_route"] is True
    assert route["reference_read_route"] is True
    assert series.shapes == ("ordered_series",)
    assert series.axes == ("duration_minute",)
    assert reference.shapes == ("named_reference",)
    assert reference.target_kinds == ("named_reference",)
    assert reference.target_ids == (route["reference_id"],)
    assert "facts" in reference.intents
