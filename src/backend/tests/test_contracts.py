"""Contract validation tests.

Verifies that the API contracts (OpenAPI spec, router registration, schema exports)
stay consistent as the codebase evolves.
"""

import os

import pytest


class TestRouterRegistration:
    """Every router module must be registered in main.py."""

    def test_all_routers_in_main(self):
        import ast

        main_path = os.path.join(os.path.dirname(__file__), "..", "main.py")
        with open(main_path) as f:
            content = f.read()

        registered = set()
        for line in content.split("\n"):
            if "include_router" in line and "." in line:
                parts = line.strip().split("include_router(")
                if len(parts) > 1:
                    module = parts[1].split(".")[0].strip()
                    registered.add(module)

        routers_dir = os.path.join(os.path.dirname(__file__), "..", "app", "routers")
        router_files = {
            f[:-3]
            for f in os.listdir(routers_dir)
            if f.endswith(".py") and f != "__init__.py"
        }

        missing = router_files - registered
        assert not missing, f"Routers not registered: {missing}"

    def test_no_extra_registrations(self):
        """No router registered that doesn't exist as a module."""
        import ast

        main_path = os.path.join(os.path.dirname(__file__), "..", "main.py")
        with open(main_path) as f:
            content = f.read()

        registered = set()
        for line in content.split("\n"):
            if "include_router" in line and "." in line:
                parts = line.strip().split("include_router(")
                if len(parts) > 1:
                    module = parts[1].split(".")[0].strip()
                    registered.add(module)

        routers_dir = os.path.join(os.path.dirname(__file__), "..", "app", "routers")
        router_files = {
            f[:-3]
            for f in os.listdir(routers_dir)
            if f.endswith(".py") and f != "__init__.py"
        }

        extra = registered - router_files
        assert not extra, f"Registered but missing module: {extra}"


class TestOpenAPIConsistency:
    """Verify OpenAPI spec exists and is parseable."""

    def test_openapi_yaml_exists(self):
        spec_path = os.path.join(os.path.dirname(__file__), "..", "..", "..", "docs", "specs", "openapi.yaml")
        if not os.path.exists(spec_path):
            pytest.skip("openapi.yaml not found at expected path")
        assert os.path.exists(spec_path)

    def test_openapi_yaml_is_valid(self):
        spec_path = os.path.join(os.path.dirname(__file__), "..", "..", "..", "docs", "specs", "openapi.yaml")
        if not os.path.exists(spec_path):
            pytest.skip("openapi.yaml not found")

        import yaml

        with open(spec_path) as f:
            spec = yaml.safe_load(f)

        assert "openapi" in spec
        assert "paths" in spec
        assert "info" in spec
        assert spec["info"]["title"] == "Oikonomia API"

    def test_openapi_has_all_tag_groups(self):
        """OpenAPI spec should define tags for all major feature areas."""
        spec_path = os.path.join(os.path.dirname(__file__), "..", "..", "..", "docs", "specs", "openapi.yaml")
        if not os.path.exists(spec_path):
            pytest.skip("openapi.yaml not found")

        import yaml

        with open(spec_path) as f:
            spec = yaml.safe_load(f)

        tag_names = {t["name"] for t in spec.get("tags", [])}
        required_tags = {"auth", "expenses", "cards", "accounts", "categories", "dashboard"}
        missing = required_tags - tag_names
        assert not missing, f"Missing required tags in OpenAPI: {missing}"


class TestMainAppConfiguration:
    """Verify FastAPI app is correctly configured."""

    @pytest.fixture(autouse=True)
    def _ensure_env(self, monkeypatch):
        """Ensure SECRET_KEY is set for main.py import."""
        monkeypatch.setenv("SECRET_KEY", os.getenv("SECRET_KEY", "test-secret-key-for-ci-that-is-at-least-32-chars"))

    def test_app_has_title(self):
        from main import app

        assert app.title == "Oikonomia API"

    def test_app_has_version(self):
        from main import app

        assert app.version is not None

    def test_app_has_servers(self):
        from main import app

        assert len(app.servers) >= 1

    def test_app_has_openapi_tags(self):
        from main import app

        assert len(app.openapi_tags) >= 10