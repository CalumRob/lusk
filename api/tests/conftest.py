import pytest


def pytest_configure(config):
    config.addinivalue_line(
        "markers",
        "integration: requires explicit publisher/reader DSNs for a disposable Postgres database",
    )
    config.addinivalue_line(
        "markers", "db_catalogue: exercises the production database-backed catalogue dependency",
    )


@pytest.fixture(autouse=True)
def _offline_catalogue_for_legacy_unit_fixtures(request):
    """Keep existing DB-free HTTP fixtures on their checked-in producer roster.

    Production discovery is database-backed. Guarded integration tests and the
    dedicated db_catalogue route test exercise that dependency; older unit HTTP
    fixtures model serving SQL, not discovery SQL, and would otherwise need a
    second unrelated fake catalogue in every connection stub.
    """
    from api import main
    from api.resource_catalogue import default_resource_catalogue

    if request.node.get_closest_marker("integration") or request.node.get_closest_marker("db_catalogue"):
        yield
        return
    original = main.get_resource_catalogue
    main.app.dependency_overrides[original] = default_resource_catalogue
    try:
        yield
    finally:
        main.app.dependency_overrides.pop(original, None)
