"""Fast, DB-free proofs of per-resource coexistence and reference rollover."""

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from api import aedar_reads, observed_collections, profile_reads, snapshot_reads
from api.cohort_reads import _scalar_contract


class Cursor:
    def __init__(self, rows=(), row=None):
        self.rows = list(rows)
        self.row = row

    def fetchone(self):
        return self.row if self.row is not None else (self.rows[0] if self.rows else None)

    def fetchall(self):
        return self.rows


class PublicationConnection:
    def __init__(self):
        self.reference_version = "ref-v1"
        self.registry = {
            "resource_a": ("scalar", "a-v1", "ref-v1"),
            "resource_b": ("scalar", "b-v1", "ref-v1"),
            "profile_a": ("declared_profile", "profile-v1", "ref-v1"),
            "series_a": ("owned_series", "series-v1", "ref-v1"),
            "collection_a": ("observed_collection", "collection-v1", "ref-v1"),
            "aedar": ("aedar", "aedar-v1", "ref-v1"),
        }
        self.scalar_markers = {
            "resource_a": ("cmp-a-v1", "a-v1", "ref-v1", 1, 2, 1),
            "resource_b": ("cmp-b-v1", "b-v1", "ref-v1", 1, 2, 1),
        }
        self.profile_markers = {
            "profile_a": ("cmp-profile-v1", "profile-v1", "ref-v1", 1, 2, 1),
        }

    def execute(self, sql, params=None):
        normalized = " ".join(sql.split())
        if "FROM resource_publication" in normalized:
            return Cursor(rows=[(resource_id, *self.registry[resource_id])
                                for resource_id in params[0] if resource_id in self.registry])
        if "SELECT content_version,row_count FROM table_publication" in normalized:
            return Cursor(row=(self.reference_version, 2))
        if "FROM scalar_descriptor" in normalized:
            resource_id = params[0]
            return Cursor(row=(resource_id, "fixture", resource_id, "count", "high",
                               resource_id, ["commune"], "count", "sparse", "descriptor-v1"))
        if "FROM profile_descriptor" in normalized:
            return Cursor(rows=[("profile_a", "Profile", "%", ["commune"], "pd1",
                                 "d1", None, "high", None, None, "stock", False)])
        if "SELECT to_regclass('series_dataset_descriptor')" in normalized:
            return Cursor(row=(None,))
        if "to_regclass('scalar_resource_comparison_publication')" in normalized:
            return Cursor(row=("scalar_resource_comparison_publication",))
        if "to_regclass('profile_resource_comparison_publication')" in normalized:
            return Cursor(row=("profile_resource_comparison_publication",))
        if "FROM scalar_resource_comparison_publication" in normalized:
            scalar_version_only = "SELECT indicator_id,scalar_content_version" in normalized
            return Cursor(rows=[
                (resource_id, self.scalar_markers[resource_id][1]) if scalar_version_only else
                (resource_id, *self.scalar_markers[resource_id])
                for resource_id in params[0] if resource_id in self.scalar_markers])
        if "FROM profile_resource_comparison_publication" in normalized:
            return Cursor(rows=[(resource_id, *self.profile_markers[resource_id])
                                for resource_id in params[0] if resource_id in self.profile_markers])
        if "FROM scalar_comparison_group" in normalized:
            return Cursor(rows=[("resource_a", "median", 7.5, 2, 2, 0, 1, True)])
        if "FROM scalar_comparison_territory" in normalized:
            return Cursor(rows=[("resource_a", 10.0, "measured", 1, 1, 2, True)])
        if "FROM comparison_source_lineage" in normalized:
            return Cursor(rows=[("resource_a", "source_a", "v1", "Source A", "2026",
                                 None, None, "cmp-a-v1")])
        if "FROM series_dataset_publication WHERE dataset_id" in normalized:
            return Cursor(row=("series-v1", self.registry["series_a"][2], 1, "2026-01-01"))
        if "FROM series_dataset_descriptor" in normalized:
            return Cursor(row=("year", ["2026"], [2026], "dense_complete", "Series", "count",
                               "high", "sd1", ["commune"], "2026", "fixture", "year",
                               "unavailable", "median", "default_group"))
        if "SELECT name,territory_type FROM territory_reference" in normalized:
            return Cursor(row=("Focal", "commune"))
        if "FROM observed_collection_publication" in normalized:
            return Cursor(row=("collection-v1", self.registry["collection_a"][2]))
        if "FROM table_publication p" in normalized and "aedar_territorial_aggregate" in normalized:
            return Cursor(row=("aedar-storage-v1", 1, self.registry["aedar"][2],
                               self.reference_version))
        raise AssertionError(f"Unexpected SQL: {normalized}")

    def republish_reference(self, version):
        self.reference_version = version
        self.registry = {resource_id: (shape, content_version, version)
                         for resource_id, (shape, content_version, _reference) in self.registry.items()}
        self.scalar_markers = {resource_id: (*marker[:2], version, *marker[3:])
                               for resource_id, marker in self.scalar_markers.items()}
        self.profile_markers = {resource_id: (*marker[:2], version, *marker[3:])
                                for resource_id, marker in self.profile_markers.items()}


class TwoProfileConnection(PublicationConnection):
    def __init__(self):
        super().__init__()
        self.registry["profile_b"] = ("declared_profile", "profile-v2", "ref-v1")
        self.profile_markers["profile_b"] = (
            "cmp-profile-v2", "profile-v2", "ref-v1", 1, 2, 1)

    def execute(self, sql, params=None):
        normalized = " ".join(sql.split())
        if "FROM profile_descriptor" in normalized:
            return Cursor(rows=[
                ("profile_a", "Profile A", "%", ["commune"], "pd1",
                 "d1", None, "high", None, None, "stock", False),
                ("profile_b", "Profile B", "%", ["commune"], "pd2",
                 "d1", None, "high", None, None, "stock", False),
            ])
        if "FROM profile_axis" in normalized:
            return Cursor(rows=[(resource_id, "detail", "d1", "D1", 0, "%")
                                for resource_id in ("profile_a", "profile_b")])
        if "FROM profile_observation o" in normalized:
            provenance = ('[{"source_id":"source_a","vintage_id":"v1","name":"Source A",'
                          '"version":"2026","reference_date":null,"publication_date":null}]')
            return Cursor(rows=[(resource_id, "d1", "", 10.0, "measured", provenance)
                                for resource_id in ("profile_a", "profile_b")])
        if "FROM profile_comparison_group" in normalized:
            return Cursor(rows=[(resource_id, "d1", "", "median", 10.0, 2, 2, 0, 1,
                                 version, "ref-v1", True)
                                for resource_id, version in (("profile_a", "profile-v1"),
                                                             ("profile_b", "profile-v2"))])
        if "FROM profile_comparison_territory" in normalized:
            return Cursor(rows=[(resource_id, "d1", "", "c1", 10.0, "measured", 1, 1, 2,
                                 version, "ref-v1", True)
                                for resource_id, version in (("profile_a", "profile-v1"),
                                                             ("profile_b", "profile-v2"))])
        if "FROM comparison_source_lineage l" in normalized:
            return Cursor(rows=[(resource_id, "source_a", "v1", "Source A", "2026",
                                 None, None, self.profile_markers[resource_id][0])
                                for resource_id in params[4]])
        if "SELECT to_regclass('series_dataset_descriptor')" in normalized:
            return Cursor(row=(None,))
        return super().execute(sql, params)


def _scalar_read(conn):
    return _scalar_contract(conn, "resource_a", "commune",
                            SimpleNamespace(reference_content_version=conn.registry["resource_a"][2]))


def test_republishing_b_leaves_a_read_and_comparison_version_unchanged():
    conn = PublicationConnection()
    descriptors = [("resource_a", "A", "count", "high", "resource_a", ["commune"], "d1")]
    before = snapshot_reads._published_scalar_comparison_results(
        conn, descriptors, ("density_class", "D1", "commune"),
        "commune", ("c1", "c2"), "c1")
    before_version = _scalar_read(conn)[1][0]

    conn.registry["resource_b"] = ("scalar", "b-v2", "ref-v1")
    conn.scalar_markers["resource_b"] = ("cmp-b-v2", "b-v2", "ref-v1", 1, 2, 1)

    after = snapshot_reads._published_scalar_comparison_results(
        conn, descriptors, ("density_class", "D1", "commune"),
        "commune", ("c1", "c2"), "c1")
    assert after == before
    assert _scalar_read(conn)[1][0] == before_version == "a-v1"


def _profile_read(conn):
    return profile_reads.focal_profiles(conn, "commune", "c1", indicator_id="profile_a",
                                        include_cells=False)


def test_theme_profiles_at_different_resource_versions_coexist():
    conn = TwoProfileConnection()

    profiles, _version = profile_reads.focal_profiles(
        conn, "commune", "c1", theme_id="fixture", include_cells=False,
        include_all_descriptors=True)

    assert [(profile["indicator"], profile["content_version"]) for profile in profiles] == [
        ("profile_a", "profile-v1"), ("profile_b", "profile-v2")]
    assert _version is None


def test_each_profiles_scalar_dependency_uses_adopted_comparison_token():
    class ScalarBackedProfiles(TwoProfileConnection):
        def execute(self, sql, params=None):
            if "FROM profile_descriptor" in " ".join(sql.split()):
                return Cursor(rows=[
                    ("profile_a", "Profile A", "%", ["commune"], "pd1",
                     None, None, "high", "resource_a", "a-v1", "stock", False),
                    ("profile_b", "Profile B", "%", ["commune"], "pd2",
                     None, None, "high", "resource_b", "b-v1", "stock", False),
                ])
            if "FROM scalar_descriptor" in " ".join(sql.split()):
                return Cursor(rows=[(resource_id, "%", "high", ["commune"], resource_id)
                                    for resource_id in params[0]])
            return super().execute(sql, params)

    conn = ScalarBackedProfiles()
    # Adopt carries the live global scalar token into both the marker and each
    # dependent descriptor; the registry keeps the independent artefact version.
    conn.scalar_markers["resource_a"] = (
        "cmp-global-a", "global-scalar-token", "ref-v1", 1, 2, 1)
    conn.scalar_markers["resource_b"] = (
        "cmp-global-b", "global-scalar-token", "ref-v1", 1, 2, 1)
    original_execute = conn.execute

    def adopted_descriptors(sql, params=None):
        if "FROM profile_descriptor" in " ".join(sql.split()):
            rows = original_execute(sql, params).fetchall()
            return Cursor(rows=[(*row[:9], "global-scalar-token", *row[10:]) for row in rows])
        return original_execute(sql, params)

    conn.execute = adopted_descriptors
    profiles, _version = profile_reads.focal_profiles(
        conn, "commune", "c1", theme_id="fixture", include_cells=False,
        include_all_descriptors=True)
    assert [(profile["indicator"], profile["comparison_scalar"],
             profile["content_version"]) for profile in profiles] == [
        ("profile_a", "resource_a", "profile-v1"),
        ("profile_b", "resource_b", "profile-v2")]

    conn.scalar_markers["resource_b"] = (
        "cmp-global-b", "different-scalar-token", "ref-v1", 1, 2, 1)
    with pytest.raises(HTTPException) as raised:
        profile_reads.focal_profiles(
            conn, "commune", "c1", theme_id="fixture", include_cells=False,
            include_all_descriptors=True)
    assert raised.value.status_code == 503
    assert raised.value.detail == "Profile scalar dependency is stale or incompatible"


def test_adopted_profile_comparison_token_can_differ_from_registry_version():
    conn = TwoProfileConnection()
    conn.profile_markers["profile_b"] = (
        "cmp-global-profile", "global-profile-token", "ref-v1", 1, 2, 1)

    markers = snapshot_reads._profile_comparison_publication_marker(
        conn, resource_ids=["profile_a", "profile_b"])

    assert markers["profile_b"][1] == "global-profile-token"
    assert conn.registry["profile_b"][1] == "profile-v2"


def test_adopted_scalar_comparison_token_can_differ_from_registry_version():
    conn = PublicationConnection()
    conn.scalar_markers["resource_a"] = (
        "cmp-global-scalar", "global-scalar-token", "ref-v1", 1, 2, 1)

    marker = snapshot_reads._scalar_comparison_publication_marker(
        conn, resource_ids=["resource_a"])["resource_a"]

    assert marker[1] == "global-scalar-token"
    assert conn.registry["resource_a"][1] == "a-v1"


def test_theme_read_reports_each_profiles_own_publication_version(monkeypatch):
    monkeypatch.setattr(snapshot_reads, "collection_descriptors", lambda *_a, **_kw: [])
    monkeypatch.setattr(snapshot_reads, "_comparison_cohort_in_snapshot",
                        lambda *_a, **_kw: ("commune", ("c1", "c2"),
                                            {"kind": "density_class", "density_class_code": "D1"}))
    monkeypatch.setattr(snapshot_reads, "_fixed_scalar_comparison_context",
                        lambda *_a, **_kw: ("density_class", "D1", "commune"))

    result = snapshot_reads._theme_comparison_snapshot(
        TwoProfileConnection(), "commune", "c1", "fixture", None)

    assert result["reference_content_version"] == "ref-v1"
    assert result["profile_content_versions"] == {
        "profile_a": "profile-v1", "profile_b": "profile-v2"}
    assert result["profile_content_version"] is None
    assert [row["indicator"] for row in result["profile_comparisons"]] == [
        "profile_a", "profile_b"]


def test_theme_read_reports_each_scalars_own_publication_version(monkeypatch):
    class TwoScalarConnection(PublicationConnection):
        def execute(self, sql, params=None):
            if "FROM scalar_descriptor WHERE theme_id" in " ".join(sql.split()):
                return Cursor(rows=[
                    ("resource_a", "A", "count", "high", "resource_a", ["commune"], "sd1"),
                    ("resource_b", "B", "count", "high", "resource_b", ["commune"], "sd2"),
                ])
            if "FROM profile_descriptor" in " ".join(sql.split()):
                return Cursor(rows=[])
            return super().execute(sql, params)

    monkeypatch.setattr(snapshot_reads, "collection_descriptors", lambda *_a, **_kw: [])
    monkeypatch.setattr(snapshot_reads, "_comparison_cohort_in_snapshot",
                        lambda *_a, **_kw: ("commune", ("c1", "c2"),
                                            {"kind": "explicit_selection"}))
    monkeypatch.setattr(snapshot_reads, "_fixed_scalar_comparison_context",
                        lambda *_a, **_kw: None)
    monkeypatch.setattr(snapshot_reads, "_selected_scalar_comparison_inputs",
                        lambda *_a, **_kw: ([], {}))

    result = snapshot_reads._theme_comparison_snapshot(
        TwoScalarConnection(), "commune", "c1", "fixture", ["c1", "c2"])

    assert result["scalar_content_versions"] == {"resource_a": "a-v1", "resource_b": "b-v1"}
    assert result["scalar_content_version"] is None


def _owned_series_read(conn):
    return snapshot_reads._owned_series_snapshot(
        conn, "series_a", "commune", "c1", "series_a", preflight_only=True)


def _collection_read(conn):
    return observed_collections.collection_marker(
        conn, {"indicator_id": "collection_a", "kind": "period_detail"})


@pytest.mark.parametrize("operation", [
    _scalar_read,
    lambda conn: snapshot_reads._scalar_comparison_publication_marker(
        conn, resource_ids=["resource_a"]),
    _profile_read,
    lambda conn: snapshot_reads._profile_comparison_publication_marker(
        conn, resource_ids=["profile_a"]),
    _owned_series_read,
    _collection_read,
    lambda conn: aedar_reads._aedar_aggregate_publication_marker(conn),
], ids=["scalar-facts", "scalar-comparison", "profile-facts", "profile-comparison",
        "owned-series", "collection", "aedar"])
def test_reference_flip_fails_every_shape_until_republished(operation):
    conn = PublicationConnection()
    operation(conn)  # The same operation is useful before the reference move.

    conn.reference_version = "ref-v2"
    with pytest.raises(HTTPException) as raised:
        operation(conn)
    assert raised.value.status_code == 503
    assert raised.value.detail == "Territory reference publication is stale or incompatible"

    conn.republish_reference("ref-v2")
    operation(conn)
