"""Keep fresh installs, existing installs and the corrective migration aligned."""

from pathlib import Path
import re


API = Path(__file__).resolve().parents[1]


def test_ramp_quantile_contract_accepts_float_noise_without_losing_axis_validation():
    files = (
        API / "schema.sql",
        API / "migrations/008_building_evidence_contract.sql",
        API / "migrations/010_building_quantile_float_tolerance.sql",
    )
    for file in files:
        sql = file.read_text(encoding="utf-8")
        assert "abs(NEW.quantile - (expected_quantile #>> '{}')::double precision) <= 1e-12" in sql
        assert "expected_quantile := descriptor->'axes'->'quantile'->(NEW.quantile_index::integer)" in sql

    function = r"CREATE (?:OR REPLACE )?FUNCTION assert_building_fact_source\(\) RETURNS trigger LANGUAGE plpgsql AS \$\$(.*?)END \$\$;"
    bodies = [re.search(function, file.read_text(encoding="utf-8"), re.S).group(1)
              for file in files]
    # Fresh installs have a different surrounding implementation; the corrective
    # migration must replace the installed 008 function without other changes.
    assert bodies[1] == bodies[2]
