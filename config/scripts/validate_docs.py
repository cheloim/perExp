"""Validate the documentation matrix and the feature specs (issue #531).

Two rules:
1. Every canonical document in ``docs/README.md`` must exist.
2. Every filesystem path cited by a feature spec must resolve.

The spec paths have a ratchet baseline (``config/docs_gate_baseline.yaml``):
new missing paths fail, and a fixed path must be removed from the baseline.
This lets the gate land before #532 refreshes the stale specs, without letting
the list grow.

Implemented specs must also declare at least one test and one implementation
reference (an API endpoint or a filesystem path); otherwise "implemented" is
just a label.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

import yaml

DOC_PATH_RE = re.compile(r"`([^`]+)`")
SKIP_VALUES = ("pendiente", "ver #")


def _table_rows(text: str):
    for line in text.splitlines():
        line = line.strip()
        if not line.startswith("|"):
            continue
        cells = [cell.strip() for cell in line.strip("|").split("|")]
        if len(cells) >= 2:
            yield cells


def _canonical_from_row(cells: list[str]) -> str | None:
    match = DOC_PATH_RE.search(cells[1])
    return match.group(1).strip() if match else None


def _matrix_errors(repo: Path, docs: Path) -> list[str]:
    matrix = docs / "README.md"
    if not matrix.exists():
        return [f"missing documentation matrix: {matrix}"]

    errors: list[str] = []
    for cells in _table_rows(matrix.read_text(encoding="utf-8")):
        canonical = _canonical_from_row(cells)
        if not canonical:
            continue
        row = " | ".join(cells[1:])
        if any(skip in canonical.lower() or skip in row.lower() for skip in SKIP_VALUES):
            continue

        if "*" in canonical:
            matches = list(docs.glob(canonical))
            if not matches:
                errors.append(f"docs matrix points to a missing glob: {canonical}")
        elif canonical.endswith("/"):
            if not (docs / canonical).is_dir():
                errors.append(f"docs matrix points to a missing directory: {canonical}")
        elif not (docs / canonical).exists():
            errors.append(f"docs matrix points to a missing file: {canonical}")

    return errors


def _walk_paths(node) -> list[str]:
    paths: list[str] = []
    if isinstance(node, dict):
        for key, value in node.items():
            if key == "path" and isinstance(value, str):
                paths.append(value)
            else:
                paths.extend(_walk_paths(value))
    elif isinstance(node, list):
        for value in node:
            paths.extend(_walk_paths(value))
    return paths


def _resolves(repo: Path, raw: str) -> bool:
    candidates = [repo / raw, repo / "src" / raw]
    return any(candidate.exists() for candidate in candidates)


def _spec_errors(repo: Path, specs: Path) -> tuple[list[str], set[str], set[str]]:
    errors: list[str] = []
    missing: set[str] = set()
    implemented: set[str] = set()

    for spec_file in sorted(specs.glob("*.spec.yaml")):
        data = yaml.safe_load(spec_file.read_text(encoding="utf-8")) or {}
        status = str(data.get("status", "")).strip()
        paths = _walk_paths(data)
        filesystem_paths = [p for p in paths if not p.startswith("/")]

        for raw in filesystem_paths:
            if not _resolves(repo, raw):
                missing.add(raw)

        if status != "implemented":
            continue
        implemented.add(spec_file.name)

        tests = data.get("tests") or []
        if not tests:
            errors.append(f"{spec_file.name}: status=implemented but has no tests")
        # A bot or UI feature may describe its contract through interactions
        # or integrations instead of a filesystem path.
        has_implementation = bool(paths) or any(
            data.get(section) for section in ("backend", "frontend", "integrations")
        )
        if not has_implementation:
            errors.append(
                f"{spec_file.name}: status=implemented but has no implementation reference"
            )

    return errors, missing, implemented


def _load_baseline(path: Path) -> set[str]:
    if not path.exists():
        return set()
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    return {str(item) for item in (data.get("missing_paths") or [])}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate docs and feature specs.")
    parser.add_argument("--repo", type=Path, default=Path.cwd())
    parser.add_argument("--docs", type=Path, default=Path("docs"))
    parser.add_argument("--specs", type=Path, default=Path("docs/specs/features"))
    parser.add_argument(
        "--baseline",
        type=Path,
        default=Path("config/docs_gate_baseline.yaml"),
        help="Known missing spec paths (a ratchet: it only shrinks).",
    )
    args = parser.parse_args(argv)

    repo = args.repo.resolve()
    docs = (repo / args.docs).resolve()
    specs = (repo / args.specs).resolve()
    baseline = (repo / args.baseline).resolve()

    errors = _matrix_errors(repo, docs)
    spec_errors, missing, implemented = _spec_errors(repo, specs)
    errors.extend(spec_errors)

    known = _load_baseline(baseline)
    new_missing = sorted(missing - known)
    fixed = sorted(known - missing)

    for path in new_missing:
        errors.append(f"spec cites a missing path: {path}")
    for path in fixed:
        errors.append(
            f"spec path is fixed but still in {args.baseline}: {path} "
            "(remove it from the baseline)"
        )

    print(
        f"docs: {len(errors)} error(s); specs: {len(implemented)} implemented, "
        f"{len(missing)} missing path(s), {len(known)} baselined"
    )
    for error in errors:
        print(f"  - {error}")

    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
