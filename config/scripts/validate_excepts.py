"""Fail on new silent ``except Exception`` handlers (issue #563).

A silent handler swallows the error: it neither raises nor logs. The audit
found 65 of them across the backend. This gate keeps the list from growing
with a per-file ratchet baseline (``config/except_baseline.json``); lowering a
count requires updating the baseline, adding a handler fails.

Run from the repository root:

    python config/scripts/validate_excepts.py
    python config/scripts/validate_excepts.py --write-baseline
"""

from __future__ import annotations

import argparse
import ast
import json
import sys
from pathlib import Path

LOG_METHODS = {"debug", "info", "warning", "error", "exception", "critical", "log"}
LOG_NAMES = {"logger", "log", "logging"}
ALLOWED_CALLS = {"handleError"}


def _is_caught_type(node: ast.ExceptHandler) -> bool:
    if node.type is None:
        return True
    return ast.unparse(node.type) in {"Exception", "BaseException"}


def _logs_or_raises(handler: ast.ExceptHandler) -> bool:
    for node in ast.walk(handler):
        if isinstance(node, ast.Raise):
            return True
        if isinstance(node, ast.Call):
            func = node.func
            if isinstance(func, ast.Attribute) and func.attr in LOG_METHODS:
                return True
            if isinstance(func, ast.Attribute) and func.attr in ALLOWED_CALLS:
                return True
            if isinstance(func, ast.Name) and func.id in LOG_METHODS:
                return True
    return False


def silent_handlers(path: Path) -> list[int]:
    try:
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    except SyntaxError as exc:
        print(f"{path}: cannot parse: {exc}", file=sys.stderr)
        return []
    return [
        node.lineno
        for node in ast.walk(tree)
        if isinstance(node, ast.ExceptHandler)
        and _is_caught_type(node)
        and not _logs_or_raises(node)
    ]


def scan(root: Path, repo: Path) -> dict[str, list[int]]:
    found: dict[str, list[int]] = {}
    for path in sorted(root.rglob("*.py")):
        if "__pycache__" in path.parts:
            continue
        silent = silent_handlers(path)
        if silent:
            found[str(path.relative_to(repo))] = silent
    return found


def _load_baseline(path: Path) -> dict[str, int]:
    if not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    return {str(file): int(count) for file, count in (data.get("files") or {}).items()}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Gate silent except handlers.")
    parser.add_argument("--repo", type=Path, default=Path.cwd())
    parser.add_argument("--root", type=Path, default=Path("src/backend/app"))
    parser.add_argument(
        "--baseline", type=Path, default=Path("config/except_baseline.json")
    )
    parser.add_argument("--write-baseline", action="store_true")
    args = parser.parse_args(argv)

    repo = args.repo.resolve()
    found = scan(repo / args.root, repo)
    counts = {file: len(lines) for file, lines in found.items()}
    total = sum(counts.values())

    if args.write_baseline:
        baseline = repo / args.baseline
        baseline.write_text(
            json.dumps({"files": dict(sorted(counts.items()))}, indent=2) + "\n",
            encoding="utf-8",
        )
        print(f"wrote {baseline} with {len(counts)} files / {total} handlers")
        return 0

    baseline = _load_baseline(repo / args.baseline)
    errors: list[str] = []
    for file, count in sorted(counts.items()):
        known = baseline.get(file, 0)
        if count > known:
            lines = ", ".join(str(line) for line in found[file])
            errors.append(f"{file}: {count} silent handlers (baseline {known}); lines {lines}")
    for file, known in sorted(baseline.items()):
        current = counts.get(file, 0)
        if current < known:
            errors.append(
                f"{file}: {current} silent handlers but baseline says {known}; lower the baseline"
            )

    print(f"silent except handlers: {total} across {len(counts)} files")
    for error in errors:
        print(f"  - {error}")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
