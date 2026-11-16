import re
from pathlib import Path


API = Path(__file__).resolve().parents[1]
PIPELINE = API.parent / "pipeline"


def _r_function_body(source: str, name: str) -> str:
    """Return the braced body of one top-level R function by brace matching."""
    match = re.search(rf"\b{re.escape(name)}\s*<-\s*function\s*\(", source)
    if not match:
        return ""
    start = source.index("{", match.end())
    depth = 0
    quote = None
    index = start
    while index < len(source):
        character = source[index]
        if quote is not None:
            if character == "\\":
                index += 2
                continue
            if character == quote:
                quote = None
        elif character in "\"'":
            quote = character
        elif character == "#":
            index = source.find("\n", index)
            if index == -1:
                break
            continue
        elif character == "{":
            depth += 1
        elif character == "}":
            depth -= 1
            if depth == 0:
                return source[start:index + 1]
        index += 1
    raise AssertionError(f"R function body is unterminated: {name}")


def _typed_reading_owner_sites(source: str) -> dict[str, list[str]]:
    """Collect owners from actual typed-reading registration/owner forms.

    The check is deliberately semantic rather than a whole-word absence ban:
    declared-profile theme owners such as ``lire_theme_metadata("mobilite")``
    are legitimate and must not be confused with a retired Mobility
    typed-reading owner. Whitespace and multiline call forms are accepted.
    """
    registrations = []
    for call in (
        "register_typed_reading_artifact_publisher",
        "register_typed_reading_publisher",
        "read_typed_reading_publication_from",
    ):
        registrations.extend(re.findall(
            rf"\b{call}\s*\([^,]*,\s*[\"']([^\"']+)[\"']", source, re.DOTALL))
    contracts = re.findall(
        r"(?m)^\s*([A-Za-z][A-Za-z0-9_]*)\s*=\s*list\s*\(",
        _r_function_body(source, "typed_reading_artifact_contracts"))
    switch_arms = []
    for name in (
        "typed_reading_projection",
        "assemble_typed_reading",
        "typed_reading_content_version",
        "validate_typed_reading_projection",
    ):
        switch_arms.extend(re.findall(
            r"(?m)^\s*([A-Za-z][A-Za-z0-9_]*)\s*=",
            _r_function_body(source, name)))
    return {
        "registrations": registrations,
        "artifact_contracts": contracts,
        "switch_arms": switch_arms,
    }


def _mobility_typed_reading_owners(source: str) -> list[str]:
    return sorted({
        owner for owners in _typed_reading_owner_sites(source).values()
        for owner in owners if owner.lower() in {"mobilite", "mobility"}
    })


def test_fresh_schema_excludes_retired_accessibility_relations_and_upgrade_drops_them():
    fresh = (API / "schema.sql").read_text(encoding="utf-8").lower()
    retirement = (API / "migrations/036_retire_legacy_accessibility_serving.sql").read_text(
        encoding="utf-8").lower()
    retired_relations = (
        "service_registry", "essential_service_access", "building_ramp", "building_grid",
        "bpe_profile_evidence", "mobility_density_distribution_point",
        "mobility_density_distribution_range", "mobility_density_distribution_descriptor",
        "mobility_typed_reading", "mobility_reading_descriptor", "mobility_reading_story",
        "mobility_reading_clock",
    )
    for relation in retired_relations:
        assert f"create table {relation}" not in fresh
        assert f"drop table if exists {relation}" in retirement
    assert "create table scalar_observation" in fresh
    assert "create table aedar_comparison_publication" in fresh
    assert "'mobility_typed_reading'" not in fresh


def test_snapshot_derived_mobility_reading_has_no_pipeline_publisher_or_artifact_owner():
    publishers = (PIPELINE / "R/publish_typed_readings.R").read_text(encoding="utf-8").lower()
    artifacts = (PIPELINE / "R/publish_typed_reading_artifact.R").read_text(encoding="utf-8").lower()
    registry = (PIPELINE / "R/publish_retained_scalar_snapshot.R").read_text(encoding="utf-8").lower()
    for retired_name in ("publish_mobility_reading", "publish_canonical_mobility_reading",
                         "project_mobility_reading", "mobility_reading_content_version"):
        assert retired_name.lower() not in publishers
    for function_name in ("typed_reading_artifact_contracts", "typed_reading_projection",
                          "assemble_typed_reading", "typed_reading_content_version",
                          "validate_typed_reading_projection"):
        assert f"{function_name} <- function" in artifacts, function_name
    assert not _mobility_typed_reading_owners(artifacts)
    assert not _mobility_typed_reading_owners(registry)


def test_retired_mobility_typed_reading_owner_negative_controls_are_detected():
    """Representative real registration forms must still be rejected.

    The snippets mirror the pre-retirement calls retained in git history
    (8fd2e06e) so a future reintroduction cannot pass by moving or renaming
    only a function symbol while leaving the structural owner registration.
    """
    artifact_contract = '''
    typed_reading_artifact_contracts <- function() {
      list(
        mobilite = list(
          table_fields = c("facts", "stories", "clocks"),
          json_fields = "descriptor"
        ),
        economie = list(table_fields = c("facts", "source"), json_fields = character())
      )
    }
    '''
    assert "mobilite" in _mobility_typed_reading_owners(artifact_contract)

    artifact_publisher = '''
    publish_canonical_mobility_reading <- function(con, sortie) {
      publication <- read_typed_reading_publication_from(sortie, "mobilite")
      publish_typed_reading_publication(
        register_typed_reading_artifact_publisher(
          list(),
          "mobilite",
          publish_mobility_reading
        ),
        "mobilite",
        publication,
        con
      )
    }
    '''
    assert "mobilite" in _mobility_typed_reading_owners(artifact_publisher)

    legacy_registry = '''
    register_typed_reading_publisher(registry,"mobilite",
      function(input) project_mobility_reading(input$histories,input$vintages,input$metadata),
      function(db,projection,input) publish_mobility_reading(db,projection,input))
    '''
    assert "mobilite" in _mobility_typed_reading_owners(legacy_registry)

    switch_arm = '''
    typed_reading_content_version <- function(projection, owner) {
      switch(owner,
        mobilite = mobility_reading_projection_content_version(
          projection$facts, assemble_mobility_reading_descriptor(projection)),
        economie = scalar_content_version(list(facts = projection$facts)))
    }
    '''
    assert "mobilite" in _mobility_typed_reading_owners(switch_arm)


def test_reintroducing_retired_owner_into_current_sources_is_detected():
    """The current files plus one historical registration call must fail."""
    registry = (PIPELINE / "R/publish_retained_scalar_snapshot.R").read_text(
        encoding="utf-8").lower()
    reintroduced_registry = registry + '''
    publish_canonical_mobility_reading <- function(con, sortie) {
      publication <- read_typed_reading_publication_from(sortie,"mobilite")
      publish_typed_reading_publication(
        register_typed_reading_artifact_publisher(list(),"mobilite",publish_mobility_reading),
        "mobilite",publication,con)
    }
    '''
    assert _mobility_typed_reading_owners(reintroduced_registry) == ["mobilite"]

    artifacts = (PIPELINE / "R/publish_typed_reading_artifact.R").read_text(
        encoding="utf-8").lower()
    reintroduced_artifacts = artifacts.replace(
        "  list(\n", '  list(\n    mobilite = list(\n'
        '      table_fields = c("facts", "stories", "clocks"),\n'
        '      json_fields = "descriptor"\n    ),\n', 1)
    assert reintroduced_artifacts != artifacts
    assert _mobility_typed_reading_owners(reintroduced_artifacts) == ["mobilite"]


def test_declared_profile_mobility_owner_is_not_a_typed_reading_registration():
    """The concurrent legitimate declared-profile owner stays admitted."""
    registry = (PIPELINE / "R/publish_retained_scalar_snapshot.R").read_text(encoding="utf-8")
    assert 'profile_serving_owners(lire_theme_metadata("mobilite"))' in registry
    assert not _mobility_typed_reading_owners(registry)

    mixed = '''
    declared_profile_owners <- function() {
      unique(c(
        profile_serving_owners(lire_theme_metadata("demographie")),
        profile_serving_owners(lire_theme_metadata("mobilite"))))
    }
    register_typed_reading_artifact_publisher(list(), "economie", publish_economy_reading_family)
    '''
    assert not _mobility_typed_reading_owners(mixed)


def test_retired_building_and_bpe_routes_are_not_registered():
    import api.main as main

    paths = set(main.app.openapi()["paths"])
    assert not any("building-access" in path or "essential-services" in path for path in paths)
    assert "/api/resources/read" in paths
    assert "/api/resources/read-batch" in paths
