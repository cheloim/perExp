"""Tests for health endpoints — liveness and readiness."""

import os

import pytest


class TestLivenessEndpoint:
    """GET /health — always 200 if process is alive."""

    def test_health_returns_dict(self):
        from app.routers.health import health_check

        result = health_check()
        assert isinstance(result, dict)

    def test_health_has_status(self):
        from app.routers.health import health_check

        result = health_check()
        assert result["status"] == "healthy"

    def test_health_has_version(self):
        from app.routers.health import health_check

        result = health_check()
        assert "version" in result

    def test_health_has_uptime(self):
        from app.routers.health import health_check

        result = health_check()
        assert "uptime_seconds" in result
        assert isinstance(result["uptime_seconds"], int)

    def test_health_has_timestamp(self):
        from app.routers.health import health_check

        result = health_check()
        assert "timestamp" in result


class TestReadinessEndpoint:
    """GET /health/ready — checks DB, Redis, Celery, Bots."""

    def test_ready_endpoint_exists(self):
        from app.routers.health import health_ready

        assert callable(health_ready)

    def test_ready_router_has_both_routes(self):
        from app.routers.health import router

        routes = [r.path for r in router.routes]
        assert "/health" in routes
        assert "/health/ready" in routes