import pytest


def pytest_configure(config):
    config.addinivalue_line(
        "markers",
        "integration: requires explicit publisher/reader DSNs for a disposable Postgres database",
    )
    config.addinivalue_line(
        "markers", "db_catalogue: exercises the production database-backed catalogue dependency",
    )


@pytest.fixture
def legacy_resource_catalogue():
    """Explicit opt-in for legacy DB-free HTTP fixtures with fake serving SQL.

    Production route tests use the database catalogue. Only modules that mark
    ``usefixtures("legacy_resource_catalogue")`` receive this test-only override.
    """
    from api import main
    from api.tests.resource_catalogue_fixtures import default_resource_catalogue

    original = main.get_resource_catalogue
    main.app.dependency_overrides[original] = default_resource_catalogue
    try:
        yield
    finally:
        main.app.dependency_overrides.pop(original, None)
