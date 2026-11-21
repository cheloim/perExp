"""Gate invalid CSS classes and typography debt (issues #520/#572/#573).

Rules, counted per file:

* ``nested_vars``: ``var(--x[var(--y)])`` — the CSS parser cannot resolve it,
  so the colour is silently dropped.
* ``undefined_vars``: ``var(--token)`` without a fallback where ``--token`` is
  not declared in ``src/index.css`` nor set from TS. A fallback keeps the class
  valid, even if the token is still missing.
* ``small_text``: Tailwind arbitrary text sizes below the 12 px floor.
* ``dim_label_small``: ``adw-dim-label`` combined with a size below 14 px.

Existing debt is recorded in ``config/css_class_baseline.json``. The baseline
only shrinks: adding a violation fails, and removing one requires lowering the
baseline entry (same ratchet as ``validate_excepts.py``).

Run from the repository root:

    python config/scripts/validate_css_classes.py
    python config/scripts/validate_css_classes.py --write-baseline
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

SOURCE_SUFFIXES = {".ts", ".tsx", ".css"}

NESTED_VAR_RE = re.compile(r"var\(\s*--[A-Za-z0-9_-]+\s*\[\s*var\(")
VAR_RE = re.compile(r"var\(\s*(--[A-Za-z0-9_-]*[A-Za-z0-9_])\s*(,)?")
SMALL_TEXT_RE = re.compile(r"text-\[(\d+(?:\.\d+)?)px\]")
DIM_LABEL_RE = re.compile(r"[\"'`]([^\"'`]*adw-dim-label[^\"'`]*)[\"'`]")
DIM_LABEL_SMALL_RE = re.compile(r"(?:adw-caption(?:-heading)?|text-xs)\b")
DEFINITION_RE = re.compile(r"(--[A-Za-z0-9_-]+)\s*:")
QUOTED_VAR_RE = re.compile(r"[\"'](--[A-Za-z0-9_-]+)[\"']")

RULES = ("nested_vars", "undefined_vars", "small_text", "dim_label_small")


def _collect_definitions(root: Path, repo: Path) -> set[str]:
    declared: set[str] = set()
    css = root / "index.css"
    if css.exists():
        declared.update(DEFINITION_RE.findall(css.read_text(encoding="utf-8")))
    for path in root.rglob("*"):
        if path.suffix not in {".ts", ".tsx"} or path.name.endswith(".test.tsx"):
            continue
        text = path.read_text(encoding="utf-8")
        declared.update(QUOTED_VAR_RE.findall(text))
    return declared


def _iter_sources(root: Path):
    for path in sorted(root.rglob("*")):
        if path.suffix not in SOURCE_SUFFIXES:
            continue
        if ".test." in path.name or path.name.endswith(".test.ts"):
            continue
        yield path


def scan(root: Path, repo: Path) -> dict[str, dict[str, list[int]]]:
    declared = _collect_definitions(root, repo)
    found: dict[str, dict[str, list[int]]] = {}
    for path in _iter_sources(root):
        text = path.read_text(encoding="utf-8")
        hits: dict[str, list[int]] = {rule: [] for rule in RULES}

        for match in NESTED_VAR_RE.finditer(text):
            hits["nested_vars"].append(text.count("\n", 0, match.start()) + 1)

        for match in VAR_RE.finditer(text):
            name, fallback = match.group(1), match.group(2)
            if not fallback and name not in declared:
                hits["undefined_vars"].append(text.count("\n", 0, match.start()) + 1)

        for match in SMALL_TEXT_RE.finditer(text):
            if float(match.group(1)) < 12:
                hits["small_text"].append(text.count("\n", 0, match.start()) + 1)

        for match in DIM_LABEL_RE.finditer(text):
            literal = match.group(1)
            if DIM_LABEL_SMALL_RE.search(literal):
                hits["dim_label_small"].append(text.count("\n", 0, match.start()) + 1)
                continue
            small = [float(value) for value in SMALL_TEXT_RE.findall(literal)]
            if any(value < 14 for value in small):
                hits["dim_label_small"].append(text.count("\n", 0, match.start()) + 1)

        hits = {rule: lines for rule, lines in hits.items() if lines}
        if hits:
            found[str(path.relative_to(repo))] = hits
    return found


def _counts(found: dict[str, dict[str, list[int]]]) -> dict[str, dict[str, int]]:
    return {
        file: {rule: len(lines) for rule, lines in rules.items()}
        for file, rules in sorted(found.items())
    }


def _load_baseline(path: Path) -> dict[str, dict[str, int]]:
    if not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    return {
        str(file): {rule: int(count) for rule, count in rules.items()}
        for file, rules in (data.get("files") or {}).items()
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Gate invalid CSS classes and small text."
    )
    parser.add_argument("--repo", type=Path, default=Path.cwd())
    parser.add_argument("--root", type=Path, default=Path("src/frontend/src"))
    parser.add_argument(
        "--baseline", type=Path, default=Path("config/css_class_baseline.json")
    )
    parser.add_argument("--write-baseline", action="store_true")
    args = parser.parse_args(argv)

    repo = args.repo.resolve()
    found = scan(repo / args.root, repo)
    counts = _counts(found)
    total = sum(sum(rules.values()) for rules in counts.values())

    if args.write_baseline:
        baseline = repo / args.baseline
        baseline.write_text(
            json.dumps({"files": counts}, indent=2) + "\n",
            encoding="utf-8",
        )
        print(f"wrote {baseline} with {len(counts)} files / {total} findings")
        return 0

    baseline = _load_baseline(repo / args.baseline)
    errors: list[str] = []
    for file, rules in counts.items():
        known = baseline.get(file, {})
        for rule, count in rules.items():
            allowed = known.get(rule, 0)
            if count > allowed:
                lines = ", ".join(str(line) for line in found[file][rule][:8])
                errors.append(
                    f"{file}: {rule} {count} > baseline {allowed} (lines {lines})"
                )
    for file, known in sorted(baseline.items()):
        current = counts.get(file, {})
        for rule, allowed in known.items():
            count = current.get(rule, 0)
            if count < allowed:
                errors.append(
                    f"{file}: {rule} {count} below baseline {allowed}; lower the baseline"
                )

    print(f"css class findings: {total} across {len(counts)} files")
    for error in errors:
        print(f"  - {error}")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
