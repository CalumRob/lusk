"""Guarded-run regression for owned-series fixed-comparison SQL parameters."""

import pytest

from api import snapshot_reads
from api.tests.test_owned_series_published_comparison import FixedComparisonConnection


pytestmark = pytest.mark.integration


def test_fixed_comparison_publication_parameters_are_reference_dataset_indicator():
    connection = FixedComparisonConnection()

    snapshot_reads._owned_series_comparison_results(
        connection,
        [(connection.dataset, "milieux", False, connection.indicator)],
        "commune", "c1", None,
        cohort=("commune", tuple(connection.members),
                {"kind": "density_class", "density_class_code": "d1"}),
    )

    publication_parameters = [
        params for sql, params in connection.sql
        if "FROM ordered_series_comparison_publication" in sql
    ]
    assert publication_parameters[-1][:3] == (
        "ref-v1", connection.dataset, connection.indicator)
