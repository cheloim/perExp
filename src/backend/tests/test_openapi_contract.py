"""Contract coverage gate (issue #474).

``docs/specs/openapi.yaml`` is the curated contract (hand-maintained, the
input for orval). ``src/backend/scripts/export_openapi.py`` exports the raw
contract FastAPI infers from the code. Nothing kept the curated file from
falling behind until now — it drifted far enough that orval clients missed
whole parameter sets.

This test compares both and fails when the curated contract falls behind,
or when a recorded gap gets fixed without shrinking the baseline
(``openapi_contract_baseline.yaml``). The baseline is a ratchet: it only
gets smaller.
"""

import os
import subprocess
import sys
from pathlib import Path

import pytest
import yaml

BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_DIR.parents[1]
CURATED_SPEC = REPO_ROOT / "docs" / "specs" / "openapi.yaml"
BASELINE = Path(__file__).resolve().parent / "openapi_contract_baseline.yaml"

_METHODS = ("get", "post", "put", "delete", "patch")


def _ops(spec: dict) -> set[tuple[str, str]]:
    return {
        (path, method)
        for path, ops in (spec.get("paths") or {}).items()
        for method in (ops or {})
        if method in _METHODS
    }


def _query_params(spec: dict) -> dict[tuple[str, str], set[str]]:
    out: dict[tuple[str, str], set[str]] = {}
    for path, ops in (spec.get("paths") or {}).items():
        for method, op in (ops or {}).items():
            if method in _METHODS:
                out[(path, method)] = {
                    p["name"] for p in (op.get("parameters") or []) if p.get("in") == "query"
                }
    return out


def compare_contracts(raw: dict, curated: dict) -> dict[str, list[str]]:
    """Return the gaps of the curated contract against the raw one.

    Three kinds: operations the routers expose that the curated contract
    does not document (``missing_ops``), operations it documents but the
    routers no longer have (``stale_ops``), and query params missing from a
    documented operation (``missing_params``).
    """
    raw_ops, cur_ops = _ops(raw), _ops(curated)
    raw_q, cur_q = _query_params(raw), _query_params(curated)
    return {
        "missing_ops": sorted(f"{m.upper()} {p}" for p, m in raw_ops - cur_ops),
        "stale_ops": sorted(f"{m.upper()} {p}" for p, m in cur_ops - raw_ops),
        "missing_params": sorted(
            f"{m.upper()} {p} ?{name}"
            for (p, m), names in raw_q.items()
            for name in sorted(names - cur_q.get((p, m), set()))
        ),
    }


@pytest.fixture(scope="module")
def raw_spec(tmp_path_factory) -> dict:
    """The raw contract, exported through the blessed script in a subprocess."""
    out = tmp_path_factory.mktemp("contract") / "raw.yaml"
    subprocess.run(
        [sys.executable, "scripts/export_openapi.py", "--output", str(out)],
        cwd=BACKEND_DIR,
        check=True,
        capture_output=True,
        env={**os.environ},
    )
    return yaml.safe_load(out.read_text(encoding="utf-8"))


def test_curated_contract_has_no_new_drift(raw_spec):
    curated = yaml.safe_load(CURATED_SPEC.read_text(encoding="utf-8"))
    gaps = compare_contracts(raw_spec, curated)
    baseline = yaml.safe_load(BASELINE.read_text(encoding="utf-8"))

    for kind, entries in gaps.items():
        known = set(baseline.get(kind, []))
        new = [e for e in entries if e not in known]
        fixed = sorted(known - set(entries))
        assert not new, (
            f"Drift nuevo en el contrato curado ({kind}): {new}\n"
            "Declaralo en docs/specs/openapi.yaml y regenera el cliente "
            "(cd src/frontend && npm run generate:api && npx prettier --write "
            "src/types/generated/ src/api/client-generated.ts), o registra el gap "
            "a propósito en src/backend/tests/openapi_contract_baseline.yaml."
        )
        assert not fixed, (
            f"Gaps ya resueltos que siguen en el baseline ({kind}): {fixed}\n"
            "Sácalos de src/backend/tests/openapi_contract_baseline.yaml — "
            "el baseline solo achica."
        )


# ── The gate itself, proven on synthetic specs ─────────────────────────


def _spec(ops: dict) -> dict:
    return {"paths": {path: {method: op} for path, method, op in ops}}


def test_compare_detects_new_param_drift():
    raw = _spec([("/things", "get", {"parameters": [{"name": "q", "in": "query"}]})])
    curated = _spec([("/things", "get", {})])

    assert compare_contracts(raw, curated)["missing_params"] == ["GET /things ?q"]


def test_compare_is_clean_when_contract_matches():
    raw = _spec([("/things", "get", {"parameters": [{"name": "q", "in": "query"}]})])
    curated = _spec(
        [("/things", "get", {"parameters": [{"name": "q", "in": "query", "schema": {}}]})]
    )

    assert compare_contracts(raw, curated) == {
        "missing_ops": [],
        "stale_ops": [],
        "missing_params": [],
    }


def test_compare_detects_missing_and_stale_ops():
    raw = _spec([("/new", "get", {})])
    curated = _spec([("/gone", "get", {})])

    gaps = compare_contracts(raw, curated)
    assert gaps["missing_ops"] == ["GET /new"]
    assert gaps["stale_ops"] == ["GET /gone"]
