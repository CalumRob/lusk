"""Every publication guard is classified and documented (issue #984)."""

from pathlib import Path

from api.publication_outcomes import UNAVAILABLE_FAMILIES, UNAVAILABLE_REASONS
from api.scripts.generate_publication_guard_inventory import (
    collect_guards, check_inventory_file, DOC_PATH)


REQUIRED_FAMILIES = {"scalar", "profile", "ordered_series", "named_reference",
                     "typed_reading", "collection", "aedar"}

# Generic helpers whose caller supplies the declared family at runtime. They
# still emit the actual family in the v2 outcome; the inventory records the
# dynamic marker rather than guessing one.
DYNAMIC_FAMILY_GUARDS = {
    ("snapshot_reads.py", "_indicator_facts_snapshot"),
    ("snapshot_reads.py", "_indicator_comparison_preflight"),
    ("snapshot_reads.py", "_indicator_comparison_snapshot"),
    ("snapshot_reads.py", "_owned_series_route"),
    ("cohort_reads.py", "_indicator_shape"),
    ("series_comparison_projection.py", "_context"),
    ("snapshot_reads.py", "_profile_comparison_publication_marker"),
    ("snapshot_reads.py", "_scalar_comparison_publication_marker"),
    ("semantic_resource_reader.py", "_coordinate_values"),
}


def test_guard_inventory_matches_source():
    assert check_inventory_file(), (
        "Publication guard inventory is stale; run "
        "python api/scripts/generate_publication_guard_inventory.py")


def test_every_soft_guard_names_a_closed_family_and_required_families_exist():
    rows = collect_guards()
    soft = [row for row in rows if row[0] == "unavailable"]
    assert soft, "the v2 contract requires at least one classified publication guard"
    families = set()
    for _outcome, path, function, family, _detail in soft:
        if family == "?":
            assert (path, function) in DYNAMIC_FAMILY_GUARDS, (path, function)
            continue
        assert family in UNAVAILABLE_FAMILIES, (path, function, family)
        families.add(family)
    assert REQUIRED_FAMILIES <= families, REQUIRED_FAMILIES - families


def test_guard_inventory_has_only_the_closed_outcome_vocabulary():
    rows = collect_guards()
    assert {row[0] for row in rows} == {"unavailable", "fatal"}
    assert UNAVAILABLE_REASONS == frozenset({"publication_absent"})
    assert DOC_PATH.exists()
    text = Path(DOC_PATH).read_text(encoding="utf-8")
    assert "`unavailable`" in text and "`fatal`" in text
