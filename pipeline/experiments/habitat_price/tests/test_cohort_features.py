"""Cohort and feature contracts (issue #736).

These pin the rules the issue states explicitly, so a later refactor cannot
silently change them: one price per mutation, the residential surface
denominator, age at sale rather than raw year, unknown stays unknown, and a
negative age is flagged rather than clamped.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from habitat_price import cohort, features


def _raw_rows():
    """Minimal native-shaped rows: one row per mutation, as DVF+ delivers."""
    return pd.DataFrame({
        "idopendata": ["a" * 32, "b" * 32],
        "idmutation": ["1", "2"],
        "datemut": ["2023-05-01", "2023-06-01"],
        "anneemut": ["2023", "2023"],
        "moismut": ["5", "6"],
        "coddep": ["35", "29"],
        "libnatmut": ["Vente", "Vente"],
        "vefa": ["False", "False"],
        "valeurfonc": ["200000", "150000"],
        "nblocmai": ["1", "0"],
        "nblocapt": ["0", "1"],
        "nblocact": ["0", "0"],
        "nblocdep": ["0", "0"],
        "nblocmut": ["1", "1"],
        "sbati": ["100", "50"],
        "sbatmai": ["100", "0"],
        "sbatapt": ["0", "50"],
        "sbatact": ["0", "0"],
        "codtypbien": ["111", "121"],
        "libtypbien": ["UNE MAISON", "UN APPARTEMENT"],
        "geompar_x": ["350000", "150000"],
        "geompar_y": ["6780000", "6830000"],
    })


def _relation():
    return pd.DataFrame({
        "id_opendata": ["a" * 32, "b" * 32],
        "batiment_groupe_id": ["bg-1", "bg-2"],
        "code_departement_insee": ["35", "29"],
        "fiabilite_croisement": ["FORTE", "FORTE"],
        "join_id_opendata": ["1", "1"],
        "join_geom_local": ["", ""],
    })


def test_price_is_read_once_per_mutation():
    classified = cohort.classify_mutations(_raw_rows(), _relation())
    main = classified[classified["main_cohort"]]
    assert sorted(main["idmutation"]) == ["1", "2"]
    assert main.loc[main["idmutation"] == "1", "valeurfonc"].iloc[0] == 200000.0


def test_residential_surface_is_house_plus_apartment():
    classified = cohort.classify_mutations(_raw_rows(), _relation())
    main = classified[classified["main_cohort"]].set_index("idmutation")
    assert main.loc["1", "residential_surface"] == 100.0
    assert main.loc["2", "residential_surface"] == 50.0
    assert main.loc["1", "price_per_m2"] == pytest.approx(2000.0)


def test_sentinel_price_is_flagged_not_silently_kept():
    rows = _raw_rows()
    rows.loc[0, "valeurfonc"] = "1"
    rows.loc[1, "valeurfonc"] = "1"
    classified = cohort.classify_mutations(rows, _relation())
    assert classified.loc[classified["idmutation"] == "1", "price_sentinel"].all()


def test_age_at_sale_uses_sale_year_and_flags_future_construction():
    frame = pd.DataFrame({
        "anneemut": [2023, 2023],
        "group_construction_year": [1990.0, 2025.0],
        "batiment_groupe_id": ["bg-1", "bg-2"],
    })
    frame["group_matched"] = True
    relation = pd.DataFrame({"id_opendata": ["x", "y"],
                             "batiment_groupe_id": ["bg-1", "bg-2"],
                             "fiabilite_croisement": ["FORTE", "FORTE"]})
    frame["idopendata"] = ["x", "y"]
    descriptors = pd.DataFrame({"batiment_groupe_id": ["bg-1", "bg-2"],
                                "group_construction_year": [1990.0, 2025.0]})
    from habitat_price import bdnb
    out = bdnb.attach_group_context(frame, relation, descriptors)
    assert out["age_at_sale"].tolist() == [33.0, -2.0]
    assert out["group_built_after_sale"].tolist() == [False, True]


def test_unknown_construction_year_stays_unknown():
    frame = pd.DataFrame({
        "anneemut": [2023],
        "idopendata": ["x"],
        "batiment_groupe_id": ["bg-1"],
        "group_matched": [True],
    })
    relation = pd.DataFrame({"id_opendata": ["x"], "batiment_groupe_id": ["bg-1"],
                             "fiabilite_croisement": ["FORTE"]})
    descriptors = pd.DataFrame({"batiment_groupe_id": ["bg-1"],
                                "group_construction_year": [np.nan]})
    from habitat_price import bdnb
    out = bdnb.attach_group_context(frame, relation, descriptors)
    assert np.isnan(out["age_at_sale"].iloc[0])


def test_every_declared_feature_has_exactly_one_block():
    seen = {}
    for block, names in features.FEATURE_BLOCKS.items():
        for name in names:
            assert name not in seen, f"{name} declared twice"
            seen[name] = block
    for block, names in features.CATEGORICAL_BLOCKS.items():
        for name in names:
            assert name not in seen
            seen[name] = block


def test_estimation_subset_excludes_sentinel_and_keeps_audited_rows():
    frame = pd.DataFrame({
        "main_cohort": [True, True, False],
        "price_sentinel": [False, True, False],
        "log_y": [7.0, np.log(0.001), np.nan],
    })
    subset = features.model_estimation_subset(frame)
    assert len(subset) == 1
