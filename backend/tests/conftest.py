"""Test config — uses a temp directory for all storage."""

import os
import tempfile
import pytest

@pytest.fixture(autouse=True, scope="session")
def temp_storage():
    td = tempfile.mkdtemp(prefix="sp_test_")
    os.environ["SCRAPER_STORAGE_DIR"] = td
    yield td
    import shutil
    shutil.rmtree(td, ignore_errors=True)


@pytest.fixture(scope="session")
def app(temp_storage):
    from app import create_app
    application = create_app()
    application.config["TESTING"] = True
    return application


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def app_client(app):
    """Alias for client — used by agent tests."""
    return app.test_client()
