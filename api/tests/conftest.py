def pytest_configure(config):
    config.addinivalue_line(
        "markers",
        "integration: requires explicit publisher/reader DSNs for a disposable Postgres database",
    )
