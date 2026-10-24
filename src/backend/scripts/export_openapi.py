"""Export the raw OpenAPI spec that FastAPI infers from the code.

There are two artifacts, and they have two different jobs:

* ``docs/specs/openapi.yaml`` is the **curated** contract: hand-maintained, and
  the input for orval (``src/frontend/orval.config.ts``). This script refuses to
  overwrite it unless you pass ``--force``.
* ``docs/specs/openapi.generated.yaml`` is the **raw** export produced here: the
  complete 3.1.0 contract, useful to see what the curated file documents and
  what it does not. It is gitignored and never committed.

Run from the repo root:
    python src/backend/scripts/export_openapi.py

Run inside the backend container (``docs/specs`` is mounted at
``/app/docs/specs``, see ``podman-compose.yml``):
    podman exec -u root creditcardanalyzer_backend_dev_1 \\
        /app/docker-entrypoint.sh python /app/scripts/export_openapi.py

That mount is what gives the script its default destination in the container:
it looks for the nearest ancestor holding ``docs/specs``, which is the mounted
directory. Two wrinkles in that command, both real:

* Go through ``docker-entrypoint.sh``. A bare ``podman exec`` starts a process
  without the secrets it loads from ``/run/secrets``, and importing the app then
  dies on the missing ``SECRET_KEY``.
* Run as root. The compose file runs the app as uid 1000, which under rootless
  podman is an unmapped id that cannot write to the bind mounts; root is the
  host user, so the file lands owned by you.

Outside a checkout, or with no ``docs/specs`` reachable, there is no default:
pass ``--output``.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import yaml

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

DEFAULT_OUTPUT = Path("docs") / "specs" / "openapi.generated.yaml"
CURATED_SPEC = Path("docs") / "specs" / "openapi.yaml"


def find_repo_root(start: Path) -> Path | None:
    """Walk up from ``start`` looking for the directory that holds docs/specs.

    Returns None where the repo is not mounted whole (the container), which is
    the caller's cue to pass --output explicitly.
    """
    for candidate in (start, *start.parents):
        if (candidate / "docs" / "specs").is_dir():
            return candidate
    return None


def resolve_output(explicit: str | None) -> Path:
    if explicit:
        return Path(explicit).expanduser().resolve()
    root = find_repo_root(BACKEND_DIR)
    if root is None:
        raise SystemExit(
            f"Cannot find the repo root from {BACKEND_DIR}, so there is no default destination. "
            "Pass one explicitly, e.g. --output /app/docs/specs/openapi.generated.yaml"
        )
    return root / DEFAULT_OUTPUT


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "-o",
        "--output",
        help=f"Destination file (default: {DEFAULT_OUTPUT})",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help=f"Allow overwriting the curated contract at {CURATED_SPEC}",
    )
    args = parser.parse_args()

    root = find_repo_root(BACKEND_DIR)
    output = resolve_output(args.output)

    curated = (root / CURATED_SPEC).resolve() if root else None
    if output.name == CURATED_SPEC.name and not args.force:
        print(
            f"Refusing to write to {curated or output}: that name belongs to the curated contract\n"
            "that orval reads, not to export output. Use the default\n"
            "docs/specs/openapi.generated.yaml, or pass --force if you really mean to replace it.",
            file=sys.stderr,
        )
        return 2

    from main import app

    spec = app.openapi()
    text = yaml.safe_dump(spec, default_flow_style=False, sort_keys=False, allow_unicode=True)
    try:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(text, encoding="utf-8")
    except PermissionError:
        raise SystemExit(
            f"Cannot write {output}: the container's app user cannot write to that bind mount.\n"
            "Run the exec as root (rootless podman maps container root to your own user, so the\n"
            "file still lands owned by you), or make the directory world-writable like the other\n"
            "bind mounts in podman-compose.yml."
        )

    print(f"OpenAPI spec exported to {output}")
    print(f"Paths: {len(spec.get('paths', {}))}")
    print(f"Schemas: {len(spec.get('components', {}).get('schemas', {}))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
