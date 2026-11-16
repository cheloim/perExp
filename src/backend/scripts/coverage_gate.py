"""Per-area backend coverage gate (issue #535).

Reads the JSON report produced by ``pytest --cov=app --cov-report=json``.
The floors are a ratchet: they must rise as tests land, never fall. The audit
targets are auth/MFA 90%, import 80% and the rest 60%; the current floors are
the measured baseline, so the gate can land before the coverage work is done.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# (name, file prefixes, floor, target). Raise a floor only after adding tests.
AREAS: tuple[tuple[str, tuple[str, ...], float, float], ...] = (
    (
        "auth/MFA",
        (
            "app/services/auth.py",
            "app/services/mfa.py",
            "app/services/oidc_state.py",
            "app/routers/auth.py",
        ),
        53.0,
        90.0,
    ),
    (
        "import",
        (
            "app/services/import_utils.py",
            "app/services/smart_import_core.py",
            "app/routers/import_jobs.py",
            "app/tasks/import_processor.py",
        ),
        29.0,
        80.0,
    ),
    (
        "whatsapp",
        (
            "app/whatsapp_bot.py",
            "app/routers/whatsapp_webhook.py",
        ),
        11.0,
        60.0,
    ),
    ("total", ("app/",), 48.5, 60.0),
)


def _percent(files: dict, prefixes: tuple[str, ...]) -> tuple[float, int]:
    covered = 0
    statements = 0
    for name, info in files.items():
        if any(name.startswith(prefix) for prefix in prefixes):
            summary = info["summary"]
            covered += summary["covered_lines"]
            statements += summary["num_statements"]
    if not statements:
        return 0.0, 0
    return covered / statements * 100.0, statements


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Enforce per-area backend coverage.")
    parser.add_argument(
        "report",
        nargs="?",
        type=Path,
        default=Path("coverage.json"),
        help="coverage.json produced by pytest-cov",
    )
    args = parser.parse_args(argv)

    if not args.report.exists():
        print(f"coverage report not found: {args.report}", file=sys.stderr)
        return 2

    data = json.loads(args.report.read_text(encoding="utf-8"))
    files = data.get("files") or {}

    failed = False
    print(f"{'area':10} {'now':>7} {'floor':>7} {'target':>7}  status")
    for name, prefixes, floor, target in AREAS:
        percent, statements = _percent(files, prefixes)
        ok = statements > 0 and percent >= floor
        if not ok:
            failed = True
        status = "ok" if ok else "BELOW FLOOR"
        print(f"{name:10} {percent:6.1f}% {floor:6.1f}% {target:6.1f}%  {status}")
        if not statements:
            print(f"  - no files matched: {', '.join(prefixes)}")

    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
