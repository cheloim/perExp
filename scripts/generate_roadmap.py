#!/usr/bin/env python3
"""Auto-generate the roadmap table in docs/Roadmap.md from spec files."""

import glob
import os
import re
import sys

import yaml

START_MARKER = "<!-- AUTO-GENERATED START -->"
END_MARKER = "<!-- AUTO-GENERATED END -->"

STATUS_MAP = {
    ("implemented", "full"): "✅ Done",
    ("implemented", "lite"): "✅ Done",
    ("implemented", "bugfix"): "✅ Fixed",
    ("in-progress", "full"): "🔶 In Progress",
    ("in-progress", "lite"): "🔶 In Progress",
    ("in-progress", "bugfix"): "🔶 In Progress",
    ("planned", "full"): "⏳ Backlog",
    ("planned", "lite"): "⏳ Backlog",
    ("open", "bugfix"): "🐛 Open",
    ("deprecated", "full"): "❌ Deprecated",
    ("deprecated", "lite"): "❌ Deprecated",
    ("deprecated", "bugfix"): "❌ Deprecated",
}

STATUS_ORDER = {
    "✅ Done": 0,
    "✅ Fixed": 0,
    "🔶 In Progress": 1,
    "⏳ Backlog": 2,
    "🐛 Open": 2,
    "❌ Deprecated": 3,
}


def load_spec(path: str) -> dict | None:
    """Load and normalize a spec file to a common dict format."""
    try:
        with open(path) as f:
            data = yaml.safe_load(f)
    except Exception as e:
        print(f"  ⚠️  Failed to parse {path}: {e}")
        return None

    if not data:
        return None

    # Handle metadata: wrapper format
    if "metadata" in data:
        meta = data["metadata"]
        name = meta.get("name", os.path.basename(path))
        description = meta.get("title", "")
        status = meta.get("status", "planned")
        spec_type = meta.get("type", "full")
    else:
        # Top-level format: feature or bug key
        name = data.get("feature") or data.get("bug") or os.path.basename(path)
        description = ""
        desc_raw = data.get("description", "")
        if isinstance(desc_raw, str):
            description = desc_raw.strip().split("\n")[0]
        status = data.get("status", "planned")
        spec_type = data.get("type", "full")

    pr = data.get("pr", "-")
    github_issue = data.get("github_issue", "-")

    return {
        "name": name,
        "type": spec_type,
        "status": status,
        "description": description,
        "pr": pr if pr else "-",
        "github_issue": github_issue if github_issue else "-",
        "file": os.path.basename(path),
    }


def resolve_status(status: str, spec_type: str) -> str:
    """Map (status, type) to a display status string."""
    return STATUS_MAP.get((status, spec_type), status)


def build_table(specs: list[dict]) -> str:
    """Build a markdown table from normalized specs."""
    rows = []
    for s in specs:
        display_status = resolve_status(s["status"], s["type"])
        sort_key = (STATUS_ORDER.get(display_status, 99), s["name"].lower())
        rows.append((sort_key, s["name"], s["type"], display_status, s["description"], s["pr"], s["github_issue"]))

    rows.sort(key=lambda r: r[0])

    lines = [
        "| Feature | Type | Status | Description | PR | Issue |",
        "|---------|------|--------|-------------|----|----|",
    ]
    for _, name, typ, status, desc, pr, issue in rows:
        desc_short = desc[:80] + "..." if len(desc) > 80 else desc
        lines.append(f"| {name} | {typ} | {status} | {desc_short} | {pr} | {issue} |")

    return "\n".join(lines)


def main() -> None:
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    specs_dir = os.path.join(root, "specs", "features")
    roadmap_path = os.path.join(root, "docs", "Roadmap.md")

    # Collect spec files
    patterns = [
        os.path.join(specs_dir, "*.spec.yaml"),
        os.path.join(specs_dir, "*.spec.yml"),
    ]
    spec_files = []
    for pat in patterns:
        spec_files.extend(glob.glob(pat))

    if not spec_files:
        print("No spec files found in specs/features/")
        sys.exit(0)

    print(f"Found {len(spec_files)} spec file(s)")

    # Load specs
    specs = []
    for path in sorted(spec_files):
        s = load_spec(path)
        if s:
            specs.append(s)
            print(f"  ✓ {s['file']}: {s['name']} [{s['status']}/{s['type']}]")

    if not specs:
        print("No valid specs loaded.")
        sys.exit(0)

    # Build table
    table = build_table(specs)

    # Read existing Roadmap.md
    if not os.path.exists(roadmap_path):
        print(f"Error: {roadmap_path} not found")
        sys.exit(1)

    with open(roadmap_path) as f:
        content = f.read()

    if START_MARKER not in content or END_MARKER not in content:
        print(f"Error: Markers not found in {roadmap_path}")
        print(f"  Expected: {START_MARKER}")
        print(f"  Expected: {END_MARKER}")
        sys.exit(1)

    # Replace content between markers
    pattern = re.compile(
        re.escape(START_MARKER) + r".*?" + re.escape(END_MARKER),
        re.DOTALL,
    )
    replacement = f"{START_MARKER}\n\n{table}\n\n{END_MARKER}"
    new_content = pattern.sub(replacement, content)

    with open(roadmap_path, "w") as f:
        f.write(new_content)

    print(f"\n✅ Updated {roadmap_path}")
    print(f"   {len(specs)} features/bugs in table")


if __name__ == "__main__":
    main()
